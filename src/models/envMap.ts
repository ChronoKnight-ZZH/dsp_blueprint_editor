/**
 * 建筑材质用的中性环境反射。
 *
 * 为什么需要：GLB 的 glTF 材质默认 `metallicFactor = 1`，而场景里没有环境贴图时，
 * 金属材质只剩方向光的镜面高光，其余部分直接算成黑色 —— 这也正是贴了 `-s` 之后
 * 金属面「发黑」的根因。这里用 `PMREMGenerator` 从一张程序化的天空/地面渐变图
 * 生成环境反射，**不引入任何外部资源文件**。
 *
 * 只挂到建筑材质上（`material.envMap`），不改 `scene.environment`：
 * 行星本体、网格线等其它对象保持原来的明暗，避免整屏泛白。
 */

import {
    CanvasTexture,
    EquirectangularReflectionMapping,
    PMREMGenerator,
    SRGBColorSpace,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';

let buildingEnvironment: Texture | null = null;

/** 当前建筑材质使用的环境贴图（未初始化时为 null） */
export function getBuildingEnvironment(): Texture | null {
    return buildingEnvironment;
}

/** 由场景初始化处注入；传 null 表示关闭环境反射 */
export function setBuildingEnvironment(texture: Texture | null): void {
    buildingEnvironment = texture;
}

/**
 * 生成中性环境贴图：上方偏冷的天空、中间一圈亮地平线、下方偏暗的地面。
 * 这样金属面既能反射出亮度梯度，又不会带上明显的色偏。
 *
 * 失败（无 WebGL / PMREM 不支持）时返回 null，调用方按「无环境反射」降级。
 */
export function createNeutralEnvironment(renderer: WebGLRenderer): Texture | null {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        if (context === null)
            return null;

        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0.0, '#c9d6e5');   // 天顶
        gradient.addColorStop(0.42, '#f2f4f6');  // 高空散射
        gradient.addColorStop(0.5, '#dfe2e4');   // 地平线
        gradient.addColorStop(0.58, '#8b9096');  // 地面反射带
        gradient.addColorStop(1.0, '#33383d');   // 地面
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const source = new CanvasTexture(canvas);
        source.mapping = EquirectangularReflectionMapping;
        source.colorSpace = SRGBColorSpace;

        const pmrem = new PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const target = pmrem.fromEquirectangular(source);
        pmrem.dispose();
        source.dispose();

        return target.texture;
    }
    catch (e) {
        console.warn('[env] 中性环境贴图生成失败，建筑材质将没有环境反射', e);
        return null;
    }
}
