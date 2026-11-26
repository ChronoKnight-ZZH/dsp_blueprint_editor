/**
 * 外部 GLB 建筑模型资源注册表。
 *
 * 策略：外部 GLB 优先，`@/data/building` 的元数据表永远作为回退。
 *
 * 资产「怎么变成 URL」由 `@lib/asset-resolver` 决定（构建期用 `resolve.alias` 切换）：
 * - 编辑器构建 → `assetResolver.webpack.ts`：同步 `require.context`，进 bundle 的只有
 *   URL 字符串（每个几十字节），`.glb` 由 asset/resource 规则输出成独立文件，
 *   只有建筑真的出现时才 `fetch` 下载，首屏不加载任何模型数据；
 * - 库构建 → `assetResolver.ts`：URL = `assetBaseUrl` 拼字符串，模型清单由构建脚本注入。
 *
 * 两种实现都由 `keys()` 等价的「静态文件清单」支撑，因此
 * **不产生任何网络请求**就能判定「文件不存在 → 静默回退」。
 */

import { assetResolver } from "@lib/asset-resolver";

/** 磁盘上（构建产物里）实际存在的模型名（不含目录与扩展名），例如 `smelter`、`turret-laser`。 */
export const availableModelNames: ReadonlySet<string> =
    collectAvailableModelNames();

function collectAvailableModelNames(): ReadonlySet<string> {
    try {
        return new Set<string>(assetResolver.glbModelNames());
    } catch (e) {
        console.warn("[glb] 读取模型清单失败，全部建筑回退元数据表", e);
        return new Set<string>();
    }
}

/** 一个图标名对应的模型描述 */
export interface ModelAlias {
    /** 首选模型名（不含 .glb） */
    primary: string;
    /** primary 缺失时按顺序尝试的备选文件 */
    fallbacks?: readonly string[];
    /** 变形模式：按 `Item.models` 中 modelIndex 的下标选取，优先于 primary/fallbacks */
    variants?: readonly string[];
    /** 说明，供 code review 与实现报告复核 */
    note: string;
}

/**
 * 显式别名表：`Item.icon` → 实际 GLB 文件名。
 *
 * 未在此表中登记且文件名与图标名不一致的，一律视为“未匹配”并回退元数据表，
 * 不做任何模糊匹配（避免把 A 建筑的模型错挂到 B 建筑上）。
 */
export const iconModelAliases: Readonly<Record<string, ModelAlias>> = {
    "assembler-1": {
        primary: "assembler-1",
        note: "制造台 Mk.I：实际导出名是 assembler-1；旧的 assembler.glb 与其逐字节相同，已清理。",
    },
    "splitter-4dir": {
        primary: "splitter-a",
        variants: ["splitter-a", "splitter-b", "splitter-c"],
        note: "四向分流器三种变形：Item.models=[38,39,40] 的下标 0/1/2 → splitter-a/b/c（对应 buildingMeta 里的 四向分流器 a/b/c）。旧的 splitter-1/2/3.glb 与 a/b/c 逐字节相同，已清理。",
    },
    "accumulator-full": {
        primary: "accumulator",
        note: "蓄电器（满）与蓄电器共用同一个建筑模型，复用 accumulator.glb。",
    },
    // 以下两条虽然文件名与图标名一致，但显式登记，避免后来者误以为要把两代采矿机合并
    "mining-drill": {
        primary: "mining-drill",
        note: "采矿机（Item 2301 / model 57）：独立模型，不与大型采矿机合并。",
    },
    "mining-drill-mk2": {
        primary: "mining-drill-mk2",
        note: "大型采矿机（Item 2316 / model 256）：`mk2` 是导出名，等同于“大型采矿机”，用的是另一个 GLB。",
    },
};

/**
 * 图标名 + 变形下标 → 候选模型名（按优先级排列，首个在磁盘上存在的即为最终模型）。
 */
export function modelNameCandidates(
    iconName: string,
    variantIndex = 0
): string[] {
    const alias = iconModelAliases[iconName];
    if (alias?.variants?.length) {
        const i = Math.max(
            0,
            Math.min(variantIndex, alias.variants.length - 1)
        );
        return [alias.variants[i]];
    }
    if (alias !== undefined) return [alias.primary, ...(alias.fallbacks ?? [])];
    return [iconName];
}

/** 图标名 + 变形下标 → 实际可用的 GLB 模型名；无匹配返回 null（调用方回退元数据表）。 */
export function resolveModelName(
    iconName: string,
    variantIndex = 0
): string | null {
    for (const name of modelNameCandidates(iconName, variantIndex)) {
        if (availableModelNames.has(name)) return name;
    }
    return null;
}

const urlCache = new Map<string, Promise<string | null>>();

/**
 * 模型名 → 最终 URL（编辑器：webpack 生成的 publicPath URL；库：assetBaseUrl 拼接）。
 *
 * - 模型未注册/文件不存在 → 返回 null（不抛错，不回退到猜路径）
 * - 同一个模型名只解析一次（缓存 Promise），重复调用共享结果
 * - 资源解析（chunk 加载）失败也只返回 null，由调用方静默回退元数据表
 */
export function modelUrl(name: string): Promise<string | null> {
    const cached = urlCache.get(name);
    if (cached !== undefined) return cached;
    const task = (async (): Promise<string | null> => {
        if (!availableModelNames.has(name)) return null;
        try {
            return await assetResolver.glbModelUrl(name);
        } catch (e) {
            console.warn(`[glb] 模型 ${name} 的资源解析失败，回退元数据表`, e);
            return null;
        }
    })();
    urlCache.set(name, task);
    return task;
}
