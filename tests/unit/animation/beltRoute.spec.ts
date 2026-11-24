import { buildBeltRoutes, ROUTE_ISSUE_SAMPLE_LIMIT } from "@/Animation/beltRoute";
import type { BlueprintBuilding } from "@/blueprint/parser";

/**
 * 传送带路线构建（`beltRoute.ts`）的单测。
 *
 * 这一层决定「哪些格属于同一条线」——货物间距、箭头相位、闭环循环全部建立在它上面，
 * 所以拓扑必须可断言。覆盖：
 *   1. 直线 / 闭合环 / 多条独立线的基本分段；
 *   2. 汇合点（多入边）只归属先建立的路线，支线不复制该格；
 *   3. 尾接环：线头喂进环时整条（含环）是一条开放路线；
 *   4. 路线终点：输出到机器、输出目标不存在、自环；
 *   5. 分叉策略 `min-angle` vs `data-order` 的选择差异；
 *   6. 全部传送带格都必须有归属（不允许丢格）。
 */

interface Spec {
    x: number;
    y: number;
    /** 指向哪一格（数组下标）；-1 / 省略 = 无输出 */
    out?: number;
    yaw?: number;
}

/**
 * 按下标生成传送带格。
 *
 * `index` 必须等于数组下标，`outputObjIdx` 才指得对（与 `beltArc.spec` 同一套约定）。
 */
function cells(specs: Spec[]): BlueprintBuilding[] {
    return specs.map((s, i) => ({
        index: i,
        areaIndex: 0,
        localOffset: [
            { x: s.x, y: s.y, z: 0 },
            { x: s.x, y: s.y, z: 0 },
        ] as BlueprintBuilding["localOffset"],
        yaw: [s.yaw ?? 0, s.yaw ?? 0] as BlueprintBuilding["yaw"],
        tilt: 0,
        itemId: 2001,
        modelIndex: 35,
        outputObjIdx: s.out ?? -1,
        inputObjIdx: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        recipeId: 0,
        filterId: 0,
        parameters: null,
    }));
}

/** 把结果压成「路线 = 格序列」的可读形式，方便整体断言 */
function cellLists(buildings: BlueprintBuilding[]) {
    const { routes } = buildBeltRoutes(buildings);
    return routes.map((r) => r.cells);
}

describe("buildBeltRoutes", () => {
    test("直线：一格链走成一条开放路线，顺序与 outputObjIdx 一致", () => {
        // 0 → 1 → 2 → 3 → 4（沿 +x 排开）
        const buildings = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 1, y: 0, out: 2, yaw: 90 },
            { x: 2, y: 0, out: 3, yaw: 90 },
            { x: 3, y: 0, out: 4, yaw: 90 },
            { x: 4, y: 0, yaw: 90 },
        ]);
        const { routes, routeOf } = buildBeltRoutes(buildings);

        expect(routes).toHaveLength(1);
        expect(routes[0].cells).toEqual([0, 1, 2, 3, 4]);
        expect(routes[0].closed).toBe(false);
        expect(routes[0].id).toBe(0);
        for (const i of [0, 1, 2, 3, 4]) expect(routeOf.get(i)).toBe(0);
    });

    test("闭合环：没有入度 0 的格也能成环，且标记 closed", () => {
        // 0 → 1 → 2 → 3 → 0
        const buildings = cells([
            { x: 0, y: 0, out: 1 },
            { x: 1, y: 0, out: 2 },
            { x: 1, y: 1, out: 3 },
            { x: 0, y: 1, out: 0 },
        ]);
        const { routes } = buildBeltRoutes(buildings);

        expect(routes).toHaveLength(1);
        expect(routes[0].closed).toBe(true);
        expect(routes[0].cells).toEqual([0, 1, 2, 3]);
    });

    test("孤立格：单格开放路线，不与别的线合并", () => {
        const buildings = cells([
            { x: 0, y: 0 },
            { x: 5, y: 5, out: 2 },
            { x: 6, y: 5 },
        ]);
        const lists: number[][] = cellLists(buildings);

        expect(lists).toHaveLength(2);
        expect(lists).toContainEqual([0]);
        expect(lists).toContainEqual([1, 2]);
    });

    test("汇合点：多入边时格只归属先建立的路线，支线在它前一格结束", () => {
        // 0 → 1 → 3 ；2 → 1（扇入）
        const buildings = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 1, y: 0, out: 3, yaw: 90 },
            { x: 0, y: 1, out: 1, yaw: 0 },
            { x: 2, y: 0, yaw: 90 },
        ]);
        const { routes, routeOf } = buildBeltRoutes(buildings);
        const lists = routes.map((r) => r.cells);

        // 入度 0 的是 0 和 2（数据顺序）：先建 [0,1,3]，再建 [2]
        expect(lists).toEqual([
            [0, 1, 3],
            [2],
        ]);
        expect(routeOf.get(1)).toBe(0);
        // 一格只属于一条路线（货物不会被复制）
        expect(routes.flatMap((r) => r.cells)).toHaveLength(4);
    });

    test("尾接环：线头喂进环时，整条（线头 + 环）是一条开放路线", () => {
        // 0 → 1 → 2 → 3 → 1（1-2-3 是环）
        const buildings = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 1, y: 0, out: 2, yaw: 90 },
            { x: 2, y: 0, out: 3, yaw: 0 },
            { x: 2, y: 1, out: 1, yaw: 270 },
        ]);
        const { routes } = buildBeltRoutes(buildings);

        expect(routes).toHaveLength(1);
        expect(routes[0].cells).toEqual([0, 1, 2, 3]);
        expect(routes[0].closed).toBe(false);
    });

    test("输出到非传送带建筑：路线在该格结束，不算异常", () => {
        const buildings = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 1, y: 0, out: 2, yaw: 90 },
            // 第 3 条记录是机器（非传送带），被 1 指向
            { x: 2, y: 0, yaw: 90 },
        ]);
        buildings[2].itemId = 2301;

        const { routes, issues, issueCount } = buildBeltRoutes(buildings);

        expect(routes).toHaveLength(1);
        expect(routes[0].cells).toEqual([0, 1]);
        expect(issueCount).toBe(0);
        expect(issues).toHaveLength(0);
    });

    test("输出目标不存在：记一条异常，路线在该格结束", () => {
        const buildings = cells([
            { x: 0, y: 0, out: 9, yaw: 90 },
            { x: 1, y: 0 },
        ]);
        const { routes, issues, issueCount } = buildBeltRoutes(buildings);

        expect(routes.map((r) => r.cells)).toEqual([[0], [1]]);
        expect(issueCount).toBe(1);
        expect(issues[0]).toContain("#0");
        expect(issues[0]).toContain("不存在");
    });

    test("自环：记一条异常，该格单独成开放路线", () => {
        const buildings = cells([{ x: 0, y: 0, out: 0 }]);
        const { routes, issues, issueCount } = buildBeltRoutes(buildings);

        expect(routes).toHaveLength(1);
        expect(routes[0]).toEqual({ id: 0, cells: [0], closed: false });
        expect(issueCount).toBe(1);
        expect(issues[0]).toContain("指向自己");
    });

    test("异常明细限流：每类只留 4 条，但总数不丢", () => {
        const specs: Spec[] = [];
        for (let i = 0; i < 10; i++) specs.push({ x: i, y: 0, out: 999 });
        const { issues, issueCount } = buildBeltRoutes(cells(specs));

        expect(issueCount).toBe(10);
        // 4 条明细 + 1 条「另有 6 条」汇总
        expect(issues).toHaveLength(ROUTE_ISSUE_SAMPLE_LIMIT + 1);
        expect(issues[issues.length - 1]).toContain("另有 6 条");
    });

    describe("分叉策略", () => {
        /**
         * 构造一个分叉：同一个 `index` 出现两条记录（分流器多出口的数据形态）。
         * 源格朝 +x（yaw 90），两个候选分别在 +x（#1）与 +y（#2）。
         */
        function fork(): BlueprintBuilding[] {
            const base = cells([
                { x: 0, y: 0, yaw: 90 },
                { x: 1, y: 0, yaw: 90 },
                { x: 0, y: 1, yaw: 0 },
            ]);
            // 源格的两条出口记录：先 #2（+y）后 #1（+x），让两种策略给出不同答案
            const a: BlueprintBuilding = { ...base[0], outputObjIdx: 2 };
            const b: BlueprintBuilding = { ...base[0], outputObjIdx: 1 };
            return [a, b, base[1], base[2]];
        }

        test("min-angle：选与流向夹角最小的后继（+x 而不是数据顺序里的 +y）", () => {
            const { routes } = buildBeltRoutes(fork(), {
                forkStrategy: "min-angle",
            });
            expect(routes.map((r) => r.cells)).toEqual([[0, 1], [2]]);
        });

        test("data-order：取数据顺序里的第一个后继", () => {
            const { routes } = buildBeltRoutes(fork(), {
                forkStrategy: "data-order",
            });
            expect(routes.map((r) => r.cells)).toEqual([[0, 2], [1]]);
        });
    });

    test("全部传送带格都有归属（路线之间不重不漏）", () => {
        // 一条线 + 一个环 + 一个孤立格
        const buildings = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 1, y: 0, out: 2, yaw: 90 },
            { x: 2, y: 0, yaw: 90 },
            { x: 6, y: 6, out: 4 },
            { x: 7, y: 6, out: 3 },
            { x: 12, y: 12 },
        ]);
        const { routes, routeOf } = buildBeltRoutes(buildings);

        const flat = routes.flatMap((r) => r.cells);
        expect(flat.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(new Set(flat).size).toBe(flat.length);
        expect(routeOf.size).toBe(6);
        expect(routes.find((r) => r.cells.includes(3))?.closed).toBe(true);
    });
});
