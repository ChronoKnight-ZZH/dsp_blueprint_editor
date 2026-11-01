/**
 * 渲染高级设置（设置面板与渲染层共享的全局状态）。
 *
 * 保存位置是 **sessionStorage**：刷新不丢，关闭标签页后清空。
 * 设置不会立即作用于已建好的场景：「导入蓝图」时把面板设置固化为「已生效」
 * 快照（captureRenderSettings），渲染层只读快照 —— 修改设置只影响下次导入，
 * 中途任何原因的场景重建（剔除建筑 / 撤销重做 / GLB 模型加载完成）都仍按
 * 导入时的值渲染。这也是设置面板里提示「需重新导入蓝图才能生效」的原因。
 */

import { reactive } from 'vue';

/** 贴图通道：-a 反照率 / -n 法线 / -s 高光·粗糙 / -e 自发光 / -eff 特效 / -dirt 污渍 / -glass 玻璃 */
export type TextureChannel =
    | 'albedo' | 'normal' | 'spec' | 'emissive' | 'effect' | 'dirt' | 'glass';

export interface RenderSettings {
    /** 是否用外部 GLB 真实模型渲染；关闭后全部回退元数据方块 */
    showRealModels: boolean;
    /** 贴图总开关；关闭后不挂任何外部通道贴图 */
    texturesEnabled: boolean;
    /** 各通道开关 */
    textures: Record<TextureChannel, boolean>;
    /** 同一模型最多用 GLB 渲染的实例数；Infinity = 无限 */
    maxInstancesPerModel: number;
}
// 渲染设置保存键名
const STORAGE_KEY = 'dsp-blueprint-editor:render-settings';
// 渲染设置保存键名
const CHANNEL_KEYS: readonly TextureChannel[] = [
    'albedo', 'normal', 'spec', 'emissive', 'effect', 'dirt', 'glass',
];

// 默认设置
function defaultSettings(): RenderSettings {
    return {
        showRealModels: false,
        texturesEnabled: false,
        textures: {
            albedo: true,
            normal: true,
            spec: true,
            emissive: true,
            effect: true,
            dirt: true,
            glass: true,
        },
        maxInstancesPerModel: 1024,
    };
}

function loadSettings(): RenderSettings {
    const settings = defaultSettings();
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw === null)
            return settings;

        const saved = JSON.parse(raw) as {
            showRealModels?: unknown;
            texturesEnabled?: unknown;
            textures?: Partial<Record<TextureChannel, unknown>>;
            maxInstancesPerModel?: unknown;
        };

        if (typeof saved.showRealModels === 'boolean')
            settings.showRealModels = saved.showRealModels;
        if (typeof saved.texturesEnabled === 'boolean')
            settings.texturesEnabled = saved.texturesEnabled;

        if (saved.textures !== null && typeof saved.textures === 'object') {
            for (const key of CHANNEL_KEYS) {
                const value = saved.textures[key];
                if (typeof value === 'boolean')
                    settings.textures[key] = value;
            }
        }

        // JSON 无法表示 Infinity，约定用 null 表示无限
        if (saved.maxInstancesPerModel === null)
            settings.maxInstancesPerModel = Infinity;
        else if (typeof saved.maxInstancesPerModel === 'number'
            && Number.isFinite(saved.maxInstancesPerModel)
            && saved.maxInstancesPerModel > 0)
            settings.maxInstancesPerModel = Math.floor(saved.maxInstancesPerModel);
    }
    catch {
        // sessionStorage 不可用（隐私模式等）或数据损坏 → 静默使用默认值
    }
    return settings;
}

/** 全局共享的响应式设置；模块导入时即从 sessionStorage 恢复 */
export const renderSettings = reactive(loadSettings());

/**
 * 「已生效」设置快照：渲染层建场景时只读它。
 *
 * 语义：仅在「导入蓝图」（captureRenderSettings，由 App.vue 的 parseBp 调用）时
 * 从面板设置拷贝，因此修改设置只影响下次导入；中途任何原因的场景重建
 * （剔除建筑 / 撤销重做 / GLB 模型加载完成）都仍按导入时的值渲染。
 *
 * 响应式安全：快照是普通对象，读属性不会被 Vue 依赖跟踪 —— 建场景在 computed
 * 里执行，若直接读 reactive 的 renderSettings，设置会被收集为 computed 的依赖，
 * 改设置会立刻重建整个场景，违背上面的语义。
 */
const appliedSettings: RenderSettings = defaultSettings();

function copyRenderSettings(target: RenderSettings, source: RenderSettings): void {
    target.showRealModels = source.showRealModels;
    target.texturesEnabled = source.texturesEnabled;
    Object.assign(target.textures, source.textures);
    target.maxInstancesPerModel = source.maxInstancesPerModel;
}

// 初始快照 = 启动时（含 sessionStorage 恢复）的设置
copyRenderSettings(appliedSettings, renderSettings);

/** 渲染层读取「已生效」设置；仅在导入蓝图时更新 */
export function getAppliedRenderSettings(): RenderSettings {
    return appliedSettings;
}

/** 导入蓝图时调用：把当前面板设置固化为「已生效」快照 */
export function captureRenderSettings(): void {
    copyRenderSettings(appliedSettings, renderSettings);
}

/** 写回 sessionStorage；Infinity 序列化为 null */
export function persistRenderSettings(): void {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            showRealModels: renderSettings.showRealModels,
            texturesEnabled: renderSettings.texturesEnabled,
            textures: { ...renderSettings.textures },
            maxInstancesPerModel: Number.isFinite(renderSettings.maxInstancesPerModel)
                ? renderSettings.maxInstancesPerModel
                : null,
        }));
    }
    catch {
        // 写失败只影响「刷新后保持」，不影响当前会话生效
    }
}
