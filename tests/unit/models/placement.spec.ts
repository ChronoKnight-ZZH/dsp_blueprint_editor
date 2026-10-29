import { Box3, Group, Matrix4, Vector3 } from 'three';
import { buildingMeta } from '@/data/building';
import { ZERO_MODEL_TRANSFORM } from '@/data/modelTransform';
import type { ModelTransform } from '@/data/modelTransform';
import { buildModelPlacement, resolveBuildingModel } from '@/models/buildingModel';
import type { LoadedGlbModel } from '@/models/glbLoader';

/**
 * 这里刻意**不读** `modelTransform` 表里的调参值：变换通过 `transformOverride`
 * 显式注入，测的是「矩阵算得对不对」，而不是「表里那个数是多少」。
 * 这样你随时调整参数，测试都不会红；参数填错由浏览器验收。
 */

/** 假模型：2×2×2 立方体，包围盒中心在原点，因此“盒心”就是原点 */
function fakeModel(): LoadedGlbModel {
    return {
        name: 'fake',
        url: 'models/fake.glb',
        scene: new Group(),
        bbox: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
    };
}

const GRID_HORIZONTAL = 2 * Math.PI / 200 / 5 * 200.2;
const GRID_VERTICAL = 4 / 3;

function transform(partial: Partial<ModelTransform>): ModelTransform {
    return { ...ZERO_MODEL_TRANSFORM, ...partial };
}

/** 用指定变换给某建筑算放置矩阵（元数据取自真实表，保证盒心/高度是真实值） */
function placementOf(modelIndex: number, partial: Partial<ModelTransform> = {}): Matrix4 {
    return buildModelPlacement(fakeModel(), buildingMeta.get(modelIndex), modelIndex, transform(partial));
}

/** 变换后模型局部 +X 轴在世界里的单位方向 */
function forwardAxis(m: Matrix4): Vector3 {
    return new Vector3(1, 0, 0).transformDirection(m).normalize();
}

/** 模型包围盒中心（原点）被放到了哪里 */
function centerOf(m: Matrix4): Vector3 {
    return new Vector3(0, 0, 0).applyMatrix4(m);
}

describe('GLB 放置矩阵', () => {
    it('全 0 变换：不旋转，中心落在元数据盒心', () => {
        const m = placementOf(62); // 电弧熔炉
        const axis = forwardAxis(m);
        expect(axis.x).toBeCloseTo(1, 6);
        expect(axis.y).toBeCloseTo(0, 6);

        const [cx, cy, cz] = buildingMeta.get(62)!.boxCenter;
        const center = centerOf(m);
        expect(center.x).toBeCloseTo(cx, 6);
        expect(center.y).toBeCloseTo(cy, 6);
        expect(center.z).toBeCloseTo(cz, 6);
    });

    it('Yaw=90：模型 +X 转到 +Y', () => {
        const axis = forwardAxis(placementOf(62, { yaw: 90 }));
        expect(axis.x).toBeCloseTo(0, 6);
        expect(axis.y).toBeCloseTo(1, 6);
        expect(axis.z).toBeCloseTo(0, 6);
    });

    it('Yaw=180：模型 +X 翻到 -X', () => {
        const axis = forwardAxis(placementOf(62, { yaw: 180 }));
        expect(axis.x).toBeCloseTo(-1, 6);
        expect(axis.y).toBeCloseTo(0, 6);
    });

    it('Pitch 绕 X、Roll 绕 Y 各自生效', () => {
        // Pitch 绕 X：模型的 +Z（经 y-up→z-up 后指向 -Y）随 pitch 变化
        const upAfter = (pitch: number) =>
            new Vector3(0, 0, 1).transformDirection(placementOf(62, { pitch })).normalize();

        expect(upAfter(0).y).toBeCloseTo(-1, 6);
        expect(Math.abs(upAfter(90).z)).toBeCloseTo(1, 6);
        expect(upAfter(180).y).toBeCloseTo(1, 6);

        // Roll 绕 Y：模型 +X 应转到 ±Z
        const axisAfterRoll = forwardAxis(placementOf(62, { roll: 90 }));
        expect(Math.abs(axisAfterRoll.z)).toBeCloseTo(1, 6);
    });

    it('z 偏移按「格」换算：n 格 = n × 4/3 世界单位', () => {
        const modelIndex = 62;
        const [, , cz] = buildingMeta.get(modelIndex)!.boxCenter;

        const noOffset = centerOf(placementOf(modelIndex, { z: 0 })).z;
        const sink10 = centerOf(placementOf(modelIndex, { z: -10 })).z;
        const rise3 = centerOf(placementOf(modelIndex, { z: 3 })).z;

        expect(noOffset).toBeCloseTo(cz, 6);
        expect(noOffset - sink10).toBeCloseTo(10 * GRID_VERTICAL, 6);
        expect(rise3 - noOffset).toBeCloseTo(3 * GRID_VERTICAL, 6);
    });

    it('没有可用模型时：回退元数据表，且完全忽略表里的偏移/旋转', () => {
        // jest 环境没有 require.context → 所有建筑都解析不到模型
        // 69 在表里写着 yaw:180，但没有模型时必须一个都不生效
        const r = resolveBuildingModel(69);

        expect(r.glb).toBeNull();
        expect(r.glbName).toBeNull();
        expect(r.source).toBe('meta');
        expect(r.meta).toBeDefined();
        // 单位矩阵 = 不做任何变换；回退方块走的是 meta.unitBoxTrans，与本表无关
        expect(r.placement.equals(new Matrix4())).toBe(true);
    });

    it('放置计算不修改元数据表（元数据盒 / 回退渲染不受本表影响）', () => {
        const meta = buildingMeta.get(62)!;
        const unitBoxBefore = meta.unitBoxTrans.clone();
        const selectBoxBefore = meta.selectUnitBoxTrans.clone();
        const centerBefore = [...meta.boxCenter];
        const sizeBefore = [...meta.boxSize];

        buildModelPlacement(fakeModel(), meta, 62, transform({ z: -10, yaw: 90, x: 3 }));

        expect(meta.unitBoxTrans.equals(unitBoxBefore)).toBe(true);
        expect(meta.selectUnitBoxTrans.equals(selectBoxBefore)).toBe(true);
        expect([...meta.boxCenter]).toEqual(centerBefore);
        expect([...meta.boxSize]).toEqual(sizeBefore);
    });

    it('x/y 偏移按「格」换算，且不受 yaw 影响', () => {
        const modelIndex = 62;
        const [cx, cy] = buildingMeta.get(modelIndex)!.boxCenter;

        const plain = centerOf(placementOf(modelIndex, { x: 5, y: -2 }));
        expect(plain.x - cx).toBeCloseTo(5 * GRID_HORIZONTAL, 6);
        expect(plain.y - cy).toBeCloseTo(-2 * GRID_HORIZONTAL, 6);

        // 加了 yaw 之后，偏移量仍然沿建筑格子的 x/y 走
        const rotated = centerOf(placementOf(modelIndex, { x: 5, y: -2, yaw: 90 }));
        expect(rotated.x - cx).toBeCloseTo(5 * GRID_HORIZONTAL, 6);
        expect(rotated.y - cy).toBeCloseTo(-2 * GRID_HORIZONTAL, 6);
    });

    it('格换算系数：水平 ≈1.2579、垂直 =4/3', () => {
        expect(GRID_VERTICAL).toBeCloseTo(4 / 3, 9);
        expect(GRID_HORIZONTAL).toBeCloseTo(2 * Math.PI / 200 / 5 * 200.2, 9);
        expect(GRID_HORIZONTAL).toBeGreaterThan(1.2);
        expect(GRID_HORIZONTAL).toBeLessThan(1.3);
    });

    it('62 个建筑 × 几种典型变换都能算出有限矩阵', () => {
        const combos: Partial<ModelTransform>[] = [
            {},
            { yaw: 90 },
            { yaw: 180, z: -10 },
            { pitch: 90, roll: -45, x: 2, y: 3, z: 1 },
        ];
        for (const modelIndex of buildingMeta.keys()) {
            for (const c of combos) {
                const m = placementOf(modelIndex, c);
                for (const v of m.elements)
                    expect(Number.isFinite(v)).toBe(true);
            }
        }
    });
});
