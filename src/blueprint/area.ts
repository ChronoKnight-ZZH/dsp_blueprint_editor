import { BlueprintData } from "./parser";

// Root area constants: equator band, segment=200
const ROOT_SEGMENT = 200;
const GRID_PER_SEGMENT = 5;
export const ROOT_GRID_SIZE = ROOT_SEGMENT * GRID_PER_SEGMENT; // 1000 grid columns

/**
 * 区域在星球上的定位（= `findPosForAreas(...).areas[areaIndex]`）。
 * 光标 ↔ 局部格的换算必须与 `calcBuildingTrans` 用**同一份**定位，否则放置预览会与光标错开。
 * 注意原点纬度不是常数：工具自建空画布（`createEmptyBlueprint`，size.y=161）恰好是 -80，
 * 导入蓝图则由 `findPosForAreas` 按其区域元数据算出（无子区域时为 `-floor(size.y/2)`）。
 */
export interface AreaGridOrigin {
    /** 区域原点纬度：绝对纬向格（纬向格全星球统一，1000 格/圈） */
    latitude: number;
    /** 区域原点经度：以该区域自己的经向格计 */
    longitude: number;
    /** 区域经向段数（`BlueprintArea.areaSegments`）：决定经向格的宽度 */
    segment: number;
}

function wrapGrid(x: number, turn: number): number {
    return ((x % turn) + turn) % turn;
}

/**
 * 星球网格坐标（latGrid / lonGrid，全局 1000 格/圈 = 200 段 × 5 格）→ 区域局部格偏移。
 *
 * 两个必须用传入区域信息的理由：
 * - **纬向**：局部 y 相对区域原点 `area.latitude`，不是固定 -80。根区域原点随 `size.y` 变化
 *   （`-floor(size.y/2)`，多区域蓝图还受子区域锚点约束），用常数会让整个放置位置沿纬向平移
 *   约 `80 - floor(size.y/2)` 格——表现为"导入蓝图后绿盒/落位与光标错开几十格"。
 * - **经向**：全局 1000 格/圈与区域自己的经向格之间差一个 `segment / 200` 的尺度
 *   （极区/低段数区域的格更宽），按 1000 取模也会错。
 */
export function planetToLocal(
    latGrid: number,
    lonGrid: number,
    area: AreaGridOrigin
): { x: number; y: number } {
    const turn = area.segment * GRID_PER_SEGMENT; // 该区域一整圈的经向格数
    const x = wrapGrid(
        lonGrid * (area.segment / ROOT_SEGMENT) - area.longitude,
        turn
    );
    return { x, y: latGrid - area.latitude };
}

/**
 * `planetToLocal` 的逆变换：区域局部格偏移 → 星球网格坐标（全局 1000 格/圈）。
 */
export function localToPlanet(
    offset: { x: number; y: number },
    area: AreaGridOrigin
): {
    lat: number;
    lon: number;
} {
    return {
        lat: offset.y + area.latitude,
        lon: (area.longitude + offset.x) * (ROOT_SEGMENT / area.segment),
    };
}

/**
 * Ensure the root area covers the given offset. Expands size.x if needed.
 * @returns areaIndex (always 0 for root area), or -1 if offset is outside the equator band
 */
export function ensureAreaFor(
    bp: BlueprintData,
    offset: { x: number; y: number }
): number {
    if (bp.areas.length === 0) return -1;
    const root = bp.areas[0];
    if (offset.y < 0 || offset.y >= root.size.y) return -1; // Outside equator band
    if (offset.x < 0 || offset.x >= root.size.x)
        root.size.x = Math.floor(offset.x) + 1;
    return 0;
}

/** 与 planet.ts findRootLatitude 一致：无子区域的根区域始终居中于赤道带 */
function rootAreaLatitude(sizeY: number): number {
    return -Math.floor(sizeY / 2);
}

/**
 * 导出时归一化：根区域收缩为覆盖所有建筑的最小区间（由距离最远的两建筑决定），
 * 所有建筑坐标平移到新原点，dragBoxSize 与 cursorOffset 同步为游戏惯例
 * （与游戏生成蓝图一致：anchorLocalOffset={0,0}、size=dragBoxSize=紧贴边界框）。
 * 经向为环形坐标，自动取最小覆盖弧（处理跨越 0 经线的情况）。
 * 仅对编辑器新建蓝图（dragBoxSize 为 0，游戏蓝图的 dragBoxSize 恒非 0）生效，
 * 导入的蓝图保持字节级不变；不修改入参。
 */
export function normalizeBlueprintAreas(bp: BlueprintData): BlueprintData {
    if (bp.areas.length !== 1 || bp.buildings.length === 0) return bp;
    if (bp.dragBoxSize.x !== 0 || bp.dragBoxSize.y !== 0) return bp;
    if (bp.reformData != null && bp.reformData.rects.length > 0) return bp;
    const root = bp.areas[0];
    if (root.parentIndex !== -1 || root.areaSegments !== ROOT_SEGMENT)
        return bp;

    const liveLat = rootAreaLatitude(root.size.y);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const b of bp.buildings) {
        for (const p of b.localOffset) {
            xs.push(((p.x % ROOT_GRID_SIZE) + ROOT_GRID_SIZE) % ROOT_GRID_SIZE);
            ys.push(p.y + liveLat); // 绝对纬向格
        }
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);

    // x：环形最小覆盖弧 = 最大间隙的补集
    let maxGap = -1,
        gapStart = 0;
    for (let i = 0; i < xs.length; i++) {
        const next = i + 1 < xs.length ? xs[i + 1] : xs[0] + ROOT_GRID_SIZE;
        if (next - xs[i] > maxGap) {
            maxGap = next - xs[i];
            gapStart = xs[i];
        }
    }
    const arcStart = gapStart + maxGap; // 覆盖弧起点（未取模）
    // 左右各留一格边距：originX 左移一格，sizeX 在原基础上 +2
    const originX = Math.floor(arcStart) - 1;
    const sizeX = Math.max(
        1,
        Math.floor(arcStart + (ROOT_GRID_SIZE - maxGap)) - originX + 2
    );

    // y：赤道居中约束下的最小高度，上下各留一格边距
    const needLo = Math.max(0, -Math.floor(ys[0]) + 1);
    const needHi = Math.max(0, Math.floor(ys[ys.length - 1]) + 2);
    const sizeY = Math.max(1, 2 * needLo, 2 * needHi - 1);
    // 新原点纬度 rootAreaLatitude(sizeY)，y' = 绝对纬度 - 新原点纬度 = y + liveLat - newLat
    const dy = liveLat - rootAreaLatitude(sizeY);

    const shiftX = (x: number) =>
        (((x - originX) % ROOT_GRID_SIZE) + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
    const buildings = bp.buildings.map((b) => {
        const localOffset = b.localOffset.map((p) => ({
            x: shiftX(p.x),
            y: p.y + dy,
            z: p.z,
        })) as BlueprintData["buildings"][number]["localOffset"];
        // v2ExtraPose 必须保留：它除尖端坐标外还带分拣器的姿态角（pose[4] = yaw[0]、pose[5] = tilt），
        // 丢弃后导出会退化成 [0,…,0]，游戏读到的分拣器朝向就是 0°（表现为"分拣器角度偏移"、报错）。
        // 尖端坐标随 localOffset[1] 一起平移，其余字段原样保留（导出时还会再由 localOffset[1]/yaw[1] 刷新）。
        const pose = b.v2ExtraPose;
        const v2ExtraPose =
            pose === undefined || pose.length !== 7
                ? pose
                : [
                      pose[0],
                      localOffset[1].x,
                      localOffset[1].y,
                      localOffset[1].z,
                      pose[4],
                      pose[5],
                      pose[6],
                  ];
        return { ...b, localOffset, v2ExtraPose };
    });

    return {
        ...bp,
        cursorOffset: { x: Math.floor(sizeX / 2), y: Math.floor(sizeY / 2) },
        cursorTargetArea: 0,
        dragBoxSize: { x: sizeX, y: sizeY },
        primaryAreaIdx: 0,
        areas: [
            {
                ...root,
                anchorLocalOffset: { x: 0, y: 0 },
                size: { x: sizeX, y: sizeY },
            },
        ],
        buildings,
    };
}
