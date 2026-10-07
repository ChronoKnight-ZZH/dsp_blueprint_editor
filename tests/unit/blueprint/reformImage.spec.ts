import { fromStr, toStr } from "@/blueprint/parser";
import {
    buildBlueprintFromPixels,
    buildRectsFromSlots,
    medianCutQuantize,
    PHOTO_MAX_WIDTH,
    PHOTO_ROWS,
} from "@/blueprint/reformImage";

type RGB = [number, number, number];

/** 用纯色填充的行优先像素缓冲 */
function solidCanvas(
    width: number,
    height: number,
    color: RGB
): Uint8ClampedArray {
    const px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        px[i * 4] = color[0];
        px[i * 4 + 1] = color[1];
        px[i * 4 + 2] = color[2];
        px[i * 4 + 3] = 255;
    }
    return px;
}

describe("照片 → 地基蓝图", () => {
    test("buildRectsFromSlots：同色运行水平/纵向合并", () => {
        const slots = new Uint8Array(6 * 3);
        slots.fill(3); // 全红块（模拟每格同色）
        const rects = buildRectsFromSlots(slots, 6, 3);
        // 整块合并为 1 个 6×3 矩形
        expect(rects).toHaveLength(1);
        expect(rects[0]).toMatchObject({
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            color: 3,
            areaIndex: 0,
        });
    });

    test("buildRectsFromSlots：横向 255 上限截断（w/h 为 u8）", () => {
        const slots = new Uint8Array(600 * 2);
        slots.fill(0);
        const rects = buildRectsFromSlots(slots, 600, 2);
        const total = rects.reduce((s, r) => s + r.w * r.h, 0);
        expect(total).toBe(600 * 2);
        for (const r of rects) {
            expect(r.w).toBeLessThanOrEqual(255);
            expect(r.h).toBeLessThanOrEqual(255);
        }
        // 255 + 255 + 90，且纵向延续
        expect(rects).toHaveLength(3);
    });

    test("buildRectsFromSlots：中间断行后再现的同色不合并", () => {
        // 行0/行2 全为 1，行1 全为 2 → 三个独立矩形（行0 与行2 被行1 隔断）
        const slots = new Uint8Array(4 * 3);
        slots.fill(1);
        slots.fill(2, 4, 8);
        const rects = buildRectsFromSlots(slots, 4, 3);
        expect(rects).toHaveLength(3);
        expect(rects[0]).toMatchObject({ y: 0, h: 1, color: 1 });
        expect(rects[1]).toMatchObject({ y: 1, h: 1, color: 2 });
        expect(rects[2]).toMatchObject({ y: 2, h: 1, color: 1 });
    });

    test("纯色小图 → 1 个矩形、颜色进入自定义槽 16", () => {
        const bp = buildBlueprintFromPixels(
            solidCanvas(4, 3, [200, 80, 72]),
            4,
            3
        );
        expect(bp.version).toBe(2);
        expect(bp.buildings).toEqual([]);
        expect(bp.areas[0].size).toEqual({ x: 4, y: 3 });
        expect(bp.reformData!.rects).toHaveLength(1);
        expect(bp.reformData!.rects[0].w).toBe(4);
        expect(bp.reformData!.rects[0].h).toBe(3);
        // 原色始终写入自定义槽（精确匹配距离 0，优先于相近的内置红）
        expect(bp.reformData!.rects[0].color).toBe(16);
        const rgba = bp.reformData!.customReformColors[0];
        expect((rgba >>> 24) & 0xff).toBe(200);
        expect((rgba >>> 16) & 0xff).toBe(80);
        expect((rgba >>> 8) & 0xff).toBe(72);
        expect((bp.reformData!.customReformColorMask >>> 16) & 1).toBe(1);
        // 补齐到 16 项
        expect(bp.reformData!.customReformColors.length).toBe(16);
    });

    test("多色图覆盖全部格子且槽位合法（0..31）", () => {
        // 4 列 × 2 行，四种明显不同的颜色
        const colors: RGB[] = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [255, 255, 0],
            [255, 0, 255],
            [0, 255, 255],
            [128, 64, 32],
            [10, 20, 30],
        ];
        const px = solidCanvas(4, 2, [0, 0, 0]);
        colors.forEach((c, i) => {
            px[i * 4] = c[0];
            px[i * 4 + 1] = c[1];
            px[i * 4 + 2] = c[2];
        });
        const bp = buildBlueprintFromPixels(px, 4, 2);
        const rects = bp.reformData!.rects;
        const total = rects.reduce((s, r) => s + r.w * r.h, 0);
        expect(total).toBe(8);
        for (const r of rects) {
            expect(r.color).toBeGreaterThanOrEqual(0);
            expect(r.color).toBeLessThanOrEqual(31);
            expect(r.type).toBe(2);
            expect(r.x + r.w).toBeLessThanOrEqual(4);
            expect(r.y + r.h).toBeLessThanOrEqual(2);
        }
    });

    test("每格颜色槽位与颜色索引一致（回读像素验证）", () => {
        const colors: RGB[] = [
            [255, 0, 0], // 内置红
            [0, 0, 255], // 内置蓝
            [123, 45, 201], // 自定义
            [201, 45, 123], // 自定义
        ];
        const px = solidCanvas(4, 1, [0, 0, 0]);
        colors.forEach((c, i) => {
            px[i * 4] = c[0];
            px[i * 4 + 1] = c[1];
            px[i * 4 + 2] = c[2];
        });
        const bp = buildBlueprintFromPixels(px, 4, 1);
        const rd = bp.reformData!;
        // 照片原色全部进入自定义槽（0..15 内置槽仅保留给更接近的颜色）
        for (const r of rd.rects) {
            expect(r.color).toBeGreaterThanOrEqual(16);
        }
        expect(rd.rects).toHaveLength(4);
        for (const r of rd.rects) {
            // 非自定义槽无法直接反查；仅校验自定义槽的 RGB 通道接近原像素
            if (r.color >= 16) {
                const rgba = rd.customReformColors[r.color - 16];
                const rVec = (rgba >>> 24) & 0xff;
                const gVec = (rgba >>> 16) & 0xff;
                const bVec = (rgba >>> 8) & 0xff;
                const src = colors[r.x];
                expect(Math.abs(rVec - src[0])).toBeLessThanOrEqual(2);
                expect(Math.abs(gVec - src[1])).toBeLessThanOrEqual(2);
                expect(Math.abs(bVec - src[2])).toBeLessThanOrEqual(2);
            }
        }
        // 自定义槽使用后 mask 置位（4 个代表色占用槽 16..19）
        expect(
            rd.customReformColors.length === 16 // 补齐到 16 项
        ).toBe(true);
        for (let k = 0; k < 4; k++) {
            expect((rd.customReformColorMask >>> (16 + k)) & 1).toBe(1);
        }
    });

    test("生成的蓝图字节级 round-trip", () => {
        const colors: RGB[] = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [255, 255, 0],
        ];
        const px = solidCanvas(4, 2, [0, 0, 0]);
        colors.forEach((c, i) => {
            px[i * 4] = c[0];
            px[i * 4 + 1] = c[1];
            px[i * 4 + 2] = c[2];
            px[8 * 4 + i * 4] = c[0];
            px[8 * 4 + i * 4 + 1] = c[1];
            px[8 * 4 + i * 4 + 2] = c[2];
        });
        const bp = buildBlueprintFromPixels(px, 4, 2);
        const regenerated = toStr(bp);
        const bp2 = fromStr(regenerated);
        expect(bp2).toEqual(bp);
        expect(bp2.reformData!.rects.length).toBe(
            bp.reformData!.rects.length
        );
    });

    test("medianCutQuantize 输出不超过目标色数", () => {
        const unique: RGB[] = [];
        const freqs = new Map<string, number>();
        for (let i = 0; i < 60; i++) {
            unique.push([i * 4 % 255, (i * 7) % 255, (i * 11) % 255]);
            freqs.set(`${unique[i][0]},${unique[i][1]},${unique[i][2]}`, 1);
        }
        const out = medianCutQuantize(unique, freqs, 16);
        expect(out.length).toBeLessThanOrEqual(16);
        expect(out.length).toBeGreaterThan(0);
    });

    test("常量：行数固定 160，列数上限 1000", () => {
        expect(PHOTO_ROWS).toBe(160);
        expect(PHOTO_MAX_WIDTH).toBe(1000);
    });
});