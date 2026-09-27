import { BlueprintBuilding } from "./parser";
import { buildingBoxes } from "@/data/building";
import { createBuilding } from "./create";

/**
 * 大建筑功能连接面半径封顶（格）。
 * 项目无游戏 SlotConfig：选择盒半尺寸对制造台为 2.1，但实际皮带连接口约在 0.9。
 * 用此封顶可保证紧贴布局（如制造台—传送带）也能算出正的端点间距。
 */
const FACE_CAP = 0.9;
/** 端点自连接面向内的内缩距离，保证端点埋在建筑内、游戏粘贴时能"抓"到建筑 */
const ENDPOINT_INSET = 0.2;

function faceRadius(half: number) {
    return Math.min(half, FACE_CAP);
}

/** 归一化方向 (dux,duy) 从矩形中心到连接面（半尺寸 hx,hy）的轴向距离 */
function rayFace(dux: number, duy: number, hx: number, hy: number) {
    let t = Infinity;
    if (dux !== 0) t = Math.min(t, hx / Math.abs(dux));
    if (duy !== 0) t = Math.min(t, hy / Math.abs(duy));
    return t;
}

/**
 * 在两个已有建筑之间构造一个分拣器（尚未入库）。
 * 端点取中心连线与各建筑连接面交点后内缩 {@link ENDPOINT_INSET}；
 * len = round(端点间距)，范围 1-3，否则返回 null（拒绝放置）。
 * yaw[0] 沿运动主轴，yaw[1] 恒 0（由真实蓝图标定的 DSP 固定特征）。
 */
export function createSorterBetween(
    src: BlueprintBuilding,
    dst: BlueprintBuilding,
    itemId: number,
    modelIndex: number,
): BlueprintBuilding | null {
    const c0 = src.localOffset[0], c1 = dst.localOffset[0];
    const sx = c1.x - c0.x, sy = c1.y - c0.y;
    const L = Math.hypot(sx, sy);
    if (L < 1e-6) return null;
    const dux = sx / L, duy = sy / L;

    const box0 = buildingBoxes.get(src.modelIndex)!;
    const box1 = buildingBoxes.get(dst.modelIndex)!;
    // 连接面半尺寸（大建筑封顶）
    const fx0 = faceRadius(box0[0] / 2), fy0 = faceRadius(box0[2] / 2);
    const fx1 = faceRadius(box1[0] / 2), fy1 = faceRadius(box1[2] / 2);
    // 中心到连接面、再内缩后的端点距离
    const o0 = Math.max(0, rayFace(dux, duy, fx0, fy0) - ENDPOINT_INSET);
    const o1 = Math.max(0, rayFace(dux, duy, fx1, fy1) - ENDPOINT_INSET);

    const p0 = { x: c0.x + dux * o0, y: c0.y + duy * o0 };
    const p1 = { x: c1.x - dux * o1, y: c1.y - duy * o1 };
    const edgeDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const len = Math.round(edgeDist);
    if (len < 1 || len > 3) return null;

    // 起点朝向沿运动主轴（朝向表与传送带一致）
    let yaw0: number;
    if (Math.abs(dux) >= Math.abs(duy)) yaw0 = dux > 0 ? 90 : 270;
    else yaw0 = duy > 0 ? 0 : 180;

    const building = createBuilding(itemId, modelIndex, p0, yaw0);
    building.localOffset[1] = { x: p1.x, y: p1.y, z: 0 };
    building.yaw = [yaw0, 0];
    building.tilt = 0;
    (building.parameters as { length: number }).length = len;
    return building;
}
