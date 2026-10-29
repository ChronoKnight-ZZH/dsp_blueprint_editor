/// <reference types="node" />
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    DEFAULT_MODEL_MATERIAL_TUNING,
    METALNESS_WITHOUT_SPEC_MAP,
    modelMaterialTunings,
    resolveModelMaterialTuning,
} from '@/models/modelMaterialTuning';
import { manifestTextureFiles, materialMapUrls } from '@/models/textureManifest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MODELS_DIR = join(REPO_ROOT, 'src', 'assets', 'icons', 'models');

const diskModelNames = readdirSync(MODELS_DIR)
    .filter(f => /\.glb$/i.test(f))
    .map(f => f.replace(/\.glb$/i, ''))
    .sort();

describe('建筑材质贴图清单 textureManifest', () => {
    it('清单里引用的贴图文件都还在磁盘上（清理贴图时不许误删正在用的）', () => {
        const missing = manifestTextureFiles.filter(rel => !existsSync(join(REPO_ROOT, 'src', rel)));
        expect(missing).toEqual([]);
    });

    it('清单键的模型名都能对上磁盘上真实存在的 .glb', () => {
        const known = new Set(diskModelNames);
        const unknown = Object.keys(materialMapUrls)
            .map(key => key.split('::')[0])
            .filter(name => !known.has(name));
        expect(unknown).toEqual([]);
    });

    it('每个条目至少带一张通道贴图，且 URL 非空字符串', () => {
        for (const [key, urls] of Object.entries(materialMapUrls)) {
            const values = [urls.normal, urls.emissive, urls.spec].filter(v => v !== undefined);
            expect(`${key} maps=${values.length}`).not.toBe(`${key} maps=0`);
            for (const value of values)
                expect(typeof value).toBe('string');
        }
    });

    it('清单规模与当前资产一致（法线/自发光/spec 覆盖 69 个材质、161 张图）', () => {
        const entries = Object.values(materialMapUrls);
        expect(entries).toHaveLength(69);
        expect(entries.filter(e => e.normal !== undefined)).toHaveLength(67);
        expect(entries.filter(e => e.emissive !== undefined)).toHaveLength(61);
        expect(entries.filter(e => e.spec !== undefined)).toHaveLength(69);
        expect(manifestTextureFiles).toHaveLength(161);
    });
});

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
