import { BeltParameters, BlueprintBuilding, BlueprintData } from "./parser";
import { Command, Updater } from "@/command";

export type BeltParamField = "iconId" | "count";

/**
 * 修改传送带预览物品图标 iconId / 数量 count 的撤销命令。
 * 只改参数，不影响几何/拓扑 → silent=true。
 * 连续快速调节同一建筑的同一字段时合并，避免撤销栈膨胀。
 */
export class SetBeltParamsCommand implements Command {
    readonly silent = true;

    private oldIconId: number;
    private oldCount: number;

    constructor(
        private readonly building: BlueprintBuilding,
        private readonly field: BeltParamField,
        private value: number,
    ) {
        const p = building.parameters as BeltParameters;
        this.oldIconId = p.iconId;
        this.oldCount = p.count;
    }

    do(_data: BlueprintData, updater: Updater): void {
        const p = this.building.parameters as BeltParameters;
        if (this.field === "iconId")
            p.iconId = this.value;
        else
            p.count = this.value;
        updater.updateBeltIcon.dispatch(this.building);
        if (this.field === "count")
            updater.updateBeltIconSubscript.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater): void {
        const p = this.building.parameters as BeltParameters;
        p.iconId = this.oldIconId;
        p.count = this.oldCount;
        updater.updateBeltIcon.dispatch(this.building);
        updater.updateBeltIconSubscript.dispatch(this.building);
    }

    merge(c: Command): boolean {
        if (!(c instanceof SetBeltParamsCommand))
            return false;
        if (c.building !== this.building || c.field !== this.field)
            return false;
        this.value = c.value;
        return true;
    }
}
