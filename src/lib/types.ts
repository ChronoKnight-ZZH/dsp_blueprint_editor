import type { BlueprintArea, BlueprintData } from '@/blueprint/parser';
import type { ViewerRenderSettings } from '@/renderSettingsTypes';

/**
 * 公开类型定义。
 *
 * 设置类型复用 `@/renderSettingsTypes`（纯类型、不 import vue），
 * 保证 `src/lib/**` 整体不依赖 Vue（方案 D1）。
 */
export type { ViewerRenderSettings } from '@/renderSettingsTypes';

/** 容器解析与初始化选项 */
export interface ViewerOptions {
    /** 必填。元素或 CSS 选择器；选择器解析失败返回 `no-container` 错误 */
    container: HTMLElement | string;
    /**
     * 初始设置。省略字段取默认值（showRealModels=true / texturesEnabled=true / maxInstancesPerModel=Infinity）。
     * 下面的三个平铺字段是它的语法糖，同时给出时平铺字段优先。
     */
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    /** 是否用 ResizeObserver 跟随容器尺寸。default true */
    autoResize?: boolean;
    /** 像素比。default: min(devicePixelRatio, 2) */
    pixelRatio?: number;
    /** 键盘事件目标（相机平移/缩放的快捷键）。default: container */
    keyboardTarget?: HTMLElement | null;
    /** `loadBlueprint` 成功后是否保留当前相机。default false → 自动回到默认视角 */
    keepCamera?: boolean;
    /**
     * 设置读写端口。缺省时使用进程内存中的一份投影；
     * 与编辑器共用同一份设置时由宿主传入（见方案 §4.2）。
     */
    settingsPort?: SettingsPort;
}

/**
 * 设置读写端口。
 *
 * 与编辑器共用的典型实现：
 * ```ts
 * { read: () => renderSettings, write: p => Object.assign(renderSettings, p) }
 * ```
 */
export interface SettingsPort {
    read(): ViewerRenderSettings;
    /** 必须同步写回宿主；编辑器场景下会连带触发 `persistRenderSettings()` */
    write(patch: Partial<ViewerRenderSettings>): void;
}

/** 事件回调 */
export interface ViewerCallbacks {
    /** 点击拾取：返回建筑在 `BlueprintData.buildings` 中的下标；点空返回 null */
    onBuildingSelect?(index: number | null): void;
    /** 右键剔除以外的移除请求（仅 `contextRemove` 开启时；Viewer 默认不开） */
    onBuildingRemove?(index: number): void;
    /** 相机变化。仅在 `controls.update()` 返回 true 的帧触发，同一帧最多一次 */
    onCameraChange?(): void;
    /** 场景重建完成（含模型懒加载触发的重建） */
    onRebuild?(info: RebuildInfo): void;
    /** 统一错误通道：致命错误必报一次，非致命警告按 code+message 去重 */
    onError?(error: ViewerError): void;
}

export interface RebuildInfo {
    reason: 'load' | 'settings' | 'data' | 'models';
    buildingCount: number;
    unknownModelIndexes: number[];
    durationMs: number;
}

export interface BlueprintLoadResult {
    /** 建筑总数 */
    buildingCount: number;
    areas: BlueprintArea[];
    header: BlueprintData['header'];
    /** 缺少 buildingMeta 的 modelIndex：已按隐藏占位处理，不参与拾取 */
    unknownModelIndexes: number[];
    /** 非致命问题（资源缺失等），已去重 */
    warnings: string[];
}

export type ViewerErrorPhase = 'parse' | 'position' | 'build' | 'lifecycle';

export type ViewerErrorCode =
    // 解析阶段
    | 'invalid-start'
    | 'header-too-short'
    | 'checksum-missing'
    | 'checksum-mismatch'
    | 'buffer-overflow'
    | 'parse-failed'
    // JSON 导入（loadBlueprintJSON / parseBlueprintJSON）
    | 'json-syntax'
    | 'json-shape'
    // 定位阶段
    | 'no-root-area'
    | 'no-longitude'
    | 'inconsistent-area'
    // 构建阶段
    | 'build-failed'
    // 生命周期
    | 'no-container'
    | 'no-webgl'
    | 'already-disposed'
    // 查询（selectBuilding / focusBuilding）
    | 'not-loaded'
    | 'building-not-found';

/** 按建筑 id 定位的结果 */
export interface BuildingLocateResult {
    ok: boolean;
    /** 命中的数组下标（成功时） */
    index?: number;
    /** 失败原因 */
    error?: ViewerError;
}

export interface ViewerError {
    code: ViewerErrorCode;
    phase: ViewerErrorPhase;
    message: string;
    cause?: unknown;
}

export type BlueprintLoadOutcome =
    | { ok: true; value: BlueprintLoadResult }
    | { ok: false; error: ViewerError };
