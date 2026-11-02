import {
    TextureLoader,
    Texture,
    RGBAFormat,
    UnsignedByteType,
    Vector2,
    SRGBColorSpace,
} from "three";
import { allIconIds, iconUrl } from "./data/icons";

const WIDTH = 24;
const HEIGHT = 24;
const ICON_SIZE = 80;

/**
 * 图标图集只需要 renderer 的两个方法。抽出接口有两个目的：
 *   1. 单测里可以注入 stub（jsdom 没有 WebGL，拿不到真实 `WebGLRenderer`）
 *   2. `src/lib/core/` 不必依赖具体 renderer 的生命周期
 */
export interface TextureSink {
    initTexture(texture: Texture): void;
    copyTextureToTexture(
        position: Vector2,
        srcTexture: Texture,
        dstTexture: Texture
    ): void;
}

export class IconTexture {
    static readonly WIDTH = WIDTH;
    static readonly HEIGHT = HEIGHT;

    texture: Texture;
    private iconIds = new Map<number, number>();
    /** 按**槽位索引**记录加载状态（不是 iconId）。旧实现用 iconId 索引，守卫实际失效 */
    private loaded = new Array<boolean>(WIDTH * HEIGHT);
    private loader = new TextureLoader();
    /** 已发起但未完成的请求，dispose 后不再回写纹理 */
    private disposed = false;

    constructor(private renderer: TextureSink) {
        const emptyCanvas = document.createElement("canvas");
        emptyCanvas.width = WIDTH * ICON_SIZE;
        emptyCanvas.height = HEIGHT * ICON_SIZE;
        this.texture = new Texture(emptyCanvas);
        this.texture.name = "icons";
        this.texture.format = RGBAFormat;
        this.texture.type = UnsignedByteType;
        this.texture.flipY = true;
        this.texture.needsUpdate = true;
        this.texture.colorSpace = SRGBColorSpace;
        this.renderer.initTexture(this.texture);

        let nextIndex = 1; // 0 is reserved for empty icon
        for (const i of allIconIds()) {
            if (nextIndex >= WIDTH * HEIGHT)
                throw new Error("IconTexture too small");
            this.iconIds.set(i, nextIndex);
            nextIndex++;
        }

        for (let i = 0; i < this.loaded.length; i++) this.loaded[i] = false;
    }

    requestIcon(iconId: number) {
        const index = this.iconIds.get(iconId);
        if (index === undefined) {
            console.warn(`Unknown icon ${iconId}`);
            return 0;
        }

        // 按槽位索引判断，同一 iconId 才不会重复下载/上传（修复：旧代码用 this.loaded[iconId]）
        if (this.loaded[index]) return index;
        this.loaded[index] = true;

        (async () => {
            try {
                const texture = await this.loader.loadAsync(
                    await iconUrl(iconId)
                );
                // 图集可能已被 dispose（场景销毁 / 重建），此时不要再写纹理
                if (this.disposed) {
                    texture.dispose();
                    return;
                }
                const pos = new Vector2(
                    index % WIDTH,
                    Math.floor(index / WIDTH)
                );
                pos.multiplyScalar(ICON_SIZE);
                this.renderer.copyTextureToTexture(pos, texture, this.texture);
                texture.dispose();
            } catch {
                // 允许下次重试
                this.loaded[index] = false;
            }
        })();

        return index;
    }

    /** 判断 iconId 是否在图集中有分配的槽位（不关心是否已加载纹理数据） */
    has(iconId: number): boolean {
        return this.iconIds.has(iconId);
    }

    /**
     * 释放图集纹理。构造时用 `renderer.initTexture` 上传过，必须显式释放，
     * 否则每次场景重建都会泄漏一张 `WIDTH*ICON_SIZE × HEIGHT*ICON_SIZE` 的纹理。
     */
    dispose(): void {
        this.disposed = true;
        this.texture.dispose();
    }
}
