/**
 * 缺失底色贴图的兜底：用代码生成的纯色贴图顶替。
 *
 * 背景：部分 GLB 的材质没有内嵌底色图（`map`），例如 `*-black`（黑漆结构件）、
 * `*-glass-back`（玻璃背面）、`DefaultMaterial`（导出时没赋材质的网格），以及
 * space-capsule / belt 这类**整个文件都没有材质**的模型。glTF 里这些材质的
 * `baseColorFactor` 全是默认白色，three 会把整块渲染成刺眼的纯白。
 *
 * 这里按 `<模型名>::<材质名>` 解析一个兜底色，生成 1×1 纯色 `DataTexture`
 * 顶到 `material.map` 上（见 `materialTextures.ts` 的接入点）。
 *
 * 颜色解析顺序：
 *   1. `missingAlbedoColorOverrides` 显式指定（`<模型名>::<材质名>` → 0xRRGGBB）
 *   2. 材质名启发式：含 `black` → 深黑、`glass` → 玻璃蓝灰、`water` → 水蓝
 *   3. 中性灰默认值
 *
 * 新模型缺贴图时：优先在 overrides 表里按材质真实颜色补一行；来不及补就靠
 * 启发式/默认灰兜住，不会再出现纯白。
 */

import {
    DataTexture,
    LinearFilter,
    RGBAFormat,
    SRGBColorSpace,
    UnsignedByteType,
} from "three";

/** 中性灰：无任何线索时的默认兜底色 */
const DEFAULT_COLOR = 0x8f9498;
/** 材质名含 `black`：黑漆结构件 */
const BLACK_COLOR = 0x101216;
/** 材质名含 `glass`：玻璃件 */
const GLASS_COLOR = 0xa8bcc4;
/** 材质名含 `water`：水/液体件 */
const WATER_COLOR = 0x2e6f8e;

/**
 * 显式兜底色表：`<模型名>::<材质名>` → 0xRRGGBB。
 * 无材质的网格由 three 填默认材质，材质名是空串，键写成 `<模型名>::`。
 */
const missingAlbedoColorOverrides: Readonly<Record<string, number>> = {
    // 太空舱：整个 GLB 没有材质，舱体白
    "space-capsule::": 0xcdd2d8,
    // 传送带：整个 GLB 没有材质，带体深灰
    "belt-1::": 0x3c4043,
    "belt-2::": 0x3c4043,
    "belt-3::": 0x3c4043,
    // 喷涂机：中性灰
    "spray-coater::spray-coater": 0x101216,
    // 石墙：石灰色
    "stone-wall::stone-wall": 0x7b776d,
    // 人造恒星发光环：无底色无自发光，用亮青近似原作辉光
    "fusion-reactor::fusion-reactor-effect": 0xbfe8ff,
    // 自动集装机的 mask 件
    "piler::piler-mask": 0x6a6f74,
    // 卫星配电站挂件 / 垂直发射井的无名材质
    "energy-exchanger-mcl-0::Default-Material": 0x8f9498,
    "energy-exchanger-mcl-1::Default-Material": 0x8f9498,
    "energy-exchanger-mcl-2::Default-Material": 0x8f9498,
    "vertical-launching-silo::DefaultMaterial": 0x8f9498,
};

/** 按 `<模型名>::<材质名>` 解析兜底色（导出供测试与诊断） */
export function missingAlbedoColor(
    modelName: string,
    materialName: string
): number {
    const override =
        missingAlbedoColorOverrides[`${modelName}::${materialName}`];
    if (override !== undefined) return override;
    const name = materialName.toLowerCase();
    if (name.includes("black")) return BLACK_COLOR;
    if (name.includes("glass")) return GLASS_COLOR;
    if (name.includes("water")) return WATER_COLOR;
    return DEFAULT_COLOR;
}

// ---------------------------------------------------------------- 纯色贴图

const textureCache = new Map<number, DataTexture>();

function buildSolidTexture(color: number): DataTexture {
    const data = new Uint8Array([
        (color >> 16) & 0xff,
        (color >> 8) & 0xff,
        color & 0xff,
        255,
    ]);
    const texture = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
    // 底色贴图按 sRGB 解释，否则渲染会偏亮
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.name = `fallback-albedo-${color.toString(16).padStart(6, "0")}`;
    // 与 textureMaps.ts 的共享贴图约定一致：不随单个材质释放
    texture.userData.sharedTexture = true;
    texture.needsUpdate = true;
    return texture;
}

/** 解析并取（带缓存的）兜底纯色贴图；同一颜色全局只构造一次 */
export function missingAlbedoTexture(
    modelName: string,
    materialName: string
): DataTexture {
    const color = missingAlbedoColor(modelName, materialName);
    let texture = textureCache.get(color);
    if (texture === undefined) {
        texture = buildSolidTexture(color);
        textureCache.set(color, texture);
    }
    return texture;
}
