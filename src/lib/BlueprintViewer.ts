import type { PerspectiveCamera } from "three";
import type { BlueprintData } from "@/blueprint/parser";
import { fromStr } from "@/blueprint/parser";
import type { ViewerRenderSettings } from "@/renderSettingsTypes";
import { RenderCore, RenderPhaseError } from "./core/RenderCore";
import type { RebuildReason } from "./core/RenderCore";
import {
    JSONImportError,
    parseBlueprintJSON,
    stringifyBlueprintJSON,
} from "./blueprintJSON";
import type {
    BlueprintLoadOutcome,
    BlueprintLoadResult,
    BuildingInfoPayload,
    BuildingLocateResult,
    FocusOptions,
    SettingsPort,
    ThemeColors,
    ThemeName,
    ViewerCallbacks,
    ViewerError,
    ViewerErrorCode,
    ViewerErrorPhase,
    ViewerOptions,
    ViewerQueryResult,
} from "./types";

/** 默认设置：与 `@/renderSettings` 的默认值保持一致 */
const DEFAULT_SETTINGS: ViewerRenderSettings = {
    showRealModels: true,
    texturesEnabled: true,
    maxInstancesPerModel: Infinity,
};

/** 进程内存中的默认 SettingsPort（单实例使用） */
class LocalSettingsPort {
    private value: ViewerRenderSettings;
    constructor(initial: Partial<ViewerRenderSettings>) {
        this.value = { ...DEFAULT_SETTINGS, ...initial };
    }
    read(): ViewerRenderSettings {
        return this.value;
    }
    write(patch: Partial<ViewerRenderSettings>): void {
        this.value = { ...this.value, ...patch };
    }
}

/**
 * 错误消息 → 结构化 code。
 *
 * 解析器的报错文案是既有的（`parser.ts` / `planet.ts`），这里做前缀映射，
 * 让宿主能区分「用户可修的输入问题」与「内部缺陷」，也便于本地化。
 */
function classifyError(e: unknown, phase: ViewerErrorPhase): ViewerError {
    // 重建错误自带阶段标记（position / build），优先采信
    if (e instanceof RenderPhaseError)
        return classifyError(e.original, e.phase);

    // JSON 导入错误自带 code（json-syntax / json-shape）
    if (e instanceof JSONImportError)
        return { code: e.code, phase: "parse", message: e.message, cause: e };

    const message = e instanceof Error ? e.message : String(e);
    const cause = e;

    const parseRules: [string, ViewerErrorCode][] = [
        ["Invalid start", "invalid-start"],
        ["Header too short", "header-too-short"],
        ["Checksum not found", "checksum-missing"],
        ["Checksum mismatch", "checksum-mismatch"],
        ["overflow", "buffer-overflow"],
        ["out of range", "buffer-overflow"],
    ];
    if (phase === "parse") {
        for (const [needle, code] of parseRules) {
            if (message.includes(needle))
                return { code, phase, message, cause };
        }
        return { code: "parse-failed", phase, message, cause };
    }

    const positionRules: [string, ViewerErrorCode][] = [
        ["No root area", "no-root-area"],
        ["No suitable longitude", "no-longitude"],
        ["same segments as its parent", "inconsistent-area"],
        ["anchorLocalOffsetY", "inconsistent-area"],
    ];
    if (phase === "position") {
        for (const [needle, code] of positionRules) {
            if (message.includes(needle))
                return { code, phase, message, cause };
        }
    }

    return {
        code: "build-failed",
        phase: phase === "build" ? "build" : phase,
        message,
        cause,
    };
}

/** 解析容器参数 */
function resolveContainer(container: HTMLElement | string): HTMLElement | null {
    if (typeof container !== "string") return container;
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(container);
}

/**
 * 只读蓝图渲染器（方案 D3：本轮仅源码引用）。
 *
 * 与编辑器共用 `src/lib/core/` 的渲染内核，但不含地基、放置/删除/预览等编辑态。
 * 契约：**公开方法不抛异常**，失败通过 `{ ok: false, error }` 返回并经 `onError` 上报；
 * 失败时场景、相机与 `getBlueprintData()` 均保持上一次成功状态。
 */
export class BlueprintViewer {
    private readonly port: SettingsPort;
    private readonly core: RenderCore | null;
    private readonly keepCamera: boolean;
    private callbacks: ViewerCallbacks;

    private data: BlueprintData | null = null;
    private disposed = false;
    /** 初始化失败原因（例如选择器找不到元素）：之后所有操作返回该错误 */
    private initError: ViewerError | null = null;
    private warnings = new Set<string>();

    constructor(options: ViewerOptions, callbacks?: ViewerCallbacks) {
        this.callbacks = callbacks ?? {};
        // 对齐 v1：加载后默认保留当前相机（宿主自己决定何时 resetCamera）
        this.keepCamera = options.keepCamera !== false;

        // 平铺字段是 initialSettings 的语法糖；用条件展开构造，
        // 避免对 `ViewerRenderSettings` 的 readonly 属性做赋值（TS2540）
        const flatInitial: Partial<ViewerRenderSettings> = {
            ...(options.showRealModels !== undefined
                ? { showRealModels: options.showRealModels }
                : {}),
            ...(options.texturesEnabled !== undefined
                ? { texturesEnabled: options.texturesEnabled }
                : {}),
            ...(options.maxInstancesPerModel !== undefined
                ? { maxInstancesPerModel: options.maxInstancesPerModel }
                : {}),
        };

        const initial = { ...(options.initialSettings ?? {}), ...flatInitial };
        this.port = options.settingsPort ?? new LocalSettingsPort(initial);

        const el = resolveContainer(options.container);
        if (el === null) {
            this.initError = {
                code: "no-container",
                phase: "lifecycle",
                message: `找不到容器元素：${String(options.container)}`,
            };
            this.core = null;
            this.reportError(this.initError);
            return;
        }

        try {
            this.core = new RenderCore({
                container: el,
                settings: this.port.read(),
                keyboardTarget: options.keyboardTarget,
                autoResize: options.autoResize,
                pixelRatio: options.pixelRatio,
                callbacks: {
                    onBuildingSelect: (pick) =>
                        this.callbacks.onBuildingSelect?.(pick),
                    onBuildingRemove: (index) =>
                        this.callbacks.onBuildingRemove?.(index),
                    onCameraChange: () => this.callbacks.onCameraChange?.(),
                    onRebuild: (info) =>
                        this.callbacks.onRebuild?.({
                            reason: info.reason as RebuildReason,
                            buildingCount: info.buildingCount,
                            unknownModelIndexes: info.unknownModelIndexes,
                            durationMs: info.durationMs,
                        }),
                },
            });
            // 对齐 v1 构造参数 width/height：显式尺寸优先于容器尺寸
            if (options.width !== undefined || options.height !== undefined) {
                const rect = el.getBoundingClientRect();
                this.core.setSize(
                    options.width ?? rect.width,
                    options.height ?? rect.height
                );
            }
            // 对齐 v1 构造参数 theme：默认 dark
            this.core.setTheme(options.theme ?? "dark");
        } catch (e) {
            // 例如 WebGL 不可用
            this.initError = {
                code: "no-webgl",
                phase: "lifecycle",
                message: e instanceof Error ? e.message : String(e),
                cause: e,
            };
            this.core = null;
            this.reportError(this.initError);
        }
    }

    /** 从蓝图字符串加载（内部 trim；失败返回结构化错误） */
    loadBlueprint(str: string): BlueprintLoadOutcome {
        const guard = this.guard();
        if (guard !== null) return guard;

        let data: BlueprintData;
        try {
            data = fromStr(str.trim());
        } catch (e) {
            return this.fail(classifyError(e, "parse"));
        }
        return this.applyData(data);
    }

    /** 直接注入已解析的数据（总是重建，不做引用比较） */
    loadBlueprintData(data: BlueprintData): BlueprintLoadOutcome {
        const guard = this.guard();
        if (guard !== null) return guard;
        return this.applyData(data);
    }

    /**
     * 从 **JSON 文本**导入蓝图（网页端只能拿到文本，故单独开一个入口）。
     *
     * 与 `loadBlueprintData` 的差别只有一步：先 `JSON.parse` 并按
     * `blueprintJSON.ts` 的规则还原 `Date` / `Uint8Array`，再走同一条应用链路。
     * 语法错误 → `json-syntax`；结构问题（缺 header/areas/buildings）→ `json-shape`。
     */
    loadBlueprintJSON(text: string): BlueprintLoadOutcome {
        const guard = this.guard();
        if (guard !== null) return guard;

        let data: BlueprintData;
        try {
            data = parseBlueprintJSON(text);
        } catch (e) {
            return this.fail(classifyError(e, "parse"));
        }
        return this.applyData(data);
    }

    /**
     * 把当前数据导出成可读 JSON 文本（2 空格缩进）。
     *
     * `Date` / `Uint8Array` 会被序列化成 ISO 字符串与 `{"0":…}` 对象，
     * 两者都能被 `loadBlueprintJSON` 无损还原。
     */
    exportBlueprintJSON(): string | null {
        return this.data === null ? null : stringifyBlueprintJSON(this.data);
    }

    /** 最近一次**成功**加载的数据；失败不影响它 */
    getBlueprintData(): BlueprintData | null {
        return this.data;
    }

    resetCamera(): void {
        if (this.disposed || this.core === null) return;
        this.core.resetCamera();
    }

    // ------------------------------------------------------------ 选中 / 定位 / 查询

    /**
     * 选中建筑（只点亮高亮盒，**不动相机**；对齐 v1 `selectBuilding`）。
     *
     * `index` 是 `BlueprintData.buildings` 的数组下标；传 `null` 取消选中。
     * 下标越界时按建筑ID兜底再查一次（D1：两者在实践中几乎总相等）。
     *
     * 失败：`not-loaded`（未加载）、`building-not-found`（找不到）、`already-disposed`。
     */
    selectBuilding(index: number | null): BuildingLocateResult {
        const guard = this.guard();
        if (guard !== null) return guard;
        const core = this.core;
        if (core === null)
            return this.failLocate("no-webgl", "渲染内核未初始化");

        if (index === null) {
            core.clearSelection();
            return { ok: true, index: -1 };
        }

        if (this.data === null)
            return this.failLocate("not-loaded", "尚未加载蓝图");

        const resolved = this.resolveIndex(index);
        if (resolved === null)
            return this.failLocate(
                "building-not-found",
                `找不到建筑：${index}`
            );

        core.setSelectedIndex(resolved);
        return { ok: true, index: resolved };
    }

    /**
     * 镜头居中对齐到指定建筑（**新增能力**，v1 没有），且**不锁定镜头**。
     *
     * 语义：相机搬到「建筑中心 + 建筑法线 × distance」并看向球心，建筑精确落在画面中心；
     * 控件目标点仍在球心，因此聚焦后滚轮缩放、拖拽旋转、平移都照常工作。
     * `index === null` 等价 `resetCamera()`（回全局默认视角）。
     *
     * 默认会同时选中该建筑（`options.select !== false`），因此一条调用即可完成
     * 「选中建筑 + 镜头居中」。
     *
     * 失败：`not-loaded`、`building-not-found`、`not-renderable`（未知 modelIndex，镜头不动）、`already-disposed`。
     */
    focusBuilding(
        index: number | null,
        options: FocusOptions = {}
    ): BuildingLocateResult {
        const guard = this.guard();
        if (guard !== null) return guard;
        const core = this.core;
        if (core === null)
            return this.failLocate("no-webgl", "渲染内核未初始化");

        if (index === null) {
            core.resetCamera();
            return { ok: true, index: -1 };
        }

        if (this.data === null)
            return this.failLocate("not-loaded", "尚未加载蓝图");

        const resolved = this.resolveIndex(index);
        if (resolved === null)
            return this.failLocate(
                "building-not-found",
                `找不到建筑：${index}`
            );
        if (core.isUnknownModel(resolved))
            return this.failLocate(
                "not-renderable",
                `建筑 ${index} 没有 buildingMeta，无法定位`
            );

        if (options.select !== false) core.setSelectedIndex(resolved);

        const ok = core.focusBuilding(resolved, options.distance);
        return ok
            ? { ok: true, index: resolved }
            : this.failLocate("building-not-found", `定位失败：${index}`);
    }

    /** 当前选中建筑的数组下标；无选中或未加载返回 `null` */
    getSelectedIndex(): number | null {
        return this.core?.selectedIndex ?? null;
    }

    /**
     * 获取建筑信息（对齐 v1 `getBuildingInfo(index)`）：返回该下标的实例世界矩阵。
     *
     * 失败：`not-loaded`、`not-renderable`（未知 modelIndex 的隐藏占位，没有可用矩阵）。
     */
    getBuildingInfo(index: number): ViewerQueryResult<BuildingInfoPayload> {
        const guard = this.guard();
        if (guard !== null) return guard;
        const data = this.data;
        const core = this.core;
        if (data === null || core === null)
            return this.failQuery("not-loaded", "尚未加载蓝图");

        const info = core.getBuildingInfo(index);
        if (info === null) {
            const building = data.buildings[index];
            if (building === undefined)
                return this.failQuery(
                    "building-not-found",
                    `找不到建筑：${index}`
                );
            return this.failQuery(
                "not-renderable",
                `建筑 ${index} 没有可渲染矩阵（未知 modelIndex）`
            );
        }

        const building = data.buildings[index];
        return {
            ok: true,
            value: { index, id: building?.index ?? index, matrix: info.matrix },
        };
    }

    /** 相机对象（只读用途：宿主取朝向/位置或自己做投影）；初始化失败时返回 `null` */
    getCamera(): PerspectiveCamera | null {
        return this.core?.camera ?? null;
    }

    /** 相机版本号：仅在相机真的变化的帧自增，可用来做「视角是否变过」的判定 */
    getCameraVersion(): number {
        return this.core?.cameraVersion ?? 0;
    }

    /** 渲染用 canvas；未初始化时返回 `null` */
    getCanvas(): HTMLCanvasElement | null {
        return this.core?.rendererRef.domElement ?? null;
    }

    /**
     * 显式设置渲染尺寸（对齐 v1 `setSize(w, h)`）。
     *
     * 设置后容器 resize 不再覆盖尺寸；调用 `resetSize()` 恢复跟随容器。
     */
    setSize(w: number, h: number): void {
        this.core?.setSize(w, h);
    }

    /** 取消显式尺寸，恢复跟随容器（v2 新增，v1 没有对应方法） */
    resetSize(): void {
        this.core?.clearExplicitSize();
    }

    // ------------------------------------------------------------ 主题 / 导出

    /**
     * 切换 3D 主题（对齐 v1 `setTheme`）。
     *
     * 立即生效：场景背景、星球色、网格色。角标文字颜色要等下次重建（换蓝图）才刷新。
     * 构造时可通过 `theme` 选项指定初始主题，默认 `'dark'`。
     */
    setTheme(theme: ThemeName): void {
        this.core?.setTheme(theme);
    }

    /** 在当前主题上覆盖若干颜色（对齐 v1 `setCustomTheme`） */
    setCustomTheme(patch: Partial<ThemeColors>): void {
        this.core?.setCustomTheme(patch);
    }

    /** 当前生效的主题色（对齐 v1 `getTheme`）；未初始化或已销毁时返回 `null` */
    getTheme(): ThemeColors | null {
        if (this.disposed || this.core === null) return null;
        return this.core.getTheme();
    }

    /**
     * 导出当前画面为 base64 PNG（对齐 v1 `toDataURL`）。
     *
     * 未初始化时返回 `null`。内部会先渲染一帧再取图，可直接在 rAF 之外调用。
     */
    toDataURL(): string | null {
        if (this.disposed || this.core === null) return null;
        return this.core.toDataURL();
    }

    /** 导出当前画面为 Blob（对齐 v1 `toBlob`）；未初始化时 resolve `null` */
    toBlob(): Promise<Blob | null> {
        if (this.disposed || this.core === null) return Promise.resolve(null);
        return this.core.toBlob();
    }

    setRenderSettings(partial: Partial<ViewerRenderSettings>): void {
        if (this.disposed || this.core === null) return;
        try {
            this.port.write(partial);
            // 生效路径见方案 §4.1：Set 里只有 showRealModels / maxInstancesPerModel 需要重建，
            // texturesEnabled 由 RenderCore 内部的材质重挂完成，不触发重建
            this.core.setRenderSettings(this.port.read());
        } catch (e) {
            this.reportError(classifyError(e, "build"));
        }
    }

    /**
     * 更新事件回调。
     *
     * **默认整体替换**（对齐 v1 `setCallbacks`）；传 `{ merge: true }` 则是合并（v2 旧行为）。
     */
    setCallbacks(cbs: ViewerCallbacks, opts?: { merge?: boolean }): void {
        this.callbacks =
            opts?.merge === true ? { ...this.callbacks, ...cbs } : cbs;
        this.core?.setCallbacks({
            onBuildingSelect: (pick) => this.callbacks.onBuildingSelect?.(pick),
            onBuildingRemove: (index) =>
                this.callbacks.onBuildingRemove?.(index),
            onCameraChange: () => this.callbacks.onCameraChange?.(),
            onRebuild: (info) =>
                this.callbacks.onRebuild?.({
                    reason: info.reason as RebuildReason,
                    buildingCount: info.buildingCount,
                    unknownModelIndexes: info.unknownModelIndexes,
                    durationMs: info.durationMs,
                }),
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.core?.dispose();
        this.data = null;
        this.callbacks = {};
        this.warnings.clear();
    }

    // ------------------------------------------------------------ 内部

    private guard(): { ok: false; error: ViewerError } | null {
        if (this.disposed) {
            const error: ViewerError = {
                code: "already-disposed",
                phase: "lifecycle",
                message: "Viewer 已销毁",
            };
            this.reportError(error);
            return { ok: false, error };
        }
        if (this.initError !== null)
            return { ok: false, error: this.initError };
        return null;
    }

    private fail(error: ViewerError): BlueprintLoadOutcome {
        this.reportError(error);
        // 失败保留上一次成功的数据与场景（方案 §6.4）
        return { ok: false, error };
    }

    /** 查询类失败（`selectBuilding` / `focusBuilding` 共用） */
    private failLocate(
        code: ViewerErrorCode,
        message: string
    ): { ok: false; error: ViewerError } {
        const error: ViewerError = { code, phase: "lifecycle", message };
        this.reportError(error);
        return { ok: false, error };
    }

    /** 查询类失败（`getBuildingInfo` 等返回值类查询用） */
    private failQuery(
        code: ViewerErrorCode,
        message: string
    ): { ok: false; error: ViewerError } {
        return this.failLocate(code, message);
    }

    /**
     * 把宿主传入的标识解析成数组下标（D1）。
     *
     * 先按数组下标取（对齐 v1 语义）；该位置不存在、或该位置的建筑ID与传入值不一致时，
     * 再按 `BlueprintBuilding.index` 兜底查一次 —— 蓝图按区域分组存储，二者通常相等但不保证。
     * 解析失败返回 `null`。
     */
    private resolveIndex(index: number): number | null {
        const buildings = this.data?.buildings;
        if (buildings === undefined) return null;
        if (index >= 0 && index < buildings.length) return index;
        const found = buildings.findIndex((b) => b.index === index);
        return found === -1 ? null : found;
    }

    private applyData(data: BlueprintData): BlueprintLoadOutcome {
        const core = this.core;
        if (core === null) {
            return this.fail({
                code: "no-webgl",
                phase: "lifecycle",
                message: "渲染内核未初始化",
            });
        }

        // 定位阶段与构建阶段分开捕获，便于区分「蓝图数据坏了」与「渲染内部缺陷」
        try {
            core.setBlueprintData(data);
        } catch (e) {
            return this.fail(classifyError(e, "build"));
        }

        this.data = data;

        if (!this.keepCamera) core.resetCamera();

        const stats = core.lastBuildStats();
        const result: BlueprintLoadResult = {
            buildingCount: data.buildings.length,
            areas: data.areas,
            header: data.header,
            unknownModelIndexes: stats?.unknownModelIndexes ?? [],
            warnings: [...this.warnings],
        };
        return { ok: true, value: result };
    }

    private reportError(error: ViewerError): void {
        const key = `${error.code}:${error.message}`;
        if (this.warnings.has(key)) return;
        this.warnings.add(key);
        try {
            this.callbacks.onError?.(error);
        } catch {
            // 宿主回调抛错不影响内部状态
        }
        // 同时留一条控制台记录，便于无回调时排查
        console.warn(`[viewer] ${error.phase}/${error.code}: ${error.message}`);
    }
}
