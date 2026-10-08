import { fromStr, toStr, IODir, StationParameters } from '@/blueprint/parser';
import { createBuilding, createEmptyBlueprint } from '@/blueprint/create';
import { buildBeltLine, CreateBeltLineCommand, BeltPortEnd } from '@/blueprint/beltLine';
import { RemoveBuildingCommand } from '@/blueprint/removeBuilding';
import { beltPortAt, portWorldNormal, portWorldOffset } from '@/data/beltPorts';
import { itemIconId } from '@/data/icons';
import {
    SetStationPortCommand,
    SPACE_WARPER_ITEM_ID,
    stationPortItemChoices,
    stationPortItemId,
} from '@/blueprint/setStationPort';
import { Updater } from '@/command';
import * as fs from 'fs';
import * as path from 'path';

/** 建筑 → 带端绑定（与 BlueprintEditor 的取值方式一致） */
function portEnd(building: BlueprintBuildingT, slot: number): BeltPortEnd {
    const port = beltPortAt(building.itemId, building.modelIndex, slot)!;
    const off = portWorldOffset(port, building.yaw[0], 1);
    const n = portWorldNormal(port, building.yaw[0]);
    return {
        building,
        slot,
        point: {
            x: building.localOffset[0].x + off.x,
            y: building.localOffset[0].y + off.y,
            z: off.z,
        },
        nx: n.x,
        ny: n.y,
    };
}
type BlueprintBuildingT = ReturnType<typeof createBuilding>;

/**
 * 物流站端口（12 口）配置：方向 dir(0/1/2) + 携带物品序号 storageIdx。
 * 标定样本：fixtures/sample_outpost_ils.txt（#4 dir=1 idx=5；#5 dir=2 idx=6）、
 * tests/tools/物流塔连接传送带.txt（#79 storage 5 栏却有 idx=6）。
 */
describe('物流站端口物品序号', () => {
    test('小塔 4 栏 / 大塔 5 栏 + 第 6 项固定为空间翘曲器 1210', () => {
        const small = fromStr(
            fs
                .readFileSync(
                    path.resolve(
                        __dirname,
                        '..',
                        '..',
                        'tools',
                        '物流塔连接传送带.txt'
                    ),
                    'utf8'
                )
                .trim()
        ).buildings.find((b) => b.itemId === 2103)!;
        const ils = fromStr(
            fs.readFileSync(path.resolve(__dirname, 'fixtures', 'sample_outpost_ils.txt'), 'utf8').trim()
        ).buildings.find((b) => b.itemId === 2104)!;
        const ilsStorage = (ils.parameters as StationParameters).storage;

        // 大塔：1..5 = storage[0..4]，6 = 空间翘曲器（不在 storage 里）
        expect(
            stationPortItemId(ilsStorage, 1, true)
        ).toBe(ilsStorage[0].itemId);
        expect(stationPortItemId(ilsStorage, 5, true)).toBe(
            ilsStorage[4].itemId
        );
        expect(stationPortItemId(ilsStorage, 6, true)).toBe(
            SPACE_WARPER_ITEM_ID
        );
        expect(stationPortItemId(ilsStorage, 7, true)).toBe(0);
        expect(stationPortItemChoices(ilsStorage, true)).toEqual([
            0, 1, 2, 3, 4, 5, 6,
        ]);

        // 小塔：只有 1..4（没有第 6 项）
        const smallStorage = (small.parameters as StationParameters).storage;
        expect(smallStorage).toHaveLength(4);
        expect(stationPortItemChoices(smallStorage, false)).toEqual([
            0, 1, 2, 3, 4,
        ]);
        expect(stationPortItemId(smallStorage, 5, false)).toBe(0);
    });

    test('样本里大塔 #5 的入塔口 idx=6 解析为空间翘曲器，且 storage[4] 并非翘曲器', () => {
        const bp = fromStr(
            fs.readFileSync(path.resolve(__dirname, 'fixtures', 'sample_outpost_ils.txt'), 'utf8').trim()
        );
        const ils5 = bp.buildings.filter((b) => b.itemId === 2104)[1];
        const p = ils5.parameters as StationParameters;
        expect(p.slots[1]).toEqual({ dir: IODir.Input, storageIdx: 6 });
        expect(p.storage[4].itemId).not.toBe(SPACE_WARPER_ITEM_ID);
        expect(stationPortItemId(p.storage, 6, true)).toBe(
            SPACE_WARPER_ITEM_ID
        );
    });
});

describe('SetStationPortCommand', () => {
    const makeStation = () => {
        const bp = createEmptyBlueprint();
        const station = createBuilding(2104, 50, { x: 5, y: 80 }, 0);
        station.index = 0;
        bp.buildings.push(station);
        return { bp, station, params: station.parameters as StationParameters };
    };
    const updater = () => new Updater();

    test('改方向与物品：do/undo 对称，且 silent（只增 stateVersion）', () => {
        const { bp, station, params } = makeStation();
        params.storage[2].itemId = 1005; // 石矿
        const cmd = new SetStationPortCommand(
            station,
            4,
            IODir.Output,
            3
        );
        expect(cmd.silent).toBe(true);
        cmd.do(bp, updater());
        expect(params.slots[4]).toEqual({ dir: IODir.Output, storageIdx: 3 });
        expect(stationPortItemId(params.storage, params.slots[4].storageIdx, true)).toBe(1005);
        cmd.undo(bp, updater());
        expect(params.slots[4]).toEqual({ dir: IODir.None, storageIdx: 0 });
    });

    test('两项可单独修改（只传 dir 或只传 storageIdx）', () => {
        const { bp, station, params } = makeStation();
        params.slots[6].storageIdx = 2;
        const dirCmd = new SetStationPortCommand(station, 6, IODir.Input, undefined);
        dirCmd.do(bp, updater());
        expect(params.slots[6]).toEqual({ dir: IODir.Input, storageIdx: 2 });
        const idxCmd = new SetStationPortCommand(station, 6, undefined, 6);
        idxCmd.do(bp, updater());
        expect(params.slots[6]).toEqual({ dir: IODir.Input, storageIdx: 6 });
        idxCmd.undo(bp, updater());
        expect(params.slots[6]).toEqual({ dir: IODir.Input, storageIdx: 2 });
        dirCmd.undo(bp, updater());
        expect(params.slots[6]).toEqual({ dir: IODir.None, storageIdx: 2 });
    });

    test('改完后导出再解析保持（新增口配置进蓝图字节）', () => {
        const { bp, station, params } = makeStation();
        params.storage[0].itemId = 1001;
        params.storage[0].max = 20000;
        new SetStationPortCommand(station, 0, IODir.Output, 1).do(bp, updater());
        new SetStationPortCommand(station, 6, IODir.Input, 6).do(bp, updater());
        const back = fromStr(toStr(bp));
        const st = back.buildings.find((b) => b.itemId === 2104)!;
        const p = st.parameters as StationParameters;
        expect(p.slots[0]).toEqual({ dir: IODir.Output, storageIdx: 1 });
        expect(p.slots[6]).toEqual({ dir: IODir.Input, storageIdx: 6 });
        expect(stationPortItemId(p.storage, p.slots[6].storageIdx, true)).toBe(
            SPACE_WARPER_ITEM_ID
        );
    });

    test('口上挂着带时改物品：带上同步显示该物品的图标（无 = 清空带参数）', () => {
        const { bp, station, params } = makeStation();
        params.storage[0].itemId = 1001; // 铁矿
        // 手动造一条从 0 口取出的带
        const belt = createBuilding(2001, 35, { x: 5, y: 82.15 }, 0);
        belt.index = 1;
        belt.inputObjIdx = station.index;
        belt.inputFromSlot = 0;
        belt.inputToSlot = 1;
        belt.parameters = null;
        bp.buildings.push(belt);

        new SetStationPortCommand(station, 0, IODir.Output, 1).do(bp, updater());
        expect(belt.parameters).toEqual({ iconId: itemIconId(1001), count: 0 });
        // 改成「无」→ 带参数清空（与物品栏改为空的行为一致）
        const clear = new SetStationPortCommand(station, 0, undefined, 0);
        clear.do(bp, updater());
        expect(belt.parameters).toBeNull();
        // 撤销回到第 1 栏
        clear.undo(bp, updater());
        expect(belt.parameters).toEqual({ iconId: itemIconId(1001), count: 0 });
    });
});

describe('删除传送带时清空物流站口方向', () => {
    test('删带 → dir 归零；撤销 → 还原', () => {
        const bp = createEmptyBlueprint();
        const station = createBuilding(2104, 50, { x: 5, y: 80 }, 0);
        station.index = 0;
        bp.buildings.push(station);
        const params = station.parameters as StationParameters;

        const start = portEnd(station, 1);
        const belts = buildBeltLine(
            2001,
            35,
            { x: 5, y: 80 },
            { x: 5, y: 86 },
            0,
            'latFirst',
            start,
            null
        );
        new CreateBeltLineCommand(belts, start, null).do(bp);
        expect(params.slots[1].dir).toBe(IODir.Output);

        // 删掉这条带（含口格那一格）
        const beltIndex = belts[0].index;
        const cmd = new RemoveBuildingCommand(beltIndex, bp);
        cmd.do(bp);
        expect(params.slots[1].dir).toBe(IODir.None);
        cmd.undo(bp);
        expect(params.slots[1].dir).toBe(IODir.Output);
    });
});
