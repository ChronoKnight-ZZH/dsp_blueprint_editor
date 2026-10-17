import { BlueprintBuilding, SplitterParameters } from "./parser";
import { isSplitter } from "@/data/items";
import { splitterPortKinds } from "./splitterPorts";

/**
 * 传送带连接分流器的 6 种状态（定义与检测）。
 *
 * 标定来源：tests/unit/blueprint/fixtures/splitter_6states_game_sample.txt
 * （游戏 0.10.35 实测，6 个分流器按坐标从左到右正好对应状态 1-6）：
 *
 * | 状态 | 名称                        | 连接（口角色）            | priority        | filterId |
 * |----|-----------------------------|--------------------------|-----------------|----------|
 * | 1  | 一进模式                     | 1 输入口                 | 全 0            | 0        |
 * | 2  | 溢出模式                     | 1 输出口                 | 全 0            | 0        |
 * | 3  | 一进一出模式                 | 1 输入 + 1 输出          | 全 0            | 0        |
 * | 4  | 一进一出、开启优先输入       | 1 输入 + 1 输出          | 优先输入口      | 0        |
 * | 5  | 一进一出、开启优先输出       | 1 输入 + 1 输出          | 优先输出口      | 0        |
 * | 6  | 一进一出、开启优先输出+筛选  | 1 输入 + 1 输出          | 优先输出口      | >0（样本为铁矿 1001）|
 *
 * 状态完全由蓝图数据决定（`priority[4]` + `filterId` + 各口输入/输出角色），
 * 检测函数 `splitterStateOf` 与游戏的编码字段一一对应；优先级/筛选改动、
 * 传送带连接改动后重新调用即可得到最新状态（见 `@/blueprint/splitterPorts`）。
 */

/** 6 种连接状态的枚举值（与上表行号一致） */
export type SplitterState = 1 | 2 | 3 | 4 | 5 | 6;

/** 6 种状态的中文名称（索引 = 状态号 - 1） */
export const SPLITTER_STATE_NAMES: ReadonlyArray<string> = [
    "一进模式",
    "溢出模式",
    "一进一出模式",
    "一进一出、开启优先输入",
    "一进一出、开启优先输出",
    "一进一出、开启优先输出并筛选",
];

/** 该分流器当前属于 6 种连接状态中的哪一种；连接数/设置不匹配时返回 null */
export function splitterStateOf(
    buildings: readonly BlueprintBuilding[],
    splitter: BlueprintBuilding
): SplitterState | null {
    if (!isSplitter(splitter.itemId)) return null;
    const p = splitter.parameters as SplitterParameters | null;
    if (!p) return null;
    const kinds = splitterPortKinds(buildings, splitter.index);

    const inputs: number[] = [];
    const outputs: number[] = [];
    let priorityInput = false;
    let priorityOutput = false;
    for (let i = 0; i < 4; i++) {
        const kind = kinds.get(i) ?? null;
        if (kind === "in") inputs.push(i);
        else if (kind === "out") outputs.push(i);
        if (p.priority[i] === true) {
            if (kind === "in") priorityInput = true;
            else if (kind === "out") priorityOutput = true;
        }
    }

    // 状态 1/2/3：只有连接数量，没有任何优先级/筛选设置
    const noSettings =
        !priorityInput && !priorityOutput && splitter.filterId === 0;
    if (noSettings) {
        if (inputs.length === 1 && outputs.length === 0) return 1; // 一进
        if (inputs.length === 0 && outputs.length === 1) return 2; // 溢出
        if (inputs.length === 1 && outputs.length === 1) return 3; // 一进一出
        return null;
    }

    // 状态 4/5/6：一进一出 + 相应设置
    if (inputs.length !== 1 || outputs.length !== 1) return null;
    // 同时设了优先输入与优先输出（游戏允许，但不属 6 种样本状态）
    if (priorityInput && priorityOutput) return null;
    if (priorityInput) return splitter.filterId === 0 ? 4 : null;
    if (priorityOutput) return splitter.filterId > 0 ? 6 : 5;
    return null;
}

/** 便捷重载：以 index 取分流器（找不到或非分流器返回 null） */
export function splitterStateAt(
    buildings: readonly BlueprintBuilding[],
    splitterIndex: number
): SplitterState | null {
    const sp = buildings.find((b) => b.index === splitterIndex);
    return sp === undefined ? null : splitterStateOf(buildings, sp);
}
