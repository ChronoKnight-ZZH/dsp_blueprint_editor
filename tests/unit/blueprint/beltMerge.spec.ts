import {
    buildBeltLine,
    CreateBeltLineCommand,
} from "@/blueprint/beltLine";
import { createEmptyBlueprint } from "@/blueprint/create";
import { isBelt } from "@/data/items";

/**
 * 阶段 7：新线路**汇入**既有传送带（起点 / 中间格）。
 *
 * 用户图示：
 *   中间：A → B → C → D   ＋   E → F → G ─┐
 *                                            └→ C
 *   起点：A → B → C → D   ＋   E → F → G ─┐
 *                                          └→ A
 *
 * 规则：目标原线路完全不动（允许多个上游指向同一节点）；新线路末格
 * outputObjIdx 指向目标节点；撤销只删除新线路。
 */

const Y0 = 80; // 赤道行：cos(lat)=1

function chain(bp: ReturnType<typeof createEmptyBlueprint>, x1 = 3) {
    const belts = buildBeltLine(
        2001,
        35,
        { x: 0, y: Y0 },
        { x: x1, y: Y0 },
        90,
        "latFirst"
    );
    new CreateBeltLineCommand(belts).do(bp);
    return belts;
}

/** 编辑器汇入模式的做法：铺到目标格后丢弃目标格本身（末格停在目标旁边） */
function mergePathTo(
    target: { localOffset: { x: number; y: number; z: number }[] },
    fromY: number,
    baseZ = target.localOffset[0].z,
    startZ = baseZ
) {
    const t = target.localOffset[0];
    return buildBeltLine(
        2001,
        35,
        { x: t.x, y: fromY },
        { x: t.x, y: t.y },
        90,
        "latFirst",
        null,
        null,
        undefined,
        baseZ,
        startZ
    ).slice(0, -1);
}

describe("传带汇入：保留原线路", () => {
    test("汇入中间节点：原线 A→B→C→D 不变，目标有两个上游", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp); // (0..3, Y0)
        const target = line[2]; // (2,Y0)，上游 line[1]、下游 line[3]
        const belts = mergePathTo(target, Y0 + 3);
        expect(belts.length).toBe(3); // (2,Y0+3),(2,Y0+2),(2,Y0+1)

        const cmd = new CreateBeltLineCommand(belts, null, null, 0, undefined, target);
        cmd.do(bp);
        expect(cmd.merged).toBe(true);
        expect(bp.buildings.length).toBe(7); // 4 + 3 新格

        // 新线路串联，末格汇入目标
        expect(belts[0].outputObjIdx).toBe(belts[1].index);
        expect(belts[1].outputObjIdx).toBe(belts[2].index);
        expect(belts[2].outputObjIdx).toBe(target.index);
        expect(belts[2].outputToSlot).toBe(1);
        expect(belts[2].outputFromSlot).toBe(0);
        expect(belts[2].outputOffset).toBe(0);

        // 原线路逐字段不动
        expect(target.outputObjIdx).toBe(line[3].index);
        expect(target.outputToSlot).toBe(1);
        expect(target.yaw[0]).toBeCloseTo(90, 6);
        expect(line[1].outputObjIdx).toBe(target.index);

        // 目标现在有两条入边（line[1] 与 belts[2]）
        expect(
            bp.buildings.filter(
                (b) => isBelt(b.itemId) && b.outputObjIdx === target.index
            )
        ).toHaveLength(2);

        cmd.undo(bp);
        expect(bp.buildings.length).toBe(4);
        expect(target.outputObjIdx).toBe(line[3].index);
        expect(
            bp.buildings.filter(
                (b) => isBelt(b.itemId) && b.outputObjIdx === target.index
            )
        ).toHaveLength(1);

        // 重做
        cmd.do(bp);
        expect(cmd.merged).toBe(true);
        expect(bp.buildings.length).toBe(7);
        expect(belts[2].outputObjIdx).toBe(target.index);
    });

    test("汇入起点（链头）：目标原下游保持", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[0]; // (0,Y0)
        const belts = mergePathTo(target, Y0 + 2); // (0,Y0+2),(0,Y0+1)
        const cmd = new CreateBeltLineCommand(belts, null, null, 0, undefined, target);
        cmd.do(bp);
        expect(cmd.merged).toBe(true);
        expect(belts[belts.length - 1].outputObjIdx).toBe(target.index);
        expect(target.outputObjIdx).toBe(line[1].index); // 原下游不变
        expect(target.yaw[0]).toBeCloseTo(90, 6);
    });

    test("汇入高度不同：末格停在目标高度，坡度由相邻格 z 差表达", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[2]; // z=0
        const belts = mergePathTo(target, Y0 + 3, 0, 2); // 起点 2 层，目标 0 层
        expect(belts[belts.length - 1].localOffset[0].z).toBe(0);
        expect(belts[0].localOffset[0].z).toBe(2);
        const cmd = new CreateBeltLineCommand(belts, null, null, 0, undefined, target);
        cmd.do(bp);
        expect(cmd.merged).toBe(true);
        expect(belts[belts.length - 1].outputObjIdx).toBe(target.index);
    });

    test("末格不相邻 → 不汇入（保持末格终结）", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[2];
        // 距离目标 2 格以上
        const far = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 + 6 },
            { x: 2, y: Y0 + 4 },
            90,
            "latFirst"
        );
        const cmd = new CreateBeltLineCommand(far, null, null, 0, undefined, target);
        cmd.do(bp);
        expect(cmd.merged).toBe(false);
        expect(far[far.length - 1].outputObjIdx).toBe(-1);
    });

    test("跨区域目标 → 不汇入", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[1];
        const belts = mergePathTo(target, Y0 + 3);
        target.areaIndex = 1; // 模拟跨区域
        const cmd = new CreateBeltLineCommand(belts, null, null, 0, undefined, target);
        cmd.do(bp);
        expect(cmd.merged).toBe(false);
        target.areaIndex = 0;
    });

    test("目标即末格自己 → 不汇入", () => {
        const bp = createEmptyBlueprint();
        chain(bp); // 蓝图里先有一条既有线路（不参与汇入）
        const belts = buildBeltLine(
            2001,
            35,
            { x: 6, y: Y0 },
            { x: 7, y: Y0 },
            90,
            "latFirst"
        );
        const last = belts[belts.length - 1];
        const cmd = new CreateBeltLineCommand(belts, null, null, 0, undefined, last);
        cmd.do(bp);
        expect(cmd.merged).toBe(false);
        expect(last.outputObjIdx).toBe(-1);
    });
});