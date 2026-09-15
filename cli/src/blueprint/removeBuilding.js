"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoveBuildingsByItemCommand = exports.RemoveBuildingCommand = exports.RemoveBuildingsCommand = void 0;
const LINK_FIELDS = ['outputObjIdx', 'inputObjIdx'];
/**
 * 从蓝图中剔除一批建筑（对应游戏内“右键点击剔除”/ 右键列表图标剔除同类）。
 * 删除后需要同步维护：
 *  - 其余建筑的 index（数组位置即 index）
 *  - outputObjIdx / inputObjIdx 交叉引用：指向被删建筑的连接断开（置 -1），
 *    指向其后建筑的引用按删除数量前移
 * 被删建筑对象整体保存，撤销时原样插回，保证参数/扩展字节日级不变。
 */
class RemoveBuildingsCommand {
    removed;
    removeSet;
    dangling = [];
    constructor(indices, data) {
        const unique = [...new Set(indices)].sort((a, b) => a - b);
        this.removed = unique.map(index => ({ index, building: data.buildings[index] }));
        this.removeSet = new Set(unique);
    }
    do(data) {
        const n = data.buildings.length;
        // 旧 index -> 新 index（-1 表示该建筑被删除）
        const newIndexOf = new Int32Array(n);
        let cursor = 0;
        for (let i = 0; i < n; i++)
            newIndexOf[i] = this.removeSet.has(i) ? -1 : cursor++;
        // 先记录幸存建筑指向被删建筑的连接，供撤销时恢复
        this.dangling = [];
        for (const b of data.buildings) {
            if (this.removeSet.has(b.index))
                continue;
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1 && newIndexOf[ref] === -1)
                    this.dangling.push({ building: b, field, target: ref });
            }
        }
        for (let i = n - 1; i >= 0; i--)
            if (this.removeSet.has(i))
                data.buildings.splice(i, 1);
        for (const b of data.buildings) {
            b.index = newIndexOf[b.index];
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1)
                    b[field] = newIndexOf[ref];
            }
        }
    }
    undo(data) {
        for (const r of this.removed)
            data.buildings.splice(r.index, 0, r.building);
        data.buildings.forEach((b, i) => b.index = i);
        // 新 index -> 旧 index：幸存者按恢复数组中的顺序排列
        const oldIndexOfNew = [];
        for (let i = 0; i < data.buildings.length; i++)
            if (!this.removeSet.has(i))
                oldIndexOfNew.push(i);
        const removedObjects = new Set(this.removed.map(r => r.building));
        const isDangling = (b, field) => this.dangling.some(d => d.building === b && d.field === field);
        for (const { building, field, target } of this.dangling)
            building[field] = target;
        for (const b of data.buildings) {
            if (removedObjects.has(b))
                continue;
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1 && !isDangling(b, field))
                    b[field] = oldIndexOfNew[ref];
            }
        }
    }
    merge() { return false; }
}
exports.RemoveBuildingsCommand = RemoveBuildingsCommand;
/** 剔除单个建筑（3D 视图右键） */
class RemoveBuildingCommand extends RemoveBuildingsCommand {
    constructor(index, data) {
        super([index], data);
    }
}
exports.RemoveBuildingCommand = RemoveBuildingCommand;
/** 剔除蓝图中全部同 itemId 的建筑（列表图标右键一键删除同类） */
class RemoveBuildingsByItemCommand extends RemoveBuildingsCommand {
    constructor(itemId, data) {
        const indices = [];
        data.buildings.forEach((b, i) => {
            if (b.itemId === itemId)
                indices.push(i);
        });
        super(indices, data);
    }
}
exports.RemoveBuildingsByItemCommand = RemoveBuildingsByItemCommand;
//# sourceMappingURL=removeBuilding.js.map