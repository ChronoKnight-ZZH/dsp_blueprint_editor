/**
 * 「离线模型包」：把全部建筑模型 GLB 一次性下载并持久化到本地缓存。
 *
 * 背景：模型是**懒加载**的——只下载真的出现在蓝图里的那几个。这对首屏是对的，
 * 但用户一旦想「断网随便翻蓝图」，就得把 73 个模型（合计约 128 MB）预先备齐。
 * 这类成本必须**用户主动选择**才承担，所以入口是设置面板「高级」里的一个按钮，
 * 而不是启动时自动预取。
 *
 * 与 `glbLoader` 的关系：两者共用同一个缓存（`modelCache.ts` 的 `MODEL_CACHE_NAME`）。
 * - `glbLoader` 每成功加载一个模型就顺手落盘 → 看过的模型本来就能离线；
 * - 这里只是把「没看过的」补齐，并按文件粒度汇报进度；
 * - 缓存键是带内容哈希的 URL，所以下载完不会被后续版本误用，也不需要版本号字段。
 *
 * 进度语义：`completed / total` 都是**本次要补的文件数**（已缓存的不算），
 * 因此「取消 → 再点」是断点续传，已经落盘的文件不会重下。
 *
 * 持久化总开关（`config/persistence.config.js`）关闭时，缓存后端是空操作对象，
 * 本模块随之整体退化为「不支持」：`isPackSupported()` 为 false、界面按钮置灰、
 * 下载入口直接报错——不会出现「显示下载完成其实什么都没存」的假成功。
 */

import { availableModelNames, modelUrl } from "./glbAssets";
import {
    cachedModelUrls,
    clearModelCache,
    isModelCacheActive,
    modelCacheKey,
    readCachedModel,
    removeCachedModel,
    requestPersistentStorage,
    storeCachedModel,
} from "./modelCache";
import { isModelCacheEnabled } from "./modelCacheConfig";

/**
 * 构建期注入的模型大小清单（模型名 → 字节数），由 vue.config.js 的 DefinePlugin 生成。
 * 编辑器构建的 GLB 原样拷贝，所以源文件大小等于产物大小。
 * 库构建 / 单测没有注入时退化为空表：只显示数量，不显示大小。
 */
declare const __DSP_MODEL_BYTES__: Record<string, number> | undefined;

const MODEL_BYTES: Readonly<Record<string, number>> = (() => {
    try {
        if (
            typeof __DSP_MODEL_BYTES__ === "undefined" ||
            __DSP_MODEL_BYTES__ === null
        )
            return {};
        return __DSP_MODEL_BYTES__;
    } catch {
        return {};
    }
})();

/** 离线包里的一个文件 */
export interface PackFile {
    /** 模型名（不含 `.glb`） */
    readonly name: string;
    /** 最终可加载 URL（带内容哈希） */
    readonly url: string;
}

/** 离线包当前状态（只统计，不下载） */
export interface PackStatus {
    /** 持久化是否生效：开关打开**且**浏览器支持 Cache Storage */
    readonly supported: boolean;
    /** 离线包总文件数（= 磁盘上真实存在的 GLB 数量） */
    readonly total: number;
    /** 已经在本地缓存里的数量 */
    readonly cached: number;
    /** 还差多少（`total - cached`） */
    readonly missing: number;
    /**
     * 未缓存模型的总字节数。
     * `null` = 构建清单缺失（库构建/单测），此时调用方只显示数量。
     */
    readonly missingBytes: number | null;
    /** 本次顺手清掉的过期条目数（不属于当前构建的 URL） */
    readonly pruned: number;
}

/** 下载进度 */
export interface PackProgress {
    /** 本次已完成的文件数 */
    readonly completed: number;
    /** 本次需要下载的文件总数 */
    readonly total: number;
    /** 本次已接收的字节数 */
    readonly bytes: number;
    /** 正在下载的模型名（空闲时为 null） */
    readonly current: string | null;
}

/** 内部可变版本：导出给调用方的一律是快照（`readonly`），避免外部改到下载状态 */
interface MutableProgress {
    completed: number;
    total: number;
    bytes: number;
    current: string | null;
}

export interface DownloadPackOptions {
    /** 取消下载（`AbortController.signal`）：已完成的文件保留，正在下的那个丢弃 */
    readonly signal?: AbortSignal;
    /** 每个文件开始 / 进度 / 完成时回调 */
    readonly onProgress?: (progress: PackProgress) => void;
}

/** 浏览器是否支持把模型存到本地（且持久化开关没被关掉） */
export function isPackSupported(): boolean {
    return isModelCacheActive();
}

/**
 * 持久化全局开关是否打开（构建配置 `config/persistence.config.js` / 库宿主的运行时设置）。
 *
 * 与浏览器能力无关：为 `false` 时界面应提示「本地持久化已关闭」，
 * 而不是把锅甩给浏览器（`isPackSupported()` 在两种情况下都是 false）。
 */
export function isPersistenceEnabled(): boolean {
    return isModelCacheEnabled();
}

/**
 * 离线包清单：模型名 → 最终 URL。
 * URL 由资源解析层给出（编辑器构建是 webpack 生成的 publicPath + 内容哈希），
 * 解析失败的模型直接跳过（`modelUrl` 返回 null 就是「文件不存在」）。
 */
export async function resolvePackFiles(): Promise<PackFile[]> {
    const names = Array.from(availableModelNames).sort();
    const files: PackFile[] = [];
    for (const name of names) {
        const url = await modelUrl(name);
        if (url !== null) files.push({ name, url });
    }
    return files;
}

/**
 * 只统计，不下载：本地缓存已覆盖多少。
 *
 * 顺手清掉**不属于当前构建**的条目：模型 URL 带内容哈希，旧版本的 URL 永远
 * 不会再被请求，留着只会白占空间（每发一版最多累积 128 MB）。
 * `files.length === 0` 时（资源解析整体失败）**不清**，避免把有效缓存误删光。
 */
export async function inspectPack(): Promise<PackStatus> {
    if (!isPackSupported())
        return {
            supported: false,
            total: 0,
            cached: 0,
            missing: 0,
            missingBytes: null,
            pruned: 0,
        };

    const files = await resolvePackFiles();
    const current = new Set(files.map((file) => modelCacheKey(file.url)));
    const cached = await cachedModelUrls();

    let pruned = 0;
    if (current.size > 0) {
        for (const url of Array.from(cached)) {
            if (current.has(url)) continue;
            cached.delete(url);
            if (await removeCachedModel(url)) pruned++;
        }
    }

    let hit = 0;
    let missingBytes = 0;
    let bytesKnown = true;
    for (const file of files) {
        if (cached.has(modelCacheKey(file.url))) {
            hit++;
            continue;
        }
        const bytes = MODEL_BYTES[file.name];
        if (typeof bytes !== "number" || bytes <= 0) bytesKnown = false;
        else missingBytes += bytes;
    }
    return {
        supported: true,
        total: files.length,
        cached: hit,
        missing: files.length - hit,
        missingBytes: bytesKnown ? missingBytes : null,
        pruned,
    };
}

/** 读空响应体并统计字节数，拼成 Blob（`Response.body` 缺失时退化为 `blob()`） */
async function readBlob(
    response: Response,
    onBytes: (received: number) => void
): Promise<Blob> {
    const body = response.body;
    if (body === null) return response.blob();

    const reader = body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (value === undefined) continue;
        chunks.push(value as unknown as BlobPart);
        received += value.byteLength;
        onBytes(received);
    }
    return new Blob(chunks, { type: "model/gltf-binary" });
}

function abortError(): Error {
    // DOMException 在浏览器与 Node 18+ 都有；退化成普通 Error 时用 name 判定
    try {
        return new DOMException("已取消下载", "AbortError");
    } catch {
        const error = new Error("已取消下载");
        error.name = "AbortError";
        return error;
    }
}

/** 是否是「用户取消」导致的失败（调用方据此区分取消与真错误） */
export function isAbortError(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === "AbortError";
}

/**
 * 下载还缺的模型。
 *
 * - 只下载**缺失**的文件：已缓存的不重下，所以取消后再点是续传；
 * - 顺序下载（并发 1）：进度按文件粒度推进，不会被并发请求搅乱，
 *   也不会在移动端同时占满多个连接；
 * - 任一文件失败就抛错，其余已完成的文件保持有效；
 * - 用户取消时抛 `AbortError`，正在下载的那个文件**不落盘**（不留半成品）。
 */
export async function downloadPack(
    options: DownloadPackOptions = {}
): Promise<PackProgress> {
    const { signal, onProgress } = options;
    if (!isPackSupported())
        throw new Error(
            isModelCacheEnabled()
                ? "当前浏览器不支持本地缓存"
                : "本地持久化已关闭（config/persistence.config.js）"
        );

    const files = await resolvePackFiles();
    const cached = await cachedModelUrls();
    const pending = files.filter(
        (file) => !cached.has(modelCacheKey(file.url))
    );

    const progress: MutableProgress = {
        completed: 0,
        total: pending.length,
        bytes: 0,
        current: null,
    };
    onProgress?.({ ...progress });
    if (pending.length === 0) return progress;

    // 用户已经明确要这份数据：顺手申请持久化权限，降低被浏览器按配额清掉的概率
    await requestPersistentStorage();

    for (const file of pending) {
        if (signal?.aborted === true) throw abortError();

        // 期间可能已被 glbLoader 顺手缓存（模型刚好被显示）：跳过重复下载
        if ((await readCachedModel(file.url)) !== null) {
            progress.completed++;
            onProgress?.({ ...progress });
            continue;
        }

        progress.current = file.name;
        onProgress?.({ ...progress });

        const response = await fetch(
            file.url,
            signal === undefined ? undefined : { signal }
        );
        if (!response.ok)
            throw new Error(`下载失败：${file.name}（HTTP ${response.status}）`);

        const blob = await readBlob(response, (received) => {
            onProgress?.({ ...progress, bytes: progress.bytes + received });
        });
        const stored = await storeCachedModel(file.url, blob);
        if (!stored)
            throw new Error(
                `无法写入本地缓存：${file.name}（存储空间可能已满）`
            );

        progress.bytes += blob.size;
        progress.completed++;
        progress.current = null;
        onProgress?.({ ...progress });
    }

    return progress;
}

/** 清空本地模型缓存（离线包 + 顺手缓存的已看过模型），返回删除条数 */
export async function clearPack(): Promise<number> {
    return clearModelCache();
}
