import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command, Updater } from "@/command";

/**
 * 修改分拣器过滤器 filterId（0 = 无过滤）的撤销命令。
 * 只改 filterId，不影响几何/拓扑 → silent=true。
 * 连续对同一分拣器设置过滤器时合并。
 */
export class SetSorterFilterCommand implements Command {
    readonly silent = false;

    private readonly oldFilterId: number;

    constructor(
        private readonly building: BlueprintBuilding,
        private filterId: number,
    ) {
        this.oldFilterId = building.filterId;
    }

    do(_data: BlueprintData, updater: Updater): void {
        this.building.filterId = this.filterId;
        updater.updateSorterIcon.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater): void {
        this.building.filterId = this.oldFilterId;
        updater.updateSorterIcon.dispatch(this.building);
    }

    merge(c: Command): boolean {
        if (!(c instanceof SetSorterFilterCommand))
            return false;
        if (c.building !== this.building)
            return false;
        this.filterId = c.filterId;
        return true;
    }
}
