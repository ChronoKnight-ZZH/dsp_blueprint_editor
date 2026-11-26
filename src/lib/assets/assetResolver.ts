/**
 * 资产解析：**运行时实现**（UMD / ESM 库构建用）。
 *
 * 与 `assetResolver.webpack.ts` 的差别只有「URL 从哪来」：
 * - webpack 实现：`require.context` / 模板字符串 `import()`，URL 由 `publicPath` 生成；
 * - 本实现：纯字符串拼接，URL 由 `assetBaseUrl` 决定，资产清单（哪些文件真实存在）
 *   由构建脚本在编译期通过 `DefinePlugin` 注入（`scripts/lib-build/build.js`）。
 *
 * 注入清单而不是「盲猜路径」是必须的：`resolveModelName()` 依赖
 * `availableModelNames` 判断某个建筑有没有外部模型，猜错会退化成
 * 「先发一个 404 再回退」，验收要求 Network 零 404。
 *
 * 单测（jest）里没有 webpack，也没有构建期注入，由 `jest.config.js` 的
 * `globals` 提供同一份清单（同样由 `scripts/lib-build/assetInventory.js` 扫描磁盘得到）。
 */

import type { AssetInventory, AssetResolver } from "./types";
import { resolveAssetUrl } from "./assetBaseUrl";

/**
 * 构建期注入的资产清单。未注入时（例如直接跑源码）退化成空清单：
 * GLB 全部回退元数据表，图标请求直接 reject，不会产生任何网络请求。
 */
declare const __DSP_LIB_ASSET_INVENTORY__: AssetInventory | undefined;

const EMPTY_INVENTORY: AssetInventory = {
    models: [],
    itemRecipe: [],
    tech: [],
    signal: [],
};

function injectedInventory(): AssetInventory {
    // 必须用 typeof 守卫：未注入时直接读会抛 ReferenceError
    if (
        typeof __DSP_LIB_ASSET_INVENTORY__ === "undefined" ||
        __DSP_LIB_ASSET_INVENTORY__ === null
    )
        return EMPTY_INVENTORY;
    return __DSP_LIB_ASSET_INVENTORY__;
}

const inventory = injectedInventory();

/** 清单里的模型条目是 `models/<name>.glb` */
const MODEL_PREFIX = "models/";
const GLB_EXTENSION = /\.glb$/i;

/** 清单里的图标键是 `icons/<category>/…`，产物里落在 `img/<category>/…` */
const INVENTORY_ICON_PREFIX = "icons/";
const OUTPUT_ICON_PREFIX = "img/";

/** 清单键（相对 `src/assets/`）→ 产物相对路径 */
function iconOutputPath(inventoryPath: string): string {
    return `${OUTPUT_ICON_PREFIX}${inventoryPath.slice(
        INVENTORY_ICON_PREFIX.length
    )}`;
}

/** 清单（相对 `src/assets/`）里的全部模型路径（用于 O(1) 判断「文件到底在不在」） */
const modelPaths = new Set(inventory.models);

/** 模型名（不含目录与扩展名），顺序沿用清单（构建时已排序） */
const modelNames: readonly string[] = inventory.models.map((path) =>
    path.replace(/^models\//i, "").replace(GLB_EXTENSION, "")
);

const itemRecipePaths = new Set(inventory.itemRecipe);
const techPaths = new Set(inventory.tech);
const signalPaths = new Set(inventory.signal);

/** `assets/icons/models/<建筑目录>/<文件>.png` → `<建筑目录>/<文件>.png` */
const MODEL_TEXTURE_KEY = /^.*assets\/icons\/models\//i;

function toPosix(value: string): string {
    return value.replace(/\\/g, "/");
}

export const assetResolver: AssetResolver = {
    glbModelNames(): readonly string[] {
        return modelNames;
    },

    async glbModelUrl(name: string): Promise<string | null> {
        const path = `${MODEL_PREFIX}${name}.glb`;
        return modelPaths.has(path) ? resolveAssetUrl(path) : null;
    },

    modelTextureUrl(srcRelativePath: string): string | null {
        const normalized = toPosix(srcRelativePath);
        const relative = normalized.replace(MODEL_TEXTURE_KEY, "");
        if (relative === normalized) {
            console.warn(
                `[asset] 无法识别的贴图路径（不在 assets/icons/models 下）：${srcRelativePath}`
            );
            return null;
        }
        // 清单里的贴图在产物中落在 img/models/<建筑目录>/<文件>.png
        return resolveAssetUrl(`img/models/${relative}`);
    },

    async itemRecipeIconUrl(name: string): Promise<string> {
        const path = `icons/item_recipe/${name}.png`;
        if (!itemRecipePaths.has(path))
            throw new Error(`找不到物品/配方图标：${name}`);
        return resolveAssetUrl(iconOutputPath(path));
    },

    async techIconUrl(techId: number): Promise<string> {
        const path = `icons/tech/${techId}.png`;
        if (!techPaths.has(path)) throw new Error(`找不到科技图标：${techId}`);
        return resolveAssetUrl(iconOutputPath(path));
    },

    async signalIconUrl(signalId: number): Promise<string> {
        const path = `icons/signal/signal-${signalId}.png`;
        if (!signalPaths.has(path))
            throw new Error(`找不到信号图标：${signalId}`);
        return resolveAssetUrl(iconOutputPath(path));
    },
};
