import { assetResolver } from "@lib/asset-resolver";
import { itemsMap } from "./items";
import { recipesMap } from "./recipes";

/**
 * 图标 URL。
 *
 * 具体实现由 `@lib/asset-resolver` 在构建期决定（见 `src/lib/assets/types.ts`）：
 * - 编辑器构建 → `require.context` / `eager` 模板字符串 `import()`，URL 由 publicPath 生成；
 * - 库构建（UMD/ESM）→ `assetBaseUrl` 拼字符串 + 构建期注入的图标清单，
 *   图标不存在时**直接 reject 而不发请求**（避免 404）。
 */
export async function itemRecipeIconUrl(name: string): Promise<string> {
    return assetResolver.itemRecipeIconUrl(name);
}

export async function techIconUrl(techId: number): Promise<string> {
    return assetResolver.techIconUrl(techId);
}

export async function signalIconUrl(signalId: number): Promise<string> {
    return assetResolver.signalIconUrl(signalId);
}

export function signalIconId(signalId: number) {
    return signalId;
}
export function itemIconId(itemId: number) {
    return itemId;
}
export function recipeIconId(recipeId: number) {
    const r = recipesMap.get(recipeId)!;
    if (r.icon) return recipeId + 20000;
    return itemIconId(r.to[0].item.id);
}
export function techIconId(techId: number) {
    return techId + 40000;
}

export function iconUrl(iconId: number) {
    if (iconId < 1000) return signalIconUrl(iconId);
    if (iconId < 20000) return itemRecipeIconUrl(itemsMap.get(iconId)!.icon);
    if (iconId < 40000)
        return itemRecipeIconUrl(recipesMap.get(iconId - 20000)!.icon!);
    if (iconId < 60000) return techIconUrl(iconId - 40000);
    throw new Error(`Unknown icon ${iconId}`);
}

export function* allIconIds() {
    for (const i of itemsMap.values()) yield itemIconId(i.id);

    for (const r of recipesMap.values()) {
        if (r.icon) yield recipeIconId(r.id);
    }

    for (const s of signal) {
        yield signalIconId(s.id);
    }

    for (const t of tech) {
        yield techIconId(t.id);
    }
}

import { tech } from "./techIconsData";
import { signal } from "./signalIconsData";
