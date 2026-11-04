/**
 * 离线模型包：缓存读写、只补缺失、进度与取消。
 *
 * 单测里没有浏览器，`caches` / `fetch` / `document` 都是手搓的最小实现：
 * - `FakeCacheStorage` 只实现 `modelCache.ts` 真正用到的 open/match/put/keys/delete；
 * - `document.baseURI` 必须给，否则相对 URL 归一化成不了绝对 URL
 *   （真实浏览器里 Cache Storage 的键一律是绝对 URL）。
 */

import { availableModelNames, modelUrl } from "@/models/glbAssets";
import {
    MODEL_CACHE_NAME,
    clearModelCache,
    isModelCacheSupported,
    modelCacheKey,
    readCachedModel,
    storeCachedModel,
} from "@/models/modelCache";
import {
    clearPack,
    downloadPack,
    inspectPack,
    isPackSupported,
    resolvePackFiles,
} from "@/models/modelPack";

const BASE = "https://example.test/dsp_blueprint_editor/";

function keyOf(request: RequestInfo | URL): string {
    return typeof request === "string"
        ? request
        : request instanceof URL
        ? request.href
        : request.url;
}

class FakeCache {
    readonly entries = new Map<string, Response>();

    async match(request: RequestInfo | URL): Promise<Response | undefined> {
        return this.entries.get(keyOf(request));
    }

    async put(request: RequestInfo | URL, response: Response): Promise<void> {
        this.entries.set(keyOf(request), response);
    }

    async keys(): Promise<Request[]> {
        return Array.from(this.entries.keys()).map((url) => new Request(url));
    }

    async delete(request: RequestInfo | URL): Promise<boolean> {
        return this.entries.delete(keyOf(request));
    }
}

class FakeCacheStorage {
    readonly caches = new Map<string, FakeCache>();

    async open(name: string): Promise<FakeCache> {
        let cache = this.caches.get(name);
        if (cache === undefined) {
            cache = new FakeCache();
            this.caches.set(name, cache);
        }
        return cache;
    }

    async keys(): Promise<string[]> {
        return Array.from(this.caches.keys());
    }
}

type Globals = Record<string, unknown>;
const g = globalThis as unknown as Globals;

let storage: FakeCacheStorage;
let cache: FakeCache;
let originalFetch: typeof fetch;

function installGlobals(): void {
    storage = new FakeCacheStorage();
    cache = new FakeCache();
    storage.caches.set(MODEL_CACHE_NAME, cache);
    g.caches = storage;
    g.document = { baseURI: BASE };
    originalFetch = globalThis.fetch;
}

/** 一个固定大小、内容可区分的假响应 */
function fakeGlb(size = 8): Response {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 3) % 251;
    return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "model/gltf-binary" },
    });
}

function stubFetch(handler?: (url: string, call: number) => Promise<Response>) {
    let call = 0;
    const mock = jest.fn((input: RequestInfo | URL) => {
        call++;
        const url = keyOf(input as RequestInfo | URL);
        if (handler !== undefined) return handler(url, call);
        return Promise.resolve(fakeGlb());
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    return mock;
}

beforeEach(() => {
    installGlobals();
});

afterEach(() => {
    delete g.caches;
    delete g.document;
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe("modelCache：Cache Storage 读写", () => {
    it("没有 caches 时全部退化为空操作，不抛错", async () => {
        delete g.caches;

        expect(isModelCacheSupported()).toBe(false);
        await expect(readCachedModel(`${BASE}models/a.glb`)).resolves.toBeNull();
        await expect(
            storeCachedModel(`${BASE}models/a.glb`, new Uint8Array([1, 2]))
        ).resolves.toBe(false);
        await expect(clearModelCache()).resolves.toBe(0);
    });

    it("存入后能按 URL 读回原始字节", async () => {
        const url = `${BASE}models/a.glb`;
        expect(await storeCachedModel(url, new Uint8Array([1, 2, 3]))).toBe(
            true
        );

        const response = await readCachedModel(url);
        expect(response).not.toBeNull();
        expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
            new Uint8Array([1, 2, 3])
        );
    });

    it("键统一归一化成绝对 URL（相对路径与绝对路径命中同一条）", async () => {
        await storeCachedModel("models/b.glb", new Uint8Array([9]));

        // 相对路径按 document.baseURI 补全；绝对路径按 origin 解析
        expect(modelCacheKey("models/b.glb")).toBe(`${BASE}models/b.glb`);
        expect(await readCachedModel(`${BASE}models/b.glb`)).not.toBeNull();
        expect(await readCachedModel("models/b.glb")).not.toBeNull();
    });
});

describe("modelPack：只补缺失的文件", () => {
    it("清单来自磁盘上真实存在的 GLB", async () => {
        const files = await resolvePackFiles();

        expect(files.length).toBe(availableModelNames.size);
        for (const file of files)
            expect(file.url).toMatch(/\.glb$/);
        // 每个可用模型名都能解析出 URL
        expect(await modelUrl(files[0]!.name)).toBe(files[0]!.url);
    });

    it("inspectPack 把已缓存的算进去，初次全缺", async () => {
        const first = await inspectPack();
        expect(first.supported).toBe(true);
        expect(first.total).toBe(availableModelNames.size);
        expect(first.cached).toBe(0);
        expect(first.missing).toBe(first.total);

        const files = await resolvePackFiles();
        await storeCachedModel(files[0]!.url, new Uint8Array([1]));

        const again = await inspectPack();
        expect(again.cached).toBe(1);
        expect(again.missing).toBe(again.total - 1);
    });

    it("顺手清掉不属于当前构建的旧条目", async () => {
        const stale = `${BASE}models/old-model.deadbeef.glb`;
        await storeCachedModel(stale, new Uint8Array([1]));
        const files = await resolvePackFiles();
        await storeCachedModel(files[0]!.url, new Uint8Array([2]));

        const status = await inspectPack();

        expect(status.pruned).toBe(1);
        expect(status.cached).toBe(1);
        expect(await readCachedModel(stale)).toBeNull();
    });

    it("下载只请求缺失的文件，进度单调递增", async () => {
        const files = await resolvePackFiles();
        await storeCachedModel(files[0]!.url, new Uint8Array([1]));
        const fetchMock = stubFetch();

        const progress: number[] = [];
        const result = await downloadPack({
            onProgress: (p) => progress.push(p.completed),
        });

        expect(fetchMock).toHaveBeenCalledTimes(files.length - 1);
        expect(result.total).toBe(files.length - 1);
        expect(result.completed).toBe(files.length - 1);
        expect(result.bytes).toBe((files.length - 1) * 8);
        // 首帧是 0，之后每一帧都不回退，最后一帧等于总数
        expect(progress[0]).toBe(0);
        for (let i = 1; i < progress.length; i++)
            expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
        expect(progress[progress.length - 1]).toBe(files.length - 1);

        expect((await inspectPack()).missing).toBe(0);
    });

    it("下载完成后再点：一个请求都不发", async () => {
        stubFetch();
        await downloadPack();
        const fetchMock = stubFetch();

        const result = await downloadPack();

        expect(result.total).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("HTTP 失败会抛错，并指明是哪个模型", async () => {
        stubFetch(() =>
            Promise.resolve(new Response(null, { status: 503 }))
        );

        await expect(downloadPack()).rejects.toThrow(/HTTP 503/);
    });

    it("开始前已取消：直接抛 AbortError，且不写任何文件", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = stubFetch();

        await expect(
            downloadPack({ signal: controller.signal })
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(cache.entries.size).toBe(0);
    });

    it("下载途中取消：已完成文件保留，半成品不落盘", async () => {
        const controller = new AbortController();
        stubFetch();

        await expect(
            downloadPack({
                signal: controller.signal,
                onProgress: (p) => {
                    if (p.completed === 2) controller.abort();
                },
            })
        ).rejects.toMatchObject({ name: "AbortError" });

        // 两个完整文件已落盘，第三个还没开始就被取消
        expect(cache.entries.size).toBe(2);
        for (const response of cache.entries.values())
            expect((response as Response).status).toBe(200);
    });

    it("clearPack 清空缓存并返回删除条数", async () => {
        const files = await resolvePackFiles();
        await storeCachedModel(files[0]!.url, new Uint8Array([1]));
        await storeCachedModel(files[1]!.url, new Uint8Array([2]));

        await expect(clearPack()).resolves.toBe(2);
        expect(cache.entries.size).toBe(0);
        expect(await readCachedModel(files[0]!.url)).toBeNull();
    });

    it("不支持本地缓存时 isPackSupported=false，下载直接报错（不静默成功）", async () => {
        delete g.caches;

        expect(isPackSupported()).toBe(false);
        await expect(downloadPack()).rejects.toThrow(/不支持本地缓存/);
    });
});
