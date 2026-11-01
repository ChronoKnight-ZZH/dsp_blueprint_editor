import { Matrix4 } from 'three';
import { findPosForAreas, calcBuildingTrans } from '@/blueprint/planet';
import type { BlueprintArea, BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { PLANET_RADIUS, PLANET_SEGMENT } from '@/planetConstants';
import { buildBVH } from '@/lib/core/buildBVH';

/**
 * `buildBVH` 的兜底行为。
 *
 * 背景：旧实现用 `buildingMeta.get(b.modelIndex)!` 断言，蓝图里只要有「有 GLB 但没有
 * 元数据」的模型（例如 117 轨道采集器）就会抛 TypeError，编辑器整页白屏。
 * 方案 §5 第 10 行要求改为退化矩阵占位，并汇总 `unknownModelIndexes`。
 */

function area(): BlueprintArea {
    return {
        index: 0,
        parentIndex: -1,
        tropicAnchor: 0,
        areaSegments: 200,
        anchorLocalOffset: { x: 0, y: 0 },
        size: { x: 1, y: 1 },
    };
}

let nextIndex = 0;

/** 造一个最小可用的建筑：只填 buildBVH 实际读取的字段 */
function makeBuilding(overrides: Partial<BlueprintBuilding> = {}): BlueprintBuilding {
    return {
        index: nextIndex++,
        areaIndex: 0,
        localOffset: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] as BlueprintBuilding['localOffset'],
        yaw: [0, 0] as BlueprintBuilding['yaw'],
        tilt: 0,
        itemId: 0,
        modelIndex: 0,
        outputObjIdx: -1,
        inputObjIdx: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        recipeId: 0,
        filterId: 0,
        parameters: null,
        ...overrides,
    };
}

/** 取一个有元数据的真实 modelIndex，避免测试依赖硬编码数字 */
function knownModelIndex(): number {
    const first = buildingMeta.keys().next();
    if (first.done === true)
        throw new Error('buildingMeta 为空，测试前提不成立');
    return first.value;
}

/** 取一个确定没有元数据的 modelIndex */
function unknownModelIndex(from = 900000): number {
    let i = from;
    while (buildingMeta.has(i))
        i++;
    return i;
}

function transformsOf(buildings: BlueprintBuilding[]): Matrix4[][] {
    const pos = findPosForAreas([area()], PLANET_SEGMENT);
    return buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b));
}

function bvhOf(buildings: BlueprintBuilding[]) {
    return buildBVH(transformsOf(buildings), buildings);
}

describe('buildBVH', () => {
    it('已知模型生成非退化选择盒', () => {
        const b = makeBuilding({ modelIndex: knownModelIndex() });
        const { bvh, unknownModelIndexes } = bvhOf([b]);

        expect(unknownModelIndexes).toEqual([]);
        expect(bvh.boxes).toHaveLength(1);
        expect(Math.abs(bvh.boxes[0].determinant())).toBeGreaterThan(0);
    });

    it('未知模型不抛错，放极小占位盒并记录 modelIndex', () => {
        const modelIndex = unknownModelIndex();
        const b = makeBuilding({ modelIndex });

        const run = () => bvhOf([b]);
        expect(run).not.toThrow();

        const { bvh, unknownModelIndexes } = run();
        expect(unknownModelIndexes).toEqual([modelIndex]);
        // 占位盒是「极小但非零」：零缩放会让 BVH 的包围盒退化成点并抛
        // `Unexpected empty box`（见 buildBVH 注释）
        expect(bvh.boxes[0].determinant()).toBeGreaterThan(0);
        expect(bvh.boxes[0].determinant()).toBeLessThan(1e-12);
        expect(bvh.boxes[0].elements[0]).toBeLessThan(1e-3);
    });

    it('多个未知模型去重并升序', () => {
        const first = unknownModelIndex();
        const second = unknownModelIndex(first + 1);
        const buildings = [
            makeBuilding({ modelIndex: first }),
            makeBuilding({ modelIndex: second }),
            makeBuilding({ modelIndex: first }),
        ];

        const { unknownModelIndexes } = bvhOf(buildings);
        expect(unknownModelIndexes).toEqual([first, second]);
    });

    it('选择盒数量与建筑数量一致（含未知模型占位）', () => {
        const buildings = [
            makeBuilding({ modelIndex: knownModelIndex() }),
            makeBuilding({ modelIndex: unknownModelIndex() }),
        ];
        const { bvh } = bvhOf(buildings);
        expect(bvh.boxes).toHaveLength(buildings.length);
    });
});
