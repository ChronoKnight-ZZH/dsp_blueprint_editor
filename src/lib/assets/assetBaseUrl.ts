/**
 * 资产根地址（`models/` 与 `img/` 的父目录）与 URL 拼接。
 *
 * 只有库构建（UMD/ESM）会用到；编辑器构建里资产 URL 由 webpack `publicPath`
 * 生成，`configureAssetBaseUrl` 保留为空实现——两种形态签名一致，宿主不用担心。
 *
 * 四种取值来源，优先级从高到低：
 * 1. `configureAssetBaseUrl(url)` 显式指定（推荐需要自定义 CDN/子路径的宿主使用）；
 * 2. `import.meta.url`（ESM 产物：构建期由 webpack 注入，指向产物 chunk 自身 URL）。
 *    Vite dev、Vite/Rollup 打包产物、原生 `<script type="module">` 都成立，
 *    因此把 `models/`、`img/` 放在产物（chunk）同目录即可自动命中，宿主零配置。
 *    注意：打包后 `import.meta.url` 是**宿主 chunk**（如 `/assets/index-xxx.js`）的 URL，
 *    生产环境要么把资产放到该 chunk 同级，要么用 `configureAssetBaseUrl` 指向 public 副本；
 * 3. 加载本库的那个 `<script src>` 所在目录（UMD 场景，默认值）；
 * 4. `document.baseURI`（都探测不到时的最后兜底）。
 *
 * 因此 `dist-lib/` 整个目录被搬到任何路径、任何子目录下，只要 `host-test.html`
 * 与 `models/`、`img/` 保持相对位置，URL 就自动正确，无需改代码。
 */

/**
 * 构建期注入的「模块自身 URL」。
 *
 * - ESM 产物：`DefinePlugin` 注入 `import.meta.url`（见 `scripts/lib-build/build.js`）；
 * - UMD 产物 / 编辑器构建 / 单测：注入 `undefined`（或根本没注入）。
 *
 * 不能直接在源码里写 `import.meta.url`：UMD 是非 ESM 输出，webpack 会拒绝解析
 * `import.meta`；`typeof` 守卫保证在没注入的环境里也不会抛 ReferenceError。
 */
declare const __DSP_LIB_MODULE_URL__: string | undefined;

/** 用户显式配置的资产根（null = 未配置，走自动探测） */
let configuredBaseUrl: string | null = null;

/**
 * 脚本自身所在目录。
 *
 * 必须在模块求值期抓取：`document.currentScript` 只在「正在执行的那个脚本」
 * 期间有意义，异步之后取到的永远是 null。
 */
const scriptBaseUrl: string | null = detectScriptBaseUrl();

function detectScriptBaseUrl(): string | null {
    try {
        if (typeof document === 'undefined')
            return null;
        const current = document.currentScript as HTMLScriptElement | null;
        const src = current?.src;
        if (typeof src === 'string' && src.length > 0)
            return new URL('.', src).href;
    }
    catch {
        // 探测失败不是错误：退到 document.baseURI
    }
    return null;
}

/**
 * ESM 产物自身 URL 所在目录。
 *
 * `import.meta.url` 是**产物文件**的 URL（Vite dev 下是源码模块 URL，打包后是 chunk URL），
 * 与「页面地址」无关，这正是宿主把 `models/`、`img/` 放在产物旁边就能自动命中的原因。
 */
function detectModuleBaseUrl(): string | null {
    try {
        // 必须用 typeof 守卫：UMD / 编辑器构建 / 单测里这个标识符不存在
        if (typeof __DSP_LIB_MODULE_URL__ !== 'string' || __DSP_LIB_MODULE_URL__.length === 0)
            return null;
        return new URL('.', __DSP_LIB_MODULE_URL__).href;
    }
    catch {
        // 非法 URL（例如测试里注入了占位串）时静默跳过
    }
    return null;
}

function documentBaseUrl(): string | null {
    try {
        if (typeof document === 'undefined')
            return null;
        const baseURI = document.baseURI;
        if (typeof baseURI === 'string' && baseURI.length > 0)
            return new URL('.', baseURI).href;
    }
    catch {
        // ignore
    }
    return null;
}

/** 统一成「目录形式」：绝对 URL 或相对路径，末尾一定有 `/` */
function toDirectoryUrl(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === '')
        return '';
    // 允许宿主写成绝对 URL / 根相对路径 / 相对路径三种形态
    try {
        if (typeof document !== 'undefined')
            return new URL(trimmed.endsWith('/') ? trimmed : `${trimmed}/`, document.baseURI).href;
    }
    catch {
        // 没有 document（SSR / 单测）时按字符串处理
    }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** 目录 URL 统一成末尾带 `/` 的形态 */
function toRootUrl(dirUrl: string): string {
    if (dirUrl === '')
        return '';
    return `${dirUrl.replace(/\/+$/, '')}/`;
}

/**
 * 配置资产根地址。
 *
 * @param baseUrl 库产物根目录（含 `models/` 与 `img/` 的那一级）。
 *                传 `null` / `undefined` / `''` 清除配置，回到自动探测。
 */
export function configureAssetBaseUrl(baseUrl: string | null | undefined): void {
    configuredBaseUrl = baseUrl === null || baseUrl === undefined || baseUrl.trim() === ''
        ? null
        : baseUrl;
}

/** 当前生效的产物根目录（末尾带 `/`；空串表示「相对当前页面」） */
export function currentAssetBaseUrl(): string {
    if (configuredBaseUrl !== null)
        return toRootUrl(toDirectoryUrl(configuredBaseUrl));

    // ESM 优先：打包器里 import.meta.url 一定指向本 chunk，比 currentScript 可靠
    // （module script 的 document.currentScript 恒为 null）。
    const detected = detectModuleBaseUrl() ?? scriptBaseUrl ?? documentBaseUrl();
    if (detected !== null)
        return toRootUrl(detected);

    // 没有任何可探测的基准：退成相对页面的路径，交给浏览器解析
    return '';
}

/**
 * 产物内的相对路径 → 可加载 URL。
 *
 * @param relativePath 形如 `models/smelter.glb`、`img/tech/1001.png`
 */
export function resolveAssetUrl(relativePath: string): string {
    const path = relativePath.replace(/^\/+/, '');
    const root = currentAssetBaseUrl();
    return root === '' ? path : `${root}${path}`;
}
