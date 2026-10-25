/**
 * 外部 GLB 建筑模型资源注册表。
 *
 * 策略：外部 GLB 优先，`@/data/building` 的元数据表永远作为回退。
 *
 * 关键约束（请勿随意改动）：
 * 1. 目录/递归标记/过滤正则必须是**字面量**，webpack 在编译期静态解析这三个参数；
 *    换成变量会被 webpack 当成动态依赖而报错或整目录打包。
 * 2. 使用默认（同步）`require.context`：进主 bundle 的只有 **URL 字符串**（每个几十字节），
 *    .glb 文件本身由 `vue.config.js` 的 asset/resource 规则输出成独立文件，
 *    只有建筑真的出现时才 `fetch` 下载，因此首屏不会加载任何模型数据。
 * 3. `keys()` 只是编译期静态文件名列表，不产生任何网络请求，可以放心在模块初始化时调用；
 *    它也是“文件不存在 → 静默回退”的判定依据。
 */

/**
 * webpack `require.context` 的最小接口（@types/webpack-env 的 RequireContext
 * 返回 `any`，这里收窄成实际用到的两个成员）。
 */
interface GlbRequireContext {
    keys(): string[];
    /**
     * 同步 context 返回模块导出。`asset/resource` 生成的是 **字符串 URL**
     * （`module.exports = __webpack_public_path__ + "models/x.glb"`），
     * 因此不能假设是 `{ default: url }`，取值时必须两种形态都兼容。
     */
    (id: string): unknown;
}

function createGlbContext(): GlbRequireContext | null {
    try {
        // 必须先拿到 require.context(...) 的**调用结果**再判断类型。
        // 千万不要写成 `typeof require.context !== 'function'`：webpack 会把这个属性访问
        // 编译成「某个空模块的 .context」（恒为 undefined），判断永远成立，
        // 结果就是整个 GLB 功能静默失效、全部建筑回退元数据表（已实测验证）。
        const context = require.context('../assets/icons/models', false, /\.glb$/i);
        return typeof context === 'function' ? context as GlbRequireContext : null;
    } catch (e) {
        // 打包器不支持 require.context 时静默降级为“纯元数据表”模式
        console.warn('[glb] require.context 不可用，全部建筑回退元数据表', e);
        return null;
    }
}

const glbContext = createGlbContext();

/** `./smelter.glb` → `smelter` */
function modelNameFromKey(key: string): string {
    const normalized = key.replace(/\\/g, '/');
    const base = normalized.slice(normalized.lastIndexOf('/') + 1);
    return base.replace(/\.glb$/i, '');
}

/** 磁盘上实际存在的模型名（不含目录与扩展名），例如 `smelter`、`turret-laser`。 */
export const availableModelNames: ReadonlySet<string> = new Set(collectAvailableModelNames());

function collectAvailableModelNames(): string[] {
    if (glbContext === null)
        return [];
    try {
        return glbContext.keys().map(modelNameFromKey);
    } catch (e) {
        console.warn('[glb] 读取模型目录失败，全部建筑回退元数据表', e);
        return [];
    }
}

/** 一个图标名对应的模型描述 */
export interface ModelAlias {
    /** 首选模型名（不含 .glb） */
    primary: string;
    /** primary 缺失时按顺序尝试的备选文件 */
    fallbacks?: readonly string[];
    /** 变形模式：按 `Item.models` 中 modelIndex 的下标选取，优先于 primary/fallbacks */
    variants?: readonly string[];
    /** 说明，供 code review 与实现报告复核 */
    note: string;
}

/**
 * 显式别名表：`Item.icon` → 实际 GLB 文件名。
 *
 * 未在此表中登记且文件名与图标名不一致的，一律视为“未匹配”并回退元数据表，
 * 不做任何模糊匹配（避免把 A 建筑的模型错挂到 B 建筑上）。
 */
export const iconModelAliases: Readonly<Record<string, ModelAlias>> = {
    'assembler-1': {
        primary: 'assembler-1',
        fallbacks: ['assembler'],
        note: '制造台 Mk.I：实际导出名是 assembler-1（与 assembler 逐字节相同）；旧文档里的 lod1_0/lod2_0 文件并不存在，改为回退 assembler。',
    },
    'splitter-4dir': {
        primary: 'splitter-1',
        variants: ['splitter-1', 'splitter-2', 'splitter-3'],
        note: '四向分流器三种变形：Item.models=[38,39,40] 的下标 0/1/2 → splitter-1/2/3（对应 buildingMeta 里的 四向分流器 a/b/c）。',
    },
    'accumulator-full': {
        primary: 'accumulator',
        note: '蓄电器（满）与蓄电器共用同一个建筑模型，复用 accumulator.glb。',
    },
    // 以下两条虽然文件名与图标名一致，但显式登记，避免后来者误以为要把两代采矿机合并
    'mining-drill': {
        primary: 'mining-drill',
        note: '采矿机（Item 2301 / model 57）：独立模型，不与大型采矿机合并。',
    },
    'mining-drill-mk2': {
        primary: 'mining-drill-mk2',
        note: '大型采矿机（Item 2316 / model 256）：`mk2` 是导出名，等同于“大型采矿机”，用的是另一个 GLB。',
    },
};

/**
 * 图标名 + 变形下标 → 候选模型名（按优先级排列，首个在磁盘上存在的即为最终模型）。
 */
export function modelNameCandidates(iconName: string, variantIndex = 0): string[] {
    const alias = iconModelAliases[iconName];
    if (alias?.variants?.length) {
        const i = Math.max(0, Math.min(variantIndex, alias.variants.length - 1));
        return [alias.variants[i]];
    }
    if (alias !== undefined)
        return [alias.primary, ...(alias.fallbacks ?? [])];
    return [iconName];
}

/** 图标名 + 变形下标 → 实际可用的 GLB 模型名；无匹配返回 null（调用方回退元数据表）。 */
export function resolveModelName(iconName: string, variantIndex = 0): string | null {
    for (const name of modelNameCandidates(iconName, variantIndex)) {
        if (availableModelNames.has(name))
            return name;
    }
    return null;
}

const urlCache = new Map<string, Promise<string | null>>();

/**
 * 模型名 → 由 webpack 生成的最终 URL。
 *
 * - 模型未注册/文件不存在 → 返回 null（不抛错，不回退到猜路径）
 * - 同一个模型名只解析一次（缓存 Promise），重复调用共享结果
 * - 资源解析（chunk 加载）失败也只返回 null，由调用方静默回退元数据表
 */
/** 从 require.context 返回的模块导出里取出 URL：既支持字符串，也支持 `{ default }`。 */
function pickModelUrl(mod: unknown): string | null {
    if (typeof mod === 'string')
        return mod.length > 0 ? mod : null;
    const def = (mod as { default?: unknown } | null | undefined)?.default;
    return typeof def === 'string' && def.length > 0 ? def : null;
}

export function modelUrl(name: string): Promise<string | null> {
    const cached = urlCache.get(name);
    if (cached !== undefined)
        return cached;
    const task = (async (): Promise<string | null> => {
        if (glbContext === null || !availableModelNames.has(name))
            return null;
        try {
            const url = pickModelUrl(await glbContext(`./${name}.glb`));
            if (url === null)
                console.warn(`[glb] 模型 ${name} 没有解析出 URL，回退元数据表`);
            return url;
        } catch (e) {
            console.warn(`[glb] 模型 ${name} 的资源解析失败，回退元数据表`, e);
            return null;
        }
    })();
    urlCache.set(name, task);
    return task;
}
