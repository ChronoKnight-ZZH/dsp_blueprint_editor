import type { BlueprintBuilding } from "@/blueprint/parser";
import { isBelt } from "@/data/items";
import { HEIGHT_GRID_SIZE } from "@/planet/planetConstants";
import { BELT_EDGE_GAP, BELT_LEN, BELT_SLOPE_EPS } from "./belt";
import type { BeltArcParams } from "./belt";

/**
 * 传送带单格形状求解（纯函数，无 three 依赖 → Jest 可测）。
 *
 * 职责：把 `BlueprintBuilding[]` 的连接关系（`outputObjIdx` 反查出的前驱 + 后继）
 * 解析成「每格一个形状」，并算出**几何空间**里的圆弧参数，交给 `Belts.setArcAt`。
 *
 * 为什么在 CPU 算（v4 的核心改动）：
 *   - v3 把圆心 / θ 范围写死在 GLSL 里，只能表达「yaw 是角平分线」这一种坐标系，
 *     左右转要靠 `h = -sign(bend)` 手工翻符号，且没有任何办法单元测试；
 *   - 现在圆心、半径、θ 起止都是数据，着色器里只剩 `mix` + 一次三角函数。
 *   - 圆弧对平移 / 旋转 / 镜像封闭，所以在**格子坐标**算完再乘一个 2×2 帧变换搬到
 *     实例局部帧是**精确等价**的（半径不变、角度整体平移或取反），不是近似。
 *
 * 判定表（`(入线, 出线)` 组合的唯一出口，见 §「格几何只有两种解」）：
 *   | 入 / 出 | 形状 |
 *   |---|---|
 *   | 0 / 0 | 圆点（`dot`） |
 *   | 0 / 1、1 / 0 | 直段 + 开放端半圆帽 |
 *   | 1 / 1 同轴 | 直段 |
 *   | 1 / 1 邻轴 | 90° 转角 |
 *   | N / 1 | 与出线共线的入线走直通主线，其余入线只贴边、不转弯 |
 *   | N / 1（无共线主线） | 按出线方向画直段（三线共点的"丁"，见 T字路口二） |
 *
 * 格几何只有两种解的原因：正方形的两个边中点要么相邻（共享角点，圆心 = 该角点、
 * 半径 = 半格长、扫角 ±90°），要么相对（直段）。掉头（180°）在网格里无法表达——
 * 它只能表现为「入边 = 出边」，此时入点与出点重合、半径 0、扫角 0，即退化成点。
 *
 * ⚠️ 唯一的外部假设：**DSP 的 `yaw` 是入/出方向的角平分线**（直段时就是流向）。
 * 圆心与 θ 都按 `yaw` 给出的帧换算到几何空间，所以这个假设不成立时转角会整体偏转。
 * 已在 `data/` 下 10 份真实蓝图（90° / 180° / U 型 / 大小环形 / 十字 / 三种坡度）
 * 的 13 个转角格上核对：yaw 与角平分线的偏差全部 < 1°；同一 yaw 下 v3 与 v4 的几何
 * 偏差 ≤ 2.1e-4（即数据里的 yaw 自带一点浮点噪声，新实现改用精确的格方向，略微更准）。
 */

/** 形状种类：圆点 / 直段 / 90° 转角 */
export type BeltShapeKind = "dot" | "straight" | "corner";

/** 单格形状：圆弧参数 + 判定结果 + 端帽需求 */
export interface BeltShape extends BeltArcParams {
    kind: BeltShapeKind;
    /** 后端开放（没有一格相邻的传送带前驱）→ 后端加半圆帽 */
    capBack: boolean;
    /** 前端开放（相邻格里没有任何建筑）→ 前端加半圆帽 */
    capFront: boolean;
    /**
     * 该格有后继（`outputObjIdx >= 0`）。
     *
     * 只描述连接关系，**不再决定是否挂货物**：现在每个非圆点的条带格都有货物，
     * 线尾格（`capFront`）的货物行程会收到端帽尖点，在那里缩没。
     */
    hasOut: boolean;
    /** 一格相邻的传送带前驱 index（无则 null） */
    inIndex: number | null;
    /** 一格相邻的传送带后继 index（无则 null） */
    outIndex: number | null;
}

export interface BeltShapesResult {
    /** key = `BlueprintBuilding.index`；只包含传送带格 */
    shapes: Map<number, BeltShape>;
    /** 退化 / 需要人工关注的连接（构建期 `console.warn` 用） */
    issues: string[];
}

/** 恰好一格的整数方向；侧口 0.2 / 隔格 2.4 / 非整数偏移都返回 null */
interface Step {
    dx: number;
    dy: number;
}

function oneGridStep(
    from: BlueprintBuilding,
    to: BlueprintBuilding
): Step | null {
    const a = from.localOffset[0];
    const b = to.localOffset[0];
    const dx = Math.round(b.x - a.x);
    const dy = Math.round(b.y - a.y);
    if (Math.abs(b.x - a.x - dx) > 1e-3) return null;
    if (Math.abs(b.y - a.y - dy) > 1e-3) return null;
    return Math.abs(dx) + Math.abs(dy) === 1 ? { dx, dy } : null;
}

/**
 * 格子坐标（格单位，格心为原点）→ 几何空间（`position` 所在的空间，世界单位）。
 *
 * 推导（两端都要对得上，错一处转角就会整体斜 45°）：
 *   1. `base = Ry(lon)·Rx(-lat)·Rz(-yaw)·T`，其局部 +y 轴就是本格流向，所以
 *      格子方向 (dx, dy) 在 base 局部坐标里是 `Rz(yaw)·(dx, dy)`（**旋转**，无镜像）；
 *   2. 实例矩阵再乘 `Rx(π/2)`，它把几何 +z 映射到 base 的 -y，于是
 *      `gx = lx`、`gz = -ly` —— 这一步是**镜像**，也是「左右转符号相反」的根源；
 *   3. 格单位 × `BELT_LEN` 得世界单位。
 *
 * 组合结果 `(gx, gz) = ((c·px − s·py), −(s·px + c·py)) · BELT_LEN`，行列式 = −1。
 */
function toGeometry(
    px: number,
    py: number,
    yaw: number
): { x: number; z: number } {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return {
        x: (c * px - s * py) * BELT_LEN,
        z: -(s * px + c * py) * BELT_LEN,
    };
}

/** 把 `atan2` 的差值归一化到 (−π, π]，避免 ±180° 处的分支切割 */
function normalizeSweep(sweep: number): number {
    let s = sweep;
    while (s > Math.PI) s -= Math.PI * 2;
    while (s <= -Math.PI) s += Math.PI * 2;
    return s;
}

/**
 * 解析整份建筑的传送带形状。
 *
 * 单次 O(N)：先按 `outputObjIdx` 反查前驱表，再逐格判定。
 * **不读 `inputObjIdx`**：实测蓝图里传送带的该字段一律为 −1（见 data/T字路口.json 16/16），
 * 反查 `outputObjIdx` 是唯一可靠来源。
 */
export function computeBeltShapes(
    buildings: BlueprintBuilding[]
): BeltShapesResult {
    const shapes = new Map<number, BeltShape>();
    const issues: string[] = [];
    const byIndex = new Map(buildings.map((b) => [b.index, b]));

    // 前驱表：谁 output 到了我
    const preds = new Map<number, number[]>();
    for (const b of buildings) {
        if (b.outputObjIdx < 0) continue;
        const target = byIndex.get(b.outputObjIdx);
        if (target === undefined) {
            issues.push(`#${b.index} 的 outputObjIdx=${b.outputObjIdx} 不存在`);
            continue;
        }
        const list = preds.get(target.index);
        if (list === undefined) preds.set(target.index, [b.index]);
        else list.push(b.index);
    }

    const beltPreds = (index: number): number[] =>
        (preds.get(index) ?? []).filter((i) => {
            const p = byIndex.get(i);
            return p !== undefined && isBelt(p.itemId);
        });

    for (const b of buildings) {
        if (!isBelt(b.itemId)) continue;

        const yaw = (b.yaw[0] / 180) * Math.PI;
        const self = b.localOffset[0];

        // ── 入线：只认「一格相邻的传送带前驱」 ──
        const ins: { index: number; step: Step }[] = [];
        for (const pi of beltPreds(b.index)) {
            const p = byIndex.get(pi);
            if (p === undefined) continue;
            const step = oneGridStep(p, b);
            if (step === null) {
                issues.push(
                    `#${b.index} 有一条非一格前驱 #${pi}（侧口 / 隔格），按无连接处理`
                );
                continue;
            }
            ins.push({ index: pi, step });
        }

        // ── 出线：同一条记录只有一个 outputObjIdx ──
        const outB =
            b.outputObjIdx >= 0 ? byIndex.get(b.outputObjIdx) : undefined;
        const outStep = outB === undefined ? null : oneGridStep(b, outB);
        const beltOutStep =
            outB !== undefined && isBelt(outB.itemId) ? outStep : null;

        const hasOut = b.outputObjIdx >= 0;
        const isDot =
            !hasOut && beltPreds(b.index).length === 0 && ins.length === 0;

        // ── 主线选取 ──
        let dirIn: Step | null = null;
        let inIndex: number | null = null;
        if (ins.length === 1) {
            dirIn = ins[0].step;
            inIndex = ins[0].index;
        } else if (ins.length > 1) {
            const main = ins.find(
                (s) =>
                    beltOutStep !== null &&
                    s.step.dx === beltOutStep.dx &&
                    s.step.dy === beltOutStep.dy
            );
            if (main !== undefined) {
                // 扇入但有直通主线（丁字）：形状完全确定，不算异常，不打日志
                dirIn = main.step;
                inIndex = main.index;
            } else if (ins.length > 2) {
                issues.push(
                    `#${b.index} 三条以上入线且无直通主线，按出向画直段`
                );
            }
        }

        // ── 形状 + 圆弧参数 ──
        let kind: BeltShapeKind = isDot ? "dot" : "straight";
        let centerX = 0;
        let centerZ = 0;
        let theta0 = 0;
        let theta1 = 0;

        if (kind !== "dot" && dirIn !== null && beltOutStep !== null) {
            const along = dirIn.dx * beltOutStep.dx + dirIn.dy * beltOutStep.dy;
            if (along === 0) {
                // 转角：圆心 = 入射边与出射边共享的格角点 = (−din + dout) / 2
                const c = toGeometry(
                    (-dirIn.dx + beltOutStep.dx) / 2,
                    (-dirIn.dy + beltOutStep.dy) / 2,
                    yaw
                );
                const entry = toGeometry(-dirIn.dx / 2, -dirIn.dy / 2, yaw);
                const exit = toGeometry(
                    beltOutStep.dx / 2,
                    beltOutStep.dy / 2,
                    yaw
                );
                kind = "corner";
                centerX = c.x;
                centerZ = c.z;
                theta0 = Math.atan2(entry.z - c.z, entry.x - c.x);
                theta1 =
                    theta0 +
                    normalizeSweep(
                        Math.atan2(exit.z - c.z, exit.x - c.x) - theta0
                    );
            } else if (along < 0) {
                // 入出反向 = 掉头：网格里无解（入点与出点重合），按直段兜底
                issues.push(
                    `#${b.index} 入 (${dirIn.dx},${dirIn.dy}) 与出 (${beltOutStep.dx},${beltOutStep.dy}) 反向，按直段渲染`
                );
            }
        }

        // ── 出口切线（几何空间单位向量）：支线外延方向，所有情况都等于格方向 ──
        let exitX = 0;
        let exitZ = 0;
        if (beltOutStep !== null) {
            const d = toGeometry(beltOutStep.dx, beltOutStep.dy, yaw);
            exitX = d.x / BELT_LEN;
            exitZ = d.z / BELT_LEN;
        }

        // ── 坡度：只认「一格相邻的传送带后继」 ──
        let slope = 0;
        if (beltOutStep !== null && outB !== undefined) {
            const raw = (outB.localOffset[0].z - self.z) * HEIGHT_GRID_SIZE;
            slope = Math.abs(raw) < BELT_SLOPE_EPS ? 0 : raw;
        }

        // ── 支线贴边：本格输出到一个扇入格子，又不是那条主线 → 外延一截 ──
        let extend = 0;
        if (beltOutStep !== null && outB !== undefined) {
            const outIns = beltPreds(outB.index).filter((pi) => {
                const p = byIndex.get(pi);
                return p !== undefined && oneGridStep(p, outB) !== null;
            });
            if (outIns.length >= 2) {
                const outOut =
                    outB.outputObjIdx >= 0
                        ? byIndex.get(outB.outputObjIdx)
                        : undefined;
                const outOutStep =
                    outOut === undefined ? null : oneGridStep(outB, outOut);
                const isMain =
                    outOutStep !== null &&
                    outOutStep.dx === beltOutStep.dx &&
                    outOutStep.dy === beltOutStep.dy;
                if (!isMain) extend = BELT_EDGE_GAP;
            }
        }

        shapes.set(b.index, {
            kind,
            theta0,
            theta1,
            centerX,
            centerZ,
            slope,
            extend,
            exitX,
            exitZ,
            capBack: ins.length === 0,
            capFront: outStep === null,
            hasOut,
            inIndex,
            outIndex: beltOutStep !== null ? b.outputObjIdx : null,
        });
    }

    return { shapes, issues };
}
