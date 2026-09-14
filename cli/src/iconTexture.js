"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IconTexture = void 0;
const three_1 = require("three");
const icons_1 = require("./data/icons");
const WIDTH = 24;
const HEIGHT = 24;
const ICON_SIZE = 80;
class IconTexture {
    renderer;
    static WIDTH = WIDTH;
    static HEIGHT = HEIGHT;
    texture;
    iconIds = new Map();
    loaded = new Array(WIDTH * HEIGHT);
    loader = new three_1.TextureLoader();
    constructor(renderer) {
        this.renderer = renderer;
        const emptyCanvas = document.createElement('canvas');
        emptyCanvas.width = WIDTH * ICON_SIZE;
        emptyCanvas.height = HEIGHT * ICON_SIZE;
        this.texture = new three_1.Texture(emptyCanvas);
        this.texture.name = 'icons';
        this.texture.format = three_1.RGBAFormat;
        this.texture.type = three_1.UnsignedByteType;
        this.texture.flipY = true;
        this.texture.needsUpdate = true;
        this.texture.colorSpace = three_1.SRGBColorSpace;
        this.renderer.initTexture(this.texture);
        let nextIndex = 1; // 0 is reserved for empty icon
        for (const i of (0, icons_1.allIconIds)()) {
            if (nextIndex >= WIDTH * HEIGHT)
                throw new Error('IconTexture too small');
            this.iconIds.set(i, nextIndex);
            nextIndex++;
        }
        for (let i = 0; i < this.loaded.length; i++)
            this.loaded[i] = false;
    }
    requestIcon(iconId) {
        const index = this.iconIds.get(iconId);
        if (index === undefined) {
            console.warn(`Unknown icon ${iconId}`);
            return 0;
        }
        if (this.loaded[iconId])
            return index;
        this.loaded[iconId] = true;
        (async () => {
            const texture = await this.loader.loadAsync(await (0, icons_1.iconUrl)(iconId));
            const pos = new three_1.Vector2(index % WIDTH, Math.floor(index / WIDTH));
            pos.multiplyScalar(ICON_SIZE);
            this.renderer.copyTextureToTexture(pos, texture, this.texture);
            texture.dispose();
        })();
        return index;
    }
}
exports.IconTexture = IconTexture;
//# sourceMappingURL=iconTexture.js.map