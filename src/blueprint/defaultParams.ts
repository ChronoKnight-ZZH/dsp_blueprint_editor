import {
    AllParameters,
    StationParameters,
    SplitterParameters, LabParamerters, AssembleParamerters,
    InserterParameters, TankParameters,
    StorageParameters, StorageType,
    EjectorParameters, PowerGeneratorParameters,
    ArtifacialStarParameters, EnergyExchangerParameters,
    MonitorParameters, BattleBaseParameters, DispenserParameters,
    UnknownParamerters, LogisticRole,
    ResearchMode, AcceleratorMode,
    BeltParameters,
} from './parser';
import { allAssemblers } from '@/data/items';

/** itemId → 最小合法 parameters 模板；未注册建筑返回 null（走 unknownParamParser） */
export function defaultParamsFor(itemId: number, _modelIndex: number): AllParameters | null {
    void _modelIndex;
    switch (itemId) {
        // 物流运输站 / 星际物流运输站
        case 2103:
            return emptyStation(4, 12, 200000);
        case 2104:
            return emptyStation(5, 12, 1000000);
        // 大型采矿机
        case 2316:
            return {
                ...emptyStation(1, 12, 49000),
                storage: [{ itemId: 1001, max: 10000, localLogic: LogisticRole.Supply, remoteLogic: LogisticRole.None, keepMode: 0 }],
                miningSpeed: 10000,
            };
        // 四向分流器
        case 2020:
            return { priority: [false, false, false, false], extra: [0, 0] } as SplitterParameters;
        // 研究站
        case 2901:
        case 2902:
            return { researchMode: ResearchMode.None, acceleratorMode: AcceleratorMode.ExtraOutput } as LabParamerters;
        // 传送带：新放置的传送带无参数（与游戏一致），由 setBeltParams 按需初始化
        case 2001:
        case 2002:
        case 2003:
            return { iconId: 0, count: 0 } as BeltParameters;
            // return null;
        // 分拣器
        case 2011:
        case 2012:
        case 2013:
        case 2014:
            return { length: 1 } as InserterParameters;
        // 储物仓
        case 2101:
        case 2102:
            return emptyStorage();
        // 储液罐
        case 2106:
            return { output: true, input: true } as TankParameters;
        // 电磁轨道弹射器
        case 2311:
            return { orbitId: 0, boost: false } as EjectorParameters;
        // 射线接收站
        case 2208:
            return { productId: 0 } as PowerGeneratorParameters;
        // 人造恒星
        case 2210:
            return { boost: false } as ArtifacialStarParameters;
        // 能量枢纽
        case 2209:
            return { mode: 0 } as EnergyExchangerParameters;
        // 流速监测器
        case 2030:
            return defaultMonitor();
        // 战场分析基站
        case 3009:
            return defaultBattleBase();
        // 物流配送器
        case 2107:
            return { playerMode: 2, storageMode: 0, workEnergyPerTick: 30000, courierAutoReplenish: false } as DispenserParameters;
        // 地热发电站（单参数槽）
        case 2213:
            return { parameters: new Int32Array([0]) } as UnknownParamerters;
        // 垂直发射井（单参数槽）
        case 2312:
            return { parameters: new Int32Array([0]) } as UnknownParamerters;
        // 全息信标（2048 参数槽）
        case 2401: {
            const a = new Int32Array(2048);
            a[0] = 83; a[1] = 1250; a[2] = 150; a[3] = 2; a[4] = 2;
            return { parameters: a } as UnknownParamerters;
        }
        // 防御塔（128 参数槽，索引 2 为默认开火优先级/分组）
        case 3001:
        case 3002:
        case 3006:
            return turretParams(15);
        case 3003:
        case 3010:
            return turretParams(11);
        case 3004:
            return turretParams(192);
        case 3005:
            return turretParams(207);
    }
    // 制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机（allAssemblers 中除研究站外）
    if (allAssemblers.has(itemId)) {
        return { acceleratorMode: AcceleratorMode.ExtraOutput } as AssembleParamerters;
    }
    return null;
}

function emptyStation(maxItemKind: number, numSlots: number, workEnergyPerTick: number): StationParameters {
    const storage = [];
    for (let i = 0; i < maxItemKind; i++) {
        storage.push({ itemId: 0, max: 0, localLogic: LogisticRole.None, remoteLogic: LogisticRole.None, keepMode: 0 });
    }
    const slots = [];
    for (let i = 0; i < numSlots; i++) {
        slots.push({ dir: 0, storageIdx: 0 });
    }
    return {
        storage, slots,
        workEnergyPerTick,
        tripRangeOfDrones: -1,
        tripRangeOfShips: 24000000000,
        includeOrbitCollector: true,
        warpEnableDistance: 480000,
        warperNecessary: true,
        deliveryAmountOfDrones: 10,
        deliveryAmountOfShips: 100,
        pilerCount: 0,
        droneAutoReplenish: false,
        shipAutoReplenish: false,
    };
}

function emptyStorage(): StorageParameters {
    return { automationLimit: 0, type: StorageType.DEFAULT, grids: [] };
}

function defaultBattleBase(): BattleBaseParameters {
    const fighters = [];
    for (let i = 0; i < 12; i++)
        fighters.push({ itemId: 5101 });
    return {
        ...emptyStorage(),
        automationLimit: 10,
        workEnergyPerTick: 40000,
        autoPickEnabled: true,
        autoReplenishFleet: true,
        combatEnabled: true,
        autoReconstruct: true,
        constructionDroneEnabled: true,
        droneConstructPriority: 0,
        fighters,
    };
}

function defaultMonitor(): MonitorParameters {
    return {
        targetBeltId: 0, offset: 0, targetCargoAmount: 0, periodTicksCount: 360,
        passColorId: 113, failColorId: 13, passOperator: 5, alarmMode: 0,
        cargoFilter: 0, systemWarningMode: 0, systemWarningIconId: 402,
        tone: 20, volume: 80, pitch: 35, repeat: true, length: 4,
        falloffRadius: [24, 72], spawnItemOperator: 0,
    };
}

function turretParams(priority: number): UnknownParamerters {
    const a = new Int32Array(128);
    a[2] = priority;
    return { parameters: a };
}
