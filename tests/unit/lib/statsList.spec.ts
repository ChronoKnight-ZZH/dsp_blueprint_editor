import {
    AcceleratorMode,
    BlueprintBuilding,
    BlueprintData,
} from '@/blueprint/parser';
import { calculateProductionStats } from '@/blueprint/stats';
import { AcceleratorItem } from '@/data/acceleratorData';
import { calculateStatsList } from '@/lib/statsList';

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

// 注意：`calculateStatsList` 的宽松口径只要求 `buildings` 是数组（C-14），
// 这里仍然给全字段，避免测试数据与真实 API 契约不一致。
const makeBp = (buildings: BlueprintBuilding[]): BlueprintData => ({
    header: {
        layout: 0,
        icons: [],
        time: new Date(0),
        gameVersion: '',
        shortDesc: '',
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
    areas: [
        {
            index: 0,
            parentIndex: -1,
            tropicAnchor: 0,
            areaSegments: 200,
            anchorLocalOffset: { x: 0, y: 0 },
            size: { x: 1, y: 1 },
        },
    ],
    buildings,
});

const findDemand = (r: { value: { demand: { itemId: number; count: number; name: string }[] } }, itemId: number) =>
    r.value.demand.find(i => i.itemId === itemId);
const findOutput = (r: { value: { output: { itemId: number; count: number; name: string }[] } }, itemId: number) =>
    r.value.output.find(i => i.itemId === itemId);

describe('calculateStatsList - 与 calculateProductionStats 对账（分馏塔）', () => {
    const bpFractionator = makeBp([makeBuilding({ index: 0, itemId: 2314 })]);

    test('无增产剂：totalPower 3960，H2 只在 demand、D2 只在 output', () => {
        const stats = calculateProductionStats(bpFractionator, {
            useAccelerator: false,
            acceleratorItem: AcceleratorItem.None,
        });
        const r = calculateStatsList(bpFractionator, 0);
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        expect(r.value.totalPower).toBeCloseTo(stats.totalPower);
        expect(r.value.totalPower).toBeCloseTo(3960);
        expect(findDemand(r, 1120)?.count).toBeCloseTo(72);
        expect(findOutput(r, 1121)?.count).toBeCloseTo(72);

        // 拆分保真（D-04①）：纯消耗物品不进 output，纯产出物品不进 demand
        expect(findOutput(r, 1120)).toBeUndefined();
        expect(findDemand(r, 1121)).toBeUndefined();

        // 无增产剂不出现 1141/1143
        expect(findDemand(r, 1141)).toBeUndefined();
        expect(findDemand(r, 1143)).toBeUndefined();
    });

    test('Mk.I：totalPower 5148，增产剂 1141 消耗 90/12 = 7.5', () => {
        const r = calculateStatsList(bpFractionator, 1);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.totalPower).toBeCloseTo(5148);
        expect(findDemand(r, 1120)?.count).toBeCloseTo(90);
        expect(findOutput(r, 1121)?.count).toBeCloseTo(90);
        expect(findDemand(r, 1141)?.count).toBeCloseTo(7.5);
    });

    test('Mk.II：totalPower 6732，增产剂 1142 消耗 108/24 = 4.5', () => {
        const r = calculateStatsList(bpFractionator, 2);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // 108 = 72 × (1 + 0.5)；6732 = 3960 × (1 + 0.7)
        expect(r.value.totalPower).toBeCloseTo(6732);
        expect(findDemand(r, 1120)?.count).toBeCloseTo(108);
        expect(findOutput(r, 1121)?.count).toBeCloseTo(108);
        expect(findDemand(r, 1142)?.count).toBeCloseTo(4.5);
    });

    test('Mk.III：totalPower 9900，增产剂 1143 消耗 144/75 = 1.92', () => {
        const r = calculateStatsList(bpFractionator, 3);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.totalPower).toBeCloseTo(9900);
        expect(findDemand(r, 1120)?.count).toBeCloseTo(144);
        expect(findOutput(r, 1121)?.count).toBeCloseTo(144);
        expect(findDemand(r, 1143)?.count).toBeCloseTo(1.92);
    });
});

describe('calculateStatsList - 配方建筑（制造台 Mk.I，铁块配方）', () => {
    const bpAssembler = makeBp([
        makeBuilding({
            index: 0,
            itemId: 2303,
            recipeId: 1,
            parameters: {
                acceleratorMode: AcceleratorMode.Accelerate,
            } as unknown as BlueprintBuilding['parameters'],
        }),
    ]);

    test('无增产剂：totalPower 270，铁矿 demand 45，铁块 output 45', () => {
        const r = calculateStatsList(bpAssembler, 0);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.totalPower).toBeCloseTo(270);
        expect(findDemand(r, 1001)?.count).toBeCloseTo(45);
        expect(findOutput(r, 1101)?.count).toBeCloseTo(45);
    });

    test('Mk.III accelerate：totalPower 675，铁块 90，增产剂 90/75 = 1.2', () => {
        const r = calculateStatsList(bpAssembler, 3);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.totalPower).toBeCloseTo(675);
        expect(findDemand(r, 1001)?.count).toBeCloseTo(90);
        expect(findOutput(r, 1101)?.count).toBeCloseTo(90);
        expect(findDemand(r, 1143)?.count).toBeCloseTo(1.2);
    });
});

describe('calculateStatsList - 排序与物品名', () => {
    test('demand 与 output 各按 count 降序', () => {
        // 分馏塔消耗 72 H2，制造台消耗 45 铁矿 → demand 排序应为 [H2(72), 铁矿(45)]
        const bp = makeBp([
            makeBuilding({ index: 0, itemId: 2314 }),
            makeBuilding({
                index: 1,
                itemId: 2303,
                recipeId: 1,
                parameters: { acceleratorMode: AcceleratorMode.Accelerate } as unknown as BlueprintBuilding['parameters'],
            }),
        ]);
        const r = calculateStatsList(bp, 0);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        for (let i = 1; i < r.value.demand.length; i++) {
            expect(r.value.demand[i - 1].count).toBeGreaterThanOrEqual(r.value.demand[i].count);
        }
        for (let i = 1; i < r.value.output.length; i++) {
            expect(r.value.output[i - 1].count).toBeGreaterThanOrEqual(r.value.output[i].count);
        }
    });

    test('name 取 itemsMap 原文（H2/重氢/增产剂均非 "unknown"）', () => {
        const r = calculateStatsList(makeBp([makeBuilding({ index: 0, itemId: 2314 })]), 1);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const h2 = findDemand(r, 1120);
        const d2 = findOutput(r, 1121);
        const prolif = findDemand(r, 1141);
        expect(h2?.name).toBeTruthy();
        expect(h2?.name).not.toBe('unknown');
        expect(d2?.name).toBeTruthy();
        expect(d2?.name).not.toBe('unknown');
        expect(prolif?.name).toBeTruthy();
        expect(prolif?.name).not.toBe('unknown');
    });
});

describe('calculateStatsList - 错误路径', () => {
    test('坏字符串 → parse-failed', () => {
        const r = calculateStatsList('not a blueprint', 0);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.code).toBe('parse-failed');
        expect(r.error.message).toBeTruthy();
    });

    test('空字符串 → parse-failed', () => {
        const r = calculateStatsList('', 0);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.code).toBe('parse-failed');
    });

    test('非法增产剂（-1 / 4 / 1.5 / NaN）→ invalid-accelerator，不抛错', () => {
        const bp = makeBp([makeBuilding({ index: 0, itemId: 2314 })]);
        for (const bad of [-1, 4, 1.5, NaN]) {
            const r = calculateStatsList(bp, bad as 0);
            expect(r.ok).toBe(false);
            if (r.ok) continue;
            expect(r.error.code).toBe('invalid-accelerator');
        }
    });

    test('输入既非 string 也非对象 → invalid-argument', () => {
        const badInputs = [null, undefined, 42, true, []];
        for (const bad of badInputs) {
            const r = calculateStatsList(bad as unknown as BlueprintData, 0);
            expect(r.ok).toBe(false);
            if (r.ok) continue;
            expect(r.error.code).toBe('invalid-argument');
        }
    });

    test('对象缺少 buildings 数组 → invalid-argument', () => {
        const r = calculateStatsList({} as BlueprintData, 0);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.code).toBe('invalid-argument');
    });

    test('空蓝图（0 建筑）→ ok，空数组', () => {
        const r = calculateStatsList(makeBp([]), 0);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.totalPower).toBe(0);
        expect(r.value.demand).toEqual([]);
        expect(r.value.output).toEqual([]);
    });
});

describe('calculateStatsList - 与 stats 结果的逐项对账', () => {
    test('demand[i].count 来自 items.consumed；output[i].count 来自 items.produced（Mk.II）', () => {
        const bp = makeBp([makeBuilding({ index: 0, itemId: 2314 })]);
        const stats = calculateProductionStats(bp, {
            useAccelerator: true,
            acceleratorItem: AcceleratorItem.MkII,
        });
        const r = calculateStatsList(bp, 2);
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        for (const it of stats.items) {
            if (it.consumed > 0) {
                const d = findDemand(r, it.itemId);
                expect(d).toBeDefined();
                expect(d!.count).toBeCloseTo(it.consumed);
            }
            if (it.produced > 0) {
                const o = findOutput(r, it.itemId);
                expect(o).toBeDefined();
                expect(o!.count).toBeCloseTo(it.produced);
            }
        }
    });
});