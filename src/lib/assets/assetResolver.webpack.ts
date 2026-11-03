/**
 * 资产解析：**webpack 实现**（编辑器构建用，由 `vue.config.js` 的 `resolve.alias` 选中）。
 *
 * 本构建不打包 GLB 模型与通道贴图：不调用 `require.context`，因此 webpack 不会把
 * `src/assets/icons/models` 下的 .glb / .png 纳入产物，全部建筑回退元数据表渲染。
 * 物品/配方/科技/信号图标仍通过模板字符串 `import()` 正常打包（UI 必需）。
 * 若需恢复真实模型，重新启用 GLB / 贴图的 `require.context` 即可。
 */

import type { AssetResolver } from "./types";

export const assetResolver: AssetResolver = {
    glbModelNames(): readonly string[] {
        // 不打包 GLB 模型：返回空清单，全部建筑回退元数据表。
        return [];
    },

    async glbModelUrl(name: string): Promise<string | null> {
        // 不打包 GLB 模型：返回 null，建筑回退元数据表。
        void name;
        return null;
    },

    modelTextureUrl(srcRelativePath: string): string | null {
        // 不打包通道贴图：返回 null，材质仅使用 GLB 内嵌底色（无 GLB 时为纯色）。
        void srcRelativePath;
        return null;
    },

    async itemRecipeIconUrl(name: string): Promise<string> {
        const mod = await import(
            /* webpackMode: "eager" */ `@/assets/icons/item_recipe/${name}.png`
        );
        return mod.default;
    },

    async techIconUrl(techId: number): Promise<string> {
        const mod = await import(
            /* webpackMode: "eager" */ `@/assets/icons/tech/${techId}.png`
        );
        return mod.default;
    },

    async signalIconUrl(signalId: number): Promise<string> {
        const mod = await import(
            /* webpackMode: "eager" */ `@/assets/icons/signal/signal-${signalId}.png`
        );
        return mod.default;
    },
};
