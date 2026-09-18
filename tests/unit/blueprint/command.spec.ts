import { fromStr, BlueprintData } from '@/blueprint/parser';
import { CommandQueue, Command } from '@/command';
import { RemoveBuildingCommand } from '@/blueprint/removeBuilding';
import { ReplaceCommand, ReplaceParams } from '@/blueprint/replace';
import { AcceleratorMode } from '@/blueprint/parser';
import { SetAcceleratorCommand } from '@/blueprint/setAccelerator';
import * as fs from 'fs';
import * as path from 'path';

function load(file: string): BlueprintData {
    const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8').trim();
    return fromStr(raw);
}

describe('CommandQueue silent / non-silent version split', () => {
    test('ReplaceCommand (silent) increments stateVersion but not execVersion', () => {
        const data = load('same_buildings_v2.txt');
        const q = new CommandQueue(data);
        const sv0 = q.stateVersion.value;
        const ev0 = q.execVersion.value;

        // 找一个有 recipe 的建筑作为替换目标
        const target = data.buildings.find(b => b.recipeId > 0);
        if (!target) return;  // 跳过无 recipe 的 fixture

        const searchRecipe = target.recipeId;
        // 找另一个 recipe 来替换
        const other = data.buildings.find(b => b.recipeId > 0 && b.recipeId !== searchRecipe);
        if (!other) return;

        const params: ReplaceParams = {
            searchRecipe,
            replaceRecipe: other.recipeId,
            scope: { recipe: true, filter: false, station: false, beltIcon: false, blueprintIcon: false },
        };
        q.push(new ReplaceCommand(data, params));

        // silent 命令：stateVersion 必须变，execVersion 必须不变
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBe(ev0);

        // undo 同样是 silent
        q.undo();
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBe(ev0);
    });

    test('SetAcceleratorCommand (silent) increments stateVersion but not execVersion', () => {
        const data = load('starting_base_01029.txt');
        const q = new CommandQueue(data);
        const sv0 = q.stateVersion.value;
        const ev0 = q.execVersion.value;

        q.push(new SetAcceleratorCommand(data, { mode: AcceleratorMode.Accelerate }));

        // silent 命令
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBe(ev0);

        q.undo();
        expect(q.execVersion.value).toBe(ev0);
    });

    test('RemoveBuildingCommand (non-silent) increments both stateVersion and execVersion', () => {
        const data = load('starting_base_01029.txt');
        const q = new CommandQueue(data);
        const sv0 = q.stateVersion.value;
        const ev0 = q.execVersion.value;

        q.push(new RemoveBuildingCommand(0, data));

        // 非 silent：两个版本号都变
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBeGreaterThan(ev0);

        q.undo();
        // undo 同样是非 silent
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBeGreaterThan(ev0);

        q.redo();
        expect(q.execVersion.value).toBeGreaterThan(ev0);
    });

    test('silent then non-silent: execVersion only bumps on non-silent', () => {
        const data = load('starting_base_01029.txt');
        const q = new CommandQueue(data);
        const ev0 = q.execVersion.value;

        // 先一个 silent 命令
        q.push(new SetAcceleratorCommand(data, { mode: AcceleratorMode.Accelerate }));
        expect(q.execVersion.value).toBe(ev0);

        // 再一个 non-silent 命令
        q.push(new RemoveBuildingCommand(0, data));
        expect(q.execVersion.value).toBeGreaterThan(ev0);
    });
});
