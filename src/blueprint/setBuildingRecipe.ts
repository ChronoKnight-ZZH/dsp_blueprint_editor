import {
    BlueprintBuilding,
    BlueprintData,
    LabParamerters,
    ResearchMode,
} from "./parser";
import { Command, Updater } from "@/command";
import { stackColumn } from "@/data/stacking";
import { isLab } from "@/data/items";

/**
 * 解析"整列研究站"（同一格、沿堆叠端口相连的一列研究站）。
 * 一列堆叠研究站在游戏里是一台机器：**模式与配方共享**，
 * 因此模式/配方任一改动都作用于整列。
 */
function labColumn(
    data: BlueprintData,
    building: BlueprintBuilding
): BlueprintBuilding[] {
    const column = stackColumn(data.buildings, building).filter(
        (b) => isLab(b.itemId) && b.parameters !== null
    );
    return column.length > 0 ? column : [building];
}

/**
 * 修改建筑配方（recipeId 字段）的撤销命令。
 *
 * **研究站整列联动**：一列堆叠研究站共享模式与配方，改任意一层的配方即改整列
 * （其余建筑仍只改自身）。
 *
 * 只改数据字段，不改变几何/拓扑/3D 模型 → silent=true。
 * 派发 updateBuildingIcon 让 3D 层刷新该建筑图标（制造台图标随配方变化），
 * 同时让 BuildingInfoPanel 通过 updateBuildingIcon 回调 bump 版本号以重新渲染配方区域。
 */
export class SetBuildingRecipeCommand implements Command {
    readonly silent = true;

    private oldRecipeId: number;
    private newRecipeId: number;
    /** 研究站：整列一起改（首次 do 时解析并固定，保证 redo/undo 对象一致） */
    private targets: BlueprintBuilding[] | null = null;
    private readonly oldRecipes = new Map<BlueprintBuilding, number>();

    constructor(private building: BlueprintBuilding, recipeId: number) {
        this.oldRecipeId = building.recipeId;
        this.newRecipeId = recipeId;
    }

    do(data: BlueprintData, updater: Updater) {
        if (isLab(this.building.itemId)) {
            if (this.targets === null) {
                this.targets = labColumn(data, this.building);
                for (const lab of this.targets)
                    this.oldRecipes.set(lab, lab.recipeId);
            }
            for (const lab of this.targets) {
                lab.recipeId = this.newRecipeId;
                updater.updateBuildingIcon.dispatch(lab);
            }
            return;
        }
        this.building.recipeId = this.newRecipeId;
        updater.updateBuildingIcon.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater) {
        if (this.targets !== null) {
            for (const [lab, recipeId] of this.oldRecipes) {
                lab.recipeId = recipeId;
                updater.updateBuildingIcon.dispatch(lab);
            }
            return;
        }
        this.building.recipeId = this.oldRecipeId;
        updater.updateBuildingIcon.dispatch(this.building);
    }

    merge(c: Command): boolean {
        // 合并连续对同一建筑配方的改写：新命令直接覆盖目标 recipeId
        if (!(c instanceof SetBuildingRecipeCommand)) return false;
        if (c.building !== this.building) return false;
        this.newRecipeId = c.newRecipeId;
        return true;
    }
}

/**
 * 修改研究站（itemId=2901/2902）研究模式（researchMode 字段）的撤销命令。
 *
 * **整列联动**：堆叠成一列的研究站（同一格、沿堆叠端口 inputToSlot=14 相连）在游戏里
 * 是一体运作的，点击任意一层的"研究模式"要改整列 —— 本命令同时改**整列的模式与配方**
 * （配方取被点击那一层当时的配方），撤销时逐层恢复各自的原值。
 *
 * 只改数据字段，不改变几何/拓扑/3D 模型 → silent=true。
 * 派发 updateBuildingIcon 让 BuildingInfoPanel 重新渲染模式/配方文本
 * （研究模式不影响 3D 图标，刷新为无害 no-op，由 BlueprintEditor 的 hasIcon 守卫跳过）。
 */
export class SetLabResearchModeCommand implements Command {
    readonly silent = true;

    private newMode: ResearchMode;
    /** 目标建筑（整列），首次 do 时解析并固定，保证 redo/undo 作用对象一致 */
    private targets: BlueprintBuilding[] = [];
    private readonly oldValues = new Map<
        BlueprintBuilding,
        { mode: ResearchMode; recipeId: number }
    >();
    /** 整列统一的配方 = 被点击那一层当时的配方 */
    private newRecipeId = 0;

    constructor(private building: BlueprintBuilding, mode: ResearchMode) {
        this.newMode = mode;
    }

    do(data: BlueprintData, updater: Updater) {
        if (this.targets.length === 0) {
            this.targets = labColumn(data, this.building);
            this.newRecipeId = this.building.recipeId;
            for (const lab of this.targets)
                this.oldValues.set(lab, {
                    mode: (lab.parameters as LabParamerters).researchMode,
                    recipeId: lab.recipeId,
                });
        }
        for (const lab of this.targets) {
            (lab.parameters as LabParamerters).researchMode = this.newMode;
            lab.recipeId = this.newRecipeId;
            updater.updateBuildingIcon.dispatch(lab);
        }
    }

    undo(_data: BlueprintData, updater: Updater) {
        for (const [lab, old] of this.oldValues) {
            (lab.parameters as LabParamerters).researchMode = old.mode;
            lab.recipeId = old.recipeId;
            updater.updateBuildingIcon.dispatch(lab);
        }
    }

    merge(c: Command): boolean {
        if (!(c instanceof SetLabResearchModeCommand)) return false;
        if (c.building !== this.building) return false;
        this.newMode = c.newMode;
        return true;
    }
}
