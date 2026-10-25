import { iconModelAliases, modelNameCandidates, resolveModelName } from '@/models/glbAssets';
import { itemsMap } from '@/data/items';

/**
 * 只测“解析表”这一层（纯函数），不涉及 webpack 的 require.context 与 three 的 GLTFLoader：
 * - 别名 / LOD 回退 / 变形模式的候选顺序
 * - jest 里没有 require.context 时必须优雅降级（返回 null，由上层回退元数据表）
 */
describe('GLB 模型解析表', () => {
    test('无别名时直接用图标名作为文件名', () => {
        expect(modelNameCandidates('smelter')).toEqual(['smelter']);
        expect(modelNameCandidates('mining-drill')).toEqual(['mining-drill']);
        expect(modelNameCandidates('mining-drill-mk2')).toEqual(['mining-drill-mk2']);
    });

    test('制造台 Mk.I：文件名与 icon 同名，缺失时回退汇编命名 assembler', () => {
        expect(modelNameCandidates('assembler-1')).toEqual(['assembler-1', 'assembler']);
    });

    test('共用模型：蓄电器（满）复用 accumulator', () => {
        expect(modelNameCandidates('accumulator-full')).toEqual(['accumulator']);
    });

    test('四向分流器：三种变形按 Item.models 下标取 splitter-1/2/3', () => {
        expect(modelNameCandidates('splitter-4dir', 0)).toEqual(['splitter-1']);
        expect(modelNameCandidates('splitter-4dir', 1)).toEqual(['splitter-2']);
        expect(modelNameCandidates('splitter-4dir', 2)).toEqual(['splitter-3']);
        // 下标越界时钳制到最后一个变形，避免 undefined
        expect(modelNameCandidates('splitter-4dir', 9)).toEqual(['splitter-3']);
    });

    test('分流器的三种变形与 itemsData 的 models 顺序一一对应', () => {
        const splitter = itemsMap.get(2020);
        expect(splitter).toBeDefined();
        expect(splitter!.models).toEqual([38, 39, 40]);
        expect(splitter!.models.map((_m, i) => modelNameCandidates(splitter!.icon, i)[0]))
            .toEqual(['splitter-1', 'splitter-2', 'splitter-3']);
    });

    test('别名表结构自检：每条都给了说明，variants 与 primary 不冲突', () => {
        for (const [icon, alias] of Object.entries(iconModelAliases)) {
            expect(icon.length).toBeGreaterThan(0);
            expect(alias.primary.length).toBeGreaterThan(0);
            expect(alias.note.length).toBeGreaterThan(0);
            for (const f of alias.fallbacks ?? [])
                expect(f).not.toBe(alias.primary);
            for (const v of alias.variants ?? [])
                expect(v.length).toBeGreaterThan(0);
        }
    });

    test('jest 环境没有 require.context：全部解析为 null（静默回退，不抛错）', () => {
        expect(resolveModelName('smelter')).toBeNull();
        expect(resolveModelName('splitter-4dir', 0)).toBeNull();
    });
});
