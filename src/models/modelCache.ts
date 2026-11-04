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
 * 下同样有效；`caches` 不可用（老浏览器 / 非安全上下文）时全部退化为空操作，
 * 调用方不会因此报错。
 *
 * 缓存键是模型的最终 URL：编辑器构建里带 `[contenthash:8]`（`models/x.a1b2c3d4.glb`），
 * 内容一变 URL 就变，因此**不需要额外的版本表**——旧文件自然失效，新文件自然下载。
 */

/** 缓存名（只放建筑模型的 GLB；与将来可能接入的 SW 运行时缓存保持同名，避免存两遍） */
export const MODEL_CACHE_NAME = "dsp-models-v1";

/** 写入时的 MIME（读取方按 ArrayBuffer 解析，标注只是给 DevTools 看的） */
export const MODEL_CONTENT_TYPE = "model/gltf-binary";

/** 当前环境是否支持 Cache Storage（非安全上下文 / 老浏览器 / Node 单测里都是 false） */
export function isModelCacheSupported(): boolean {
    try {
        return typeof caches !== "undefined" && typeof caches.open === "function";
    } catch {
        return false;
    }
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
    if (!isModelCacheSupported()) return null;
    try {
        return await caches.open(MODEL_CACHE_NAME);
    } catch (e) {
        console.warn("[glb] 打开本地模型缓存失败（本次走网络）", e);
        return null;
    }
}

/** 读取缓存的模型响应；未命中 / 不可用 / 读失败一律返回 null（永不抛错） */
export async function readCachedModel(url: string): Promise<Response | null> {
    const cache = await openModelCache();
    if (cache === null) return null;
    try {
        return (await cache.match(modelCacheKey(url))) ?? null;
    } catch (e) {
        console.warn("[glb] 读取本地模型缓存失败（本次走网络）", e);
        return null;
    }
}

/**
 * 写入模型数据；返回是否真的写进去了。
 * 失败（配额不足、隐私模式、缓存不可用）只 warn，不影响本次渲染。
 */
export async function storeCachedModel(
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
}

/**
 * 删除单条缓存。用途：本地副本损坏（parse 失败）时丢掉它，下次重新下载——
 * 否则坏数据会一直命中，用户看起来就是「这个模型永远是白模」。
 */
export async function removeCachedModel(url: string): Promise<boolean> {
    const cache = await openModelCache();
    if (cache === null) return false;
    try {
        return await cache.delete(modelCacheKey(url));
    } catch (e) {
        console.warn("[glb] 删除本地模型缓存失败", e);
        return false;
    }
}

/** 缓存里已存在的**绝对 URL** 集合（供「离线包还差哪些」比对） */export async function cachedModelUrls(): Promise<Set<string>> {
    const cache = await openModelCache();
    if (cache === null) return new Set<string>();
    try {
        const keys = await cache.keys();
        return new Set(keys.map((request) => request.url));
    } catch (e) {
        console.warn("[glb] 读取本地模型缓存清单失败", e);
        return new Set<string>();
    }
}

/** 清空整个模型缓存，返回删除的条目数 */
export async function clearModelCache(): Promise<number> {
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
}

/**
 * 申请「持久化存储」权限：没有它，浏览器在磁盘紧张时会按 LRU 清掉 Cache Storage。
 * 用户主动点了下载才调用；被拒绝（浏览器直接返回 false）不是错误。
 */
export async function requestPersistentStorage(): Promise<boolean> {
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
