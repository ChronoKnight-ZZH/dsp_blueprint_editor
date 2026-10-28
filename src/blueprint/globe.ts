import {
    BlueprintArea,
    BlueprintBuilding,
    BlueprintData,
    BlueprintReformRect,
} from "./parser";
import {
    bandOfRow,
    bandSpan,
    findPosForAreas,
    PlanetBand,
    planetBandGridRange,
    planetBands,
    PositionedBlueprint,
} from "./planet";

/**
 * 全球画布：把"一颗星球的全部纬度带"当作编辑坐标空间。
 *
 * ## 为什么需要它
 *
 * 蓝图区域（`BlueprintArea`）只能落在**一条纬度带**里：`areaSegments` 决定该区域的经向
 * 网格分辨率，而整颗星球按 `segmentArr` 分成 200/160/120/…/4 段的若干带
 * （`findPosForAreas` 还要求子区域段数严格小于父区域）。所以「全球任意位置放置」= 蓝图里
 * **一条带一个区域**，按纬度方向串成一棵树，而不是把某一区域的 `size.y` 撑大。
 *
 * ## 画布约定
 *
 * - 根区域恒为赤道带（`areaSegments=200`，`size.y=161`，纬度 -80）：它在
 *   `findPosForAreas` 的居中/贴边两种推法下都得到 -80，位置稳定，适合当全星球的锚点。
 * - 每条用到的带一个区域：`areaSegments` = 该带段数，`size.y` = 整带高度
 *   （`planet.bandSpan`），于是带内任意一行都能放建筑，不必再挪区域。
 * - 所有区域的**原点经度恒为 0**（`tropicAnchor=0`、`anchorLocalOffset.x=0`），即每条带的
 *   第 0 列都落在同一条经线上：局部格 x 就是该带的经向列（0..5×段数），
 *   `findPosForAreas` 在这种树下解出的经度也恒为 0。
 * - 子区域挂到"同半球里段数更大的最近一条带"（没有就用根区域），`anchorLocalOffset.y`
 *   = 子带首行 − 父区域纬度。
 */

const GRID_PER_SEGMENT = 5;
const ROOT_SEGMENT = 200;

/** 全球经向格数（赤道带一整圈） */
export const ROOT_GRID_SIZE = ROOT_SEGMENT * GRID_PER_SEGMENT;

/** 某段数的区域一整圈的经向格数 */
export function areaGridSize(segment: number): number {
    return segment * GRID_PER_SEGMENT;
}

function wrap(x: number, turn: number): number {
    return ((x % turn) + turn) % turn;
}

/** 去掉浮点噪声：0.9999999 → 1（经向分数换算回格子时会出现这种尾巴） */
function snap(x: number): number {
    const rounded = Math.round(x);
    return Math.abs(x - rounded) < 1e-6 ? rounded : x;
}

/** 区域在星球上的定位（= `findPosForAreas(...).areas[areaIndex]`） */
export interface AreaGridOrigin {
    /** 区域原点纬度：绝对纬向格（全星球 1000 格/圈） */
    latitude: number;
    /** 区域原点经度：以该区域自己的经向格计 */
    longitude: number;
    /** 区域经向段数（`BlueprintArea.areaSegments`） */
    segment: number;
}

/**
 * 星球网格坐标（latGrid / lonGrid，全局 1000 格/圈）→ 区域局部格。
 *
 * 必须用传入区域信息的理由：
 * - **纬向**：局部 y 相对区域原点 `area.latitude`，不是固定 -80（不同带、不同 size.y 都不同）。
 * - **经向**：全局 1000 格/圈与区域自己的经向格之间差一个 `segment / 200` 的尺度
 *   （极区/低段数区域的格更宽），按 1000 取模也会错。
 */
export function planetToLocal(
    latGrid: number,
    lonGrid: number,
    area: AreaGridOrigin
): { x: number; y: number } {
    const turn = areaGridSize(area.segment);
    const x = wrap(
        lonGrid * (area.segment / ROOT_SEGMENT) - area.longitude,
        turn
    );
    return { x, y: latGrid - area.latitude };
}

/** `planetToLocal` 的逆变换：区域局部格 → 星球网格坐标（全局 1000 格/圈） */
export function localToPlanet(
    offset: { x: number; y: number },
    area: AreaGridOrigin
): { lat: number; lon: number } {
    return {
        lat: offset.y + area.latitude,
        lon: (area.longitude + offset.x) * (ROOT_SEGMENT / area.segment),
    };
}

/** 绝对位置：纬向行（全星球统一）+ 经向分数（0..1 圈） */
export interface AbsolutePos {
    row: number;
    lonFrac: number;
}

/** 区域局部格 → 绝对位置 */
export function localToAbs(
    area: AreaGridOrigin,
    p: { x: number; y: number }
): AbsolutePos {
    const turn = areaGridSize(area.segment);
    return {
        row: area.latitude + p.y,
        lonFrac: wrap(area.longitude + p.x, turn) / turn,
    };
}

/** 绝对位置 → 指定区域原点的局部格（保留分数坐标：分拣器尖端可以是小数） */
export function absToLocal(
    area: AreaGridOrigin,
    abs: AbsolutePos
): { x: number; y: number } {
    const turn = areaGridSize(area.segment);
    return {
        x: snap(wrap(abs.lonFrac * turn - area.longitude, turn)),
        y: abs.row - area.latitude,
    };
}

/** 建筑端点的局部格：两个经纬格 + 一个高度格（堆叠层 / 分拣器尖端） */
export interface LocalPoint {
    x: number;
    y: number;
    z: number;
}

/**
 * 逐点重写建筑的局部格，并同步分拣器尖端姿态（`v2ExtraPose`）。不修改入参。
 *
 * **`mapPoint` 必须返回带 `z` 的点**：`z` 是高度格（堆叠层 / 分拣器尖端），与经纬格无关，
 * 换区域时不能丢 —— 丢了 `calcBuildingTrans` 会算出
 * `height = R + undefined * (4/3) = NaN`，整条建筑矩阵变 NaN、模型整体不可见
 * （表现为"进编辑模式后原有建筑消失，退出也不回来"：NaN 还会被 `toStr` 写回蓝图）。
 *
 * `v2ExtraPose` 也必须重建：它除尖端坐标外还带分拣器姿态角（pose[4] = yaw[0]、
 * pose[5] = tilt），丢弃后导出会退化成 0°，游戏里分拣器朝向就错了。
 */
export function mapBuildingPoints(
    b: BlueprintBuilding,
    areaIndex: number,
    mapPoint: (p: LocalPoint, index: number) => LocalPoint
): BlueprintBuilding {
    const localOffset = b.localOffset.map((p, i) =>
        mapPoint(p, i)
    ) as BlueprintBuilding["localOffset"];
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
    return { ...b, areaIndex, localOffset, v2ExtraPose };
}

/** 带的唯一键（段数 + 半球） */
export function bandKey(band: PlanetBand): string {
    return `${band.segment}/${band.hemisphere}`;
}

/** 赤道带（全球画布的根） */
export function equatorBand(maxSegment = 200): PlanetBand {
    const band = planetBands(maxSegment).find((b) => b.hemisphere === 0);
    if (band === undefined)
        throw new Error(`Planet with ${maxSegment} segments has no equator band.`);
    return band;
}

/** 画布区域的原点经度恒为 0（见模块头注释） */
export const CANVAS_LONGITUDE = 0;

/** 某条带在画布上的规范原点（纬度 = 该带首行） */
export function canvasOrigin(band: PlanetBand): AreaGridOrigin {
    return {
        latitude: band.rowLo,
        longitude: CANVAS_LONGITUDE,
        segment: band.segment,
    };
}

/** 放置目标：命中的纬度带 + 该带的区域 + 局部格 */
export interface CanvasTarget {
    band: PlanetBand;
    /** 现有区域下标；-1 = 该带还没有区域（放置前由 `ensureCanvasArea` 按 `origin` 补建） */
    areaIndex: number;
    origin: AreaGridOrigin;
    x: number;
    y: number;
}

/**
 * 行星行 + 全局经向格 → 画布上的目标区域与局部格。
 *
 * 已建好的同段数区域优先（用它的真实原点）；否则返回**规范布局**的虚拟原点
 * （`areaIndex=-1`）——`ensureCanvasArea` 建出来的区域与它完全一致，所以预览与落位不会错开。
 */
export function canvasTargetAt(
    bp: BlueprintData,
    pos: PositionedBlueprint,
    row: number,
    lonGrid: number
): CanvasTarget | null {
    const band = bandOfRow(row);
    if (band === null) return null;
    for (let i = 0; i < bp.areas.length; i++) {
        const area = bp.areas[i];
        if (area.areaSegments !== band.segment) continue;
        const origin = pos.areas[i];
        if (origin === undefined) continue;
        if (row < origin.latitude || row >= origin.latitude + area.size.y)
            continue;
        const local = planetToLocal(row, lonGrid, origin);
        return { band, areaIndex: i, origin, x: local.x, y: local.y };
    }
    const origin = canvasOrigin(band);
    const local = planetToLocal(row, lonGrid, origin);
    return { band, areaIndex: -1, origin, x: local.x, y: local.y };
}

/**
 * 把某个区域的纬度平移到 `newLat`，并让它的建筑、子区域保持**绝对位置不变**：
 * 建筑局部 y 反向平移，直接子区域的锚点同步反向平移。
 * 只对根区域之外（`parentIndex >= 0`）的区域有意义 —— 根区域的纬度由 `size.y` 反推。
 */
export function moveArea(
    bp: BlueprintData,
    pos: PositionedBlueprint,
    areaIndex: number,
    newLat: number
): void {
    const origin = pos.areas[areaIndex];
    const area = bp.areas[areaIndex];
    if (origin === undefined || area === undefined) return;
    const delta = newLat - origin.latitude;
    if (delta === 0) return;
    // 子区域：纬度 = 父纬度 + anchorLocalOffset.y → 改锚点
    if (area.parentIndex >= 0) area.anchorLocalOffset.y += delta;
    // 区域纬度整体 +delta：自己的建筑局部 y、直接子区域的锚点都要 -delta，
    // 这样它们的绝对行一格都不动（子区域再往下也随父区域一起动）。
    shiftAreaFrame(bp, areaIndex, delta);
}

/** 区域纬度整体变化 `delta` 后，保持其建筑与子区域绝对位置不变的局部补偿 */
function shiftAreaFrame(
    bp: BlueprintData,
    areaIndex: number,
    delta: number
): void {
    if (delta === 0) return;
    for (const b of bp.buildings) {
        if (b.areaIndex !== areaIndex) continue;
        for (const p of b.localOffset) p.y -= delta;
        // v2ExtraPose = [pose0, tip.x, tip.y, tip.z, yaw0, tilt, yaw1]：尖端 y 必须一起平移
        const pose = b.v2ExtraPose;
        if (pose !== undefined && pose.length === 7) pose[2] -= delta;
    }
    for (const a of bp.areas) {
        if (a.parentIndex === areaIndex) a.anchorLocalOffset.y -= delta;
    }
}

/** 带键 → 该区域的半球归属（赤道带恒为 0） */
function areaHemisphere(segment: number, latitude: number): -1 | 0 | 1 {
    if (segment === ROOT_SEGMENT) return 0;
    if (latitude < 0) return -1;
    if (latitude > 0) return 1;
    return 0;
}

/**
 * 确保画布上有覆盖 `band` 的区域，返回区域下标（会修改 `bp.areas`）。
 *
 * 1. 已有同段数、整带高度、盖住该带首行的区域 → 直接用；
 * 2. 有同段数、同半球的子区域但位置/高度不规范 → 平移到规范行并补足整带高度
 *    （`moveArea` 会补偿建筑与子区域锚点，绝对位置不变）；
 * 3. 有同段数的根区域但高度不足 → 直接把它补成整带（根区域纬度由 `size.y` 反推，
 *    整带高度正好解出该带首行；建筑/子区域同样补偿）；
 * 4. 否则新建：父区域 = 同半球里段数更大的最近带，否则根区域。
 */
export function ensureCanvasArea(
    bp: BlueprintData,
    band: PlanetBand
): number {
    if (bp.areas.length === 0) {
        bp.areas.push({
            index: 0,
            parentIndex: -1,
            tropicAnchor: 0,
            areaSegments: band.segment,
            anchorLocalOffset: { x: 0, y: 0 },
            size: { x: 1, y: bandSpan(band) },
        });
        return 0;
    }
    const pos = findPosForAreas(bp.areas);
    const target = bandKey(band);
    const span = bandSpan(band);
    // 1) 已覆盖该带
    for (let i = 0; i < bp.areas.length; i++) {
        const area = bp.areas[i];
        const origin = pos.areas[i];
        if (origin === undefined || area.areaSegments !== band.segment) continue;
        if (
            area.size.y === span &&
            band.rowLo >= origin.latitude &&
            band.rowLo < origin.latitude + area.size.y &&
            bandKey(bandOfRow(origin.latitude) ?? band) === target
        )
            return i;
    }
    // 2) 同段数、同半球的子区域挪到规范位置（半球不同 = 另一条带，不能挪）
    for (let i = 0; i < bp.areas.length; i++) {
        const area = bp.areas[i];
        if (area.areaSegments !== band.segment || area.parentIndex < 0) continue;
        const origin = pos.areas[i];
        if (origin === undefined) continue;
        if (areaHemisphere(area.areaSegments, origin.latitude) !== band.hemisphere)
            continue;
        moveArea(bp, pos, i, band.rowLo);
        area.size.y = span;
        return i;
    }
    // 3) 同段数的根区域（例如刚导入、还没展开过的蓝图）：补成整带
    for (let i = 0; i < bp.areas.length; i++) {
        const area = bp.areas[i];
        if (area.areaSegments !== band.segment || area.parentIndex >= 0) continue;
        const before = pos.areas[i].latitude;
        area.size.y = span;
        // 根区域纬度由 size.y 反推：整带高度解出的就是该带首行
        const after = findPosForAreas(bp.areas).areas[i].latitude;
        shiftAreaFrame(bp, i, after - before);
        return i;
    }
    // 4) 新建
    const parentIndex = pickBandParent(bp, pos, band);
    const parentLat = pos.areas[parentIndex].latitude;
    bp.areas.push({
        index: bp.areas.length,
        parentIndex,
        tropicAnchor: 0,
        areaSegments: band.segment,
        anchorLocalOffset: { x: 0, y: band.rowLo - parentLat },
        size: { x: 1, y: span },
    });
    return bp.areas.length - 1;
}

/**
 * 把"虚拟目标"（`areaIndex = -1`）落到实际区域上：
 * 按需补出该带的区域，再用**新原点**重算局部格 —— 物理位置一格不动。
 *
 * 补区域可能挪动/加高已有区域（见 `ensureCanvasArea`），所以不能假设新原点就是
 * `canvasOrigin(band)`，必须重算，否则落位会与绿盒错开。
 */
export function materializeCanvasTarget(
    bp: BlueprintData,
    target: CanvasTarget
): CanvasTarget {
    const row = target.y + target.origin.latitude;
    const col = target.x + target.origin.longitude;
    const areaIndex = ensureCanvasArea(bp, target.band);
    const origin = findPosForAreas(bp.areas).areas[areaIndex];
    const turn = areaGridSize(target.band.segment);
    return {
        band: target.band,
        areaIndex,
        origin,
        x: wrap(col - origin.longitude, turn),
        y: row - origin.latitude,
    };
}

/** 新区域的父区域：同半球（或赤道带）里段数更大的最近一条带；没有则根区域 */
function pickBandParent(
    bp: BlueprintData,
    pos: PositionedBlueprint,
    band: PlanetBand
): number {
    let best = -1;
    let bestSegment = Infinity;
    for (let i = 0; i < bp.areas.length; i++) {
        const origin = pos.areas[i];
        if (origin === undefined) continue;
        if (origin.segment <= band.segment) continue; // 父区域必须更"赤道"
        const parentBand = bandOfRow(origin.latitude);
        const sameSide =
            parentBand === null ||
            parentBand.hemisphere === 0 ||
            band.hemisphere === 0 ||
            parentBand.hemisphere === band.hemisphere;
        if (!sameSide) continue;
        if (origin.segment < bestSegment) {
            best = i;
            bestSegment = origin.segment;
        }
    }
    if (best >= 0) return best;
    // 没有同半球的合法父区域（理论上根区域总在）→ 用根区域
    for (let i = 0; i < bp.areas.length; i++) {
        if (bp.areas[i].parentIndex < 0) return i;
    }
    return 0;
}

/* ------------------------------------------------------------------------------------------------
 * 内容统计：把建筑端点 / 地基矩形换算成"绝对行 + 带内列"，按纬度带分组。
 * 展开画布与导出收缩共用这一份结果。
 * ---------------------------------------------------------------------------------------------- */

/** 一条带里的一块内容（建筑端点或地基矩形块），坐标都是"该带的格子" */
export interface BandRect {
    rect: BlueprintReformRect;
    /** 绝对行（含） */
    rowLo: number;
    rowHi: number;
    /** 带内列（含） */
    colLo: number;
    colHi: number;
}

export interface BandContent {
    band: PlanetBand;
    /** 建筑端点的绝对位置（带内列，可为分数） */
    points: AbsolutePos[];
    rects: BandRect[];
}

export interface CanvasContent {
    /** 用到的带（赤道带优先，其余按段数从大到小） */
    bands: BandContent[];
    /** 与 `bp.buildings` 同序：每个建筑每个端点的绝对位置 */
    buildingPoints: AbsolutePos[][];
}


/**
 * 把地基矩形按"纬度带 + 经线"拆开：一条矩形不能跨带（该带的经向网格不同），
 * 也不能跨 0 经线（游戏按起始列 + 宽度存储）。
 */
export function splitRectToBands(
    rect: BlueprintReformRect,
    origin: AreaGridOrigin
): BandRect[] {
    if (rect.w <= 0 || rect.h <= 0) return [];
    const fromTurn = areaGridSize(origin.segment);
    const rowStart = origin.latitude + rect.y;
    const rowEnd = rowStart + rect.h - 1;
    // 列的物理范围（用分数，跨带时按分数缩放：经向格子宽度随带变化）
    const fracStart = (origin.longitude + rect.x) / fromTurn;
    const fracEnd = (origin.longitude + rect.x + rect.w) / fromTurn;
    const pieces: BandRect[] = [];
    let row = Math.round(rowStart);
    const last = Math.round(rowEnd);
    while (row <= last) {
        const band = bandOfRow(row);
        if (band === null) return [];
        const rowLo = Math.max(row, band.rowLo);
        const rowHi = Math.min(last, band.rowHi);
        const turn = areaGridSize(band.segment);
        const colStart = Math.round(fracStart * turn);
        const colCount = Math.round(fracEnd * turn) - colStart;
        if (colCount <= 0 || colCount > turn) return [];
        const start = wrap(colStart, turn);
        if (start + colCount <= turn) {
            pieces.push({
                rect,
                rowLo,
                rowHi,
                colLo: start,
                colHi: start + colCount - 1,
            });
        } else {
            const first = turn - start;
            pieces.push({
                rect,
                rowLo,
                rowHi,
                colLo: start,
                colHi: turn - 1,
            });
            pieces.push({
                rect,
                rowLo,
                rowHi,
                colLo: 0,
                colHi: colCount - first - 1,
            });
        }
        row = rowHi + 1;
    }
    return pieces;
}

/**
 * 统计蓝图内容的绝对位置。返回 null 表示有内容越出星球行范围（调用方应放弃重排）。
 */
export function collectCanvasContent(
    bp: BlueprintData,
    pos: PositionedBlueprint
): CanvasContent | null {
    const byBand = new Map<string, BandContent>();
    const bandList: BandContent[] = [];
    const bucket = (band: PlanetBand): BandContent => {
        const key = bandKey(band);
        const hit = byBand.get(key);
        if (hit !== undefined) return hit;
        const entry: BandContent = { band, points: [], rects: [] };
        byBand.set(key, entry);
        bandList.push(entry);
        return entry;
    };
    const buildingPoints: AbsolutePos[][] = [];
    for (const b of bp.buildings) {
        const origin = pos.areas[b.areaIndex];
        if (origin === undefined) return null;
        const points: AbsolutePos[] = [];
        for (const p of b.localOffset) {
            const abs = localToAbs(origin, p);
            const band = bandOfRow(Math.floor(abs.row));
            if (band === null) return null;
            bucket(band).points.push(abs);
            points.push(abs);
        }
        buildingPoints.push(points);
    }
    if (bp.reformData) {
        for (const rect of bp.reformData.rects) {
            const origin = pos.areas[rect.areaIndex];
            if (origin === undefined) return null;
            const pieces = splitRectToBands(rect, origin);
            if (pieces.length === 0) return null;
            for (const piece of pieces) {
                const pieceBand = bandOfRow(piece.rowLo);
                if (pieceBand === null) return null;
                bucket(pieceBand).rects.push(piece);
            }
        }
    }
    // 顺序：赤道带优先，其余按段数从大到小、北半球在前
    bandList.sort((a, b) => {
        if (a.band.hemisphere === 0) return -1;
        if (b.band.hemisphere === 0) return 1;
        return b.band.segment - a.band.segment || b.band.hemisphere - a.band.hemisphere;
    });
    return { bands: bandList, buildingPoints };
}

/** 一条带内容的外接框（行 = 绝对行；列 = 该带格子，可为分数） */
export function bandBBox(content: BandContent): {
    rowLo: number;
    rowHi: number;
    colLo: number;
    colHi: number;
} {
    let rowLo = Infinity;
    let rowHi = -Infinity;
    let colLo = Infinity;
    let colHi = -Infinity;
    for (const p of content.points) {
        rowLo = Math.min(rowLo, p.row);
        rowHi = Math.max(rowHi, p.row);
        const col = p.lonFrac * areaGridSize(content.band.segment);
        colLo = Math.min(colLo, col);
        colHi = Math.max(colHi, col);
    }
    for (const r of content.rects) {
        rowLo = Math.min(rowLo, r.rowLo);
        rowHi = Math.max(rowHi, r.rowHi);
        colLo = Math.min(colLo, r.colLo);
        colHi = Math.max(colHi, r.colHi);
    }
    return { rowLo, rowHi, colLo, colHi };
}

/** 该带内的经向列区间（用于算最小覆盖弧；地基矩形整段算一个区间） */
export function bandColumnRanges(
    content: BandContent
): { lo: number; hi: number }[] {
    const ranges: { lo: number; hi: number }[] = [];
    const turn = areaGridSize(content.band.segment);
    for (const p of content.points) {
        const col = snap(p.lonFrac * turn);
        ranges.push({ lo: col, hi: col });
    }
    for (const r of content.rects) ranges.push({ lo: r.colLo, hi: r.colHi });
    return ranges;
}

/**
 * 把蓝图重排成全球画布（一条带一个区域）。返回 false = 无需/无法展开（保留原区域）。
 *
 * - 根区域恒为赤道带，其余带按段数从大到小挂成链；
 * - 所有建筑的**绝对位置（纬度行 + 经线）保持不变**，只有局部格随新原点改写；
 * - 这是编辑模式的入口动作，导出时由 `normalizeBlueprintAreas` 再收缩回紧凑区域。
 */
export function expandToGlobalCanvas(bp: BlueprintData): boolean {
    if (bp.canvasExpanded || bp.areas.length === 0) return false;
    let pos: PositionedBlueprint;
    try {
        pos = findPosForAreas(bp.areas);
    } catch {
        return false;
    }
    const content = collectCanvasContent(bp, pos);
    if (content === null || content.bands.length === 0) return false;
    const equator = equatorBand();
    if (!content.bands.some((c) => c.band.hemisphere === 0)) {
        // 内容不在赤道带：也要补一个（空的）赤道带根区域，才能覆盖全球
        content.bands.unshift({ band: equator, points: [], rects: [] });
    }
    const indexOfBand = new Map<string, number>();
    content.bands.forEach((c, i) => indexOfBand.set(bandKey(c.band), i));

    // ---- 区域表（先算尺寸，再算父子锚点）----
    const boxes = content.bands.map((c) => bandBBox(c));
    const areas: BlueprintArea[] = content.bands.map((c, i) => {
        const isRoot = c.band.hemisphere === 0;
        const colHi = boxes[i].colHi;
        const sizeX = Math.max(
            isRoot ? 10 : 1,
            Number.isFinite(colHi) ? Math.ceil(colHi) + 1 : 1
        );
        return {
            index: i,
            parentIndex: -1,
            tropicAnchor: 0,
            areaSegments: c.band.segment,
            anchorLocalOffset: { x: 0, y: 0 },
            size: { x: sizeX, y: bandSpan(c.band) },
        };
    });
    const latOf = content.bands.map((c) => c.band.rowLo);
    for (let i = 0; i < areas.length; i++) {
        if (content.bands[i].band.hemisphere === 0) continue;
        const parent = pickExportParent(content.bands, i);
        areas[i].parentIndex = parent;
        areas[i].anchorLocalOffset.y = latOf[i] - latOf[parent];
    }

    // ---- 建筑：按端点所在带落到对应区域（z = 高度格，原样保留）----
    const origins = content.bands.map((c) => canvasOrigin(c.band));
    const buildings: BlueprintBuilding[] = bp.buildings.map((b, bi) => {
        const points = content.buildingPoints[bi];
        const firstBand = bandOfRow(Math.floor(points[0].row));
        const areaIndex =
            firstBand === null ? 0 : indexOfBand.get(bandKey(firstBand)) ?? 0;
        return mapBuildingPoints(b, areaIndex, (p, i) => ({
            ...absToLocal(origins[areaIndex], points[i]),
            z: p.z,
        }));
    });

    // ---- 地基：按"带 + 经线"拆块后落到对应区域 ----
    let reformData = bp.reformData;
    if (reformData != null) {
        const rects: BlueprintReformRect[] = [];
        for (const c of content.bands) {
            const index = indexOfBand.get(bandKey(c.band)) ?? 0;
            const origin = origins[index];
            for (const piece of c.rects) {
                rects.push({
                    ...piece.rect,
                    x: piece.colLo,
                    y: piece.rowLo - origin.latitude,
                    w: piece.colHi - piece.colLo + 1,
                    h: piece.rowHi - piece.rowLo + 1,
                    areaIndex: index,
                });
            }
        }
        reformData = { ...reformData, rects };
    }

    bp.areas = areas;
    bp.buildings = buildings;
    bp.reformData = reformData;
    bp.primaryAreaIdx = 0;
    bp.cursorTargetArea = 0;
    bp.cursorOffset = {
        x: Math.floor(areas[0].size.x / 2),
        y: Math.floor(areas[0].size.y / 2),
    };
    bp.canvasExpanded = true;
    return true;
}

/** 导出用的父区域：同半球里段数更大的最近一条带，否则赤道带（下标 0） */
function pickExportParent(bands: BandContent[], index: number): number {
    const band = bands[index].band;
    let best = -1;
    let bestSegment = Infinity;
    for (let i = 0; i < bands.length; i++) {
        const other = bands[i].band;
        if (other.segment <= band.segment) continue;
        if (other.hemisphere !== 0 && other.hemisphere !== band.hemisphere)
            continue;
        if (other.segment < bestSegment) {
            best = i;
            bestSegment = other.segment;
        }
    }
    return best >= 0 ? best : 0;
}

/**
 * 单区域蓝图的漂移原点（`findPosForAreas` 对"没有子区域的根区域"的推法）：
 * 带中心 − size.y / 2 向上取整。
 */
export function singleAreaLatitude(segment: number, sizeY: number): number {
    const range = planetBandGridRange(segment);
    return Math.ceil((range.lo + range.hi) / 2 - sizeY / 2);
}
