/**
 * 资产根地址（`assets/` 的父目录）与 URL 拼接。
 *
 * 只有库构建（UMD/ESM）会用到；编辑器构建里资产 URL 由 webpack `publicPath`
 * 生成，`configureAssetBaseUrl` 保留为空实现——两种形态签名一致，宿主不用担心。
 *
 * 三种取值来源，优先级从高到低：
 * 1. `configureAssetBaseUrl(url)` 显式指定（推荐 npm/CDN 宿主使用）；
 * 2. 加载本库的那个 `<script src>` 所在目录（纯静态 `<script>` 标签场景，默认值）；
 * 3. `document.baseURI`（ESM / 打包器宿主，通常需要配合 1 显式指定）。
 *
 * 因此 `dist-lib/` 整个目录被搬到任何路径、任何子目录下，只要 `host-test.html`
 * 与 `assets/` 保持相对位置，URL 就自动正确，无需改代码。
 */

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

/** 把「含 assets/ 的目录」归一成「assets/ 目录本身」 */
function toAssetsRoot(dirUrl: string): string {
    if (dirUrl === '')
        return '';
    const withoutTrailing = dirUrl.replace(/\/+$/, '');
    if (/\/assets$/i.test(withoutTrailing))
        return `${withoutTrailing}/`;
    return `${withoutTrailing}/assets/`;
}

/**
 * 配置资产根地址。
 *
 * @param baseUrl 含 `assets/` 的那个目录（写成 `.../assets` 本身也接受）。
 *                传 `null` / `undefined` / `''` 清除配置，回到自动探测。
 */
export function configureAssetBaseUrl(baseUrl: string | null | undefined): void {
    configuredBaseUrl = baseUrl === null || baseUrl === undefined || baseUrl.trim() === ''
        ? null
        : baseUrl;
}

/** 当前生效的 `assets/` 目录（末尾带 `/`；空串表示「相对当前页面」） */
export function currentAssetBaseUrl(): string {
    if (configuredBaseUrl !== null)
        return toAssetsRoot(toDirectoryUrl(configuredBaseUrl));

    const detected = scriptBaseUrl ?? documentBaseUrl();
    if (detected !== null)
        return toAssetsRoot(detected);

    // 没有任何可探测的基准：退成相对页面的路径，交给浏览器解析
    return 'assets/';
}

/**
 * `assets/` 内的相对路径 → 可加载 URL。
 *
 * @param relativePath 形如 `models/smelter.glb`、`icons/tech/1001.png`
 */
export function resolveAssetUrl(relativePath: string): string {
    const path = relativePath.replace(/^\/+/, '');
    const root = currentAssetBaseUrl();
    if (root === '' || root === '/')
        return `assets/${path}`;
    return root.endsWith('/') ? `${root}${path}` : `${root}/${path}`;
}
