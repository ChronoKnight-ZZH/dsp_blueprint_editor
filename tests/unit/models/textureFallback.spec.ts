import { DataTexture, SRGBColorSpace } from 'three';
import { missingAlbedoColor, missingAlbedoTexture } from '@/models/textureFallback';

describe('缺失底色贴图的纯色兜底 textureFallback', () => {
    it('显式指定表优先于启发式与默认值', () => {
        expect(missingAlbedoColor('space-capsule', '')).toBe(0xcdd2d8);
        expect(missingAlbedoColor('stone-wall', 'stone-wall')).toBe(0x7b776d);
        expect(missingAlbedoColor('belt-1', '')).toBe(0x3c4043);
    });

    it('材质名启发式：black / glass / water 各有专属色', () => {
        expect(missingAlbedoColor('turret-cannon', 'turret-cannon-black')).toBe(0x101216);
        expect(missingAlbedoColor('chemical-plant', 'chemical-plant-glass-back')).toBe(0xa8bcc4);
        expect(missingAlbedoColor('spray-coater', 'spray-coater-water')).toBe(0x2e6f8e);
        // 带空格的材质名也能命中（如 turret missile-black）
        expect(missingAlbedoColor('turret-missile', 'turret missile-black')).toBe(0x101216);
    });

    it('无任何线索时返回中性灰默认值', () => {
        expect(missingAlbedoColor('some-model', 'DefaultMaterial')).toBe(0x8f9498);
    });

    it('纯色贴图按颜色缓存，1×1 sRGB DataTexture', () => {
        const a = missingAlbedoTexture('space-capsule', '');
        expect(a).toBeInstanceOf(DataTexture);
        expect(a.colorSpace).toBe(SRGBColorSpace);
        expect(a.image.width).toBe(1);
        expect(a.image.height).toBe(1);
        // 同一颜色复用同一张贴图
        expect(missingAlbedoTexture('belt-2', '')).toBe(missingAlbedoTexture('belt-1', ''));
        // 颜色写入 RGBA 数据
        const data = a.image.data;
        expect([data[0], data[1], data[2], data[3]]).toEqual([0xcd, 0xd2, 0xd8, 255]);
    });
});
