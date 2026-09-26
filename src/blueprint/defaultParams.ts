import {
    AllParameters,
    StationParameters,
    SplitterParameters, LabParamerters, AssembleParamerters,
    BeltParameters, InserterParameters, TankParameters,
    StorageParameters, StorageType,
    EjectorParameters, PowerGeneratorParameters,
    ArtifacialStarParameters, EnergyExchangerParameters,
    MonitorParameters, BattleBaseParameters, DispenserParameters,
    ResearchMode, AcceleratorMode,
} from './parser';
import { allAssemblers } from '@/data/items';

/** itemId → 最小合法 parameters 模板；未注册建筑返回 null（走 unknownParamParser） */
export function defaultParamsFor(itemId: number, _modelIndex: number): AllParameters | null {
    void _modelIndex;
    switch (itemId) {
        // 物流运输站 / 星际物流运输站
        case 2103:
            return emptyStation(4, 12);
        case 2104:
            return emptyStation(5, 12);
        // 大型采矿机
        case 2316:
            return { ...emptyStation(1, 12), miningSpeed: 0 };
        // 四向分流器
        case 2020:
            return { priority: [false, false, false, false], extra: [0, 0] } as SplitterParameters;
        // 研究站
        case 2901:
        case 2902:
            return { researchMode: ResearchMode.None, acceleratorMode: AcceleratorMode.Accelerate } as LabParamerters;
        // 传送带
        case 2001:
        case 2002:
        case 2003:
            return { iconId: 0, count: 0 } as BeltParameters;
        // 分拣器
        case 2011:
        case 2012:
        case 2013:
        case 2014:
            return { length: 0 } as InserterParameters;
        // 储物仓
        case 2101:
            return emptyStorage();
        case 2102:
            return emptyStorage();
        // 储液罐
        case 2106:
            return { input: false, output: false } as TankParameters;
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
            return emptyMonitor();
        // 战场分析基站
        case 3009:
            return emptyBattleBase();
        // 物流配送器
        case 2107:
            return { playerMode: 0, storageMode: 0, workEnergyPerTick: 0, courierAutoReplenish: false } as DispenserParameters;
    }
    // 制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机（allAssemblers 中除研究站外）
    if (allAssemblers.has(itemId)) {
        return { acceleratorMode: AcceleratorMode.Accelerate } as AssembleParamerters;
    }
    return null;
}

function emptyStation(maxItemKind: number, numSlots: number): StationParameters {
    const storage = [];
    for (let i = 0; i < maxItemKind; i++) {
        storage.push({ itemId: 0, max: 0, localLogic: 0, remoteLogic: 0, keepMode: 0 });
    }
    const slots = [];
    for (let i = 0; i < numSlots; i++) {
        slots.push({ dir: 0, storageIdx: 0 });
    }
    return {
        storage, slots,
        workEnergyPerTick: 0,
        tripRangeOfDrones: 0,
        tripRangeOfShips: 0,
        includeOrbitCollector: false,
        warpEnableDistance: 0,
        warperNecessary: false,
        deliveryAmountOfDrones: 0,
        deliveryAmountOfShips: 0,
        pilerCount: 0,
        droneAutoReplenish: false,
        shipAutoReplenish: false,
    };
}

function emptyStorage(): StorageParameters {
    return { automationLimit: 0, type: StorageType.DEFAULT, grids: [] };
}

function emptyBattleBase(): BattleBaseParameters {
    const fighters = [];
    for (let i = 0; i < 12; i++)
        fighters.push({ itemId: 0 });
    return {
        ...emptyStorage(),
        workEnergyPerTick: 0,
        autoPickEnabled: false,
        autoReplenishFleet: false,
        combatEnabled: false,
        autoReconstruct: false,
        constructionDroneEnabled: false,
        droneConstructPriority: 0,
        fighters,
    };
}

function emptyMonitor(): MonitorParameters {
    return {
        targetBeltId: 0, offset: 0, targetCargoAmount: 0, periodTicksCount: 0,
        passColorId: 0, failColorId: 0, passOperator: 0, alarmMode: 0,
        cargoFilter: 0, systemWarningMode: 0, systemWarningIconId: 0,
        tone: 0, volume: 0, pitch: 0, repeat: false, length: 0,
        falloffRadius: [0, 0], spawnItemOperator: 0,
    };
}