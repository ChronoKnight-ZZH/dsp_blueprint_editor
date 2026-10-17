import {
    BlueprintData,
    BlueprintReformData,
    BlueprintReformRect,
} from "@/blueprint/parser";
import { Command } from "@/command";

/**
 * 地基（地形改造）的逐格编辑工具 + 撤销命令。
 *
 * 依据蓝图格式约定：
 * - 每格颜色为 5-bit 索引（0..31）：0..15 游戏内置色，16..31 自定义 RGBA 色槽；
 * - 同一格被多个矩形覆盖时，最后出现的矩形生效（与游戏重复改造行为一致），
 *   因此「铺/涂一格」只需在 rects 尾部追加一个 1×1 矩形；撤销时弹出该矩形即可。
 */

/** 直铺地基（对齐金属板）。新铺格使用直铺，保证小方格为正方形、整齐无偏移 */
export const REFORM_TYPE_GRID = 2;
/** 自定义色槽起始索引 */
export const CUSTOM_COLOR_SLOT_BASE = 16;
/** 自定义色槽数量 */
export const CUSTOM_COLOR_SLOTS = 16;

/** 游戏内置地基色板（地形改造面板索引 0..15），与 reform.ts 渲染层一致 */
export const DEFAULT_REFORM_COLORS: readonly number[] = [
    0x94948f, // 0  默认灰
    0xd9d9d4, // 1  白
    0x4f4f4f, // 2  黑
    0xc05048, // 3  红
    0xd17c3e, // 4  橙
    0xd8b740, // 5  黄
    0x9eb34a, // 6  黄绿
    0x5ea85c, // 7  绿
    0x46a88e, // 8  青绿
    0x4a9fc2, // 9  青蓝
    0x4b78c2, // 10 蓝
    0x7b60c2, // 11 紫
    0xaf60b5, // 12 品红
    0xd2729a, // 13 粉
    0x8a5c3c, // 14 棕
    0xffa6a6, // 15 粉
];

/** 十六进制色值 → RGB 三元组 */
export function rgbOfHex(hex: number): [number, number, number] {
    return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/** 由槽位索引解析实际颜色。自定义槽未标定时取白色（与游戏 reformCustomColors 初始一致） */
export function reformColorHex(
    reformData: BlueprintReformData | null | undefined,
    slot: number
): number {
    if (slot < CUSTOM_COLOR_SLOT_BASE)
        return DEFAULT_REFORM_COLORS[slot] ?? 0x94948f;
    const idx = slot - CUSTOM_COLOR_SLOT_BASE;
    if (
        reformData != null &&
        ((reformData.customReformColorMask >>> slot) & 1) !== 0 &&
        reformData.customReformColors[idx] !== undefined
    )
        return (reformData.customReformColors[idx] >>> 8) & 0xffffff;
    return 0xffffff;
}

/** 确保 reformData 存在（蓝图无地基数据时初始化） */
export function ensureReformData(data: BlueprintData): BlueprintReformData {
    if (data.reformData == null) {
        data.reformData = {
            reserved: 0,
            rects: [],
            customReformColorMask: 0,
            customReformColors: [],
        };
    }
    return data.reformData;
}

/** 查询格 (x, y) 被覆盖的最后一个矩形的颜色索引；无地基返回 null */
export function cellColorIndex(
    data: BlueprintData,
    areaIndex: number,
    x: number,
    y: number
): number | null {
    const reformData = data.reformData;
    if (!reformData) return null;
    let color: number | null = null;
    for (const r of reformData.rects) {
        if (
            r.areaIndex !== areaIndex ||
            x < r.x ||
            x >= r.x + r.w ||
            y < r.y ||
            y >= r.y + r.h
        )
            continue;
        color = r.color;
    }
    return color;
}

/** 查询格 (x, y) 的地基装饰类型；无地基返回 null */
export function cellReformType(
    data: BlueprintData,
    areaIndex: number,
    x: number,
    y: number
): number | null {
    const reformData = data.reformData;
    if (!reformData) return null;
    let type: number | null = null;
    for (const r of reformData.rects) {
        if (
            r.areaIndex !== areaIndex ||
            x < r.x ||
            x >= r.x + r.w ||
            y < r.y ||
            y >= r.y + r.h
        )
            continue;
        type = r.type;
    }
    return type;
}

/** 追加一个 1×1 地基矩形（利用「后出现者覆盖」语义实现铺/涂） */
export function pushCellRect(
    reformData: BlueprintReformData,
    areaIndex: number,
    x: number,
    y: number,
    colorIndex: number,
    type: number
): BlueprintReformRect {
    const rect: BlueprintReformRect = {
        reserved: 0,
        x,
        y,
        w: 1,
        h: 1,
        type: type & 0x07,
        color: colorIndex & 0x1f,
        areaIndex,
    };
    reformData.rects.push(rect);
    return rect;
}

/** 读取自定义色槽（slot 16..31）的 RGBA（0xRRGGBBAA）；未使用返回 null */
export function customSlotColor(
    reformData: BlueprintReformData,
    slot: number
): number | null {
    const idx = slot - CUSTOM_COLOR_SLOT_BASE;
    if (idx < 0 || idx >= CUSTOM_COLOR_SLOTS) return null;
    if (((reformData.customReformColorMask >>> slot) & 1) === 0) return null;
    return reformData.customReformColors[idx] ?? null;
}

/** 写入自定义色槽颜色（0xRRGGBBAA），并置位对应 mask 位 */
export function setCustomSlotColor(
    reformData: BlueprintReformData,
    slot: number,
    rgba: number
): void {
    const idx = slot - CUSTOM_COLOR_SLOT_BASE;
    if (idx < 0 || idx >= CUSTOM_COLOR_SLOTS) return;
    const colors = reformData.customReformColors;
    while (colors.length <= idx) colors.push(0);
    colors[idx] = rgba >>> 0;
    reformData.customReformColorMask =
        (reformData.customReformColorMask | (1 << slot)) >>> 0;
}

/** 铺/涂一格地基：追加 1×1 矩形；撤销 = 弹出该矩形（保持与其它命令的逆序语义） */
export class PaintReformCellCommand implements Command {
    private rect: BlueprintReformRect | null = null;

    constructor(
        private readonly areaIndex: number,
        private readonly x: number,
        private readonly y: number,
        private readonly colorIndex: number
    ) {}

    do(data: BlueprintData): void {
        const rd = ensureReformData(data);
        // 覆盖已有地基时维持原装饰类型；新铺格用直铺（正方形整齐方格）
        const type =
            cellReformType(data, this.areaIndex, this.x, this.y) ??
            REFORM_TYPE_GRID;
        this.rect = pushCellRect(
            rd,
            this.areaIndex,
            this.x,
            this.y,
            this.colorIndex,
            type
        );
    }

    undo(data: BlueprintData): void {
        if (this.rect === null) return;
        const rd = data.reformData;
        if (rd) {
            const i = rd.rects.lastIndexOf(this.rect);
            if (i >= 0) rd.rects.splice(i, 1);
        }
        this.rect = null;
    }

    merge(): boolean {
        return false;
    }
}

/** 设置自定义色槽颜色（RGBA，0xRRGGBBAA）；撤销恢复旧值 */
export class SetReformCustomColorCommand implements Command {
    private prev: number | null = null;
    private prevMaskBit = false;

    constructor(private readonly slot: number, private readonly rgba: number) {}

    do(data: BlueprintData): void {
        const rd = ensureReformData(data);
        const idx = this.slot - CUSTOM_COLOR_SLOT_BASE;
        if (idx < 0 || idx >= CUSTOM_COLOR_SLOTS) return;
        this.prev = rd.customReformColors[idx] ?? null;
        this.prevMaskBit = ((rd.customReformColorMask >>> this.slot) & 1) !== 0;
        setCustomSlotColor(rd, this.slot, this.rgba);
    }

    undo(data: BlueprintData): void {
        const rd = data.reformData;
        if (!rd) return;
        const idx = this.slot - CUSTOM_COLOR_SLOT_BASE;
        if (idx < 0 || idx >= CUSTOM_COLOR_SLOTS) return;
        if (this.prev === null) {
            if (idx < rd.customReformColors.length)
                rd.customReformColors.splice(idx, 1);
        } else {
            rd.customReformColors[idx] = this.prev;
        }
        const bit = 1 << this.slot;
        if (this.prevMaskBit)
            rd.customReformColorMask = (rd.customReformColorMask | bit) >>> 0;
        else rd.customReformColorMask = (rd.customReformColorMask & ~bit) >>> 0;
    }

    merge(): boolean {
        return false;
    }
}
