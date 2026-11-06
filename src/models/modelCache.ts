/**
 * 建筑模型（GLB）的**浏览器本地持久化缓存**（Cache Storage）。
 *
 * 为什么是 Cache Storage 而不是 IndexedDB：模型是大二进制（单文件最大 ~5.5 MB、
 * 全库 ~128 MB），Cache Storage 就是浏览器为「按 URL 存 Response」设计的存储，
 * 与 `fetch` 的 Request/Response 天然对齐——命中判定、整体清理、按 URL 覆盖都是
 * 原生语义，不需要自己维护 ArrayBuffer 序列化与版本表。（Cache Storage 本身就是
 * 持久化存储：关标签、重启浏览器、断网都还在，配额不足时才由浏览器清理。）
 *
 * 由**页面**直接读写，不依赖 service worker：首次访问、SW 尚未接管、隐私模式
 * 下同样有效。
 *
 * 缓存键是模型的最终 URL：编辑器构建里带 `[contenthash:8]`（`models/x.a1b2c3d4.glb`），
 * 内容一变 URL 就变，因此**不需要额外的版本表**——旧文件自然失效，新文件自然下载。
 *
 * ## 降级：一个「空操作」缓存对象（Null Object）
 *
 * 持久化有**全局开关**（`config/persistence.config.js` → `__DSP_MODEL_CACHE_ENABLED__`，
 * 库宿主可用 `setModelCacheEnabled()` 覆盖，见 `modelCacheConfig.ts`）。
 * 开关关闭时，或环境不支持 Cache Storage（老浏览器 / 非安全上下文 / Node 单测）时，
 * `getModelCache()` 返回 `NoopModelCache`：读永远未命中、写永远失败、清单永远为空、
 * 清空永远 0 条，并且**完全不碰 `caches`**。调用方（`glbLoader` / `modelPack` / 宿主）
 * 因此不需要任何 `if (开关)` 分支——「关闭」和「不可用」是同一条降级路径。
 */

import { isModelCacheEnabled } from "./modelCacheConfig";

/** 缓存名（只放建筑模型的 GLB；与将来可能接入的 SW 运行时缓存保持同名，避免存两遍） */
export const MODEL_CACHE_NAME = "dsp-models-v1";

/** 写入时的 MIME（读取方按 ArrayBuffer 解析，标注只是给 DevTools 看的） */
export const MODEL_CONTENT_TYPE = "model/gltf-binary";

/**
 * 一个模型缓存后端需要的全部操作。
 *
 * 页面侧只依赖这 5 个方法，所以「真实后端」和「空操作后端」可以互换；
 * 调用方拿到的永远是这个接口，不需要知道后面是不是真的在写盘。
 */
export interface ModelCache {
    /** 后端身份：`noop` = 所有操作都是空操作（诊断 / 单测用；正常情况下只差这一个字段） */
    readonly kind: "cache-storage" | "noop";
    /** 读：未命中 / 不可用 / 读失败一律返回 `null`（永不抛错） */
    read(url: string): Promise<Response | null>;
    /** 写：返回是否真的写进去了；失败只 warn，不影响本次渲染 */
    store(
        url: string,
        data: Blob | ArrayBuffer,
        contentType?: string
    ): Promise<boolean>;
    /** 删单条：本地副本损坏（parse 失败）时丢掉它，下次重新下载 */
    remove(url: string): Promise<boolean>;
    /** 缓存里已存在的**绝对 URL** 集合（供「离线包还差哪些」比对） */
    keys(): Promise<Set<string>>;
    /** 清空整个缓存，返回删除的条目数 */
    clear(): Promise<number>;
}

/** 当前环境是否支持 Cache Storage（非安全上下文 / 老浏览器 / Node 单测里都是 false） */
export function isModelCacheSupported(): boolean {
    try {
        return typeof caches !== "undefined" && typeof caches.open === "function";
    } catch {
        return false;
    }
}

/**
 * 持久化是否**真的生效**：开关打开且环境支持。
 * 调用方（如离线模型包）用它判断「能不能存」，不要分别判断两个条件。
 */
export function isModelCacheActive(): boolean {
    return isModelCacheEnabled() && isModelCacheSupported();
}

/**
 * URL 归一化：Cache Storage 的键永远是**绝对 URL**，而资源解析层给出的是
 * `publicPath` 形态的路径（`/dsp_blueprint_editor/models/x.glb`）。
 * 读写与比对都走这个函数，避免同一个文件出现两种键。
 */
export function modelCacheKey(url: string): string {
    try {
        const base = typeof document === "undefined" ? undefined : document.baseURI;
        return new URL(url, base).href;
    } catch {
        // 没有基准（Node 单测）或 URL 非法：原样返回，调用方两侧一致即可
        return url;
    }
}

async function openModelCache(): Promise<Cache | null> {
    // 后端只在 `getModelCache()` 判定可用时才会被选中；这里再挡一次，
    // 兼容「拿到后端之后环境变了」（例如单测里删掉 caches）的情况。
    if (!isModelCacheSupported()) return null;
    try {
        return await caches.open(MODEL_CACHE_NAME);
    } catch (e) {
        console.warn("[glb] 打开本地模型缓存失败（本次走网络）", e);
        return null;
    }
}

/** 真实后端：Cache Storage。只有 `getModelCache()` 认为可用时才会被调用 */
const cacheStorageBackend: ModelCache = {
    kind: "cache-storage",

    async read(url: string): Promise<Response | null> {
        const cache = await openModelCache();
        if (cache === null) return null;
        try {
            return (await cache.match(modelCacheKey(url))) ?? null;
        } catch (e) {
            console.warn("[glb] 读取本地模型缓存失败（本次走网络）", e);
            return null;
        }
    },

    async store(
        url: string,
        data: Blob | ArrayBuffer,
        contentType: string = MODEL_CONTENT_TYPE
    ): Promise<boolean> {
        const cache = await openModelCache();
        if (cache === null) return false;
        try {
            await cache.put(
                modelCacheKey(url),
                new Response(data, { headers: { "Content-Type": contentType } })
            );
            return true;
        } catch (e) {
            console.warn("[glb] 写入本地模型缓存失败（不影响本次渲染）", e);
            return false;
        }
    },

    async remove(url: string): Promise<boolean> {
        const cache = await openModelCache();
        if (cache === null) return false;
        try {
            return await cache.delete(modelCacheKey(url));
        } catch (e) {
            console.warn("[glb] 删除本地模型缓存失败", e);
            return false;
        }
    },

    async keys(): Promise<Set<string>> {
        const cache = await openModelCache();
        if (cache === null) return new Set<string>();
        try {
            const keys = await cache.keys();
            return new Set(keys.map((request) => request.url));
        } catch (e) {
            console.warn("[glb] 读取本地模型缓存清单失败", e);
            return new Set<string>();
        }
    },

    async clear(): Promise<number> {
        const cache = await openModelCache();
        if (cache === null) return 0;
        try {
            const keys = await cache.keys();
            for (const request of keys) await cache.delete(request);
            return keys.length;
        } catch (e) {
            console.warn("[glb] 清空本地模型缓存失败", e);
            return 0;
        }
    },
};

/**
 * **空操作缓存对象**（Null Object 模式）。
 *
 * 持久化开关关闭、或环境不支持 Cache Storage 时由 `getModelCache()` 返回。
 * 每个方法都立即返回「未命中 / 失败 / 空」的既定结果，**不读 `caches`、不发请求、
 * 不抛错、不打印日志**——所以关掉持久化后，缓存相关的调用在运行时就是免费的，
 * 调用方也完全不需要分支判断。
 *
 * 冻结：这个对象是全局共享的单例，防止任何调用方给它挂方法。
 */
export const NoopModelCache: ModelCache = Object.freeze({
    kind: "noop",
    read: () => Promise.resolve(null),
    store: () => Promise.resolve(false),
    remove: () => Promise.resolve(false),
    keys: () => Promise.resolve(new Set<string>()),
    clear: () => Promise.resolve(0),
});

/**
 * 当前生效的缓存后端。
 *
 * 开关关闭 → 空操作对象；环境不支持 → 同一个空操作对象；两者都不区分，
 * 因为对调用方来说结果完全一样（都是「不会命中、不会写盘」）。
 */
export function getModelCache(): ModelCache {
    if (!isModelCacheEnabled() || !isModelCacheSupported())
        return NoopModelCache;
    return cacheStorageBackend;
}

// ---------------------------------------------------------------- 便捷函数
//
// 历史 API（也是 `glbLoader` / `modelPack` / 单测直接用的形态）：一律转发给
// `getModelCache()`，因此自动继承「关闭即空操作」的语义。

/** 读取缓存的模型响应；未命中 / 不可用 / 读失败 / 开关关闭一律返回 null（永不抛错） */
export function readCachedModel(url: string): Promise<Response | null> {
    return getModelCache().read(url);
}

/** 写入模型数据；返回是否真的写进去了（开关关闭时为 false） */
export function storeCachedModel(
    url: string,
    data: Blob | ArrayBuffer,
    contentType: string = MODEL_CONTENT_TYPE
): Promise<boolean> {
    return getModelCache().store(url, data, contentType);
}

/**
 * 删除单条缓存。用途：本地副本损坏（parse 失败）时丢掉它，下次重新下载——
 * 否则坏数据会一直命中，用户看起来就是「这个模型永远是白模」。
 */
export function removeCachedModel(url: string): Promise<boolean> {
    return getModelCache().remove(url);
}

/** 缓存里已存在的**绝对 URL** 集合（供「离线包还差哪些」比对） */
export function cachedModelUrls(): Promise<Set<string>> {
    return getModelCache().keys();
}

/** 清空整个模型缓存，返回删除的条目数（开关关闭时为 0） */
export function clearModelCache(): Promise<number> {
    return getModelCache().clear();
}

/**
 * 申请「持久化存储」权限：没有它，浏览器在磁盘紧张时会按 LRU 清掉 Cache Storage。
 * 用户主动点了下载才调用；被拒绝（浏览器直接返回 false）不是错误。
 * 持久化开关关闭时不弹权限请求，直接返回 false。
 */
export async function requestPersistentStorage(): Promise<boolean> {
    if (!isModelCacheEnabled()) return false;
    try {
        if (typeof navigator === "undefined") return false;
        const storage = navigator.storage;
        if (storage === undefined || typeof storage.persist !== "function")
            return false;
        if (
            typeof storage.persisted === "function" &&
            (await storage.persisted())
        )
            return true;
        return await storage.persist();
    } catch {
        return false;
    }
}
