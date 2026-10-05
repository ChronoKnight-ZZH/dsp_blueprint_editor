import { BlueprintBuilding } from "./parser";
import { buildingBoxes } from "@/data/building";
import { createBuilding } from "./create";
import { isBelt, isInserter, isSplitter } from "@/data/items";
import { faceSlotIndices, getBuildingSlots } from "@/data/buildingSlots";

/**
 * 分拣器（inserter）连接构造：按真实蓝图（游戏 0.10.29 / 0.10.35 实测）标定的规则，
 * 生成"建筑↔传送带 / 建筑↔建筑 / 传送带↔传送带 / 分流器"四类连接记录。
 *
 * 标定来源：tests/tools/分拣器.txt（29 根分拣器：12 根绕制造台 Mk.I 的建筑→皮带环、
 * 3 根皮带→建筑、3 根建筑→建筑、3 根皮带→皮带）+ starting_base_01029 / sorter_belt_replay
 * 共 122 条皮带端样本。要点：
 *
 * 1. 轴向：分拣器只沿网格主轴架接，主轴由两端对象的**整格差**的主分量决定
 *    （如制造台(13,11)→皮带(11,12)：Δ=(-2,+1) → 沿 -x）。中心差为 45° 时主轴不唯一，拒绝。
 * 2. 建筑端端点 = 该建筑某个 slot 的坐标（不是"中心连线与包围盒交点"）：
 *    slot 编号由"朝向对端的面 + 横向坐标最近"决定，可用点击锚点指定横向坐标。
 * 3. 皮带端端点 = **轴线与皮带中心线的交点**（= 把对端端点投影到皮带中心线上），
 *    其主轴投影 main 决定 offset：offset = floor(main × 21)（±半格 ≈ ±10 段）。
 * 4. len = round(两端点距离)，范围 1-3；yaw[0] 为轴向整数角，yaw[1]/tilt 恒 0；
 *    建筑端 offset 恒 0；分拣器自身 slot 固定 inputToSlot=1 / outputFromSlot=0。
 */

/** 网格坐标点（连续值） */
export interface GridPoint {
    x: number;
    y: number;
}

/**
 * 点击锚点：用户在 3D 视图中点击某一端时的网格坐标（连续值）。
 * 与游戏一致：玩家光标落在哪个格子/槽位附近，就决定了分拣器挂哪个 slot，
 * 因此锚点用于"横向坐标最近"的 slot 取值；缺省时退化为对端中心。
 */
export interface SorterAnchors {
    src?: GridPoint;
    dst?: GridPoint;
}

/**
 * 大建筑功能连接面半径封顶（格）。
 * 项目无游戏 SlotConfig（选择盒比模型大）：对无 slot 数据的建筑（分流器/监测器等）
 * 用此封顶，保证紧贴布局也能算出正的端点间距。
 */
const FACE_CAP = 0.9;
/** 无 slot 建筑端自连接面向内的内缩距离，保证端点埋在建筑内 */
const ENDPOINT_INSET = 0.2;

/**
 * 皮带每格的内部分段数：0.10.35 实测 offset = floor(main × 21)。
 * 判据：真实蓝图中 offset 由 3→4 的临界 main = 4/21 = 0.1905（样本 0.1865→3、0.1907→4），
 * 且 offset 区间 ±10 恰好覆盖 ±半格（10/21 = 0.476）。
 */
export const BELT_SEGMENTS_PER_CELL = 21;
/** 皮带端 offset 合法上下限（±半格 ≈ ±10.5 段） */
const BELT_OFFSET_MIN = -10;
const BELT_OFFSET_MAX = 10;
/** 皮带端点必须落在皮带格内：横向 / 主轴投影均不得超过半格 */
const BELT_CELL_HALF = 0.5;
/** main ≈ 0 的浮点容差：小于该值视为正中（避免 -1e-16 被 floor 成 -1） */
const MAIN_EPSILON = 1e-5;

/**
 * v2ExtraPose[0]：真实蓝图中"输入（根）端为建筑"时恒为 ≈0.20118，
 * "输入端为皮带"时恒为 ≈0（仅球面浮点噪声）。语义未公开，按原样复现。
 */
const ROOT_HAND_REST_OFFSET = 0.20118311047554016;

/** 建筑↔建筑 两端 slot 横向坐标允许的最大偏差（不同建筑 slot 表略有差异；
 *  ≥0.4 会架成明显斜向，≤0.2 是相邻一格错位时的正常微斜） */
const SLOT_LATERAL_TOLERANCE = 0.35;

/** 分拣器端点身份键：同一对象 + 同一 slot（皮带再叠 offset）才算同一位置 */
function endpointKey(objIdx: number, slot: number, offset: number): string {
    return `${objIdx}:${slot}:${offset}`;
}

/** 网格偏移 → 建筑 yaw=0 局部坐标（calcBuildingTrans 中 P_grid = R_Z(-yaw)·P_local） */
function toSlotLocal(
    building: BlueprintBuilding,
    dx: number,
    dy: number
): [number, number] {
    const rad = (building.yaw[0] * Math.PI) / 180;
    const cos = Math.cos(rad),
        sin = Math.sin(rad);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** 建筑 yaw=0 局部坐标 → 网格偏移（toSlotLocal 的逆变换） */
function fromSlotLocal(
    building: BlueprintBuilding,
    lx: number,
    ly: number
): [number, number] {
    const rad = (building.yaw[0] * Math.PI) / 180;
    const cos = Math.cos(rad),
        sin = Math.sin(rad);
    return [lx * cos + ly * sin, -lx * sin + ly * cos];
}

/** 归一化方向 (ux,uy) 从矩形中心到连接面的轴向距离（局部系半尺寸 hx,hy） */
function rayFace(ux: number, uy: number, hx: number, hy: number) {
    let t = Infinity;
    if (ux !== 0) t = Math.min(t, hx / Math.abs(ux));
    if (uy !== 0) t = Math.min(t, hy / Math.abs(uy));
    return t;
}

/** 建筑选择盒在 yaw=0 局部系下的半尺寸（x, y），大建筑按 {@link FACE_CAP} 封顶 */
function faceHalfSize(modelIndex: number): [number, number] {
    const box = buildingBoxes.get(modelIndex);
    if (!box) return [FACE_CAP, FACE_CAP];
    return [Math.min(box[0] / 2, FACE_CAP), Math.min(box[2] / 2, FACE_CAP)];
}

/** 皮带行进方向（yaw=0 → +y，yaw=90 → +x） */
function beltDir(belt: BlueprintBuilding): GridPoint {
    const rad = (belt.yaw[0] * Math.PI) / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
}

/**
 * 主轴投影 main → 皮带端 offset（真实蓝图标定：offset = floor(main × 21)）。
 * main = 端点在皮带方向上相对皮带中心的投影距离（格），符号与行进方向一致。
 */
export function beltOffsetFromMain(main: number): number {
    const m = Math.abs(main) < MAIN_EPSILON ? 0 : main;
    const raw = Math.floor(m * BELT_SEGMENTS_PER_CELL);
    return Math.max(BELT_OFFSET_MIN, Math.min(BELT_OFFSET_MAX, raw));
}

/** offset 对应分段的中点 main（避让占用时把端点平移到空闲分段中心，保持 offset 与几何一致） */
function mainForOffset(offset: number): number {
    return (offset + 0.5) / BELT_SEGMENTS_PER_CELL;
}

/** 把点投影到皮带中心线上（返回中心线上离该点最近的点） */
function projectOnBelt(belt: BlueprintBuilding, p: GridPoint): GridPoint {
    const c = belt.localOffset[0];
    const d = beltDir(belt);
    const main = (p.x - c.x) * d.x + (p.y - c.y) * d.y;
    return { x: c.x + d.x * main, y: c.y + d.y * main };
}

/**
 * 收集目标建筑上已被其他分拣器占用的 slot 编号。
 * 已有分拣器：inputObjIdx===target 时占用 inputFromSlot（从其取物），
 * outputObjIdx===target 时占用 outputToSlot（向其送物）。
 * 导出供编辑器 UI 给 slot 标记染色（红=已占用）。
 */
export function collectOccupiedSlots(
    buildings: readonly BlueprintBuilding[],
    targetIndex: number
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

/** 收集目标皮带上已被其他分拣器占用的 offset（皮带端 slot 固定 -1） */
function collectOccupiedBeltOffsets(
    buildings: readonly BlueprintBuilding[],
    beltIndex: number
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
 * 分拣器端点落在四向分流器（2020）哪个口。
 * 口的判定以"分拣器另一端（partner）相对分流器的方向"为准——与游戏里分拣器
 * "从哪一侧接入"一致；缺 partner 时退回端点几何位置。口编号与 SpitterInfo /
 * BuildingInfo 的 adjacency 下标一致（分流器 yaw=0 局部系）：
 * - 十字形（modelIndex 38/40）：0=+y, 1=+x, 2=-y, 3=-x，共四口
 * - 一字形（modelIndex 39）：仅长轴两端开口，0=A 端(+y)，2=B 端(-y)；
 *   0/1、2/3 是同一端的两层高度（平面架接不区分），短轴两侧封闭 → 返回 -1
 */
function splitterPortAt(
    sp: BlueprintBuilding,
    partner: BlueprintBuilding | null,
    fallback?: GridPoint
): number {
    let dx: number, dy: number;
    if (partner !== null && partner !== undefined) {
        dx = partner.localOffset[0].x - sp.localOffset[0].x;
        dy = partner.localOffset[0].y - sp.localOffset[0].y;
    } else if (fallback !== undefined) {
        dx = fallback.x - sp.localOffset[0].x;
        dy = fallback.y - sp.localOffset[0].y;
    } else {
        return -1;
    }
    const [lx, ly] = toSlotLocal(sp, dx, dy);
    if (sp.modelIndex === 39) {
        if (Math.abs(lx) >= Math.abs(ly)) return -1; // 一字形短边：无开口
        return ly >= 0 ? 0 : 2;
    }
    if (Math.abs(lx) >= Math.abs(ly)) return lx >= 0 ? 1 : 3;
    return ly >= 0 ? 0 : 2;
}

/** 按 index 查找建筑（buildings 数组下标与 index 不一定一致，如测试传入子集） */
function findByIndex(
    buildings: readonly BlueprintBuilding[],
    index: number
): BlueprintBuilding | null {
    if (index < 0) return null;
    for (const b of buildings) if (b.index === index) return b;
    return null;
}

/**
 * 收集四向分流器上已被其他分拣器占用的口（按 partner 方向反推口编号，
 * 不依赖蓝图 wire 字段——直连分拣器在游戏数据中 slot 恒为 -1）。
 */
function collectOccupiedSplitterPorts(
    buildings: readonly BlueprintBuilding[],
    splitterIndex: number
): Set<number> {
    const occ = new Set<number>();
    const sp = findByIndex(buildings, splitterIndex);
    if (!sp || !isSplitter(sp.itemId)) return occ;
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        if (b.inputObjIdx === splitterIndex) {
            const port = splitterPortAt(
                sp,
                findByIndex(buildings, b.outputObjIdx),
                b.localOffset[0]
            );
            if (port >= 0) occ.add(port);
        }
        if (b.outputObjIdx === splitterIndex) {
            const port = splitterPortAt(
                sp,
                findByIndex(buildings, b.inputObjIdx),
                b.localOffset[1]
            );
            if (port >= 0) occ.add(port);
        }
    }
    return occ;
}

/**
 * 重复放置检测：新分拣器的两个端点与某已存在分拣器完全相同（含 A→B / B→A
 * 反向）时拒绝。平行 slot / 不同 offset 的并行分拣器端点身份不同，不受影响。
 */
function isDuplicateSorter(
    n: BlueprintBuilding,
    buildings: readonly BlueprintBuilding[]
): boolean {
    const nIn = endpointKey(n.inputObjIdx, n.inputFromSlot, n.inputOffset);
    const nOut = endpointKey(n.outputObjIdx, n.outputToSlot, n.outputOffset);
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        const bIn = endpointKey(b.inputObjIdx, b.inputFromSlot, b.inputOffset);
        const bOut = endpointKey(
            b.outputObjIdx,
            b.outputToSlot,
            b.outputOffset
        );
        if ((bIn === nIn && bOut === nOut) || (bIn === nOut && bOut === nIn))
            return true;
    }
    return false;
}

/** 两条分拣器中心线共线（含反向）且横向间距小于半宽、纵向区间相交 → 重叠 */
const SORTER_HALF_WIDTH = 0.15;

function collinearSorterOverlap(
    a0: GridPoint,
    a1: GridPoint,
    b0: GridPoint,
    b1: GridPoint
): boolean {
    const d1x = a1.x - a0.x,
        d1y = a1.y - a0.y;
    const l1 = Math.hypot(d1x, d1y);
    const d2x = b1.x - b0.x,
        d2y = b1.y - b0.y;
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) return false;
    // 夹角正弦：非共线（垂直交叉等）不算"重叠"
    const SINE = Math.sin((5 * Math.PI) / 180);
    if (Math.abs(d1x * d2y - d1y * d2x) / (l1 * l2) > SINE) return false;
    // b0 到 a 所在直线的垂直距离
    if (
        Math.abs(d1x * (a0.y - b0.y) - d1y * (a0.x - b0.x)) / l1 >
        SORTER_HALF_WIDTH
    )
        return false;
    // b 在 a 主轴上的投影区间与 a 的 [0,1] 是否相交
    const t = (p: GridPoint) =>
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
    buildings: readonly BlueprintBuilding[]
): boolean {
    for (const b of buildings) {
        if (!isInserter(b.itemId)) continue;
        const samePair =
            (b.inputObjIdx === n.inputObjIdx &&
                b.outputObjIdx === n.outputObjIdx) ||
            (b.inputObjIdx === n.outputObjIdx &&
                b.outputObjIdx === n.inputObjIdx);
        if (samePair) continue;
        if (
            collinearSorterOverlap(
                n.localOffset[0],
                n.localOffset[1],
                b.localOffset[0],
                b.localOffset[1]
            )
        )
            return true;
    }
    return false;
}

/**
 * 分拣器一端（建筑端 / 皮带端 / 无 slot 建筑端）。
 * @param slot 建筑 slot 编号；皮带与无 slot 建筑端为 -1
 * @param offset 皮带端分段 offset；建筑端恒 0
 * @param lat 端点在"垂直轴向"方向的网格坐标（用于两端横向一致性校验）
 */
interface SorterEnd {
    point: GridPoint;
    slot: number;
    offset: number;
    lat: number;
}

/**
 * 在两个已有建筑/皮带之间构造一个分拣器（尚未入库）。
 *
 * 端点规则（真实蓝图标定，见文件头注释）：
 * - 建筑端：端点 = 朝向对端的面上的 slot 坐标（可用锚点指定横向位置；被占用时
 *   在同面内切换最近的空闲 slot）
 * - 皮带端：端点 = 轴线（过对端端点、沿主轴）与皮带中心线的交点；
 *   offset = floor(main × 21)，若该 offset 已被其他分拣器占用则平移到最近空闲分段中心
 * - 无 slot 数据的建筑（分流器 / 监测器等）：端点 = 轴线与连接面的交点（slot 写 -1）
 *
 * 拒绝放置（返回 null）的情况：
 * - 两端同对象 / 主轴无法确定（中心差为 45° 斜向、两点重合）
 * - 建筑 slot 面已被全部占用、分流器口已被引用
 * - 皮带端落在皮带格之外（|main| 或横向 > 半格）
 * - 长度不在 1-3 格、两端 slot 横向偏差过大（会架成斜向）
 * - 与已有分拣器端点完全相同或共线压叠
 *
 * @param buildings 已入库建筑列表，用于 slot / offset / 分流器口占用检测
 * @param anchors 两端点击锚点（网格坐标，可只给一端）
 */
export function createSorterBetween(
    src: BlueprintBuilding,
    dst: BlueprintBuilding,
    itemId: number,
    modelIndex: number,
    buildings: readonly BlueprintBuilding[] = [],
    anchors: SorterAnchors = {}
): BlueprintBuilding | null {
    const preferred = buildSorter(
        src,
        dst,
        itemId,
        modelIndex,
        buildings,
        anchors,
        true
    );
    if (
        preferred !== null ||
        (anchors.src === undefined && anchors.dst === undefined)
    )
        return preferred;
    // 按锚点无解时忽略锚点重试一次：用户点击位置可能偏离能连上的 slot 行
    // （例如点在源建筑正中，而目标皮带在相邻一行），此时退回"对端中心"基准。
    return buildSorter(src, dst, itemId, modelIndex, buildings, anchors, false);
}

function buildSorter(
    src: BlueprintBuilding,
    dst: BlueprintBuilding,
    itemId: number,
    modelIndex: number,
    buildings: readonly BlueprintBuilding[],
    anchors: SorterAnchors,
    useAnchors: boolean
): BlueprintBuilding | null {
    if (src.index === dst.index) return null;
    const c0 = src.localOffset[0];
    const c1 = dst.localOffset[0];

    // ---- 主轴：由两端中心的整格差主分量决定（分拣器只能沿网格主轴架接）----
    let ax = Math.round(c1.x) - Math.round(c0.x);
    let ay = Math.round(c1.y) - Math.round(c0.y);
    if (ax === 0 && ay === 0) {
        ax = c1.x - c0.x;
        ay = c1.y - c0.y;
    }
    if (ax === 0 && ay === 0) return null;
    if (Math.abs(ax) === Math.abs(ay)) return null; // 45° 斜向：主轴不唯一
    const alongX = Math.abs(ax) > Math.abs(ay);
    const axis: GridPoint = alongX
        ? { x: Math.sign(ax), y: 0 }
        : { x: 0, y: Math.sign(ay) };
    /** 垂直轴向的单位向量（横向坐标基准） */
    const perp: GridPoint = { x: -axis.y, y: axis.x };
    const latOf = (p: GridPoint, ref: GridPoint) =>
        (p.x - ref.x) * perp.x + (p.y - ref.y) * perp.y;

    const srcIsBelt = isBelt(src.itemId);
    const srcSlots = getBuildingSlots(src.itemId);
    const dstSlots = getBuildingSlots(dst.itemId);
    const srcIsSplitter = isSplitter(src.itemId);
    const dstIsSplitter = isSplitter(dst.itemId);

    /**
     * 建筑端 slot 选择：候选 = **朝向对端那个面**上的 slot（面归属规则见
     * {@link faceSlotIndices}），按横向坐标与 targetLat 的距离升序，跳过已被占用的 slot。
     */
    const chooseSlot = (
        b: BlueprintBuilding,
        toward: GridPoint,
        targetLat: number,
        occupied: ReadonlySet<number>
    ): SorterEnd | null => {
        const slots = getBuildingSlots(b.itemId);
        const c = b.localOffset[0];
        // 朝向面法线（建筑 yaw=0 局部系，slot 表就在该系下）
        const [ltx, lty] = toSlotLocal(b, toward.x, toward.y);
        const onFace = new Set(faceSlotIndices(b.itemId, { x: ltx, y: lty }));
        const candidates: { slot: number; end: SorterEnd }[] = [];
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (s === null || !onFace.has(i))
                // null = 该 slot 未标定
                continue;
            const [gx, gy] = fromSlotLocal(b, s.x, s.y);
            const point = { x: c.x + gx, y: c.y + gy };
            candidates.push({
                slot: i,
                end: { point, slot: i, offset: 0, lat: latOf(point, c0) },
            });
        }
        if (candidates.length === 0) return null;
        candidates.sort(
            (a, b2) =>
                Math.abs(a.end.lat - targetLat) -
                    Math.abs(b2.end.lat - targetLat) || a.slot - b2.slot
        );
        return candidates.find((cd) => !occupied.has(cd.slot))?.end ?? null;
    };

    /**
     * 无 slot 数据的建筑端（分流器 / 监测器 / 集装机等）：
     * 端点 = 轴线（过 refPoint、沿 axis）与连接面的交点，内缩 {@link ENDPOINT_INSET}。
     * @param sign +1 表示端点在建筑朝对端的一侧（源端），-1 表示对侧（目标端）
     */
    const slotlessEnd = (
        b: BlueprintBuilding,
        refPoint: GridPoint,
        sign: number
    ): SorterEnd => {
        const c = b.localOffset[0];
        const [lax, lay] = toSlotLocal(b, axis.x, axis.y);
        const [hx, hy] = faceHalfSize(b.modelIndex);
        const d = Math.max(0, rayFace(lax, lay, hx, hy) - ENDPOINT_INSET);
        // 端点在轴线上的位置：使其相对建筑中心的轴向坐标为 sign·d
        const t =
            sign * d -
            ((refPoint.x - c.x) * axis.x + (refPoint.y - c.y) * axis.y);
        const point = {
            x: refPoint.x + axis.x * t,
            y: refPoint.y + axis.y * t,
        };
        return { point, slot: -1, offset: 0, lat: latOf(point, c0) };
    };

    /**
     * 皮带端：端点 = refPoint 在皮带中心线上的投影（轴线与皮带垂直时的交点）。
     * 轴线与皮带方向平行时（如皮带正对建筑进料）投影退化，端点取皮带格中心。
     * 校验端点落在皮带格内（|main| 与横向均 ≤ 半格）；offset 被占用时平移到最近空闲分段。
     */
    const beltEnd = (
        belt: BlueprintBuilding,
        refPoint: GridPoint,
        occupied: ReadonlySet<number>
    ): SorterEnd | null => {
        const c = belt.localOffset[0];
        const d = beltDir(belt);
        const beltPerp: GridPoint = { x: -d.y, y: d.x };
        // 轴线与皮带方向近似平行（夹角 < ~26°）→ 投影退化，取皮带中心（真实蓝图实测）
        const parallel = Math.abs(axis.x * d.x + axis.y * d.y) > 0.9;
        /** 校验 + 生成端点；main 为该点在皮带方向上的投影 */
        const make = (
            p: GridPoint
        ): { end: SorterEnd; main: number } | null => {
            const rx = p.x - c.x,
                ry = p.y - c.y;
            const main = rx * d.x + ry * d.y;
            const lateral = rx * beltPerp.x + ry * beltPerp.y;
            if (
                Math.abs(main) > BELT_CELL_HALF ||
                Math.abs(lateral) > BELT_CELL_HALF
            )
                return null;
            return {
                end: {
                    point: p,
                    slot: -1,
                    offset: beltOffsetFromMain(main),
                    lat: latOf(p, c0),
                },
                main,
            };
        };
        const target = parallel
            ? { x: c.x, y: c.y }
            : projectOnBelt(belt, refPoint);
        const first = make(target);
        if (first === null) return null;
        if (!occupied.has(first.end.offset)) return first.end;
        // offset 被占用：在 [-10, 10] 内按距离找最近空闲分段，并把端点移到该分段中心
        const candidates: number[] = [];
        for (let o = BELT_OFFSET_MIN; o <= BELT_OFFSET_MAX; o++) {
            if (!occupied.has(o)) candidates.push(o);
        }
        candidates.sort(
            (a, b) =>
                Math.abs(a - first.end.offset) -
                    Math.abs(b - first.end.offset) || a - b
        );
        for (const o of candidates) {
            const main = mainForOffset(o);
            const shifted = make({ x: c.x + d.x * main, y: c.y + d.y * main });
            if (shifted === null) continue;
            shifted.end.offset = o;
            return shifted.end;
        }
        return null;
    };

    // ---- 驱动端：优先"带 slot 且给了点击锚点"的一端，其次任一带 slot 的一端 ----
    let driver: "src" | "dst" | "none" = "none";
    if (srcSlots.length > 0 && useAnchors && anchors.src !== undefined)
        driver = "src";
    else if (dstSlots.length > 0 && useAnchors && anchors.dst !== undefined)
        driver = "dst";
    else if (srcSlots.length > 0) driver = "src";
    else if (dstSlots.length > 0) driver = "dst";

    let srcEnd: SorterEnd | null = null;
    let dstEnd: SorterEnd | null = null;
    if (driver === "src") {
        const targetLat =
            useAnchors && anchors.src !== undefined
                ? latOf(anchors.src, c0)
                : latOf(c1, c0);
        srcEnd = chooseSlot(
            src,
            axis,
            targetLat,
            collectOccupiedSlots(buildings, src.index)
        );
        if (srcEnd === null) return null;
    } else if (driver === "dst") {
        // 缺省（无锚点）时轴线过源对象中心 → 全局横向目标 0
        const targetLat =
            useAnchors && anchors.dst !== undefined
                ? latOf(anchors.dst, c0)
                : 0;
        const towardSrc: GridPoint = { x: -axis.x, y: -axis.y };
        dstEnd = chooseSlot(
            dst,
            towardSrc,
            targetLat,
            collectOccupiedSlots(buildings, dst.index)
        );
        if (dstEnd === null) return null;
    }

    // 轴线参考点：已确定端点的位置，或目标对象中心（两端都无 slot 时）
    const refPoint: GridPoint =
        srcEnd !== null
            ? srcEnd.point
            : dstEnd !== null
            ? dstEnd.point
            : { x: c1.x, y: c1.y };

    /**
     * 补全未确定的一端：皮带端取轴线与皮带中心线交点；
     * 有 slot 数据的建筑端按"朝向对端的面 + 横向坐标（= 已定端点的横向）"选 slot；
     * 其余（分流器等无 slot 建筑）取轴线与连接面交点。
     */
    const completeEnd = (
        b: BlueprintBuilding,
        isSrc: boolean
    ): SorterEnd | null => {
        if (isBelt(b.itemId))
            return beltEnd(
                b,
                refPoint,
                collectOccupiedBeltOffsets(buildings, b.index)
            );
        if (getBuildingSlots(b.itemId).length > 0) {
            const toward: GridPoint = isSrc ? axis : { x: -axis.x, y: -axis.y };
            return chooseSlot(
                b,
                toward,
                latOf(refPoint, c0),
                collectOccupiedSlots(buildings, b.index)
            );
        }
        return slotlessEnd(b, refPoint, isSrc ? 1 : -1);
    };

    // ---- 补全另一端 ----
    if (srcEnd === null) {
        srcEnd = completeEnd(src, true);
        if (srcEnd === null) return null;
    }
    if (dstEnd === null) {
        dstEnd = completeEnd(dst, false);
        if (dstEnd === null) return null;
    }

    // ---- 校验：两端 slot 横向一致（建筑↔建筑不能架成斜向）+ 长度 1-3 ----
    if (
        srcEnd.slot >= 0 &&
        dstEnd.slot >= 0 &&
        Math.abs(srcEnd.lat - dstEnd.lat) > SLOT_LATERAL_TOLERANCE
    )
        return null;

    const dx = dstEnd.point.x - srcEnd.point.x;
    const dy = dstEnd.point.y - srcEnd.point.y;
    const len = Math.round(Math.hypot(dx, dy));
    if (len < 1 || len > 3) return null;

    // ---- 分流器口唯一性（直连分拣器 slot 恒 -1，口按对端方向反推）----
    if (srcIsSplitter) {
        const port = splitterPortAt(src, dst, srcEnd.point);
        if (
            port < 0 ||
            collectOccupiedSplitterPorts(buildings, src.index).has(port)
        )
            return null;
    }
    if (dstIsSplitter) {
        const port = splitterPortAt(dst, src, dstEnd.point);
        if (
            port < 0 ||
            collectOccupiedSplitterPorts(buildings, dst.index).has(port)
        )
            return null;
    }

    // ---- 组装分拣器记录（yaw[0] 沿运动主轴，yaw[1]/tilt 恒 0）----
    const yaw0 = alongX ? (axis.x > 0 ? 90 : 270) : axis.y > 0 ? 0 : 180;
    const building = createBuilding(itemId, modelIndex, srcEnd.point, yaw0);
    building.localOffset[1] = { x: dstEnd.point.x, y: dstEnd.point.y, z: 0 };
    building.yaw = [yaw0, 0];
    building.tilt = 0;
    (building.parameters as { length: number }).length = len;

    building.inputObjIdx = src.index;
    building.outputObjIdx = dst.index;
    building.inputFromSlot = srcEnd.slot; // 建筑端 0-11，皮带/无 slot 端 -1
    building.inputOffset = srcEnd.offset; // 皮带端分段 offset，建筑端 0
    building.inputToSlot = 1; // 分拣器自身固定 slot
    building.outputToSlot = dstEnd.slot;
    building.outputOffset = dstEnd.offset;
    building.outputFromSlot = 0;
    // 第二端姿态：pose[0] 复现游戏"输入端为建筑时 ≈0.20118"的固定值
    building.v2ExtraPose = [
        srcIsBelt ? 0 : ROOT_HAND_REST_OFFSET,
        dstEnd.point.x,
        dstEnd.point.y,
        0,
        yaw0,
        0,
        0,
    ];

    // 重复放置：两端点身份与已有分拣器完全相同（含反向）→ 拒绝
    if (isDuplicateSorter(building, buildings)) return null;
    // 重叠放置：与已有分拣器共线压叠 → 拒绝（同对象对的并行 slot 已在上方放行）
    if (overlapsExistingSorter(building, buildings)) return null;

    return building;
}
