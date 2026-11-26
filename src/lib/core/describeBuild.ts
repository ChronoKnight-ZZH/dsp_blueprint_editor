import type { Matrix4 } from "three";
import type { BlueprintBuilding } from "@/blueprint/parser";
import type { BVH } from "@/bvh/bvh";
import { buildingMeta } from "@/data/building";
import { isBelt, isInserter } from "@/data/items";
import type { ViewerRenderSettings } from "@/render/renderSettingsTypes";
import type { BuildStats } from "./types";

/**
 * 构建结果的可快照诊断对象。
 *
 * 用途（方案附录 A）：
 *   1. 阶段 A「行为不变」的自动化基线——把纯数据产物做成 jest 快照
 *   2. 线上问题定位：用户报告渲染异常时对比 `perModelIndex` 与 `selectBoxes`
 *   3. Viewer / Editor 一致性校验：同一蓝图两边产出的 `describeBuild` 必须相等
 */
export interface BuildDescription {
    settings: ViewerRenderSettings;
    buildingCount: number;
    /** 每个 modelIndex 的建筑数与分类计数 */
    perModelIndex: Record<
        number,
        { total: number; glb: number; fallback: number; hidden: number }
    >;
    /** 走 GLB 的模型组 */
    glbGroups: { modelIndex: number; count: number }[];
    fallbackBoxCount: number;
    unknownModelIndexes: number[];
    /** 每个选择盒的 Matrix4.elements（已四舍五入到 6 位，避免浮点噪声破坏快照） */
    selectBoxes: number[][];
    subscriptCount: number;
    iconCount: number;
}

const PRECISION = 1e6;

function roundMatrix(m: Matrix4): number[] {
    return m.elements.map((v) => Math.round(v * PRECISION) / PRECISION);
}

export interface DescribeBuildInput {
    settings: ViewerRenderSettings;
    buildings: BlueprintBuilding[];
    bvh: BVH;
    stats: BuildStats;
}

/**
 * 从一次构建的产物生成诊断描述。
 *
 * `perModelIndex` 的 `glb` / `fallback` 计数来自 `stats.perModelGlbCounts`：
 * 前者是**走 GLB 渲染**的实例数，后者是总数减去它（含隐藏占位）。
 * 注意 `hidden` 只统计没有 `buildingMeta` 的未知模型。
 */
export function describeBuild(input: DescribeBuildInput): BuildDescription {
    const { settings, buildings, bvh, stats } = input;

    const perModelIndex: BuildDescription["perModelIndex"] = {};
    const unknown = new Set(stats.unknownModelIndexes);

    for (const b of buildings) {
        const key = b.modelIndex;
        let entry = perModelIndex[key];
        if (entry === undefined) {
            entry = { total: 0, glb: 0, fallback: 0, hidden: 0 };
            perModelIndex[key] = entry;
        }
        entry.total++;
        if (unknown.has(key) || !buildingMeta.has(key)) {
            entry.hidden++;
            entry.fallback++;
        } else if (isBelt(b.itemId) || isInserter(b.itemId)) {
            // 带子与分拣器走程序化几何，不算 fallback 盒
        } else {
            entry.fallback++;
        }
    }

    // 走 GLB 的实例从 fallback 里扣除
    for (const [key, count] of Object.entries(stats.perModelGlbCounts)) {
        const entry = perModelIndex[Number(key)];
        if (entry === undefined) continue;
        entry.glb = count;
        entry.fallback = Math.max(0, entry.fallback - count);
    }

    const glbGroups = Object.entries(stats.perModelGlbCounts)
        .map(([modelIndex, count]) => ({
            modelIndex: Number(modelIndex),
            count,
        }))
        .sort((a, b) => a.modelIndex - b.modelIndex);

    return {
        settings,
        buildingCount: stats.buildingCount,
        perModelIndex,
        glbGroups,
        fallbackBoxCount: stats.fallbackBoxCount,
        unknownModelIndexes: [...stats.unknownModelIndexes],
        selectBoxes: bvh.boxes.map(roundMatrix),
        subscriptCount: stats.subscriptCount,
        iconCount: stats.iconCount,
    };
}
