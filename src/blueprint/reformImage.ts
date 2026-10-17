import { BlueprintData, BlueprintReformRect } from "@/blueprint/parser";
import { createEmptyBlueprint } from "./create";
import {
    ensureReformData,
    DEFAULT_REFORM_COLORS,
    REFORM_TYPE_GRID,
    CUSTOM_COLOR_SLOT_BASE,
    CUSTOM_COLOR_SLOTS,
    rgbOfHex,
} from "./reformEdit";

/**
 * 照片 → 地基蓝图（像素画）。
 *
 * 输出网格约定：
 * - 行数固定为 150（赤道带 lat -80..80 可正向对齐的行数上限为 161，
 *   160 为当前选取的图像条带行数，可在该上限内调整）；
 * - 列数 = round(160 × 图片宽高比)，上限 1000（原赤道整圈 200 段 × 5 格/段），
 *   超宽时只取水平中央条带（不拉伸）；
 * - 图片整体旋转 180° 输出（等效上下、左右同时镜像：图片顶部行 → 最北，
 *   底部行 → 最南，左列仍从经度 0 开始、逆时针排布）；
 * - 蓝图地基每格颜色只能存 5-bit 索引（0..31）：0..15 游戏内置色，
 *   16..31 自定义 RGBA 槽。图片先中位切分量化出 ≤16 个代表色并全部写入
 *   自定义槽（真实颜色值、mask 置位），再对每格在「内置 ∪ 自定义」≤32 色中
 *   取最近匹配。
 */

/** 输出列数上限（原赤道整圈 1000 列），超出时取水平中央条带 */
export const PHOTO_MAX_WIDTH = 1000;
/** 输出行数固定值（赤道带可正向对齐行数上限 161 内选取） */
export const PHOTO_ROWS = 160;

type RGB = [number, number, number];

const BUILTIN_RGB: RGB[] = DEFAULT_REFORM_COLORS.map((h) => rgbOfHex(h));

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
            while (x + w < width && slotsPerCell[i + w] === slot && w < 255)
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
    // 图片代表色中位切分量化到 ≤16 色，全部写入自定义槽；内置 16 色保留参与匹配
    const customColors = medianCutQuantize(unique, freqs, CUSTOM_COLOR_SLOTS);
    const palette = [...BUILTIN_RGB, ...customColors];
    const slotsPerCell = new Uint8Array(width * height);
    for (let i = 0; i < colors.length; i++)
        slotsPerCell[i] = nearestIndex(palette, colors[i]);
    const rects = buildRectsFromSlots(slotsPerCell, width, height);

    // 组装蓝图：161 行 × width 列，居中于赤道
    const bp = createEmptyBlueprint();
    bp.header.shortDesc = "地基图片";
    bp.areas[0].size = { x: width, y: height };
    bp.dragBoxSize = { x: width, y: height };
    bp.cursorOffset = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    const rd = ensureReformData(bp);
    rd.reserved = 0;
    rd.rects = rects;
    rd.customReformColorMask = 0;
    // 自定义槽从 16 起依次写入真实颜色值（用几个写几个），补足 16 项与游戏导出惯例一致
    rd.customReformColors = customColors.map(
        (c) => ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 0xff) >>> 0
    );
    while (rd.customReformColors.length < CUSTOM_COLOR_SLOTS)
        rd.customReformColors.push(0);
    for (let k = 0; k < customColors.length; k++)
        rd.customReformColorMask =
            (rd.customReformColorMask | (1 << (CUSTOM_COLOR_SLOT_BASE + k))) >>>
            0;
    return bp;
}

/** 加载图片到 160 行画布（列数 = round(160 × 宽高比)，上限 1000，超宽取水平中央条带） */
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
        const scale = PHOTO_ROWS / Math.max(1, img.naturalHeight);
        const cols = Math.min(
            PHOTO_MAX_WIDTH,
            Math.max(1, Math.round(img.naturalWidth * scale))
        );
        const canvas = document.createElement("canvas");
        canvas.width = cols;
        canvas.height = PHOTO_ROWS;
        const ctx = canvas.getContext("2d")!;
        // 宽度超出时只取水平中央条带（照片不拉伸）
        const srcW = cols / scale;
        const srcX = Math.max(0, (img.naturalWidth - srcW) / 2);
        // 整体旋转 180°：translate 到右下角再缩放 (-1,-1)，等效上下+左右镜像
        ctx.translate(canvas.width, canvas.height);
        ctx.scale(-1, -1);
        ctx.drawImage(
            img,
            srcX,
            0,
            srcW,
            img.naturalHeight,
            0,
            0,
            cols,
            PHOTO_ROWS
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
    return buildBlueprintFromPixels(imgData.data, canvas.width, canvas.height);
}
