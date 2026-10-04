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
    test('远处成簇建筑：区域收缩为两建筑区间（左右上下各留一格边距）', () => {
        // 在经向 950/960、赤道（纬向 0 → 画布 y=80）放两个建筑
        const bp = makeBp([{ x: 950, y: 80 }, { x: 960, y: 80 }]);
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual({ x: 13, y: 3 });
        expect(out.areas[0].anchorLocalOffset).toEqual({ x: 0, y: 0 });
        expect(out.dragBoxSize).toEqual({ x: 13, y: 3 });
        expect(out.cursorOffset).toEqual({ x: 6, y: 1 });
        expect(out.buildings.map(b => b.localOffset[0].x)).toEqual([1, 11]);
        expect(out.buildings.map(b => b.localOffset[0].y)).toEqual([1, 1]);
        // 原数据不被修改
        expect(bp.areas[0].size).toEqual({ x: 10, y: 161 });
        expect(bp.buildings[0].localOffset[0]).toEqual({ x: 950, y: 80, z: 0 });
    });

    test('跨越 0 经线：取最小覆盖弧（左右各留一格边距）', () => {
        const bp = makeBp([{ x: 990, y: 80 }, { x: 10, y: 80 }]);
        const out = fromStr(toStr(bp));
        // 经向环形距离 21（990→0→10），而非 981；左右各加一格边距 → 23
        expect(out.areas[0].size).toEqual({ x: 23, y: 3 });
        expect(out.buildings.map(b => b.localOffset[0].x)).toEqual([1, 21]);
    });

    test('北半球建筑：纬向按赤道居中约束收缩（上方留一格边距）', () => {
        // blat 10 / 20（画布 y = 90 / 100）
        const bp = makeBp([{ x: 100, y: 90 }, { x: 100, y: 100 }]);
        const out = fromStr(toStr(bp));
        // 根区域必须居中于赤道：lat=-21，覆盖 [-21, 22)；x 方向左右各留一格 → 3
        expect(out.areas[0].size).toEqual({ x: 3, y: 43 });
        expect(out.buildings.map(b => b.localOffset[0].y)).toEqual([31, 41]);
    });

    test('单个建筑：3x3 区域（四周各留一格边距）', () => {
        const bp = makeBp([{ x: 500, y: 80 }]);
        const out = fromStr(toStr(bp));
        expect(out.areas[0].size).toEqual({ x: 3, y: 3 });
        expect(out.buildings[0].localOffset[0]).toEqual({ x: 1, y: 1, z: 0 });
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
