import {
    BlueprintBuilding,
    BlueprintData,
    IODir,
    StationParameters,
} from "./parser";
import { Command, Updater } from "@/command";
import { itemIconId } from "@/data/icons";
import { isBelt, isInterstellarStation } from "@/data/items";

/**
 * 物流站**端口**（12 个口）配置：方向 + 该口携带的物品序号。
 *
 * 游戏 wire 字段：`parameters.slots[i] = { dir, storageIdx }`
 * - `dir`：0 = 无 / 1 = 出塔（Output，带从站取出）/ 2 = 入塔（Input，带送入站）；
 *   传送带直连时会由 `CreateBeltLineCommand` 自动写（见 CODE_WIKI §6.20）。
 * - `storageIdx`：0 = 无；1..N = `storage[i-1]`（N = 该站的物品栏数：小塔 2103 = 4、大塔 2104 = 5）；
 *   大塔还多一项 `N+1` = **空间翘曲器 1210**（不在 storage 数组里，是第 6 个固定项）。
 *
 * 标定样本（0.10.35）：
 * - `tests/unit/blueprint/fixtures/sample_outpost_ils.txt` #4：`dir=1 storageIdx=5`（第 5 栏是翘曲器）
 *   与 #5：`dir=2 storageIdx=6`（第 6 项固定翘曲器）——证明 6 不是 storage[5]。
 * - `tests/tools/物流塔连接传送带.txt` #79：`storage` 只有 5 栏，却有口的 `storageIdx=6`。
 *
 * 只改数据、不改几何 → `silent`。
 */
export class SetStationPortCommand implements Command {
    /** 只改参数 → 不重建 3D 场景 */
    readonly silent = true;
    private readonly prevDir: number;
    private readonly prevIdx: number;

    constructor(
        private readonly building: BlueprintBuilding,
        private readonly slot: number,
        /** 新方向；undefined = 不改 */
        private readonly dir: IODir | undefined,
        /** 新物品序号；undefined = 不改 */
        private readonly storageIdx: number | undefined
    ) {
        const s = (building.parameters as StationParameters).slots[slot];
        this.prevDir = s.dir;
        this.prevIdx = s.storageIdx;
    }

    private apply(dir: number, storageIdx: number, updater: Updater): void {
        const s = (this.building.parameters as StationParameters).slots[
            this.slot
        ];
        s.dir = dir;
        s.storageIdx = storageIdx;
        updater.updateStationInfo.dispatch(this.building);
    }

    /**
     * 口上挂着传送带时，把该口携带的物品同步成带的显示图标
     * （与 `SetStationStorageItemCommand` 对物品栏的处理一致：无 = 清空参数）。
     */
    private syncBeltIcon(data: BlueprintData, updater: Updater): void {
        const params = this.building.parameters as StationParameters;
        const itemId = stationPortItemId(
            params.storage,
            params.slots[this.slot].storageIdx,
            isInterstellarStation(this.building.itemId)
        );
        for (const b of data.buildings) {
            if (!isBelt(b.itemId)) continue;
            const fromPort =
                b.inputObjIdx === this.building.index &&
                b.inputFromSlot === this.slot;
            const toPort =
                b.outputObjIdx === this.building.index &&
                b.outputToSlot === this.slot;
            if (!fromPort && !toPort) continue;
            b.parameters =
                itemId > 0 ? { iconId: itemIconId(itemId), count: 0 } : null;
            updater.updateBeltIcon.dispatch(b);
        }
    }

    do(data: BlueprintData, updater: Updater): void {
        this.apply(
            this.dir ?? this.prevDir,
            this.storageIdx ?? this.prevIdx,
            updater
        );
        if (this.storageIdx !== undefined && this.storageIdx !== this.prevIdx)
            this.syncBeltIcon(data, updater);
    }

    undo(data: BlueprintData, updater: Updater): void {
        this.apply(this.prevDir, this.prevIdx, updater);
        if (this.storageIdx !== undefined && this.storageIdx !== this.prevIdx)
            this.syncBeltIcon(data, updater);
    }

    merge() {
        return false;
    }
}

/** 空间翘曲器：大塔（2104）端口的第 6 个固定可选项 */
export const SPACE_WARPER_ITEM_ID = 1210;

/**
 * 端口物品序号 → 实际 itemId（0 = 无）。
 * @param interstellar 是否星际物流运输站（2104）——只有它多一项固定翘曲器
 */
export function stationPortItemId(
    storage: StationParameters["storage"],
    storageIdx: number,
    interstellar: boolean
): number {
    if (storageIdx <= 0) return 0;
    if (storageIdx <= storage.length) return storage[storageIdx - 1].itemId;
    if (interstellar && storageIdx === storage.length + 1)
        return SPACE_WARPER_ITEM_ID;
    return 0;
}

/** 端口可选物品序号列表（0=无 / 1..N / 大塔 N+1=翘曲器） */
export function stationPortItemChoices(
    storage: StationParameters["storage"],
    interstellar: boolean
): number[] {
    const out = [0];
    for (let i = 1; i <= storage.length; i++) out.push(i);
    if (interstellar) out.push(storage.length + 1);
    return out;
}
