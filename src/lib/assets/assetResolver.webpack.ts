/**
 * 资产解析：**webpack 实现**（编辑器构建用，由 `vue.config.js` 的 `resolve.alias` 选中）。
 *
 * 这里的每一处 `require.context` / 模板字符串 `import()` 都是 webpack 编译期静态分析的
 * 目标，参数必须是**字面量**：换成变量会被当成动态依赖而报错或整目录打包。
 *
 * 与改造前（`src/models/glbAssets.ts`、`src/models/textureManifest.ts`、`src/data/icons.ts`
 * 里各写一份）的行为保持一致：
 * - GLB 走**同步** `require.context`（进 bundle 的只有 URL 字符串，`.glb` 文件本身由
 *   `vue.config.js` 的 asset/resource 规则输出成独立文件）；
 * - 通道贴图走**递归** `require.context`（目录里 161 张 PNG 与改造前逐个 `require`
 *   的是同一批文件，输出路径 / contenthash 全都不变）；
 * - 图标走 `eager` 模板字符串 `import()`（沿用改造前的写法）。
 */

import type { AssetResolver } from './types';

/**
 * webpack `require.context` 的最小接口（@types/webpack-env 的 RequireContext
 * 返回 `any`，这里收窄成实际用到的两个成员）。
 */
interface RequireContext {
    keys(): string[];
    /**
     * 同步 context 返回模块导出。`asset/resource` 生成的是 **字符串 URL**
     * （`module.exports = __webpack_public_path__ + "models/x.glb"`），
     * 因此不能假设是 `{ default: url }`，取值时必须两种形态都兼容。
     */
    (id: string): unknown;
}

function createGlbContext(): RequireContext | null {
    try {
        // 必须先拿到 require.context(...) 的**调用结果**再判断类型。
        // 千万不要写成 `typeof require.context !== 'function'`：webpack 会把这个属性访问
        // 编译成「某个空模块的 .context」（恒为 undefined），判断永远成立，
        // 结果就是整个 GLB 功能静默失效、全部建筑回退元数据表（已实测验证）。
        const context = require.context('../../assets/icons/models', false, /\.glb$/i);
        return typeof context === 'function' ? context as unknown as RequireContext : null;
    }
    catch (e) {
        // 打包器不支持 require.context 时静默降级为“纯元数据表”模式
        console.warn('[glb] require.context 不可用，全部建筑回退元数据表', e);
        return null;
    }
}

function createTextureContext(): RequireContext | null {
    try {
        const context = require.context('../../assets/icons/models', true, /\.png$/i);
        return typeof context === 'function' ? context as unknown as RequireContext : null;
    }
    catch (e) {
        console.warn('[tex] require.context 不可用，全部贴图退回 GLB 内嵌底色', e);
        return null;
    }
}

/** 从 require.context 返回的模块导出里取出 URL：既支持字符串，也支持 `{ default }`。 */
function pickUrl(mod: unknown): string | null {
    if (typeof mod === 'string')
        return mod.length > 0 ? mod : null;
    const def = (mod as { default?: unknown } | null | undefined)?.default;
    return typeof def === 'string' && def.length > 0 ? def : null;
}

/** `./smelter.glb` → `smelter` */
function modelNameFromKey(key: string): string {
    const normalized = key.replace(/\\/g, '/');
    const base = normalized.slice(normalized.lastIndexOf('/') + 1);
    return base.replace(/\.glb$/i, '');
}

const glbContext = createGlbContext();
const textureContext = createTextureContext();

const glbKeys = new Set((glbContext?.keys() ?? []).map(key => key.replace(/^\.\//, '')));

/** `assets/icons/models/<建筑目录>/<文件>.png` → `<建筑目录>/<文件>.png` */
const MODEL_TEXTURE_KEY = /^.*assets\/icons\/models\//i;

const textureKeys = new Set((textureContext?.keys() ?? []).map(key => key.replace(/^\.\//, '')));

const glbModelNames: readonly string[] = (glbContext?.keys() ?? []).map(modelNameFromKey);

export const assetResolver: AssetResolver = {
    glbModelNames(): readonly string[] {
        return glbModelNames;
    },

    async glbModelUrl(name: string): Promise<string | null> {
        if (glbContext === null)
            return null;
        const key = `${name}.glb`;
        if (!glbKeys.has(key))
            return null;
        try {
            const url = pickUrl(await glbContext(`./${key}`));
            if (url === null)
                console.warn(`[glb] 模型 ${name} 没有解析出 URL，回退元数据表`);
            return url;
        }
        catch (e) {
            console.warn(`[glb] 模型 ${name} 的资源解析失败，回退元数据表`, e);
            return null;
        }
    },

    modelTextureUrl(srcRelativePath: string): string | null {
        if (textureContext === null)
            return null;
        const normalized = srcRelativePath.replace(/\\/g, '/');
        const relative = normalized.replace(MODEL_TEXTURE_KEY, '');
        if (relative === normalized || !textureKeys.has(relative))
            return null;
        try {
            return pickUrl(textureContext(`./${relative}`));
        }
        catch (e) {
            console.warn(`[tex] 贴图 ${srcRelativePath} 的资源解析失败`, e);
            return null;
        }
    },

    async itemRecipeIconUrl(name: string): Promise<string> {
        const mod = await import(/* webpackMode: "eager" */`@/assets/icons/item_recipe/${name}.png`);
        return mod.default;
    },

    async techIconUrl(techId: number): Promise<string> {
        const mod = await import(/* webpackMode: "eager" */`@/assets/icons/tech/${techId}.png`);
        return mod.default;
    },

    async signalIconUrl(signalId: number): Promise<string> {
        const mod = await import(/* webpackMode: "eager" */`@/assets/icons/signal/signal-${signalId}.png`);
        return mod.default;
    },
};
