import { AcceleratorMode, BlueprintBuilding, BlueprintData, ResearchMode } from './parser';
import { recipesMap } from '@/data/recipes';
import { buildingPowerMap } from '@/data/buildingPowerData';
import { acceleratorBonuses, AcceleratorItem } from '@/data/acceleratorData';

export interface StatsOptions {
  /** 是否启用加速模式计算 */
  useAccelerator: boolean;
  /** 选择的增产剂等级 */
  acceleratorItem: AcceleratorItem;
}

export interface ItemStats {
  itemId: number;
  produced: number; // 每分钟产出
  consumed: number; // 每分钟消耗
  net: number;      // 净产出
}

export interface ProductionStats {
  items: ItemStats[];
  totalPower: number; // kW
}

/** 分馏塔（特殊建筑，蓝图中无配方） */
const FRACTIONATOR_ITEM_ID = 2314;
const HYDROGEN_ID = 1120;
const DEUTERIUM_ID = 1121;
/** 分馏塔默认每分钟处理量（72 氢 -> 72 重氢） */
const FRACTIONATOR_BASE_RATE = 72;

/** 增产剂等级 -> 增产剂物品 ID */
const PROLIFERATOR_ITEM_IDS: Record<AcceleratorItem, number> = {
  [AcceleratorItem.None]: 0,
  [AcceleratorItem.MkI]: 1141,
  [AcceleratorItem.MkII]: 1142,
  [AcceleratorItem.MkIII]: 1143,
};

/** 取建筑的加速模式；仅 AssembleParamerters / LabParamerters 含此字段 */
function acceleratorOf(b: BlueprintBuilding): AcceleratorMode | null {
  const p = b.parameters;
  if (p !== null && 'acceleratorMode' in p)
    return p.acceleratorMode;
  return null;
}

/**
 * 计算蓝图生产统计（理论满速汇总）
 * @param bp 蓝图数据
 * @param options 统计选项
 */
export function calculateProductionStats(
  bp: BlueprintData,
  options: StatsOptions
): ProductionStats {
  const itemMap = new Map<number, { produced: number; consumed: number }>();
  let totalPower = 0;
  // 被喷涂物品的每分钟总流量，用于推算增产剂本身的消耗
  let proliferatorBase = 0;

  const bonus = acceleratorBonuses[options.acceleratorItem];

  const addItem = (itemId: number, field: 'produced' | 'consumed', amount: number) => {
    const stat = itemMap.get(itemId) ?? { produced: 0, consumed: 0 };
    stat[field] += amount;
    itemMap.set(itemId, stat);
  };

  for (const building of bp.buildings) {
    const bpData = buildingPowerMap.get(building.itemId);
    if (!bpData) continue; // 未登记建筑跳过

    // 分馏塔没有 acceleratorMode 参数，喷涂效果固定等效为“生产加速”
    const isFractionator = building.itemId === FRACTIONATOR_ITEM_ID;
    const mode = isFractionator ? AcceleratorMode.Accelerate : acceleratorOf(building);
    const accelerated = options.useAccelerator && bpData.canAccelerate && mode !== null;

    // 1. 计算功耗（加速模式下额外耗电，两种模式耗电加成相同）
    const powerMult = accelerated ? 1 + bonus.power : 1;
    totalPower += bpData.basePower * powerMult;

    // 2. 分馏塔：无配方，固定氢 -> 重氢
    if (isFractionator) {
      let rate = FRACTIONATOR_BASE_RATE * bpData.speedMultiplier;
      if (accelerated)
        rate *= 1 + bonus.accelerate;
      addItem(HYDROGEN_ID, 'consumed', rate);
      addItem(DEUTERIUM_ID, 'produced', rate);
      if (accelerated)
        proliferatorBase += rate;
      continue;
    }

    // 3. 普通配方建筑（recipeId 是建筑顶层字段，0 表示无配方）
    if (building.recipeId <= 0) continue;
    const recipe = recipesMap.get(building.recipeId);
    if (!recipe) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown recipe ${building.recipeId} on building ${building.index}`);
      continue;
    }

    // 研究站处于“研究模式”时：不再产出矩阵，而是按相同节拍消耗矩阵
    const p = building.parameters;
    const researching = p !== null && 'researchMode' in p && p.researchMode === ResearchMode.Research;

    // 研究消耗不受增产剂加速影响（矩阵消耗速率不变）；生产模式才应用倍率
    let speedMult = bpData.speedMultiplier;
    if (!researching && accelerated) {
      if (mode === AcceleratorMode.Accelerate)
        speedMult *= 1 + bonus.accelerate;
      else if (mode === AcceleratorMode.ExtraOutput)
        speedMult *= 1 + bonus.extraOutput;
    }

    // 每分钟生产/消耗次数 = speedMult * 60秒 * 60帧 / recipe.time（帧）
    const timesPerMinute = speedMult * 3600 / recipe.time;

    if (researching) {
      // 消耗配方产物（矩阵），不再消耗配方原料
      for (const output of recipe.to)
        addItem(output.item.id, 'consumed', output.count * timesPerMinute);
    } else {
      for (const input of recipe.from) {
        const amount = input.count * timesPerMinute;
        addItem(input.item.id, 'consumed', amount);
        // 只有加速建筑的原料需要提前喷涂
        if (accelerated)
          proliferatorBase += amount;
      }
      for (const output of recipe.to)
        addItem(output.item.id, 'produced', output.count * timesPerMinute);
    }
  }

  // 增产剂本身的消耗（瓶/分）= 被喷涂物品总流量 / 每瓶可喷涂数量
  const proliferatorItemId = PROLIFERATOR_ITEM_IDS[options.acceleratorItem];
  if (proliferatorBase > 0 && bonus.sprayCapacity > 0 && proliferatorItemId > 0)
    addItem(proliferatorItemId, 'consumed', proliferatorBase / bonus.sprayCapacity);

  // 整理结果，按净产出降序（净消耗大的排末尾）
  const items: ItemStats[] = [];
  for (const [itemId, { produced, consumed }] of itemMap) {
    items.push({
      itemId,
      produced,
      consumed,
      net: produced - consumed,
    });
  }
  items.sort((a, b) => b.net - a.net);

  return { items, totalPower };
}
