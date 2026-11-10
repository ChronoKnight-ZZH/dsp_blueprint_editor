import {
    BufferGeometry,
    Float32BufferAttribute,
    InstancedBufferAttribute,
    Uint16BufferAttribute,
} from "three";
import {
    BELT_ELBOW_COVER,
    BELT_ELBOW_ROUND,
    BELT_ELBOW_STUB,
    BELT_HEIGHT,
    BELT_LEN,
    BELT_WIDTH,
    BeltMesh,
    writeBeltArc,
    writeBeltEnds,
} from "./belt";
import type { BeltArcParams, BeltMaterial } from "./belt";

/**
 * 传送带圆环弯头（转角格）。
 *
 * 职责：把 90° 转角格从「被折了一下的方条」换成**套在接缝上的圆环**：
 *   - 截面是四边倒圆的矩形，**厚度与直段完全一致**（`BELT_HEIGHT`），只在径向上比条带
 *     宽 4mm —— 这样改 `BELT_HEIGHT` 时转角与直段永远同步（"厚度统一管理"）；
 *   - 两端的直线段（`BELT_ELBOW_STUB`）伸进相邻格，把「弯头 ↔ 直段」的接缝埋进环里；
 *   - 环本身仍然严格走「圆心 = 共享角点、半径 = 半格长、扫角 ±90°」那条唯一的弧。
 *
 * 关键实现选择：几何**不在这里弯**。这里只生成一段沿本格 -z 的**直棱柱**（倒圆截面），
 * 真正的弯折仍由 `BeltMaterial` 的顶点着色器按 `aBeltArc` 完成 —— 于是
 *   1. 箭头图案（片段着色器读 `position.z`）自动跟随，不需要第二套材质；
 *   2. 左右转共用同一份几何，不存在镜像导致的法线/绕序翻转问题；
 *   3. 条带与圆环可以共用同一个 `BeltMaterial` 实例（同一个 `cargoMove`）。
 *
 * 边界：
 *   - 顶点 z ∈ [-(L/2+stub), +(L/2+stub)]：超出 ±L/2 的部分由着色器按「端部切线
 *     直线外推」处理（`aBeltStub` 控制允许伸出的长度，另一端会被钳回端面）；
 *   - 截面外扩量 `BELT_ELBOW_COVER` 是必须的：不外扩时圆环顶面会与条带顶面共面，
 *     接缝处会 z-fighting；
 *   - 相邻格也是圆环时该端的 stub 必须置 0（两个圆环的 stub 会互相穿插），
 *     由 `buildBelts` 通过 `setStubAt` 写入，见 `beltArc` 的 `inIndex` / `outIndex`。
 */

/** 弧段细分（90° 上 16 段，每段 5.6°，弯曲后目视光滑） */
const ARC_SEGMENTS = 16;

/** 截面每个圆角的细分段数（4 段 = 22.5°/段） */
const PROFILE_SEGMENTS = 4;

/**
 * 截面半宽 / 半高。
 *
 * **半高严格等于 `BELT_HEIGHT/2`**：转角必须和直段用同一个厚度，否则改 `BELT_HEIGHT`
 * 时两者不成比例（早期版本在这里多加了一圈外扩，导致转角比直段厚 8mm，"厚度不能统一
 * 管理"）。外扩只做在**径向**（把环带做得比条带宽一点，接缝处的条带端面被环包住）。
 */
const HALF_W = (BELT_WIDTH + BELT_ELBOW_COVER * 2) / 2;
const HALF_H = BELT_HEIGHT / 2;

/**
 * 倒圆半径：受半高/半宽约束。
 *
 * 不给约束的话，`BELT_ELBOW_ROUND` 是个绝对值，一旦把 `BELT_HEIGHT` 调薄就会超过半高，
 * 截面自交（四个圆角互相插穿），几何当场塌掉 —— 表现为"转角没有厚度/没有箭头/颜色发暗"。
 */
export function elbowRound(halfW: number, halfH: number): number {
    return Math.min(BELT_ELBOW_ROUND, halfH * 0.6, halfW * 0.5);
}

/**
 * 截面：闭合的倒圆矩形，逆时针（从 +z 看），点序 = 4 个圆角各 4 段。
 *
 * 注意用 `i < PROFILE_SEGMENTS` 而不是 `<=`：相邻圆角之间靠直线边自然连接，
 * 重复端点会让接缝处出现零长度边、法线求平均时炸开。
 *
 * 参数可传入是为了让单测能扫不同 `BELT_HEIGHT` 下的截面（薄/厚都不能自交）。
 */
export function buildElbowProfile(
    halfW: number = HALF_W,
    halfH: number = HALF_H,
    round: number = elbowRound(halfW, halfH)
): { x: number; y: number }[] {
    const r = round;
    const corners: [number, number, number][] = [
        [halfW - r, halfH - r, 0], // 右上
        [-halfW + r, halfH - r, Math.PI / 2], // 左上
        [-halfW + r, -halfH + r, Math.PI], // 左下
        [halfW - r, -halfH + r, Math.PI * 1.5], // 右下
    ];
    const points: { x: number; y: number }[] = [];
    for (const [cx, cy, start] of corners) {
        for (let i = 0; i < PROFILE_SEGMENTS; i++) {
            const t = start + (i / PROFILE_SEGMENTS) * (Math.PI / 2);
            points.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
        }
    }
    return points;
}

/** 沿 z 的环采样位置：后 stub 端 → 后缘 → 弧段 → 前缘 → 前 stub 端 */
function buildRings(): number[] {
    const half = BELT_LEN / 2;
    const rings = [-(half + BELT_ELBOW_STUB)];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
        rings.push(-half + (i / ARC_SEGMENTS) * BELT_LEN);
    }
    rings.push(half + BELT_ELBOW_STUB);
    return rings;
}

/** 生成倒圆棱柱的 position / index（法线随后统一算） */
function buildPrism(geometry: BufferGeometry): void {
    const profile = buildElbowProfile();
    const rings = buildRings();
    const n = profile.length;

    const positions: number[] = [];
    for (const z of rings) {
        for (const p of profile) positions.push(p.x, p.y, z);
    }

    const indices: number[] = [];
    for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < n; j++) {
            const j2 = (j + 1) % n;
            const a = i * n + j;
            const b = i * n + j2;
            const c = (i + 1) * n + j2;
            const d = (i + 1) * n + j;
            indices.push(a, b, c, a, c, d);
        }
    }

    // 端盖：两端各一个扇形（顶点独立，避免法线被侧面平滑掉）
    for (const [ring, forward] of [
        [0, false],
        [rings.length - 1, true],
    ] as const) {
        const base = positions.length / 3;
        const z = rings[ring];
        let cx = 0;
        let cy = 0;
        for (const p of profile) {
            cx += p.x;
            cy += p.y;
        }
        positions.push(cx / n, cy / n, z);
        for (const p of profile) positions.push(p.x, p.y, z);
        for (let j = 0; j < n; j++) {
            const j2 = (j + 1) % n;
            if (forward) indices.push(base, base + 1 + j, base + 1 + j2);
            else indices.push(base, base + 1 + j2, base + 1 + j);
        }
    }

    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new Uint16BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
}

/**
 * 圆环弯头几何：倒圆棱柱 + 与条带同一套逐实例形状属性。
 *
 * `aBeltStub` 是圆环独有的（条带几何里恒 0）：它决定两端允许伸出多少直线段，
 * 用来避免「圆环-圆环」相邻时两段 stub 互相穿插。
 */
export class BeltElbowGeometry extends BufferGeometry {
    readonly beltArc: InstancedBufferAttribute;
    readonly beltAux: InstancedBufferAttribute;
    readonly beltEnds: InstancedBufferAttribute;

    constructor(count: number) {
        super();
        buildPrism(this);
        this.beltArc = new InstancedBufferAttribute(
            new Float32Array(count * 4),
            4
        );
        this.beltAux = new InstancedBufferAttribute(
            new Float32Array(count * 4),
            4
        );
        this.beltEnds = new InstancedBufferAttribute(
            new Float32Array(count * 2),
            2
        );
        this.setAttribute("aBeltArc", this.beltArc);
        this.setAttribute("aBeltAux", this.beltAux);
        this.setAttribute("aBeltEnds", this.beltEnds);
    }
}

/** 圆环弯头实例化网格；与条带共用 `BeltMaterial` 实例 */
export class BeltElbows extends BeltMesh {
    declare geometry: BeltElbowGeometry;

    constructor(count: number, material: BeltMaterial) {
        super(new BeltElbowGeometry(count), material, count);
        this.name = "beltElbows";
    }

    public setArcAt(i: number, p: BeltArcParams): void {
        writeBeltArc(this.geometry, i, p);
    }

    /**
     * 写第 i 个圆环两端的端面外向位移（世界单位；0 = 该端不伸出）。
     *
     * 邻格也是圆环时该端必须给 0：两个圆环的 stub 会互相穿插、并把顶面顶出重影。
     */
    public setEndsAt(i: number, back: number, front: number): void {
        writeBeltEnds(this.geometry, i, back, front);
    }
}
