/// <reference types="node" />
import { readdirSync } from 'fs';
import { join } from 'path';
import { buildingMeta } from '@/data/building';
import { itemsMap } from '@/data/items';
import { modelTransform, modelTransformOf, ZERO_MODEL_TRANSFORM } from '@/data/modelTransform';
import type { ModelTransform } from '@/data/modelTransform';
import { modelNameCandidates } from '@/models/glbAssets';

type NumericField = 'x' | 'y' | 'z' | 'pitch' | 'yaw' | 'roll';

const OFFSET_ROTATION_FIELDS: NumericField[] = ['x', 'y', 'z', 'pitch', 'yaw', 'roll'];

function isAllZero(t: ModelTransform): boolean {
    return OFFSET_ROTATION_FIELDS.every(f => t[f] === 0);
}

// ---------------------------------------------------------------- 磁盘上的真实模型

const MODEL_DIR = join(__dirname, '..', '..', '..', 'src', 'assets', 'icons', 'models');

/** 目录里真实存在的 .glb 文件名（不含扩展名） */
const diskModelNames = new Set(
    readdirSync(MODEL_DIR)
        .filter(f => /\.glb$/i.test(f))
        .map(f => f.replace(/\.glb$/i, '')),
);

/** modelIndex → 该模型号被哪些 item/变形引用（与运行时解析链一致） */
const refsByModel = new Map<number, { icon: string; variantIndex: number }[]>();
for (const item of itemsMap.values()) {
    for (let variantIndex = 0; variantIndex < item.models.length; variantIndex++) {
        const modelIndex = item.models[variantIndex];
        const list = refsByModel.get(modelIndex);
        const ref = { icon: item.icon, variantIndex };
        if (list === undefined)
            refsByModel.set(modelIndex, [ref]);
        else
            list.push(ref);
    }
}

/** 该 modelIndex 能否在磁盘上解析出真实模型文件（与运行时同一套候选规则） */
function hasRealModel(modelIndex: number): boolean {
    const refs = refsByModel.get(modelIndex) ?? [];
    return refs.some(ref =>
        modelNameCandidates(ref.icon, ref.variantIndex).some(name => diskModelNames.has(name)));
}

/**
 * 注意：这里**故意不断言具体调参值**。
 * `modelTransform` 是可视化标定用的活表，数值会随视觉校对反复调整，
 * 把 -10 / 90 / 180 这类具体数字写进断言只会让每次调参都亮红灯。
 * 本文件只保证「表的结构、覆盖范围与兜底行为」；数值是否正确由渲染层肉眼验收。
 */
describe('建筑模型变换表 modelTransform', () => {
    it('表里每一行都必须对应一个真实存在的 .glb（不给无模型建筑留行）', () => {
        const withoutModel = Object.keys(modelTransform)
            .map(Number)
            .filter(modelIndex => !hasRealModel(modelIndex));
        expect(withoutModel).toEqual([]);
    });

    it('与 buildingMeta 一一对应：62 个建筑全部有真实模型，也全部有配置行', () => {
        const tableKeys = Object.keys(modelTransform).map(Number).sort((a, b) => a - b);
        const metaKeys = Array.from(buildingMeta.keys()).sort((a, b) => a - b);
        expect(tableKeys).toEqual(metaKeys);
        expect(tableKeys).toHaveLength(62);

        const metaWithoutModel = metaKeys.filter(modelIndex => !hasRealModel(modelIndex));
        expect(metaWithoutModel).toEqual([]);
    });

    it('每一行都写满 6 个有限数值（不靠 undefined 兜底）', () => {
        for (const [key, t] of Object.entries(modelTransform)) {
            for (const f of OFFSET_ROTATION_FIELDS) {
                const v = t[f];
                expect(`${key}.${f}=${typeof v}/${Number.isFinite(v)}`)
                    .toBe(`${key}.${f}=number/true`);
            }
        }
    });

    it('旋转量在合理区间内（度，|v| <= 360），不会误填弧度或离谱数', () => {
        for (const [key, t] of Object.entries(modelTransform)) {
            for (const f of ['pitch', 'yaw', 'roll'] as const) {
                expect(`${key}.${f}=${Math.abs(t[f]) <= 360}`).toBe(`${key}.${f}=true`);
            }
        }
    });

    it('偏移量在合理区间内（格，|v| <= 100）', () => {
        for (const [key, t] of Object.entries(modelTransform)) {
            for (const f of ['x', 'y', 'z'] as const) {
                expect(`${key}.${f}=${Math.abs(t[f]) <= 100}`).toBe(`${key}.${f}=true`);
            }
        }
    });

    it('至少有一个建筑被标定过（防止整张表被误清空）', () => {
        const nonZero = Object.values(modelTransform).filter(t => !isAllZero(t));
        expect(nonZero.length).toBeGreaterThan(0);
    });

    it('未登记的 modelIndex 返回全 0 且不抛错', () => {
        expect(modelTransformOf(999999)).toBe(ZERO_MODEL_TRANSFORM);
        expect(isAllZero(ZERO_MODEL_TRANSFORM)).toBe(true);
    });

    it('表的键都能在 buildingMeta 里找到元数据', () => {
        for (const key of Object.keys(modelTransform)) {
            expect(buildingMeta.has(Number(key))).toBe(true);
        }
    });
});
