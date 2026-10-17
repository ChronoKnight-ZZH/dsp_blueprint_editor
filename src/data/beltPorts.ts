/**
 * 建筑"传送带口"表（局部坐标：相对建筑中心，建筑 yaw=0 时）。
 *
 * 与 `buildingSlots`（分拣器用的 slot 表）是**同一批游戏 slot**，但本表是**按传送带连接样本**
 * 标定的：下标即游戏 slot 编号，未标定的 slot 为 null。
 *
 * 标定来源（真实游戏蓝图；`带.outputObjIdx/inputFromSlot = 建筑index` 的连接，
 * 见 tests/tools/genBeltPorts.ts）：
 * - tests/tools/传送带连接建筑_串联.txt（0.10.35）：集装机 / 分馏塔 / 储液罐 / 四向分流器 /
 *   能量枢纽 / 射线接收站 / 物流运输站 2103 / 星际物流运输站 2104
 * - tests/tools/物流塔连接传送带.txt（0.10.35）：两个物流站的 12 个口
 * - tests/unit/blueprint/fixtures/*.txt（same_buildings_v2 / sample_outpost_ils /
 *   sample_throughput / dense_splitters_v1 / facilities_with_foundation_320 / starting_base_01029）
 *
 * 表内约定：
 * - `x` 为**赤道基准**值（经向格宽 ∝ cos(纬度)，与 `buildingSlots` 同约定）；`y`、`z` 为原始格。
 * - `nx/ny` 是口的**朝外法线**（网格轴向单位向量）：传送带必须沿该方向离开口（取出），
 *   或沿其反方向进入口（送入）——真实蓝图里带端 yaw 与此逐条一致。
 * - `z` 是口的高度格：分流器的 4 个口分两层（十字形 38 的两条直通口 z=0、两条分支口 z=1；
 *   一字形 39 与十字加强 40 的对应关系不同），接到 z≠0 的口时整条带都在该高度
 *   （样本里 z=1 的带全部格子 z=1.000）。
 *
 * 未列入本表的建筑（如储物仓 / 熔炉 / 制造台 / 研究站等）退回 `buildingSlots`
 * 的同名 slot 作为口坐标、用面分组求法线——它们是同一批游戏 slot，但**尚未逐条用
 * 传送带样本校验**，属于近似（见 {@link getBeltPorts}）。
 */

import { getBuildingSlots, slotFaceOf } from "./buildingSlots";

export interface BeltPort {
    /** 口的局部 x（赤道基准，经向格） */
    x: number;
    /** 口的局部 y（纬向格） */
    y: number;
    /** 口的高度（高度格，0 = 地面层） */
    z: number;
    /** 朝外法线的 x 分量（-1/0/1） */
    nx: number;
    /** 朝外法线的 y 分量（-1/0/1） */
    ny: number;
}

/** 口表：下标 = slot 编号 */
export type BeltPortTable = (BeltPort | null)[];

/** [slot, x, y, z, nx, ny] */
type PortRow = [number, number, number, number, number, number];

function tableOf(rows: PortRow[]): BeltPortTable {
    const out: BeltPortTable = [];
    for (const [slot, x, y, z, nx, ny] of rows) out[slot] = { x, y, z, nx, ny };
    for (let i = 0; i < out.length; i++)
        if (out[i] === undefined) out[i] = null;
    return out;
}

/**
 * 四向分流器 (2020) 三个形态各 4 个口。**两层高度**：
 * - 38（十字）：0/2 在 z=0，1/3 在 z=1
 * - 39（一字）：0/2 在 z=0，1/3 在 z=1（同面两口 → 一口在地面、一口在上一层）
 * - 40（十字加强）：1/3 在 z=0，0/2 在 z=1
 */
const splitter38 = tableOf([
    [0, 0, 0.2, 0, 0, 1],
    [1, 0.21, 0, 0, 1, 0],
    [2, 0, -0.2, 0, 0, -1],
    [3, -0.21, 0, 0, -1, 0],
]);
const splitter39 = tableOf([
    [0, 0, 0.2, 0, 0, 1],
    [1, 0, 0.2, 1, 0, 1],
    [2, 0, -0.2, 0, 0, -1],
    [3, 0, -0.2, 1, 0, -1],
]);
const splitter40 = tableOf([
    [0, 0, 0.2, 1, 0, 1],
    [1, 0.21, 0, 0, 1, 0],
    [2, 0, -0.2, 1, 0, -1],
    [3, -0.21, 0, 0, -1, 0],
]);

/** 自动集装机 (2040)：一条输入、一条输出，同一格的两侧 */
const stacker2040 = tableOf([
    [0, 0, 0.2, 0, 0, 1],
    [1, 0, -0.2, 0, 0, -1],
]);

/** 物流运输站 (2103)：12 口环 —— +y(0,1,2) −x(3,4,5) −y(6,7,8) +x(9,10,11) */
const station2103 = tableOf([
    [0, 1.11, 2.15, 0, 0, 1],
    [1, 0, 2.15, 0, 0, 1],
    [2, -1.11, 2.15, 0, 0, 1],
    [3, -2.39, 1.01, 0, -1, 0],
    [4, -2.39, 0, 0, -1, 0],
    [5, -2.4, -0.99, 0, -1, 0],
    [6, -1.12, -2.15, 0, 0, -1],
    [7, 0, -2.15, 0, 0, -1],
    [8, 1.12, -2.15, 0, 0, -1],
    [9, 2.4, -0.99, 0, 1, 0],
    [10, 2.39, 0, 0, 1, 0],
    [11, 2.38, 1.01, 0, 1, 0],
]);

/** 星际物流运输站 (2104)：12 口环，绕向与 2103 相同但半径不同 */
const station2104 = tableOf([
    [0, 1, 2.15, 0, 0, 1],
    [1, 0, 2.15, 0, 0, 1],
    [2, -1, 2.15, 0, 0, 1],
    [3, -2.15, 1, 0, -1, 0],
    [4, -2.15, 0, 0, -1, 0],
    [5, -2.15, -1, 0, -1, 0],
    [6, -1, -2.15, 0, 0, -1],
    [7, 0, -2.15, 0, 0, -1],
    [8, 1, -2.15, 0, 0, -1],
    [9, 2.15, -1, 0, 1, 0],
    [10, 2.15, 0, 0, 1, 0],
    [11, 2.15, 1, 0, 1, 0],
]);

/** 储液罐 (2106)：四面各一口 */
const tank2106 = tableOf([
    [0, 0, 1.11, 0, 0, 1],
    [1, 1.19, 0, 0, 1, 0],
    [2, 0, -1.11, 0, 0, -1],
    [3, -1.19, 0, 0, -1, 0],
]);

/** 射线接收站 (2208)：南北各一口 */
const rayReceiver2208 = tableOf([
    [0, 0, 1.13, 0, 0, 1],
    [1, 0, -1.13, 0, 0, -1],
]);

/** 能量枢纽 (2209)：四面各一口 */
const energyExchanger2209 = tableOf([
    [0, 0, 2.27, 0, 0, 1],
    [1, 2.29, 0, 0, 1, 0],
    [2, 0, -2.27, 0, 0, -1],
    [3, -2.29, 0, 0, -1, 0],
]);

/** 分馏塔 (2314)：东西各一口 */
const fractionator2314 = tableOf([
    [1, 1.11, 0, 0, 1, 0],
    [2, -1.11, 0, 0, -1, 0],
]);

/** itemId → (modelIndex → 口表)；模型键省略时表示该建筑所有模型共用 */
const portTables: Record<number, Record<number, BeltPortTable>> = {
    2020: { 38: splitter38, 39: splitter39, 40: splitter40 },
    2040: { 257: stacker2040 },
    2103: { 49: station2103 },
    2104: { 50: station2104 },
    2106: { 121: tank2106 },
    2208: { 73: rayReceiver2208 },
    2209: { 45: energyExchanger2209 },
    2314: { 119: fractionator2314 },
};

/** 面顺序 [+y, +x, -y, -x] → 法线 */
const FACE_NORMAL: [number, number][] = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
];

/** 从坐标推断法线（主轴分量），角 slot 由 `preferFace` 决定 */
function normalFrom(
    x: number,
    y: number,
    preferFace?: [number, number]
): [number, number] {
    if (preferFace) return preferFace;
    return Math.abs(x) >= Math.abs(y)
        ? [x >= 0 ? 1 : -1, 0]
        : [0, y >= 0 ? 1 : -1];
}

const fallbackCache = new Map<string, BeltPortTable>();

/**
 * 取建筑的传送带口表。
 * - 已用传送带样本标定的建筑（分流器/集装机/物流站/储液罐/射线接收站/能量枢纽/分馏塔）返回精确表；
 * - 其余有 `buildingSlots` 表的建筑退回同名 slot（法线由面分组决定）——**近似**，待样本标定；
 * - 都没有则返回空表（该建筑不接受传送带直连）。
 */
export function getBeltPorts(
    itemId: number,
    modelIndex?: number
): BeltPortTable {
    const byModel = portTables[itemId];
    if (byModel) {
        if (modelIndex !== undefined && byModel[modelIndex])
            return byModel[modelIndex];
        const first = Object.keys(byModel)[0];
        if (first !== undefined) return byModel[Number(first)];
    }
    const key = `${itemId}`;
    const cached = fallbackCache.get(key);
    if (cached) return cached;
    const slots = getBuildingSlots(itemId);
    const table: BeltPortTable = slots.map((s, slot) => {
        if (!s) return null;
        const face = slotFaceOf(itemId, slot);
        const preferFace =
            face >= 0 && face <= 3
                ? FACE_NORMAL[face as 0 | 1 | 2 | 3]
                : undefined;
        const [nx, ny] = normalFrom(s.x, s.y, preferFace);
        return { x: s.x, y: s.y, z: 0, nx, ny };
    });
    fallbackCache.set(key, table);
    return table;
}

/** 取某个口；未标定返回 null */
export function beltPortAt(
    itemId: number,
    modelIndex: number | undefined,
    slot: number
): BeltPort | null {
    const table = getBeltPorts(itemId, modelIndex);
    return table[slot] ?? null;
}

/** 该建筑是否有可直连传送带的口 */
export function hasBeltPorts(itemId: number, modelIndex?: number): boolean {
    return getBeltPorts(itemId, modelIndex).some((p) => p !== null);
}

/**
 * 口坐标（建筑局部系，赤道基准）→ 世界网格偏移。
 * 与 `calcBuildingTrans` 一致：经向格宽 ∝ cos(纬度)，故 x 需除以 cos(lat) 再按 yaw 旋转
 * （`slot_local = R_Z(+yaw)·(端点 − 中心)` 的逆变换）。
 */
export function portWorldOffset(
    port: BeltPort,
    yawDeg: number,
    cosLat: number
): { x: number; y: number; z: number } {
    const a = (yawDeg * Math.PI) / 180;
    const u = port.x / (cosLat || 1);
    const v = port.y;
    // R(-yaw)·(u, v)
    return {
        x: u * Math.cos(a) + v * Math.sin(a),
        y: -u * Math.sin(a) + v * Math.cos(a),
        z: port.z,
    };
}

/** 口的朝外法线 → 世界网格方向（轴向单位向量） */
export function portWorldNormal(
    port: BeltPort,
    yawDeg: number
): { x: number; y: number } {
    const a = (yawDeg * Math.PI) / 180;
    const x = port.nx * Math.cos(a) + port.ny * Math.sin(a);
    const y = -port.nx * Math.sin(a) + port.ny * Math.cos(a);
    return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 在建筑局部系里找离 (lx, ly) 最近的口（用于"点建筑即接最近的口"）。
 * 只考虑距中心不超过 `limit` 的口；建筑没有口时返回 null。
 */
export function nearestBeltPort(
    itemId: number,
    modelIndex: number | undefined,
    lx: number,
    ly: number,
    limit = Infinity
): { slot: number; port: BeltPort } | null {
    const table = getBeltPorts(itemId, modelIndex);
    let best: { slot: number; port: BeltPort } | null = null;
    let bestD = Infinity;
    for (let slot = 0; slot < table.length; slot++) {
        const port = table[slot];
        if (!port) continue;
        const d = (port.x - lx) ** 2 + (port.y - ly) ** 2;
        if (d < bestD && d <= limit * limit) {
            bestD = d;
            best = { slot, port };
        }
    }
    return best;
}

/**
 * 光标选口：先按**高度层**筛（`|z − lz| ≤ 0.75`，用于区分分流器的地面层/上层口），
 * 层内没有口时退回全部口；同层内取 xy 距离最近者，超过 `limit` 视为没点中口。
 * @param lx/ly 光标在建筑局部系的坐标（x 需已按赤道归一：`x_grid·cos(lat)`）
 * @param lz 光标的高度格（`(命中点半径 − R) / (4/3)`；无高度信息传 0）
 */
export function pickBeltPort(
    itemId: number,
    modelIndex: number | undefined,
    lx: number,
    ly: number,
    lz = 0,
    limit = 2.5
): { slot: number; port: BeltPort } | null {
    const table = getBeltPorts(itemId, modelIndex);
    const layer = table.filter(
        (p): p is BeltPort => p !== null && Math.abs(p.z - lz) <= 0.75
    );
    const pick = (ports: BeltPortTable) => {
        let best: { slot: number; port: BeltPort } | null = null;
        let bestD = Infinity;
        for (let slot = 0; slot < ports.length; slot++) {
            const port = ports[slot];
            if (!port) continue;
            const d = (port.x - lx) ** 2 + (port.y - ly) ** 2;
            if (d < bestD && d <= limit * limit) {
                bestD = d;
                best = { slot, port };
            }
        }
        return best;
    };
    return pick(layer.length > 0 ? layer : table);
}
