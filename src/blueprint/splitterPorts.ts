import type { BlueprintBuilding } from "./parser";
import type { SplitterParameters } from "./parser";
import { findByIndex, splitterPortAt } from "./sorter";
import { isBelt, isInserter, isSplitter } from "@/data/items";

/**
 * 四向分流器（2020）各口的角色与交互规则。
 *
 * 口编号 0=+y、1=+x、2=-y、3=-x（见 `@/data/splitter`）。角色判定：
 * - **输入口**：对端（传送带/分拣器）把货物送进分流器 → 该口可设"优先输入"
 * - **输出口**：分流器把货物送给对端 → 该口可设"优先输出"，并且可以再挂**筛选**物品
 *
 * 数据依据（游戏 0.10.35 实测，见 tests/tools/dumpParams.ts）：
 * - `parameters.priority[port]` = 该口是否设了优先（输入/输出由口的方向决定）
 * - 筛选物品存在建筑的 `filterId` 字段，只挂在"优先输出"口上
 *   （样本 sample_throughput.txt：priority=[1,0,0,0] + filterId=6001，
 *   该口的分拣器/传送带记录里是 inputFromSlot=0，即分流器从 0 口送出）
 * - 传送带直连分流器时，口编号写在传送带的 `outputToSlot`/`inputFromSlot`；
 *   分拣器直连时游戏写 slot=-1，口只能按对端方向反推（与 sorter.ts 一致）
 */

export type SplitterPortKind = "in" | "out";

/** 该口是否已设优先 */
export function isPortPrioritized(
    building: BlueprintBuilding,
    port: number
): boolean {
    const p = building.parameters as SplitterParameters | null;
    return p !== null && p.priority[port] === true;
}

/** 分流器各口的角色（未连接的口不在表里） */
export function splitterPortKinds(
    buildings: readonly BlueprintBuilding[],
    splitterIndex: number
): Map<number, SplitterPortKind> {
    const kinds = new Map<number, SplitterPortKind>();
    const sp = findByIndex(buildings, splitterIndex);
    if (!sp || !isSplitter(sp.itemId)) return kinds;
    for (const b of buildings) {
        if (isBelt(b.itemId)) {
            // 传送带：口编号就在 wire 字段里（游戏实测）
            if (b.outputObjIdx === splitterIndex && b.outputToSlot >= 0)
                kinds.set(b.outputToSlot, "in");
            else if (b.inputObjIdx === splitterIndex && b.inputFromSlot >= 0)
                kinds.set(b.inputFromSlot, "out");
        } else if (isInserter(b.itemId)) {
            // 分拣器：游戏写 slot=-1，按对端方向反推口编号
            if (b.outputObjIdx === splitterIndex) {
                const port = splitterPortAt(
                    sp,
                    findByIndex(buildings, b.inputObjIdx),
                    b.localOffset[0]
                );
                if (port >= 0) kinds.set(port, "in");
            } else if (b.inputObjIdx === splitterIndex) {
                const port = splitterPortAt(
                    sp,
                    findByIndex(buildings, b.outputObjIdx),
                    b.localOffset[1]
                );
                if (port >= 0) kinds.set(port, "out");
            }
        }
    }
    return kinds;
}

/** 单个口的角色；未连接返回 null */
export function splitterPortKind(
    buildings: readonly BlueprintBuilding[],
    splitterIndex: number,
    port: number
): SplitterPortKind | null {
    return splitterPortKinds(buildings, splitterIndex).get(port) ?? null;
}

/** 该分流器是否还有"已设优先的输出口"（筛选必须有挂载的口） */
export function hasPrioritizedOutput(
    buildings: readonly BlueprintBuilding[],
    splitter: BlueprintBuilding
): boolean {
    const p = splitter.parameters as SplitterParameters | null;
    if (!p) return false;
    const kinds = splitterPortKinds(buildings, splitter.index);
    for (let i = 0; i < p.priority.length; i++)
        if (p.priority[i] && kinds.get(i) === "out") return true;
    return false;
}

/** 左键点击某个口的结果 */
export type SplitterPortClickAction = "priority" | "filter" | "none";

/**
 * 左键点击口的行为（与游戏一致）：
 * - 未设优先 → 设优先输入/输出
 * - 已设优先且是**输出口** → 打开筛选物品选择
 * - 已设优先但是输入口 → 无操作（输入口没有筛选，取消用右键）
 */
export function splitterPortClickAction(
    prioritized: boolean,
    kind: SplitterPortKind | null
): SplitterPortClickAction {
    if (!prioritized) return "priority";
    return kind === "out" ? "filter" : "none";
}
