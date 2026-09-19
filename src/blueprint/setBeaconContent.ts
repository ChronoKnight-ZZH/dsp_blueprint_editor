/* eslint-disable @typescript-eslint/no-unused-vars */
import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command, Updater } from "@/command";

/**
 * 修改全息信标（itemId=2401）自定义文本（content 字段）的撤销命令。
 *
 * 只改文本内容，不影响几何/拓扑/3D 模型 → silent=true。
 */
export class SetBeaconContentCommand implements Command {
    readonly silent = true;

    building: BlueprintBuilding;
    oldContent: string | undefined;
    newContent: string;

    constructor(building: BlueprintBuilding, newContent: string) {
        this.building = building;
        this.oldContent = building.content;
        this.newContent = newContent;
    }

    do(_data: BlueprintData, _updater: Updater) {
        this.building.content = this.newContent && this.newContent.length > 0
            ? this.newContent
            : undefined;
    }

    undo(_data: BlueprintData, _updater: Updater) {
        this.building.content = this.oldContent && this.oldContent.length > 0
            ? this.oldContent
            : undefined;
    }

    merge(c: Command): boolean {
        // 合并连续对同一建筑文本的编辑：新命令直接替换目标文本
        if (!(c instanceof SetBeaconContentCommand))
            return false;
        if (c.building !== this.building)
            return false;
        this.newContent = c.newContent;
        return true;
    }
}
