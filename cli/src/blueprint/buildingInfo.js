"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildingInfo = void 0;
class BuildingInfo {
    adjacency;
    constructor(buildings) {
        this.adjacency = new Array(buildings.length);
        for (let i = 0; i < this.adjacency.length; i++)
            this.adjacency[i] = [];
        for (const b of buildings) {
            if (b.outputObjIdx >= 0) {
                this.adjacency[b.index][b.outputFromSlot] = buildings[b.outputObjIdx];
                this.adjacency[b.outputObjIdx][b.outputToSlot] = b;
            }
            if (b.inputObjIdx >= 0) {
                this.adjacency[b.index][b.inputToSlot] = buildings[b.inputObjIdx];
                this.adjacency[b.inputObjIdx][b.inputFromSlot] = b;
            }
        }
    }
}
exports.BuildingInfo = BuildingInfo;
//# sourceMappingURL=buildingInfo.js.map