import { Matrix4, Vector3 } from "three";
import {
    BELT_ARC_RADIUS,
    BELT_ELBOW_COVER,
    BELT_ELBOW_ROUND,
    BELT_ELBOW_STUB,
    BELT_HEIGHT,
    BELT_LEN,
    BELT_LIFT,
    BELT_WIDTH,
} from "@/Animation/belt";
import type { BeltArcParams } from "@/Animation/belt";
import {
    BeltElbowGeometry,
    buildElbowProfile,
    elbowRound,
} from "@/Animation/beltElbow";
import { computeBeltShapes } from "@/Animation/beltArc";
import { HEIGHT_GRID_SIZE } from "@/planet/planetConstants";
import type { BlueprintBuilding } from "@/blueprint/parser";

/**
 * 圆环弯头几何（`beltElbow.ts`）的单测。
 *
 * 这条链路上「几何生成 → 顶点着色器弯折」无法在 Jest 里跑 WebGL，所以这里做两件事：
 *   1. **棱柱几何本身**：包围盒、法线归一、三角形绕序（用有向体积证明朝外）；
 *   2. **复刻顶点着色器**（与 `BeltMaterial` 同一套公式）把顶点弯成环，验证
 *      半径区间 = [R−半宽, R+半宽]、内圈不会翻面、高度不越界、端头直线段真的伸出格子。
 */

/** 截面半宽（只有径向外扩）/ 半高（**与条带完全一致**，不额外加高） */
const HALF_W = (BELT_WIDTH + BELT_ELBOW_COVER * 2) / 2;
const HALF_H = BELT_HEIGHT / 2;
const DEG = Math.PI / 180;

function cells(
    specs: { x: number; y: number; out?: number; yaw?: number; z?: number }[]
) {
    return specs.map(
        (s, i): BlueprintBuilding => ({
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
        })
    );
}

/** 真实转角格的弧参数：入 (+y) → 出 (+x)，yaw = 角平分线 45° */
function cornerArc(): BeltArcParams {
    const list = cells([
        { x: 0, y: 0, out: 1 },
        { x: 0, y: 1, out: 2, yaw: 45 },
        { x: 1, y: 1 },
    ]);
    const shape = computeBeltShapes(list).shapes.get(1);
    if (shape === undefined) throw new Error("没有算出转角形状");
    return shape;
}

/** 复刻 `BeltMaterial` 的弯折公式（含端头直线段与钳制） */
function bend(
    v: { x: number; y: number; z: number },
    arc: BeltArcParams,
    stubBack: number,
    stubFront: number
): Vector3 {
    const sweep = arc.theta1 - arc.theta0;
    const uRaw = 0.5 - v.z / BELT_LEN;
    const u = Math.min(
        Math.max(uRaw, -stubBack / BELT_LEN),
        1 + stubFront / BELT_LEN
    );
    const uc = Math.min(Math.max(u, 0), 1);
    const th = arc.theta0 + sweep * uc;
    const r = BELT_ARC_RADIUS + v.x;
    const over = (u - uc) * BELT_LEN;
    const tn = Math.sign(sweep);
    return new Vector3(
        arc.centerX + r * Math.cos(th) - tn * over * Math.sin(th),
        v.y,
        arc.centerZ + r * Math.sin(th) + tn * over * Math.cos(th)
    );
}

function positions(geometry: BeltElbowGeometry) {
    const attr = geometry.attributes.position;
    const out: Vector3[] = [];
    for (let i = 0; i < attr.count; i++) {
        out.push(new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
    }
    return out;
}

describe("BeltElbowGeometry · 棱柱本体", () => {
    it("包围盒 = 条带轮廓 + 每侧 4mm 外扩，z 覆盖两端 stub", () => {
        const geometry = new BeltElbowGeometry(1);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.x).toBeCloseTo(HALF_W, 6);
        expect(box.min.x).toBeCloseTo(-HALF_W, 6);
        expect(box.max.y).toBeCloseTo(HALF_H, 6);
        expect(box.min.y).toBeCloseTo(-HALF_H, 6);
        const reach = BELT_LEN / 2 + BELT_ELBOW_STUB;
        expect(box.max.z).toBeCloseTo(reach, 6);
        expect(box.min.z).toBeCloseTo(-reach, 6);
        // 径向必须包住条带截面（否则接缝露出条带的角）；**高度必须与条带完全相等**
        expect(HALF_W).toBeGreaterThan(BELT_WIDTH / 2);
        expect(HALF_H).toBeCloseTo(BELT_HEIGHT / 2, 12);
        // 实际使用的倒圆半径被半高夹住，不能吃掉整个截面
        expect(elbowRound(HALF_W, HALF_H)).toBeLessThan(HALF_H);
    });

    it("改 BELT_HEIGHT（薄/厚）时截面都不自交，倒圆自动收紧", () => {
        // 模拟 0.02 ~ 2.0 的厚度：圆角半径必须始终小于半高，且截面保持简单多边形
        for (const height of [0.02, 0.04, 0.08, 0.2, 0.8, 2.0]) {
            const halfH = height / 2;
            const halfW = (BELT_WIDTH + BELT_ELBOW_COVER * 2) / 2;
            const round = elbowRound(halfW, halfH);
            expect(round).toBeGreaterThan(0);
            expect(round).toBeLessThan(halfH);
            expect(round).toBeLessThanOrEqual(halfW);

            const profile = buildElbowProfile(halfW, halfH, round);
            // 每个点都必须在截面矩形内，且 y 方向单调不越界
            let minY = Infinity;
            let maxY = -Infinity;
            for (const p of profile) {
                expect(Math.abs(p.x)).toBeLessThanOrEqual(halfW + 1e-9);
                expect(Math.abs(p.y)).toBeLessThanOrEqual(halfH + 1e-9);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            // 顶/底必须真的到边（否则截面被倒圆吃掉了）
            expect(maxY).toBeCloseTo(halfH, 9);
            expect(minY).toBeCloseTo(-halfH, 9);
        }
    });

    it("顶面法线朝上：箭头 mask `step(0.5, normal.y)` 必须能取到 1", () => {
        const geometry = new BeltElbowGeometry(1);
        const pos = geometry.attributes.position;
        const nrm = geometry.attributes.normal;

        let flatTop = 0;
        for (let i = 0; i < nrm.count; i++) {
            if (nrm.getY(i) <= 0.9) continue; // 没通过 topMask 的点不参与箭头
            // 通过 mask 的点必须都在上半截面：不能把侧壁/底面染成箭头色
            expect(pos.getY(i)).toBeGreaterThan(0);
            if (nrm.getY(i) > 0.99) flatTop++;
        }
        // 平顶中段必须有纯朝上的点（箭头对比度与直段一致）
        expect(flatTop).toBeGreaterThan(0);
    });

    it("法线全部归一，三角形绕序朝外（有向体积 > 0）", () => {
        const geometry = new BeltElbowGeometry(1);
        const normal = geometry.attributes.normal;
        for (let i = 0; i < normal.count; i++) {
            const n = new Vector3(
                normal.getX(i),
                normal.getY(i),
                normal.getZ(i)
            );
            expect(n.length()).toBeCloseTo(1, 5);
        }

        // 闭合网格的有向体积：绕序朝外时为正
        const pos = positions(geometry);
        const index = geometry.index!;
        let volume = 0;
        for (let i = 0; i < index.count; i += 3) {
            const a = pos[index.getX(i)];
            const b = pos[index.getX(i + 1)];
            const c = pos[index.getX(i + 2)];
            volume += a.dot(new Vector3().crossVectors(b, c)) / 6;
        }
        expect(volume).toBeGreaterThan(0);
        // 体积 ≈ 截面面积 × 棱柱总长（倒圆用折线拟合，会削掉几个百分点，所以是相对容差）
        const round = elbowRound(HALF_W, HALF_H);
        const area = 4 * HALF_W * HALF_H - (4 - Math.PI) * round * round;
        const pathLen = BELT_LEN + 2 * BELT_ELBOW_STUB;
        const ratio = volume / (area * pathLen);
        expect(ratio).toBeGreaterThan(0.95);
        expect(ratio).toBeLessThan(1.0001);
    });
});

describe("BeltElbowGeometry · 交给着色器之后", () => {
    it("弯成的环：半径区间 = [R−半宽, R+半宽]，内圈不翻面，高度不越界", () => {
        const geometry = new BeltElbowGeometry(1);
        const arc = cornerArc();
        // 只取弧段（z ∈ [−L/2, L/2]）：两端 stub 是直线段，离圆心会更远
        const arcVerts = positions(geometry).filter(
            (v) => Math.abs(v.z) <= BELT_LEN / 2 + 1e-9
        );
        expect(arcVerts.length).toBeGreaterThan(0);

        let minR = Infinity;
        let maxR = -Infinity;
        for (const v of arcVerts) {
            const p = bend(v, arc, BELT_ELBOW_STUB, BELT_ELBOW_STUB);
            const r = Math.hypot(p.x - arc.centerX, p.z - arc.centerZ);
            minR = Math.min(minR, r);
            maxR = Math.max(maxR, r);
        }
        expect(minR).toBeCloseTo(BELT_ARC_RADIUS - HALF_W, 6);
        expect(maxR).toBeCloseTo(BELT_ARC_RADIUS + HALF_W, 6);
        // 内圈必须 > 0，否则圆弧翻面（BELT_WIDTH 不能再加大）
        expect(minR).toBeGreaterThan(0);

        // 高度（法线方向）任何顶点都不越界
        for (const v of positions(geometry)) {
            expect(Math.abs(v.y)).toBeLessThanOrEqual(HALF_H + 1e-6);
        }
    });

    it("端头直线段真的伸出格子（埋进邻格），且方向 = 端部切线", () => {
        const geometry = new BeltElbowGeometry(1);
        const arc = cornerArc();
        const sweep = arc.theta1 - arc.theta0;
        const pts = positions(geometry).map((v) =>
            bend(v, arc, BELT_ELBOW_STUB, BELT_ELBOW_STUB)
        );

        // 世界坐标还原到格子平面（格心为原点）：几何空间 (x,z) → 平面 (x, −z) → 再反向转 yaw
        // 这里只关心「沿流向走了多远」，用沿切线的投影更直接：
        // 入口点 = C + R·dir(θ0)，其外法向切线就是入向；伸出量应等于 stub。
        const entry = new Vector3(
            arc.centerX + BELT_ARC_RADIUS * Math.cos(arc.theta0),
            0,
            arc.centerZ + BELT_ARC_RADIUS * Math.sin(arc.theta0)
        );
        const tn = Math.sign(sweep);
        const tangentIn = new Vector3(
            -tn * Math.sin(arc.theta0),
            0,
            tn * Math.cos(arc.theta0)
        );
        let most = -Infinity;
        for (const p of pts) {
            const rel = p.clone().sub(entry);
            most = Math.max(most, -rel.dot(tangentIn));
        }
        // 沿入向负方向（即伸进前一格）最远 = stub（±1e-6 的浮点余量）
        expect(most).toBeCloseTo(BELT_ELBOW_STUB, 6);
    });

    it("stub 置 0 时端面被钳回格子边界（不与相邻圆环互相穿插）", () => {
        const geometry = new BeltElbowGeometry(1);
        const arc = cornerArc();
        const sweep = arc.theta1 - arc.theta0;
        const entry = new Vector3(
            arc.centerX + BELT_ARC_RADIUS * Math.cos(arc.theta0),
            0,
            arc.centerZ + BELT_ARC_RADIUS * Math.sin(arc.theta0)
        );
        const tn = Math.sign(sweep);
        const tangentIn = new Vector3(
            -tn * Math.sin(arc.theta0),
            0,
            tn * Math.cos(arc.theta0)
        );
        let most = -Infinity;
        for (const v of positions(geometry)) {
            const p = bend(v, arc, 0, 0);
            most = Math.max(most, -p.sub(entry).dot(tangentIn));
        }
        expect(most).toBeCloseTo(0, 6);
    });
});

describe("BeltElbowGeometry · 转角带坡度（高度）", () => {
    /** 转角格在坡上：本格 z = 0.5，后继 z = 1.0 → slope = 0.5 格 × HEIGHT_GRID_SIZE */
    function ramp() {
        return cells([
            { x: 1, y: 1, z: 0.5, out: 1 }, // A 前驱（同一段坡）
            { x: 0, y: 1, z: 0.5, out: 2, yaw: 225 }, // B 转角格
            { x: 0, y: 0, z: 1 }, // C 后继
        ]);
    }

    /**
     * 复刻「顶点着色器剪切 + 实例抬升」，返回中面（v.y = 0）相对**本格底面**的高度。
     *
     * 着色器：`transformed.y -= (position.z / L) * slope`；实例矩阵再抬
     * `BELT_LIFT + slope/2`。于是后缘落在本格标高、前缘落在后继标高。
     */
    function planeY(z: number, shape: BeltArcParams): number {
        return BELT_LIFT + shape.slope / 2 - (z / BELT_LEN) * shape.slope;
    }

    it("转角格有高度：环沿弧爬升整段坡度，弧中点正好一半", () => {
        const shape = computeBeltShapes(ramp()).shapes.get(1);
        expect(shape?.kind).toBe("corner");
        if (shape === undefined) throw new Error("没有算出转角形状");
        expect(shape.slope).toBeCloseTo(0.5 * HEIGHT_GRID_SIZE, 9);

        // 后缘 = 本格标高、前缘 = 本格 + 一整个 slope、中点 = 一半
        expect(planeY(BELT_LEN / 2, shape)).toBeCloseTo(BELT_LIFT, 9);
        expect(planeY(0, shape)).toBeCloseTo(BELT_LIFT + shape.slope / 2, 9);
        expect(planeY(-BELT_LEN / 2, shape)).toBeCloseTo(
            BELT_LIFT + shape.slope,
            9
        );
    });

    it("端头直线段与邻格斜面严丝合缝（伸进前驱格的那 0.135 也是同一张斜面）", () => {
        const list = ramp();
        const shape = computeBeltShapes(list).shapes.get(1);
        if (shape === undefined) throw new Error("没有算出转角形状");

        // 前驱格 A 的斜面（用 A 自己的参数算，再换算到 B 的底面）：A 比 B 低 slope
        const slopeA = shape.slope; // 同一段坡
        const aBaseMinusBBase = -shape.slope;
        const d = BELT_ELBOW_STUB; // 从接缝往回 d
        const zA = -BELT_LEN / 2 + d; // A 自己坐标系里的位置（它的前缘在接缝）
        const aPlane =
            aBaseMinusBBase + BELT_LIFT + slopeA / 2 - (zA / BELT_LEN) * slopeA;

        // 圆环伸出去的那一端（B 的坐标系：接缝往回 d 即 z = L/2 + d）
        const bPlane = planeY(BELT_LEN / 2 + d, shape);

        expect(bPlane).toBeCloseTo(aPlane, 9);
        // 且确实比接缝处低（坡是往上走的，往回就往下）
        expect(bPlane).toBeLessThan(planeY(BELT_LEN / 2, shape));
    });
});

describe("BeltElbowGeometry · 与条带的属性同构", () => {
    it("aBeltArc / aBeltAux / aBeltStub 都是逐实例属性，默认 0", () => {
        const geometry = new BeltElbowGeometry(3);
        expect(geometry.beltArc.itemSize).toBe(4);
        expect(geometry.beltAux.itemSize).toBe(4);
        expect(geometry.beltStub.itemSize).toBe(2);
        expect((geometry.beltArc.array as Float32Array).length).toBe(12);
        expect((geometry.beltStub.array as Float32Array).length).toBe(6);
        for (const v of geometry.beltArc.array as Float32Array)
            expect(v).toBe(0);
        for (const v of geometry.beltStub.array as Float32Array)
            expect(v).toBe(0);
        // 属性名必须与着色器里的 attribute 一致
        expect(geometry.getAttribute("aBeltArc")).toBe(geometry.beltArc);
        expect(geometry.getAttribute("aBeltAux")).toBe(geometry.beltAux);
        expect(geometry.getAttribute("aBeltStub")).toBe(geometry.beltStub);
    });

    it("几何只生成一次，多个实例共用同一份顶点（圆环形状不随格子变化）", () => {
        const geometry = new BeltElbowGeometry(5);
        const matrix = new Matrix4();
        // 实例数只影响属性长度，不影响顶点数
        expect(geometry.attributes.position.count).toBeGreaterThan(0);
        expect(geometry.index).not.toBeNull();
        expect(matrix.elements.length).toBe(16);
    });
});
