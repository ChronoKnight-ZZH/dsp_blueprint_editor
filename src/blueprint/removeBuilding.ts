import { BlueprintBuilding, BlueprintData, IODir, StationParameters } from "./parser";
import { Command } from "@/command";
import { isBelt } from "@/data/items";

type LinkField = "outputObjIdx" | "inputObjIdx";
const LINK_FIELDS: LinkField[] = ["outputObjIdx", "inputObjIdx"];

interface RemovedRecord {
    /** 删除前在数组中的原始位置 */
    index: number;
    building: BlueprintBuilding;
}

interface DanglingRecord {
    /** 被删后失去连接的幸存建筑 */
    building: BlueprintBuilding;
    field: LinkField;
    /** 撤销时恢复为该原始目标 index */
    target: number;
}

interface PortDirRecord {
    /** 失去传送带的物流站 */
    station: BlueprintBuilding;
    slot: number;
    /** 删除前的方向（撤销时还原） */
    dir: number;
}

/**
 * 从蓝图中剔除一批建筑（对应游戏内“右键点击剔除”/ 右键列表图标剔除同类）。
 * 删除后需要同步维护：
 *  - 其余建筑的 index（数组位置即 index）
 *  - outputObjIdx / inputObjIdx 交叉引用：指向被删建筑的连接断开（置 -1），
 *    指向其后建筑的引用按删除数量前移
 * 被删建筑对象整体保存，撤销时原样插回，保证参数/扩展字节日级不变。
 */
export class RemoveBuildingsCommand implements Command {
    private readonly removed: RemovedRecord[];
    private readonly removeSet: Set<number>;
    private dangling: DanglingRecord[] = [];
    /** 被删传送带原本挂着的物流站口方向（撤销时还原，见 CODE_WIKI §6.20） */
    private portDirs: PortDirRecord[] = [];

    constructor(indices: number[], data: BlueprintData) {
        const unique = [...new Set(indices)].sort((a, b) => a - b);
        this.removed = unique.map((index) => ({
            index,
            building: data.buildings[index],
        }));
        this.removeSet = new Set(unique);
    }

    /**
     * 删除传送带时，把站上因此空出来的口方向清成「无」
     * （游戏样本里没挂带的口 `dir=0`；载荷物品序号保持不变）。
     */
    private clearPortDirs(data: BlueprintData) {
        this.portDirs = [];
        for (const r of this.removed) {
            const b = r.building;
            if (!isBelt(b.itemId)) continue;
            const links: [number, number][] = [];
            if (b.inputObjIdx >= 0) links.push([b.inputObjIdx, b.inputFromSlot]);
            if (b.outputObjIdx >= 0)
                links.push([b.outputObjIdx, b.outputToSlot]);
            for (const [target, slot] of links) {
                if (this.removeSet.has(target)) continue;
                const station = data.buildings[target];
                const s = (station?.parameters as StationParameters | null)
                    ?.slots?.[slot];
                if (!s || s.dir === IODir.None) continue;
                this.portDirs.push({ station, slot, dir: s.dir });
                s.dir = IODir.None;
            }
        }
    }

    do(data: BlueprintData) {
        this.clearPortDirs(data);
        const n = data.buildings.length;
        // 旧 index -> 新 index（-1 表示该建筑被删除）
        const newIndexOf = new Int32Array(n);
        let cursor = 0;
        for (let i = 0; i < n; i++)
            newIndexOf[i] = this.removeSet.has(i) ? -1 : cursor++;

        // 先记录幸存建筑指向被删建筑的连接，供撤销时恢复
        this.dangling = [];
        for (const b of data.buildings) {
            if (this.removeSet.has(b.index)) continue;
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1 && newIndexOf[ref] === -1)
                    this.dangling.push({ building: b, field, target: ref });
            }
        }

        for (let i = n - 1; i >= 0; i--)
            if (this.removeSet.has(i)) data.buildings.splice(i, 1);

        for (const b of data.buildings) {
            b.index = newIndexOf[b.index];
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1) b[field] = newIndexOf[ref];
            }
        }
    }

    undo(data: BlueprintData) {
        for (const p of this.portDirs) {
            const s = (p.station.parameters as StationParameters | null)
                ?.slots?.[p.slot];
            if (s) s.dir = p.dir;
        }
        this.portDirs = [];
        for (const r of this.removed)
            data.buildings.splice(r.index, 0, r.building);
        data.buildings.forEach((b, i) => (b.index = i));

        // 新 index -> 旧 index：幸存者按恢复数组中的顺序排列
        const oldIndexOfNew: number[] = [];
        for (let i = 0; i < data.buildings.length; i++)
            if (!this.removeSet.has(i)) oldIndexOfNew.push(i);

        const removedObjects = new Set(this.removed.map((r) => r.building));
        const isDangling = (b: BlueprintBuilding, field: LinkField) =>
            this.dangling.some((d) => d.building === b && d.field === field);

        for (const { building, field, target } of this.dangling)
            building[field] = target;

        for (const b of data.buildings) {
            if (removedObjects.has(b)) continue;
            for (const field of LINK_FIELDS) {
                const ref = b[field];
                if (ref !== -1 && !isDangling(b, field))
                    b[field] = oldIndexOfNew[ref];
            }
        }
    }

    merge() {
        return false;
    }
}

/** 剔除单个建筑（3D 视图右键） */
export class RemoveBuildingCommand extends RemoveBuildingsCommand {
    constructor(index: number, data: BlueprintData) {
        super([index], data);
    }
}

/** 剔除蓝图中全部同 itemId 的建筑（列表图标右键一键删除同类） */
export class RemoveBuildingsByItemCommand extends RemoveBuildingsCommand {
    constructor(itemId: number, data: BlueprintData) {
        const indices: number[] = [];
        data.buildings.forEach((b, i) => {
            if (b.itemId === itemId) indices.push(i);
        });
        super(indices, data);
    }
}
