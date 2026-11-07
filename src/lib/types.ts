import type { Matrix4 } from "three";
import type { BlueprintArea, BlueprintData } from "@/blueprint/parser";
import type { ViewerRenderSettings } from "@/renderSettingsTypes";
import type { PreviewAnimationMode } from "./preview/types";

/**
 * 公开类型定义。
 *
 * 设置类型复用 `@/renderSettingsTypes`（纯类型、不 import vue），
 * 保证 `src/lib/**` 整体不依赖 Vue（方案 D1）。
 */
export type { ViewerRenderSettings } from "@/renderSettingsTypes";

/** 增量预览（preview-delta）的公开类型，宿主可原样转发自己的事件对象 */
export type {
    PreviewAnimationMode,
    PreviewBeginOptions,
    PreviewBuildingLike,
    PreviewCoordinateSystem,
    PreviewDeltaEvent,
    PreviewOperation,
    PreviewStats,
    PreviewVec3,
} from "./preview/types";

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
    /**
     * 增量预览动画开关（外部端 / MES 端的运行时控制）。
     *
     * `'auto'`（默认）按设备能力判定；`'on'` / `'off'` 强制。
     * 与 `initialSettings.previewAnimation` 等价，同时给出时本字段优先。
     */
    previewAnimation?: PreviewAnimationMode;
    /** 是否用 ResizeObserver 跟随容器尺寸。default true */
    autoResize?: boolean;
    /** 像素比。default: min(devicePixelRatio, 2) */
    pixelRatio?: number;
    /** 键盘事件目标（相机平移/缩放的快捷键）。default: container */
    keyboardTarget?: HTMLElement | null;
    /**
     * 加载成功后是否保留当前相机。
     *
     * **default true**（对齐 v1：换蓝图不清相机，由宿主自己决定何时 `resetCamera()`）；
     * 传 `false` 回到「每次加载后自动回默认视角」的旧行为。
     */
    keepCamera?: boolean;
    /**
     * 显式渲染尺寸（对齐 v1 的 `width` / `height` 构造参数）。
     *
     * 省略时跟随容器；一旦给出，构造后会调 `setSize(w, h)`，
     * 之后的容器 resize **不再**覆盖它，直到宿主调用 `resetSize()` 恢复跟随容器。
     */
    width?: number;
    height?: number;
    /**
     * 初始 3D 主题。
     *
     * `'editor'` 复刻编辑器当前观感（灰白星球 + 天光/星空背景），是默认主题；
     * `'auto'` 跟随系统 `prefers-color-scheme` 在 `'dark'` / `'light'` 之间切换。
     * default `'editor'`。
     */
    theme?: ThemeName;
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

/**
 * 点击拾取命中的建筑。
 *
 * 同时给两种标识：`index` 是 `BlueprintData.buildings` 的数组下标（决定选择盒 / BVH / 聚焦），
 * `id` 是 `BlueprintBuilding.index`（蓝图里写在建筑记录里的稳定标识）。
 */
export interface BuildingPickPayload {
    index: number;
    id: number;
}

/** 按建筑下标返回的几何信息（对齐 v1 的 `getBuildingInfo` 返回值） */
export interface BuildingInfoPayload {
    /** 数组下标 */
    index: number;
    /** 建筑ID（`BlueprintBuilding.index`） */
    id: number;
    /** 建筑中心的世界矩阵；GLB 建筑是锚点矩阵，回退盒是实例矩阵 */
    matrix: Matrix4;
}

/**
 * 3D 场景主题名。
 *
 * - `'editor'`：复刻编辑器当前观感（灰白星球、白色经纬网格、黑底 + 天光/星空），默认主题
 * - `'dark'` / `'light'`：对齐 v1 的两套纯色板主题
 * - `'auto'`：跟随系统在 `'dark'` / `'light'` 之间切换
 */
export type ThemeName = "dark" | "light" | "editor" | "auto";

/** 3D 场景主题色（对齐 v1 的 `ThemeColors`） */
export interface ThemeColors {
    /** 场景背景色（three 的 24 位色值） */
    sceneBackground: number;
    /** 星球球体颜色 */
    planet: number;
    /** 经纬网格颜色 */
    grid: number;
    /** 图标角标文字填充色（CSS 颜色字符串） */
    textFill: string;
    /** 图标角标文字描边色 */
    textStroke: string;
}

/** 事件回调 */
export interface ViewerCallbacks {
    /**
     * 点击拾取：建筑在 `BlueprintData.buildings` 中的下标 + 建筑ID；点空返回 null。
     *
     * 打印由宿主自己负责（库内不写日志），例如：
     * `onBuildingSelect: pick => pick && console.log('buildingId=', pick.id)`
     */
    onBuildingSelect?(pick: BuildingPickPayload | null): void;
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
    reason: "load" | "settings" | "data" | "models";
    buildingCount: number;
    unknownModelIndexes: number[];
    durationMs: number;
}

export interface BlueprintLoadResult {
    /** 建筑总数 */
    buildingCount: number;
    areas: BlueprintArea[];
    header: BlueprintData["header"];
    /** 缺少 buildingMeta 的 modelIndex：已按隐藏占位处理，不参与拾取 */
    unknownModelIndexes: number[];
    /** 非致命问题（资源缺失等），已去重 */
    warnings: string[];
}

export type ViewerErrorPhase = "parse" | "position" | "build" | "lifecycle";

export type ViewerErrorCode =
    // 解析阶段
    | "invalid-start"
    | "header-too-short"
    | "checksum-missing"
    | "checksum-mismatch"
    | "buffer-overflow"
    | "parse-failed"
    // JSON 导入（loadBlueprintJSON / parseBlueprintJSON）
    | "json-syntax"
    | "json-shape"
    // 定位阶段
    | "no-root-area"
    | "no-longitude"
    | "inconsistent-area"
    // 构建阶段
    | "build-failed"
    // 生命周期
    | "no-container"
    | "no-webgl"
    | "already-disposed"
    // 查询（selectBuilding / focusBuilding / getBuildingInfo）
    | "not-loaded"
    | "building-not-found"
    /** 建筑存在，但没有可渲染矩阵（未知 modelIndex 的占位盒在球心），无法定位 */
    | "not-renderable";

/**
 * 按建筑标识定位的结果（`selectBuilding` / `focusBuilding`）。
 *
 * 成功时 `index` 是命中的**数组下标**；`selectBuilding(null)` 这类「清除」操作返回 `index: -1`。
 */
export type BuildingLocateResult =
    | { ok: true; index: number }
    | { ok: false; error: ViewerError };

/**
 * 多选建筑的定位结果。
 *
 * 成功时 `indexes` 是命中的**数组下标**（已去重、保持传入顺序）；
 * 传 `null` 或空数组清除选中时返回 `indexes: []`。
 */
export type BuildingsLocateResult =
    | { ok: true; indexes: number[] }
    | { ok: false; error: ViewerError };

/** 通用查询结果：与 `BlueprintLoadOutcome` 同构，便于宿主统一按 `ok` 收窄 */
export type ViewerQueryResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: ViewerError };

/**
 * `focusBuilding` 的选项。
 *
 * 语义：把相机搬到「建筑中心 + 建筑法线 × distance」并看向球心，
 * 建筑因此精确落在画面中心（「镜头居中对齐」）。
 *
 * **聚焦不锁镜头**：控件目标点始终是球心，聚焦之后滚轮缩放（= 改变离地高度）、
 * 拖拽旋转、平移都照常工作。
 */
export interface FocusOptions {
    /**
     * 相机到**建筑中心**的距离（≈ 离地高度，世界单位）。
     *
     * default `PLANET_RADIUS * 0.5 ≈ 100.1`（约为旧版 1.04R ≈ 208 的一半）。
     * 受控件约束的下限：`|camera| ≥ minDistance = 1.04R`，即传入小于 `0.04R ≈ 8` 时
     * 会被抬到「贴地最近处」。
     */
    distance?: number;
    /** 是否同时选中该建筑（点亮高亮盒）。default true */
    select?: boolean;
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


// ---- 统计列表（calculateStatsList） ----
// 与 @/blueprint/stats 的 ItemStats / ProductionStats 的关系：
// - 算法完全复用 calculateProductionStats，这里只做「入参校验 + 结构转换 + 补物品名」；
// - ItemStats 的 produced/consumed 分别在下面拆成 output/demand（同一 itemId 两边各出现一次，保真）；
// - ItemStats 的 net 字段不导出，宿主需要净量自行 output - demand。

/** 统计列表的错误码（与 ViewerErrorCode 分离，避免污染 3D 生命周期语义） */
export type StatsListErrorCode =
    | "parse-failed"        // 蓝图字符串无法被 fromStr 解析
    | "invalid-accelerator" // acceleratorItem 不是 0/1/2/3
    | "invalid-argument";   // input 既非 string 也非 BlueprintData，或数据形状不合法

export interface StatsListError {
    code: StatsListErrorCode;
    message: string;
    cause?: unknown;
}

/** 统计列表中的一条物品（name 取 itemsMap.get(itemId).name，原文中文键、不翻译） */
export interface StatsListItem {
    itemId: number;
    name: string;
    /** 每分钟数量（与 calculateProductionStats 的 produced/consumed 同口径） */
    count: number;
}

export interface StatsListValue {
    /** 总功耗，kW（同 ProductionStats.totalPower） */
    totalPower: number;
    /** 需求（= ItemStats.consumed），按 count 降序 */
    demand: StatsListItem[];
    /** 输出（= ItemStats.produced），按 count 降序 */
    output: StatsListItem[];
}

/** 统计列表的公开返回（与 ViewerQueryResult 同构，便于宿主统一按 ok 收窄） */
export type StatsListResult =
    | { ok: true; value: StatsListValue }
    | { ok: false; error: StatsListError };