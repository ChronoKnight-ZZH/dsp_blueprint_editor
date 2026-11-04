/**
 * KTX2 / Basis Universal 运行时支持（懒加载 + 失败降级）。
 *
 * 背景：优化后的 GLB 里贴图是 KTX2（`KHR_texture_basisu`），必须给 `GLTFLoader`
 * 挂一个配置好的 `KTX2Loader` 才能解析：
 *
 * ```ts
 * loader.setKTX2Loader(ktx2Loader);
 * ```
 *
 * 两个必须做对、否则一定翻车的点（都在这里收口）：
 * 1. **`setTranscoderPath()`** 必须指向 `basis_transcoder.js` + `basis_transcoder.wasm`
 *    所在目录，**末尾带斜杠**。本项目把它们放在 `public/basis/`（用
 *    `scripts/glb-ktx2/copy-basis-transcoder.mjs` 从 three 里拷），所以运行期路径是
 *    编辑器：`${BASE_URL}basis/`；库构建：`resolveAssetUrl("basis/")`（跟随
 *    `configureAssetBaseUrl` / `import.meta.url` / `<script src>` 自动探测）。
 * 2. **`detectSupport(renderer)`** 必须调，且必须在渲染器创建之后。它决定把 KTX2 转成
 *    哪个 GPU 格式（ASTC / ETC2 / BC7 / PVRTC / RGBA32），猜错在 iOS 和部分安卓上
 *    会得到黑图。所以这里需要宿主注入渲染器（`setKtx2Renderer`）。
 *
 * 为什么渲染器要外部注入：`glbLoader.parseGlb()` 手里只有 `ArrayBuffer`，没有渲染器；
 * 而本项目有多个 `new WebGLRenderer()` 的位置（编辑器、库模式 RenderCore）。
 *
 * 契约：**永不 throw、永不 reject**。没注册渲染器或转码器文件缺失时返回 `null`，
 * 调用方照常解析（老 GLB 不受影响；带 KTX2 的 GLB 会由 GLTFLoader 自己报错，
 * 再由 `glbLoader` 的既有兜底逻辑降级成元数据盒）。
 */

import { resolveAssetUrl } from "@/lib/assets/assetBaseUrl";

/**
 * 构建期注入的转码器目录（编辑器构建走 vue.config.js 的 `publicPath`，
 * 见 `__DSP_TRANSCODER_BASE__` 的 DefinePlugin）。UMD/ESM 库构建里没有这个常量。
 */
declare const __DSP_TRANSCODER_BASE__: string | undefined;

/** `KTX2Loader` 里我们真正用到的两个方法（避免依赖 @types/three 的完整形状） */
interface Ktx2LoaderLike {
    setTranscoderPath(path: string): Ktx2LoaderLike;
    detectSupport(renderer: unknown): Ktx2LoaderLike;
}

interface Ktx2LoaderModule {
    KTX2Loader: new () => Ktx2LoaderLike;
}

/**
 * 转码器所在目录，`setTranscoderPath` 要求末尾带斜杠。
 *
 * 三级回退，顺序不能换：
 * 1. **构建期常量**（编辑器构建）：`/dsp_blueprint_editor/basis/`。
 *    不能用 `process.env.BASE_URL`：webpack 5 不再注入 `process`，
 *    `typeof process !== 'undefined'` 会被常量折叠成 false、整段分支被删掉，
 *    最后落到第 3 级 → 得到「相对当前 JS chunk」的 `/dsp_blueprint_editor/js/basis/`
 *    → 404 → 所有模型的贴图全部加载失败、退回元数据盒（已实测踩到过）。
 * 2. 库构建（UMD / ESM）：`resolveAssetUrl("basis/")` 跟随 `configureAssetBaseUrl(...)`、
 *    `import.meta.url` 或 `<script src>` 自动探测，宿主把 `dist-lib/` 搬到任何
 *    子目录、任何 CDN 下都能命中 `basis/basis_transcoder.js`。
 * 3. 最后兜底：同样走 `resolveAssetUrl`。
 */
function transcoderPath(): string {
    try {
        if (typeof __DSP_TRANSCODER_BASE__ === "string" && __DSP_TRANSCODER_BASE__.length > 0) {
            return __DSP_TRANSCODER_BASE__.endsWith("/")
                ? __DSP_TRANSCODER_BASE__
                : `${__DSP_TRANSCODER_BASE__}/`;
        }
    } catch {
        /* 常量不存在（库构建 / 单测）：走下一级 */
    }
    return resolveAssetUrl("basis/");
}

let rendererRef: unknown = null;
let loaderPromise: Promise<Ktx2LoaderLike | null> | null = null;
let warnedNoRenderer = false;

/**
 * 注入渲染器（每个 `new WebGLRenderer()` 之后调一次，可重复调用）。
 *
 * 重复调用会重置缓存的 loader：不同渲染器的能力集可能不同，必须重新 detectSupport。
 */
export function setKtx2Renderer(renderer: unknown): void {
    if (renderer === null || renderer === undefined) return;
    if (rendererRef === renderer) return;
    rendererRef = renderer;
    loaderPromise = null;
    warnedNoRenderer = false;
}

/** 当前是否具备 KTX2 解析能力（有渲染器即有） */
export function isKtx2Supported(): boolean {
    return rendererRef !== null;
}

/**
 * 取（带缓存的）`KTX2Loader`。未注册渲染器时返回 `null`。
 *
 * 首次调用才加载 `ktx2-loader` chunk：没有 KTX2 资源的场景零开销。
 */
export function getKtx2Loader(): Promise<Ktx2LoaderLike | null> {
    if (rendererRef === null) {
        if (!warnedNoRenderer) {
            warnedNoRenderer = true;
            console.warn(
                "[ktx2] 还没有注册渲染器：调用 setKtx2Renderer(renderer) 之后才能解析 KTX2 贴图"
            );
        }
        return Promise.resolve(null);
    }
    if (loaderPromise !== null) return loaderPromise;

    const renderer = rendererRef;
    loaderPromise = (async (): Promise<Ktx2LoaderLike | null> => {
        try {
            const mod = (await import(
                /* webpackChunkName: "ktx2-loader" */ "three/examples/jsm/loaders/KTX2Loader.js"
            )) as unknown as Ktx2LoaderModule;
            const loader = new mod.KTX2Loader();
            loader.setTranscoderPath(transcoderPath());
            loader.detectSupport(renderer);
            return loader;
        } catch (e) {
            console.warn(
                `[ktx2] 转码器初始化失败（模型带 KTX2 贴图时会退化为无贴图）：${transcoderPath()}`,
                e
            );
            // 失败不缓存，允许下次重试（例如 public/basis 刚补上）
            loaderPromise = null;
            return null;
        }
    })();
    return loaderPromise;
}

/** 释放 loader（渲染器销毁时调用，避免持有已失效的 GPU 能力信息） */
export function disposeKtx2Loader(): void {
    rendererRef = null;
    loaderPromise = null;
}
