/**
 * 持久化全局开关 + 「空操作」缓存对象（No-Op / Null Object）。
 *
 * 覆盖三件事：
 * 1. 开关关闭 → `getModelCache()` 返回 `NoopModelCache`：读未命中、写失败、清单空、
 *    清空 0，而且**完全不碰** Cache Storage（连 `caches.open` 都不调）；
 * 2. 开关重新打开 → 立刻回到真实后端（运行时覆盖即时生效），能真正落盘；
 * 3. `modelPack` 对「开关关闭」的降级：`isPackSupported()` 为 false、`inspectPack()`
 *    不谎报、`downloadPack()` 直接报错，不会出现「显示下载成功但其实没存」。
 *
 * 单测里没有浏览器：`caches` / `document` / `fetch` 都是手搓的最小实现
 * （与 `modelPack.spec.ts` 同一套假实现）。
 */

import {
    MODEL_CACHE_NAME,
    NoopModelCache,
    cachedModelUrls,
    clearModelCache,
    getModelCache,
    isModelCacheActive,
    readCachedModel,
    removeCachedModel,
    storeCachedModel,
} from "@/models/modelCache";
import {
    isModelCacheEnabled,
    setModelCacheEnabled,
} from "@/models/modelCacheConfig";
import {
    downloadPack,
    inspectPack,
    isPackSupported,
    isPersistenceEnabled,
} from "@/models/modelPack";

const BASE = "https://example.test/dsp_blueprint_editor/";
const MODEL_URL = `${BASE}models/a.glb`;

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

beforeEach(() => {
    storage = new FakeCacheStorage();
    cache = new FakeCache();
    storage.caches.set(MODEL_CACHE_NAME, cache);
    g.caches = storage;
    g.document = { baseURI: BASE };
    originalFetch = globalThis.fetch;
    // 每个用例都从「构建配置的默认值」开始，不受上一个用例的运行时覆盖影响
    setModelCacheEnabled(null);
});

afterEach(() => {
    setModelCacheEnabled(null);
    delete g.caches;
    delete g.document;
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe("NoopModelCache：空操作缓存对象", () => {
    it("开关关闭时就是它，且 5 个操作全部返回「未命中 / 失败 / 空」", async () => {
        setModelCacheEnabled(false);

        const backend = getModelCache();
        expect(backend).toBe(NoopModelCache);
        expect(backend.kind).toBe("noop");

        await expect(backend.read(MODEL_URL)).resolves.toBeNull();
        await expect(
            backend.store(MODEL_URL, new Uint8Array([1, 2]))
        ).resolves.toBe(false);
        await expect(backend.remove(MODEL_URL)).resolves.toBe(false);
        await expect(backend.keys()).resolves.toEqual(new Set());
        await expect(backend.clear()).resolves.toBe(0);
    });

    it("完全不接触 Cache Storage（连 open 都不调），也不写任何条目", async () => {
        setModelCacheEnabled(false);
        const openSpy = jest.spyOn(storage, "open");

        // 存量调用方走的是便捷函数，同样必须被「空操作」兜住
        await expect(
            storeCachedModel(MODEL_URL, new Uint8Array([1]))
        ).resolves.toBe(false);
        await expect(readCachedModel(MODEL_URL)).resolves.toBeNull();
        await expect(removeCachedModel(MODEL_URL)).resolves.toBe(false);
        await expect(cachedModelUrls()).resolves.toEqual(new Set());
        await expect(clearModelCache()).resolves.toBe(0);

        expect(openSpy).not.toHaveBeenCalled();
        expect(cache.entries.size).toBe(0);
    });

    it("环境不支持 Cache Storage 时，开关开着也退回同一个空操作对象", () => {
        setModelCacheEnabled(true);
        delete g.caches;

        expect(isModelCacheActive()).toBe(false);
        expect(getModelCache()).toBe(NoopModelCache);
    });
});

describe("全局开关：构建配置 + 运行时覆盖", () => {
    it("默认跟随构建配置（单测注入 Web 端 = 开启），运行时覆盖优先", () => {
        expect(isModelCacheEnabled()).toBe(true);

        setModelCacheEnabled(false);
        expect(isModelCacheEnabled()).toBe(false);

        setModelCacheEnabled(true);
        expect(isModelCacheEnabled()).toBe(true);

        setModelCacheEnabled(null);
        expect(isModelCacheEnabled()).toBe(true);
    });

    it("打开时走真实后端，写入后能读回原始字节", async () => {
        const backend = getModelCache();
        expect(backend.kind).toBe("cache-storage");

        await expect(
            backend.store(MODEL_URL, new Uint8Array([7, 8, 9]))
        ).resolves.toBe(true);
        const response = await backend.read(MODEL_URL);
        expect(response).not.toBeNull();
        expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
            new Uint8Array([7, 8, 9])
        );

        await expect(backend.keys()).resolves.toEqual(new Set([MODEL_URL]));
        await expect(backend.clear()).resolves.toBe(1);
        expect(cache.entries.size).toBe(0);
    });
});

describe("modelPack：开关关闭时整体降级", () => {
    it("isPackSupported=false、isPersistenceEnabled=false，inspectPack 不谎报可用", async () => {
        setModelCacheEnabled(false);

        expect(isPackSupported()).toBe(false);
        expect(isPersistenceEnabled()).toBe(false);

        const status = await inspectPack();
        expect(status.supported).toBe(false);
        expect(status.cached).toBe(0);
    });

    it("downloadPack 直接报「本地持久化已关闭」，不发请求、不写缓存", async () => {
        setModelCacheEnabled(false);
        const fetchMock = jest.fn(() => Promise.resolve(new Response(null)));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(downloadPack()).rejects.toThrow(/本地持久化已关闭/);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(cache.entries.size).toBe(0);
    });

    it("重新打开后下载恢复正常（空操作对象不是永久的）", async () => {
        setModelCacheEnabled(false);
        setModelCacheEnabled(true);

        const fetchMock = jest.fn(() =>
            Promise.resolve(
                new Response(new Uint8Array(8), {
                    status: 200,
                    headers: { "Content-Type": "model/gltf-binary" },
                })
            )
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await downloadPack();
        expect(result.completed).toBe(result.total);
        expect(cache.entries.size).toBe(result.total);
    });
});
