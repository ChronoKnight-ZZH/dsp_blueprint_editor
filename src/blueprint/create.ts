import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command } from "@/command";
import { ensureAreaFor } from "./area";
import { defaultParamsFor } from "./defaultParams";

/**
 * Create an empty v2 blueprint with a single root area anchored at the equator (latitude -80).
 * The root area covers the full equator band (size.y=161) with a small initial width (size.x=10).
 * 编辑过程中的区域是临时画布；导出时由 normalizeBlueprintAreas 收缩到实际建筑区间。
 */
export function createEmptyBlueprint(): BlueprintData {
    return {
        header: {
            layout: 10,
            icons: [0, 0, 0, 0, 0],
            time: new Date(),
            gameVersion: '0.10.35.29104',
            shortDesc: '新蓝图',
            author: '',
            blueprintVersion: '',
            properties: '',
            desc: '',
        },
        version: 2,
        cursorOffset: { x: 0, y: 0 },
        cursorTargetArea: 0,
        dragBoxSize: { x: 0, y: 0 },
        primaryAreaIdx: 0,
        areas: [{
            index: 0,
            parentIndex: -1,
            tropicAnchor: 0,
            areaSegments: 200,
            anchorLocalOffset: { x: 0, y: 0 },
            size: { x: 10, y: 161 },
        }],
        buildings: [],
        patch: 1,
        reformData: null,
    };
}

/**
 * Construct a minimal legal v2 building record for a single-point building.
 * All connection fields are -1 (no links). Parameters are null (game fills defaults).
 * @param yaw rotation in degrees (0-360)
 */
export function createBuilding(
    itemId: number,
    modelIndex: number,
    offset: { x: number, y: number },
    yaw: number,
): BlueprintBuilding {
    return {
        index: 0,
        areaIndex: 0,
        localOffset: [
            { x: offset.x, y: offset.y, z: 0 },
            { x: offset.x, y: offset.y, z: 0 },
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
}

/**
 * Command to add a building to the blueprint.
 * Ensures the root area covers the building's offset (expands size.x if needed).
 * Undo pops the building and restores the area's size.x.
 */
export class CreateBuildingCommand implements Command {
    private prevSizeX = 0;

    constructor(private readonly building: BlueprintBuilding) {}

    do(data: BlueprintData): void {
        const root = data.areas[0];
        this.prevSizeX = root.size.x;
        const areaIndex = ensureAreaFor(data, this.building.localOffset[0]);
        if (areaIndex < 0)
            throw new Error('Placement outside equator band');
        this.building.areaIndex = areaIndex;
        this.building.index = data.buildings.length;
        data.buildings.push(this.building);
    }

    undo(data: BlueprintData): void {
        data.buildings.pop();
        data.areas[0].size.x = this.prevSizeX;
    }

    merge() { return false; }
}
