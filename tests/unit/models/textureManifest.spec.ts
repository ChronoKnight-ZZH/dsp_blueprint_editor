/// <reference types="node" />
import { readdirSync } from 'fs';
import { join } from 'path';
import {
    DEFAULT_MODEL_MATERIAL_TUNING,
    METALNESS_WITHOUT_SPEC_MAP,
    modelMaterialTunings,
    resolveModelMaterialTuning,
} from '@/models/modelMaterialTuning';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MODELS_DIR = join(REPO_ROOT, 'src', 'assets', 'icons', 'models');

const diskModelNames = readdirSync(MODELS_DIR)
    .filter(f => /\.glb$/i.test(f))
    .map(f => f.replace(/\.glb$/i, ''))
    .sort();

// 通道贴图（-n/-e/-s）已全部内嵌进 GLB（KTX2），textureManifest 现为空清单，
// 对应断言已移除；如需灰度回滚到「外部贴图」方案，从
// tests/unit/scripts/texture-mapping.json 重新生成即可。

describe('建筑材质参数表 modelMaterialTuning', () => {
    it('每个真实存在的 .glb 都有一条可调参数（不留默认兜底的黑盒模型）', () => {
        const missing = diskModelNames.filter(name => modelMaterialTunings[name] === undefined);
        expect(missing).toEqual([]);
    });

    it('参数表里没有已经不存在的模型（防止模型删了参数还挂着）', () => {
        const known = new Set(diskModelNames);
        const stale = Object.keys(modelMaterialTunings).filter(name => !known.has(name));
        expect(stale).toEqual([]);
    });

    it('三个参数都是有限数值且在合理区间内', () => {
        for (const [name, tuning] of Object.entries(modelMaterialTunings)) {
            const resolved = resolveModelMaterialTuning(name);
            expect(`${name}.emissiveIntensity=${Number.isFinite(resolved.emissiveIntensity)}`).toBe(`${name}.emissiveIntensity=true`);
            expect(`${name}.envMapIntensity=${Number.isFinite(resolved.envMapIntensity)}`).toBe(`${name}.envMapIntensity=true`);
            expect(`${name}.metalness=${Number.isFinite(resolved.metalness)}`).toBe(`${name}.metalness=true`);
            expect(resolved.emissiveIntensity).toBeGreaterThanOrEqual(0);
            expect(resolved.emissiveIntensity).toBeLessThanOrEqual(10);
            expect(resolved.envMapIntensity).toBeGreaterThanOrEqual(0);
            expect(resolved.envMapIntensity).toBeLessThanOrEqual(10);
            expect(resolved.metalness).toBeGreaterThanOrEqual(0);
            expect(resolved.metalness).toBeLessThanOrEqual(1);
            expect(tuning).toBeDefined();
        }
    });

    it('未登记的模型返回默认值，且默认值本身合法', () => {
        const fallback = resolveModelMaterialTuning('__not_a_model__');
        expect(fallback).toBe(DEFAULT_MODEL_MATERIAL_TUNING);
        expect(METALNESS_WITHOUT_SPEC_MAP).toBeGreaterThan(0);
        expect(METALNESS_WITHOUT_SPEC_MAP).toBeLessThanOrEqual(1);
    });
});
