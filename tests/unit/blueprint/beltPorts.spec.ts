import { fromStr } from '@/blueprint/parser';
import { findPosForAreas } from '@/blueprint/planet';
import { isBelt } from '@/data/items';
import {
    beltPortAt,
    portWorldNormal,
    portWorldOffset,
} from '@/data/beltPorts';
import * as fs from 'fs';
import * as path from 'path';

const SEGMENT = 200;
const TOOLS = path.resolve(__dirname, '..', '..', 'tools');
const FIXTURES = path.join(__dirname, 'fixtures');

/** yaw → 网格方向（与 beltLine 的 DIR_YAW 一致：+y=0、+x=90、-y=180、-x=270） */
function yawOfDir(x: number, y: number): number {
    if (y > 0) return 0;
    if (x > 0) return 90;
    if (y < 0) return 180;
    return 270;
}

function angleDiff(a: number, b: number): number {
    const d = Math.abs(((a - b) % 360) + 360) % 360;
    return d > 180 ? 360 - d : d;
}

const SAMPLE_FILES = [
    path.join(TOOLS, '传送带连接建筑_串联.txt'),
    path.join(TOOLS, '物流塔连接传送带.txt'),
    path.join(TOOLS, '传送带连接建筑_并联.txt'),
    path.join(FIXTURES, 'sample_outpost_ils.txt'),
    path.join(FIXTURES, 'sample_throughput.txt'),
    path.join(FIXTURES, 'same_buildings_v2.txt'),
    path.join(FIXTURES, 'dense_splitters_v1.txt'),
    path.join(FIXTURES, 'facilities_with_foundation_320.txt'),
    path.join(FIXTURES, 'starting_base_01029.txt'),
];

describe('beltPorts：建筑传送带口标定表', () => {
    test('样本里每个"带↔建筑"连接都能用口表复现带端位置与朝向', () => {
        let checked = 0;
        const worst: Record<string, number> = {};
        for (const file of SAMPLE_FILES) {
            if (!fs.existsSync(file)) continue;
            const data = fromStr(fs.readFileSync(file, 'utf8').trim());
            const pos = findPosForAreas(data.areas, SEGMENT);
            for (const b of data.buildings) {
                if (isBelt(b.itemId)) continue;
                const rel = data.buildings.filter(
                    (o) =>
                        isBelt(o.itemId) &&
                        (o.outputObjIdx === b.index || o.inputObjIdx === b.index)
                );
                if (rel.length === 0) continue;
                const area = pos.areas[b.areaIndex];
                const lat =
                    (area.latitude + b.localOffset[0].y) *
                    ((2 * Math.PI) / (SEGMENT * 5));
                const cosLat = Math.cos(lat);
                const yaw = b.yaw[0];
                for (const o of rel) {
                    const isFeed = o.outputObjIdx === b.index;
                    const slot = isFeed ? o.outputToSlot : o.inputFromSlot;
                    const port = beltPortAt(b.itemId, b.modelIndex, slot);
                    expect({
                        file: path.basename(file),
                        index: b.index,
                        slot,
                        hasPort: port !== null,
                    }).toEqual({
                        file: path.basename(file),
                        index: b.index,
                        slot,
                        hasPort: true,
                    });
                    if (!port) continue;
                    const off = portWorldOffset(port, yaw, cosLat);
                    const key = `${b.itemId}|${b.modelIndex}|${slot}`;
                    const dx = Math.abs(o.localOffset[0].x - (b.localOffset[0].x + off.x));
                    const dy = Math.abs(o.localOffset[0].y - (b.localOffset[0].y + off.y));
                    const dz = Math.abs(o.localOffset[0].z - off.z);
                    const err = Math.max(dx, dy, dz);
                    worst[key] = Math.max(worst[key] ?? 0, err);
                    // 口坐标容差 0.15 格（部分样本的带端会沿面横向偏 ~0.12 格）
                    expect({
                        key,
                        ok: err <= 0.15,
                    }).toEqual({ key, ok: true });
                    // 朝向：取出 = 沿口法线离开；送入 = 沿其反向进入
                    const n = portWorldNormal(port, yaw);
                    const expectYaw = isFeed
                        ? yawOfDir(-n.x, -n.y)
                        : yawOfDir(n.x, n.y);
                    expect({
                        key,
                        yaw: angleDiff(o.yaw[0], expectYaw) <= 1,
                    }).toEqual({ key, yaw: true });
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(20);
        // 供人工查看最大偏差（控制台输出）
        const worstKey = Object.entries(worst).sort((a, b) => b[1] - a[1])[0];
        expect(worstKey[1]).toBeLessThanOrEqual(0.15);
    });

    test('分流器的口分两层：接 z=1 的口时带端也在 z=1', () => {
        const data = fromStr(
            fs.readFileSync(path.join(TOOLS, '传送带连接建筑_串联.txt'), 'utf8').trim()
        );
        const splitter39 = data.buildings.find(
            (b) => b.itemId === 2020 && b.modelIndex === 39
        )!;
        expect(splitter39).toBeDefined();
        // 一字形分流器：0/2 在地面层、1/3 在上一层
        expect(beltPortAt(2020, 39, 0)!.z).toBe(0);
        expect(beltPortAt(2020, 39, 1)!.z).toBe(1);
        expect(beltPortAt(2020, 39, 2)!.z).toBe(0);
        expect(beltPortAt(2020, 39, 3)!.z).toBe(1);
        // 实际带端：slot 1 的带 z=1
        const elevated = data.buildings.find(
            (o) => isBelt(o.itemId) && o.inputObjIdx === splitter39.index && o.inputFromSlot === 1
        )!;
        expect(elevated.localOffset[0].z).toBeCloseTo(1, 3);
    });

    test('物流站口表：12 口环绕向与法线（+y 面 0/1/2、-x 面 3/4/5、-y 面 6/7/8、+x 面 9/10/11）', () => {
        for (const itemId of [2103, 2104]) {
            const model = itemId === 2103 ? 49 : 50;
            const r = Math.abs(beltPortAt(itemId, model, 0)!.x);
            expect(beltPortAt(itemId, model, 0)!.y).toBeCloseTo(2.15, 2);
            expect(r).toBeGreaterThanOrEqual(1);
            expect(beltPortAt(itemId, model, 1)!.x).toBeCloseTo(0, 3);
            expect(beltPortAt(itemId, model, 1)!.ny).toBe(1);
            expect(beltPortAt(itemId, model, 4)!.nx).toBe(-1);
            expect(beltPortAt(itemId, model, 7)!.ny).toBe(-1);
            expect(beltPortAt(itemId, model, 10)!.nx).toBe(1);
        }
    });
});
