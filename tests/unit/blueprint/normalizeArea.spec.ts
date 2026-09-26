import { fromStr, toStr } from '@/blueprint/parser';
import { createBuilding, createEmptyBlueprint } from '@/blueprint/create';
import * as fs from 'fs';
import * as path from 'path';

/** 模拟编辑器创建流程：空蓝图 + 依次放置建筑（localOffset 为编辑器画布坐标） */
function makeBp(offsets: { x: number, y: number }[]) {
    const bp = createEmptyBlueprint();
    for (const o of offsets) {
        const b = createBuilding(2101, 0, o, 0); // 储物仓
        b.index = bp.buildings.length;
        bp.buildings.push(b);
    }
    return bp;
}

describe('normalizeBlueprintAreas：创建建筑生成蓝图时收缩到最远两建筑区间', () => {
    test('远处成簇建筑：区域收缩为两建筑区间', () => {
        // 在经向 950/960、赤道（纬向 0 → 画布 y=80）放两个建筑
        const bp = makeBp([{ x: 950, y: 80 }, { x: 960, y: 80 }]);
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual({ x: 11, y: 1 });
        expect(out.areas[0].anchorLocalOffset).toEqual({ x: 0, y: 0 });
        expect(out.dragBoxSize).toEqual({ x: 11, y: 1 });
        expect(out.cursorOffset).toEqual({ x: 5, y: 0 });
        expect(out.buildings.map(b => b.localOffset[0].x)).toEqual([0, 10]);
        expect(out.buildings.map(b => b.localOffset[0].y)).toEqual([0, 0]);
        // 原数据不被修改
        expect(bp.areas[0].size).toEqual({ x: 10, y: 161 });
        expect(bp.buildings[0].localOffset[0]).toEqual({ x: 950, y: 80, z: 0 });
    });

    test('跨越 0 经线：取最小覆盖弧', () => {
        const bp = makeBp([{ x: 990, y: 80 }, { x: 10, y: 80 }]);
        const out = fromStr(toStr(bp));
        // 经向环形距离 21（990→0→10），而非 981
        expect(out.areas[0].size).toEqual({ x: 21, y: 1 });
        expect(out.buildings.map(b => b.localOffset[0].x)).toEqual([0, 20]);
    });

    test('北半球建筑：纬向按赤道居中约束收缩', () => {
        // blat 10 / 20（画布 y = 90 / 100）
        const bp = makeBp([{ x: 100, y: 90 }, { x: 100, y: 100 }]);
        const out = fromStr(toStr(bp));
        // 根区域必须居中于赤道：lat=-20，覆盖 [-20, 21)
        expect(out.areas[0].size).toEqual({ x: 1, y: 41 });
        expect(out.buildings.map(b => b.localOffset[0].y)).toEqual([30, 40]);
    });

    test('单个建筑：1x1 区域', () => {
        const bp = makeBp([{ x: 500, y: 80 }]);
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual({ x: 1, y: 1 });
        expect(out.buildings[0].localOffset[0]).toEqual({ x: 0, y: 0, z: 0 });
    });

    test('空蓝图：保持初始区域不变', () => {
        const bp = createEmptyBlueprint();
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual({ x: 10, y: 161 });
    });

    test('导入的蓝图（dragBoxSize 非 0）不受影响', () => {
        const raw = fs.readFileSync(
            path.resolve(__dirname, 'fixtures', 'same_buildings_v2.txt'), 'utf8').trim();
        const bp = fromStr(raw);
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual(bp.areas[0].size);
        expect(out.dragBoxSize).toEqual(bp.dragBoxSize);
    });
});
