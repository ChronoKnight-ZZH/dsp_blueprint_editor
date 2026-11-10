import { CylinderGeometry, InstancedMesh, MeshLambertMaterial } from "three";
import { BELT_ELBOW_COVER, BELT_HEIGHT, BELT_LEN, BELT_WIDTH } from "./belt";

/**
 * 传送带端帽（线路起点 / 终点的半圆盘）。
 *
 * 职责：给「开放端」补一个半圆头，让一条传送带线的两端看起来是收圆的，
 * 而不是一个被切平的截面。数量 = 开放端数。
 *
 * 使用：只被 `buildBuildings` 的 `buildBelts` 构造；实例矩阵由调用方按
 * 「条带姿态 + 端面位移 + 需要时 Ry(π)」算好，本文件不推导朝向。
 *
 * 几何关系（v6：**不再向格外鼓出，改为压进条带、把线缩短**）：
 *
 * ```
 *   格心 ──── 条带端面 ─┐
 *        └─ 直径面      └─ 半圆尖点（在格边界内侧 TIP_INSET 处）
 *   0      DIAMETER   STRIP_END   TIP        L/2
 * ```
 *   - `BELT_CAP_DIAMETER`：半圆的直径面（几何原点）距格心；
 *   - `BELT_CAP_SHORTEN`：条带端面要**内收**多少，让端帽压住它（重叠 `BELT_CAP_OVERLAP`）；
 *   - 二者满足 `条带端面 = 直径面 + 重叠`，尖点 = 格边界 − `TIP_INSET`。
 *
 * 边界：
 *   - 侧向比条带宽 `BELT_ELBOW_COVER`（与圆环同一套外扩），因此在重叠段里端帽轮廓
 *     完整包住条带的矩形截面，不会从半圆两侧露出条带的棱；
 *   - 重叠段顶面与条带顶面共面 → 调用方要抬 `BELT_CAP_LIFT`，否则 z-fighting；
 *   - 圆柱轴必须是本地 +y（与条带几何同一厚度方向），因此**不需要**额外的 Rx；
 *     条带实例矩阵里的 `Rx(π/2)` 已经由调用方一并乘进去了；
 *   - 坡度由调用方以剪切矩阵 `makeShear` 烘进实例矩阵（几何本身是平的）；
 *   - 颜色走 `setColorAt`（元数据色），不带箭头图案，也不吃 `uArrowColor`。
 */

/** 端帽半径：半条带宽 + 一圈外扩（与圆环一致，保证重叠段包住条带截面） */
export const BELT_CAP_RADIUS = BELT_WIDTH / 2 + BELT_ELBOW_COVER;

/** 端帽压进条带的长度（重叠段；> 0 才会有共面顶面，需要 `BELT_CAP_LIFT`） */
export const BELT_CAP_OVERLAP = 0.04;

/** 半圆尖点相对格子边界内收多少：> 0 = 线变短（v6 起默认 5cm，不再鼓出格外） */
export const BELT_CAP_TIP_INSET = 0.05;

/** 端帽按厚度比例抬升，避免与条带顶面共面 z-fighting */
export const BELT_CAP_LIFT = BELT_HEIGHT * 0.02;

/** 条带端面需要内收的长度（世界单位） */
export const BELT_CAP_SHORTEN =
    BELT_CAP_RADIUS + BELT_CAP_TIP_INSET - BELT_CAP_OVERLAP;

/** 端帽几何原点（直径面）距格心的距离（世界单位，正值） */
export const BELT_CAP_DIAMETER =
    BELT_LEN / 2 - BELT_CAP_TIP_INSET - BELT_CAP_RADIUS;

/** 半圆盘的分段数（半个圆周 12 段 ≈ 15°/段，圆点是整圈 8 段，观感一致偏细） */
const CAP_SEGMENTS = 12;

/**
 * 半圆柱几何：轴沿本地 +y、厚度 = `BELT_HEIGHT`、半圆朝本地 **+z**。
 *
 * +z 是条带几何的「后端（逆流向）」，因此：
 *   - 线路起点（后端开放）：直接放在 z = +BELT_CAP_DIAMETER；
 *   - 线路终点（前端开放）：先 `Ry(π)` 把半圆翻到 −z，再放到 z = −BELT_CAP_DIAMETER。
 */
class BeltCapGeometry extends CylinderGeometry {
    constructor() {
        // thetaStart = −π/2 让半圆落在 z ≥ 0 一侧（three 的圆柱按 (sinθ, cosθ) 取 x/z）
        super(
            BELT_CAP_RADIUS,
            BELT_CAP_RADIUS,
            BELT_HEIGHT,
            CAP_SEGMENTS,
            1,
            false,
            -Math.PI / 2,
            Math.PI
        );
    }
}

/** 端帽实例化网格；与条带同生命周期，随 `AllBuildings.dispose()` 释放 */
export class BeltCaps extends InstancedMesh {
    constructor(count: number) {
        super(new BeltCapGeometry(), new MeshLambertMaterial(), count);
        this.name = "beltCaps";
    }
}
