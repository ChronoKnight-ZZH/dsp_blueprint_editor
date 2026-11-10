import { CylinderGeometry, InstancedMesh, MeshLambertMaterial } from "three";
import { BELT_HEIGHT, BELT_WIDTH } from "./belt";

/**
 * 传送带端帽（线路起点 / 终点的半圆盘）。
 *
 * 职责：给「开放端」补一个半圆头，让一条传送带线的两端看起来是收圆的，
 * 而不是一个被切平的截面。数量 = 开放端数（不是格数，一格可能两端都开放）。
 *
 * 使用：只被 `buildBuildings` 的 `buildBelts` 构造；实例矩阵由调用方按
 * 「条带姿态 + 端面位移 + 需要时 Ry(π)」算好，本文件不推导朝向。
 *
 * 边界：
 *   - 半圆的**平边（直径）正好压在条带端面上**，半圆向格子外鼓出 —— 不重叠，
 *     所以不会和条带顶面 z-fighting；半径取半条带宽，与条带侧边对齐。
 *   - 圆柱轴必须是本地 +y（与条带几何同一厚度方向），因此**不需要**额外的 Rx；
 *     条带实例矩阵里的 `Rx(π/2)` 已经由调用方一并乘进去了。
 *   - 坡度由调用方以剪切矩阵 `makeShear` 烘进实例矩阵（几何本身是平的），
 *     否则坡道上的端帽会翘起来。
 *   - 颜色走 `setColorAt`（元数据色），不带箭头图案，也不吃 `uArrowColor`。
 */

/** 端帽半径 = 半条带宽，保证半圆与条带两侧精确相接 */
export const BELT_CAP_RADIUS = BELT_WIDTH / 2;

/** 半圆盘的分段数（半个圆周 12 段 ≈ 15°/段，圆点是整圈 8 段，观感一致偏细） */
const CAP_SEGMENTS = 12;

/**
 * 半圆柱几何：轴沿本地 +y、厚度 = `BELT_HEIGHT`、半圆朝本地 **+z**。
 *
 * +z 是条带几何的「后端（逆流向）」，因此：
 *   - 线路起点（后端开放）：直接放在 z = +BELT_LEN/2；
 *   - 线路终点（前端开放）：先 `Ry(π)` 把半圆翻到 −z，再放到 z = −BELT_LEN/2。
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
