import { Euler, Matrix4 } from "three";
import { BlueprintArea, BlueprintBuilding } from "./parser";

const segmentArr: [number, number][] = [
    [0, 1],
    [1, 4],
    [8, 8],
    [16, 16],
    [20, 20],
    [28, 32],
    [40, 40],
    [54, 60],
    [73, 80],
    [91, 100],
    [114, 120],
    [140, 160],
    [177, 200],
    [Infinity, Infinity],
];

const segmentMap = new Map<number, number>();

for (let i = 0; i < segmentArr.length - 1; i++) {
    segmentMap.set(segmentArr[i][1], i);
}

const GRID_PER_SEGMENT = 5;

function calcLatitudeSeg(seg: number, maxSegment = 200) {
    const latitude = Math.acos(seg / maxSegment);
    const radPerSeg = (2 * Math.PI) / maxSegment;
    return Math.ceil(latitude / radPerSeg);
}

function planetAreaByIndex(i: number, segment = 200) {
    const [minSeg, longitudeSeg] = segmentArr[i];
    const maxSeg = segmentArr[i + 1][0];
    const maxLatitudeSeg = calcLatitudeSeg(minSeg, segment);
    const minLatitudeSeg =
        maxSeg >= segment ? -maxLatitudeSeg : calcLatitudeSeg(maxSeg, segment);
    const latitudeSeg = maxLatitudeSeg - minLatitudeSeg;
    return {
        minLatitudeSeg,
        latitudeSeg,
        longitudeSeg,
    };
}

export function* gridAreas(segment = 200) {
    for (let i = 1; i < segmentArr.length - 1; i++) {
        const seg = planetAreaByIndex(i, segment);
        yield seg;
        if (seg.minLatitudeSeg > 0) {
            // cross the equator
            yield {
                minLatitudeSeg: -seg.minLatitudeSeg,
                latitudeSeg: -seg.latitudeSeg,
                longitudeSeg: seg.longitudeSeg,
            };
        }
    }
}

function planetAreaByLongitudeSegment(segment: number, maxSegment = 200) {
    const idx = segmentMap.get(segment);
    if (idx === undefined)
        throw new Error(
            `Area with ${segment} segments not found on a ${maxSegment} segments planet.`
        );
    return planetAreaByIndex(idx, maxSegment);
}

/** 该 segment 是否是本星球上存在的一条纬度带（= 区域 `areaSegments` 的合法取值） */
export function hasPlanetBand(segment: number) {
    return segmentMap.get(segment) !== undefined;
}

/** 纬度带在星球上的绝对纬向格范围（全星球 1000 格/圈口径） */
export interface PlanetBandGridRange {
    /** 下界（含） */
    lo: number;
    /** 上界（含）：与相邻带共享的边界行也算在本带内（游戏自己的赤道带蓝图 size.y=161 覆盖 [-80, 80]） */
    hi: number;
    /** 带中心格（上下界不对称时可能带 .5） */
    center: number;
    /** 该带的经向段数（= 落在该带里的区域的 `areaSegments`） */
    longitudeSeg: number;
}

/**
 * `planetAreaByLongitudeSegment` 的"按格"版本：纬度段的 1 段 = 5 格。
 *
 * 赤道带（segment=200）→ `[-80, 80]`，共 161 格，与 `createEmptyBlueprint` 的 `size.y=161`
 * 以及游戏自己保存的整带蓝图一致；160 段带 → `[80, 130]`（中心 105）。
 */
export function planetBandGridRange(
    segment: number,
    maxSegment = 200
): PlanetBandGridRange {
    const info = planetAreaByLongitudeSegment(segment, maxSegment);
    const lo = info.minLatitudeSeg * GRID_PER_SEGMENT;
    const hi = (info.minLatitudeSeg + info.latitudeSeg) * GRID_PER_SEGMENT;
    return {
        lo,
        hi,
        center: (lo + hi) / 2,
        longitudeSeg: info.longitudeSeg,
    };
}

/* ------------------------------------------------------------------------------------------------
 * 全球纬度带表
 *
 * 星球按经向网格分辨率分成若干纬度带：同一条带里所有纬度行的经向段数相同，
 * 区域元数据只用一个 `areaSegments` 描述它属于哪条带 —— 这就是**一个 blueprint area
 * 不能跨纬度带**的原因（`findPosForAreas` 也要求子区域段数严格小于父区域）。
 * 要在全球任意位置放建筑，只能一条带一个区域。
 * ---------------------------------------------------------------------------------------------- */

/** 本星球上存在的全部经向段数（= 区域 `areaSegments` 的合法取值，从赤道向两极排列） */
export const PLANET_SEGMENTS: readonly number[] = (() => {
    const segments: number[] = [];
    for (let i = segmentArr.length - 2; i >= 1; i--) segments.push(segmentArr[i][1]);
    return segments;
})();

/** 一条纬度带：经向段数 + 半球 + 规范纬向行（含上下界） */
export interface PlanetBand {
    /** 该带的经向段数（= 该带里区域的 `areaSegments`） */
    segment: number;
    /** 0 = 赤道带（跨南北半球）；1 = 北半球；-1 = 南半球 */
    hemisphere: -1 | 0 | 1;
    /** 该带占用的起始行（含）= 该带区域原点的规范纬度 */
    rowLo: number;
    /** 该带占用的结束行（含） */
    rowHi: number;
}

const bandCache = new Map<number, PlanetBand[]>();

/**
 * 全球纬度带表（赤道带 → 中纬 → 极区，南北对称）。
 *
 * 行的划分与游戏自带蓝图的取法一致：赤道带 = `planetBandGridRange(200)` 的 `[-80, 80]`
 * （161 行，正是游戏整赤道带蓝图 `size.y`），其余每条带取 `[lo + 1, hi]`，即去掉与下一条带
 * 共享的那一行边界（`calcLatitudeSeg` 的 ceil 会让相邻带的原始区间在边界行重叠）。
 * 于是：
 * - 任意一行都**唯一**属于一条带（`bandOfRow`），区域之间不会互相压住对方的格子；
 * - 北半球 81..250、南半球 -250..-81 逐行铺满，极区最后一带 `4 段 → [246, 250]`。
 *
 * 已知（见 docs/wiki/modules/blueprint-core.md 的「全球画布与区域模型」）：`segment=1` 的极点带在该模型下
 * `latitudeSeg` 为 0（高度为零），故全球画布只到 `segment=4` 那条带。
 */
export function planetBands(maxSegment = 200): PlanetBand[] {
    const cached = bandCache.get(maxSegment);
    if (cached !== undefined) return cached;
    const bands: PlanetBand[] = [];
    let northLo = 0;
    for (const segment of PLANET_SEGMENTS) {
        if (segment > maxSegment) continue;
        const range = planetBandGridRange(segment, maxSegment);
        if (segment === maxSegment) {
            // 赤道带：本身跨赤道，上下贯通
            bands.push({
                segment,
                hemisphere: 0,
                rowLo: range.lo,
                rowHi: range.hi,
            });
            northLo = range.hi + 1;
            continue;
        }
        const span = range.hi - range.lo; // 该带原始高度（= 规范高度）
        bands.push({
            segment,
            hemisphere: 1,
            rowLo: northLo,
            rowHi: northLo + span - 1,
        });
        bands.push({
            segment,
            hemisphere: -1,
            rowLo: -(northLo + span - 1),
            rowHi: -northLo,
        });
        northLo += span;
    }
    bandCache.set(maxSegment, bands);
    return bands;
}

/** 该纬向行属于哪条带（绝对纬度行，1000 格/圈口径）；越出星球返回 null */
export function bandOfRow(row: number, maxSegment = 200): PlanetBand | null {
    const r = Math.round(row);
    for (const band of planetBands(maxSegment)) {
        if (r >= band.rowLo && r <= band.rowHi) return band;
    }
    return null;
}

/** 按经向段数 + 半球取带（赤道带的 hemisphere 为 0） */
export function bandBySegment(
    segment: number,
    hemisphere: -1 | 0 | 1,
    maxSegment = 200
): PlanetBand | null {
    for (const band of planetBands(maxSegment)) {
        if (band.segment === segment && band.hemisphere === hemisphere)
            return band;
    }
    return null;
}

/** 该带整带高度（行数）；编辑期区域的 `size.y` 用它，于是带内每一行都能放 */
export function bandSpan(band: PlanetBand): number {
    return band.rowHi - band.rowLo + 1;
}

/** 星球纬度行范围（|row| ≤ 该值） */
export function planetRowLimit(maxSegment = 200): number {
    const bands = planetBands(maxSegment);
    return bands.reduce((m, b) => Math.max(m, Math.abs(b.rowLo), Math.abs(b.rowHi)), 0);
}

function gcd(a: number, b: number) {
    while (b !== 0) {
        const c = a % b;
        a = b;
        b = c;
    }
    return a;
}

function lcm(a: number, b: number) {
    return (a * b) / gcd(a, b);
}

export interface PositionedBlueprint {
    segment: number;
    areas: {
        longitude: number;
        latitude: number;
        segment: number;
    }[];
}

export function findPosForAreas(
    areas: BlueprintArea[],
    segment = 200
): PositionedBlueprint {
    let root = -1;
    const adjList = areas.map(() => [] as number[]);
    for (let i = 0; i < areas.length; i++) {
        const a = areas[i];
        if (a.parentIndex >= 0) {
            adjList[a.parentIndex].push(i);
        } else {
            root = i;
        }
    }
    if (root === -1) throw new Error("No root area found.");

    const gridCount = areas.map((a) => a.areaSegments * GRID_PER_SEGMENT);
    const longitudeBase = gridCount.reduce(lcm);
    const gridSize = gridCount.map((c) => longitudeBase / c);
    const period = gridSize.reduce(lcm);

    const pos: PositionedBlueprint = {
        segment: segment,
        areas: areas.map((a) => ({
            longitude: NaN,
            latitude: NaN,
            segment: a.areaSegments,
        })),
    };
    const findLongitude = () => {
        const validateArea = (i: number, longitude: number) => {
            for (const j of adjList[i]) {
                const a2 = areas[j];
                const anchor = longitude + a2.tropicAnchor * gridSize[i];
                if (
                    anchor % gridSize[j] !== 0 ||
                    !validateArea(
                        j,
                        anchor - a2.anchorLocalOffset.x * gridSize[j]
                    )
                )
                    return false;
            }
            pos.areas[i].longitude = longitude / gridSize[i];
            return true;
        };
        for (let l = 0; l < period; l += gridSize[root]) {
            if (validateArea(root, l)) return;
        }
        throw new Error("No suitable longitude found.");
    };
    findLongitude();

    const findRootLatitude = () => {
        let onHighTropic = false,
            onLowTropic = false,
            inPositiveHemisphere = false,
            inNegativeHemisphere = false;
        const a1 = areas[root];
        const planetAreaInfo = planetAreaByLongitudeSegment(
            a1.areaSegments,
            segment
        );
        for (const j of adjList[root]) {
            const a2 = areas[j];
            if (a2.areaSegments === a1.areaSegments)
                throw new Error(
                    `Area ${j} has the same segments as its parent`
                );
            if (a2.anchorLocalOffset.y === 0)
                throw new Error(`Area ${j} unexpected anchorLocalOffsetY == 0`);

            if (a2.areaSegments < a1.areaSegments) {
                onHighTropic = true;
                if (a2.anchorLocalOffset.y > 0) inPositiveHemisphere = true;
                else inNegativeHemisphere = true;
            } else {
                onLowTropic = true;
                if (a2.anchorLocalOffset.y < 0) inPositiveHemisphere = true;
                else inNegativeHemisphere = true;
            }
        }
        let latitude = NaN;
        if (onLowTropic)
            // Should not be possible in current game version
            latitude = planetAreaInfo.minLatitudeSeg * GRID_PER_SEGMENT + 1;
        else if (onHighTropic)
            latitude =
                (planetAreaInfo.minLatitudeSeg + planetAreaInfo.latitudeSeg) *
                    GRID_PER_SEGMENT -
                a1.size.y +
                1;
        else
            latitude =
                Math.ceil(
                    (planetAreaInfo.minLatitudeSeg +
                        planetAreaInfo.latitudeSeg / 2) *
                        GRID_PER_SEGMENT -
                        a1.size.y / 2
                ) | 0;

        if (!inPositiveHemisphere && inNegativeHemisphere)
            latitude = -latitude - a1.size.y + 1;
        return latitude;
    };
    pos.areas[root].latitude = findRootLatitude();
    const calcChildAreaLatitude = (i: number) => {
        for (const j of adjList[i]) {
            pos.areas[j].latitude =
                pos.areas[i].latitude + areas[j].anchorLocalOffset.y;
            calcChildAreaLatitude(j);
        }
    };
    calcChildAreaLatitude(root);

    return pos;
}

/** 高度格 → 世界单位（`localOffset[].z` 的换算系数；分流器的上下层口差 1 格 ≈ 1.33 单位） */
export const HEIGHT_GRID_SIZE = 4 / 3;

const temp = new Matrix4();
const rotation = new Euler();
export function calcBuildingTrans(
    R: number,
    pos: PositionedBlueprint,
    building: BlueprintBuilding
) {
    const area = pos.areas[building.areaIndex];
    // 区域缺失时不要让它变成 "reading 'segment' of undefined" 这种无信息异常：
    // 场景重建失败会把整层模型替换掉（见 BlueprintEditor 的原子替换），报错信息要能定位到建筑
    if (area === undefined)
        throw new Error(
            `建筑 ${building.index} 引用了不存在的区域 ${building.areaIndex}` +
                `（当前区域数 ${pos.areas.length}）`
        );
    const longitudeGridSize = (2 * Math.PI) / area.segment / GRID_PER_SEGMENT;
    const latitudeGridSize = (2 * Math.PI) / pos.segment / GRID_PER_SEGMENT;

    const partTrans = (i: number) => {
        const longitude =
            (area.longitude + building.localOffset[i].x) * longitudeGridSize;
        const latitude =
            (area.latitude + building.localOffset[i].y) * latitudeGridSize;
        const height = R + building.localOffset[i].z * HEIGHT_GRID_SIZE;

        rotation.set(
            -latitude,
            longitude,
            (-building.yaw[i] / 180.0) * Math.PI,
            "YXZ"
        );
        const trans = new Matrix4();
        trans.makeTranslation(0, 0, height);
        trans.premultiply(temp.makeRotationFromEuler(rotation));
        return trans;
    };

    return building.localOffset.map((_v, i) => partTrans(i));
}
