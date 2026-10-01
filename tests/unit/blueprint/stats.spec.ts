import { AcceleratorMode, BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { calculateProductionStats, ItemStats } from '@/blueprint/stats';
import { AcceleratorItem } from '@/data/acceleratorData';

const makeBuilding = (partial: Partial<BlueprintBuilding>): BlueprintBuilding => ({
    index: 0,
    areaIndex: 0,
    localOffset: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
    yaw: [0, 0],
    tilt: 0,
    itemId: 0,
    modelIndex: 0,
    outputObjIdx: 0,
    inputObjIdx: 0,
    outputToSlot: 0,
    inputFromSlot: 0,
    outputFromSlot: 0,
    inputToSlot: 0,
    outputOffset: 0,
    inputOffset: 0,
    recipeId: 0,
    filterId: 0,
    parameters: null,
    ...partial,
});

const makeBp = (buildings: BlueprintBuilding[]): BlueprintData => ({
    buildings,
} as unknown as BlueprintData);

const findItem = (items: ItemStats[], itemId: number) =>
    items.find(i => i.itemId === itemId);

describe('calculateProductionStats - fractionator', () => {
    const bp = makeBp([makeBuilding({ index: 0, itemId: 2314 })]);

    test('default: 72 hydrogen -> 72 deuterium, 3960 kW, no proliferator consumption', () => {
        const stats = calculateProductionStats(bp, {
            useAccelerator: false,
            acceleratorItem: AcceleratorItem.None,
        });
        expect(stats.totalPower).toBeCloseTo(3960);
        expect(findItem(stats.items, 1120)?.consumed).toBeCloseTo(72);
        expect(findItem(stats.items, 1121)?.produced).toBeCloseTo(72);
        // 未启用增产剂时不应出现增产剂消耗行
        expect(findItem(stats.items, 1141)).toBeUndefined();
        expect(findItem(stats.items, 1143)).toBeUndefined();
    });

    test('Mk.I: 90/min, 5148 kW, proliferator = 90/12', () => {
        const stats = calculateProductionStats(bp, {
            useAccelerator: true,
            acceleratorItem: AcceleratorItem.MkI,
        });
        expect(stats.totalPower).toBeCloseTo(5148);
        expect(findItem(stats.items, 1120)?.consumed).toBeCloseTo(90);
        expect(findItem(stats.items, 1121)?.produced).toBeCloseTo(90);
        expect(findItem(stats.items, 1141)?.consumed).toBeCloseTo(7.5);
    });

    test('Mk.III: 144/min, 9900 kW, proliferator = 144/75', () => {
        const stats = calculateProductionStats(bp, {
            useAccelerator: true,
            acceleratorItem: AcceleratorItem.MkIII,
        });
        expect(stats.totalPower).toBeCloseTo(9900);
        expect(findItem(stats.items, 1120)?.consumed).toBeCloseTo(144);
        expect(findItem(stats.items, 1121)?.produced).toBeCloseTo(144);
        expect(findItem(stats.items, 1143)?.consumed).toBeCloseTo(1.92);
    });
});

describe('calculateProductionStats - recipe building', () => {
    // 制造台 Mk.I（2303）：270 kW、0.75x，铁块配方（recipe 1：60帧，1 铁矿 -> 1 铁块）
    const bp = makeBp([
        makeBuilding({
            index: 0,
            itemId: 2303,
            recipeId: 1,
            parameters: { acceleratorMode: AcceleratorMode.Accelerate } as unknown as BlueprintBuilding['parameters'],
        }),
    ]);

    test('no accelerator: 45/min, 270 kW', () => {
        const stats = calculateProductionStats(bp, {
            useAccelerator: false,
            acceleratorItem: AcceleratorItem.None,
        });
        expect(stats.totalPower).toBeCloseTo(270);
        expect(findItem(stats.items, 1001)?.consumed).toBeCloseTo(45);
        expect(findItem(stats.items, 1101)?.produced).toBeCloseTo(45);
        expect(findItem(stats.items, 1143)).toBeUndefined();
    });

    test('Mk.III accelerate: 90/min, 675 kW, proliferator = 90/75', () => {
        const stats = calculateProductionStats(bp, {
            useAccelerator: true,
            acceleratorItem: AcceleratorItem.MkIII,
        });
        expect(stats.totalPower).toBeCloseTo(675);
        expect(findItem(stats.items, 1001)?.consumed).toBeCloseTo(90);
        expect(findItem(stats.items, 1101)?.produced).toBeCloseTo(90);
        expect(findItem(stats.items, 1143)?.consumed).toBeCloseTo(1.2);
    });
});
