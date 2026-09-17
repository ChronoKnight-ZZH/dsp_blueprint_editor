import { BlueprintBuilding, BlueprintData } from "./parser";
import { itemsMap, isBelt, isInserter } from "@/data/items";
import { Command, Updater } from "@/command";

/**
 * 建筑升降级边（有向：低级 → 高级）。
 * 注：原说明里 `[2302, 2319] // 位面 → 负熵` 有误——2302 是电弧熔炉、2315 才是位面熔炉，
 *   按 "位面 → 负熵" 的注释意图与 grid 等级递增（2302/2315/2319 = MK1/2/3）修正为 [2315, 2319]。
 */
export const upgradeEdges: [number, number][] = [
    // 传送带
    [2001, 2002], // MK1 → MK2
    [2002, 2003], // MK2 → MK3

    // 分拣器
    [2011, 2012], // MK1 → MK2
    [2012, 2013], // MK2 → MK3
    [2013, 2014], // MK3 → MK4

    // 制造台
    [2303, 2304], // MK1 → MK2
    [2304, 2305], // MK2 → MK3
    [2305, 2318], // MK3 → MK4

    // 熔炉
    [2302, 2315], // 电弧 → 位面
    [2315, 2319], // 位面 → 负熵

    // 研究站
    [2901, 2902], // MK1 → MK2

    // 化工厂
    [2309, 2317], // MK1 → MK2
];

// 升级邻接表
const upAdj: Record<number, number[]> = {};
// 降级邻接表（反向）
const downAdj: Record<number, number[]> = {};
for (const [a, b] of upgradeEdges) {
    (upAdj[a] ||= []).push(b);
    (downAdj[b] ||= []).push(a);
}

/** 从 start 出发走 n 步能到达的节点（恰好 n 步的前沿，不含自身；与说明中的 reachN 语义一致） */
function reachN(adj: Record<number, number[]>, start: number, n: number): number[] {
    let cur = new Set<number>([start]);
    for (let i = 0; i < n; i++) {
        const next = new Set<number>();
        for (const node of cur) {
            for (const nb of adj[node] || []) {
                next.add(nb);
            }
        }
        cur = next;
        if (cur.size === 0) break;
    }
    return [...cur];
}

/** 所有参与升降级的建筑 itemId（去重、有序） */
export const upgradeableItems: number[] = (() => {
    const s = new Set<number>();
    for (const [a, b] of upgradeEdges) {
        s.add(a);
        s.add(b);
    }
    return [...s].sort((x, y) => x - y);
})();

/**
 * 返回 fromId 可升降到达的所有目标 itemId（升级 + 降级，含跳级）。
 * 遍历 1..maxSteps 步的 reachN 前沿并取并集——等价于在升降级图上从 fromId
 * 能到达的全部节点。maxSteps 取最长链长度（分拣器 4 级 = 3 步）即可覆盖。
 */
export function reachableTargets(fromId: number): number[] {
    if (!upgradeableItems.includes(fromId))
        return [];
    const maxSteps = upgradeableItems.length;
    const merged = new Set<number>();
    for (let n = 1; n <= maxSteps; n++) {
        for (const t of reachN(upAdj, fromId, n))
            merged.add(t);
        for (const t of reachN(downAdj, fromId, n))
            merged.add(t);
    }
    return [...merged].sort((x, y) => x - y);
}

/**
 * 建筑升降级命令：把蓝图中所有 itemId === fromItemId 的建筑
 * 改写为 toItemId，并同步 modelIndex（取目标物品的 models[0]）。
 *
 * 适用范围仅限参数格式在各等级间一致的建筑（传送带/分拣器/制造台/熔炉/研究站/化工厂），
 * 它们的 parameters 在升降级后无需改动，原样保留即可。
 */
export class UpgradeCommand implements Command {
    private upgraded: { b: BlueprintBuilding; oldItemId: number; oldModelIndex: number }[] = [];
    private toModelIndex: number;

    constructor(bp: BlueprintData, private fromItemId: number, private toItemId: number) {
        const toItem = itemsMap.get(toItemId);
        if (!toItem)
            throw new Error(`Unknown target item ${toItemId}`);
        if (!toItem.models.length)
            throw new Error(`Target item ${toItemId} has no model`);
        this.toModelIndex = toItem.models[0];

        for (const b of bp.buildings) {
            if (b.itemId === fromItemId) {
                this.upgraded.push({
                    b,
                    oldItemId: b.itemId,
                    oldModelIndex: b.modelIndex,
                });
            }
        }
    }

    private apply(itemId: number, modelIndex: number, updater: Updater) {
        for (const { b } of this.upgraded) {
            b.itemId = itemId;
            b.modelIndex = modelIndex;
            this.dispatchIconUpdate(b, updater);
        }
    }

    /**
     * 按 building.itemId 类型分发到正确的图标刷新通道。
     *
     * 传送带/分拣器的图标挂在 updateBeltIcon/updateSorterIcon 通道，只有当
     * iconId>0 / filterId>0 时才在 IconGeometry.indexMap 中注册槽位。若统一走
     * updateBuildingIcon，这两类建筑会在 IconGeometry.updateIconId 里找不到
     * 槽位而抛 'No icon to update'，故需按类型分流。
     */
    private dispatchIconUpdate(b: BlueprintBuilding, updater: Updater) {
        if (isBelt(b.itemId))
            updater.updateBeltIcon.dispatch(b);
        else if (isInserter(b.itemId))
            updater.updateSorterIcon.dispatch(b);
        else
            updater.updateBuildingIcon.dispatch(b);
    }

    do(_data: BlueprintData, updater: Updater) {
        this.apply(this.toItemId, this.toModelIndex, updater);
    }

    undo(_data: BlueprintData, updater: Updater) {
        // 复用 dispatchIconUpdate 的按类型分发逻辑，保证 do/undo 对称
        for (const { b, oldItemId, oldModelIndex } of this.upgraded) {
            b.itemId = oldItemId;
            b.modelIndex = oldModelIndex;
            this.dispatchIconUpdate(b, updater);
        }
    }

    merge() { return false; }
}
