import {
    BlueprintArea,
    BlueprintData,
    BlueprintReformRect,
} from "./parser";
import {
    absToLocal,
    AreaGridOrigin,
    areaGridSize,
    bandBBox,
    bandColumnRanges,
    BandContent,
    collectCanvasContent,
    equatorBand,
    localToAbs,
    mapBuildingPoints,
    singleAreaLatitude,
} from "./globe";
import {
    bandOfRow,
    bandSpan,
    findPosForAreas,
    planetBandGridRange,
    PositionedBlueprint,
} from "./planet";

export { planetToLocal, localToPlanet, ROOT_GRID_SIZE } from "./globe";
export type { AreaGridOrigin } from "./globe";

function wrap(x: number, turn: number): number {
    return ((x % turn) + turn) % turn;
}

/**
 * 环形坐标上的最小覆盖弧：所有内容列区间 + 最大间隙的补集（左右各留 1 格）。
 *
 * 与旧实现（收集所有格点、找最大间隙）等价，但用区间表示：几千格宽的照片地基
 * 只按矩形块参与计算，不会被展开成几十万个点。
 */
function minCoverArc(
    ranges: { lo: number; hi: number }[],
    turn: number
): { originX: number; sizeX: number } {
    if (ranges.length === 0) return { originX: 0, sizeX: 1 };
    const sorted = [...ranges].sort((a, b) => a.lo - b.lo);
    const merged: { lo: number; hi: number }[] = [];
    for (const r of sorted) {
        const last = merged[merged.length - 1];
        if (last !== undefined && r.lo <= last.hi + 1) {
            last.hi = Math.max(last.hi, r.hi);
        } else {
            merged.push({ lo: r.lo, hi: r.hi });
        }
    }
    let maxGap = -1;
    let arcStart = 0;
    for (let i = 0; i < merged.length; i++) {
        const nextLo =
            i + 1 < merged.length
                ? merged[i + 1].lo
                : merged[0].lo + turn;
        const gap = nextLo - merged[i].hi;
        if (gap > maxGap) {
            maxGap = gap;
            arcStart = nextLo;
        }
    }
    const originX = Math.floor(arcStart) - 1;
    const sizeX = Math.max(
        1,
        Math.floor(arcStart + (turn - maxGap)) - originX + 2
    );
    return { originX, sizeX };
}

/** 经向区间平移后可能跨 0 经线 → 拆成两段 */
function shiftCols(
    colLo: number,
    w: number,
    shift: number,
    turn: number
): { x: number; w: number }[] {
    if (w <= 0) return [];
    const start = wrap(colLo - shift, turn);
    if (start + w <= turn) return [{ x: start, w }];
    const first = turn - start;
    return [
        { x: start, w: first },
        { x: 0, w: w - first },
    ];
}

/**
 * 导出前归一化：把编辑画布（一条带一个区域、整带高度）收缩成游戏惯例的紧凑区域，
 * 让蓝图在游戏里既能粘贴又能整带移动。不修改入参。
 *
 * - **只用了一条带** → 导出单个区域（紧凑边界框 + 居中约束下的原点纬度），与旧实现一致：
 *   这种蓝图在游戏里能在该带内自由移动；
 * - **跨多条带** → 赤道带为根 + 每条带一个区域（链式锚点）。多带蓝图的绝对纬度由区域
 *   元数据唯一确定（每条带只能占自己的行），所以它在游戏里只能贴在导出时的纬度上 ——
 *   这正是"全球任意位置放置"的语义。
 *
 * 触发条件：工具自建蓝图（`dragBoxSize` 为 0）或进过编辑器（`canvasExpanded`）。
 * 纯导入未编辑的蓝图原样返回，保持字节级 round-trip；新建画布只铺了地基（没有建筑）时
 * 也沿用旧行为不收缩 —— 地基矩形本身就是紧凑的，改动它们只会破坏字节级对照。
 */
export function normalizeBlueprintAreas(bp: BlueprintData): BlueprintData {
    const legacy = bp.dragBoxSize.x === 0 && bp.dragBoxSize.y === 0;
    if (!bp.canvasExpanded) {
        if (!legacy) return bp;
        if (bp.buildings.length === 0) return bp;
    }
    const rects = bp.reformData?.rects ?? [];
    if (bp.buildings.length === 0 && rects.length === 0) return bp;
    let pos: PositionedBlueprint;
    try {
        pos = findPosForAreas(bp.areas);
    } catch {
        return bp;
    }
    const content = collectCanvasContent(bp, pos);
    if (content === null || content.bands.length === 0) return bp;
    if (content.bands.length === 1)
        return compactSingleArea(bp, pos, content.bands[0]);
    return compactMultiArea(bp, pos, content.bands);
}

/** 单区域导出：紧凑边界框 + 居中约束下的原点纬度（游戏里可在该带内移动） */
function compactSingleArea(
    bp: BlueprintData,
    pos: PositionedBlueprint,
    content: BandContent
): BlueprintData {
    const band = content.band;
    const turn = areaGridSize(band.segment);
    const box = bandBBox(content);
    const wantLo = Math.floor(box.rowLo) - 1;
    const wantHi = Math.ceil(box.rowHi) + 1;
    const maxSizeY = bandSpan(band);
    const minSizeY = Math.max(1, wantHi - wantLo + 1);
    let sizeY = -1;
    let lat = band.rowLo;
    for (let y = minSizeY; y <= maxSizeY; y++) {
        const l = singleAreaLatitude(band.segment, y);
        if (l <= wantLo && l + y - 1 >= wantHi) {
            sizeY = y;
            lat = l;
            break;
        }
    }
    if (sizeY < 0) {
        sizeY = maxSizeY;
        lat = singleAreaLatitude(band.segment, sizeY);
    }
    const { originX, sizeX } = minCoverArc(bandColumnRanges(content), turn);

    const buildings = bp.buildings.map((b) => {
        const old = pos.areas[b.areaIndex];
        return mapBuildingPoints(b, 0, (p) => {
            const abs = localToAbs(old, p);
            return {
                x: wrap(abs.lonFrac * turn - originX, turn),
                y: abs.row - lat,
                z: p.z,
            };
        });
    });

    let reformData = bp.reformData;
    if (reformData != null) {
        const rects: BlueprintReformRect[] = [];
        for (const piece of content.rects) {
            const cols = shiftCols(
                piece.colLo,
                piece.colHi - piece.colLo + 1,
                originX,
                turn
            );
            for (const c of cols) {
                rects.push({
                    ...piece.rect,
                    x: c.x,
                    y: piece.rowLo - lat,
                    w: c.w,
                    h: piece.rowHi - piece.rowLo + 1,
                    areaIndex: 0,
                });
            }
        }
        reformData = { ...reformData, rects };
    }

    return {
        ...bp,
        cursorOffset: { x: Math.floor(sizeX / 2), y: Math.floor(sizeY / 2) },
        cursorTargetArea: 0,
        dragBoxSize: { x: sizeX, y: sizeY },
        primaryAreaIdx: 0,
        areas: [
            {
                index: 0,
                parentIndex: -1,
                tropicAnchor: 0,
                areaSegments: band.segment,
                anchorLocalOffset: { x: 0, y: 0 },
                size: { x: sizeX, y: sizeY },
            },
        ],
        buildings,
        reformData,
    };
}

/**
 * 多带导出：**根区域必须是整棵区域树里最靠赤道的那个**（子区域段数必须严格更小）。
 *
 * - 内容跨南北半球（或赤道带本身有内容）→ 根 = 赤道带（整带高度，纬度恒 -80），
 *   即使赤道带没有建筑也补一个空区域，否则南北两侧同段数的两个区域互相无法挂载；
 * - 内容只在单侧（例如都在北半球）→ 根 = 该侧段数最大的那条带，纬度按"贴边"推法
 *   （`rawHi - size.y + 1`）确定，尺寸一直延伸到该带边界，子区域锚点随之换算。
 *
 * 子区域挂到同半球里段数更大的最近一条带，`anchorLocalOffset.y` = 本带原点行 − 父区域纬度。
 */
function compactMultiArea(
    bp: BlueprintData,
    pos: PositionedBlueprint,
    bands: BandContent[]
): BlueprintData {
    const equator = bands.find((c) => c.band.hemisphere === 0);
    const others = bands.filter((c) => c.band.hemisphere !== 0);
    const sides = new Set(others.map((c) => c.band.hemisphere));
    let ordered: BandContent[];
    if (equator !== undefined || sides.size !== 1) {
        ordered = [
            equator ?? { band: equatorBand(), points: [], rects: [] },
            ...others,
        ];
    } else {
        // 单侧内容：最靠赤道的带直接当根（兄弟区域同号，根区域按"贴边"定位）
        const maxSegment = Math.max(...others.map((c) => c.band.segment));
        const root = others.find((c) => c.band.segment === maxSegment)!;
        ordered = [root, ...others.filter((c) => c !== root)];
    }

    const boxes = ordered.map((c) => bandBBox(c));
    const latOf: number[] = [];
    const areas: BlueprintArea[] = [];
    for (let i = 0; i < ordered.length; i++) {
        const band = ordered[i].band;
        const isRoot = i === 0;
        const box = boxes[i];
        const sizeX = Number.isFinite(box.colHi)
            ? Math.max(1, Math.ceil(box.colHi) + 2)
            : 1;
        const span = Number.isFinite(box.rowLo)
            ? Math.ceil(box.rowHi) - Math.floor(box.rowLo) + 1
            : 1;
        let sizeY: number;
        let lat: number;
        if (isRoot) {
            const raw = planetBandGridRange(band.segment);
            if (band.hemisphere === 0) {
                // 整条赤道带：size.y=161 时无论有没有子区域，findPosForAreas 都解出 -80
                sizeY = bandSpan(band);
                lat = band.rowLo;
            } else if (band.hemisphere === 1) {
                // 有正锚点子区域 → 根区域上边界钉在带顶：lat = rawHi - size.y + 1
                const wantedLo = Math.floor(box.rowLo) - 1;
                sizeY = Math.min(
                    bandSpan(band),
                    Math.max(span + 2, raw.hi - wantedLo + 1)
                );
                lat = raw.hi - sizeY + 1;
            } else {
                // 只有负锚点子区域 → 根区域下边界钉在带底：lat = -rawHi
                lat = -raw.hi;
                sizeY = Math.min(
                    bandSpan(band),
                    Math.max(span + 2, Math.ceil(box.rowHi) + raw.hi + 2)
                );
            }
        } else {
            const wantLo = Math.floor(box.rowLo) - 1;
            sizeY = Math.max(1, Math.min(bandSpan(band), span + 2));
            lat = Math.max(band.rowLo, Math.min(wantLo, band.rowHi - sizeY + 1));
        }
        latOf.push(lat);
        areas.push({
            index: i,
            parentIndex: -1,
            tropicAnchor: 0,
            areaSegments: band.segment,
            anchorLocalOffset: { x: 0, y: 0 },
            size: { x: sizeX, y: sizeY },
        });
    }
    // 链式锚点：父区域 = 同半球里段数更大（更靠赤道）的最近一条带，否则根区域
    for (let i = 1; i < ordered.length; i++) {
        const band = ordered[i].band;
        let parent = 0;
        let bestSegment = Infinity;
        for (let j = 0; j < ordered.length; j++) {
            const other = ordered[j].band;
            if (other.segment <= band.segment) continue;
            if (other.hemisphere !== 0 && other.hemisphere !== band.hemisphere)
                continue;
            if (other.segment < bestSegment) {
                bestSegment = other.segment;
                parent = j;
            }
        }
        areas[i].parentIndex = parent;
        areas[i].anchorLocalOffset.y = latOf[i] - latOf[parent];
    }

    const indexOfBand = new Map<string, number>();
    ordered.forEach((c, i) =>
        indexOfBand.set(`${c.band.segment}/${c.band.hemisphere}`, i)
    );
    const buildingArea = (row: number): number => {
        const band = bandOfRow(Math.floor(row));
        if (band === null) return 0;
        return indexOfBand.get(`${band.segment}/${band.hemisphere}`) ?? 0;
    };
    const buildings = bp.buildings.map((b) => {
        const firstAbs = localToAbs(pos.areas[b.areaIndex], b.localOffset[0]);
        const areaIndex = buildingArea(firstAbs.row);
        const target: AreaGridOrigin = {
            latitude: latOf[areaIndex],
            longitude: 0,
            segment: ordered[areaIndex].band.segment,
        };
        return mapBuildingPoints(b, areaIndex, (p) => {
            const abs = localToAbs(pos.areas[b.areaIndex], p);
            return { ...absToLocal(target, abs), z: p.z };
        });
    });

    let reformData = bp.reformData;
    if (reformData != null) {
        const rects: BlueprintReformRect[] = [];
        for (const c of ordered) {
            const areaIndex =
                indexOfBand.get(`${c.band.segment}/${c.band.hemisphere}`) ?? 0;
            for (const piece of c.rects) {
                rects.push({
                    ...piece.rect,
                    x: piece.colLo,
                    y: piece.rowLo - latOf[areaIndex],
                    w: piece.colHi - piece.colLo + 1,
                    h: piece.rowHi - piece.rowLo + 1,
                    areaIndex,
                });
            }
        }
        reformData = { ...reformData, rects };
    }

    let minRow = Infinity;
    let maxRow = -Infinity;
    let maxSizeX = 1;
    boxes.forEach((box, i) => {
        if (Number.isFinite(box.rowLo)) minRow = Math.min(minRow, box.rowLo);
        if (Number.isFinite(box.rowHi)) maxRow = Math.max(maxRow, box.rowHi);
        maxSizeX = Math.max(maxSizeX, areas[i].size.x);
    });
    const centerRow = Number.isFinite(minRow)
        ? Math.round((minRow + maxRow) / 2)
        : latOf[0];
    const cursorY = Math.max(
        0,
        Math.min(centerRow - latOf[0], areas[0].size.y - 1)
    );

    return {
        ...bp,
        cursorOffset: { x: Math.floor(areas[0].size.x / 2), y: cursorY },
        cursorTargetArea: 0,
        dragBoxSize: {
            x: maxSizeX,
            y: Math.max(1, Number.isFinite(maxRow) ? maxRow - minRow + 3 : 1),
        },
        primaryAreaIdx: 0,
        areas,
        buildings,
        reformData,
    };
}
