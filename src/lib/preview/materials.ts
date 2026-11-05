/**
 * 预览材质：在**克隆出来**的材质上注入 per-instance 透明度。
 *
 * 两个关键决定（都有实测依据，见 `data/4. 多份源文件体检报告与契约问题清单.md`）：
 *
 * 1. **必须克隆**。GLB 材质来自缓存、被最终场景的 `InstancedMesh` 共享
 *    （`src/models/glbInstances.ts` 明确标了 `sharedResource`）。直接改共享材质会
 *    污染正式场景，而且 `reapplyLoadedModelMaterials()` 重贴图时还会冲掉注入。
 * 2. **用抖动（dither）而不是混合**。实测单场景峰值 32,581 个实例；若走
 *    `transparent = true`，3 万个半透明实例的排序与过绘制会直接压垮填充率。
 *    抖动保持在不透明通道里：片元按屏幕坐标算一个稳定阈值，`aOpacity < 阈值` 直接
 *    `discard`，视觉上是颗粒化淡入淡出，代价只是噪点而不失帧。
 */

import type {
    Material,
    WebGLProgramParametersWithUniforms,
} from "three";

/** 注入版本号；改了注入逻辑必须改它，否则旧 program 会被复用 */
const PROGRAM_KEY = "dsp-preview-fade-v1";

/** 顶点着色器注入：把实例属性传给片元 */
const VERTEX_ATTR = "attribute float aOpacity;\nvarying float vAOpacity;\n";

/** 片元着色器注入：按屏幕坐标抖动剔除 */
const FRAGMENT_ATTR = "varying float vAOpacity;\n";

const DITHER = `
    if ( vAOpacity < 1.0 ) {
        float dspDither = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        if ( vAOpacity <= dspDither ) discard;
    }
`;

function inject(shader: WebGLProgramParametersWithUniforms): void {
    shader.vertexShader = VERTEX_ATTR + shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vAOpacity = aOpacity;`
    );
    shader.fragmentShader =
        FRAGMENT_ATTR +
        shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `#include <dithering_fragment>${DITHER}`
        );
}

/**
 * 克隆一个材质并注入透明度。
 *
 * 返回新对象，调用方负责 dispose（`PreviewLayer.discard` 会统一释放）。
 * 材质数组按元素逐个克隆，保持原有分组语义。
 */
export function cloneFadeMaterial(
    source: Material | Material[]
): Material | Material[] {
    if (Array.isArray(source))
        return source.map((m) => cloneFadeMaterial(m) as Material);

    const clone = source.clone();
    clone.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        inject(shader);
    };
    clone.customProgramCacheKey = () => PROGRAM_KEY;
    // 材质克隆后不参与引擎的自动更新（透明度由我们直接写 attribute）
    clone.needsUpdate = true;
    return clone;
}
