// src/data/acceleratorData.ts
export enum AcceleratorItem {
  None = 0,
  MkI = 1,
  MkII = 2,
  MkIII = 3,
}

export interface AcceleratorBonus {
  /** 额外产出模式生产倍率加成（小数，如 0.125 表示 +12.5%） */
  extraOutput: number;
  /** 加速生产模式生产倍率加成（小数，如 0.25 表示 +25%） */
  accelerate: number;
  /** 电量消耗加成（小数，如 0.30 表示 +30%） */
  power: number;
  /** 每瓶增产剂可喷涂的物品数量 */
  sprayCapacity: number;
}

export const acceleratorBonuses: Record<AcceleratorItem, AcceleratorBonus> = {
  [AcceleratorItem.None]: { extraOutput: 0, accelerate: 0, power: 0, sprayCapacity: 0 },
  [AcceleratorItem.MkI]: { extraOutput: 0.125, accelerate: 0.25, power: 0.30, sprayCapacity: 12 },
  [AcceleratorItem.MkII]: { extraOutput: 0.20, accelerate: 0.50, power: 0.70, sprayCapacity: 24 },
  [AcceleratorItem.MkIII]: { extraOutput: 0.25, accelerate: 1.00, power: 1.50, sprayCapacity: 75 },
};