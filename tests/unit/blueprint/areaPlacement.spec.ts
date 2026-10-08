import { fromStr } from '@/blueprint/parser';
import { findPosForAreas } from '@/blueprint/planet';
import { planetToLocal, localToPlanet, AreaGridOrigin } from '@/blueprint/area';
import { createEmptyBlueprint } from '@/blueprint/create';
import * as fs from 'fs';
import * as path from 'path';

const SEGMENT = 200;
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** 局部格 → 世界格（与 calcBuildingTrans 的经纬部分同源） */
function localToWorldGrid(
    area: AreaGridOrigin,
    p: { x: number; y: number }
) {
    return {
        latGrid: area.latitude + p.y,
        lonGrid: (area.longitude + p.x) * (area.segment / SEGMENT),
    };
}

function fixtureFiles() {
    return fs
        .readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => path.join(FIXTURES_DIR, f));
}

describe('区域坐标换算：光标格 ↔ 局部格必须是 calcBuildingTrans 的逆变换', () => {
    test('导入蓝图：把建筑端点的世界格反算回局部格，等于该建筑自己的 localOffset（经向按环形等价）', () => {
        let checked = 0;
        for (const file of fixtureFiles()) {
            const data = fromStr(fs.readFileSync(file, 'utf8').trim());
            const pos = findPosForAreas(data.areas, SEGMENT);
            const root = pos.areas[0];
            for (const b of data.buildings) {
                if (b.areaIndex !== 0) continue; // 放置只写根区域
                const target = b.localOffset[0];
                const w = localToWorldGrid(root, target);
                const back = planetToLocal(w.latGrid, w.lonGrid, root);
                // 经向是环形坐标（-1e-5 与 999.99999 是同一格），纬向是普通坐标
                const dLon = ((((back.x - target.x) % 1000) + 1500) % 1000) - 500;
                const context = `${path.basename(file)} index=${b.index}`;
                expect({ context, dLon: Math.abs(dLon) < 1e-6 }).toEqual({
                    context,
                    dLon: true,
                });
                expect({ context, dLat: Math.abs(back.y - target.y) < 1e-6 }).toEqual({
                    context,
                    dLat: true,
                });
                checked++;
            }
        }
        // 至少覆盖若干份真实蓝图里的大量建筑端点上
        expect(checked).toBeGreaterThan(100);
    });

    test('导入蓝图的根区域原点不是常数 -80：按 -80 换算会整体错开（回归根因）', () => {
        const data = fromStr(
            fs.readFileSync(path.join(FIXTURES_DIR, 'sample_outpost_ils.txt'), 'utf8').trim()
        );
        const root = findPosForAreas(data.areas, SEGMENT).areas[0];
        // size.y=6 → 原点纬度 -3，与自建画布（size.y=161 → -80）相差 77 格
        expect(data.areas[0].size.y).toBe(6);
        expect(root.latitude).toBe(-3);
        const building = data.buildings[0];
        const target = building.localOffset[0];
        const w = localToWorldGrid(root, target);
        const wrong = planetToLocal(w.latGrid, w.lonGrid, {
            ...root,
            latitude: -80,
        });
        // 旧实现：放置位置比光标偏北 77 格（≈27.7° 纬度），因此看起来"绿盒不听光标"
        expect(wrong.y - target.y).toBe(77);
    });

    test('工具自建画布（size.y=161）原点恰为 -80，与旧实现一致', () => {
        const bp = createEmptyBlueprint();
        const root = findPosForAreas(bp.areas, SEGMENT).areas[0];
        expect(root.latitude).toBe(-80);
        expect(planetToLocal(10, 20, root)).toEqual({ x: 20, y: 90 });
    });

    test('经向尺度：低段数区域的格更宽，按 1000 格/圈取模会错', () => {
        const root: AreaGridOrigin = { latitude: 0, longitude: 0, segment: 100 };
        // 区域经向 500 格/圈：全局第 250 格 = 区域第 125 格
        expect(planetToLocal(5, 250, root)).toEqual({ x: 125, y: 5 });
        // 环形回绕按区域一整圈（500）而不是 1000
        expect(planetToLocal(5, -250, root)).toEqual({ x: 375, y: 5 });
    });

    test('有原点偏移的区域：localToPlanet 与 planetToLocal 互为逆变换', () => {
        const area: AreaGridOrigin = { latitude: 37, longitude: 12, segment: 160 };
        for (const p of [
            { x: 0, y: 0 },
            { x: 1, y: 20 },
            { x: 399, y: -18 },
            { x: 799, y: 3 },
        ]) {
            const w = localToPlanet(p, area);
            const back = planetToLocal(w.lat, w.lon, area);
            expect(back.x).toBeCloseTo(p.x, 9);
            expect(back.y).toBeCloseTo(p.y, 9);
        }
    });
});
