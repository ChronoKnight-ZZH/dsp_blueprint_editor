/**
 * DSP Blueprint Editor —— 无头蓝图渲染库的公共类型声明（**手写**）。
 *
 * 为什么不 `tsc --declaration` 直出：源码里的公共类型依赖 `@/blueprint/parser`、
 * `@/renderSettingsTypes` 这类内部别名，宿主工程没有 `@` 别名，直出会得到一串
 * 无法解析的 import。这里按发布面重写一遍，宿主只要装了 `three` 的类型就能用。
 *
 * 对应运行时导出（`src/lib/index.ts`）：
 *   BlueprintViewer / parseBlueprint / serializeBlueprint / configureAssetBaseUrl /
 *   setModelCacheEnabled / isModelCacheEnabled / calculateStatsList
 *
 * 本文件是**纯模块**声明，不写 `export as namespace`：
 * 产出的 ESM 里宿主按 `import('./dsp-blueprint-editor.esm.js')` 使用，
 * TS 会按同名规则解析到 `dsp-blueprint-editor.esm.d.ts`（与 `index.d.ts`
 * 内容相同）。`export as namespace` 会给全局注入 `DSPBlueprintEditor`，
 * 与宿主自己的全局声明交叉冲突，所以这里刻意不提供。
 */

import type { Matrix4, PerspectiveCamera } from 'three';

// ---------------------------------------------------------------- 渲染设置

/**
 * 增量预览动画模式。
 *
 * - `'auto'`（默认）：按设备能力判定（`prefers-reduced-motion` / 逻辑核数）；
 * - `'on'` / `'off'`：强制开关。`'off'` 时事件照常应用，只是不插值（直接跳到目标）。
 */
export type PreviewAnimationMode = 'auto' | 'on' | 'off';

/** 预览期坐标语义（后端 `coordinateSystem`） */
export type PreviewCoordinateSystem =
    | 'layout-grid-v1'
    | 'blueprint-area-local-v1'
    | (string & Record<never, never>);

/** 三维向量 */
export interface PreviewVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * Area 的两种历史形态（后端 T1 改为嵌套后，扁平字段仍在过渡期内兼容）：
 * 扁平 `anchorLocalOffsetX/Y` + `width/height`，或嵌套 `anchorLocalOffset{x,y}` + `size{x,y}`。
 */
export interface PreviewAreaLike {
    readonly index: number;
    readonly parentIndex?: number;
    readonly tropicAnchor?: number;
    readonly areaSegments: number;
    readonly anchorLocalOffsetX?: number;
    readonly anchorLocalOffsetY?: number;
    readonly width?: number;
    readonly height?: number;
    readonly anchorLocalOffset?: { readonly x: number; readonly y: number };
    readonly size?: { readonly x: number; readonly y: number };
}

/** 预览建筑：只依赖渲染必需字段，宿主可原样传自己的事件对象 */
export interface PreviewBuildingLike {
    readonly index?: number;
    /** 后端 T2 新增：是否为临时对象（缺失时按 `index === -1` 推断） */
    readonly isTemporary?: boolean;
    readonly itemId: number;
    readonly modelIndex: number;
    readonly areaIndex?: number;
    readonly localOffset: PreviewVec3;
    readonly localOffset2?: PreviewVec3;
    readonly yaw: number;
    readonly yaw2?: number;
    readonly tilt?: number;
    readonly tilt2?: number;
    readonly pitch?: number;
    readonly pitch2?: number;
    readonly inputObjectId?: string | null;
    readonly outputObjectId?: string | null;
    readonly inputFromSlot?: number;
    readonly outputToSlot?: number;
    readonly productionIndex?: number;
}

/** 三类操作；`remove` 不携带 building */
export type PreviewOperation =
    | { readonly type: 'add' | 'replace'; readonly objectId: string; readonly building: PreviewBuildingLike }
    | { readonly type: 'remove'; readonly objectId: string };

/** 一条增量事件（其余字段按需忽略） */
export interface PreviewDeltaEvent {
    readonly kind?: string;
    readonly protocolVersion?: number;
    readonly taskId?: string;
    readonly sequence?: number;
    readonly stage?: string;
    readonly message?: string;
    readonly coordinateSystem?: PreviewCoordinateSystem;
    readonly operations?: readonly PreviewOperation[];
    readonly areas?: readonly PreviewAreaLike[];
    readonly primaryAreaIndex?: number;
    readonly previewBatch?: unknown;
}

/** `beginPreview` 选项 */
export interface PreviewBeginOptions {
    /**
     * layout 阶段的投影方式：
     * - `'sphere'`（默认）：格坐标 → 经纬度投影到球面，按 bbox 自动居中/缩放（跨度 ≤ ~63°）
     * - `'plane'`：贴在锚点处的切平面（不绕球，永不穿极点）
     */
    projector?: 'sphere' | 'plane';
    /** 收敛时间常数 τ（毫秒）。默认 100 */
    settleMs?: number;
    /** 抖动抑制：新对象延迟多久才淡入（毫秒）。默认 120；`0` = 关闭 */
    enterDelayMs?: number;
    /** 抖动抑制：存活短于该值即被撤销的对象不出场（毫秒）。默认 120 */
    minLifeMs?: number;
}

/** 预览运行期统计（验收/诊断口径） */
export interface PreviewStats {
    readonly events: number;
    readonly operations: number;
    readonly droppedEvents: number;
    readonly unknownRemoves: number;
    readonly unknownReplaces: number;
    readonly alive: number;
    readonly fading: number;
    readonly peakAlive: number;
    readonly moving: number;
    readonly slots: number;
    readonly filteredByThrash: number;
    readonly coordinateSystem: PreviewCoordinateSystem | null;
    readonly lastIngestMs: number;
    readonly maxIngestMs: number;
    readonly disposed: boolean;
}

/** Viewer 暴露的渲染设置 */
export interface ViewerRenderSettings {
    readonly showRealModels: boolean;
    readonly texturesEnabled: boolean;
    readonly maxInstancesPerModel: number;
    /** 增量预览动画开关（运行时；省略等价 `'auto'`） */
    readonly previewAnimation?: PreviewAnimationMode;
}

/**
 * 设置读写端口。
 *
 * 与编辑器共用同一份设置时由宿主传入，例如：
 * ```ts
 * { read: () => renderSettings, write: patch => Object.assign(renderSettings, patch) }
 * ```
 */
export interface SettingsPort {
    read(): ViewerRenderSettings;
    /** 必须同步写回宿主 */
    write(patch: Partial<ViewerRenderSettings>): void;
}

// ---------------------------------------------------------------- 构造参数 / 回调

/** 3D 主题名。
 * `'editor'` 复刻编辑器当前观感（默认）；`'auto'` 跟随系统在 dark / light 间切换。
 */
export type ThemeName = 'dark' | 'light' | 'editor' | 'auto';

/** 3D 场景主题色 */
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

/** 容器解析与初始化选项 */
export interface ViewerOptions {
    /** 必填。元素或 CSS 选择器；选择器解析失败返回 `no-container` 错误 */
    container: HTMLElement | string;
    /** 初始设置；下面几个平铺字段是它的语法糖，同时给出时平铺字段优先 */
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    /** 增量预览动画开关（`'auto'` 默认 / `'on'` / `'off'`） */
    previewAnimation?: PreviewAnimationMode;
    /** 是否用 ResizeObserver 跟随容器尺寸。default true */
    autoResize?: boolean;
    /** 像素比。default min(devicePixelRatio, 2) */
    pixelRatio?: number;
    /** 键盘事件目标（相机平移/缩放快捷键）。default container */
    keyboardTarget?: HTMLElement | null;
    /** 加载成功后是否保留当前相机。default true */
    keepCamera?: boolean;
    /** 显式渲染宽度（给出后容器 resize 不再覆盖，直到 `resetSize()`） */
    width?: number;
    /** 显式渲染高度 */
    height?: number;
    /** 初始主题。default 'editor' */
    theme?: ThemeName;
    /** 设置读写端口；缺省用进程内存里的一份投影 */
    settingsPort?: SettingsPort;
}

/** 点击拾取命中的建筑：`index` 是数组下标，`id` 是蓝图里的建筑ID */
export interface BuildingPickPayload {
    index: number;
    id: number;
}

/** 场景重建原因 */
export interface RebuildInfo {
    reason: 'load' | 'settings' | 'data' | 'models';
    buildingCount: number;
    unknownModelIndexes: number[];
    durationMs: number;
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
    // JSON 导入
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
    // 查询
    | 'not-loaded'
    | 'building-not-found'
    | 'not-renderable'
    // 写操作（deleteBuilding）
    | 'invalid-argument';

export interface ViewerError {
    code: ViewerErrorCode;
    phase: ViewerErrorPhase;
    message: string;
    cause?: unknown;
}

/** 事件回调 */
export interface ViewerCallbacks {
    /** 点击拾取命中建筑；点空为 null */
    onBuildingSelect?(pick: BuildingPickPayload | null): void;
    /** 移除请求（Viewer 默认不开上下文移除，通常不会触发） */
    onBuildingRemove?(index: number): void;
    /** 相机变化；仅在真的变化的帧触发，同帧最多一次 */
    onCameraChange?(): void;
    /** 场景重建完成（含模型懒加载触发的重建） */
    onRebuild?(info: RebuildInfo): void;
    /** 统一错误通道；按 code+message 去重 */
    onError?(error: ViewerError): void;
}

// ---------------------------------------------------------------- 蓝图数据

export interface BlueprintArea {
    index: number;
    parentIndex: number;
    tropicAnchor: number;
    areaSegments: number;
    anchorLocalOffset: { x: number; y: number };
    size: { x: number; y: number };
}

/**
 * 蓝图里的单个建筑。
 *
 * 协议字段只列最常用的几个；`parameters` 因建筑类型而异，这里保持宽松类型，
 * 需要精细处理时按 `itemId` / `modelIndex` 自行收窄。
 */
export interface BlueprintBuilding {
    index: number;
    areaIndex: number;
    localOffset: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
    yaw: [number, number];
    tilt: number;
    itemId: number;
    modelIndex: number;
    outputObjIdx: number;
    inputObjIdx: number;
    outputToSlot: number;
    inputFromSlot: number;
    outputFromSlot: number;
    inputToSlot: number;
    outputOffset: number;
    inputOffset: number;
    recipeId: number;
    filterId: number;
    /** 建筑类型相关参数（不同 `itemId` 结构不同） */
    parameters: null | Record<string, unknown>;
    /** v2 body：分拣器附加位姿，字节级保留 */
    v2ExtraPose?: number[];
    /** v2 body：信标等建筑的自定义文本 */
    content?: string;
    /** v2 body：未知扩展字节，字节级保留 */
    extraBytes?: Uint8Array;
}

/** 解析后的蓝图数据（`parseBlueprint` 的返回值 / `serializeBlueprint` 的输入） */
export interface BlueprintData {
    header: {
        layout: number;
        icons: number[];
        time: Date;
        gameVersion: string;
        shortDesc: string;
        author: string;
        blueprintVersion: string;
        properties: string;
        desc: string;
    };
    version: number;
    cursorOffset: { x: number; y: number };
    cursorTargetArea: number;
    dragBoxSize: { x: number; y: number };
    primaryAreaIdx: number;
    areas: BlueprintArea[];
    buildings: BlueprintBuilding[];
    /** v2 body：建筑数组之后的预留 int32 */
    patch?: number;
    /** v2 body：地基数据（无地基时为 null） */
    reformData?: unknown | null;
    /** v2 body：地基数据之后的未知尾部字节 */
    tailExtraBytes?: Uint8Array;
}

// ---------------------------------------------------------------- 返回值

export interface BlueprintLoadResult {
    /** 建筑总数 */
    buildingCount: number;
    areas: BlueprintArea[];
    header: BlueprintData['header'];
    /** 缺少 buildingMeta 的 modelIndex：按隐藏占位处理，不参与拾取 */
    unknownModelIndexes: number[];
    /** 非致命问题（资源缺失等），已去重 */
    warnings: string[];
}

export type BlueprintLoadOutcome =
    | { ok: true; value: BlueprintLoadResult }
    | { ok: false; error: ViewerError };

/** 按建筑标识定位的结果；`selectBuilding(null)` 这类清除操作返回 `index: -1` */
export type BuildingLocateResult =
    | { ok: true; index: number }
    | { ok: false; error: ViewerError };

/** 多选建筑的结果：`indexes` 是命中的数组下标（已去重、保持传入顺序） */
export type BuildingsLocateResult =
    | { ok: true; indexes: number[] }
    | { ok: false; error: ViewerError };

/** 通用查询结果：与 `BlueprintLoadOutcome` 同构，便于宿主统一按 `ok` 收窄 */
export type ViewerQueryResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: ViewerError };

// ---------------------------------------------------------------- 批量删除

/**
 * 删除模式。
 *
 * - `0`：按 `itemId` 删除**全部同类建筑**；
 * - `1`：按**建筑 ID**（`BlueprintBuilding.index`，不是数组下标）删除指定建筑组。
 *
 * 注意：`mode=1` 的 ID 口径与 `selectBuilding(index)` 不同——后者是"数组下标优先、
 * 越界才按建筑 ID 兜底"。
 */
export type DeleteMode = 0 | 1;

/** `deleteBuilding` 成功时的载荷 */
export interface DeleteResult {
    /** 本次调用的模式 */
    mode: DeleteMode;
    /** 实际删除栋数（整批失败语义下恒 ≥ 1） */
    removed: number;
    /** 被删建筑的**原数组下标**（升序），供宿主对账 / 刷新 UI */
    indexes: number[];
}

/** `deleteBuilding` 的返回：复用通用查询结构，不新造同构联合 */
export type DeleteOutcome = ViewerQueryResult<DeleteResult>;

/** 按建筑下标返回的几何信息 */
export interface BuildingInfoPayload {
    /** 数组下标 */
    index: number;
    /** 建筑ID（`BlueprintBuilding.index`） */
    id: number;
    /** 建筑中心的世界矩阵 */
    matrix: Matrix4;
}

/** `focusBuilding` 的选项 */
export interface FocusOptions {
    /** 相机到建筑中心的距离（世界单位）。default `PLANET_RADIUS * 0.5 ≈ 100.1` */
    distance?: number;
    /** 是否同时选中该建筑。default true */
    select?: boolean;
}

// ---------------------------------------------------------------- 主类

/**
 * 无头蓝图渲染器（不含任何 UI，全部通过类实例方法控制）。
 *
 * 唯一的"写"能力是 `deleteBuilding` 纯 API（不涉及 3D 交互、UI 与撤销栈）。
 * 契约：**公开方法不抛异常**，失败通过 `{ ok: false, error }` 返回并经 `onError` 上报；
 * 失败时场景、相机与 `getBlueprintData()` 均保持上一次成功状态
 * （唯一例外：`deleteBuilding` 的"已删除但重建失败"分支）。
 */
export class BlueprintViewer {
    constructor(options: ViewerOptions, callbacks?: ViewerCallbacks);

    /** 从蓝图字符串加载（内部 trim；失败返回结构化错误） */
    loadBlueprint(str: string): BlueprintLoadOutcome;
    /** 直接注入已解析的数据（总是重建，不做引用比较） */
    loadBlueprintData(data: BlueprintData): BlueprintLoadOutcome;
    /** 从 JSON 文本导入（`Date` / `Uint8Array` 无损还原） */
    loadBlueprintJSON(text: string): BlueprintLoadOutcome;
    /** 导出为可读 JSON 文本（2 空格缩进）；未加载时返回 null */
    exportBlueprintJSON(): string | null;
    /** 最近一次**成功**加载的数据 */
    getBlueprintData(): BlueprintData | null;

    /** 重置相机到默认全局视角 */
    resetCamera(): void;

    /** 选中建筑（只点亮高亮盒，不动相机）；`null` 取消选中 */
    selectBuilding(index: number | null): BuildingLocateResult;
    /**
     * 批量选中建筑（多选高亮）；`null` 或空数组取消选中。
     * 任一建筑找不到时整次调用失败、原选中不变；返回去重后的命中下标。
     */
    selectedBuildings(indexes: number[] | null): BuildingsLocateResult;
    /** 镜头居中对齐到该建筑（不锁镜头）；`null` 等价 `resetCamera()` */
    focusBuilding(index: number | null, options?: FocusOptions): BuildingLocateResult;
    /** 当前选中建筑的数组下标（多选时返回第一项） */
    getSelectedIndex(): number | null;
    /** 当前选中的全部建筑数组下标 */
    getSelectedIndexes(): number[];
    /** 建筑信息（世界矩阵） */
    getBuildingInfo(index: number): ViewerQueryResult<BuildingInfoPayload>;

    /**
     * 批量删除建筑（**纯 API**，不经过 UI 与撤销栈）。
     *
     * - `mode=0`：`targets` 是 `itemId` 列表，删除这些 itemId 的**全部**建筑；
     * - `mode=1`：`targets` 是**建筑 ID**（`BlueprintBuilding.index`）列表，重复 ID 自动去重；
     * - **整批失败**：任一目标不存在时不执行删除、数据零变更（不做部分删除）；
     * - 成功后走既有重建通道，并清空选中态（数组下标已重排）；
     * - **共享引用**：`getBlueprintData()` 返回内部引用，删除是原地修改，宿主旧引用会一起变。
     *
     * 失败码：`already-disposed` / `not-loaded` / `invalid-argument` /
     * `building-not-found` / `build-failed`（后者 message 会注明"数据已变更"，建议重新加载）。
     */
    deleteBuilding(mode: DeleteMode, targets: number[]): DeleteOutcome;

    /** 相机对象（只读用途） */
    getCamera(): PerspectiveCamera | null;
    /** 相机版本号：仅在相机真的变化的帧自增 */
    getCameraVersion(): number;
    /** 渲染用 canvas */
    getCanvas(): HTMLCanvasElement | null;

    /** 显式设置渲染尺寸（此后容器 resize 不再覆盖） */
    setSize(w: number, h: number): void;
    /** 取消显式尺寸，恢复跟随容器 */
    resetSize(): void;

    /** 切换 3D 主题 */
    setTheme(theme: ThemeName): void;
    /** 在当前主题上覆盖若干颜色 */
    setCustomTheme(patch: Partial<ThemeColors>): void;
    /** 当前生效的主题色 */
    getTheme(): ThemeColors | null;

    /** 导出当前画面为 base64 PNG */
    toDataURL(): string | null;
    /** 导出当前画面为 Blob */
    toBlob(): Promise<Blob | null>;

    /** 更新渲染设置（`showRealModels` / `maxInstancesPerModel` 触发重建） */
    setRenderSettings(patch: Partial<ViewerRenderSettings>): void;
    /** 更新事件回调（默认**整体替换**；`{ merge: true }` 合并） */
    setCallbacks(cbs: ViewerCallbacks, opts?: { merge?: boolean }): void;

    // ---- 增量预览（preview-delta）

    /**
     * 开始一次增量预览（**先开始预览，再提交生成请求**，否则会漏开头的消息）。
     *
     * 预览层是独立临时层：不会清空当前正式场景（保留上一次成功结果）。
     */
    beginPreview(options?: PreviewBeginOptions): void;
    /**
     * 同步摄入一条 `preview-delta`（在 `onProgress` 回调里直接调用）。
     *
     * 返回 `true` 表示应用了内容；序号过期 / 非差量 / 已销毁返回 `false`。
     * **绝不抛错**——渲染异常在预览层内部吞掉，不影响生成流程。
     */
    applyPreviewDelta(event: PreviewDeltaEvent): boolean;
    /**
     * 预览收尾：用正式蓝图串替换（内部**先建后换**，避免大蓝图闪白）。
     */
    commitPreview(blueprint: string): BlueprintLoadOutcome;
    /** 丢弃预览层（生成失败 / 中止 / 用户离开页面时调用） */
    discardPreview(): void;
    /** 是否正在预览 */
    readonly previewing: boolean;
    /** 预览运行期统计（未预览时为 `null`） */
    previewStats(): PreviewStats | null;

    /** 销毁实例，释放资源（幂等） */
    dispose(): void;
}

// ---------------------------------------------------------------- 函数

/** 蓝图字符串 → 数据对象（解析失败**抛异常**，与 `viewer.loadBlueprint` 的返回式错误不同） */
export function parseBlueprint(str: string): BlueprintData;

/** 数据对象 → 蓝图字符串（`parseBlueprint` 的逆运算） */
export function serializeBlueprint(data: BlueprintData): string;

/**
 * 配置资产根地址（**仅库构建生效**；编辑器构建下资产 URL 由 webpack publicPath 决定）。
 *
 * @param baseUrl 库产物根目录（含 `models/` 与 `img/` 的那一级）；
 *                传 `null` / `''` 清除配置，回到自动探测。
 *
 * 默认行为（优先级从高到低）：
 * 1. ESM 产物自动取 `import.meta.url`（产物 chunk 自身 URL）所在目录 ——
 *    Vite dev / 原生 `<script type="module">` 下就是产物同目录，零配置；
 *    打包后指向宿主 chunk 目录，生产环境需把资产放到该目录或显式配置；
 * 2. UMD 产物自动取加载本库的 `<script src>` 所在目录；
 * 3. `document.baseURI` 兜底。
 *
 * 只有需要把资产放到别处（CDN、子路径）时才需要显式调用，例如：
 * `configureAssetBaseUrl('https://cdn.example.com/dsp/')`。
 */
export function configureAssetBaseUrl(baseUrl: string | null | undefined): void;

/**
 * 资产地址映射钩子：产物内相对路径（`models/smelter.glb`）→ 宿主已知的最终地址。
 *
 * 非空字符串即作为最终 URL 使用（跳过资产根拼接）；
 * 返回 `null` / `undefined` / 空串或抛错 → 回退默认拼接。
 */
export type AssetUrlMapper = (
    relativePath: string
) => string | null | undefined;

/**
 * 配置资产地址映射钩子（**仅库构建生效**）。
 *
 * 模型已经由宿主的打包器带内容哈希管理时用它：把「相对路径 → 实际地址」的映射
 * 交给库，模型 GLB、通道贴图、图标与 basis 目录的请求一次对齐，不必再往库产物里
 * 放一份 `models/`、`img/`。库内部只有 `resolveAssetUrl()` 会经过钩子；
 * 宿主自己的 `fetch` 不受影响。
 *
 * ```ts
 * const bundled: Record<string, string> = {
 *     'models/smelter.glb': new URL('./smelter-3f2a1b.glb', import.meta.url).href,
 * };
 * configureAssetUrlMapper((path) => bundled[path] ?? null);
 * ```
 *
 * @param mapper 映射函数；传 `null` / `undefined` 清除，回到默认拼接
 */
export function configureAssetUrlMapper(
    mapper: AssetUrlMapper | null | undefined
): void;

/**
 * 模型本地持久化缓存（Cache Storage）的运行时开关。
 *
 * 库构建默认**关闭**：库嵌在宿主页面里，存储属于宿主，不替宿主预写最多 ~128 MB
 * 的模型。需要「看过的模型断网也能显示」时，在创建 Viewer 之前调用一次：
 *
 * ```ts
 * setModelCacheEnabled(true);
 * ```
 *
 * 关闭（或浏览器不支持 Cache Storage）时，缓存操作全部变成**空操作**：
 * 读永远未命中、写永远失败、清单为空、清空 0 条，且不写宿主存储、不弹持久化授权。
 * 对调用方没有任何 API 差异（`loadBlueprint` 等照常工作，只是每次都走网络）。
 *
 * 开关的默认值来自构建配置 `config/persistence.config.js` 的 `lib` 字段。
 *
 * @param enabled `true` 开启；`false` 关闭；`null` 恢复成构建配置的值
 */
export function setModelCacheEnabled(enabled: boolean | null): void;

/** 持久化总开关当前是否打开（不含「浏览器是否支持」的判断） */
export function isModelCacheEnabled(): boolean;

// ---------------------------------------------------------------- 统计列表

/**
 * 统计列表的错误码。
 *
 * 与 `ViewerErrorCode` **刻意分离**：3D 生命周期错误（`no-container` 等）
 * 与统计列表的「入参/解析」错误语义不同，宿主不应混淆。
 */
export type StatsListErrorCode =
    | 'parse-failed'        // 蓝图字符串无法被 parseBlueprint 解析
    | 'invalid-accelerator' // acceleratorItem 不是 0/1/2/3
    | 'invalid-argument';   // input 既非 string 也非 BlueprintData，或数据形状不合法

export interface StatsListError {
    code: StatsListErrorCode;
    message: string;
    cause?: unknown;
}

/** 统计列表中的一条物品（name 取 itemsMap 的原文中文键、不翻译） */
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

/**
 * 蓝图统计列表：总耗电 / 需求 / 输出。
 *
 * 算法完全复用编辑器网页端的 `calculateProductionStats`（源码 `@/blueprint/stats`），
 * 这里只做「入参校验 + 结构转换 + 补物品名」：
 * - `demand` = `ItemStats.consumed`，`output` = `ItemStats.produced`；
 * - 同一 `itemId` 既产又耗时**两边各出现一次**，保真；`net` 不导出，宿主需要净量自行 `output - demand`；
 * - `name` 取 `itemsMap.get(itemId)?.name`（原文中文键、不翻译），查不到时 `"unknown"`；
 * - `totalPower` 单位 kW；`count` 单位「每分钟」；
 * - 字符串入参会先 `trim()` 再解析，与 `viewer.loadBlueprint` 一致。
 *
 * @param input 蓝图字符串（内部 `parseBlueprint`）或 `BlueprintData` 对象；
 *              对象形态接受最小 `{ buildings: [...] }`（与 `calculateProductionStats` 一致）
 * @param acceleratorItem 增产剂等级：`0` 无 / `1` 一级 / `2` 二级 / `3` 三级；省略等价 `0`
 * @returns `{ ok: true, value }` 或 `{ ok: false, error }`；**永不抛错**
 */
export function calculateStatsList(
    input: string | BlueprintData,
    acceleratorItem?: 0 | 1 | 2 | 3,
): StatsListResult;