import { fromStr, type BlueprintData } from "@/blueprint/parser";
import { calculateProductionStats } from "@/blueprint/stats";
import { itemsMap } from "@/data/items";
import { AcceleratorItem } from "@/data/acceleratorData";
import type { StatsListResult, StatsListValue, StatsListItem } from "./types";

/**
 * 统计列表：蓝图字符串 / BlueprintData + 增产剂等级 → 耗电 / 需求 / 输出。
 *
 * - 算法完全复用 `@/blueprint/stats` 的 `calculateProductionStats`，不改其一行；
 * - `demand` = `ItemStats.consumed`，`output` = `ItemStats.produced`（同一 itemId 既产又耗时两边各出现一次，保真）；
 * - `net` 不导出，宿主需要净量自行 `output - demand`；
 * - `name` 取 `itemsMap.get(itemId)?.name`，原文中文键、不翻译；查不到时 `"unknown"`（对齐 `i18n.ts` 的 `itemName` 约定）；
 * - `totalPower` 单位 kW；`count` 单位「每分钟」，与网页端同口径。
 */

const VALID_ACCELERATORS: ReadonlySet<number> = new Set([
    AcceleratorItem.None,
    AcceleratorItem.MkI,
    AcceleratorItem.MkII,
    AcceleratorItem.MkIII,
]);

/** 最小形状校验：只要求 buildings 是数组（与 `calculateProductionStats` 的实际契约一致） */
function isBlueprintData(v: unknown): v is BlueprintData {
    return (
        typeof v === "object" &&
        v !== null &&
        Array.isArray((v as { buildings?: unknown }).buildings)
    );
}

function toItem(itemId: number, count: number): StatsListItem {
    const name = itemsMap.get(itemId)?.name ?? "unknown";
    return { itemId, name, count };
}

export function calculateStatsList(
    input: string | BlueprintData,
    acceleratorItem: AcceleratorItem = AcceleratorItem.None,
): StatsListResult {
    // 1. 增产剂校验（防 bonus 为 undefined 时 `bonus.power` 抛 TypeError）
    if (
        !Number.isInteger(acceleratorItem) ||
        !VALID_ACCELERATORS.has(acceleratorItem)
    ) {
        return {
            ok: false,
            error: {
                code: "invalid-accelerator",
                message: `acceleratorItem must be 0|1|2|3, got ${String(acceleratorItem)}`,
            },
        };
    }

    // 2. 入参归一
    let bp: BlueprintData;
    if (typeof input === "string") {
        try {
            bp = fromStr(input.trim());
        } catch (e) {
            return {
                ok: false,
                error: {
                    code: "parse-failed",
                    message: e instanceof Error ? e.message : "parse failed",
                    cause: e,
                },
            };
        }
    } else if (isBlueprintData(input)) {
        bp = input;
    } else {
        return {
            ok: false,
            error: {
                code: "invalid-argument",
                message: "input must be a blueprint string or BlueprintData",
            },
        };
    }

    // 3. 复用算法：useAccelerator 由 acceleratorItem 推出，与网页端 `!== None` 等价
    try {
        const r = calculateProductionStats(bp, {
            useAccelerator: acceleratorItem !== AcceleratorItem.None,
            acceleratorItem,
        });

        const demand: StatsListItem[] = [];
        const output: StatsListItem[] = [];
        for (const it of r.items) {
            // 只保留非 0 边：纯消耗物品不进 output，纯产出物品不进 demand
            if (it.consumed !== 0) demand.push(toItem(it.itemId, it.consumed));
            if (it.produced !== 0) output.push(toItem(it.itemId, it.produced));
        }
        demand.sort((a, b) => b.count - a.count);
        output.sort((a, b) => b.count - a.count);

        const value: StatsListValue = { totalPower: r.totalPower, demand, output };
        return { ok: true, value };
    } catch (e) {
        // 坏数据（如 buildings 元素为 null）在 stats 内抛错，归为入参错误
        return {
            ok: false,
            error: {
                code: "invalid-argument",
                message: e instanceof Error ? e.message : "stats failed",
                cause: e,
            },
        };
    }
}