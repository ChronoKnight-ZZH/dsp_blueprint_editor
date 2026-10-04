/**
 * 建筑 slot 坐标表（局部坐标，相对建筑中心，yaw=0 时）
 * 从游戏蓝图反算得出；未收录的建筑返回空数组
 */

export interface SlotPos {
    x: number;
    y: number;
}

/** 储物仓·小 (2101) 12 slot */
const storage2101: SlotPos[] = [
    { x: -0.8210, y: 0.7955 },   // slot 0
    { x: 0.0000, y: 0.7950 },    // slot 1
    { x: 0.8211, y: 0.7955 },    // slot 2
    { x: 0.8211, y: 0.7955 },    // slot 3
    { x: 0.8221, y: 0.0005 },    // slot 4
    { x: 0.8232, y: -0.7945 },   // slot 5
    { x: 0.8232, y: -0.7945 },   // slot 6
    { x: 0.0000, y: -0.7950 },   // slot 7
    { x: -0.8232, y: -0.7945 },  // slot 8
    { x: -0.8232, y: -0.7945 },  // slot 9
    { x: -0.8221, y: 0.0005 },   // slot 10
    { x: -0.8210, y: 0.7955 },   // slot 11
];

/** 储物仓·大 (2102) 12 slot */
const storage2102: SlotPos[] = [
    { x: -0.8210, y: 0.8750 },   // slot 0
    { x: 0.0000, y: 0.8745 },    // slot 1
    { x: 0.8209, y: 0.8750 },    // slot 2
    { x: 1.8885, y: 0.7978 },    // slot 3
    { x: 1.8909, y: 0.0028 },    // slot 4
    { x: 1.8934, y: -0.7922 },   // slot 5
    { x: 0.8233, y: -0.8740 },   // slot 6
    { x: 0.0000, y: -0.8745 },   // slot 7
    { x: -0.8233, y: -0.8740 },  // slot 8
    { x: -1.8935, y: -0.7922 },  // slot 9
    { x: -1.8910, y: 0.0028 },   // slot 10
    { x: -1.8885, y: 0.7978 },   // slot 11
];

/** 火力发电厂 (2204) 5 slot */
const powerPlant2204: SlotPos[] = [
    { x: 1.6857, y: -0.8077 },   // slot 0
    { x: 1.6854, y: 0.0000 },    // slot 1
    { x: 1.6857, y: 0.8077 },    // slot 2
    { x: -0.6916, y: -0.0000 },  // slot 3
    { x: -0.6913, y: -0.8100 },  // slot 4
];

/** 人造恒星 (2210) 4 slot */
const artificialStar2210: SlotPos[] = [
    { x: 0.0000, y: 1.7888 },    // slot 0
    { x: 1.9012, y: 0.0036 },    // slot 1
    { x: 0.0000, y: -1.7888 },   // slot 2
    { x: -1.9012, y: 0.0036 },   // slot 3
];

/** 电弧熔炉 (2302) 12 slot */
const smelter2302: SlotPos[] = [
    { x: -0.8095, y: 0.7954 },   // slot 0
    { x: 0.0000, y: 0.7950 },    // slot 1
    { x: 0.8095, y: 0.7954 },    // slot 2
    { x: 0.8095, y: 0.7954 },    // slot 3
    { x: 0.8103, y: 0.0004 },    // slot 4
    { x: 0.8111, y: -0.7946 },   // slot 5
    { x: 0.8111, y: -0.7946 },   // slot 6
    { x: -0.0000, y: -0.7950 },  // slot 7
    { x: -0.8111, y: -0.7946 },  // slot 8
    { x: -0.8111, y: -0.7946 },  // slot 9
    { x: -0.8103, y: 0.0004 },   // slot 10
    { x: -0.8095, y: 0.7954 },   // slot 11
];

/** 制造台 MK.I (2303) 12 slot */
const assembler2303: SlotPos[] = [
    { x: -0.8104, y: 0.8749 },   // slot 0: 上方偏左
    { x: 0.0000, y: 0.8745 },    // slot 1: 上方中间
    { x: 0.8104, y: 0.8749 },    // slot 2: 上方偏右
    { x: 0.8916, y: 0.7955 },    // slot 3: 右方偏上
    { x: 0.8925, y: 0.0005 },    // slot 4: 右方中间
    { x: 0.8934, y: -0.7945 },   // slot 5: 右方偏下
    { x: 0.8123, y: -0.8741 },   // slot 6: 下方偏右
    { x: 0.0000, y: -0.8745 },   // slot 7: 下方中间
    { x: -0.8122, y: -0.8741 },  // slot 8: 下方偏左
    { x: -0.8934, y: -0.7945 },  // slot 9: 左方偏下
    { x: -0.8925, y: 0.0005 },   // slot 10: 左方中间
    { x: -0.8916, y: 0.7955 },   // slot 11: 左方偏上
];

/** 化工厂 (2309) 8 slot */
const chemicalPlant2309: SlotPos[] = [
    { x: -0.8199, y: 1.6701 },   // slot 0
    { x: 0.0000, y: 1.6696 },    // slot 1
    { x: 0.8199, y: 1.6701 },    // slot 2
    { x: 1.6462, y: -0.7134 },   // slot 3
    { x: 0.8231, y: -0.7150 },   // slot 4
    { x: 0.0000, y: -0.7155 },   // slot 5
    { x: -0.8231, y: -0.7150 },  // slot 6
    { x: 1.6398, y: 1.6716 },    // slot 7
];

/** 精炼厂 (2310) 9 slot */
const refinery2310: SlotPos[] = [
    { x: -0.8197, y: 1.8290 },   // slot 0
    { x: -1.6394, y: 1.8305 },   // slot 1
    { x: -2.4589, y: 1.8330 },   // slot 2
    { x: -3.9415, y: 0.8071 },   // slot 3
    { x: -3.9467, y: 0.0121 },   // slot 4
    { x: -3.9519, y: -0.7830 },  // slot 5
    { x: -2.4738, y: -1.8236 },  // slot 6
    { x: -1.6493, y: -1.8264 },  // slot 7
    { x: -0.8247, y: -1.8280 },  // slot 8
];

/** 原油萃取站 (2311) 4 slot */
const oilExtractor2311: SlotPos[] = [
    { x: 1.9011, y: 0.0036 },    // slot 0
    { x: -1.9011, y: 0.0036 },   // slot 1
    { x: 0.0000, y: 1.7886 },    // slot 2
    { x: 0.0000, y: -1.7886 },   // slot 3
];

/** 垂直发射井 (2312) 3 slot */
const silo2312: SlotPos[] = [
    { x: 0.0000, y: 3.8960 },    // slot 0
    { x: 4.1315, y: 0.0168 },    // slot 1
    { x: -4.1315, y: 0.0168 },   // slot 2
];

/** 科研站 (2901) 12 slot */
const lab2901: SlotPos[] = [
    { x: 0.8415, y: 1.8292 },    // slot 0
    { x: 0.0000, y: 1.8286 },    // slot 1
    { x: -0.8415, y: 1.8292 },   // slot 2
    { x: -1.9399, y: 0.7988 },   // slot 3
    { x: -1.9434, y: 0.0038 },   // slot 4
    { x: -1.9469, y: -0.7912 },  // slot 5
    { x: -0.8485, y: -1.8278 },  // slot 6
    { x: 0.0000, y: -1.8286 },   // slot 7
    { x: 0.8485, y: -1.8278 },   // slot 8
    { x: 1.9469, y: -0.7912 },   // slot 9
    { x: 1.9434, y: 0.0038 },    // slot 10
    { x: 1.9400, y: 0.7988 },    // slot 11
];

/** 战场分析基站 (3009) 9 slot */
const battleBase3009: SlotPos[] = [
    { x: 1.8033, y: 0.7974 },    // slot 0
    { x: 1.8056, y: 0.0025 },    // slot 1
    { x: 1.8079, y: -0.7925 },   // slot 2
    { x: 0.8232, y: -1.8278 },   // slot 3
    { x: 0.0000, y: -1.8284 },   // slot 4
    { x: -0.8232, y: -1.8278 },  // slot 5
    { x: -1.8079, y: -0.7925 },  // slot 6
    { x: -1.8056, y: 0.0025 },   // slot 7
    { x: -1.8033, y: 0.7974 },   // slot 8
];

/**
 * 同款模型共用 slot 表：这些建筑的 modelIndex 与选择盒尺寸和已标定建筑完全一致，
 * slot 布局与编号顺序相同（实测偏差 ≤0.05 格，属模型差异），因此直接复用。
 * 更精确的各等级 slot 坐标待有真实蓝图样本后再单独标定。
 */
const slotAliases: Record<number, number> = {
    2304: 2303, // 制造台 Mk.II（model 66）
    2305: 2303, // 制造台 Mk.III（model 67）
    2318: 2303, // 制造台 Mk.IV（model 456）
    2315: 2302, // 位面熔炉（model 194）
    2319: 2302, // 熔炉 Mk.III（model 457）
    2902: 2901, // 矩阵研究站 Mk.II（model 455）
};

/** itemId → slot 坐标表 */
const slotTable: Record<number, SlotPos[]> = {
    2101: storage2101,
    2102: storage2102,
    2204: powerPlant2204,
    2210: artificialStar2210,
    2302: smelter2302,
    2303: assembler2303,
    2309: chemicalPlant2309,
    2310: refinery2310,
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
 * 获取建筑的 slot 局部坐标列表
 * @returns slot 坐标数组，无 slot 或未知建筑返回空数组
 */
export function getBuildingSlots(itemId: number): SlotPos[] {
    const alias = slotAliases[itemId];
    return slotTable[alias ?? itemId] ?? [];
}

/**
 * 判断建筑是否有 slot（可连接分拣器）
 */
export function hasSlots(itemId: number): boolean {
    return getBuildingSlots(itemId).length > 0;
}

/**
 * 根据点击位置（建筑局部坐标）找最近 slot 编号
 * @returns slot 编号，无 slot 返回 -1
 */
export function findNearestSlot(itemId: number, localX: number, localY: number): number {
    const slots = getBuildingSlots(itemId);
    if (slots.length === 0) return -1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < slots.length; i++) {
        const dx = slots[i].x - localX;
        const dy = slots[i].y - localY;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

/**
 * slot 所在平行组编号（0:+x 右列, 1:-x 左列, 2:+y 上排, 3:-y 下排）。
 * 按离建筑中心较远的主轴及其符号分组——同侧 slot 的坐标矢量互相平行，
 * 游戏中它们挂在同一连接面上，可互相替代。
 */
export function slotGroup(s: SlotPos): number {
    if (Math.abs(s.x) >= Math.abs(s.y))
        return s.x >= 0 ? 0 : 1;
    return s.y >= 0 ? 2 : 3;
}

/**
 * 找最近空闲 slot：最近 slot 未被占用时与 {@link findNearestSlot} 行为一致；
 * 已被占用时，在同一平行组（同侧）内按距离升序找最近空闲 slot。
 * @param occupied 已被其他分拣器占用的 slot 编号集合
 * @returns slot 编号；无 slot 数据或平行组内全被占用返回 -1
 */
export function findNearestFreeSlot(
    itemId: number,
    localX: number,
    localY: number,
    occupied: ReadonlySet<number>,
): number {
    const slots = getBuildingSlots(itemId);
    if (slots.length === 0) return -1;
    // 按距离升序的候选序列（sort 稳定，同距离保持 slot 编号升序）
    const order = slots
        .map((s, i) => ({ i, d: (s.x - localX) ** 2 + (s.y - localY) ** 2 }))
        .sort((a, b) => a.d - b.d);
    const nearest = order[0].i;
    if (!occupied.has(nearest)) return nearest;
    const g = slotGroup(slots[nearest]);
    for (const { i } of order) {
        if (slotGroup(slots[i]) === g && !occupied.has(i))
            return i;
    }
    return -1;
}
