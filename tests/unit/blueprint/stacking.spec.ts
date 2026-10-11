import * as fs from 'fs';
import { fromStr, toStr, ResearchMode, LabParamerters, BlueprintBuilding } from '@/blueprint/parser';
import {
    CreateBuildingCommand,
    createBuilding,
    createEmptyBlueprint,
} from '@/blueprint/create';
import { Updater } from '@/command';
import {
    SetBuildingRecipeCommand,
    SetLabResearchModeCommand,
} from '@/blueprint/setBuildingRecipe';
import {
    BOX_TOP_SLOT,
    STACK_BOTTOM_SLOT,
    STACK_TOP_SLOT,
    isStackLink,
    linkStack,
    requiresBase,
    stackBaseFor,
    stackColumn,
    stackOffsetFor,
    stackPortDefaults,
    stackYawFor,
    stackedZ,
    inheritLabSettings,
} from '@/data/stacking';
import { isLab, isSplitter } from '@/data/items';
import { buildingBoxes } from '@/data/building';
import {
    cycleBuildingVariant,
    selectBuilding,
    usePlacement,
    resetToIdle,
} from '@/editor/placementState';

/**
 * 建筑堆叠 / 箱顶放置规则的回归测试。
 *
 * 数据来源：tests/unit/blueprint/fixtures/stacking_game_sample.txt（游戏 0.10.35 手放样本，
 * 同一格逐层叠放）。测试直接把规则与游戏写死的字段对齐，规则表写错会立刻失败。
 */
describe('堆叠规则 vs 游戏样本', () => {
    const game = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/stacking_game_sample.txt',
                'utf-8'
            )
            .trim()
    );
    const at = (i: number) => game.buildings[i];

    /** 样本里的 [底座下标, 上层下标] 配对（逐条核对 dumpBuildings 输出） */
    const PAIRS: [number, number][] = [
        [24, 25], // 储物仓·小 叠 储物仓·小（z +2）
        [12, 18], // 四向分流器 叠 储物仓·小（z +2）
        [0, 11], // 储物仓·小 ← 物流配送器（箱盖 1.875）
        [1, 10], // 储物仓·大 ← 物流配送器（箱盖 2.981）
        [26, 27], // 储物仓·大 叠 储物仓·大（z +3）
        [28, 29], // 储液罐 叠 储液罐（z +3）
        [2, 3], // 矩阵研究站 叠 矩阵研究站（z +3）
        [4, 5], // 矩阵研究站 Mk.II 叠 Mk.II
        [6, 7], // Mk.II 上叠 Mk.I
        [8, 9], // Mk.I 上叠 Mk.II
    ];

    test('每条样本的层高、z、堆叠端口字段都与规则一致', () => {
        for (const [pi, ci] of PAIRS) {
            const parent = at(pi);
            const child = at(ci);
            const label = `${parent.itemId}#${pi} ← ${child.itemId}#${ci}`;
            // 样本里就是"子上、底下"的连接（物流配送器走箱盖接口，不是堆叠端口）
            expect(child.inputObjIdx).toBe(parent.index);
            if (child.itemId !== 2107)
                expect([label, isStackLink(child)]).toEqual([label, true]);
            // 一层高度 = 样本实测 z 差
            const dz = child.localOffset[0].z - parent.localOffset[0].z;
            const off = stackOffsetFor(parent.itemId, child.itemId);
            expect([label, off !== null && Math.abs(off - dz) < 1e-4]).toEqual([
                label,
                true,
            ]);
            // 落位 z 与样本一致
            expect(stackedZ(parent, child.itemId)).toBeCloseTo(
                child.localOffset[0].z,
                4
            );
            // 端口字段与样本逐字段一致
            const fake = createBuilding(
                child.itemId,
                child.modelIndex,
                { x: parent.localOffset[0].x, y: parent.localOffset[0].y },
                0
            );
            linkStack(fake, parent);
            expect([label, fake.inputFromSlot]).toEqual([
                label,
                child.inputFromSlot,
            ]);
            expect([label, fake.inputToSlot]).toEqual([
                label,
                child.inputToSlot,
            ]);
            expect([label, fake.inputOffset]).toEqual([
                label,
                child.inputOffset,
            ]);
        }
    });

    test('未连接时堆叠端口默认值也与游戏一致（out=14/15，in=15/14）', () => {
        let checked = 0;
        for (const b of game.buildings) {
            const d = stackPortDefaults(b.itemId);
            if (!d) continue;
            checked++;
            expect(b.outputObjIdx).toBe(-1);
            expect(b.outputToSlot).toBe(d.outputToSlot);
            expect(b.outputFromSlot).toBe(d.outputFromSlot);
            // 有堆叠连接时 inputFromSlot 由 linkStack 覆盖（同样是 15），inputToSlot 恒 14
            expect(b.inputToSlot).toBe(d.inputToSlot);
            expect(b.inputFromSlot).toBe(STACK_TOP_SLOT);
        }
        // 样本里有储物仓×3 / 储液罐 / 矩阵研究站×4 / 分流器×6
        expect(checked).toBeGreaterThan(10);
    });

    test('堆叠端口常量与样本一致', () => {
        expect(STACK_TOP_SLOT).toBe(15);
        expect(STACK_BOTTOM_SLOT).toBe(14);
        expect(BOX_TOP_SLOT).toBe(13);
        expect(at(11).inputFromSlot).toBe(BOX_TOP_SLOT); // 物流配送器挂箱盖 13
        expect(at(25).inputFromSlot).toBe(STACK_TOP_SLOT);
    });

    test('规则表：允许的组合与游戏样本一致，不允许的组合为 null', () => {
        expect(stackOffsetFor(2101, 2101)).toBe(2);
        expect(stackOffsetFor(2101, 2102)).toBe(2);
        expect(stackOffsetFor(2020, 2101)).toBe(2);
        expect(stackOffsetFor(2102, 2102)).toBe(3);
        expect(stackOffsetFor(2106, 2106)).toBe(3);
        expect(stackOffsetFor(2901, 2902)).toBe(3);
        expect(stackOffsetFor(2902, 2901)).toBe(3);
        // 物流配送器只能放在箱子箱盖上
        expect(stackOffsetFor(2101, 2107)).toBeCloseTo(1.875, 4);
        expect(stackOffsetFor(2102, 2107)).toBeCloseTo(2.9812433, 6);
        expect(stackOffsetFor(2106, 2107)).toBeNull();
        expect(stackOffsetFor(2901, 2107)).toBeNull();
        expect(requiresBase(2107)).toBe(true);
        // 不可堆叠 / 不接受的组合
        expect(stackOffsetFor(2101, 2302)).toBeNull();
        expect(stackOffsetFor(2302, 2101)).toBeNull();
        expect(stackOffsetFor(2901, 2101)).toBeNull();
        expect(stackOffsetFor(2101, 2106)).toBeNull();
        expect(stackOffsetFor(2020, 2102)).toBeNull();
        expect(requiresBase(2101)).toBe(false);
        expect(stackPortDefaults(2302)).toBeUndefined();
        expect(stackPortDefaults(2107)).toBeUndefined();
    });
});

describe('堆叠底座判定（stackBaseFor）', () => {
    const box = createBuilding(2101, 51, { x: 5, y: 11 }, 0);
    box.index = 0;
    const smelter = createBuilding(2302, 62, { x: 27, y: 7 }, 0);
    smelter.index = 1;
    const list = [box, smelter];

    test('光标所指的箱子就是底座；同格也命中', () => {
        expect(stackBaseFor(list, box, 5, 11, 2101)).toBe(box);
        expect(stackBaseFor(list, null, 5, 11, 2101)).toBe(box);
        // 边缘（半格容差内）
        expect(stackBaseFor(list, null, 5.4, 11.4, 2101)).toBe(box);
    });

    test('同类不可堆叠的建筑不产生底座（熔炉上不能叠）', () => {
        expect(stackBaseFor(list, smelter, 27, 7, 2101)).toBeNull();
        expect(stackBaseFor(list, box, 5, 11, 2302)).toBeNull();
    });

    test('物流配送器只有箱子能给底座', () => {
        expect(stackBaseFor(list, box, 5, 11, 2107)).toBe(box);
        expect(stackBaseFor(list, smelter, 27, 7, 2107)).toBeNull();
        expect(stackBaseFor(list, null, 27, 7, 2107)).toBeNull();
    });

    test('离得太远不算堆叠', () => {
        expect(stackBaseFor(list, null, 9, 11, 2101)).toBeNull();
    });

    test('已有堆叠列时取最上层可承载建筑', () => {
        const mid = createBuilding(2101, 51, { x: 5, y: 11 }, 0, 2);
        mid.index = 2;
        linkStack(mid, box);
        const top = createBuilding(2901, 70, { x: 5, y: 11 }, 0, 4);
        top.index = 3;
        // 储物仓不能叠在研究站上 → 底座仍是那一摞箱子的最上层
        expect(stackBaseFor([box, mid, top], null, 5, 11, 2101)).toBe(mid);
        expect(stackedZ(mid, 2101)).toBe(4);
    });
});

describe('堆叠列与研究模式联动', () => {
    function labColumn(): ReturnType<typeof createEmptyBlueprint> {
        const bp = createEmptyBlueprint();
        const a = createBuilding(2901, 70, { x: 4, y: 4 }, 0);
        a.index = 0;
        a.parameters = {
            researchMode: ResearchMode.Research,
            acceleratorMode: 0,
        } as LabParamerters;
        const b = createBuilding(2901, 70, { x: 4, y: 4 }, 0, 3);
        b.index = 1;
        linkStack(b, a);
        inheritLabSettings(b, a);
        const c = createBuilding(2901, 70, { x: 4, y: 4 }, 0, 6);
        c.index = 2;
        linkStack(c, b);
        inheritLabSettings(c, b);
        bp.buildings.push(a, b, c);
        return bp;
    }

    test('堆叠时沿用底座研究站的研究模式与配方', () => {
        const bp = labColumn();
        for (const b of bp.buildings)
            expect((b.parameters as LabParamerters).researchMode).toBe(
                ResearchMode.Research
            );
        // 底座改成"矩阵合成 + 配方 42" → 新叠上去的研究站直接沿用（不限于研究模式）
        (bp.buildings[0].parameters as LabParamerters).researchMode =
            ResearchMode.Compose;
        bp.buildings[0].recipeId = 42;
        const d = createBuilding(2901, 70, { x: 4, y: 4 }, 0, 9);
        linkStack(d, bp.buildings[0]);
        inheritLabSettings(d, bp.buildings[0]);
        expect((d.parameters as LabParamerters).researchMode).toBe(
            ResearchMode.Compose
        );
        expect(d.recipeId).toBe(42);
    });

    test('stackColumn 自下而上取整列，且不跟分拣器连接', () => {
        const bp = labColumn();
        const col = stackColumn(bp.buildings, bp.buildings[1]);
        expect(col.map((b) => b.index)).toEqual([0, 1, 2]);
        const colTop = stackColumn(bp.buildings, bp.buildings[2]);
        expect(colTop.map((b) => b.index)).toEqual([0, 1, 2]);
        // 分拣器连接（inputToSlot=1）不会被当成堆叠
        const sorter = createBuilding(2011, 41, { x: 4, y: 5 }, 180);
        sorter.index = 3;
        sorter.inputObjIdx = 0;
        sorter.inputToSlot = 1;
        bp.buildings.push(sorter);
        expect(isStackLink(sorter)).toBe(false);
        expect(stackColumn(bp.buildings, bp.buildings[0]).length).toBe(3);
    });

    test('点击任意一层改研究模式 → 整列的模式与配方一起改，撤销逐层恢复', () => {
        const bp = labColumn();
        const updater = new Updater();
        // 被点击那一层带着配方 7（整列共享设置：改模式时配方一起同步）
        bp.buildings[1].recipeId = 7;
        const cmd = new SetLabResearchModeCommand(
            bp.buildings[1],
            ResearchMode.Compose
        );
        cmd.do(bp, updater);
        for (const b of bp.buildings) {
            expect((b.parameters as LabParamerters).researchMode).toBe(
                ResearchMode.Compose
            );
            expect(b.recipeId).toBe(7);
        }
        cmd.undo(bp, updater);
        for (const b of bp.buildings) {
            expect((b.parameters as LabParamerters).researchMode).toBe(
                ResearchMode.Research
            );
        }
        expect(bp.buildings.map((b) => b.recipeId)).toEqual([0, 7, 0]);
    });

    test('研究站改配方 → 整列一起改（一列 = 一台机器）', () => {
        const bp = labColumn();
        const updater = new Updater();
        const cmd = new SetBuildingRecipeCommand(bp.buildings[2], 9);
        cmd.do(bp, updater);
        expect(bp.buildings.map((b) => b.recipeId)).toEqual([9, 9, 9]);
        cmd.undo(bp, updater);
        expect(bp.buildings.map((b) => b.recipeId)).toEqual([0, 0, 0]);
    });
});

describe('战场分析基站（"分析仪"）上叠箱子（游戏样本）', () => {
    const game = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/analyzer_box_game_sample.txt',
                'utf-8'
            )
            .trim()
    );
    const [base, box1, box2, dispenser] = game.buildings;

    test('样本结构：分析基站 → 箱子(6) → 箱子(9) → 配送器(11.981)', () => {
        expect(base.itemId).toBe(3009);
        expect(box1.itemId).toBe(2102);
        expect(box2.itemId).toBe(2102);
        expect(dispenser.itemId).toBe(2107);
        expect(box1.localOffset[0].z).toBeCloseTo(6, 4);
        expect(box2.localOffset[0].z).toBeCloseTo(9, 4);
        expect(dispenser.localOffset[0].z).toBeCloseTo(11.9812433, 3);
    });

    test('分析基站：只允许大型储物仓，且底座自己不写 14/15 端口（写 0）', () => {
        expect(stackOffsetFor(3009, 2102)).toBe(6);
        expect(stackOffsetFor(3009, 2101)).toBeNull(); // 小箱子放不上去
        expect(stackOffsetFor(3009, 2107)).toBeNull(); // 配送器仍需箱子
        expect(stackOffsetFor(3009, 2302)).toBeNull();
        expect(stackPortDefaults(3009)).toBeUndefined();
        expect([
            base.outputToSlot,
            base.outputFromSlot,
            base.inputFromSlot,
            base.inputToSlot,
        ]).toEqual([0, 0, 0, 0]);
    });

    test('分析基站上的大箱子必须转到底座 yaw + 90°（长方形台面对齐）', () => {
        // 样本：底座 yaw=0、箱子 yaw=90
        expect(stackYawFor(base, 2102)).toBe(base.yaw[0] + 90);
        expect(stackYawFor(base, 2102)).toBe(box1.yaw[0]);
        // 其他组合没有朝向要求
        expect(stackYawFor(box1, 2102)).toBeNull();
        expect(stackYawFor(box1, 2107)).toBeNull();
        expect(stackYawFor(base, 2107)).toBeNull();
        // 旋转的底座同样按相对 90° 计算
        const rotated = createBuilding(3009, 453, { x: 0, y: 0 }, 180);
        expect(stackYawFor(rotated, 2102)).toBe(270);
    });

    test('整条链的 z 与堆叠端口字段都能用规则复现', () => {
        // 分析基站 ← 箱子
        expect(box1.inputObjIdx).toBe(base.index);
        expect(stackedZ(base, 2102)).toBeCloseTo(box1.localOffset[0].z, 4);
        const fake1 = createBuilding(
            2102,
            52,
            { x: 0, y: 0 },
            stackYawFor(base, 2102)!
        );
        linkStack(fake1, base);
        expect(fake1.yaw[0]).toBe(box1.yaw[0]);
        expect(fake1.inputFromSlot).toBe(box1.inputFromSlot);
        expect(fake1.inputToSlot).toBe(box1.inputToSlot);
        // 箱子 ← 箱子
        expect(stackedZ(box1, 2102)).toBeCloseTo(box2.localOffset[0].z, 4);
        // 箱子 ← 配送器（箱盖）
        expect(stackedZ(box2, 2107)).toBeCloseTo(
            dispenser.localOffset[0].z,
            4
        );
        const fake2 = createBuilding(2107, 371, { x: 0, y: 0 }, 90);
        linkStack(fake2, box2);
        expect(fake2.inputFromSlot).toBe(BOX_TOP_SLOT);
        expect(fake2.inputToSlot).toBe(dispenser.inputToSlot);
        expect(fake2.inputFromSlot).toBe(dispenser.inputFromSlot);
    });

    test('stackBaseFor 能把大箱子叠到分析基站上', () => {
        const picked = stackBaseFor([base], base, 0, 0, 2102);
        expect(picked).toBe(base);
        // 小箱子/配送器都不能直接放在分析基站上
        expect(stackBaseFor([base], base, 0, 0, 2101)).toBeNull();
        expect(stackBaseFor([base], base, 0, 0, 2107)).toBeNull();
    });
});

describe('堆叠写入 → 导出 → 再解析（端到端）', () => {
    test('叠出来的储物仓保留 z 与堆叠端口', () => {
        const bp = createEmptyBlueprint();
        const base = createBuilding(2101, 51, { x: 5, y: 11 }, 0);
        new CreateBuildingCommand(base).do(bp);
        const parent = stackBaseFor(bp.buildings, base, 5, 11, 2101)!;
        expect(parent).toBe(base);
        const child = createBuilding(
            2101,
            51,
            { x: parent.localOffset[0].x, y: parent.localOffset[0].y },
            0,
            stackedZ(parent, 2101)
        );
        linkStack(child, parent);
        new CreateBuildingCommand(child).do(bp);
        expect(child.index).toBe(1);
        expect(child.inputObjIdx).toBe(0);

        const parsed = fromStr(toStr(bp));
        const bottom = parsed.buildings[0];
        const top = parsed.buildings[1];
        expect(top.localOffset[0].z).toBeCloseTo(
            bottom.localOffset[0].z + 2,
            4
        );
        expect(top.localOffset[0].x).toBe(bottom.localOffset[0].x);
        expect(top.localOffset[0].y).toBe(bottom.localOffset[0].y);
        expect(top.inputObjIdx).toBe(bottom.index);
        expect(top.inputFromSlot).toBe(STACK_TOP_SLOT);
        expect(top.inputToSlot).toBe(STACK_BOTTOM_SLOT);
        // 底座侧端口是游戏默认值（输出仍无连接）
        expect(bottom.outputObjIdx).toBe(-1);
        expect(bottom.outputToSlot).toBe(STACK_BOTTOM_SLOT);
        expect(bottom.outputFromSlot).toBe(STACK_TOP_SLOT);
    });

    test('物流配送器落在箱盖上（箱盖 13 端口，z = 箱盖高度）', () => {
        const bp = createEmptyBlueprint();
        const box = createBuilding(2102, 52, { x: 5, y: 11 }, 0);
        new CreateBuildingCommand(box).do(bp);
        const parent = stackBaseFor(bp.buildings, box, 5, 11, 2107);
        expect(parent).toBe(box);
        const dispenser = createBuilding(
            2107,
            371,
            { x: parent!.localOffset[0].x, y: parent!.localOffset[0].y },
            0,
            stackedZ(parent, 2107)
        );
        linkStack(dispenser, parent!);
        new CreateBuildingCommand(dispenser).do(bp);

        const parsed = fromStr(toStr(bp));
        const top = parsed.buildings[1];
        expect(top.itemId).toBe(2107);
        expect(top.localOffset[0].z).toBeCloseTo(2.9812433, 4);
        expect(top.inputObjIdx).toBe(parsed.buildings[0].index);
        expect(top.inputFromSlot).toBe(BOX_TOP_SLOT);
        expect(top.inputToSlot).toBe(0);
    });
});

describe('分流器变形样式切换', () => {
    test('四向分流器在 38/39/40 之间循环，其他建筑无变形', () => {
        selectBuilding(2020, 38);
        expect(cycleBuildingVariant()).toBe(39);
        expect(cycleBuildingVariant()).toBe(40);
        expect(cycleBuildingVariant()).toBe(38);
        expect(usePlacement().selectedModelIndex).toBe(38);
        expect(isSplitter(usePlacement().selectedItemId!)).toBe(true);
        // 非变形建筑：返回 null 且不动模型序号
        selectBuilding(2101, 51);
        expect(cycleBuildingVariant()).toBeNull();
        expect(usePlacement().selectedModelIndex).toBe(51);
        resetToIdle();
    });

    test('变形建筑三态的选择盒尺寸各不相同（38/40 与 39 不同）', () => {
        // 一字形 (39) 在 x 方向明显更窄，用于确认形态确实切换了模型
        expect(buildingBoxes.get(39)![0]).toBeLessThan(
            buildingBoxes.get(38)![0]
        );
    });

    test('矩阵研究站属于研究站判定', () => {
        expect(isLab(2901)).toBe(true);
        expect(isLab(2902)).toBe(true);
        expect(isLab(2302)).toBe(false);
    });
});

/**
 * 用户样本 `stack_upward_game_sample.txt`（= `tests/tools/新蓝图002.txt`，0.10.35）：
 * 三对**同类自叠**——四向分流器→四向分流器（z=2）、喷涂机→喷涂机（z=2）、
 * 自动集装机→自动集装机（z=1.999）。此前兼容表里没有这三条，编辑器落位时会当成
 * "同格两栋建筑"（都写 z=0）而不是向上叠放。
 */
describe('建筑向上叠放（同类自叠样本）', () => {
    const game = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/stack_upward_game_sample.txt',
                'utf-8'
            )
            .trim()
    );
    const at = (i: number) => game.buildings[i];
    /** 样本里的 [底座下标, 上层下标] 配对 */
    const PAIRS: [number, number][] = [
        [0, 1], // 四向分流器 叠 四向分流器（z +2）
        [2, 3], // 喷涂机 叠 喷涂机（z +2）
        [4, 5], // 自动集装机 叠 自动集装机（z +1.999）
    ];

    test('三条同类自叠的层高、z 与端口字段都与样本一致', () => {
        for (const [pi, ci] of PAIRS) {
            const parent = at(pi);
            const child = at(ci);
            const label = `${parent.itemId}#${pi} ← ${child.itemId}#${ci}`;
            // 兼容表放行
            const off = stackOffsetFor(parent.itemId, child.itemId);
            expect([label, off]).not.toEqual([label, null]);
            // 层高与样本 z 差一致（集装机样本是 1.999，容 0.01）
            const dz =
                child.localOffset[0].z - parent.localOffset[0].z;
            expect([label, Math.abs(off! - dz) <= 0.01]).toEqual([
                label,
                true,
            ]);
            // 落位 z
            expect(stackedZ(parent, child.itemId)).toBeCloseTo(
                child.localOffset[0].z,
                2
            );
            // 上层建筑写 15/14 堆叠端口 + 指向底座；底座保持默认值
            expect([label, child.inputObjIdx]).toEqual([
                label,
                parent.index,
            ]);
            expect([label, child.inputFromSlot]).toEqual([
                label,
                STACK_TOP_SLOT,
            ]);
            expect([label, child.inputToSlot]).toEqual([
                label,
                STACK_BOTTOM_SLOT,
            ]);
            expect([label, child.inputOffset]).toEqual([label, 0]);
            expect([label, isStackLink(child)]).toEqual([label, true]);
            expect([label, parent.inputObjIdx]).toEqual([label, -1]);
            expect([label, parent.outputObjIdx]).toEqual([label, -1]);
        }
    });

    test('未叠放时这三类建筑的堆叠端口默认值也有（与样本底座一致）', () => {
        for (const b of game.buildings) {
            const d = stackPortDefaults(b.itemId);
            expect(d).not.toBeUndefined();
            expect(b.outputToSlot).toBe(d!.outputToSlot);
            expect(b.outputFromSlot).toBe(d!.outputFromSlot);
            expect(b.inputFromSlot).toBe(d!.inputFromSlot);
            expect(b.inputToSlot).toBe(d!.inputToSlot);
        }
    });

    test('编辑器落位链路：预览/放置都会叠到上一层并写 15/14', () => {
        const bp = createEmptyBlueprint();
        const base = createBuilding(2313, 120, { x: 5, y: 80 }, 0);
        new CreateBuildingCommand(base).do(bp);
        // 光标落在底座上 → 底座判定 + 落位高度
        const parent = stackBaseFor(bp.buildings, base, 5, 80, 2313);
        expect(parent).toBe(base);
        expect(stackedZ(parent, 2313)).toBe(2);
        // 新建筑按堆叠链路写入
        const child = createBuilding(
            2313,
            120,
            { x: 5, y: 80 },
            0,
            stackedZ(parent, 2313)
        );
        linkStack(child, parent as BlueprintBuilding);
        new CreateBuildingCommand(child).do(bp);
        expect(child.localOffset[0].z).toBe(2);
        expect(child.inputObjIdx).toBe(base.index);
        expect(child.inputFromSlot).toBe(STACK_TOP_SLOT);
        expect(child.inputToSlot).toBe(STACK_BOTTOM_SLOT);
        // 导出再解析：三层链路字段保持（一列两台）
        const back = fromStr(toStr(bp));
        const top = back.buildings.find((b) => b.localOffset[0].z === 2)!;
        expect(top.itemId).toBe(2313);
        expect(top.inputFromSlot).toBe(STACK_TOP_SLOT);
        expect(top.inputToSlot).toBe(STACK_BOTTOM_SLOT);
    });

    test('喷涂机/集装机也能连续向上叠（stackBaseFor 取该格最高建筑）', () => {
        const bp = createEmptyBlueprint();
        const base = createBuilding(2040, 257, { x: 5, y: 80 }, 0);
        new CreateBuildingCommand(base).do(bp);
        const mid = createBuilding(
            2040,
            257,
            { x: 5, y: 80 },
            0,
            stackedZ(base, 2040)
        );
        linkStack(mid, base);
        new CreateBuildingCommand(mid).do(bp);
        // 光标还在同一格：底座应取"能承载的最高建筑"（mid）
        const parent = stackBaseFor(bp.buildings, mid, 5, 80, 2040);
        expect(parent?.index).toBe(mid.index);
        expect(stackedZ(parent as BlueprintBuilding, 2040)).toBeCloseTo(
            4,
            4
        );
    });
});
