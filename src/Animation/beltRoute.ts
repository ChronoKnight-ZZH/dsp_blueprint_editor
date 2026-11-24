import type { BlueprintBuilding } from "@/blueprint/parser";
import { isBelt } from "@/data/items";

/**
 * 传送带「路线」构建（纯函数，无 three 依赖 → Jest 可测）。
 *
 * 职责：把 `BlueprintBuilding[]` 的 `outputObjIdx` 连接关系（单出边、可多入边）
 * 解析成若干条**连续路线**，供带状网格与货物动画共用同一份路径数据。
 *
 * 为什么要路线而不是逐格：
 *   - 逐格动画里每格各自持有相位，货物必须在格边界「淡出→淡入」才能在下一格出现，
 *     于是整条线看起来是一格一格地闪；路线层把「累计距离」提升为一等公民后，
 *     货物、箭头、条带三者拿的是同一个坐标，跨格天然连续；
 *   - 路线的拓扑是**函数图**（每格至多一个后继），所以遍历是 O(N) 的链式行走，
 *     不需要通用图搜索。
 *
 * 使用：由 `buildBuildings` 在构建期调用一次；结果里的 `cells` 顺序即流向顺序，
 * `closed` 决定环形路线是否首尾相接（几何侧重连最后一段 → 第一段）。
 *
 * 边界：
 *   - **只搬运拓扑**：不做任何几何 / 长度计算。每格的路径长度依赖 `beltArc` 解出的
 *     形状（直段 / 转角弧 / 垂直段），由几何层按 `BeltShape` 累加，避免这里重复一套
 *     几何公式；
 *   - **不做回流动画**：开放路线末端如何循环（隐藏回流 / 停止 / 直接取模）属于渲染层
 *     决策，`closed` 只是把它标出来；
 *   - 汇合点（多入边）归**先建立**的那条路线，其余路线在该格**之前**结束 —— 两条
 *     路线仍然在同一格边界相接，视觉上不断开，且保证「一格只属于一条路线」，
 *     货物不会被复制；
 *   - 输出到非传送带建筑（机器 / 悬空 / 目标不存在）一律视为路线终点。
 */

/**
 * 分叉处的后继选择策略。
 *
 * - `min-angle`：取与当前流向夹角最小的后继（默认）。与蓝图数据顺序无关，运输最连续；
 * - `data-order`：按 `outputObjIdx` 出现顺序取第一个。仅用于对照 / 排障。
 *
 * 说明：当前 DSP 蓝图里一条传送带记录只有**一个** `outputObjIdx`，所以分叉只会在
 * 「同一 index 出现多条记录」（分流器的多出口被拆写成多条记录）时发生。策略保留在这里，
 * 一旦数据形态变化不需要改调用方。
 */
export type BeltForkStrategy = "min-angle" | "data-order";

/** 路线构建的可选参数；省略即文档推荐值（最小夹角）。 */
export interface BeltRouteOptions {
    /** 分叉处的后继选择策略，默认 `min-angle` */
    forkStrategy?: BeltForkStrategy;
}

/**
 * 一条连续路线：一段或多段传送带格，按流向排序。
 *
 * 边界：`cells` 只含传送带格（`isBelt` 为真）；单格路线是合法结果（孤立格 / 汇合点的
 * 支线尾格），此时 `closed` 恒为 false。
 */
export interface BeltRoute {
    /** 路线序号（构建顺序，0 起）：几何层用它给每路线分配自己的距离坐标系 */
    id: number;
    /** 依次经过的传送带格（`BlueprintBuilding.index`），顺序 = 流向 */
    cells: number[];
    /**
     * 是否闭合环路：末格的 `outputObjIdx` 指回首格。
     *
     * 闭合路线可以自然循环（货物取模不跳变）；开放路线由渲染层决定回流方式。
     */
    closed: boolean;
}

/** 路线构建结果 */
export interface BeltRoutesResult {
    /** 按构建顺序排列的全部路线 */
    routes: BeltRoute[];
    /** 格 index → 所在路线的 `BeltRoute.id`；只包含传送带格 */
    routeOf: Map<number, number>;
    /**
     * 连接异常（目标不存在 / 自环）的明细。
     *
     * **已限流**：每类最多 `ROUTE_ISSUE_SAMPLE_LIMIT` 条，超出的折成一行汇总，
     * 与 `beltArc.ISSUE_SAMPLE_LIMIT` 同一套风格（大蓝图上不允许刷爆控制台）。
     */
    issues: string[];
    /** 异常**总条数**（未限流），调用方用它判断严重程度 */
    issueCount: number;
}

/** 每类连接异常最多保留的明细条数（限流原因见 `BeltRoutesResult.issues`） */
export const ROUTE_ISSUE_SAMPLE_LIMIT = 4;

/** 平地上的格子中心（格单位）：只用于方向判定，不用于任何长度 / 姿态计算 */
interface GridPoint {
    x: number;
    y: number;
}

/**
 * 由建筑列表构建传送带路线。
 *
 * 调用条件：只用于构建期（`buildBuildings`），输入必须是解析后的完整建筑表 ——
 * `outputObjIdx` 是引用 `BlueprintBuilding.index` 的全局下标，缺格会让路线断在中间。
 *
 * 失败 / 退化行为：
 *   - 目标 index 不存在 → 记一条异常并按「无后继」处理，路线在此结束；
 *   - 自环（自己指向自己）→ 记一条异常，该格单独成一条开放路线；
 *   - 汇合点已被前一条路线占用 → 本路线停在它的前一格，不复制该格。
 */
export function buildBeltRoutes(
    buildings: BlueprintBuilding[],
    options: BeltRouteOptions = {}
): BeltRoutesResult {
    const forkStrategy = options.forkStrategy ?? "min-angle";

    const byIndex = new Map<number, BlueprintBuilding>();
    for (const b of buildings) byIndex.set(b.index, b);

    const issues: string[] = [];
    const issueCounts = new Map<string, number>();
    let issueCount = 0;
    const report = (category: string, message: string) => {
        issueCount++;
        const n = (issueCounts.get(category) ?? 0) + 1;
        issueCounts.set(category, n);
        if (n <= ROUTE_ISSUE_SAMPLE_LIMIT) issues.push(message);
    };

    /** 传送带后继表：key = 源格，value = 后继格（去重、保持数据顺序） */
    const successors = new Map<number, number[]>();
    /** 传送带入度（只数传送带前驱）：入度 0 的格是开放路线的天然起点 */
    const inDegree = new Map<number, number>();
    const beltCells: number[] = [];

    for (const b of buildings) {
        if (!isBelt(b.itemId)) continue;
        beltCells.push(b.index);
        if (!inDegree.has(b.index)) inDegree.set(b.index, 0);
    }

    for (const b of buildings) {
        if (!isBelt(b.itemId)) continue;
        const out = b.outputObjIdx;
        if (out < 0) continue;
        const target = byIndex.get(out);
        if (target === undefined) {
            report(
                "目标不存在",
                `#${b.index} 的 outputObjIdx=${out} 不存在，路线在此结束`
            );
            continue;
        }
        // 输出到机器 / 分拣器等非传送带建筑：路线正常结束，不算异常
        if (!isBelt(target.itemId)) continue;
        if (target.index === b.index) {
            report("自环", `#${b.index} 的 outputObjIdx 指向自己，按单格路线处理`);
            continue;
        }
        const list = successors.get(b.index);
        if (list === undefined) successors.set(b.index, [target.index]);
        else if (!list.includes(target.index)) list.push(target.index);
        inDegree.set(target.index, (inDegree.get(target.index) ?? 0) + 1);
    }

    /** 格心（格单位）；缺格返回 null（只影响方向判定，不影响拓扑） */
    const centerOf = (index: number): GridPoint | null => {
        const b = byIndex.get(index);
        if (b === undefined) return null;
        return { x: b.localOffset[0].x, y: b.localOffset[0].y };
    };

    /** 数据 yaw 给出的流向：与本项目 `dir(θ) = (sin θ, cos θ)` 同一约定 */
    const yawDirection = (index: number): GridPoint | null => {
        const b = byIndex.get(index);
        if (b === undefined) return null;
        const rad = (b.yaw[0] / 180) * Math.PI;
        return { x: Math.sin(rad), y: Math.cos(rad) };
    };

    /**
     * 从 `from` 走向 `to` 的方向，退化（同格 / 缺格 / 上升格）时返回 null。
     *
     * 用水平格心差而不是三维弦：上升格（垂直段）的横向位移 ≈ 0，方向在这里是噪声，
     * 交给 `yawDirection` 兜底；坡度不参与分叉判定（与文档「夹角最小」同口径）。
     */
    const directionBetween = (
        from: number,
        to: number
    ): GridPoint | null => {
        const a = centerOf(from);
        const b = centerOf(to);
        if (a === null || b === null) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return null;
        return { x: dx / len, y: dy / len };
    };

    /**
     * 分叉选后继：`min-angle` 取与当前流向点积最大者（同分取数据顺序靠前者，
     * 保证结果与 Map / Set 的迭代顺序无关，只依赖 `buildings` 的给定顺序）。
     */
    const selectNext = (
        current: number,
        prev: number | null,
        candidates: number[]
    ): number => {
        if (candidates.length <= 1 || forkStrategy === "data-order")
            return candidates[0];

        // 当前流向：优先用「来向 → 本格」的实际走向，起点的第一个格用数据 yaw
        const forward =
            prev !== null ? directionBetween(prev, current) : null;
        const fallback = forward ?? yawDirection(current);
        if (fallback === null) return candidates[0];

        let best = candidates[0];
        let bestScore = -Infinity;
        for (const cand of candidates) {
            const dir = directionBetween(current, cand);
            const score = dir === null ? -Infinity : fallback.x * dir.x + fallback.y * dir.y;
            if (score > bestScore) {
                bestScore = score;
                best = cand;
            }
        }
        return best;
    };

    const routes: BeltRoute[] = [];
    const routeOf = new Map<number, number>();
    const visited = new Set<number>();

    /**
     * 从 `start` 起沿后继行走，直到没有未占用的后继。
     *
     * `closed` 的判定：唯一出口指回本路线起点（此时不再加入重复格，环由几何层闭合）。
     */
    const walk = (start: number): { cells: number[]; closed: boolean } => {
        const cells = [start];
        visited.add(start);
        let prev: number | null = null;
        let current = start;
        let closed = false;

        for (;;) {
            const all = successors.get(current);
            if (all === undefined || all.length === 0) break;
            // 起点本身允许作为候选：它是「闭环」的那条边（visited 里排掉它就无法识别环）
            const candidates = all.filter(
                (t) => t === start || !visited.has(t)
            );
            if (candidates.length === 0) break;

            const next = selectNext(current, prev, candidates);
            if (next === start) {
                closed = true;
                break;
            }
            cells.push(next);
            visited.add(next);
            prev = current;
            current = next;
        }

        return { cells, closed };
    };

    // ① 先走开放路线：入度 0 的格是线头（含「从机器接出来」的格）
    for (const index of beltCells) {
        if (visited.has(index)) continue;
        if ((inDegree.get(index) ?? 0) > 0) continue;
        const { cells, closed } = walk(index);
        routes.push({ id: routes.length, cells, closed });
    }

    // ② 再走剩余的环 / 被汇合点截断的尾巴
    for (const index of beltCells) {
        if (visited.has(index)) continue;
        const { cells, closed } = walk(index);
        routes.push({ id: routes.length, cells, closed });
    }

    for (const route of routes) {
        for (const cell of route.cells) routeOf.set(cell, route.id);
    }

    // 汇总被限流掉的明细：总数不能丢（否则大蓝图上只剩 4 条看不出规模）
    for (const [category, total] of issueCounts) {
        const shown = Math.min(total, ROUTE_ISSUE_SAMPLE_LIMIT);
        if (total > shown) {
            issues.push(
                `…「${category}」另有 ${total - shown} 条（明细已省略，该类共 ${total} 条）`
            );
        }
    }

    return { routes, routeOf, issues, issueCount };
}
