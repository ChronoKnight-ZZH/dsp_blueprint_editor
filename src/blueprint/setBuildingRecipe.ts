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
 * 修改单体建筑配方（recipeId 字段）的撤销命令。
 *
 * 只改数据字段，不改变几何/拓扑/3D 模型 → silent=true。
 * 派发 updateBuildingIcon 让 3D 层刷新该建筑图标（制造台图标随配方变化），
 * 同时让 BuildingInfoPanel 通过 updateBuildingIcon 回调 bump 版本号以重新渲染配方区域。
 */
export class SetBuildingRecipeCommand implements Command {
    readonly silent = true;

    private oldRecipeId: number;
    private newRecipeId: number;

    constructor(private building: BlueprintBuilding, recipeId: number) {
        this.oldRecipeId = building.recipeId;
        this.newRecipeId = recipeId;
    }

    do(_data: BlueprintData, updater: Updater) {
        this.building.recipeId = this.newRecipeId;
        updater.updateBuildingIcon.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater) {
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
 * 是一体运作的，点击任意一层的"研究模式"要改整列 —— 本命令作用于整列建筑，
 * 撤销时逐层恢复各自的原模式。
 *
 * 只改数据字段，不改变几何/拓扑/3D 模型 → silent=true。
 * 派发 updateBuildingIcon 让 BuildingInfoPanel 重新渲染模式文本
 * （研究模式不影响 3D 图标，刷新为无害 no-op，由 BlueprintEditor 的 hasIcon 守卫跳过）。
 */
export class SetLabResearchModeCommand implements Command {
    readonly silent = true;

    private newMode: ResearchMode;
    /** 目标建筑（整列），首次 do 时解析并固定，保证 redo/undo 作用对象一致 */
    private targets: BlueprintBuilding[] = [];
    private readonly oldModes = new Map<BlueprintBuilding, ResearchMode>();

    constructor(private building: BlueprintBuilding, mode: ResearchMode) {
        this.newMode = mode;
    }

    do(data: BlueprintData, updater: Updater) {
        if (this.targets.length === 0) {
            const column = stackColumn(data.buildings, this.building).filter(
                (b) => isLab(b.itemId) && b.parameters !== null
            );
            this.targets = column.length > 0 ? column : [this.building];
            for (const lab of this.targets)
                this.oldModes.set(
                    lab,
                    (lab.parameters as LabParamerters).researchMode
                );
        }
        for (const lab of this.targets) {
            (lab.parameters as LabParamerters).researchMode = this.newMode;
            updater.updateBuildingIcon.dispatch(lab);
        }
    }

    undo(_data: BlueprintData, updater: Updater) {
        for (const [lab, mode] of this.oldModes) {
            (lab.parameters as LabParamerters).researchMode = mode;
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
