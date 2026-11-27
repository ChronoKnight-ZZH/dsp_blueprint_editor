import {
    buildBeltLine,
    CreateBeltLineCommand,
} from "@/blueprint/beltLine";
import { createEmptyBlueprint } from "@/blueprint/create";
import { fromStr, toStr } from "@/blueprint/parser";
import {
    adjustBeltTilt,
    setBeltTilt,
} from "@/editor/placementState";

/**
 * 传送带拧转（tilt）：A 点锁定起始角，终点由 ←/→ 调整（每次 15°，±180°）。
 * 未设 A 点时整条带同角度；设了 A 点后按节点从起始角插值到目标角。
 */

const Y0 = 80; // 赤道行：cos(lat)=1

describe("传送带拧转角", () => {
    test("adjustBeltTilt：左减右加、每次 15°，夹在 ±180°", () => {
        setBeltTilt(0);
        expect(adjustBeltTilt(15)).toBe(15);
        expect(adjustBeltTilt(-15)).toBe(0);
        expect(adjustBeltTilt(-15)).toBe(-15);

        setBeltTilt(180);
        expect(adjustBeltTilt(15)).toBe(180); // 正值一侧保持 +180

        setBeltTilt(-180);
        expect(adjustBeltTilt(-15)).toBe(-180); // 负值一侧保持 -180
    });

    test("未设 A 点：整条带使用同一拧转角", () => {
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 8, y: Y0 },
            90,
            "latFirst",
            null,
            null,
            undefined,
            0,
            0,
            15,
            15
        );
        expect(belts.length).toBe(7);
        for (const b of belts) expect(b.tilt).toBe(15);
    });

    test("A 点固定角：按节点从起始角插值到目标角", () => {
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 8, y: Y0 },
            90,
            "latFirst",
            null,
            null,
            undefined,
            0,
            0,
            15,
            0
        );
        expect(belts.length).toBe(7);
        expect(belts[0].tilt).toBeCloseTo(0);
        expect(belts[belts.length - 1].tilt).toBeCloseTo(15);
        for (let i = 1; i < belts.length; i++) {
            expect(belts[i].tilt).toBeGreaterThan(belts[i - 1].tilt);
        }
    });

    test("同格垂直堆叠的节点共用同一拧转角", () => {
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 3, y: Y0 },
            90,
            "latFirst",
            null,
            null,
            undefined,
            2,
            0,
            15,
            0
        );
        // 两点路径升 2 层：首格一条，终点格原地堆叠三条
        expect(belts.length).toBe(4);
        expect(belts[0].tilt).toBeCloseTo(0);
        for (const b of belts.slice(1)) expect(b.tilt).toBeCloseTo(15);
    });

    test("拧转角写入蓝图并可完整导出/导入", () => {
        const bp = createEmptyBlueprint();
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 4, y: Y0 },
            90,
            "latFirst",
            null,
            null,
            undefined,
            0,
            0,
            15,
            0
        );
        new CreateBeltLineCommand(belts).do(bp);
        const back = fromStr(toStr(bp));
        expect(back.buildings.map((b) => b.tilt)).toEqual(
            belts.map((b) => b.tilt)
        );
    });

    test("省略拧转参数时保持旧行为（tilt = 0）", () => {
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 5, y: Y0 },
            90
        );
        for (const b of belts) expect(b.tilt).toBe(0);
    });
});