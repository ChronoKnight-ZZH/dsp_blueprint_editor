import { Matrix4, Vector2, Vector3 } from "three";
import { buildingMeta } from "@/data/building";
import { recipeIconId, itemIconId } from "@/data/icons";
import type { BlueprintBuilding } from "@/blueprint/parser";
import { INSERTER_HEIGHT } from "./geometryHelpers";

/**
 * 图标相关的纯计算：图标 id 解析 + 图标在建筑局部空间里的位置/缩放。
 *
 * 从 `BlueprintEditor.vue` 下沉（方案阶段 A），行为与原来完全一致：
 * 共享的 `trans` 临时矩阵沿用旧写法，避免每次调用都分配 `Matrix4`。
 */

const scale3 = new Vector3();
const trans = new Matrix4();

/** 建筑图标 id：有配方用配方图标，否则用物品图标 */
export function buildingIconId(b: BlueprintBuilding) {
    return b.recipeId > 0 ? recipeIconId(b.recipeId) : itemIconId(b.itemId);
}

/** 传送带图标缩放 */
export const beltIconScale = new Vector2(1.1, 1.1);
const beltIconTrans = new Matrix4().makeTranslation(0, 0, 0.5);

/** 传送带图标位置（带子中心偏上一点） */
export function beltIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3
) {
    trans.multiplyMatrices(buildingTrans, beltIconTrans);
    pos.setFromMatrixPosition(trans);
}

/** 分拣器图标缩放 */
export const sorterIconScale = new Vector2(0.8, 0.8);
const sorterIconTrans = new Matrix4().makeTranslation(0, 0, INSERTER_HEIGHT);

/** 分拣器图标位置 */
export function sorterIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3
) {
    trans.multiplyMatrices(buildingTrans, sorterIconTrans);
    pos.setFromMatrixPosition(trans);
}

/**
 * 普通建筑图标位置与缩放。
 * 返回 `false` 表示没有元数据（未知建筑，调用方应跳过该图标）。
 */
export function buildingIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3,
    scale: Vector2
) {
    const meta = buildingMeta.get(b.modelIndex);
    if (meta === undefined) return false;
    trans.multiplyMatrices(buildingTrans, meta.iconTrans);
    scale3.setFromMatrixScale(trans);
    scale.set(scale3.x, scale3.y);
    pos.setFromMatrixPosition(trans);
    return true;
}
