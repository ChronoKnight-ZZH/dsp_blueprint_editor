import { BlueprintData, BlueprintReformRect } from "@/blueprint/parser";
import { createEmptyBlueprint } from "./create";
import {
    ensureReformData,
    DEFAULT_REFORM_COLORS,
    REFORM_TYPE_GRID,
    rgbOfHex,
} from "./reformEdit";

/**
 * 照片 → 地基蓝图（像素画）。
 *
 * 赤道带网格约定：
 * - 经向整圈 200 段 × 5 格/段 = 1000 列（图片宽度固定为 1000 像素）；
 * - 纬向赤道带可正向对齐的行数上限 ≈ 161 行（±27.7°），图片等比缩放后
 *   高度自适应，最高 161 行，超出取中央条带；
 * - 蓝图地基每格颜色只能存 5-bit 索引（0..31），因此照片颜色先量化到
 *   ≤32 色：与游戏内置 16 色接近的用内置槽，其余自动分配自定义 RGBA 槽
 *   （最多 16 个）。
 */

/** 输出列数 = 赤道整圈格子数（200 段 × 5 格/段） */
export const PHOTO_WIDTH = 1000;
/** 赤道带可正向对齐的行数上限（lat -80..80 格） */
export const PHOTO_MAX_ROWS = 161;

type RGB = [number, number, number];

const BUILTIN_RGB: RGB[] = DEFAULT_REFORM_COLORS.map((h) => rgbOfHex(h));
/** 与内置色的接近阈值：距离小于该值直接使用内置槽位 */
const BUILTIN_SIM_THRESHOLD = 46;

function colorKey(c: RGB): string {
    return `${c[0]},${c[1]},${c[2]}`;
}

function dist(a: RGB, b: RGB): number {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function nearestIndex(palette: RGB[], c: RGB): number {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const d = dist(c, palette[i]);
        if (d < bd) {
            bd = d;
            bi = i;
        }
    }
    return bi;
}

/** 中位切分量化：按像素频率加权，每次切开通道取值范围最大的盒，直到 target 盒 */
export function medianCutQuantize(
    unique: RGB[],
    freqs: Map<string, number>,
    target: number
): RGB[] {
    if (unique.length <= target) return unique.slice();
    interface Box {
        colors: RGB[];
        weights: number[];
    }
    const boxes: Box[] = [
        {
            colors: unique.slice(),
            weights: unique.map((c) => freqs.get(colorKey(c)) ?? 1),
        },
    ];
    while (boxes.length < target) {
        let bestIdx = -1;
        let bestRange = -1;
        let bestChannel = 0;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            if (b.colors.length < 2) continue;
            for (let ch = 0; ch < 3; ch++) {
                let mn = 255;
                let mx = 0;
                for (const c of b.colors) {
                    if (c[ch] < mn) mn = c[ch];
                    if (c[ch] > mx) mx = c[ch];
                }
                const range = mx - mn;
                if (range > bestRange) {
                    bestRange = range;
                    bestIdx = i;
                    bestChannel = ch;
                }
            }
        }
        if (bestIdx < 0) break; // 无可切分
        const b = boxes[bestIdx];
        const order = b.colors
            .map((_, i) => i)
            .sort(
                (i1, i2) =>
                    b.colors[i1][bestChannel] - b.colors[i2][bestChannel]
            );
        const total = order.reduce((s, i) => s + b.weights[i], 0);
        const half = total / 2;
        let acc = 0;
        let splitAt = order.length - 1;
        for (let j = 0; j < order.length - 1; j++) {
            acc += b.weights[order[j]];
            if (acc >= half) {
                splitAt = j + 1;
                break;
            }
        }
        if (splitAt <= 0) splitAt = 1;
        boxes.splice(
            bestIdx,
            1,
            {
                colors: order.slice(0, splitAt).map((i) => b.colors[i]),
                weights: order.slice(0, splitAt).map((i) => b.weights[i]),
            },
            {
                colors: order.slice(splitAt).map((i) => b.colors[i]),
                weights: order.slice(splitAt).map((i) => b.weights[i]),
            }
        );
    }
    // 每盒取加权平均色
    return boxes.map((box) => {
        let r = 0;
        let g = 0;
        let bl = 0;
        let wSum = 0;
        box.colors.forEach((c, i) => {
            const w = box.weights[i];
            r += c[0] * w;
            g += c[1] * w;
            bl += c[2] * w;
            wSum += w;
        });
        return [
            Math.round(r / wSum),
            Math.round(g / wSum),
            Math.round(bl / wSum),
        ] as RGB;
    });
}

/**
 * 把 ≤32 个代表色分配到 32 个槽位：
 * 与内置色相近（≤ BUILTIN_SIM_THRESHOLD）的用内置槽（0..15）；
 * 其余进入自定义色槽（16..31），自定义候选超过 16 个时两两合并最近的一对
 * （取平均值）直至不超限；最后每个代表色就近映射到「内置 ∪ 自定义」调色板。
 */
export function assignSlots(palette: RGB[]): {
    slots: number[];
    customColors: RGB[];
} {
    const custom = palette.filter(
        (c) => dist(c, BUILTIN_RGB[nearestIndex(BUILTIN_RGB, c)]) >
            BUILTIN_SIM_THRESHOLD
    );
    while (custom.length > 16) {
        // 找最近的一对
        let bi = -1;
        let bj = -1;
        let bd = Infinity;
        for (let i = 0; i < custom.length; i++) {
            for (let j = i + 1; j < custom.length; j++) {
                const d = dist(custom[i], custom[j]);
                if (d < bd) {
                    bd = d;
                    bi = i;
                    bj = j;
                }
            }
        }
        const avg: RGB = [
            Math.round((custom[bi][0] + custom[bj][0]) / 2),
            Math.round((custom[bi][1] + custom[bj][1]) / 2),
            Math.round((custom[bi][2] + custom[bj][2]) / 2),
        ];
        custom.splice(Math.max(bi, bj), 1);
        custom[Math.min(bi, bj)] = avg;
    }
    const finalPalette: RGB[] = [...BUILTIN_RGB, ...custom];
    const slots = palette.map((c) => nearestIndex(finalPalette, c));
    return { slots, customColors: custom };
}

/**
 * 由「每格槽位索引」生成地基矩形列表。
 * 同一行内同色横向合并（run-length）；再纵向合并同 x、同宽、同色的连续行。
 * 注意游戏格式中矩形 w/h 为 u8（最大 255），超长合并必须截断。
 */
export function buildRectsFromSlots(
    slotsPerCell: Uint8Array,
    width: number,
    height: number
): BlueprintReformRect[] {
    const rects: BlueprintReformRect[] = [];
    // 纵向延续表：key `${x}|${w}|${slot}` → 当前开放矩形的下标
    const open = new Map<string, number>();
    let i = 0;
    for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
            const slot = slotsPerCell[i];
            let w = 1;
            while (
                x + w < width &&
                slotsPerCell[i + w] === slot &&
                w < 255
            )
                w++;
            const key = `${x}|${w}|${slot}`;
            const existing = open.get(key);
            if (existing !== undefined) {
                const r = rects[existing];
                if (r.y + r.h === y && r.h < 255) {
                    r.h++;
                } else {
                    // 已达 255 行上限或中间断行后再次出现：重置开放矩形（旧矩形已完整）
                    rects.push({
                        reserved: 0,
                        x,
                        y,
                        w,
                        h: 1,
                        type: REFORM_TYPE_GRID,
                        color: slot,
                        areaIndex: 0,
                    });
                    open.set(key, rects.length - 1);
                }
            } else {
                rects.push({
                    reserved: 0,
                    x,
                    y,
                    w,
                    h: 1,
                    type: REFORM_TYPE_GRID,
                    color: slot,
                    areaIndex: 0,
                });
                open.set(key, rects.length - 1);
            }
            x += w;
            i += w;
        }
    }
    return rects;
}

/**
 * 把像素数据（RGBA8，行优先）转换为蓝图数据。
 * 纯函数，可在 Node 测试环境运行。
 */
export function buildBlueprintFromPixels(
    pixels: Uint8ClampedArray,
    width: number,
    height: number
): BlueprintData {
    const colors: RGB[] = new Array(width * height);
    const freqs = new Map<string, number>();
    for (let i = 0; i < width * height; i++) {
        const c: RGB = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];
        colors[i] = c;
        freqs.set(colorKey(c), (freqs.get(colorKey(c)) ?? 0) + 1);
    }
    const unique: RGB[] = [...freqs.keys()].map(
        (k) => k.split(",").map(Number) as RGB
    );
    const palette =
        unique.length <= 32 ? unique : medianCutQuantize(unique, freqs, 32);
    const { slots, customColors } = assignSlots(palette);
    const slotLookup = new Map<string, number>();
    palette.forEach((c, i) => slotLookup.set(colorKey(c), slots[i]));
    const slotsPerCell = new Uint8Array(width * height);
    for (let i = 0; i < colors.length; i++)
        slotsPerCell[i] = slotLookup.get(colorKey(colors[i])) ?? 0;
    const rects = buildRectsFromSlots(slotsPerCell, width, height);

    // 组装蓝图：整圈 1000 列 × rows 行，居中于赤道
    const bp = createEmptyBlueprint();
    bp.header.shortDesc = "地基图片";
    bp.areas[0].size = { x: width, y: height };
    bp.dragBoxSize = { x: width, y: height };
    bp.cursorOffset = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    const rd = ensureReformData(bp);
    rd.reserved = 0;
    rd.rects = rects;
    rd.customReformColorMask = 0;
    rd.customReformColors = customColors
        .map((c) => ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 0xff) >>> 0);
    // 自定义色槽从 16 起依次占用；补足 16 项与游戏导出惯例一致
    while (rd.customReformColors.length < 16)
        rd.customReformColors.push(0);
    for (let k = 0; k < customColors.length; k++)
        rd.customReformColorMask =
            (rd.customReformColorMask | (1 << (16 + k))) >>> 0;
    return bp;
}

/** 加载图片并缩放到 1000 列像素画布（高度自适应 ≤161，超出取中央条带） */
export async function loadPhotoImage(
    source: Blob | string
): Promise<HTMLCanvasElement> {
    const url =
        typeof source === "string" ? source : URL.createObjectURL(source);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () =>
                reject(new Error("图片加载失败 / Failed to load image"));
            image.src = url;
        });
        const scale = PHOTO_WIDTH / Math.max(1, img.naturalWidth);
        const scaledH = img.naturalHeight * scale;
        const rows = Math.max(
            1,
            Math.min(PHOTO_MAX_ROWS, Math.round(scaledH))
        );
        const canvas = document.createElement("canvas");
        canvas.width = PHOTO_WIDTH;
        canvas.height = rows;
        const ctx = canvas.getContext("2d")!;
        // 高度超出时只取中央条带（照片不拉伸）
        const srcH = rows / scale;
        const srcY = Math.max(0, (img.naturalHeight - srcH) / 2);
        ctx.drawImage(
            img,
            0,
            srcY,
            img.naturalWidth,
            srcH,
            0,
            0,
            PHOTO_WIDTH,
            rows
        );
        return canvas;
    } finally {
        if (typeof source !== "string") URL.revokeObjectURL(url);
    }
}

/** 照片 → 地基蓝图数据 */
export async function photoToBlueprint(
    source: Blob | string
): Promise<BlueprintData> {
    const canvas = await loadPhotoImage(source);
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return buildBlueprintFromPixels(
        imgData.data,
        canvas.width,
        canvas.height
    );
}