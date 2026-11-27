import { BlueprintBuilding } from "@/blueprint/parser";
import { CreateBuildingCommand, createBuilding, createEmptyBlueprint } from "@/blueprint/create";
import {
    buildBeltLine,
    CreateBeltLineCommand,
    BeltPortEnd,
} from "@/blueprint/beltLine";
import { beltPortAt, portWorldNormal, portWorldOffset } from "@/data/beltPorts";

/**
 * 传送带坡度爬升：**第一个点水平建造**，起点/终点两端都保持水平，爬坡夹在中间。
 *
 * 结构（与样本 `data/三种坡度上升的高度1.json` 一致）：
 *   z = [z0, z0, …爬坡…, z1, z1]
 * - 第一个点水平：首段固定平铺（z[1] = z0）；
 * - 终点保持水平：最后一段固定平铺（z[N-2] = z[N-1] = z1，终点格只有一条带）；
 * - 可用水平爬升段 = 总段数 − 2，按它选择写法：
 *   段数够 2×层数 → 缓坡（两段各 0.5，链 1：0,0,0.5,1,1）；
 *   否则 → 陡坡（一段 1 层，链 2：0,0,1,1）；
 *   层数超出可用段 → 起点后第一格原地垂直堆叠补层；
 * - L=1（两节点）：首段水平到终点格，再原地垂直升层；
 * - 下坡对称；straight 模式同样套用。
 *
 * 长度对照（升 1 层）：L=1 垂直 / L=2 起首末两段外无段可爬 → 垂直 /
 * L=3 中间 1 段 → 陡坡 / L=4 中间 2 段 → 缓坡。
 */

const Y0 = 80; // 赤道行：cos(lat)=1

const zs = (belts: BlueprintBuilding[]) =>
    belts.map((b) => b.localOffset[0].z);
const xs = (belts: BlueprintBuilding[]) =>
    belts.map((b) => b.localOffset[0].x);

/** 沿 +x 方向铺一条带（节点数 = x1 - x0 + 1） */
function line(
    x0: number,
    x1: number,
    baseZ?: number,
    startZ?: number,
    mode: "latFirst" | "lonFirst" | "straight" = "latFirst"
) {
    return buildBeltLine(
        2001,
        35,
        { x: x0, y: Y0 },
        { x: x1, y: Y0 },
        90,
        mode,
        null,
        null,
        undefined,
        baseZ,
        startZ
    );
}

function addBuilding(
    bp: ReturnType<typeof createEmptyBlueprint>,
    itemId: number,
    modelIndex: number,
    x: number,
    y: number,
    yaw = 0
): BlueprintBuilding {
    const b = createBuilding(itemId, modelIndex, { x, y }, yaw);
    new CreateBuildingCommand(b).do(bp);
    return b;
}

/** 建筑 → 带端绑定（与 BlueprintEditor 里的取值方式一致） */
function portEnd(building: BlueprintBuilding, slot: number): BeltPortEnd {
    const port = beltPortAt(building.itemId, building.modelIndex, slot);
    if (!port) throw new Error(`no port ${building.itemId}#${slot}`);
    const off = portWorldOffset(port, building.yaw[0], 1);
    const n = portWorldNormal(port, building.yaw[0]);
    return {
        building,
        slot,
        point: {
            x: building.localOffset[0].x + off.x,
            y: building.localOffset[0].y + off.y,
            z: off.z,
        },
        nx: n.x,
        ny: n.y,
    };
}

describe("传送带坡度：第一个点水平 + 两端水平", () => {
    test("4 格长度升 1 层 → 缓坡（中间两段各 0.5，样本链 1）", () => {
        expect(zs(line(0, 4, 1, 0))).toEqual([0, 0, 0.5, 1, 1]);
    });

    test("3 格长度升 1 层 → 陡坡（中间一段 1 层，样本链 2）", () => {
        expect(zs(line(0, 3, 1, 0))).toEqual([0, 0, 1, 1]);
    });

    test("2 格长度升 1 层 → 首末两段占满 → 中间格垂直升层", () => {
        const belts = line(0, 2, 1, 0);
        expect(xs(belts)).toEqual([0, 1, 1, 2]);
        expect(zs(belts)).toEqual([0, 0, 1, 1]);
    });

    test("1 格长度升 1 层 → 首段水平到终点格，再原地升层", () => {
        const belts = line(0, 1, 1, 0);
        expect(xs(belts)).toEqual([0, 1, 1]);
        expect(zs(belts)).toEqual([0, 0, 1]);
    });

    test("1 格长度升 2 层 → 终点格垂直堆叠", () => {
        const belts = line(0, 1, 2, 0);
        expect(xs(belts)).toEqual([0, 1, 1, 1]);
        expect(zs(belts)).toEqual([0, 0, 1, 2]);
    });

    test("6 格长度升 3 层 → 三段陡坡，末端平铺", () => {
        expect(zs(line(0, 5, 3, 0))).toEqual([0, 0, 1, 2, 3, 3]);
    });

    test("层数超出水平段：起点后第一格垂直堆叠补层，终点仍单条水平", () => {
        // 3 格升 2 层：中间格需要垂直补 2 层
        const three = line(0, 2, 2, 0);
        expect(xs(three)).toEqual([0, 1, 1, 1, 2]);
        expect(zs(three)).toEqual([0, 0, 1, 2, 2]);

        // 4 格升 3 层：中间格补 2 层 + 1 段陡坡
        const four = line(0, 3, 3, 0);
        expect(xs(four)).toEqual([0, 1, 1, 1, 2, 3]);
        expect(zs(four)).toEqual([0, 0, 1, 2, 3, 3]);
    });

    test("所有长度的首末两段都水平、终点格单条带", () => {
        for (let x1 = 2; x1 <= 6; x1++) {
            for (let d = 1; d <= 4; d++) {
                const belts = line(0, x1, d, 0);
                const n = belts.length;
                // 第一个点水平：起点格与第二格同高
                expect(belts[0].localOffset[0].z).toBe(0);
                expect(belts[1].localOffset[0].z).toBe(0);
                // 最后一段水平：最后两格同高 = 终点高度
                expect(belts[n - 1].localOffset[0].z).toBe(d);
                expect(belts[n - 2].localOffset[0].z).toBe(d);
                // 终点格只有一条带
                const endX = belts[n - 1].localOffset[0].x;
                expect(
                    belts.filter((b) => b.localOffset[0].x === endX)
                ).toHaveLength(1);
            }
        }
    });

    test("半层尾巴：起点 0.5 → 1 用一段 0.5 收口", () => {
        expect(zs(line(0, 2, 1, 0.5))).toEqual([0.5, 0.5, 1, 1]);
    });

    test("下坡对称", () => {
        expect(zs(line(0, 2, 0, 1))).toEqual([1, 1, 0, 0]);
        expect(zs(line(0, 3, 0, 1))).toEqual([1, 1, 0, 0]);
        expect(zs(line(0, 4, 0, 1))).toEqual([1, 1, 0.5, 0, 0]);
    });

    test("同格重复节点的 yaw 沿用平面路径（不退回 fallbackYaw）", () => {
        const belts = line(0, 1, 1, 0);
        for (const b of belts) expect(b.yaw[0]).toBeCloseTo(90, 6);
    });

    test("不传高度时保持整条同高（兼容旧调用）", () => {
        expect(zs(line(0, 3))).toEqual([0, 0, 0, 0]);
    });

    test("straight（自由角度）同样套用", () => {
        expect(zs(line(0, 3, 1, 0, "straight"))).toEqual([0, 0, 1, 1]);
        expect(zs(line(0, 2, 1, 0, "straight"))).toEqual([0, 0, 1, 1]);
    });
});

describe("传送带坡度：建筑口高度", () => {
    test("起点接 z=1 的口：口格水平，向下爬升到目标高度", () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 39, 5, Y0); // 一字形：1 口在 z=1
        const start = portEnd(splitter, 1);
        expect(start.point.z).toBe(1);
        const belts = buildBeltLine(
            2001,
            35,
            { x: 5, y: Y0 },
            { x: 5, y: Y0 + 4 },
            0,
            "latFirst",
            start,
            null,
            undefined,
            0 // 目标高度 0：从 1 缓坡降下来
        );
        expect(zs(belts)).toEqual([1, 1, 0.5, 0, 0]);
        expect(belts[0].inputObjIdx).toBe(splitter.index);
        expect(belts[0].inputFromSlot).toBe(1);
    });

    test("终点接 z=1 的口：末端水平爬升到口高度并保留连接字段", () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 39, 5, Y0);
        const end = portEnd(splitter, 3); // z=1，法线 -y
        const belts = buildBeltLine(
            2001,
            35,
            { x: 5, y: Y0 - 4 },
            { x: 5, y: Y0 },
            0,
            "latFirst",
            null,
            end,
            undefined,
            0
        );
        expect(zs(belts)).toEqual([0, 0, 0.5, 1, 1]);
        const last = belts[belts.length - 1];
        expect(last.localOffset[0].z).toBe(1);
        expect(last.outputObjIdx).toBe(splitter.index);
        expect(last.outputToSlot).toBe(3);
    });

    test("只给口高度、不给目标高度 → 整条同高（旧行为兼容）", () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 39, 5, Y0);
        const start = portEnd(splitter, 1);
        const belts = buildBeltLine(
            2001,
            35,
            { x: 5, y: Y0 },
            { x: 5, y: Y0 + 4 },
            0,
            "latFirst",
            start,
            null
        );
        for (const b of belts) expect(b.localOffset[0].z).toBe(1);
    });
});

describe("传送带坡度：入库与撤销", () => {
    test("带垂直堆叠的坡度线可完整入库并撤销", () => {
        const bp = createEmptyBlueprint();
        const belts = line(0, 1, 2, 0);
        expect(belts.length).toBe(4);
        const cmd = new CreateBeltLineCommand(belts);
        cmd.do(bp);
        expect(bp.buildings.length).toBe(4);
        // 同格不同高度的带互不截断（zLayer 身份）
        expect(
            bp.buildings.filter((b) => b.localOffset[0].x === 1)
        ).toHaveLength(3);
        cmd.undo(bp);
        expect(bp.buildings.length).toBe(0);
    });

    test("缓坡线入库后连接字段串联、末格终结", () => {
        const bp = createEmptyBlueprint();
        const belts = line(0, 4, 1, 0);
        new CreateBeltLineCommand(belts).do(bp);
        // 新格按路径顺序串联
        const added = bp.buildings;
        expect(added.length).toBe(5);
        for (let i = 0; i < added.length - 1; i++) {
            expect(added[i].outputObjIdx).toBe(added[i + 1].index);
            expect(added[i].outputToSlot).toBe(1);
        }
        expect(added[added.length - 1].outputObjIdx).toBe(-1);
        expect(added[added.length - 1].outputToSlot).toBe(0);
    });
});
