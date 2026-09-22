import { BlueprintBuilding, BlueprintData, LabParamerters, ResearchMode } from "./parser";
import { Command, Updater } from "@/command";

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
        if (!(c instanceof SetBuildingRecipeCommand))
            return false;
        if (c.building !== this.building)
            return false;
        this.newRecipeId = c.newRecipeId;
        return true;
    }
}

/**
 * 修改研究站（itemId=2901/2902）研究模式（researchMode 字段）的撤销命令。
 *
 * 只改数据字段，不改变几何/拓扑/3D 模型 → silent=true。
 * 派发 updateBuildingIcon 仅为触发 BuildingInfoPanel 重新渲染模式文本
 * （研究模式不影响 3D 图标，刷新为无害 no-op，由 BlueprintEditor 的 hasIcon 守卫跳过）。
 */
export class SetLabResearchModeCommand implements Command {
    readonly silent = true;

    private oldMode: ResearchMode;
    private newMode: ResearchMode;

    constructor(private building: BlueprintBuilding, mode: ResearchMode) {
        this.oldMode = (building.parameters as LabParamerters).researchMode;
        this.newMode = mode;
    }

    do(_data: BlueprintData, updater: Updater) {
        (this.building.parameters as LabParamerters).researchMode = this.newMode;
        updater.updateBuildingIcon.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater) {
        (this.building.parameters as LabParamerters).researchMode = this.oldMode;
        updater.updateBuildingIcon.dispatch(this.building);
    }

    merge(c: Command): boolean {
        if (!(c instanceof SetLabResearchModeCommand))
            return false;
        if (c.building !== this.building)
            return false;
        this.newMode = c.newMode;
        return true;
    }
}
