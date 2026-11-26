/**
 * 渲染设置的**纯类型定义**（不含任何运行时依赖，尤其不 import vue）。
 *
 * 为什么单独一个文件：`materialTextures` / `glbLoader` / `src/lib/core/**` 都需要
 * 知道「贴图设置长什么样」，但它们不能 import `@/renderSettings`——那个模块
 * `import { reactive } from 'vue'`，会把 Vue 带进本应纯 TS 的渲染内核（见方案 D1）。
 *
 * 关系：`@/renderSettings` 的 `RenderSettings` **结构上满足**本文件的
 * `TextureSettings` 与 `ViewerRenderSettings`，因此 reactive 单例可以直接当参数传。
 */

import type { PreviewAnimationMode } from "@/lib/preview/types";

/** 贴图通道开关（与 `src/renderSettings.ts` 的 `TextureChannel` 一致） */
export interface TextureChannelSwitches {
    readonly albedo: boolean;
    readonly normal: boolean;
    readonly spec: boolean;
    readonly emissive: boolean;
    readonly effect: boolean;
    readonly dirt: boolean;
    readonly glass: boolean;
}

/** 材质贴图挂载所需的设置（`materialTextures.ts` 用） */
export interface TextureSettings {
    readonly texturesEnabled: boolean;
    readonly textures: TextureChannelSwitches;
}

/** Viewer 暴露的设置（`BlueprintViewer` / `RenderCore` 用） */
export interface ViewerRenderSettings {
    readonly showRealModels: boolean;
    readonly texturesEnabled: boolean;
    readonly maxInstancesPerModel: number;
    /**
     * 增量预览动画（外部端 / MES 端的**运行时**开关，见 `src/lib/preview/types.ts`）。
     *
     * - `auto`（默认）：按设备能力判定（`prefers-reduced-motion` / 核数）；
     * - `on` / `off`：强制开关。`off` 时事件照常应用，只是不插值（直接跳到目标）。
     *
     * 声明为可选：宿主用旧类型定义构造的对象仍然合法，省略等价于 `auto`。
     */
    readonly previewAnimation?: PreviewAnimationMode;
}

/** 渲染内核与 Viewer 都能用的完整设置（编辑器传的就是 `@/renderSettings` 的 reactive 单例） */
export type FullRenderSettings = TextureSettings & ViewerRenderSettings;
