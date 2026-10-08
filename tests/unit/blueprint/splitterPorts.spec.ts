import * as fs from 'fs';
import {
    BlueprintBuilding,
    SplitterParameters,
    fromStr,
    toStr,
} from '@/blueprint/parser';
import {
    CreateBuildingCommand,
    createBuilding,
    createEmptyBlueprint,
} from '@/blueprint/create';
import { Updater } from '@/command';
import {
    SetSplitterFilterCommand,
    SetSplitterPriorityCommand,
} from '@/blueprint/setSplitterPort';
import {
    hasPrioritizedOutput,
    isPortPrioritized,
    splitterPortClickAction,
    splitterPortKind,
    splitterPortKinds,
} from '@/blueprint/splitterPorts';
import {
    SPLITTER_PORT_HALF,
    splitterPortPos,
    splitterPorts,
} from '@/data/splitter';

/**
 * 四向分流器"优先输入/输出 + 筛选"功能。
 *
 * 数据依据：游戏 0.10.35 实测（fixture sample_throughput.txt）
 * - `parameters.priority[port]` = 该口是否设优先
 * - 筛选物品在建筑 `filterId`，只挂在"优先输出"口上
 * - 传送带直连分流器时口编号写在 `outputToSlot`（送入 = 输入口）/
 *   `inputFromSlot`（取出 = 输出口）
 */
describe('分流器口几何', () => {
    test('十字形 38/40 四口全开，一字形 39 只有长轴两端', () => {
        expect(splitterPorts(38).map((p) => p.port)).toEqual([0, 1, 2, 3]);
        expect(splitterPorts(40).map((p) => p.port)).toEqual([0, 1, 2, 3]);
        expect(splitterPorts(39).map((p) => p.port)).toEqual([0, 2]);
    });

    test('口在四边中点（0=+y 1=+x 2=-y 3=-x）', () => {
        expect(splitterPortPos(0)).toEqual({ x: 0, y: SPLITTER_PORT_HALF });
        expect(splitterPortPos(1)).toEqual({ x: SPLITTER_PORT_HALF, y: 0 });
        expect(splitterPortPos(2)).toEqual({ x: 0, y: -SPLITTER_PORT_HALF });
        expect(splitterPortPos(3)).toEqual({ x: -SPLITTER_PORT_HALF, y: 0 });
    });
});

describe('分流器口角色（真实游戏蓝图）', () => {
    const game = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/sample_throughput.txt',
                'utf-8'
            )
            .trim()
    );
    const at = (index: number) =>
        game.buildings.find((b) => b.index === index)!;

    test('#47：0 口是输出口，设了优先并挂了筛选 6001', () => {
        const sp = at(47);
        expect(sp.itemId).toBe(2020);
        expect(splitterPortKind(game.buildings, 47, 0)).toBe('out');
        expect(isPortPrioritized(sp, 0)).toBe(true);
        expect(sp.filterId).toBe(6001);
        expect(hasPrioritizedOutput(game.buildings, sp)).toBe(true);
    });

    test('#30：2 口是输入口，设了优先但没有筛选', () => {
        const sp = at(30);
        expect(splitterPortKind(game.buildings, 30, 2)).toBe('in');
        expect(isPortPrioritized(sp, 2)).toBe(true);
        expect(sp.filterId).toBe(0);
        expect(hasPrioritizedOutput(game.buildings, sp)).toBe(false);
    });

    test('所有设了优先的口都能判出输入/输出角色', () => {
        let checked = 0;
        for (const sp of game.buildings) {
            if (sp.itemId !== 2020) continue;
            const p = sp.parameters as SplitterParameters;
            const kinds = splitterPortKinds(game.buildings, sp.index);
            for (let i = 0; i < 4; i++) {
                if (!p.priority[i]) continue;
                checked++;
                expect(kinds.get(i)).toBeDefined();
            }
        }
        expect(checked).toBe(6); // 样本里 6 个分流器各有一个优先口
    });
});

describe('优先输入/输出与筛选命令', () => {
    /** 分流器 (10,10)：南侧传送带送入（口 2 = 输入），东侧传送带取出（口 1 = 输出） */
    function splitterBp() {
        const bp = createEmptyBlueprint();
        const sp = createBuilding(2020, 38, { x: 10, y: 10 }, 0);
        const inBelt = createBuilding(2001, 35, { x: 10, y: 9 }, 0);
        const outBelt = createBuilding(2001, 35, { x: 11, y: 10 }, 90);
        new CreateBuildingCommand(sp).do(bp);
        new CreateBuildingCommand(inBelt).do(bp);
        new CreateBuildingCommand(outBelt).do(bp);
        // 游戏里传送带直连分流器的口编号就写在 wire 字段上
        inBelt.outputObjIdx = sp.index;
        inBelt.outputToSlot = 2;
        outBelt.inputObjIdx = sp.index;
        outBelt.inputFromSlot = 1;
        return { bp, sp, inBelt, outBelt };
    }

    test('口角色来自传送带 wire 字段', () => {
        const { bp, sp } = splitterBp();
        const kinds = splitterPortKinds(bp.buildings, sp.index);
        expect(kinds.get(2)).toBe('in');
        expect(kinds.get(1)).toBe('out');
        expect(kinds.get(0)).toBeUndefined();
    });

    test('左键：未优先→设优先；优先输出→开筛选；优先输入→无操作', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        const p = sp.parameters as SplitterParameters;
        const kind = (port: number) =>
            splitterPortKind(bp.buildings, sp.index, port);

        expect(splitterPortClickAction(false, kind(1))).toBe('priority');
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        expect(p.priority[1]).toBe(true);
        expect(splitterPortClickAction(true, kind(1))).toBe('filter');

        new SetSplitterFilterCommand(sp, 1002).do(bp, updater);
        expect(sp.filterId).toBe(1002);

        new SetSplitterPriorityCommand(sp, 2, true).do(bp, updater);
        expect(p.priority[2]).toBe(true);
        expect(splitterPortClickAction(true, kind(2))).toBe('none');
    });

    test('右键取消输出口优先：无优先输出口时筛选一并清空，撤销一起还原', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        const p = sp.parameters as SplitterParameters;
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        new SetSplitterFilterCommand(sp, 1002).do(bp, updater);

        const clear = new SetSplitterPriorityCommand(sp, 1, false);
        clear.do(bp, updater);
        expect(p.priority[1]).toBe(false);
        expect(sp.filterId).toBe(0);

        clear.undo(bp, updater);
        expect(p.priority[1]).toBe(true);
        expect(sp.filterId).toBe(1002);
    });

    test('取消输入口优先不影响输出口的筛选', () => {
        const { bp, sp, outBelt } = splitterBp();
        const updater = new Updater();
        const p = sp.parameters as SplitterParameters;
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        new SetSplitterFilterCommand(sp, 1101).do(bp, updater);
        new SetSplitterPriorityCommand(sp, 2, true).do(bp, updater);

        new SetSplitterPriorityCommand(sp, 2, false).do(bp, updater);
        expect(p.priority[2]).toBe(false);
        expect(sp.filterId).toBe(1101); // 输出口 1 仍设优先 → 筛选保留

        void outBelt;
    });

    test('优先/筛选改动随蓝图导出再解析', () => {
        const { bp, sp } = splitterBp();
        const updater = new Updater();
        new SetSplitterPriorityCommand(sp, 1, true).do(bp, updater);
        new SetSplitterFilterCommand(sp, 6002).do(bp, updater);
        const parsed = fromStr(toStr(bp));
        const parsedSp: BlueprintBuilding = parsed.buildings.find(
            (b) => b.itemId === 2020
        )!;
        expect((parsedSp.parameters as SplitterParameters).priority[1]).toBe(
            true
        );
        expect(parsedSp.filterId).toBe(6002);
    });
});
