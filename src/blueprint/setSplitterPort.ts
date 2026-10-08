import {
    BlueprintBuilding,
    BlueprintData,
    SplitterParameters,
} from "./parser";
import { Command, Updater } from "@/command";
import { hasPrioritizedOutput } from "./splitterPorts";

/**
 * 四向分流器"优先输入/输出"开关（`parameters.priority[port]`）。
 *
 * 交互（游戏一致）：左键点口 → 设优先；右键点口 → 取消优先。
 * 取消优先后如果**已经没有任何"优先输出"口**，筛选（`filterId`）也一并清空——
 * 筛选必须挂在优先输出口上，否则游戏面板里没有地方显示它。撤销时一起还原。
 *
 * 只改数据字段 → silent=true；派发 `updateStationInfo` 让分流器面板与 3D 口标记刷新。
 */
export class SetSplitterPriorityCommand implements Command {
    readonly silent = true;

    private readonly oldPriority: boolean;
    private readonly oldFilterId: number;
    /** 本次是否顺带清空了筛选（撤销时需要还原） */
    private filterCleared = false;

    constructor(
        private readonly building: BlueprintBuilding,
        private readonly port: number,
        private readonly value: boolean
    ) {
        const p = building.parameters as SplitterParameters | null;
        this.oldPriority = p ? p.priority[port] === true : false;
        this.oldFilterId = building.filterId;
    }

    do(data: BlueprintData, updater: Updater) {
        const p = this.building.parameters as SplitterParameters | null;
        if (!p || this.port < 0 || this.port >= p.priority.length) return;
        p.priority[this.port] = this.value;
        if (
            !this.value &&
            this.building.filterId > 0 &&
            !hasPrioritizedOutput(data.buildings, this.building)
        ) {
            this.building.filterId = 0;
            this.filterCleared = true;
        }
        updater.updateStationInfo.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater) {
        const p = this.building.parameters as SplitterParameters | null;
        if (!p || this.port < 0 || this.port >= p.priority.length) return;
        p.priority[this.port] = this.oldPriority;
        if (this.filterCleared) this.building.filterId = this.oldFilterId;
        updater.updateStationInfo.dispatch(this.building);
    }

    merge() {
        return false;
    }
}

/**
 * 四向分流器"优先输出口筛选物品"（`filterId` 字段）。
 * 与游戏一致：筛选是**建筑级**的单个物品，显示在所有"优先输出"口上。
 * 只改数据字段 → silent=true。
 */
export class SetSplitterFilterCommand implements Command {
    readonly silent = true;

    private readonly oldFilterId: number;

    constructor(
        private readonly building: BlueprintBuilding,
        private filterId: number
    ) {
        this.oldFilterId = building.filterId;
    }

    do(_data: BlueprintData, updater: Updater) {
        this.building.filterId = this.filterId;
        updater.updateStationInfo.dispatch(this.building);
    }

    undo(_data: BlueprintData, updater: Updater) {
        this.building.filterId = this.oldFilterId;
        updater.updateStationInfo.dispatch(this.building);
    }

    merge(c: Command): boolean {
        if (!(c instanceof SetSplitterFilterCommand)) return false;
        if (c.building !== this.building) return false;
        this.filterId = c.filterId;
        return true;
    }
}
