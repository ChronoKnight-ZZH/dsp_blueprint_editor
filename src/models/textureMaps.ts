/**
 * 外部通道贴图的加载与预处理。
 *
 * GLB 里只内嵌了底色图，法线 / 自发光 / 高光三张通道图放在
 * `src/assets/icons/models/<建筑>/` 下，由 `textureManifest` 给出 URL。
 * 这里负责把它们变成 three 的 `Texture`：
 *
 * - 懒加载 + 去重（同一 URL 只解码一次）+ 失败负缓存，与 `glbLoader` 一致
 *   **永不 reject**，失败就退回「无此贴图」，模型照常显示底色。
 * - `flipY = false`：GLB 用的是 glTF 的 UV 约定（v 轴朝下），贴图若按 three 默认
 *   的 flipY 加载，法线/自发光会整体上下错位，这是最容易踩的坑。
 * - `-s`（Unity spec-gloss）不能直接当 `roughnessMap` 用：three 的
 *   `roughnessMap` 读 **G 通道**、`metalnessMap` 读 **B 通道**，而 DSP 的 `-s` 是
 *   RGB=高光色、A=光滑度。所以这里在内存里把它重新打包成一张 ORM 图
 *   （G=1-光滑度、B=高光色亮度），不落盘、不增加仓库文件。
 */

import {
    DataTexture,
    LinearFilter,
    LinearMipmapLinearFilter,
    NoColorSpace,
    RGBAFormat,
    SRGBColorSpace,
    Texture,
    UnsignedByteType,
} from 'three';
import type { ColorSpace } from 'three';
import type { MaterialMapUrls } from './textureManifest';

/** 单张贴图的加载超时（超时按失败处理，不影响模型本体） */
const LOAD_TIMEOUT_MS = 15000;

let maxAnisotropy = 1;

/** 由渲染器在初始化时告知，用于给贴图开各向异性过滤（斜视地面时更清晰） */
export function setTextureMaxAnisotropy(value: number): void {
    maxAnisotropy = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

// ---------------------------------------------------------------- 图片解码

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function decodeImage(url: string): Promise<HTMLImageElement | null> {
    const cached = imageCache.get(url);
    if (cached !== undefined)
        return cached;

    const task = new Promise<HTMLImageElement | null>(resolve => {
        const image = new Image();
        const timer = setTimeout(() => {
            image.src = '';
            console.warn(`[tex] 贴图加载超时：${url}`);
            resolve(null);
        }, LOAD_TIMEOUT_MS);
        image.onload = () => {
            clearTimeout(timer);
            resolve(image);
        };
        image.onerror = () => {
            clearTimeout(timer);
            console.warn(`[tex] 贴图加载失败：${url}`);
            resolve(null);
        };
        image.src = url;
    });

    imageCache.set(url, task);
    return task;
}

// ---------------------------------------------------------------- 贴图构造

function makeTexture(image: HTMLImageElement, colorSpace: ColorSpace, name: string): Texture {
    const texture = new Texture(image);
    // glTF 的 UV 约定：v 轴朝下；three 默认 flipY=true 会把它翻回来，必须关掉
    texture.flipY = false;
    texture.colorSpace = colorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.name = name;
    // 这些贴图挂在共享材质上，缓存生命周期内会被多个模型复用，释放交给 clearTextureCache()
    texture.userData.sharedTexture = true;
    texture.needsUpdate = true;
    return texture;
}

/**
 * 把 Unity spec-gloss 贴图重打包成 three 能直接用的 ORM 图。
 *
 * - G 通道 = 粗糙度 = 1 - A（A 是光滑度）
 * - B 通道 = 金属度 = RGB 的亮度（高光色越亮越像金属）
 * - R/A 留空，避免和 three 的其它约定冲突
 */
function packOrm(image: HTMLImageElement, name: string): DataTexture | null {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width === 0 || height === 0)
        return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null)
        return null;
    context.drawImage(image, 0, 0);

    let source: ImageData;
    try {
        source = context.getImageData(0, 0, width, height);
    } catch (e) {
        console.warn(`[tex] 读取 spec 贴图象素失败（可能是跨域污染）：${name}`, e);
        return null;
    }

    const src = source.data;
    const packed = new Uint8Array(width * height * 4);
    for (let i = 0; i < src.length; i += 4) {
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        const gloss = src[i + 3] / 255;
        packed[i] = 255;
        packed[i + 1] = Math.round((1 - gloss) * 255);
        packed[i + 2] = Math.round((0.299 * r + 0.587 * g + 0.114 * b));
        packed[i + 3] = 255;
    }

    const texture = new DataTexture(packed, width, height, RGBAFormat, UnsignedByteType);
    texture.name = `${name}#orm`;
    texture.flipY = false;
    texture.colorSpace = NoColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.userData.sharedTexture = true;
    texture.needsUpdate = true;
    return texture;
}

// ---------------------------------------------------------------- 材质级入口

export interface MaterialTextureSet {
    /** 法线图（切线空间） */
    readonly normal: Texture | null;
    /** 自发光图 */
    readonly emissive: Texture | null;
    /** 打包后的 ORM 图，同时用作 roughnessMap / metalnessMap */
    readonly orm: Texture | null;
}

const EMPTY_SET: MaterialTextureSet = Object.freeze({ normal: null, emissive: null, orm: null });

const setCache = new Map<string, Promise<MaterialTextureSet>>();

async function buildSet(urls: MaterialMapUrls): Promise<MaterialTextureSet> {
    const [normalImage, emissiveImage, specImage] = await Promise.all([
        urls.normal === undefined ? Promise.resolve(null) : decodeImage(urls.normal),
        urls.emissive === undefined ? Promise.resolve(null) : decodeImage(urls.emissive),
        urls.spec === undefined ? Promise.resolve(null) : decodeImage(urls.spec),
    ]);

    const normal = normalImage === null
        ? null
        : makeTexture(normalImage, NoColorSpace, urls.normal ?? 'normal');
    const emissive = emissiveImage === null
        ? null
        : makeTexture(emissiveImage, SRGBColorSpace, urls.emissive ?? 'emissive');
    const orm = specImage === null
        ? null
        : packOrm(specImage, urls.spec ?? 'spec');

    return { normal, emissive, orm };
}

/** 按清单条目加载一组通道贴图；失败的通道是 `null`，整体永不 reject */
export function loadMaterialTextureSet(urls: MaterialMapUrls): Promise<MaterialTextureSet> {
    const key = `${urls.normal ?? '-'}|${urls.emissive ?? '-'}|${urls.spec ?? '-'}`;
    if (key === '-|-|-')
        return Promise.resolve(EMPTY_SET);

    const cached = setCache.get(key);
    if (cached !== undefined)
        return cached;

    const task = buildSet(urls).catch(e => {
        console.warn('[tex] 通道贴图装配失败（忽略，模型保留底色）', e);
        return EMPTY_SET;
    });
    setCache.set(key, task);
    return task;
}

/** 清空贴图缓存（模型全部释放后调用；这里只丢引用，GPU 资源由材质释放负责） */
export function clearTextureCache(): void {
    imageCache.clear();
    setCache.clear();
}
