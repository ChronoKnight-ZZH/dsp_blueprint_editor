import * as fs from 'fs';
import { BeltParameters, fromStr, toStr } from '@/blueprint/parser';
import {
    CreateBuildingCommand,
    createBuilding,
    createEmptyBlueprint,
} from '@/blueprint/create';
import { Updater } from '@/command';
import { SetBeltParamsCommand } from '@/blueprint/setBeltParams';
import { isBelt } from '@/data/items';

/**
 * 传送带"图标 / 数量"参数。
 *
 * 背景（用户反馈）：游戏里没设过图标/数量的传送带**没有 parameters 字段**，
 * 工具新建的传送带同样如此（`defaultParamsFor(2001)` 返回 null），
 * 但详情面板以前只在 `parameters` 非空时才显示图标/数量编辑器，
 * 于是工具创建的传送带根本没法设图标和数字。现在按 null → 0/0 显示，
 * 第一次修改时由 `SetBeltParamsCommand` 按需创建 `{iconId, count}`。
 */
describe('传送带参数（图标/数量）', () => {
    test('工具新建的传送带没有参数；设置图标/数量后按需创建', () => {
        const bp = createEmptyBlueprint();
        const updater = new Updater();
        const belt = createBuilding(2001, 35, { x: 2, y: 4 }, 90);
        new CreateBuildingCommand(belt).do(bp);
        expect(belt.parameters).toBeNull();

        new SetBeltParamsCommand(belt, 'iconId', 1002).do(bp, updater);
        const p = belt.parameters as BeltParameters;
        expect(p.iconId).toBe(1002);
        expect(p.count).toBe(0);

        new SetBeltParamsCommand(belt, 'count', 5000).do(bp, updater);
        expect(p.count).toBe(5000);
    });

    test('图标/数量能随蓝图导出再解析（游戏编码 = 2 个 int）', () => {
        const bp = createEmptyBlueprint();
        const updater = new Updater();
        const belt = createBuilding(2003, 37, { x: 3, y: 5 }, 0);
        new CreateBuildingCommand(belt).do(bp);
        new SetBeltParamsCommand(belt, 'iconId', 1210).do(bp, updater);
        new SetBeltParamsCommand(belt, 'count', 1234).do(bp, updater);

        const parsed = fromStr(toStr(bp));
        const b = parsed.buildings.find((x) => isBelt(x.itemId))!;
        expect(b.parameters).not.toBeNull();
        const p = b.parameters as BeltParameters;
        expect(p.iconId).toBe(1210);
        expect(p.count).toBe(1234);
    });

    test('撤销恢复原值（没有参数时也保持可撤销的旧值 0/0）', () => {
        const bp = createEmptyBlueprint();
        const updater = new Updater();
        const belt = createBuilding(2001, 35, { x: 2, y: 4 }, 90);
        new CreateBuildingCommand(belt).do(bp);
        const cmd = new SetBeltParamsCommand(belt, 'iconId', 1002);
        cmd.do(bp, updater);
        cmd.undo(bp, updater);
        expect((belt.parameters as BeltParameters).iconId).toBe(0);
    });

    test('真实游戏蓝图里"带参数的传送带"就是 {iconId, count}', () => {
        const game = fromStr(
            fs
                .readFileSync(
                    'tests/unit/blueprint/fixtures/dense_splitters_v1.txt',
                    'utf-8'
                )
                .trim()
        );
        const withParams = game.buildings.filter(
            (b) => isBelt(b.itemId) && b.parameters !== null
        );
        expect(withParams.length).toBeGreaterThan(0);
        for (const b of withParams) {
            const p = b.parameters as BeltParameters;
            expect(typeof p.iconId).toBe('number');
            expect(typeof p.count).toBe('number');
        }
    });
});
