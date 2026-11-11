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

/**
 * 形状种类：圆点 / 直段 / 90° 转角 / **垂直段**。
 *
 * `riser` = 本格把货送到「**同一格**的上/下一层」（`outputObjIdx` 指向同格不同层的带子）。
 * 它不是圆弧：90° 的坡度剪切无解（`slope → ∞`），所以由 `buildBuildings` 用**刚性帧**
 * 渲染成一根竖条（局部 -z 沿法线），不是走 `slope` 那条路。
 *
 * 判定互斥：`riser` 要求 `Δxy ≈ 0`，而 `straight / corner` 要求 `|Δx|+|Δy| = 1`，
 * 所以一格只会是其中一种。
 */
export type BeltShapeKind = "dot" | "straight" | "corner" | "riser";

/** 单格形状：圆弧参数 + 判定结果 + 端帽需求 */
export interface BeltShape extends BeltArcParams {
    kind: BeltShapeKind;
    /**
     * 垂直段的高度差（世界单位，带符号：`> 0` 向上、`< 0` 向下；非垂直段为 0）。
     *
     * 与 `slope` 互斥且语义不同：`slope` 是「**格与格之间**的坡度」（顶点剪切，斜着爬一格），
     * `rise` 是「**同一格内**上下层的高度差」（整条刚性竖起来）。`rise ≠ 0` 时 `slope` 恒为 0。
     */
    rise: number;
    /**
     * **后端**开放：本格没有任何入线（不含分拣器）→ 后端加半圆帽并把条带端面内收。
     *
     * 判据是「完全没有任何建筑链进来」，不是「没有一格相邻的传送带」：侧口 / 隔格这种
     * 认不出几何的连线也算连线，此时**不加帽、不内收**，否则会在真实接头上凭空挖出
     * 一条 0.49 的缝（v6 的 bug）。
     */
    capBack: boolean;
    /** **前端**开放：本格没有出线（`outputObjIdx < 0`）→ 前端加半圆帽并内收 */
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
    /**
     * 本格**渲染朝向**（度，`dir(θ) = (sin θ, cos θ)`）：由连接方向推导，不用数据里的 yaw。
     *
     * 直段 = 流向；转角 = 入/出方向的角平分线；单端连接 = 那一端的方向；无连接 = 数据 yaw。
     * 调用方要把实例矩阵的 `Rz(数据yaw − 本值)` 补上，相邻格的端面才会严格对齐。
     */
    yawDeg: number;
}

export interface BeltShapesResult {
    /** key = `BlueprintBuilding.index`；只包含传送带格 */
    shapes: Map<number, BeltShape>;
    /**
     * 退化 / 需要人工关注的连接（构建期 `console.warn` 用）。
     *
     * **已限流**：每类最多 `ISSUE_SAMPLE_LIMIT` 条明细，超出的折成一行汇总
     * （「…另有 N 条（明细已省略）」），所以行数上限 ≈ 类别数 ×(1+limit)。
     */
    issues: string[];
    /** 问题**总条数**（未限流）：调用方拿它判断严重程度，明细看 `issues` */
    issueCount: number;
}

/**
 * 每类问题最多保留的明细条数。
 *
 * 为什么要在**收集侧**限流，而不是只在打印时截断：
 *   - `data/全球白糖（带电源）`（5 万条带、异尺度退化数据）实测产生 **26592 条** 问题，
 *     拼成一条 `console.warn` 就是几十万字符 —— 每次重建都把控制台刷爆，还拖慢构建；
 *   - 数组本身也要分配 2.6 万个长字符串；限流后明细 ≤ 25 行，汇总里仍保留总数与每个类别。
 */
export const ISSUE_SAMPLE_LIMIT = 4;

/** 恰好一格的整数方向；侧口 0.2 / 隔格 2.4 / 非整数偏移都返回 null */
interface Step {
    dx: number;
    dy: number;
}

/**
 * 「一格」判定的容差（格单位）。
 *
 * 不能取 1e-3：**上升格（垂直段）的邻格不是整数格**。实测
 * `data/三种坡度上升的高度1.txt` 的 `#5(4.000)→#6(3.002)`、`#6(3.002)→#7(3.000)`
 * 两条连线都带 `1.58e-3 ~ 1.59e-3` 的横向偏移（DSP 给上升格记录的中心是偏的），
 * 旧阈值 1e-3 会把它们判成「侧口 / 隔格」→ 两条条带各自掉进固定段长的回退帧，
 * 线头那一格也就跟着丢链（`issues` 里报「非一格前驱」，实测 2 条）。
 *
 * 取 5e-3：比实测偏移大 3 倍，又比「真的不是一格」的最小观测值小一个量级
 * （退化样本里 0.02 格起）。**再调大要谨慎**：`data/全球白糖（带电源）` 的步长分布
 * 在 0.02 处有一大簇（5549 条），容差跨过 0.02 会一次性改变那份蓝图的判定结果。
 */
export const GRID_STEP_EPS = 5e-3;

function oneGridStep(
    from: BlueprintBuilding,
    to: BlueprintBuilding
): Step | null {
    const a = from.localOffset[0];
    const b = to.localOffset[0];
    const dx = Math.round(b.x - a.x);
    const dy = Math.round(b.y - a.y);
    if (Math.abs(b.x - a.x - dx) > GRID_STEP_EPS) return null;
    if (Math.abs(b.y - a.y - dy) > GRID_STEP_EPS) return null;
    return Math.abs(dx) + Math.abs(dy) === 1 ? { dx, dy } : null;
}

/**
 * 「同格上下层」判定：`Δxy ≈ 0` 且高度差有实质 → 返回**世界高度差**（带符号），否则 0。
 *
 * 实测 `data/三种坡度上升的高度1.txt` 的 `#6(3.002,2,0) → #7(3,2,1)`：两条记录在**同一格**
 * （横向差 1.58e-3，比 `GRID_STEP_EPS` 小一个量级），高度差 `Δz = 1` 层 = `4/3` 世界单位。
 * 这就是 DSP 的「上升格 / 垂直段」：一格的货直接上下到同格另一层，横向几乎不走。
 *
 * 高度差同样用 `BELT_SLOPE_EPS` 过滤：数据里存在 `Δz = ±0.01/0.02` 的亚台阶噪声，
 * 不滤掉会把普通平地格误判成垂直段。
 */
function sameCellRise(
    from: BlueprintBuilding,
    to: BlueprintBuilding
): number {
    const a = from.localOffset[0];
    const b = to.localOffset[0];
    if (Math.abs(b.x - a.x) > GRID_STEP_EPS) return 0;
    if (Math.abs(b.y - a.y) > GRID_STEP_EPS) return 0;
    const raw = (b.z - a.z) * HEIGHT_GRID_SIZE;
    return Math.abs(raw) < BELT_SLOPE_EPS ? 0 : raw;
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

    /**
     * 问题收集器：按**类别**计数，明细只留前 `ISSUE_SAMPLE_LIMIT` 条。
     *
     * `category` 同时是汇总行里显示的标签，所以取短名（不带 building index）。
     */
    const issueCounts = new Map<string, number>();
    let issueCount = 0;
    const report = (category: string, message: string) => {
        issueCount++;
        const n = (issueCounts.get(category) ?? 0) + 1;
        issueCounts.set(category, n);
        if (n <= ISSUE_SAMPLE_LIMIT) issues.push(message);
    };

    // 前驱表：谁 output 到了我
    const preds = new Map<number, number[]>();
    for (const b of buildings) {
        if (b.outputObjIdx < 0) continue;
        const target = byIndex.get(b.outputObjIdx);
        if (target === undefined) {
            report(
                "目标不存在",
                `#${b.index} 的 outputObjIdx=${b.outputObjIdx} 不存在`
            );
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

        const self = b.localOffset[0];

        // ── 入线：只认「一格相邻的传送带前驱」 ──
        const ins: { index: number; step: Step }[] = [];
        for (const pi of beltPreds(b.index)) {
            const p = byIndex.get(pi);
            if (p === undefined) continue;
            const step = oneGridStep(p, b);
            if (step === null) {
                // 同格上下层（前驱是正下方/正上方的上升格）：这是垂直段的另一端，
                // 是真实接头但不是一格水平相邻 → 不参与转角判定，也不报异常
                if (sameCellRise(p, b) !== 0) continue;
                report(
                    "非一格前驱",
                    `#${b.index} 有一条非一格前驱 #${pi}（侧口 / 隔格），本格按自身朝向渲染`
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
        /** 出线是同格的另一层 → 本格是垂直段（`rise` 带符号；否则 0） */
        const outRise =
            outB !== undefined && isBelt(outB.itemId)
                ? sameCellRise(b, outB)
                : 0;

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
                report(
                    "扇入无主线",
                    `#${b.index} 三条以上入线且无直通主线，按出向画直段`
                );
            }
        }

        // ── 本格朝向：由**连接方向**推导，不再读数据里的 yaw ──
        // 这是从 master 的「格心连线」学来的一条：那边每根连接杆直接画在两个格心之间，
        // 与 yaw 无关，所以永远接得上。这里同理——直段取流向、转角取角平分线，
        // 单个端连接就取那一端；只有彻底没连线（圆点）才回落到数据 yaw。
        let flowX = 0;
        let flowY = 0;
        let hasFlow = false;
        if (dirIn !== null && beltOutStep !== null) {
            const sx = dirIn.dx + beltOutStep.dx;
            const sy = dirIn.dy + beltOutStep.dy;
            if (sx !== 0 || sy !== 0) {
                // 直段 → 流向；转角 → 角平分线（两者都是单位向量相加后归一）
                const len = Math.hypot(sx, sy);
                flowX = sx / len;
                flowY = sy / len;
                hasFlow = true;
            } else {
                // 入出反向（掉头）：无解，取出向兜底
                flowX = beltOutStep.dx;
                flowY = beltOutStep.dy;
                hasFlow = true;
            }
        } else if (dirIn !== null) {
            flowX = dirIn.dx;
            flowY = dirIn.dy;
            hasFlow = true;
        } else if (beltOutStep !== null) {
            flowX = beltOutStep.dx;
            flowY = beltOutStep.dy;
            hasFlow = true;
        }
        const yawDeg = hasFlow
            ? (Math.atan2(flowX, flowY) * 180) / Math.PI
            : b.yaw[0];
        const yaw = (yawDeg / 180) * Math.PI;
        if (hasFlow) {
            // 数据 yaw 与连线不符时按连线渲染（否则条带会斜着摆、端面对不上邻格）
            const delta = Math.abs(((b.yaw[0] - yawDeg + 540) % 360) - 180);
            if (delta > 20) {
                report(
                    "yaw 与连线不符",
                    `#${b.index} 的 yaw=${b.yaw[0].toFixed(1)}° 与连线方向 ` +
                        `${yawDeg.toFixed(1)}° 相差 ${delta.toFixed(
                            1
                        )}°，已按连线修正`
                );
            }
        }

        // ── 形状 + 圆弧参数 ──
        // 垂直段优先：出线是本格另一层 → 这一格不转弯、也不斜坡，整条刚性竖起来
        let kind: BeltShapeKind = isDot
            ? "dot"
            : outRise !== 0
            ? "riser"
            : "straight";

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
                report(
                    "入出反向",
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
            rise: outRise,
            theta0,
            theta1,
            centerX,
            centerZ,
            slope,
            extend,
            exitX,
            exitZ,
            // 只有「完全没有连线」的一端才算开放：侧口 / 隔格这类认不出几何的连线
            // 也算有连接，此时不封帽也不内收，避免在真实接头上挖出缝
            capBack: (preds.get(b.index) ?? []).length === 0,
            capFront: !hasOut,
            hasOut,
            inIndex,
            outIndex: beltOutStep !== null ? b.outputObjIdx : null,
            yawDeg,
        });
    }

    // 汇总：每类被限流掉的条数折成一行，总数不丢（否则大蓝图上就只剩 4 条明细、看不出规模）
    for (const [category, total] of issueCounts) {
        const shown = Math.min(total, ISSUE_SAMPLE_LIMIT);
        if (total > shown) {
            issues.push(
                `…「${category}」另有 ${total - shown} 条（明细已省略，该类共 ${total} 条）`
            );
        }
    }

    return { shapes, issues, issueCount };
}
