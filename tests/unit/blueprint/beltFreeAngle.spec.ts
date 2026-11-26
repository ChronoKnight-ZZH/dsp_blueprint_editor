import * as fs from "fs";
import { buildBeltLine, CreateBeltLineCommand } from "@/blueprint/beltLine";
import type { BeltPortEnd } from "@/blueprint/beltLine";
import {
    CreateBuildingCommand,
    createBuilding,
    createEmptyBlueprint,
} from "@/blueprint/create";
import { fromStr, toStr } from "@/blueprint/parser";
import type { BlueprintBuilding } from "@/blueprint/parser";
import { parseBlueprintJSON } from "@/lib/blueprintJSON";
import { beltPortAt, portWorldNormal, portWorldOffset } from "@/data/beltPorts";
import { isBelt } from "@/data/items";

/**
 * 自由角度传送带（`straight` 模式）回归测试。
 *
 * 数据依据：`data/不同斜角传送带.json`（游戏 0.10.35 实测，复制到 fixtures）。
 * 样本规律：端点是整格点，段数 = round(两端欧氏距离)，中间节点 = 等分点，
 * yaw = 行进方向（0°=+y，90°=+x）。相邻节点可能四舍五入到同一格，
 * 所以占用判定不能对所有带都 round 成格。
 */

const FIXTURE = "tests/unit/blueprint/fixtures/freeAngleBelts.json";
/** 空画布根区域是 161 格高（原点纬度 -80）：放在 y=80 即赤道 */
const Y0 = 80;

function angleDiff(a: number, b: number): number {
    return Math.abs(((a - b + 540) % 360) - 180);
}

/** 沿 outputObjIdx 切出直线链（起点 = 没有上游的节点） */
function sampleChains(buildings: BlueprintBuilding[]): BlueprintBuilding[][] {
    const byIndex = new Map<number, BlueprintBuilding>();
    for (const b of buildings) byIndex.set(b.index, b);
    const hasPred = new Set<number>();
    for (const b of buildings)
        if (b.outputObjIdx >= 0) hasPred.add(b.outputObjIdx);
    const chains: BlueprintBuilding[][] = [];
    for (const start of buildings) {
        if (hasPred.has(start.index)) continue;
        const chain: BlueprintBuilding[] = [];
        let cur: BlueprintBuilding | undefined = start;
        while (cur !== undefined) {
            chain.push(cur);
            cur =
                cur.outputObjIdx >= 0
                    ? byIndex.get(cur.outputObjIdx)
                    : undefined;
        }
        chains.push(chain);
    }
    return chains;
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

describe("自由角度传送带（游戏样本）", () => {
    const data = parseBlueprintJSON(fs.readFileSync(FIXTURE, "utf-8"));
    const belts = data.buildings.filter((b) => isBelt(b.itemId));
    const chains = sampleChains(belts);

    test("5 条独立直线：段数 = round(欧氏长度)，节点为等分点", () => {
        expect(belts).toHaveLength(34);
        expect(chains).toHaveLength(5);
        for (const chain of chains) {
            const a = chain[0].localOffset[0];
            const b = chain[chain.length - 1].localOffset[0];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const n = chain.length - 1;
            expect(n).toBe(Math.round(len));
            for (let i = 0; i <= n; i++) {
                const t = i / n;
                const p = chain[i].localOffset[0];
                // 样本位置带球面/浮点噪声（实测最大约 0.009 格）
                expect(Math.abs(p.x - (a.x + (b.x - a.x) * t))).toBeLessThan(
                    0.02
                );
                expect(Math.abs(p.y - (a.y + (b.y - a.y) * t))).toBeLessThan(
                    0.02
                );
            }
        }
    });

    test("每段 yaw = 行进方向 atan2(dx, dy)（样本偏差 < 1.5°）", () => {
        for (const chain of chains) {
            for (let i = 0; i + 1 < chain.length; i++) {
                const p = chain[i].localOffset[0];
                const q = chain[i + 1].localOffset[0];
                const yaw =
                    ((Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI +
                        360) %
                    360;
                expect(angleDiff(chain[i].yaw[0], yaw)).toBeLessThan(1.5);
            }
        }
    });

    test("straight 生成与样本逐节点一致（端点吸整格）", () => {
        for (const chain of chains) {
            const a = chain[0].localOffset[0];
            const b = chain[chain.length - 1].localOffset[0];
            const generated = buildBeltLine(
                2001,
                35,
                { x: Math.round(a.x), y: Math.round(a.y) },
                { x: Math.round(b.x), y: Math.round(b.y) },
                90,
                "straight"
            );
            expect(generated).toHaveLength(chain.length);
            for (let i = 0; i < generated.length; i++) {
                const p = generated[i].localOffset[0];
                const q = chain[i].localOffset[0];
                expect(Math.abs(p.x - q.x)).toBeLessThan(0.02);
                expect(Math.abs(p.y - q.y)).toBeLessThan(0.02);
                expect(angleDiff(generated[i].yaw[0], chain[i].yaw[0])).toBeLessThan(
                    1.5
                );
            }
        }
    });

    test("同一 round 格的两条自由带都能入库（不按格去重）", () => {
        const bp = createEmptyBlueprint();
        for (const chain of chains) {
            const a = chain[0].localOffset[0];
            const b = chain[chain.length - 1].localOffset[0];
            new CreateBeltLineCommand(
                buildBeltLine(
                    2001,
                    35,
                    { x: Math.round(a.x), y: Math.round(a.y) },
                    { x: Math.round(b.x), y: Math.round(b.y) },
                    90,
                    "straight"
                )
            ).do(bp);
        }
        const placed = bp.buildings.filter((b) => isBelt(b.itemId));
        expect(placed).toHaveLength(34);
        // 样本 #3/#4（(4,1)）与 #7/#8（(1,4)）round 后同格，必须都在
        const cell = (x: number, y: number) =>
            placed.filter(
                (b) =>
                    Math.round(b.localOffset[0].x) === x &&
                    Math.round(b.localOffset[0].y) === y
            );
        expect(cell(4, 1)).toHaveLength(2);
        expect(cell(1, 4)).toHaveLength(2);
    });

    test("分数坐标导出/导入保持（每段间隔 ≈ 1 格）", () => {
        const bp = createEmptyBlueprint();
        const line = buildBeltLine(
            2001,
            35,
            { x: 0, y: Y0 },
            { x: 10, y: Y0 + 4 },
            90,
            "straight"
        );
        new CreateBeltLineCommand(line).do(bp);
        // round(hypot(10,4)) = 11 段
        expect(line).toHaveLength(12);
        const back = fromStr(toStr(bp));
        const parsed = back.buildings.filter((b) => isBelt(b.itemId));
        expect(parsed).toHaveLength(12);
        for (let i = 0; i + 1 < parsed.length; i++) {
            const dx =
                parsed[i + 1].localOffset[0].x -
                parsed[i].localOffset[0].x;
            const dy =
                parsed[i + 1].localOffset[0].y -
                parsed[i].localOffset[0].y;
            expect(Math.abs(dx - 10 / 11)).toBeLessThan(2e-3);
            expect(Math.abs(dy - 4 / 11)).toBeLessThan(2e-3);
        }
    });
});

describe("自由角度直线与建筑口 / 已有线路的衔接", () => {
    test("起点接建筑口：口格 + 法线外一格固定，之后才自由等分", () => {
        const bp = createEmptyBlueprint();
        const tank = createBuilding(2106, 121, { x: 5, y: Y0 }, 0, 0);
        new CreateBuildingCommand(tank).do(bp);
        const start = portEnd(tank, 0);
        const belts = buildBeltLine(
            2001,
            35,
            { x: 5, y: Y0 },
            { x: 10, y: Y0 - 4 },
            0,
            "straight",
            start,
            null
        );
        new CreateBeltLineCommand(belts, start, null).do(bp);

        // 口格（精确坐标）+ 法线格 + round(hypot(5,-6)) = 8 段的 9 个节点
        expect(belts).toHaveLength(10);
        expect(belts[0].localOffset[0].y).toBeCloseTo(Y0 + 1.11, 2);
        expect(belts[0].yaw[0]).toBeCloseTo(0, 6);
        expect(belts[0].inputObjIdx).toBe(tank.index);
        // 法线格固定为口格 + 口法线
        expect(belts[1].localOffset[0].x).toBe(5);
        expect(belts[1].localOffset[0].y).toBe(Y0 + 2);
        // 法线格 yaw = 进入（口法线 0°）与离开（自由线方向）的平分角
        const rad = Math.PI / 180;
        const outYaw = (Math.atan2(5, -6) * 180) / Math.PI;
        const expected =
            ((Math.atan2(
                Math.sin(outYaw * rad),
                1 + Math.cos(outYaw * rad)
            ) /
                rad) +
                360) %
            360;
        expect(belts[1].yaw[0]).toBeCloseTo(expected, 2);
        // 整条带同高
        for (const b of belts)
            expect(b.localOffset[0].z).toBeCloseTo(start.point.z, 6);
        // 末格仍是整格终点
        const last = belts[belts.length - 1];
        expect(last.localOffset[0].x).toBe(10);
        expect(last.localOffset[0].y).toBe(Y0 - 4);
        expect(last.outputObjIdx).toBe(-1);
        expect(last.outputToSlot).toBe(0);
    });

    test("两条自由线共享整格端点：复用节点，yaw = 两方向平分角", () => {
        const bp = createEmptyBlueprint();
        const first = buildBeltLine(
            2001,
            35,
            { x: 0, y: Y0 },
            { x: 5, y: Y0 + 5 },
            90,
            "straight"
        );
        new CreateBeltLineCommand(first).do(bp);
        const shared = bp.buildings.find(
            (b) => b.localOffset[0].x === 5 && b.localOffset[0].y === Y0 + 5
        );
        expect(shared).toBeDefined();
        expect(angleDiff(shared!.yaw[0], 45)).toBeLessThan(1e-6);
        expect(shared!.outputObjIdx).toBe(-1);

        const second = buildBeltLine(
            2001,
            35,
            { x: 5, y: Y0 + 5 },
            { x: 10, y: Y0 },
            90,
            "straight"
        );
        const cmd = new CreateBeltLineCommand(second);
        cmd.do(bp);
        // 第二段只新增 second.length - 1 条（首格复用）
        expect(bp.buildings.filter((b) => isBelt(b.itemId))).toHaveLength(
            first.length + second.length - 1
        );
        expect(shared!.yaw[0]).toBeCloseTo(90, 6);
        expect(shared!.outputObjIdx).toBeGreaterThanOrEqual(0);

        // 撤销：新增格移除、yaw 与输出连接一起还原（不能留下悬空 output）
        cmd.undo(bp);
        expect(bp.buildings.filter((b) => isBelt(b.itemId))).toHaveLength(
            first.length
        );
        expect(shared!.yaw[0]).toBeCloseTo(45, 6);
        expect(shared!.outputObjIdx).toBe(-1);
        expect(shared!.outputToSlot).toBe(0);
    });

    test("从已有线路中间节点起画：截断，不改动老线路", () => {
        const bp = createEmptyBlueprint();
        new CreateBeltLineCommand(
            buildBeltLine(
                2001,
                35,
                { x: 0, y: Y0 },
                { x: 5, y: Y0 + 5 },
                90,
                "straight"
            )
        ).do(bp);
        new CreateBeltLineCommand(
            buildBeltLine(
                2001,
                35,
                { x: 5, y: Y0 + 5 },
                { x: 10, y: Y0 },
                90,
                "straight"
            )
        ).do(bp);
        const before = bp.buildings.length;
        const shared = bp.buildings.find(
            (b) => b.localOffset[0].x === 5 && b.localOffset[0].y === Y0 + 5
        )!;
        const yawBefore = shared.yaw[0];

        // 共享节点已有下游（两个上游非法）→ 本次拖拽整体截断
        new CreateBeltLineCommand(
            buildBeltLine(
                2001,
                35,
                { x: 5, y: Y0 + 5 },
                { x: 15, y: Y0 + 5 },
                90,
                "straight"
            )
        ).do(bp);
        expect(bp.buildings).toHaveLength(before);
        expect(shared.yaw[0]).toBe(yawBefore);
        expect(shared.outputObjIdx).toBeGreaterThanOrEqual(0);
    });
});
