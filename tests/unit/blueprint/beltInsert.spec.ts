import {
    buildBeltLine,
    collectBeltChain,
    CreateBeltLineCommand,
    InsertBeltLineCommand,
} from "@/blueprint/beltLine";
import {
    createBuilding,
    createEmptyBlueprint,
    CreateBuildingCommand,
} from "@/blueprint/create";

/**
 * 阶段 5/6：从中间节点插入线路 + 整条链路收集。
 *
 * 插入（InsertBeltLineCommand）：原线路 P → B → C，B 是被点选的中间格；
 * 新线路从 B 接出（belts[0] = B 那一格，复用不新增），改写 B 的输出；
 * 新线路末端与 C 相邻时接回 C（绕行），否则 C 断开成新链头。
 * B 的上游 P 完全不动 —— 全线始终唯一上游、唯一下游。
 */

const Y0 = 80; // 赤道行：cos(lat)=1

/** 铺一条 (x0..x1, Y0) 的东西向链路（flow +x） */
function chain(bp: ReturnType<typeof createEmptyBlueprint>, x1 = 5) {
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

function addBuilding(
    bp: ReturnType<typeof createEmptyBlueprint>,
    itemId: number,
    modelIndex: number,
    x: number,
    y: number
) {
    const b = createBuilding(itemId, modelIndex, { x, y }, 0);
    new CreateBuildingCommand(b).do(bp);
    return b;
}

describe("collectBeltChain（整条链路收集）", () => {
    test("从中间格收集：上游 + 自身 + 下游按行进顺序", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        expect(collectBeltChain(line, 2)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(collectBeltChain(line, 0)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(collectBeltChain(line, 5)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    test("非传送带返回空", () => {
        const bp = createEmptyBlueprint();
        const storage = addBuilding(bp, 2101, 26, 9, Y0); // 储物仓
        expect(collectBeltChain(bp.buildings, storage.index)).toEqual([]);
        expect(collectBeltChain(bp.buildings, 9999)).toEqual([]);
    });

    test("断开的线路各自成链", () => {
        const bp = createEmptyBlueprint();
        const a = chain(bp, 2); // (0..2, Y0)
        const b = buildBeltLine(
            2001,
            35,
            { x: 0, y: Y0 + 4 },
            { x: 2, y: Y0 + 4 },
            90,
            "latFirst"
        );
        new CreateBeltLineCommand(b).do(bp);
        expect(collectBeltChain(bp.buildings, a[1].index)).toEqual([0, 1, 2]);
        expect(collectBeltChain(bp.buildings, b[1].index)).toEqual([
            b[0].index,
            b[1].index,
            b[2].index,
        ]);
    });
});

describe("InsertBeltLineCommand（中间格插入）", () => {
    test("基本插入：改写目标输出、原下游断开、yaw 重算", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp); // (0..5, Y0)
        const target = line[2]; // (2,Y0)，上游 line[1]，下游 line[3]
        // 新线路：从目标格向北 3 格（belts[0] = 目标格本身）
        const raw = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 2, y: Y0 + 3 },
            0,
            "latFirst"
        );
        expect(raw.length).toBe(4);

        const cmd = new InsertBeltLineCommand(raw, target, 0);
        cmd.do(bp);
        expect(bp.buildings.length).toBe(9); // +3 新格（目标格复用）
        // 目标输出改接新线路
        expect(target.outputObjIdx).toBe(raw[1].index);
        expect(target.outputToSlot).toBe(1);
        // 新线路内部串联，末格终结（原下游被断开）
        expect(raw[1].outputObjIdx).toBe(raw[2].index);
        expect(raw[2].outputObjIdx).toBe(raw[3].index);
        expect(raw[3].outputObjIdx).toBe(-1);
        expect(raw[3].outputToSlot).toBe(0);
        // 原下游自身链路不变（成新链头）
        expect(line[3].outputObjIdx).toBe(line[4].index);
        // 上游完全不动
        expect(line[1].outputObjIdx).toBe(target.index);
        expect(line[1].yaw[0]).toBeCloseTo(90, 6);
        // B yaw：入 +x(90°) 出 +y(0°) → 平分角 45°
        expect(target.yaw[0]).toBeCloseTo(45, 6);

        cmd.undo(bp);
        expect(bp.buildings.length).toBe(6);
        expect(target.outputObjIdx).toBe(line[3].index);
        expect(target.yaw[0]).toBeCloseTo(90, 6);

        // 重做
        cmd.do(bp);
        expect(bp.buildings.length).toBe(9);
        expect(target.outputObjIdx).toBe(raw[1].index);
        expect(target.yaw[0]).toBeCloseTo(45, 6);
    });

    test("绕行插入：新线路末端与原下游相邻时接回", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[2]; // (2,Y0)，C = line[3] = (3,Y0)
        // 新线路：(2,Y0) → (3,Y0+1)（lonFirst 先 y 后 x，不穿过 C 所在格）
        const raw = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 3, y: Y0 + 1 },
            0,
            "lonFirst"
        );
        expect(raw.length).toBe(3);

        const cmd = new InsertBeltLineCommand(raw, target, 0);
        cmd.do(bp);
        expect(bp.buildings.length).toBe(8); // +2 新格
        expect(target.outputObjIdx).toBe(raw[1].index);
        // 末格接回原下游
        expect(raw[2].outputObjIdx).toBe(line[3].index);
        expect(raw[2].outputToSlot).toBe(1);
        // C 的进入方向变北：in 180° + out 90° → 平分角 135°
        expect(line[3].yaw[0]).toBeCloseTo(135, 6);
        expect(target.yaw[0]).toBeCloseTo(45, 6);

        cmd.undo(bp);
        expect(bp.buildings.length).toBe(6);
        expect(target.outputObjIdx).toBe(line[3].index);
        expect(target.yaw[0]).toBeCloseTo(90, 6);
        expect(line[3].yaw[0]).toBeCloseTo(90, 6);
    });

    test("链头插入：目标无上游也能接出", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[0]; // 链头（有下游）
        const raw = buildBeltLine(
            2001,
            35,
            { x: 0, y: Y0 },
            { x: 0, y: Y0 + 2 },
            0,
            "latFirst"
        );
        new InsertBeltLineCommand(raw, target, 0).do(bp);
        expect(bp.buildings.length).toBe(8);
        expect(target.outputObjIdx).toBe(raw[1].index);
        expect(line[1].outputObjIdx).toBe(line[2].index); // 原下游保持
    });

    test("拒绝：目标已把货送入建筑口", () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 38, 10, Y0);
        // 带从南侧送入分流器 2 口：末格 outputObjIdx = 分流器
        const end = {
            building: splitter,
            slot: 2,
            point: { x: 10, y: Y0 - 0.2, z: 0 },
            nx: 0,
            ny: -1,
        };
        const incoming = buildBeltLine(
            2001,
            35,
            { x: 10, y: Y0 - 4 },
            { x: 10, y: Y0 },
            0,
            "latFirst",
            null,
            end
        );
        new CreateBeltLineCommand(incoming, null, end).do(bp);
        const feeder = incoming[incoming.length - 1];
        expect(feeder.outputObjIdx).toBe(splitter.index);

        const raw = buildBeltLine(
            2001,
            35,
            { x: 10, y: Y0 },
            { x: 10, y: Y0 + 2 },
            0,
            "latFirst"
        );
        expect(() =>
            new InsertBeltLineCommand(raw, feeder, 0).do(bp)
        ).toThrow("已接入建筑口");
        expect(bp.buildings.length).toBe(incoming.length + 1); // 只多了分流器
    });

    test("拒绝：新增格与已有传送带冲突（不产生部分插入）", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp); // (0..5, Y0)
        const target = line[0];
        // 新线路路径穿过已有带（(1..5, Y0) 全被占）
        const raw = buildBeltLine(
            2001,
            35,
            { x: 0, y: Y0 },
            { x: 5, y: Y0 },
            0,
            "latFirst"
        );
        expect(() =>
            new InsertBeltLineCommand(raw, target, 0).do(bp)
        ).toThrow("插入位置已有传送带");
        expect(bp.buildings.length).toBe(6);
        // 数据未被部分改写
        expect(target.outputObjIdx).toBe(line[1].index);
        expect(target.yaw[0]).toBeCloseTo(90, 6);
    });

    test("拒绝：插入起点与目标格不一致", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[2];
        const raw = buildBeltLine(
            2001,
            35,
            { x: 4, y: Y0 + 3 },
            { x: 4, y: Y0 + 5 },
            0,
            "latFirst"
        );
        expect(() =>
            new InsertBeltLineCommand(raw, target, 0).do(bp)
        ).toThrow("插入起点与目标格不一致");
    });

    test("坡度插入：光标端高度不同，首段与目标格同高", () => {
        const bp = createEmptyBlueprint();
        const line = chain(bp);
        const target = line[2]; // z=0
        // 光标端在 2 层（baseZ=2），目标格 0 层（startZ=0）：北向 3 格爬升
        const raw = buildBeltLine(
            2001,
            35,
            { x: 2, y: Y0 },
            { x: 2, y: Y0 + 3 },
            0,
            "latFirst",
            null,
            null,
            undefined,
            2, // 终点高度（光标端）= 2
            0 // 起点高度（目标格）= 0
        );
        // 剖面：首段水平（0,0）→ 目标格上方同格垂直补 1 层 → 陡坡到 2 → 末段水平
        expect(raw.map((b) => b.localOffset[0].z)).toEqual([0, 0, 1, 2, 2]);
        const cmd = new InsertBeltLineCommand(raw, target, 0);
        cmd.do(bp);
        expect(bp.buildings.length).toBe(10); // +4 新格（含同格堆叠那一条）
        // 目标格（z=0）接出的第一格与其同高：首段水平
        expect(target.outputObjIdx).toBe(raw[1].index);
        expect(raw[1].localOffset[0].z).toBe(0);
        cmd.undo(bp);
        expect(bp.buildings.length).toBe(6);
        expect(target.outputObjIdx).toBe(line[3].index);
    });
});
