/**
 * GLB 模型加载器（懒加载 + 缓存 + 并发去重 + 超时 + 错误吞掉）。
 *
 * 契约：**永不 reject**。
 * - 文件不存在 / 资源解析失败 / fetch 失败 / 超时 / parse 失败 → 一律 resolve 成 `null`，
 *   只在控制台留一条 warn，调用方据此静默回退 `@/data/building` 的元数据表。
 * - 同一个模型名并发请求只会真正下载/解析一次（`pending` 去重），成功后进 `loaded` 缓存。
 * - 失败会被负缓存（`failed`），避免对坏文件反复重试；需要重试时调用 `resetGlbFailure()`。
 * - 同时最多 `MAX_CONCURRENT_LOADS` 个模型在下载/解析，避免一次亮出几十个请求。
 */

import { Box3, Group, Object3D, Texture } from 'three';
import type { Material } from 'three';
import { modelUrl } from './glbAssets';
import { applyModelMaterialTextures } from './materialTextures';

/** 已加载完成的 GLB 模型（`scene` 作为实例化渲染的原型，不要直接加进场景） */
export interface LoadedGlbModel {
    /** 模型名（不含 .glb） */
    readonly name: string;
    /** webpack 生成后的最终 URL */
    readonly url: string;
    /** GLB 场景根节点（原型，供 `GlbModelInstances` 取子网格几何/材质） */
    readonly scene: Group;
    /** 模型原始包围盒（未做方向/缩放处理），用于对齐元数据盒 */
    readonly bbox: Box3;
}

export interface LoadGlbOptions {
    /** 超时毫秒数；超时视为失败并静默回退 */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_CONCURRENT_LOADS = 3;

const loaded = new Map<string, LoadedGlbModel>();
const pending = new Map<string, Promise<LoadedGlbModel | null>>();
const failed = new Set<string>();
const listeners = new Set<(model: LoadedGlbModel) => void>();

/** 同步查询已加载的模型（渲染时先用它决定能否走外部模型） */
export function getLoadedGlbModel(name: string): LoadedGlbModel | null {
    return loaded.get(name) ?? null;
}

export function isGlbModelLoaded(name: string): boolean {
    return loaded.has(name);
}

/** 加载失败的模型名集合（负缓存，供诊断/报告使用） */
export function glbFailedModels(): ReadonlySet<string> {
    return failed;
}

/** 模型加载成功时回调；返回取消订阅函数 */
export function onGlbModelLoaded(cb: (model: LoadedGlbModel) => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

// ---------------------------------------------------------------- 并发闸门

let activeLoads = 0;
const waitingSlots: (() => void)[] = [];

function acquireSlot(): Promise<void> {
    if (activeLoads < MAX_CONCURRENT_LOADS) {
        activeLoads++;
        return Promise.resolve();
    }
    return new Promise<void>(resolve => {
        waitingSlots.push(() => {
            activeLoads++;
            resolve();
        });
    });
}

function releaseSlot(): void {
    activeLoads = Math.max(0, activeLoads - 1);
    waitingSlots.shift()?.();
}

// ---------------------------------------------------------------- 工具

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`GLB 加载超时（${timeoutMs}ms）`)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/** GLTFLoader 只用到 parse，这里给出最小结构化类型，避免依赖 @types/three 的完整形状 */
interface GltfLike {
    scene?: Group;
    scenes?: Group[];
}

interface GltfLoaderLike {
    parse(
        data: ArrayBuffer | string,
        path: string,
        onLoad: (gltf: GltfLike) => void,
        onError?: (error: unknown) => void,
    ): void;
}

interface GltfLoaderModule {
    GLTFLoader: new () => GltfLoaderLike;
}

/**
 * GLTFLoader 本身也是懒加载的：只有第一次真的需要解析模型时才拉
 * `gltf-loader` chunk，首屏不会为它付费。
 */
async function parseGlb(buffer: ArrayBuffer, baseUrl: string): Promise<GltfLike> {
    const mod = (await import(
        /* webpackChunkName: "gltf-loader" */ 'three/examples/jsm/loaders/GLTFLoader.js'
    )) as unknown as GltfLoaderModule;
    const loader = new mod.GLTFLoader();
    return new Promise<GltfLike>((resolve, reject) => {
        loader.parse(buffer, baseUrl, resolve, error => {
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}

// ---------------------------------------------------------------- 加载流程

async function runLoad(name: string, timeoutMs: number): Promise<LoadedGlbModel | null> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;

    const pipeline = async (): Promise<LoadedGlbModel | null> => {
        const url = await modelUrl(name);
        if (url === null)
            return null;

        const response = await fetch(url, controller === null ? undefined : { signal: controller.signal });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const baseUrl = url.slice(0, url.lastIndexOf('/') + 1);
        const gltf = await parseGlb(buffer, baseUrl);

        const scene = gltf.scene ?? gltf.scenes?.[0];
        if (scene === undefined)
            throw new Error('GLB 中没有可用场景');

        scene.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(scene);
        if (bbox.isEmpty())
            throw new Error('GLB 包围盒为空（可能是纯空节点或解析异常）');

        return { name, url, scene, bbox };
    };

    try {
        // 整体超时：涵盖 chunk 加载 + fetch + parse 全过程
        const model = await withTimeout(pipeline(), timeoutMs);
        if (model === null) {
            failed.add(name);
            return null;
        }
        loaded.set(name, model);
        // 通道贴图（法线/自发光/spec-gloss）不在 GLB 里，按清单异步补挂：
        // 不 await、不许失败——贴图没到之前先显示底色，到了材质原地更新即可
        void applyModelMaterialTextures(model).catch(e => {
            console.warn(`[glb] 模型 ${name} 的通道贴图接入失败（保留底色）`, e);
        });
        for (const cb of listeners) {
            try {
                cb(model);
            } catch (e) {
                console.warn('[glb] 模型加载监听器抛错（已忽略）', e);
            }
        }
        return model;
    } catch (e) {
        failed.add(name);
        // 超时时主动 abort 底层 fetch，避免连接被白占
        try {
            controller?.abort();
        } catch { /* ignore */ }
        console.warn(`[glb] 模型 ${name} 加载失败，回退元数据表`, e);
        return null;
    }
}

/**
 * 按模型名懒加载。永不 reject：失败返回 null。
 * 同一模型名的并发调用共享同一个 Promise。
 */
export function loadGlbModel(name: string, options?: LoadGlbOptions): Promise<LoadedGlbModel | null> {
    const cached = loaded.get(name);
    if (cached !== undefined)
        return Promise.resolve(cached);
    if (failed.has(name))
        return Promise.resolve(null);

    const running = pending.get(name);
    if (running !== undefined)
        return running;

    const task = (async (): Promise<LoadedGlbModel | null> => {
        await acquireSlot();
        try {
            return await runLoad(name, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        } finally {
            releaseSlot();
        }
    })();

    pending.set(name, task);
    const cleanup = () => {
        pending.delete(name);
    };
    void task.then(cleanup, cleanup);
    return task;
}

/** 清除失败负缓存，允许重新尝试（例如网络恢复后手动重试） */
export function resetGlbFailure(name?: string): void {
    if (name === undefined)
        failed.clear();
    else
        failed.delete(name);
}

/**
 * 按当前渲染设置重新挂载所有已加载模型的通道贴图。
 * 设置变更后重建场景（重新导入蓝图）时调用；材质是共享对象，原地更新即可。
 */
export function reapplyLoadedModelMaterials(): void {
    for (const model of loaded.values()) {
        void applyModelMaterialTextures(model).catch(e => {
            console.warn(`[glb] 重新挂载模型 ${model.name} 的通道贴图失败（保留底色）`, e);
        });
    }
}

// ---------------------------------------------------------------- 释放

function disposeMaterial(material: Material): void {
    // 材质上的贴图引用（map/normalMap/...）需要一起释放；
    // 但通道贴图是跨模型共享的缓存资源（见 textureMaps），这里跳过，避免放掉别人还在用的图
    for (const key of Object.keys(material)) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value instanceof Texture && value.userData.sharedTexture !== true)
            value.dispose();
    }
    material.dispose();
}

function disposeObject(root: Object3D): void {
    root.traverse(o => {
        // 结构化判断，避免把 Object3D 断言成 Mesh 后 isMesh 被收窄成字面量 true
        const mesh = o as unknown as {
            isMesh?: boolean;
            geometry?: { dispose(): void };
            material?: Material | Material[];
        };
        if (mesh.isMesh !== true || mesh.geometry === undefined)
            return;
        mesh.geometry.dispose();
        const materials = mesh.material;
        if (Array.isArray(materials)) {
            for (const m of materials)
                if (m !== undefined)
                    disposeMaterial(m);
        } else if (materials !== undefined) {
            disposeMaterial(materials);
        }
    });
}

/** 释放某个已加载模型的 GPU 资源并移出缓存 */
export function releaseGlbModel(name: string): void {
    const model = loaded.get(name);
    if (model === undefined)
        return;
    loaded.delete(name);
    try {
        disposeObject(model.scene);
    } catch (e) {
        console.warn(`[glb] 模型 ${name} 释放失败（已忽略）`, e);
    }
}

/** 释放全部已加载模型（例如切换蓝图后彻底回收） */
export function releaseAllGlbModels(): void {
    for (const name of Array.from(loaded.keys()))
        releaseGlbModel(name);
}
