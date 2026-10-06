import { fromStr, toStr } from "@/blueprint/parser";
import { createEmptyBlueprint } from "@/blueprint/create";
import {
    ensureReformData,
    cellColorIndex,
    cellReformType,
    customSlotColor,
    reformColorHex,
    PaintReformCellCommand,
    SetReformCustomColorCommand,
    REFORM_TYPE_GRID,
} from "@/blueprint/reformEdit";

describe("reformEdit 逐格铺/涂与自定义色槽", () => {
    function makeData() {
        return createEmptyBlueprint();
    }

    test("ensureReformData 初始化空地基数据", () => {
        const data = makeData();
        expect(data.reformData).toBeNull();
        const rd = ensureReformData(data);
        expect(rd.rects).toEqual([]);
        expect(rd.customReformColorMask).toBe(0);
        expect(rd.customReformColors).toEqual([]);
        // 幂等
        expect(ensureReformData(data)).toBe(rd);
    });

    test("cellColorIndex：后出现矩形生效（与游戏覆盖语义一致）", () => {
        const data = makeData();
        const rd = ensureReformData(data);
        rd.rects.push({
            reserved: 0,
            x: 0,
            y: 0,
            w: 5,
            h: 5,
            type: 1,
            color: 0,
            areaIndex: 0,
        });
        rd.rects.push({
            reserved: 0,
            x: 2,
            y: 2,
            w: 1,
            h: 1,
            type: 2,
            color: 7,
            areaIndex: 0,
        });
        expect(cellColorIndex(data, 0, 1, 1)).toBe(0);
        expect(cellColorIndex(data, 0, 2, 2)).toBe(7);
        expect(cellColorIndex(data, 0, 9, 9)).toBeNull();
        expect(cellReformType(data, 0, 2, 2)).toBe(2);
        // 不同 areaIndex 不干扰
        expect(cellColorIndex(data, 1, 2, 2)).toBeNull();
    });

    test("PaintReformCellCommand：空域铺新格（直铺），撤销恢复", () => {
        const data = makeData();
        const cmd = new PaintReformCellCommand(0, 3, 4, 5);
        cmd.do(data);
        expect(cellColorIndex(data, 0, 3, 4)).toBe(5);
        expect(cellReformType(data, 0, 3, 4)).toBe(REFORM_TYPE_GRID);
        cmd.undo(data);
        expect(cellColorIndex(data, 0, 3, 4)).toBeNull();
    });

    test("PaintReformCellCommand：已铺格处改色（保持原装饰类型），撤销后原色恢复", () => {
        const data = makeData();
        new PaintReformCellCommand(0, 3, 4, 1).do(data); // 铺灰色直铺
        const repaint = new PaintReformCellCommand(0, 3, 4, 9);
        repaint.do(data);
        expect(cellColorIndex(data, 0, 3, 4)).toBe(9);
        expect(cellReformType(data, 0, 3, 4)).toBe(REFORM_TYPE_GRID);
        repaint.undo(data);
        expect(cellColorIndex(data, 0, 3, 4)).toBe(1);
    });

    test("SetReformCustomColorCommand：写入/撤销自定义色槽与 mask", () => {
        const data = makeData();
        const rd = ensureReformData(data);
        const cmd = new SetReformCustomColorCommand(18, 0x123456ff);
        cmd.do(data);
        expect(((rd.customReformColorMask >>> 18) & 1)).toBe(1);
        expect(rd.customReformColors[2]).toBe(0x123456ff);
        expect(customSlotColor(rd, 18)).toBe(0x123456ff);
        expect(customSlotColor(rd, 16)).toBeNull();
        cmd.undo(data);
        expect((rd.customReformColorMask >>> 18) & 1).toBe(0);
        expect(rd.customReformColors[2]).toBeUndefined();
    });

    test("reformColorHex：内置槽 / 未标定自定义槽回退白色", () => {
        const data = makeData();
        expect(reformColorHex(data.reformData, 0)).toBe(0x94948f);
        expect(reformColorHex(data.reformData, 5)).toBe(0xd8b740);
        // 未标定的自定义槽 = 白色（与游戏 reformCustomColors 初始一致）
        expect(reformColorHex(data.reformData, 20)).toBe(0xffffff);
    });

    test("铺/涂与自定义色可字节级 round-trip", () => {
        const data = makeData();
        new PaintReformCellCommand(0, 10, 11, 20).do(data);
        new SetReformCustomColorCommand(20, 0xffa0b0ff).do(data);
        const regenerated = toStr(data);
        const bp2 = fromStr(regenerated);
        expect(bp2.reformData).not.toBeNull();
        expect(bp2.reformData!.rects).toEqual([
            {
                reserved: 0,
                x: 10,
                y: 11,
                w: 1,
                h: 1,
                type: 2,
                color: 20,
                areaIndex: 0,
            },
        ]);
        expect(bp2.reformData!.customReformColorMask).toBe(
            (1 << 20) >>> 0
        );
        expect(bp2.reformData!.customReformColors[4]).toBe(0xffa0b0ff);
    });
});