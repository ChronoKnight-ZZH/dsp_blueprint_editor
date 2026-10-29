/**
 * 渲染高级设置（设置面板与渲染层共享的全局状态）。
 *
 * 保存位置是 **sessionStorage**：刷新不丢，关闭标签页后清空。
 * 设置不会立即作用于已建好的场景 —— 场景在「重新导入蓝图」时按这里的值重建，
 * 这也是设置面板里提示「需重新导入蓝图才能生效」的原因。
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

const STORAGE_KEY = 'dsp-blueprint-editor:render-settings';

const CHANNEL_KEYS: readonly TextureChannel[] = [
    'albedo', 'normal', 'spec', 'emissive', 'effect', 'dirt', 'glass',
];

function defaultSettings(): RenderSettings {
    return {
        showRealModels: true,
        texturesEnabled: true,
        textures: {
            albedo: true,
            normal: true,
            spec: true,
            emissive: true,
            effect: true,
            dirt: true,
            glass: true,
        },
        maxInstancesPerModel: Infinity,
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
