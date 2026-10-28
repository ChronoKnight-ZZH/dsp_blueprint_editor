import { Matrix4, Vector3 } from "three";
import { BVH } from "@/bvh";
import { BlueprintData, BlueprintBuilding } from "@/blueprint/parser";
import {
    calcBuildingTrans,
    findPosForAreas,
    PositionedBlueprint,
} from "@/blueprint/planet";
import { expandReformCells, ReformCell } from "@/blueprint/reform";
import { buildingMeta } from "@/data/building";
import { isInserter } from "@/data/items";

/**
 * 3D 场景重建的"数据半"：区域定位 + 建筑世界矩阵 + 选择盒 + 地基逐格数据。
 *
 * 这里刻意不碰 WebGL（不建 Mesh / 不建纹理），于是可以在单测里用真实蓝图直接跑，
 * 覆盖真正容易坏的一段：`findPosForAreas` → `calcBuildingTrans` → 选择盒 → BVH → 地基格。
 * 网格/材质那一半在 `BlueprintEditor.vue` 的 `buildBuildings` / `buildReforms` 里。
 */

/** 变换无效时的退化矩阵：零尺寸 + 原点 → 既不显示也不参与拾取 */
function hiddenMatrix() {
    return new Matrix4().makeScale(0, 0, 0);
}

/** 矩阵所有元素是否都是有限数（NaN/Infinity 的矩阵在 three 里等于"看不见"） */
export function isFiniteMatrix(m: Matrix4): boolean {
    return m.elements.every((e) => Number.isFinite(e));
}

/** 分拣器抬升量：选择盒与图标都沿法线抬高这么多（世界单位） */
export const INSERTER_HEIGHT = 0.3;

const temp = new Matrix4();
const inserterOffset = new Matrix4().makeTranslation(0, 0, -0.5);
const pos1 = new Vector3();
const pos2 = new Vector3();
const dir = new Vector3();

/** 分拣器的选择盒/图标位置：两端点各沿法线抬高，再按两点连线定向 */
export function inserterTrans(transforms: Matrix4[], trans: Matrix4) {
    pos1.setFromMatrixPosition(transforms[0]);
    dir.copy(pos1).normalize().multiplyScalar(INSERTER_HEIGHT);
    pos1.add(dir);

    pos2.setFromMatrixPosition(transforms[1]);
    dir.copy(pos2).normalize().multiplyScalar(INSERTER_HEIGHT);
    pos2.add(dir);

    trans.setPosition(pos1.x, pos1.y, pos1.z);
    trans.lookAt(pos1, pos2, pos1);
    return dir.subVectors(pos1, pos2).length();
}

/** 单个建筑的选择盒（= BVH 输入，也是选中高亮框的矩阵） */
function selectBoxFor(transforms: Matrix4[], b: BlueprintBuilding): Matrix4 {
    const box = new Matrix4();
    if (isInserter(b.itemId)) {
        const len = inserterTrans(transforms, box);
        box.multiply(temp.makeScale(0.5, 0.5, len));
        box.multiply(inserterOffset);
        return box;
    }
    const meta = buildingMeta.get(b.modelIndex);
    // 未知建筑（游戏新版本 / mod）：退化成建筑自身的 1×1×1 盒。
    // 不能用 `!` 断言 —— 一个未知模型会让整次重建抛错，旧模型被移除后场景就空了。
    if (meta === undefined) return box.copy(transforms[0]);
    return box.multiplyMatrices(transforms[0], meta.selectUnitBoxTrans);
}

/** 把 z（高度格）缺失/非有限的点按地面高度兜底，避免整条矩阵变 NaN、建筑彻底看不见 */
function withGroundZ(b: BlueprintBuilding): BlueprintBuilding {
    return {
        ...b,
        localOffset: b.localOffset.map((p) => ({
            x: p.x,
            y: p.y,
            z: Number.isFinite(p.z) ? p.z : 0,
        })) as BlueprintBuilding["localOffset"],
    };
}

export interface EditorSceneData {
    pos: PositionedBlueprint;
    /** 与 `data.buildings` 同序：每个建筑每个端点的世界矩阵 */
    transforms: Matrix4[][];
    /** 与 `data.buildings` 同序：选择盒（BVH 输入） */
    selectBoxes: Matrix4[];
    bvh: BVH;
    /** 地基逐格数据；`areaIndex` 越界的格已被剔除 */
    reformCells: ReformCell[];
    /** 因区域越界而无法定位的建筑下标（正常为空） */
    invalidBuildings: number[];
    /** 因高度格非有限而按地面兜底的建筑下标（历史上 expand 丢过 z，正常为空） */
    repairedBuildings: number[];
}

/**
 * 计算一次场景重建所需的全部纯数据。不修改 `data`。
 *
 * 容错策略：单个建筑的坐标坏掉时只让**这个建筑**不可见（或按地面兜底），
 * 不再让整次重建抛错 —— 抛错会连带整个模型层消失。
 */
export function buildSceneData(
    data: BlueprintData,
    R: number,
    segment: number
): EditorSceneData {
    const pos = findPosForAreas(data.areas, segment);
    const transforms: Matrix4[][] = [];
    const selectBoxes: Matrix4[] = [];
    const invalidBuildings: number[] = [];
    const repairedBuildings: number[] = [];

    data.buildings.forEach((b, i) => {
        let trans: Matrix4[] | null = null;
        if (pos.areas[b.areaIndex] !== undefined) {
            trans = calcBuildingTrans(R, pos, b);
            if (!trans.every(isFiniteMatrix)) {
                // 历史 bug 的蓝图里 z 可能是 NaN：按地面高度重算，至少让建筑可见
                trans = null;
                const repaired = calcBuildingTrans(R, pos, withGroundZ(b));
                if (repaired.every(isFiniteMatrix)) {
                    repairedBuildings.push(i);
                    trans = repaired;
                }
            }
        }
        if (trans === null) {
            invalidBuildings.push(i);
            const hidden = hiddenMatrix();
            transforms.push([hidden, hidden.clone()]);
            selectBoxes.push(hiddenMatrix());
            return;
        }
        transforms.push(trans);
        selectBoxes.push(selectBoxFor(trans, b));
    });

    const reformCells = (data.reformData
        ? expandReformCells(data.reformData)
        : []
    ).filter((cell) => pos.areas[cell.areaIndex] !== undefined);

    return {
        pos,
        transforms,
        selectBoxes,
        bvh: new BVH(selectBoxes),
        reformCells,
        invalidBuildings,
        repairedBuildings,
    };
}

/**
 * 原子重建场景内容：**先构建、后替换**。
 *
 * `build` 抛错时不会调用 `swap`，旧内容继续留在场景里。这就是"进编辑模式后模型消失且
 * 不恢复"的防线 —— 旧实现用 `watchEffect` + `onCleanup`：清理函数先移除旧模型，随后
 * 新一次计算一旦抛错，场景里就只剩空的了。
 *
 * @returns 是否替换成功
 */
export function rebuildScene<T>(
    build: () => T,
    swap: (next: T) => void,
    onError?: (error: unknown) => void
): boolean {
    let next: T;
    try {
        next = build();
    } catch (error) {
        if (onError !== undefined) onError(error);
        return false;
    }
    swap(next);
    return true;
}
