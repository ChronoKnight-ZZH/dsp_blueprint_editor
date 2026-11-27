import { createEmptyBlueprint } from "@/blueprint/create";
import { buildBeltLine, CreateBeltLineCommand } from "@/blueprint/beltLine";
import {
    adjustBeltZ,
    BELT_Z_MAX,
    setBeltZ,
} from "@/editor/placementState";

/**
 * 传送带放置高度（阶段一：整条带保持同一高度，对应
 * `data/阶梯高度传送带.json` 里 5 条分别整条保持在 z=0..4 的直线）。
 *
 * 坡度爬升（`data/三种坡度上升的高度1.json` 的三种写法）见 `beltSlope.spec.ts`；
 * 这里只保证：整条同高可放置、可撤销；同格不同高度互不冲突（垂直上升的数据基础）。
 */

const Y0 = 80; // 赤道行：cos(lat)=1

describe("传送带放置高度（阶梯高度）", () => {
    test("buildBeltLine 的 baseZ：整条带所有格都在同一高度", () => {
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
            2
        );
        expect(belts.length).toBe(7);
        for (const b of belts) expect(b.localOffset[0].z).toBe(2);
    });

    test("CreateBeltLineCommand：整条高层带入库并可完整撤销", () => {
        const bp = createEmptyBlueprint();
        const belts = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 6, y: Y0 },
            90,
            "latFirst",
            null,
            null,
            undefined,
            3
        );
        const cmd = new CreateBeltLineCommand(belts);
        cmd.do(bp);
        expect(bp.buildings.length).toBe(belts.length);
        for (const b of bp.buildings) expect(b.localOffset[0].z).toBe(3);

        cmd.undo(bp);
        expect(bp.buildings.length).toBe(0);
    });

    test("同格不同高度不冲突（垂直上升/多层线的高度身份）", () => {
        const bp = createEmptyBlueprint();
        const path = { x0: 2, x1: 6, y: Y0 };
        const ground = buildBeltLine(
            2001,
            35,
            { x: path.x0, y: path.y },
            { x: path.x1, y: path.y },
            90,
            "latFirst",
            null,
            null,
            undefined,
            0
        );
        new CreateBeltLineCommand(ground).do(bp);
        const raised = buildBeltLine(
            2001,
            35,
            { x: path.x0, y: path.y },
            { x: path.x1, y: path.y },
            90,
            "latFirst",
            null,
            null,
            undefined,
            1
        );
        new CreateBeltLineCommand(raised).do(bp);

        // 同一批格子在 z=0 与 z=1 各有一条，互不截断
        expect(bp.buildings.length).toBe(ground.length + raised.length);
        expect(bp.buildings.filter((b) => b.localOffset[0].z === 1).length).toBe(
            raised.length
        );
    });

    test("adjustBeltZ：整层步进并夹在 0..48", () => {
        setBeltZ(0);
        expect(adjustBeltZ(1)).toBe(1);
        expect(adjustBeltZ(-1)).toBe(0);
        expect(adjustBeltZ(-1)).toBe(0); // 下界
        setBeltZ(BELT_Z_MAX);
        expect(adjustBeltZ(1)).toBe(BELT_Z_MAX); // 上界
    });
});
