/**
 * 建筑 slot 坐标表（局部坐标：相对建筑中心，建筑 yaw=0 时）。
 *
 * 数组**下标即 slot 编号**（游戏 wire 字段里记录的编号）；尚未标定的 slot 用 null 占位，
 * 调用方需跳过 null（见 `getBuildingSlots` 的类型说明）。
 *
 * 标定来源（真实游戏蓝图反推：slot_local = R_Z(+yaw)·(端点 − 中心)，见
 * tests/tools/deriveSlots.ts）：
 * - tests/tools/分拣器.txt（0.10.35）：制造台 Mk.I 12 slot 环
 * - tests/tools/分拣器示例.txt（0.10.35）：12 种建筑 × 输入/输出两个方向 × 长度 1/2
 * - tests/unit/blueprint/fixtures/starting_base_01029.txt（0.10.29 老基地）：电弧熔炉等
 *
 * 说明：同款模型（选择盒尺寸一致）的建筑 slot 布局与编号顺序相同，见 {@link slotAliases}。
 * 表内 x（经向）为**赤道面标定值**：蓝图的局部 x 间距随所在分区纬度变化（经向格宽
 * ∝ cos(lat)），因此从高纬度蓝图反推的 x 会偏大；本表统一按赤道基准换算（y 不受影响）。
 */

export interface SlotPos {
    x: number;
    y: number;
}

/** slot 表：下标 = slot 编号，null = 该 slot 尚未标定 */
export type SlotTable = (SlotPos | null)[];

/** 储物仓·小 (2101) 12 slot */
const storage2101: SlotTable = [
    { x: -0.7991, y: 0.7955 }, // slot 0
    { x: 0.0, y: 0.795 }, // slot 1
    { x: 0.7992, y: 0.7955 }, // slot 2
    { x: 0.7992, y: 0.7955 }, // slot 3
    { x: 0.8001, y: 0.0005 }, // slot 4
    { x: 0.8012, y: -0.7945 }, // slot 5
    { x: 0.8012, y: -0.7945 }, // slot 6
    { x: 0.0, y: -0.795 }, // slot 7
    { x: -0.8012, y: -0.7947 }, // slot 8（反推）
    { x: -0.8012, y: -0.7945 }, // slot 9
    { x: -0.8001, y: 0.0005 }, // slot 10
    { x: -0.7991, y: 0.7955 }, // slot 11
];

/** 储物仓·大 (2102) 12 slot */
const storage2102: SlotTable = [
    { x: -0.8028, y: 0.875 }, // slot 0
    { x: 0.0, y: 0.8745 }, // slot 1
    { x: 0.8027, y: 0.8748 }, // slot 2（反推）
    { x: 1.8466, y: 0.7978 }, // slot 3
    { x: 1.849, y: 0.0028 }, // slot 4
    { x: 1.8514, y: -0.7922 }, // slot 5
    { x: 0.805, y: -0.874 }, // slot 6
    { x: 0.0, y: -0.8745 }, // slot 7
    { x: -0.805, y: -0.874 }, // slot 8
    { x: -1.8515, y: -0.7922 }, // slot 9
    { x: -1.8491, y: 0.0028 }, // slot 10
    { x: -1.8466, y: 0.7978 }, // slot 11
];

/**
 * 火力发电厂 (2204) 5 slot。
 * 早期版本的这张表整体旋转了 180°（从 yaw=90/270 的蓝图反推时逆变换用反了），
 * 0.10.35 样本（分拣器示例）证实真实值是其相反数，此处已修正。
 */
const powerPlant2204: SlotTable = [
    { x: -1.6857, y: 0.8029 }, // slot 0（slot 2 的镜像）
    { x: -1.6854, y: 0.0 }, // slot 1（反推）
    { x: -1.6857, y: -0.8029 }, // slot 2（反推）
    { x: 0.6916, y: 0.0 }, // slot 3（反推）
    { x: 0.6914, y: 0.8011 }, // slot 4（反推）
];

/** 人造恒星 (2210) 4 slot */
const artificialStar2210: SlotTable = [
    { x: 0.0, y: 1.7888 }, // slot 0
    { x: 1.9012, y: 0.0036 }, // slot 1
    { x: 0.0, y: -1.7888 }, // slot 2
    { x: -1.9012, y: 0.0036 }, // slot 3
];

/** 电弧熔炉 (2302) 12 slot（3.2×3.2 方建筑：角 slot 与相邻面的边界 slot 位置重合，故成对相同） */
const smelter2302: SlotTable = [
    { x: -0.7996, y: 0.7954 }, // slot 0
    { x: 0.0, y: 0.795 }, // slot 1
    { x: 0.7996, y: 0.7954 }, // slot 2
    { x: 0.7996, y: 0.7954 }, // slot 3
    { x: 0.8004, y: 0.0004 }, // slot 4
    { x: 0.8012, y: -0.7946 }, // slot 5
    { x: 0.8012, y: -0.7946 }, // slot 6
    { x: 0.0, y: -0.795 }, // slot 7
    { x: -0.8012, y: -0.7947 }, // slot 8（反推）
    { x: -0.8012, y: -0.7946 }, // slot 9
    { x: -0.8004, y: 0.0004 }, // slot 10
    { x: -0.7996, y: 0.7954 }, // slot 11
];

/** 制造台 MK.I (2303) 12 slot（对 分拣器.txt 逐 slot 验证：误差 0.000） */
const assembler2303: SlotTable = [
    { x: -0.8104, y: 0.8749 }, // slot 0: 上方偏左
    { x: 0.0, y: 0.8745 }, // slot 1: 上方中间
    { x: 0.8104, y: 0.8749 }, // slot 2: 上方偏右
    { x: 0.8916, y: 0.7955 }, // slot 3: 右方偏上
    { x: 0.8925, y: 0.0005 }, // slot 4: 右方中间
    { x: 0.8934, y: -0.7945 }, // slot 5: 右方偏下
    { x: 0.8123, y: -0.8741 }, // slot 6: 下方偏右
    { x: 0.0, y: -0.8745 }, // slot 7: 下方中间
    { x: -0.8122, y: -0.8741 }, // slot 8: 下方偏左
    { x: -0.8934, y: -0.7945 }, // slot 9: 左方偏下
    { x: -0.8925, y: 0.0005 }, // slot 10: 左方中间
    { x: -0.8916, y: 0.7955 }, // slot 11: 左方偏上
];

/** 原油精炼厂 (2308)（model 63）：只标定了 -y 面的 3 个 slot，其余待补 */
const refinery2308: SlotTable = [
    null, // slot 0 未标定
    null, // slot 1
    null, // slot 2
    null, // slot 3
    null, // slot 4
    null, // slot 5
    { x: -0.8012, y: -2.862 }, // slot 6（反推）
    { x: 0.0, y: -2.8622 }, // slot 7（反推）
    { x: 0.8012, y: -2.8622 }, // slot 8（按同面镜像推断）
];

/** 化工厂 (2309) 8 slot */
const chemicalPlant2309: SlotTable = [
    { x: -0.798, y: 1.6701 }, // slot 0
    { x: 0.0, y: 1.6696 }, // slot 1
    { x: 0.798, y: 1.6701 }, // slot 2
    { x: 1.6022, y: -0.7134 }, // slot 3
    { x: 0.8011, y: -0.715 }, // slot 4
    { x: 0.0, y: -0.7155 }, // slot 5
    { x: -0.8011, y: -0.7153 }, // slot 6（反推）
    { x: 1.596, y: 1.6716 }, // slot 7
];

/** 微型粒子对撞机 (2310) 9 slot */
const collider2310: SlotTable = [
    { x: -0.7964, y: 1.829 }, // slot 0
    { x: -1.5928, y: 1.8305 }, // slot 1
    { x: -2.389, y: 1.833 }, // slot 2
    { x: -3.8295, y: 0.8071 }, // slot 3
    { x: -3.8345, y: 0.0121 }, // slot 4
    { x: -3.8396, y: -0.783 }, // slot 5
    { x: -2.4035, y: -1.8263 }, // slot 6（反推）
    { x: -1.6024, y: -1.8276 }, // slot 7（反推）
    { x: -0.8013, y: -1.828 }, // slot 8
];

/** 原油萃取站 (2311) 4 slot */
const oilExtractor2311: SlotTable = [
    { x: 1.9011, y: 0.0036 }, // slot 0
    { x: -1.9011, y: 0.0036 }, // slot 1
    { x: 0.0, y: 1.7886 }, // slot 2
    { x: 0.0, y: -1.7886 }, // slot 3（反推）
];

/** 垂直发射井 (2312) 3 slot */
const silo2312: SlotTable = [
    { x: 0.0, y: 3.896 }, // slot 0
    { x: 4.1315, y: 0.0168 }, // slot 1
    { x: -4.1315, y: 0.0168 }, // slot 2
];

/** 矩阵研究站 (2901) 12 slot */
const lab2901: SlotTable = [
    { x: 0.7946, y: 1.8292 }, // slot 0
    { x: 0.0, y: 1.8286 }, // slot 1
    { x: -0.7946, y: 1.8292 }, // slot 2
    { x: -1.8318, y: 0.7988 }, // slot 3
    { x: -1.8351, y: 0.0038 }, // slot 4
    { x: -1.8384, y: -0.7912 }, // slot 5
    { x: -0.8012, y: -1.8278 }, // slot 6
    { x: 0.0, y: -1.8286 }, // slot 7（反推）
    { x: 0.8012, y: -1.8283 }, // slot 8（反推）
    { x: 1.8384, y: -0.7912 }, // slot 9
    { x: 1.8351, y: 0.0038 }, // slot 10
    { x: 1.8319, y: 0.7988 }, // slot 11
];

/** 战场分析基站 (3009) 9 slot */
const battleBase3009: SlotTable = [
    { x: 1.7599, y: 0.7974 }, // slot 0
    { x: 1.7622, y: 0.0025 }, // slot 1
    { x: 1.7644, y: -0.7925 }, // slot 2
    { x: 0.8034, y: -1.8287 }, // slot 3（反推）
    { x: 0.0, y: -1.8284 }, // slot 4（反推）
    { x: -0.8034, y: -1.8278 }, // slot 5
    { x: -1.7644, y: -0.7925 }, // slot 6
    { x: -1.7622, y: 0.0025 }, // slot 7
    { x: -1.7599, y: 0.7974 }, // slot 8
];

/**
 * 同款模型共用 slot 表：这些建筑的 modelIndex 与选择盒尺寸和已标定建筑一致，
 * slot 布局与编号顺序相同（实测偏差 ≤0.05 格，属模型差异），因此直接复用。
 * 更精确的各等级 slot 坐标待有真实蓝图样本后再单独标定。
 */
const slotAliases: Record<number, number> = {
    2211: 2204, // 微型聚变发电站（model 118，与火力发电厂同选择盒 4.8×9.0；样本实测同布局）
    2304: 2303, // 制造台 Mk.II（model 66）
    2305: 2303, // 制造台 Mk.III（model 67）
    2318: 2303, // 制造台 Mk.IV（model 456）
    2315: 2302, // 位面熔炉（model 194）
    2319: 2302, // 熔炉 Mk.III（model 457）
    2902: 2901, // 矩阵研究站 Mk.II（model 455）
};

/** itemId → slot 坐标表 */
const slotTable: Record<number, SlotTable> = {
    2101: storage2101,
    2102: storage2102,
    2204: powerPlant2204,
    2210: artificialStar2210,
    2302: smelter2302,
    2303: assembler2303,
    2308: refinery2308,
    2309: chemicalPlant2309,
    2310: collider2310,
    2311: oilExtractor2311,
    2312: silo2312,
    2901: lab2901,
    3009: battleBase3009,
    // TODO: 其他建筑 slot 坐标待补充
    // 物流站 2103, 2104
    // 采矿机 2301, 2316
    // 等
};

/**
 * 获取建筑的 slot 局部坐标列表。
 * **数组下标 = 游戏 slot 编号**，未标定的 slot 为 null（调用方需跳过）。
 * @returns slot 表，无 slot 数据的建筑返回空数组
 */
export function getBuildingSlots(itemId: number): SlotTable {
    const alias = slotAliases[itemId];
    return slotTable[alias ?? itemId] ?? [];
}

/**
 * 判断建筑是否有 slot（可连接分拣器）
 */
export function hasSlots(itemId: number): boolean {
    return getBuildingSlots(itemId).some((s) => s !== null);
}

/**
 * 面归属容差：slot 投影到面法线后与该方向极值之差 ≤ 此值即视为属于该面。
 * 取 0.03 可让"角 slot"同时属于两个相邻面（例如 3.2×3.2 电弧熔炉的角 slot
 * (0.8012, -0.7947) 既在 +x 面也在 -y 面），而不会把明显内缩的 slot 误并入邻面
 * （例如 4.2×4.2 制造台的 slot 3 (0.8916, 0.7955) 距 +y 面极值 0.8749 有 0.079）。
 */
export const FACE_TOL = 0.03;

/**
 * 求**属于某个面**的 slot 编号列表。
 *
 * 不能用"主轴取大"分组：方建筑（电弧熔炉 3.2×3.2）与模型在选盒内偏移的建筑
 * （火力发电厂）角 slot 的横纵坐标几乎相等或大小关系相反，按主轴分组会把它们
 * 归错面——真实蓝图里分拣器从 -y 侧接入熔炉时挂的是角 slot 8 而不是中间 slot 7。
 *
 * @param dir 面法线方向（建筑 yaw=0 局部系，不必归一化）
 * @returns slot 编号列表（升序）；未标定 slot 不计入
 */
export function faceSlotIndices(itemId: number, dir: SlotPos): number[] {
    const slots = getBuildingSlots(itemId);
    const onX = Math.abs(dir.x) >= Math.abs(dir.y);
    const sign = (onX ? dir.x : dir.y) >= 0 ? 1 : -1;
    const proj = (s: SlotPos) => sign * (onX ? s.x : s.y);
    let extreme = -Infinity;
    for (const s of slots) {
        if (s !== null) extreme = Math.max(extreme, proj(s));
    }
    const out: number[] = [];
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s !== null && extreme - proj(s) <= FACE_TOL) out.push(i);
    }
    return out;
}

/**
 * 根据点击位置（建筑局部坐标）找最近 slot 编号
 * @returns slot 编号，无 slot 返回 -1
 */
export function findNearestSlot(
    itemId: number,
    localX: number,
    localY: number
): number {
    const slots = getBuildingSlots(itemId);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s === null) continue;
        const d = (s.x - localX) ** 2 + (s.y - localY) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

/**
 * 找最近空闲 slot：最近 slot 未被占用时与 {@link findNearestSlot} 行为一致；
 * 已被占用时，在**同一连接面**（点击方向所在的面，见 {@link faceSlotIndices}）内
 * 按距离升序找最近空闲 slot。
 * @param occupied 已被其他分拣器占用的 slot 编号集合
 * @returns slot 编号；无 slot 数据或该面内全被占用返回 -1
 */
export function findNearestFreeSlot(
    itemId: number,
    localX: number,
    localY: number,
    occupied: ReadonlySet<number>
): number {
    const slots = getBuildingSlots(itemId);
    // 按距离升序的候选序列（sort 稳定，同距离保持 slot 编号升序）
    const order = slots
        .map((s, i) => ({
            i,
            d:
                s === null
                    ? Infinity
                    : (s.x - localX) ** 2 + (s.y - localY) ** 2,
        }))
        .filter((o) => Number.isFinite(o.d))
        .sort((a, b) => a.d - b.d);
    if (order.length === 0) return -1;
    if (!occupied.has(order[0].i)) return order[0].i;
    const onFace = new Set(faceSlotIndices(itemId, { x: localX, y: localY }));
    for (const { i } of order) {
        if (onFace.has(i) && !occupied.has(i)) return i;
    }
    return -1;
}
