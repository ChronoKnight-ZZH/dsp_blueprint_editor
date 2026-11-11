import { computeBeltShapes, ISSUE_SAMPLE_LIMIT } from "@/Animation/beltArc";
import type { BeltShape } from "@/Animation/beltArc";
import { BELT_EDGE_GAP, BELT_LEN, BELT_WIDTH } from "@/Animation/belt";
import { HEIGHT_GRID_SIZE } from "@/planet/planetConstants";
import type { BlueprintBuilding } from "@/blueprint/parser";

/**
 * 传送带形状求解（`beltArc.ts`）的单测。
 *
 * 这一层是 v4 的核心收益：几何从 GLSL 搬到了 TS，于是「转角端点对不对」「丁字怎么定形」
 * 这些以前只能靠肉眼看 WebGL 的东西，现在可以断言。覆盖：
 *   1. **与 v3 的几何等价**：8 个 (入向, 出向) 垂直组合 × 5 个相位，逐一对比旧公式；
 *   2. 三态判定（圆点 / 单端 + 端帽 / 直段 | 转角）；
 *   3. 丁字两种形态（T字路口 / T字路口二）：主线走直、支线只贴边不转弯；
 *   4. 退化连接（互指）与侧口（非一格）必须落回直段，绝不能把 sweep 送进着色器。
 */

const D = Math.PI / 180;

interface Spec {
    x: number;
    y: number;
    /** 指向哪一格（数组下标）；-1 = 无输出 */
    out?: number;
    yaw?: number;
    z?: number;
}

/** 按下标生成建筑：`index` 必须等于数组下标，`outputObjIdx` 才指得对 */
function cells(specs: Spec[]): BlueprintBuilding[] {
    return specs.map((s, i) => ({
        index: i,
        areaIndex: 0,
        localOffset: [
            { x: s.x, y: s.y, z: s.z ?? 0 },
            { x: s.x, y: s.y, z: s.z ?? 0 },
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

function shapeOf(buildings: BlueprintBuilding[], index: number): BeltShape {
    const { shapes } = computeBeltShapes(buildings);
    const s = shapes.get(index);
    if (s === undefined) throw new Error(`#${index} 没有形状`);
    return s;
}

/** v3 的几何公式（原样照抄当时的 GLSL），用作等价性基准 */
function v3Point(
    bend: number,
    px: number,
    u: number
): { x: number; z: number } {
    const h = -Math.sign(bend);
    const ang = h * (Math.PI / 2) * u;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const c0 = -h * Math.SQRT1_2;
    const s0 = Math.SQRT1_2;
    const dx = c0 * ca - s0 * sa;
    const dz = c0 * sa + s0 * ca;
    const r = BELT_LEN / 2 + px;
    return { x: h * (BELT_LEN / Math.SQRT2) + r * dx, z: r * dz };
}

/** v4 的几何公式（与 `BeltMaterial` 的顶点着色器同式） */
function v4Point(
    s: BeltShape,
    px: number,
    u: number
): { x: number; z: number } {
    const th = s.theta0 + (s.theta1 - s.theta0) * u;
    const r = BELT_LEN / 2 + px;
    return {
        x: s.centerX + r * Math.cos(th),
        z: s.centerZ + r * Math.sin(th),
    };
}

describe("beltArc · 与 v3 的几何等价性", () => {
    const dirs: [number, number][] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
    ];

    it("8 个垂直 (入, 出) 组合逐点重合，扫角恒为 ±90°", () => {
        let checked = 0;
        for (const din of dirs) {
            for (const dout of dirs) {
                if (din[0] * dout[0] + din[1] * dout[1] !== 0) continue;
                // 转角格在 (0,0)：入向 din → 前驱在 −din，出向 dout → 后继在 +dout
                const bx = (din[0] + dout[0]) / Math.SQRT2;
                const by = (din[1] + dout[1]) / Math.SQRT2;
                const yawDeg = Math.atan2(bx, by) / D; // yaw 是角平分线
                const list = cells([
                    { x: -din[0], y: -din[1], out: 1 },
                    { x: 0, y: 0, out: 2, yaw: yawDeg },
                    { x: dout[0], y: dout[1] },
                ]);

                const s = shapeOf(list, 1);
                expect(s.kind).toBe("corner");
                expect(Math.abs(s.theta1 - s.theta0)).toBeCloseTo(
                    Math.PI / 2,
                    9
                );

                // 旧公式里的 bend 由「出向 + yaw」决定，这里原样复刻
                const yaw = yawDeg * D;
                const turn = Math.atan2(
                    Math.sin(yaw) * dout[1] - Math.cos(yaw) * dout[0],
                    Math.sin(yaw) * dout[0] + Math.cos(yaw) * dout[1]
                );
                expect(Math.abs(turn)).toBeCloseTo(Math.PI / 4, 9);
                const bend = Math.sign(turn) * (Math.PI / 2);

                for (const px of [-BELT_WIDTH / 2, 0, BELT_WIDTH / 2]) {
                    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
                        const a = v3Point(bend, px, u);
                        const b = v4Point(s, px, u);
                        expect(b.x).toBeCloseTo(a.x, 9);
                        expect(b.z).toBeCloseTo(a.z, 9);
                    }
                }
                checked++;
            }
        }
        expect(checked).toBe(8);
    });

    it("半径恒为半格长，端点距圆心 = 半径（内圈不会被压成负）", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 2, yaw: 45 },
            { x: 1, y: 1 },
        ]);
        const s = shapeOf(list, 1);
        for (const u of [0, 1]) {
            const p = v4Point(s, 0, u);
            const r = Math.hypot(p.x - s.centerX, p.z - s.centerZ);
            expect(r).toBeCloseTo(BELT_LEN / 2, 9);
        }
        // 内圈半径必须为正，否则圆弧翻面（BELT_WIDTH 不能再加大）
        expect(BELT_LEN / 2 - BELT_WIDTH / 2).toBeGreaterThan(0);
    });
});

describe("beltArc · 三态判定", () => {
    it("无入无出 → 圆点", () => {
        const s = shapeOf(cells([{ x: 0, y: 0 }]), 0);
        expect(s.kind).toBe("dot");
    });

    it("只有入 → 直段 + 前端端帽（线尾格也是条带）", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1 },
        ]);
        const tail = shapeOf(list, 1);
        expect(tail.kind).toBe("straight");
        expect(tail.capFront).toBe(true);
        expect(tail.capBack).toBe(false);
        expect(tail.hasOut).toBe(false);
    });

    it("线头 / 中间 / 线尾的端帽需求", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 }, // 线头：无前驱
            { x: 0, y: 1, out: 2 }, // 中间
            { x: 0, y: 2 }, // 线尾：无后继
        ]);
        const head = shapeOf(list, 0);
        expect(head.capBack).toBe(true);
        expect(head.capFront).toBe(false);
        const mid = shapeOf(list, 1);
        expect(mid.capBack).toBe(false);
        expect(mid.capFront).toBe(false);
        const tail = shapeOf(list, 2);
        expect(tail.capBack).toBe(false);
        expect(tail.capFront).toBe(true);
    });

    it("同轴进出 → 直段（扫角 0）；邻轴 → 转角", () => {
        const straight = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 2 },
            { x: 0, y: 2 },
        ]);
        const s = shapeOf(straight, 1);
        expect(s.kind).toBe("straight");
        expect(s.theta1 - s.theta0).toBe(0);

        const corner = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 2, yaw: 45 },
            { x: 1, y: 1 },
        ]);
        expect(shapeOf(corner, 1).kind).toBe("corner");
    });
});

describe("beltArc · 丁字（扇入）", () => {
    /** T字路口：横线主 + 竖线支（实测 data/T字路口.json 的形态） */
    function t1() {
        return cells([
            { x: 2, y: 5, out: 1, yaw: 270 }, // A 主线来向
            { x: 1, y: 5, out: 2, yaw: 270 }, // B 汇合格（2 入 1 出）
            { x: 0, y: 5, yaw: 270 }, // C 线尾
            { x: 1, y: 3, out: 4, yaw: 0 }, // D 支线
            { x: 1, y: 4, out: 1, yaw: 0 }, // E 支线末端
        ]);
    }

    it("主线走直（不生成转角），支线末端贴边外延", () => {
        const list = t1();
        const junction = shapeOf(list, 1);
        // 与出向共线的入线（来自东边的 #0）是主线 → 直段，扫角 0
        expect(junction.kind).toBe("straight");
        expect(junction.theta1 - junction.theta0).toBe(0);
        // 汇合格有两个前驱 → 后端不封帽
        expect(junction.capBack).toBe(false);

        // 支线末端 (#4) 需要外延 (半格长 − 半条带宽) 才能贴上主线侧边
        const branch = shapeOf(list, 4);
        expect(branch.extend).toBeCloseTo(BELT_EDGE_GAP, 9);
        expect(BELT_EDGE_GAP).toBeCloseTo((BELT_LEN - BELT_WIDTH) / 2, 9);
        // 主线来向那一格不能外延（否则会顶穿主线）
        expect(shapeOf(list, 0).extend).toBe(0);
    });

    it("三条线共点（两条反向共线入 + 垂直出）→ 按出向画直段，两条支线都贴边", () => {
        // T字路口二：竖线从上下两端汇入，格心向西出
        const list = cells([
            { x: 5, y: 4, out: 2, yaw: 0 }, // A 从下往上
            { x: 5, y: 6, out: 2, yaw: 180 }, // B 从上往下
            { x: 5, y: 5, out: 3, yaw: 270 }, // C 汇合格：2 入 1 出（向西）
            { x: 4, y: 5, out: 4, yaw: 270 }, // D 向西
            { x: 3, y: 5, yaw: 270 }, // E 线尾
        ]);
        const junction = shapeOf(list, 2);
        expect(junction.kind).toBe("straight");
        expect(junction.theta1 - junction.theta0).toBe(0);
        // 两条竖线都要贴边（它们都不与西向出线共线）
        expect(shapeOf(list, 0).extend).toBeCloseTo(BELT_EDGE_GAP, 9);
        expect(shapeOf(list, 1).extend).toBeCloseTo(BELT_EDGE_GAP, 9);
    });
});

describe("beltArc · 退化与异常连接", () => {
    it("互指（A→B→A）：按直段渲染，不把 sweep 送进着色器", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 0 },
        ]);
        const { shapes, issues } = computeBeltShapes(list);
        for (const s of shapes.values()) {
            expect(s.kind).toBe("straight");
            expect(s.theta1 - s.theta0).toBe(0);
        }
        expect(issues.join("")).toContain("反向");
    });

    it("侧口 / 隔格输出（非一格）→ 不猜转角，但也**不封帽不内收**（那是真实接头）", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 2, yaw: 0 },
            { x: 0.2, y: 1, yaw: 0 },
        ]);
        const s = shapeOf(list, 1);
        expect(s.kind).toBe("straight");
        // 认不出几何（不是一格）→ 不能画圆环；但这是一条真实连接，
        // 封帽会把条带端面往里收 0.49，接头上就会凭空出现一条缝（v6 的 bug）
        expect(s.capFront).toBe(false);
        expect(s.capBack).toBe(false);
        expect(s.extend).toBe(0);
        // 朝向仍由入向决定：入 (0,1) → dir(θ)=（-x?）——入向是 +y，所以 θ = 0
        expect(s.yawDeg).toBeCloseTo(0, 6);
    });

    it("真·线尾（完全没有输出）才封帽", () => {
        const list = cells([
            { x: 5, y: 5, out: 1 },
            { x: 5, y: 6 },
        ]);
        expect(shapeOf(list, 1).capFront).toBe(true);
        expect(shapeOf(list, 0).capBack).toBe(true);
    });

    it("朝向由连线推导：数据 yaw 与连接方向不符时 yawDeg 仍按连线", () => {
        // 流向 +y（θ = 0），但三格的 yaw 都写成 90（脏数据）
        const northbound = cells([
            { x: 0, y: 0, out: 1, yaw: 90 },
            { x: 0, y: 1, out: 2, yaw: 90 },
            { x: 0, y: 2, yaw: 90 },
        ]);
        for (const idx of [0, 1, 2]) {
            expect(shapeOf(northbound, idx).yawDeg).toBeCloseTo(0, 6);
        }
        // 流向 +x（θ = 90）的格子照样是 90，与数据 yaw 无关
        const eastbound = cells([
            { x: 0, y: 0, out: 1, yaw: 12 },
            { x: 1, y: 0, out: 2, yaw: 12 },
            { x: 2, y: 0, yaw: 12 },
        ]);
        expect(shapeOf(eastbound, 1).yawDeg).toBeCloseTo(90, 6);
        // 转角取角平分线：入 +y、出 +x → 45°
        const corner = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0, y: 1, out: 2, yaw: 0 },
            { x: 1, y: 1, yaw: 0 },
        ]);
        expect(shapeOf(corner, 1).yawDeg).toBeCloseTo(45, 6);
    });

    it("自环 outputObjIdx === index 不会抛错，且不产生 NaN", () => {
        const list = cells([{ x: 0, y: 0, out: 0 }]);
        const { shapes } = computeBeltShapes(list);
        const s = shapes.get(0)!;
        expect(s.kind).toBe("straight");
        expect(Number.isFinite(s.theta0)).toBe(true);
        expect(Number.isFinite(s.centerX)).toBe(true);
    });

    it("前驱 / 后继是分拣器（非传送带）时按开放端处理", () => {
        const list = cells([{ x: 0, y: 0, out: 1 }]);
        list.push({
            ...list[0],
            index: 1,
            localOffset: [
                { x: 0, y: 1, z: 0 },
                { x: 0, y: 1, z: 0 },
            ],
            itemId: 2011, // 分拣器
            outputObjIdx: -1,
        });
        const s = shapeOf(list, 0);
        expect(s.kind).toBe("straight");
        // 后继建筑就在相邻格（机器会盖住端面）→ 不加端帽
        expect(s.capFront).toBe(false);
    });
});

describe("beltArc · 分数偏移（上升格的邻格）", () => {
    /**
     * 实测 `data/三种坡度上升的高度1.txt` 的 `#5(4.000,2,0) → #6(3.002,2,0) → #7(3,2,1)`：
     * DSP 给「上升格」记录的中心是偏的，与邻格差 `0.998`（带 1.58e-3 偏移），
     * 不是整数格 —— 旧阈值 1e-3 会把这两条真实连线判成侧口。
     */
    function riserChain() {
        return cells([
            { x: 4, y: 2, z: 0, out: 1, yaw: 270 }, // #0 平地来向
            { x: 3.002, y: 2, z: 0, out: 2, yaw: 270 }, // #1 上升格（中心偏 1.58e-3）
            { x: 3, y: 2, z: 1, yaw: 270 }, // #2 上一层（与 #1 同格，Δz = 1）
        ]);
    }

    it("1.58e-3 的横向偏移仍算「一格」：不掉回退帧、朝向按连线", () => {
        const { shapes } = computeBeltShapes(riserChain());
        // #0 ↔ #1 互相认作一格相邻 → 条带走 lookAt + 世界距离，而不是固定段长回退帧
        expect(shapes.get(0)!.outIndex).toBe(1);
        expect(shapes.get(1)!.inIndex).toBe(0);
        // 朝向由连线推导（沿 -x），与数据 yaw 无关
        expect(shapes.get(0)!.yawDeg).toBeCloseTo(-90, 6);
        expect(shapes.get(1)!.yawDeg).toBeCloseTo(-90, 6);
    });

    it("容差边界：0.02 格仍判为非一格（不把真·侧口吞进一格）", () => {
        const list = cells([
            { x: 0, y: 0, out: 1 },
            { x: 0.02, y: 0 },
        ]);
        expect(shapeOf(list, 0).outIndex).toBeNull();
    });

    it("上升格本体（同格 Δz=1）判成 riser，不再是「非一格前驱」", () => {
        const { shapes, issues } = computeBeltShapes(riserChain());
        expect(shapes.get(1)!.kind).toBe("riser");
        expect(shapes.get(1)!.rise).toBeCloseTo(HEIGHT_GRID_SIZE, 9);
        // 上层格的前驱是同格的垂直段 → 不参与转角判定，也不报「侧口」
        expect(shapes.get(2)!.inIndex).toBeNull();
        expect(issues).toHaveLength(0);
    });
});

describe("beltArc · 垂直段（riser）", () => {
    function chain(fromZ: number, toZ: number) {
        return cells([
            { x: 4, y: 2, z: fromZ, out: 1, yaw: 270 }, // #0 水平来料
            { x: 3.002, y: 2, z: fromZ, out: 2, yaw: 270 }, // #1 垂直段
            { x: 3, y: 2, z: toZ, yaw: 270 }, // #2 另一层（同格）
        ]);
    }

    it("上升：rise = Δz × HEIGHT_GRID_SIZE，且不取坡度、前端不封帽", () => {
        const s = shapeOf(chain(0, 1), 1);
        expect(s.kind).toBe("riser");
        expect(s.rise).toBeCloseTo(HEIGHT_GRID_SIZE, 9);
        expect(s.slope).toBe(0);
        expect(s.capFront).toBe(false);
        expect(s.hasOut).toBe(true);
        // outIndex 只表示「一格**水平**后继」：垂直段没有，但连接确实存在（hasOut）
        expect(s.outIndex).toBeNull();
    });

    it("下降：rise 为负，同样判成 riser", () => {
        const s = shapeOf(chain(1, 0), 1);
        expect(s.kind).toBe("riser");
        expect(s.rise).toBeCloseTo(-HEIGHT_GRID_SIZE, 9);
    });

    it("亚台阶噪声（同格 Δz=0.02）不算垂直段", () => {
        const s = shapeOf(chain(0, 0.02), 1);
        expect(s.kind).toBe("straight");
        expect(s.rise).toBe(0);
    });

    it("垂直段本身仍是「非圆点」：有连接就一定有货物", () => {
        const { shapes } = computeBeltShapes(chain(0, 1));
        for (const s of shapes.values()) expect(s.kind).not.toBe("dot");
    });
});

describe("beltArc · 问题清单限流", () => {
    /** n 条首尾相接、但每步偏 0.2 格的带子：每一步都会报一条「非一格前驱」 */
    function manyBadLinks(n: number) {
        const specs: Spec[] = [];
        for (let i = 0; i < n; i++)
            specs.push({ x: 0.2 * i, y: 0, out: i + 1 });
        specs.push({ x: 0.2 * n, y: 0 });
        return cells(specs);
    }

    it("大量同类问题：明细有限、汇总保留总数，日志不会再被刷爆", () => {
        const { issues, issueCount } = computeBeltShapes(manyBadLinks(200));
        // 总数（未限流）如实上报
        expect(issueCount).toBe(200);
        // 明细只保留每类 `ISSUE_SAMPLE_LIMIT` 条 + 一行汇总
        expect(issues).toHaveLength(ISSUE_SAMPLE_LIMIT + 1);
        expect(issues[0]).toContain("非一格前驱");
        expect(issues[issues.length - 1]).toContain("另有 196 条");
        // 关键指标：拼出来的日志长度必须可控（改动前是 2.6 万条 → 几十万字符）
        expect(issues.join("；").length).toBeLessThan(1500);
    });

    it("少量问题时明细完整、不出现汇总行（诊断信息不缩水）", () => {
        const { issues, issueCount } = computeBeltShapes(manyBadLinks(2));
        expect(issueCount).toBe(2);
        expect(issues).toHaveLength(2);
        expect(issues.some((s) => s.includes("另有"))).toBe(false);
    });
});

describe("beltArc · 坡度", () => {
    it("坡度 = Δz × HEIGHT_GRID_SIZE，亚台阶噪声归零", () => {
        const list = cells([
            { x: 0, y: 0, out: 1, z: 0 },
            { x: 0, y: 1, out: 2, z: 0.5 },
            { x: 0, y: 2, z: 0.52 },
        ]);
        expect(shapeOf(list, 0).slope).toBeCloseTo(0.5 * HEIGHT_GRID_SIZE, 9);
        expect(shapeOf(list, 1).slope).toBe(0);
        // 线尾格拿不到后继 → 坡度 0（前一段正好爬到本格高度，接缝仍然连续）
        expect(shapeOf(list, 2).slope).toBe(0);
    });
});
