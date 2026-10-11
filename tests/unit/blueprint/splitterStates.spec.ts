import * as fs from 'fs';
import { BlueprintData, fromStr, toStr } from '@/blueprint/parser';
import { createBuilding, createEmptyBlueprint } from '@/blueprint/create';
import { CreateBuildingCommand } from '@/blueprint/create';
import { Updater } from '@/command';
import {
    SetSplitterFilterCommand,
    SetSplitterPriorityCommand,
} from '@/blueprint/setSplitterPort';
import {
    SPLITTER_STATE_NAMES,
    SplitterState,
    splitterStateAt,
    splitterStateOf,
} from '@/blueprint/splitterStates';

/**
 * 传送带连接分流器的 6 种状态（定义与检测 + 蓝图持久化）。
 *
 * 数据依据：fixtures/splitter_6states_game_sample.txt（游戏 0.10.35 实测），
 * 6 个分流器按坐标从左到右正好对应状态 1-6。
 */
describe('分流器 6 种连接状态定义', () => {
    const game = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/splitter_6states_game_sample.txt',
                'utf-8'
            )
            .trim()
    );
    const at = (index: number) =>
        game.buildings.find((b) => b.index === index)!;

    test('6 个状态名定义齐全', () => {
        expect(SPLITTER_STATE_NAMES).toEqual([
            '一进模式',
            '溢出模式',
            '一进一出模式',
            '一进一出、开启优先输入',
            '一进一出、开启优先输出',
            '一进一出、开启优先输出并筛选',
        ]);
    });

    test('按坐标从左到右识别出状态 1-6（fixture 逐项一致）', () => {
        // (0,2)=#2 一进 / (3,2)=#6 溢出 / (6,2)=#11 一进一出 /
        // (9,2)=#19 优先输入 / (12,2)=#27 优先输出 / (15,2)=#0 优先输出+铁矿筛选
        const byX = game.buildings
            .filter((b) => b.itemId === 2020)
            .sort(
                (a, b) =>
                    a.localOffset[0].x - b.localOffset[0].x ||
                    a.localOffset[0].y - b.localOffset[0].y
            );
        expect(byX.map((b) => splitterStateAt(game.buildings, b.index))).toEqual([
            1, 2, 3, 4, 5, 6,
        ]);
        expect(at(2).filterId).toBe(0);
        expect(at(19).filterId).toBe(0);
        expect(at(27).filterId).toBe(0);
        expect(at(0).filterId).toBe(1001); // 铁矿
    });

    test('连接数/设置不匹配的状态返回 null', () => {
        // #5 等非分流器建筑
        const notSplitter = game.buildings.find((b) => b.itemId !== 2020)!;
        expect(splitterStateOf(game.buildings, notSplitter)).toBeNull();
        // 构造 2 输入口的分流器（不属 6 种状态）
        const bp = createEmptyBlueprint();
        const sp = createBuilding(2020, 38, { x: 5, y: 5 }, 0);
        const inBelt = createBuilding(2001, 35, { x: 5, y: 4 }, 0);
        const inBelt2 = createBuilding(2001, 35, { x: 4, y: 5 }, 90);
        new CreateBuildingCommand(sp).do(bp);
        new CreateBuildingCommand(inBelt).do(bp);
        new CreateBuildingCommand(inBelt2).do(bp);
        inBelt.outputObjIdx = sp.index;
        inBelt.outputToSlot = 2;
        inBelt2.outputObjIdx = sp.index;
        inBelt2.outputToSlot = 1;
        expect(splitterStateOf(bp.buildings, sp)).toBeNull();
        // 一进一出但同时设了优先输入与优先输出 → 也不属 6 种状态
        inBelt2.outputObjIdx = -1;
        inBelt2.outputToSlot = 0;
        const outBelt = createBuilding(2001, 35, { x: 6, y: 5 }, 0);
        new CreateBuildingCommand(outBelt).do(bp);
        outBelt.inputObjIdx = sp.index;
        outBelt.inputFromSlot = 0;
        const updater = new Updater();
        new SetSplitterPriorityCommand(sp, 2, true).do(bp, updater);
        new SetSplitterPriorityCommand(sp, 0, true).do(bp, updater);
        expect(splitterStateOf(bp.buildings, sp)).toBeNull();
    });

    test('6 种状态随蓝图导出再导入完整保留（持久化）', () => {
        const parsed = fromStr(toStr(game));
        const byX = (bp: BlueprintData) =>
            bp.buildings
                .filter((b) => b.itemId === 2020)
                .sort(
                    (a, b) =>
                        a.localOffset[0].x - b.localOffset[0].x ||
                        a.localOffset[0].y - b.localOffset[0].y
                );
        const before = byX(game).map((b) =>
            splitterStateAt(game.buildings, b.index)
        );
        const after = byX(parsed).map((b) =>
            splitterStateAt(parsed.buildings, b.index)
        );
        expect(after).toEqual(before);
        expect(after).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('面板交互状态迁移', () => {
    /** 分流器 (10,10)：南侧带送入（口 2 = 输入），东侧带取出（口 1 = 输出） */
    function splitterBp() {
        const bp = createEmptyBlueprint();
        const sp = createBuilding(2020, 38, { x: 10, y: 10 }, 0);
        const inBelt = createBuilding(2001, 35, { x: 10, y: 9 }, 0);
        const outBelt = createBuilding(2001, 35, { x: 11, y: 10 }, 90);
        new CreateBuildingCommand(sp).do(bp);
        new CreateBuildingCommand(inBelt).do(bp);
        new CreateBuildingCommand(outBelt).do(bp);
        inBelt.outputObjIdx = sp.index;
        inBelt.outputToSlot = 2;
        outBelt.inputObjIdx = sp.index;
        outBelt.inputFromSlot = 1;
        return { bp, sp, inBelt, outBelt };
    }

    test('左键流程：一进一出→优先输入→优先输出→筛选，各状态逐级迁移', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        const state = () => splitterStateOf(bp.buildings, sp);
        // 初始：一进一出、无设置
        expect(state()).toBe(3 as SplitterState);
        // 左键输入口（口 2）：未设优先 → 设优先输入
        new SetSplitterPriorityCommand(sp, 2, true).do(bp, updater);
        expect(state()).toBe(4 as SplitterState);
        // 左键输出口（口 1）：设优先输出；此时输入口仍设优先 → 双优先不属 6 态
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        expect(state()).toBeNull();
        // 取消输入口优先（右键口 2）→ 回到一进一出+优先输出
        new SetSplitterPriorityCommand(sp, 2, false).do(bp, updater);
        expect(state()).toBe(5 as SplitterState);
        // 已设优先的输出口再点左键 → 开筛选（铁矿 1001）
        new SetSplitterFilterCommand(sp, 1001).do(bp, updater);
        expect(state()).toBe(6 as SplitterState);
    });

    test('右键取消唯一优先输出口会一并清空筛选，状态退回一进一出', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        new SetSplitterFilterCommand(sp, 1001).do(bp, updater);
        expect(splitterStateOf(bp.buildings, sp)).toBe(6 as SplitterState);
        // 右键取消输出口优先 → 无优先输出口 → 筛选清空 → 状态 3
        new SetSplitterPriorityCommand(sp, 1, false).do(bp, updater);
        expect(sp.filterId).toBe(0);
        expect(splitterStateOf(bp.buildings, sp)).toBe(3 as SplitterState);
    });

    test('状态迁移后蓝图导出再导入，状态保持一致', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        new SetSplitterPriorityCommand(sp, 2, true).do(bp, updater);
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        new SetSplitterPriorityCommand(sp, 2, false).do(bp, updater);
        new SetSplitterFilterCommand(sp, 1001).do(bp, updater);
        expect(splitterStateOf(bp.buildings, sp)).toBe(6 as SplitterState);
        const parsed = fromStr(toStr(bp));
        const parsedSp = parsed.buildings.find((b) => b.index === sp.index)!;
        expect(splitterStateOf(parsed.buildings, parsedSp)).toBe(6 as SplitterState);
    });
});
