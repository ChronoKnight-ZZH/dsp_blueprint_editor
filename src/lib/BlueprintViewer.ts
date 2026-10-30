import type { BlueprintData } from '@/blueprint/parser';
import { fromStr } from '@/blueprint/parser';
import type { ViewerRenderSettings } from '@/renderSettingsTypes';
import { RenderCore, RenderPhaseError } from './core/RenderCore';
import type { RebuildReason } from './core/RenderCore';
import type {
    BlueprintLoadOutcome, BlueprintLoadResult, SettingsPort, ViewerCallbacks, ViewerError,
    ViewerErrorCode, ViewerErrorPhase, ViewerOptions,
} from './types';

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
    read(): ViewerRenderSettings { return this.value; }
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

    const message = e instanceof Error ? e.message : String(e);
    const cause = e;

    const parseRules: [string, ViewerErrorCode][] = [
        ['Invalid start', 'invalid-start'],
        ['Header too short', 'header-too-short'],
        ['Checksum not found', 'checksum-missing'],
        ['Checksum mismatch', 'checksum-mismatch'],
        ['overflow', 'buffer-overflow'],
        ['out of range', 'buffer-overflow'],
    ];
    if (phase === 'parse') {
        for (const [needle, code] of parseRules) {
            if (message.includes(needle))
                return { code, phase, message, cause };
        }
        return { code: 'parse-failed', phase, message, cause };
    }

    const positionRules: [string, ViewerErrorCode][] = [
        ['No root area', 'no-root-area'],
        ['No suitable longitude', 'no-longitude'],
        ['same segments as its parent', 'inconsistent-area'],
        ['anchorLocalOffsetY', 'inconsistent-area'],
    ];
    if (phase === 'position') {
        for (const [needle, code] of positionRules) {
            if (message.includes(needle))
                return { code, phase, message, cause };
        }
    }

    return { code: 'build-failed', phase: phase === 'build' ? 'build' : phase, message, cause };
}

/** 解析容器参数 */
function resolveContainer(container: HTMLElement | string): HTMLElement | null {
    if (typeof container !== 'string')
        return container;
    if (typeof document === 'undefined')
        return null;
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
        this.keepCamera = options.keepCamera === true;

        // 平铺字段是 initialSettings 的语法糖；用条件展开构造，
        // 避免对 `ViewerRenderSettings` 的 readonly 属性做赋值（TS2540）
        const flatInitial: Partial<ViewerRenderSettings> = {
            ...(options.showRealModels !== undefined ? { showRealModels: options.showRealModels } : {}),
            ...(options.texturesEnabled !== undefined ? { texturesEnabled: options.texturesEnabled } : {}),
            ...(options.maxInstancesPerModel !== undefined ? { maxInstancesPerModel: options.maxInstancesPerModel } : {}),
        };

        const initial = { ...(options.initialSettings ?? {}), ...flatInitial };
        this.port = options.settingsPort ?? new LocalSettingsPort(initial);

        const el = resolveContainer(options.container);
        if (el === null) {
            this.initError = {
                code: 'no-container',
                phase: 'lifecycle',
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
                    onBuildingSelect: index => this.callbacks.onBuildingSelect?.(index),
                    onBuildingRemove: index => this.callbacks.onBuildingRemove?.(index),
                    onCameraChange: () => this.callbacks.onCameraChange?.(),
                    onRebuild: info => this.callbacks.onRebuild?.({
                        reason: info.reason as RebuildReason,
                        buildingCount: info.buildingCount,
                        unknownModelIndexes: info.unknownModelIndexes,
                        durationMs: info.durationMs,
                    }),
                },
            });
        }
        catch (e) {
            // 例如 WebGL 不可用
            this.initError = {
                code: 'no-webgl',
                phase: 'lifecycle',
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
        if (guard !== null)
            return guard;

        let data: BlueprintData;
        try {
            data = fromStr(str.trim());
        }
        catch (e) {
            return this.fail(classifyError(e, 'parse'));
        }
        return this.applyData(data);
    }

    /** 直接注入已解析的数据（总是重建，不做引用比较） */
    loadBlueprintData(data: BlueprintData): BlueprintLoadOutcome {
        const guard = this.guard();
        if (guard !== null)
            return guard;
        return this.applyData(data);
    }

    /** 最近一次**成功**加载的数据；失败不影响它 */
    getBlueprintData(): BlueprintData | null {
        return this.data;
    }

    resetCamera(): void {
        if (this.disposed || this.core === null)
            return;
        this.core.resetCamera();
    }

    setRenderSettings(partial: Partial<ViewerRenderSettings>): void {
        if (this.disposed || this.core === null)
            return;
        try {
            this.port.write(partial);
            // 生效路径见方案 §4.1：Set 里只有 showRealModels / maxInstancesPerModel 需要重建，
            // texturesEnabled 由 RenderCore 内部的材质重挂完成，不触发重建
            this.core.setRenderSettings(this.port.read());
        }
        catch (e) {
            this.reportError(classifyError(e, 'build'));
        }
    }

    setCallbacks(cbs: ViewerCallbacks): void {
        this.callbacks = { ...this.callbacks, ...cbs };
    }

    dispose(): void {
        if (this.disposed)
            return;
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
                code: 'already-disposed', phase: 'lifecycle', message: 'Viewer 已销毁',
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

    private applyData(data: BlueprintData): BlueprintLoadOutcome {
        const core = this.core;
        if (core === null) {
            return this.fail({
                code: 'no-webgl', phase: 'lifecycle', message: '渲染内核未初始化',
            });
        }

        // 定位阶段与构建阶段分开捕获，便于区分「蓝图数据坏了」与「渲染内部缺陷」
        try {
            core.setBlueprintData(data);
        }
        catch (e) {
            return this.fail(classifyError(e, 'build'));
        }

        this.data = data;

        if (!this.keepCamera)
            core.resetCamera();

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
        if (this.warnings.has(key))
            return;
        this.warnings.add(key);
        try {
            this.callbacks.onError?.(error);
        }
        catch {
            // 宿主回调抛错不影响内部状态
        }
        // 同时留一条控制台记录，便于无回调时排查
        console.warn(`[viewer] ${error.phase}/${error.code}: ${error.message}`);
    }
}
