import { Matrix4 } from 'three';
import { findPosForAreas, calcBuildingTrans } from '@/planet/planet';
import type { BlueprintArea, BlueprintBuilding } from '@/blueprint/parser';
import { BVH } from '@/bvh/bvh';
import { buildingMeta } from '@/data/building';
import { PLANET_RADIUS, PLANET_SEGMENT } from '@/planet/planetConstants';
import type { ViewerRenderSettings } from '@/render/renderSettingsTypes';
import { buildBVH } from '@/lib/core/buildBVH';
import { describeBuild } from '@/lib/core/describeBuild';
import type { BuildStats } from '@/lib/core/types';

/**
 * `describeBuild` 是阶段 A 的**可证伪基线**（方案 §7.1 出口条件 2）。
 * 它把构建产物压成纯数据，因此不需要 WebGL 就能做快照与一致性断言。
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

function knownModelIndex(): number {
    const first = buildingMeta.keys().next();
    if (first.done === true)
        throw new Error('buildingMeta 为空');
    return first.value;
}

function unknownModelIndex(from = 900000): number {
    let i = from;
    while (buildingMeta.has(i))
        i++;
    return i;
}

const SETTINGS: ViewerRenderSettings = {
    showRealModels: true,
    texturesEnabled: true,
    maxInstancesPerModel: Infinity,
};

function emptyStats(overrides: Partial<BuildStats> = {}): BuildStats {
    return {
        buildingCount: 0,
        glbGroupCount: 0,
        glbInstanceCount: 0,
        fallbackBoxCount: 0,
        hiddenCount: 0,
        unknownModelIndexes: [],
        iconCount: 0,
        subscriptCount: 0,
        cargoCount: 0,
        perModelGlbCounts: {},
        ...overrides,
    };
}

function describeOf(buildings: BlueprintBuilding[], statsOverrides: Partial<BuildStats> = {}) {
    const pos = findPosForAreas([area()], PLANET_SEGMENT);
    const transforms = buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b));
    const { bvh, unknownModelIndexes } = buildBVH(transforms, buildings);
    const stats = emptyStats({
        buildingCount: buildings.length,
        unknownModelIndexes,
        hiddenCount: unknownModelIndexes.length,
        ...statsOverrides,
    });
    return describeBuild({ settings: SETTINGS, buildings, bvh, stats });
}

describe('describeBuild', () => {
    it('空蓝图产出空描述', () => {
        const d = describeOf([]);
        expect(d.buildingCount).toBe(0);
        expect(d.perModelIndex).toEqual({});
        expect(d.glbGroups).toEqual([]);
        expect(d.selectBoxes).toEqual([]);
        expect(d.unknownModelIndexes).toEqual([]);
    });

    it('统计每个 modelIndex 的建筑数，未知模型计入 hidden', () => {
        const known = knownModelIndex();
        const unknown = unknownModelIndex();
        const buildings = [
            makeBuilding({ modelIndex: known }),
            makeBuilding({ modelIndex: known }),
            makeBuilding({ modelIndex: unknown }),
        ];

        const d = describeOf(buildings);
        expect(d.buildingCount).toBe(3);
        expect(d.perModelIndex[known].total).toBe(2);
        expect(d.perModelIndex[unknown].total).toBe(1);
        expect(d.perModelIndex[unknown].hidden).toBe(1);
        expect(d.unknownModelIndexes).toEqual([unknown]);
    });

    it('走 GLB 的实例从 fallback 中扣除', () => {
        const known = knownModelIndex();
        const buildings = [
            makeBuilding({ modelIndex: known }),
            makeBuilding({ modelIndex: known }),
            makeBuilding({ modelIndex: known }),
        ];

        // 假设前两个走了 GLB
        const d = describeOf(buildings, {
            glbInstanceCount: 2,
            glbGroupCount: 1,
            perModelGlbCounts: { [known]: 2 },
        });

        expect(d.perModelIndex[known].total).toBe(3);
        expect(d.perModelIndex[known].glb).toBe(2);
        expect(d.perModelIndex[known].fallback).toBe(1);
        expect(d.glbGroups).toEqual([{ modelIndex: known, count: 2 }]);
    });

    it('selectBoxes 与建筑数量一一对应，且矩阵已归一化', () => {
        const buildings = [
            makeBuilding({ modelIndex: knownModelIndex() }),
            makeBuilding({ modelIndex: knownModelIndex() }),
        ];
        const d = describeOf(buildings);
        expect(d.selectBoxes).toHaveLength(2);
        for (const elements of d.selectBoxes) {
            expect(elements).toHaveLength(16);
            // 归一化后的数值不应有超过 6 位小数的浮点噪声
            for (const v of elements)
                expect(Math.round(v * 1e6) / 1e6).toBe(v);
        }
    });

    it('同一输入两次调用结果稳定（快照可复现）', () => {
        const buildings = [makeBuilding({ modelIndex: knownModelIndex() })];
        expect(describeOf(buildings)).toEqual(describeOf(buildings));
    });

    it('settings 原样带出，便于定位「哪个设置下的渲染」', () => {
        const d = describeOf([]);
        expect(d.settings).toEqual(SETTINGS);
    });
});

describe('BVH 与 describeBuild 的 selectBoxes 一致', () => {
    it('describeBuild 不会改动传入的 BVH', () => {
        const buildings = [makeBuilding({ modelIndex: knownModelIndex() })];
        const pos = findPosForAreas([area()], PLANET_SEGMENT);
        const transforms = buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b));
        const bvh = new BVH(transforms.map(t => new Matrix4().copy(t[0])));
        const before = bvh.boxes.map(m => [...m.elements]);

        describeBuild({
            settings: SETTINGS,
            buildings,
            bvh,
            stats: emptyStats({ buildingCount: 1 }),
        });

        expect(bvh.boxes.map(m => [...m.elements])).toEqual(before);
    });
});
