import { BlueprintBuilding } from "./parser";
import { buildingBoxes } from "@/data/building";
import { createBuilding } from "./create";
import { isBelt, isInserter, isSplitter } from "@/data/items";
import { findNearestFreeSlot, hasSlots } from "@/data/buildingSlots";

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

/** 获取建筑连接面半尺寸（皮带不走此路径：端点直接取中心） */
function getFaceRadius(modelIndex: number): [number, number] {
    const box = buildingBoxes.get(modelIndex);
    if (!box)
        return [FACE_CAP, FACE_CAP];
    return [faceRadius(box[0] / 2), faceRadius(box[2] / 2)];
}

/**
 * 皮带端 offset 精确查找表（基于 120 个真实蓝图样本反推）。
 * 主轴偏移 mainOffset = 分拣器端点在皮带方向上的投影距离（相对皮带中心）。
 * 范围边界来自数据统计的自然间隔。
 */
const OFFSET_RANGES: { max: number; offset: number }[] = [
    { max: -0.409, offset: -10 },
    { max: -0.281, offset: -8 },
    { max: -0.190, offset: -5 },
    { max: -0.155, offset: -4 },
    { max: -0.099, offset: -3 },
    { max: -0.029, offset: -2 },
    { max: 0, offset: -1 },        // 负值接近 0
    { max: 0.034, offset: 0 },     // 正值接近 0
    { max: 0.099, offset: 1 },
    { max: 0.155, offset: 2 },
    { max: 0.189, offset: 3 },
    { max: 0.294, offset: 4 },
    { max: 0.421, offset: 7 },
    { max: Infinity, offset: 10 },
];

/**
 * 计算皮带端 offset（segIndex 偏移）。
 * 精确实现：基于分拣器端点相对皮带中心的主轴投影距离查表。
 */
function computeBeltOffset(
    sorterEnd: { x: number, y: number },
    belt: BlueprintBuilding,
): number {
    // 用精确 yaw（度→弧度）计算皮带方向，避免球面浮点 yaw 归一化引入的误差
    const rad = belt.yaw[0] * Math.PI / 180;
    const dirX = Math.sin(rad);   // yaw=0 → +Y, yaw=90 → +X
    const dirY = Math.cos(rad);

    // 分拣器端点相对皮带中心的偏移
    const relX = sorterEnd.x - belt.localOffset[0].x;
    const relY = sorterEnd.y - belt.localOffset[0].y;

    // 主轴偏移：投影到精确皮带方向
    const mainOffset = relX * dirX + relY * dirY;

    // 查表
    for (const range of OFFSET_RANGES) {
        if (mainOffset < range.max) {
            return range.offset;
        }
    }
    return 10;
}

/**
 * 网格平面偏移 → 建筑 yaw=0 局部坐标。
 * calcBuildingTrans 中建筑经 R_Z(-yaw) 旋转：P_grid = R_Z(-yaw) * P_local，
 * 故逆变换 P_local = R_Z(+yaw) * P_grid。yaw 非 0 时不转换会选错 slot。
 */
function toSlotLocal(building: BlueprintBuilding, dx: number, dy: number): [number, number] {
    const rad = building.yaw[0] * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/**
 * 收集目标建筑上已被其他分拣器占用的 slot 编号。
 * 已有分拣器：inputObjIdx===target 时占用 inputFromSlot（从其取物），
 * outputObjIdx===target 时占用 outputToSlot（向其送物）。
 * 导出供编辑器 UI 给 slot 标记染色（红=已占用）。
 */
export function collectOccupiedSlots(
    buildings: readonly BlueprintBuilding[],
    targetIndex: number,
): Set<number> {
    const occ = new Set<number>();
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        if (b.inputObjIdx === targetIndex && b.inputFromSlot >= 0)
            occ.add(b.inputFromSlot);
        if (b.outputObjIdx === targetIndex && b.outputToSlot >= 0)
            occ.add(b.outputToSlot);
    }
    return occ;
}

/**
 * 收集目标皮带上已被其他分拣器占用的 offset。
 * 皮带端 slot 固定 -1，同一 offset 只能有一个分拣器端点。
 */
function collectOccupiedBeltOffsets(
    buildings: readonly BlueprintBuilding[],
    beltIndex: number,
): Set<number> {
    const occ = new Set<number>();
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        if (b.inputObjIdx === beltIndex && b.inputFromSlot === -1)
            occ.add(b.inputOffset);
        if (b.outputObjIdx === beltIndex && b.outputToSlot === -1)
            occ.add(b.outputOffset);
    }
    return occ;
}

/**
 * 在 OFFSET_RANGES 的合法值中找离 preferred 最近的空闲 offset。
 * 皮带可连位置有限（13 档），全被占用返回 null。
 */
function findNearestFreeBeltOffset(preferred: number, occupied: ReadonlySet<number>): number | null {
    if (!occupied.has(preferred)) return preferred;
    // 候选按与 preferred 的距离升序
    const candidates = OFFSET_RANGES
        .map(r => r.offset)
        .filter(o => !occupied.has(o))
        .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    return candidates.length > 0 ? candidates[0] : null;
}

/**
 * 分拣器只能沿网格主轴架接（每 90° 一个方向），游戏不允许 45° 斜向分拣器。
 * 球面网格主轴连线带浮点噪声（实测蓝图 yaw 偏差 ≤0.1°），给 5° 容差：
 * 合法轴向小分量 ≈ 0 通过；45° 斜向（两分量等大）被拒。
 */
const AXIS_ALIGN_TOL = Math.tan(5 * Math.PI / 180);

function isAxisAligned(dux: number, duy: number): boolean {
    const major = Math.max(Math.abs(dux), Math.abs(duy));
    if (major < 1e-9) return false;
    return Math.min(Math.abs(dux), Math.abs(duy)) / major <= AXIS_ALIGN_TOL;
}

/**
 * 分拣器端点落在四向分流器（2020）哪个口。
 * 口编号与 SpitterInfo / BuildingInfo 的 adjacency 下标一致（yaw=0 局部系）：
 * - 十字形（modelIndex 38/40）：0=+y, 1=+x, 2=-y, 3=-x，共四口
 * - 一字形（modelIndex 39）：仅长轴两端开口，0=A 端(+y)，2=B 端(-y)；
 *   0/1、2/3 是同一端的两层高度（平面架接不区分），短轴两侧封闭 → 返回 -1
 */
function splitterPortAt(sp: BlueprintBuilding, p: { x: number; y: number }): number {
    const c = sp.localOffset[0];
    const [lx, ly] = toSlotLocal(sp, p.x - c.x, p.y - c.y);
    if (sp.modelIndex === 39) {
        if (Math.abs(lx) >= Math.abs(ly)) return -1;  // 一字形短边：无开口
        return ly >= 0 ? 0 : 2;
    }
    if (Math.abs(lx) >= Math.abs(ly)) return lx >= 0 ? 1 : 3;
    return ly >= 0 ? 0 : 2;
}

/**
 * 收集四向分流器上已被其他分拣器占用的口（按端点几何位置反推口编号，
 * 不依赖蓝图 wire 字段——直连分拣器在游戏数据中 slot 恒为 -1）。
 */
function collectOccupiedSplitterPorts(
    buildings: readonly BlueprintBuilding[],
    splitterIndex: number,
): Set<number> {
    const occ = new Set<number>();
    const sp = buildings[splitterIndex];
    if (!sp || !isSplitter(sp.itemId)) return occ;
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        if (b.inputObjIdx === splitterIndex)
            occ.add(splitterPortAt(sp, b.localOffset[0]));
        if (b.outputObjIdx === splitterIndex)
            occ.add(splitterPortAt(sp, b.localOffset[1]));
    }
    occ.delete(-1);
    return occ;
}

/** 分拣器端点身份键：同一对象 + 同一 slot（皮带再叠 offset）才算同一位置 */
function endpointKey(objIdx: number, slot: number, offset: number): string {
    return `${objIdx}:${slot}:${offset}`;
}

/**
 * 重复放置检测：新分拣器的两个端点与某已存在分拣器完全相同（含 A→B / B→A
 * 反向）时拒绝。平行 slot / 不同 offset 的并行分拣器端点身份不同，不受影响。
 */
function isDuplicateSorter(
    n: BlueprintBuilding,
    buildings: readonly BlueprintBuilding[],
): boolean {
    const nIn = endpointKey(n.inputObjIdx, n.inputFromSlot, n.inputOffset);
    const nOut = endpointKey(n.outputObjIdx, n.outputToSlot, n.outputOffset);
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        const bIn = endpointKey(b.inputObjIdx, b.inputFromSlot, b.inputOffset);
        const bOut = endpointKey(b.outputObjIdx, b.outputToSlot, b.outputOffset);
        if ((bIn === nIn && bOut === nOut) || (bIn === nOut && bOut === nIn))
            return true;
    }
    return false;
}

/** 两条分拣器中心线共线（含反向）且横向间距小于半宽、纵向区间相交 → 重叠 */
const SORTER_HALF_WIDTH = 0.15;

function collinearSorterOverlap(
    a0: { x: number; y: number }, a1: { x: number; y: number },
    b0: { x: number; y: number }, b1: { x: number; y: number },
): boolean {
    const d1x = a1.x - a0.x, d1y = a1.y - a0.y;
    const l1 = Math.hypot(d1x, d1y);
    const d2x = b1.x - b0.x, d2y = b1.y - b0.y;
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) return false;
    // 夹角正弦：非共线（垂直交叉等）不算"重叠"
    if (Math.abs(d1x * d2y - d1y * d2x) / (l1 * l2) > AXIS_ALIGN_TOL) return false;
    // b0 到 a 所在直线的垂直距离
    if (Math.abs(d1x * (a0.y - b0.y) - d1y * (a0.x - b0.x)) / l1 > SORTER_HALF_WIDTH)
        return false;
    // b 在 a 主轴上的投影区间与 a 的 [0,1] 是否相交
    const t = (p: { x: number; y: number }) =>
        ((p.x - a0.x) * d1x + (p.y - a0.y) * d1y) / (l1 * l1);
    const lo = Math.min(t(b0), t(b1));
    const hi = Math.max(t(b0), t(b1));
    return hi > 1e-6 && lo < 1 - 1e-6;
}

/**
 * 重叠放置检测：与已存在分拣器共线压叠时拒绝。
 * 同一对对象（含反向）之间由 slot/offset 占用逻辑区分并行分拣器，跳过。
 */
function overlapsExistingSorter(
    n: BlueprintBuilding,
    buildings: readonly BlueprintBuilding[],
): boolean {
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        const samePair =
            (b.inputObjIdx === n.inputObjIdx && b.outputObjIdx === n.outputObjIdx) ||
            (b.inputObjIdx === n.outputObjIdx && b.outputObjIdx === n.inputObjIdx);
        if (samePair) continue;
        if (collinearSorterOverlap(
            n.localOffset[0], n.localOffset[1],
            b.localOffset[0], b.localOffset[1],
        ))
            return true;
    }
    return false;
}

/**
 * 在两个已有建筑/皮带之间构造一个分拣器（尚未入库）。
 * 端点取中心连线与各建筑连接面交点后内缩 {@link ENDPOINT_INSET}；
 * len = round(端点间距)，范围 1-3，否则返回 null（拒绝放置）。
 * yaw[0] 沿运动主轴，yaw[1] 恒 0（由真实蓝图标定的 DSP 固定特征）。
 *
 * 连接字段写入规则（来自 BuildTool_Inserter.cs）：
 * - inputObjIdx = src.index, outputObjIdx = dst.index
 * - inputFromSlot = srcSlot（建筑端 0-11，皮带端 -1）
 * - outputToSlot = dstSlot（建筑端 0-11，皮带端 -1）
 * - inputToSlot = 1（分拣器固定输入 slot）
 * - outputFromSlot = 0（分拣器固定输出 slot）
 * - inputOffset = 皮带端 segIndex 偏移（建筑端为 0）
 * - outputOffset = 皮带端 segIndex 偏移（建筑端为 0）
 *
 * slot 唯一占用约束：建筑每个 slot 只允许连接一个分拣器。
 * 目标 slot 已被占用时，自动切换到同侧（坐标矢量平行）最近的空闲 slot；
 * 平行组内无空闲 slot 时返回 null（拒绝放置）。
 *
 * 其他放置约束（返回 null = 拒绝放置，UI 预览红线）：
 * - 只能沿网格主轴架接（每 90°），45° 等斜向一律拒绝
 * - 四向分流器按口占用：一字形(39)仅 A/B 两端开口且每端一个分拣器，
 *   十字形(38/40)四口各自唯一；同口重复引用拒绝
 * - 两个端点与已有分拣器完全相同（含反向）= 重复放置，拒绝
 * - 与已有分拣器共线压叠（非同对象对的并行 slot 情况）= 重叠，拒绝
 * @param buildings 已入库建筑列表，用于检测 slot 占用（缺省视为无占用）
 */
export function createSorterBetween(
    src: BlueprintBuilding,
    dst: BlueprintBuilding,
    itemId: number,
    modelIndex: number,
    buildings: readonly BlueprintBuilding[] = [],
): BlueprintBuilding | null {
    const c0 = src.localOffset[0], c1 = dst.localOffset[0];
    const sx = c1.x - c0.x, sy = c1.y - c0.y;
    const L = Math.hypot(sx, sy);
    if (L < 1e-6) return null;
    const dux = sx / L, duy = sy / L;

    // 分拣器只能每 90° 沿主轴架接：拒绝 45° 斜向（球面噪声 5° 内容差）
    if (!isAxisAligned(dux, duy)) return null;

    const srcIsBelt = isBelt(src.itemId);
    const dstIsBelt = isBelt(dst.itemId);
    const srcIsSplitter = isSplitter(src.itemId);
    const dstIsSplitter = isSplitter(dst.itemId);

    // 端点计算（真实蓝图 0.10.35 验证）：
    // - 皮带端：端点 = 皮带中心（游戏不做内缩），len 直接 = round(中心距)
    //   例：(1,3)→(1,0) 中心距 3 → len 3；两端内缩会得到 2，与游戏不符
    // - 建筑端：中心到连接面再内缩 ENDPOINT_INSET（端点埋进建筑内）
    const [fx0, fy0] = getFaceRadius(src.modelIndex);
    const [fx1, fy1] = getFaceRadius(dst.modelIndex);
    const o0 = srcIsBelt ? 0 : Math.max(0, rayFace(dux, duy, fx0, fy0) - ENDPOINT_INSET);
    const o1 = dstIsBelt ? 0 : Math.max(0, rayFace(dux, duy, fx1, fy1) - ENDPOINT_INSET);

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

    // ========== 写入连接字段 ==========
    building.inputObjIdx = src.index;
    building.outputObjIdx = dst.index;

    // slot 编号
    if (srcIsBelt) {
        building.inputFromSlot = -1;  // 皮带端固定 -1
        const preferred = computeBeltOffset(p0, src);
        const occupied = collectOccupiedBeltOffsets(buildings, src.index);
        const offset = findNearestFreeBeltOffset(preferred, occupied);
        if (offset === null) return null;  // 皮带可连位置全被占用
        building.inputOffset = offset;
    } else if (srcIsSplitter) {
        // 四向分流器端：按几何位置定口；一字形短边封闭 / 该口已被引用 → 拒绝
        const port = splitterPortAt(src, p0);
        if (port < 0 || collectOccupiedSplitterPorts(buildings, src.index).has(port))
            return null;
        building.inputFromSlot = -1;
        building.inputOffset = 0;
    } else {
        // 建筑端：端点偏移逆旋到 yaw=0 局部系，找最近空闲 slot（被占则切同侧平行 slot）
        const [localX, localY] = toSlotLocal(src, p0.x - c0.x, p0.y - c0.y);
        const slot = findNearestFreeSlot(
            src.itemId, localX, localY,
            collectOccupiedSlots(buildings, src.index),
        );
        // 有 slot 数据但全被占用：拒绝放置（无数据建筑保持旧行为写 -1）
        if (slot < 0 && hasSlots(src.itemId)) return null;
        building.inputFromSlot = slot;
        building.inputOffset = 0;
    }

    if (dstIsBelt) {
        building.outputToSlot = -1;  // 皮带端固定 -1
        const preferred = computeBeltOffset(p1, dst);
        const occupied = collectOccupiedBeltOffsets(buildings, dst.index);
        const offset = findNearestFreeBeltOffset(preferred, occupied);
        if (offset === null) return null;  // 皮带可连位置全被占用
        building.outputOffset = offset;
    } else if (dstIsSplitter) {
        // 四向分流器端：A/B（一字形）或四口（十字形）各自唯一，不可重复引用
        const port = splitterPortAt(dst, p1);
        if (port < 0 || collectOccupiedSplitterPorts(buildings, dst.index).has(port))
            return null;
        building.outputToSlot = -1;
        building.outputOffset = 0;
    } else {
        const [localX, localY] = toSlotLocal(dst, p1.x - c1.x, p1.y - c1.y);
        const slot = findNearestFreeSlot(
            dst.itemId, localX, localY,
            collectOccupiedSlots(buildings, dst.index),
        );
        if (slot < 0 && hasSlots(dst.itemId)) return null;
        building.outputToSlot = slot;
        building.outputOffset = 0;
    }

    // 分拣器固定 slot
    building.inputToSlot = 1;
    building.outputFromSlot = 0;

    // 重复放置：两端点身份与已有分拣器完全相同（含反向）→ 拒绝
    if (isDuplicateSorter(building, buildings)) return null;
    // 重叠放置：与已有分拣器共线压叠 → 拒绝（同对象对的并行 slot 已在上方放行）
    if (overlapsExistingSorter(building, buildings)) return null;

    return building;
}
