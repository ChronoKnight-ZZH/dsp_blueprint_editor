import { Matrix4 } from "three";
import { BVH } from "@/bvh/bvh";
import { buildingMeta } from "@/data/building";
import { isInserter } from "@/data/items";
import type { BlueprintBuilding } from "@/blueprint/parser";
import { inserterTrans } from "./geometryHelpers";

export interface BuildBVHResult {
    bvh: BVH;
    /** 缺少 buildingMeta、只能放退化矩阵（不可拾取）的 modelIndex，去重升序 */
    unknownModelIndexes: number[];
}

/**
 * 由建筑的世界变换生成选择盒 + BVH。
 *
 * 从 `BlueprintEditor.vue` 下沉。**修复了现存白屏缺陷**：
 * 旧实现用 `buildingMeta.get(b.modelIndex)!` 断言，遇到没有元数据的 modelIndex
 * （例如 117 轨道采集器：有 GLB 但 `building.ts` 未登记）会直接抛 TypeError，
 * 编辑器整页白屏。`buildBoxes` 对同样情况是有兜底的，这里统一成同样策略：
 * 未知模型 → 视作不可见、不可拾取，并汇总到 `unknownModelIndexes` 供上层上报。
 *
 * ⚠️ 占位矩阵**不能用零缩放**：`BVH` 会把包围盒退化成点，`longestAxis` 返回 null
 * 后抛 `Unexpected empty box`（实测：蓝图里出现 2 个以上未知建筑即触发）。
 * 改用 1e-6 的极小缩放：包围盒仍有 1e-6 的尺寸，BVH 可正常构建；
 * 视觉上不可见，拾取时也几乎不可能命中。
 */
export function buildBVH(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[]
): BuildBVHResult {
    const temp = new Matrix4();
    /** 未知建筑的占位缩放：极小但非零，详见函数注释 */
    const HIDDEN_SCALE = 1e-6;
    const hidden = new Matrix4().makeScale(
        HIDDEN_SCALE,
        HIDDEN_SCALE,
        HIDDEN_SCALE
    );
    const unknown = new Set<number>();

    const selectBoxes = buildings.map((b, i) => {
        const meta = buildingMeta.get(b.modelIndex);
        const box = new Matrix4();
        if (isInserter(b.itemId)) {
            // 与 buildBuildings.ts 分拣器横梁使用完全相同的几何参数：
            //   ARM_OVER = 0.3, s = len + 2·ARM_OVER, scale(1,1,s)
            //   z 偏移 -len/2，y 抬升 BEAM_EXTRA_LIFT = 0.1
            const len = inserterTrans(transforms[i], box);
            const ARM_OVER = 0.3;
            const BEAM_EXTRA_LIFT = 0.1;
            const s = len + 2 * ARM_OVER;
            box.multiply(temp.makeTranslation(0, BEAM_EXTRA_LIFT, 0));
            box.multiply(temp.makeTranslation(0, 0, -0.5 * len));
            box.multiply(temp.makeScale(0.6, 0.6, s));
            return box;
        }
        if (meta === undefined) {
            // 未知建筑：极小占位盒，避免整页抛错（与 buildBoxes 的隐藏策略一致）
            unknown.add(b.modelIndex);
            return box.copy(hidden);
        }
        box.multiplyMatrices(transforms[i][0], meta.selectUnitBoxTrans);
        return box;
    });

    return {
        bvh: new BVH(selectBoxes),
        unknownModelIndexes: Array.from(unknown).sort((a, b) => a - b),
    };
}
