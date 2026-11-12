import type { PerspectiveCamera } from "three";
import type { BlueprintData } from "@/blueprint/parser";
import { fromStr } from "@/blueprint/parser";
import { RemoveBuildingsCommand } from "@/blueprint/removeBuilding";
import { isInserter } from "@/data/items";
import type { ViewerRenderSettings } from "@/render/renderSettingsTypes";
import { RenderCore, RenderPhaseError } from "./core/RenderCore";
import type { RebuildReason } from "./core/RenderCore";
import type {
    PreviewAlignedSnapshot,
    PreviewBeginOptions,
    PreviewDeltaEvent,
    PreviewStats,
} from "./preview/types";
import {
    JSONImportError,
    parseBlueprintJSON,
    stringifyBlueprintJSON,
} from "./blueprintJSON";
import type {
    AlignedCommitOutcome,
    BlueprintLoadOutcome,
    BlueprintLoadResult,
    BuildingInfoPayload,
    BuildingLocateResult,
    BuildingsLocateResult,
    DeleteMode,
    DeleteOutcome,
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
    previewAnimation: "auto",
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
 * 无头蓝图渲染器（方案 D3：本轮仅源码引用）。
 *
 * 与编辑器共用 `src/lib/core/` 的渲染内核，但不含地基与放置/预览等编辑态；
 * 唯一的"写"能力是 `deleteBuilding` 纯 API（不涉及 3D 交互、UI 与撤销栈）。
 * 契约：**公开方法不抛异常**，失败通过 `{ ok: false, error }` 返回并经 `onError` 上报；
 * 失败时场景、相机与 `getBlueprintData()` 均保持上一次成功状态
 * （唯一例外：`deleteBuilding` 的"已删除但重建失败"分支，见其文档）。
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
            ...(options.previewAnimation !== undefined
                ? { previewAnimation: options.previewAnimation }
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
            // 默认 editor 主题（复刻编辑器当前观感）；显式传入时按传入值切换
            this.core.setTheme(options.theme ?? "editor");
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

    // ------------------------------------------------------------ 增量预览（preview-delta）

    /**
     * 开始一次增量预览。
     *
     * 时序（指南 §2）：**先开始预览，再提交生成请求**，否则会漏掉开头的消息。
     * `clearFormalScene: true` 会清空正式场景（含 `getBlueprintData()` 返回 null），
     * 快照由宿主 / Go 端保存；失败恢复走 `loadBlueprint(snapshot)`。
     */
    beginPreview(
        options?: PreviewBeginOptions & { clearFormalScene?: boolean }
    ): void {
        const guard = this.guard();
        if (guard !== null) return;
        this.core?.beginPreview(options);
        if (options?.clearFormalScene === true) this.data = null;
    }

    /**
     * 同步摄入一条 `preview-delta`（在宿主的 `onProgress` 回调里直接调用）。
     *
     * - 返回 `true` 表示应用了内容；序号过期 / 非差量 / 已销毁时返回 `false`；
     * - **绝不抛错**（渲染异常在预览层内部吞掉，符合指南"不要让预览把生成流程搞挂"）。
     */
    applyPreviewDelta(event: PreviewDeltaEvent): boolean {
        if (this.disposed) return false;
        return this.core?.applyPreviewDelta(event) ?? false;
    }

    /**
     * 预览收尾：用正式蓝图串替换。
     *
     * 顺序是**先建后换**——先构建正式场景（此时预览层仍在显示），成功后再丢弃预览层，
     * 否则 3 万级蓝图会出现"预览消失 → 空场景 → 正式场景"的闪断。
     */
    commitPreview(blueprint: string): BlueprintLoadOutcome {
        const guard = this.guard();
        if (guard !== null) return guard;

        let data: BlueprintData;
        try {
            data = fromStr(blueprint.trim());
        } catch (e) {
            // 生成成功但蓝图串无效：按失败处理，同时丢弃预览（不留半截画面）
            this.core?.discardPreview();
            return this.fail(classifyError(e, "parse"));
        }
        const outcome = this.applyData(data);
        this.core?.discardPreview();
        return outcome;
    }

    /**
     * 对齐式提交：完整蓝图到达后先停留 `settleMs`（默认 1000ms），再对比
     * 预览层骨架与完整蓝图：
     *
     * - 骨架一致且坐标语义为 `blueprint-area-local-v1` → `alignedCommit`（0 位移、无闪烁）；
     * - 骨架不一致 / 其他坐标语义 → 常规 `setBlueprintData`（强制刷新，位置由 areas 决定）。
     *
     * 失败时预览层已丢弃，宿主按 Go 端快照 `loadBlueprint(snapshot)` 恢复。
     * 骨架不一致**不算失败**：`ok: true` 且 `aligned: false`。
     */
    async commitPreviewAligned(
        blueprint: string,
        options: { settleMs?: number } = {}
    ): Promise<AlignedCommitOutcome> {
        const guard = this.guard();
        if (guard !== null) return { ...guard, aligned: false };
        const core = this.core;
        if (core === null)
            return {
                ok: false,
                aligned: false,
                error: {
                    code: "no-webgl",
                    phase: "lifecycle",
                    message: "渲染内核未初始化",
                },
            };

        const settleMs = Math.max(0, options.settleMs ?? 1000);

        let data: BlueprintData;
        try {
            data = fromStr(blueprint.trim());
        } catch (e) {
            core.discardPreview();
            return this.failAligned(classifyError(e, "parse"));
        }

        if (settleMs > 0) await wait(settleMs);
        if (this.disposed)
            return this.failAligned({
                code: "already-disposed",
                phase: "lifecycle",
                message: "Viewer 已销毁",
            });

        const snapshot = core.exportPreviewSnapshot();
        const mismatches =
            snapshot === null
                ? ["preview:no-snapshot"]
                : compareSkeleton(snapshot, data);
        const aligned =
            snapshot !== null &&
            mismatches.length === 0 &&
            snapshot.coordinateSystem === "blueprint-area-local-v1";

        try {
            if (aligned && snapshot !== null) {
                core.alignedCommit(data, snapshot);
            } else {
                core.setBlueprintData(data);
            }
        } catch (e) {
            core.discardPreview();
            return this.failAligned(classifyError(e, "build"));
        }

        this.data = data;
        if (!this.keepCamera) core.resetCamera();
        core.discardPreview();

        const stats = core.lastBuildStats();
        const result: BlueprintLoadResult = {
            buildingCount: data.buildings.length,
            areas: data.areas,
            header: data.header,
            unknownModelIndexes: stats?.unknownModelIndexes ?? [],
            warnings: [...this.warnings],
        };
        return {
            ok: true,
            value: result,
            aligned,
            settleMs,
            skeletonMismatch: mismatches,
        };
    }

    private failAligned(error: ViewerError): AlignedCommitOutcome {
        this.reportError(error);
        return { ok: false, error, aligned: false };
    }

    /** 丢弃预览层（生成失败 / 中止 / 用户离开页面时调用） */
    discardPreview(): void {
        if (this.disposed) return;
        this.core?.discardPreview();
    }

    /** 是否正在预览 */
    get previewing(): boolean {
        return this.core?.previewing ?? false;
    }

    /**
     * 预览运行期统计（诊断用；未预览时为 `null`）。
     *
     * 字段覆盖验收口径：`lastIngestMs` / `maxIngestMs`（≤50ms 预算）、
     * `moving`（稳态应回落到 0）、`unknownRemoves`（中途订阅时的正常现象）。
     */
    previewStats(): PreviewStats | null {
        return this.core?.getPreviewStats() ?? null;
    }

    resetCamera(): void {
        if (this.disposed || this.core === null) return;
        this.core.resetCamera();
    }

    // ------------------------------------------------------------ 选中 / 定位 / 查询 / 多选

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
     * 批量选中建筑（**新增能力**，v1 没有）。
     *
     * - 传 `null` 或空数组：清除选中；
     * - 每个元素按 `selectBuilding` 的同一规则解析（数组下标优先，越界按建筑ID兜底）；
     * - 先整体校验再提交：任一建筑找不到时**整次调用失败，原选中不变**；
     * - 返回命中的数组下标（去重、保持传入顺序）。
     *
     * 失败：`not-loaded`（未加载）、`building-not-found`（找不到）、`already-disposed`。
     */
    selectedBuildings(indexes: number[] | null): BuildingsLocateResult {
        const guard = this.guard();
        if (guard !== null) return guard;
        const core = this.core;
        if (core === null)
            return this.failLocate("no-webgl", "渲染内核未初始化");

        if (indexes === null || indexes.length === 0) {
            core.clearSelection();
            return { ok: true, indexes: [] };
        }

        if (this.data === null)
            return this.failLocate("not-loaded", "尚未加载蓝图");

        const resolved: number[] = [];
        const seen = new Set<number>();
        for (const index of indexes) {
            const i = this.resolveIndex(index);
            if (i === null)
                return this.failLocate(
                    "building-not-found",
                    `找不到建筑：${index}`
                );
            if (!seen.has(i)) {
                seen.add(i);
                resolved.push(i);
            }
        }

        core.setSelectedIndexes(resolved);
        return { ok: true, indexes: resolved };
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

    /** 当前选中建筑的数组下标；多选时返回第一项，无选中或未加载返回 `null` */
    getSelectedIndex(): number | null {
        return this.core?.selectedIndex ?? null;
    }

    /** 当前选中的全部建筑数组下标（空数组表示无选中） */
    getSelectedIndexes(): number[] {
        return this.core?.selectedIndexes ?? [];
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

    // ------------------------------------------------------------ 批量删除（写操作）

    /**
     * 批量删除建筑（**纯 API**：MES / UMD 端直接调用，不经过 UI 与撤销栈）。
     *
     * - `mode=0`：`targets` 是 **itemId** 列表，删除这些 itemId 的**全部**建筑；
     * - `mode=1`：`targets` 是**建筑 ID**（`BlueprintBuilding.index`）列表，
     *   内部做 ID → 数组下标映射；重复 ID 自动去重；
     * - **整批失败语义**：任一目标不存在（mode=0 的某个 itemId 一栋都没命中 /
     *   mode=1 的某个 ID 找不到），整次调用失败，命令不执行、数据零变更；
     * - 成功时走既有重建通道（`notifyDataChanged` → `rebuildScene("data")`），
     *   重建前会清空选中态——删除后数组下标重排，旧选中会指向别的建筑。
     *
     * **共享引用告警**：`getBlueprintData()` 返回的是内部数据引用，删除是**原地修改**，
     * 宿主此前拿到的旧引用会一起变；需要快照请自行深拷贝或先 `exportBlueprintJSON()`。
     *
     * 失败：`already-disposed` / 初始化错误 / `not-loaded` / `invalid-argument` /
     * `building-not-found` / `build-failed`。
     * 唯一"数据已变"的失败是重建阶段抛错（`build-failed`，message 会注明），
     * 此时建议宿主重新 `loadBlueprint`。
     */
    deleteBuilding(mode: DeleteMode, targets: number[]): DeleteOutcome {
        // ---- S0 前置守卫 ----
        const guard = this.guard();
        if (guard !== null) return guard;
        const data = this.data;
        const core = this.core;
        if (data === null || core === null)
            return this.failLocate("not-loaded", "尚未加载蓝图");

        // ---- S1 参数校验（任一不合法都直接返回，数据不变）----
        if (mode !== 0 && mode !== 1)
            return this.failLocate("invalid-argument", "mode 必须为 0 或 1");
        if (!Array.isArray(targets) || targets.length === 0)
            return this.failLocate("invalid-argument", "targets 不能为空数组");
        for (const t of targets) {
            if (typeof t !== "number" || !Number.isInteger(t) || t < 0)
                return this.failLocate(
                    "invalid-argument",
                    "targets 元素必须为非负整数"
                );
        }

        // ---- S2 目标解析（只读阶段：整批失败语义在此落地）----
        let indices: number[];
        if (mode === 0) {
            // itemId → 是否命中；命中集合与请求集合不一致即整批失败
            const wanted = new Set(targets);
            const matched = new Set<number>();
            indices = [];
            for (let i = 0; i < data.buildings.length; i++) {
                const itemId = data.buildings[i].itemId;
                if (!wanted.has(itemId)) continue;
                matched.add(itemId);
                indices.push(i);
            }
            if (matched.size !== wanted.size) {
                const missing = [...wanted].filter((id) => !matched.has(id));
                return this.failLocate(
                    "building-not-found",
                    `以下 itemId 没有任何建筑：${missing.join(",")}`
                );
            }
        } else {
            // 建筑 ID → 数组下标，单遍 O(n)；禁止逐 ID findIndex（3 万级会退化）
            const posById = new Map<number, number>();
            for (let i = 0; i < data.buildings.length; i++)
                posById.set(data.buildings[i].index, i);
            const seen = new Set<number>();
            indices = [];
            for (const id of targets) {
                if (seen.has(id)) continue; // 重复 ID 去重
                const pos = posById.get(id);
                if (pos === undefined)
                    return this.failLocate(
                        "building-not-found",
                        `建筑 ID ${id} 不存在`
                    );
                seen.add(id);
                indices.push(pos);
            }
            indices.sort((a, b) => a - b);
        }

        // ---- S3 先清选中：重建会把旧下标原样重新套用，删除后下标已重排 ----
        core.clearSelection();

        // ---- S4 执行命令（index 重排 + 交叉引用维护由命令承担）----
        try {
            const cmd = new RemoveBuildingsCommand(indices, data);
            cmd.do(data);
        } catch (e) {
            // 理论不达；若达说明数据本身已不自洽（如建筑 index 与数组位置不符）。
            // 不做 undo：命令未完整执行时，其内部记录不足以支撑可靠回滚。
            return this.failLocate(
                "build-failed",
                `删除命令执行失败（数据可能已部分变更，建议重新 loadBlueprint）：${String(
                    e
                )}`
            );
        }

        // ---- S5 通知重建（原子：失败保留旧场景，但数据已变）----
        try {
            core.notifyDataChanged();
        } catch (e) {
            return this.failLocate(
                "build-failed",
                `已删除 ${indices.length} 栋但场景重建失败（数据已变更，请重新 loadBlueprint）：${String(
                    e
                )}`
            );
        }

        // ---- S6 返回 ----
        return {
            ok: true,
            value: { mode, removed: indices.length, indexes: indices },
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

/** 骨架对比容差：格坐标（局部坐标，精度足够） */
const SKELETON_EPS = 1e-4;
/** 骨架对比容差：角度（度） */
const YAW_EPS = 0.01;

function normalizeYaw(y: number): number {
    let r = y % 360;
    if (r < 0) r += 360;
    if (r >= 360 - YAW_EPS) r = 0;
    return r;
}

/**
 * 对比预览层骨架与完整蓝图。
 *
 * 口径（用户确认）：
 * - 一致条件：数量、相对坐标（第一端 + 分拣器第二端）、朝向、模型（modelIndex）、连接关系（outputObjIdx）；
 * - 不比较：参数（配方 / 过滤 / 库存 / 加速模式等）、kind（glb vs 回退盒，只是资源加载状态）、itemId；
 * - `areas` 全球定位不参与比较（预览层与蓝图整体偏移属预期）。
 *
 * 返回不一致原因列表；空数组表示一致。`outputBuildingIndex` 是建筑 ID，
 * 与蓝图 `outputObjIdx`（数组下标）对比前先经 `idToPos` 转换。
 */
function compareSkeleton(
    snapshot: PreviewAlignedSnapshot,
    data: BlueprintData
): string[] {
    const mismatches: string[] = [];
    if (snapshot.objects.size !== data.buildings.length) {
        mismatches.push(
            `count: preview=${snapshot.objects.size}, blueprint=${data.buildings.length}`
        );
        return mismatches;
    }

    const idToPos = new Map<number, number>();
    data.buildings.forEach((b, i) => idToPos.set(b.index, i));

    for (const b of data.buildings) {
        const obj = snapshot.objects.get(b.index);
        if (obj === undefined) {
            mismatches.push(`missing: building-${b.index}`);
            continue;
        }
        if (obj.areaIndex !== b.areaIndex) {
            mismatches.push(`area ${b.index}: ${obj.areaIndex} vs ${b.areaIndex}`);
            continue;
        }
        if (
            Math.abs(obj.x - b.localOffset[0].x) > SKELETON_EPS ||
            Math.abs(obj.y - b.localOffset[0].y) > SKELETON_EPS ||
            Math.abs(obj.z - b.localOffset[0].z) > SKELETON_EPS
        ) {
            mismatches.push(`pos ${b.index}`);
            continue;
        }
        if (
            Math.abs(normalizeYaw(obj.yaw) - normalizeYaw(b.yaw[0])) > YAW_EPS
        ) {
            mismatches.push(`yaw ${b.index}`);
            continue;
        }
        if (obj.modelIndex !== b.modelIndex) {
            mismatches.push(
                `model ${b.index}: ${obj.modelIndex} vs ${b.modelIndex}`
            );
            continue;
        }
        if (isInserter(b.itemId)) {
            if (
                Math.abs(obj.x2 - b.localOffset[1].x) > SKELETON_EPS ||
                Math.abs(obj.y2 - b.localOffset[1].y) > SKELETON_EPS ||
                Math.abs(obj.z2 - b.localOffset[1].z) > SKELETON_EPS
            ) {
                mismatches.push(`pos2 ${b.index}`);
                continue;
            }
        }
        const expectedOutput = b.outputObjIdx >= 0 ? b.outputObjIdx : null;
        const actualOutput =
            obj.outputBuildingIndex === null
                ? null
                : idToPos.get(obj.outputBuildingIndex) ?? -2;
        if (actualOutput !== expectedOutput) {
            mismatches.push(
                `output ${b.index}: ${actualOutput} vs ${expectedOutput}`
            );
        }
    }
    return mismatches;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
