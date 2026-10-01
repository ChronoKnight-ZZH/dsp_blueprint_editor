// 建筑电力 / 生产速度数据表
// 运行时只读，数据取自当前正式版游戏内数值（单位：kW）
export interface BuildingPowerData {
  /** 建筑物品 ID，如制造台 Mk.I = 2303 */
  itemId: number;
  /** 建筑名称（可选，用于调试或显示） */
  name?: string;
  /** 基础工作功耗，单位 kW */
  basePower: number;
  /** 基础生产速度倍率，如制造台 Mk.I = 0.75、Mk.II = 1、Mk.III = 1.5 */
  speedMultiplier: number;
  /** 是否受加速模式影响（即是否允许生产加速/额外产出） */
  canAccelerate: boolean;
}

export const buildingPowerData: BuildingPowerData[] = [
  // 制造台
  { itemId: 2303, name: '制造台 Mk.I', basePower: 270, speedMultiplier: 0.75, canAccelerate: true },
  { itemId: 2304, name: '制造台 Mk.II', basePower: 540, speedMultiplier: 1.0, canAccelerate: true },
  { itemId: 2305, name: '制造台 Mk.III', basePower: 1080, speedMultiplier: 1.5, canAccelerate: true },
  { itemId: 2318, name: '制造台 Mk.IV', basePower: 2700, speedMultiplier: 3.0, canAccelerate: true },

  // 熔炉
  { itemId: 2302, name: '电弧熔炉', basePower: 360, speedMultiplier: 1.0, canAccelerate: true },
  { itemId: 2315, name: '位面熔炉', basePower: 1440, speedMultiplier: 2.0, canAccelerate: true },
  { itemId: 2319, name: '熔炉 Mk.III', basePower: 2880, speedMultiplier: 3.0, canAccelerate: true },

  // 化工厂
  { itemId: 2309, name: '化工厂', basePower: 720, speedMultiplier: 1.0, canAccelerate: true },
  { itemId: 2317, name: '化工厂 Mk.II', basePower: 2160, speedMultiplier: 2.0, canAccelerate: true },

  // 研究站
  { itemId: 2901, name: '矩阵研究站', basePower: 480, speedMultiplier: 1.0, canAccelerate: true },
  { itemId: 2902, name: '矩阵研究站 Mk.II', basePower: 1920, speedMultiplier: 3.0, canAccelerate: true },

  // 精炼厂 / 对撞机
  { itemId: 2308, name: '原油精炼厂', basePower: 960, speedMultiplier: 1.0, canAccelerate: true },
  { itemId: 2310, name: '微型粒子对撞机', basePower: 12000, speedMultiplier: 1.0, canAccelerate: true },

  // 分馏塔（特殊生产建筑，无配方：默认每分钟 72 氢 -> 72 重氢）
  { itemId: 2314, name: '分馏塔', basePower: 3960, speedMultiplier: 1.0, canAccelerate: true },

  // 采集类建筑（若配方表中存在对应配方，产出同样计入统计）
  { itemId: 2306, name: '抽水站', basePower: 0, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2307, name: '原油萃取站', basePower: 0, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2316, name: '大型采矿机', basePower: 0, speedMultiplier: 1.0, canAccelerate: false },

  // 火箭 / 弹射（无配方产出，仅耗电）
  { itemId: 2311, name: '电磁轨道弹射器', basePower: 1800, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2312, name: '垂直发射井', basePower: 18000, speedMultiplier: 1.0, canAccelerate: false },

  // 物流 / 辅助建筑
  { itemId: 2103, name: '物流运输站', basePower: 0, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2104, name: '星际物流运输站', basePower: 0, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2011, name: '低速分拣器', basePower: 18, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2012, name: '高速分拣器', basePower: 36, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2013, name: '极速分拣器', basePower: 72, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2040, name: '自动集装机', basePower: 144, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2030, name: '流速器', basePower: 36, speedMultiplier: 1.0, canAccelerate: false },
  { itemId: 2313, name: '喷涂机', basePower: 90, speedMultiplier: 1.0, canAccelerate: false },
];

/** 快速查询映射 */
export const buildingPowerMap = new Map<number, BuildingPowerData>(
  buildingPowerData.map(d => [d.itemId, d])
);
