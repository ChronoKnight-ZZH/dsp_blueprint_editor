import { fromStr, toStr, BlueprintData, ResearchMode } from '@/blueprint/parser';
import { CommandQueue } from '@/command';
import { SetBuildingRecipeCommand, SetLabResearchModeCommand } from '@/blueprint/setBuildingRecipe';
import { isLab } from '@/data/items';
import * as fs from 'fs';
import * as path from 'path';

function load(file: string): BlueprintData {
    const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8').trim();
    return fromStr(raw);
}

describe('SetBuildingRecipeCommand', () => {
    test('do/undo changes and restores recipeId; silent (stateVersion only)', () => {
        const data = load('same_buildings_v2.txt');
        const q = new CommandQueue(data);
        const sv0 = q.stateVersion.value;
        const ev0 = q.execVersion.value;

        const target = data.buildings.find(b => b.recipeId > 0);
        if (!target) return; // 跳过无 recipe 的 fixture

        // 找一个不同的 recipeId 作为新值
        const other = data.buildings.find(b => b.recipeId > 0 && b.recipeId !== target.recipeId);
        if (!other) return;
        const newRecipeId = other.recipeId;
        const oldRecipeId = target.recipeId;

        q.push(new SetBuildingRecipeCommand(target, newRecipeId));

        // silent: 只 bump stateVersion，不 bump execVersion
        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBe(ev0);

        expect(target.recipeId).toBe(newRecipeId);

        q.undo();
        expect(target.recipeId).toBe(oldRecipeId);
        expect(q.execVersion.value).toBe(ev0);

        q.redo();
        expect(target.recipeId).toBe(newRecipeId);
    });

    test('merge combines consecutive edits to the same building', () => {
        const data = load('same_buildings_v2.txt');
        const q = new CommandQueue(data);

        const target = data.buildings.find(b => b.recipeId > 0);
        if (!target) return;
        const other = data.buildings.find(b => b.recipeId > 0 && b.recipeId !== target.recipeId);
        if (!other) return;

        const before = q.stateVersion.value;
        q.push(new SetBuildingRecipeCommand(target, other.recipeId));
        const afterFirst = q.stateVersion.value;
        // 第二条命令应被 merge 进第一条，不再额外 bump stateVersion（push 命中 merge 提前 return）
        q.push(new SetBuildingRecipeCommand(target, target.recipeId));
        // merge 命中：stateVersion 不应再次变化
        expect(q.stateVersion.value).toBe(afterFirst);
        expect(q.stateVersion.value).toBe(before + 1);
    });

    test('merge does not combine edits to different buildings', () => {
        const data = load('same_buildings_v2.txt');
        const q = new CommandQueue(data);

        const targets = data.buildings.filter(b => b.recipeId > 0);
        if (targets.length < 2) return;
        const a = targets[0];
        const b = targets.find(x => x.recipeId !== a.recipeId)!;

        q.push(new SetBuildingRecipeCommand(a, b.recipeId));
        const afterFirst = q.stateVersion.value;
        q.push(new SetBuildingRecipeCommand(b, a.recipeId));
        // 不同建筑：不 merge，stateVersion 再次 bump
        expect(q.stateVersion.value).toBe(afterFirst + 1);
    });

    test('round-trip: changed recipeId survives toStr → fromStr', () => {
        const data = load('same_buildings_v2.txt');
        const target = data.buildings.find(b => b.recipeId > 0);
        if (!target) return;
        const other = data.buildings.find(b => b.recipeId > 0 && b.recipeId !== target.recipeId);
        if (!other) return;

        const idx = target.index;
        const newRecipeId = other.recipeId;

        // 直接改字段并回写
        target.recipeId = newRecipeId;
        const regenerated = toStr(data);
        const bp2 = fromStr(regenerated);
        expect(bp2.buildings.find(b => b.index === idx)!.recipeId).toBe(newRecipeId);
    });
});

describe('SetLabResearchModeCommand', () => {
    test('do/undo changes and restores researchMode; silent', () => {
        const data = load('starting_base_01029.txt');
        const lab = data.buildings.find(b => isLab(b.itemId) && b.parameters);
        if (!lab) return; // 跳过无研究站的 fixture

        const q = new CommandQueue(data);
        const sv0 = q.stateVersion.value;
        const ev0 = q.execVersion.value;

        const params = lab.parameters as { researchMode: ResearchMode };
        const oldMode = params.researchMode;
        const newMode = (oldMode + 1) % 3 as ResearchMode;

        q.push(new SetLabResearchModeCommand(lab, newMode));

        expect(q.stateVersion.value).toBeGreaterThan(sv0);
        expect(q.execVersion.value).toBe(ev0);
        expect(params.researchMode).toBe(newMode);

        q.undo();
        expect(params.researchMode).toBe(oldMode);
        expect(q.execVersion.value).toBe(ev0);
    });

    test('merge combines consecutive mode edits to the same lab', () => {
        const data = load('starting_base_01029.txt');
        const lab = data.buildings.find(b => isLab(b.itemId) && b.parameters);
        if (!lab) return;

        const q = new CommandQueue(data);
        const before = q.stateVersion.value;
        q.push(new SetLabResearchModeCommand(lab, ResearchMode.Compose));
        const afterFirst = q.stateVersion.value;
        q.push(new SetLabResearchModeCommand(lab, ResearchMode.Research));
        // merge 命中：stateVersion 不再 bump
        expect(q.stateVersion.value).toBe(afterFirst);
        expect(q.stateVersion.value).toBe(before + 1);

        // undo 应恢复到原始模式（merge 不影响 undo 正确性）
        q.undo();
        const params = lab.parameters as { researchMode: ResearchMode };
        expect(params.researchMode).not.toBe(ResearchMode.Research);
    });

    test('round-trip: changed researchMode survives toStr → fromStr', () => {
        const data = load('starting_base_01029.txt');
        const lab = data.buildings.find(b => isLab(b.itemId) && b.parameters);
        if (!lab) return;

        const idx = lab.index;
        const params = lab.parameters as { researchMode: ResearchMode };
        params.researchMode = ResearchMode.Compose;

        const regenerated = toStr(data);
        const bp2 = fromStr(regenerated);
        const lab2 = bp2.buildings.find(b => b.index === idx)!;
        expect((lab2.parameters as { researchMode: ResearchMode }).researchMode).toBe(ResearchMode.Compose);
    });
});
