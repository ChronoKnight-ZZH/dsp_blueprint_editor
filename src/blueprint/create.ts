import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command } from "@/command";
import { defaultParamsFor } from "./defaultParams";
import { stackPortDefaults } from "@/data/stacking";

/**
 * Create an empty v2 blueprint with a single root area anchored at the equator (latitude -80).
 * The root area covers the full equator band (size.y=161) with a small initial width (size.x=10).
 * 编辑过程中的区域是临时画布；导出时由 normalizeBlueprintAreas 收缩到实际建筑区间。
 *
 * 这张空画布就是"全球画布"的初始状态：根区域是赤道带，往南北任意纬度带放置时
 * 由 `@/blueprint/globe` 按需补出该带的区域，导出时再收缩。
 */
export function createEmptyBlueprint(): BlueprintData {
    return {
        header: {
            layout: 10,
            icons: [0, 0, 0, 0, 0],
            time: new Date(),
            gameVersion: "0.10.35.29104",
            shortDesc: "新蓝图",
            author: "",
            blueprintVersion: "",
            properties: "",
            desc: "",
        },
        version: 2,
        cursorOffset: { x: 0, y: 0 },
        cursorTargetArea: 0,
        dragBoxSize: { x: 0, y: 0 },
        primaryAreaIdx: 0,
        areas: [
            {
                index: 0,
                parentIndex: -1,
                tropicAnchor: 0,
                areaSegments: 200,
                anchorLocalOffset: { x: 0, y: 0 },
                size: { x: 10, y: 161 },
            },
        ],
        buildings: [],
        patch: 1,
        reformData: null,
    };
}

/**
 * Construct a minimal legal v2 building record for a single-point building.
 * All connection fields are -1 (no links). Parameters are null (game fills defaults).
 * @param yaw rotation in degrees (0-360)
 * @param z 堆叠高度（格）：叠在别的建筑上时 = 底座 z + 一层高度，见 `@/data/stacking`
 */
export function createBuilding(
    itemId: number,
    modelIndex: number,
    offset: { x: number; y: number },
    yaw: number,
    z = 0
): BlueprintBuilding {
    const building: BlueprintBuilding = {
        index: 0,
        areaIndex: 0,
        localOffset: [
            { x: offset.x, y: offset.y, z },
            { x: offset.x, y: offset.y, z },
        ],
        yaw: [yaw, yaw],
        tilt: 0,
        itemId,
        modelIndex,
        outputObjIdx: -1,
        inputObjIdx: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        recipeId: 0,
        filterId: 0,
        parameters: defaultParamsFor(itemId, modelIndex),
    };
    // 可堆叠建筑（储物仓 / 储液罐 / 矩阵研究站 / 四向分流器）的堆叠端口默认值：
    // 游戏即使没堆叠也写 out=14/15、in=15/14（见 tests/tools/特殊用法建筑.txt），
    // 写成 0 会让游戏把这些字段当成分拣器 slot 0。
    const ports = stackPortDefaults(itemId);
    if (ports) {
        building.outputToSlot = ports.outputToSlot;
        building.outputFromSlot = ports.outputFromSlot;
        building.inputFromSlot = ports.inputFromSlot;
        building.inputToSlot = ports.inputToSlot;
    }
    return building;
}

/**
 * Command to add a building to the blueprint.
 *
 * `areaIndex` = 建筑所属区域（编辑器按建筑所在纬度带选出，见 `@/blueprint/globe`）；
 * 缺省 0 = 根区域（旧调用点与测试）。区域不存在时抛错（调用方应先用
 * `ensureCanvasArea` 按需补出该带的区域）；超出区域宽度时自动扩宽 `size.x`。
 * Undo pops the building and restores the area's size.
 */
export class CreateBuildingCommand implements Command {
    private prevSizeX = 0;
    private prevSizeY = 0;

    constructor(
        private readonly building: BlueprintBuilding,
        private readonly areaIndex = 0
    ) {}

    do(data: BlueprintData): void {
        const area = data.areas[this.areaIndex];
        if (area === undefined)
            throw new Error("Placement area not found on canvas");
        const offset = this.building.localOffset[0];
        this.prevSizeX = area.size.x;
        this.prevSizeY = area.size.y;
        if (offset.y < 0 || offset.y >= area.size.y)
            throw new Error("Placement outside the latitude band");
        if (offset.x < 0 || offset.x >= area.size.x)
            area.size.x = Math.floor(offset.x) + 1;
        this.building.areaIndex = this.areaIndex;
        this.building.index = data.buildings.length;
        data.buildings.push(this.building);
    }

    undo(data: BlueprintData): void {
        data.buildings.pop();
        const area = data.areas[this.areaIndex];
        if (area !== undefined) {
            area.size.x = this.prevSizeX;
            area.size.y = this.prevSizeY;
        }
    }

    merge() {
        return false;
    }
}
