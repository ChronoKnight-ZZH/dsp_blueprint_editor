/**
 * 校验外部 GLB 模型与元数据表的映射关系（不依赖 webpack）。
 *
 * 用法：npx ts-node -O '{"module":"commonjs"}' scripts/verify-glb-mapping.ts
 *
 * 为什么不用运行时的 buildingModel：那个模块依赖 require.context，
 * 在 Node 里恒为空集。这里用同一张别名表（modelNameCandidates，纯函数）
 * 去和磁盘目录比对，因此能独立复核“谁匹配上、谁回退”。
 */
/// <reference types="node" />
import { readdirSync } from 'fs';
import { join } from 'path';
import { buildingMeta } from '../src/data/building';
import { items } from '../src/data/itemsData';
import { modelNameCandidates } from '../src/models/glbAssets';

const modelDir = join(__dirname, '..', 'src', 'assets', 'icons', 'models');

const files = new Set(
    readdirSync(modelDir)
        .filter(f => /\.glb$/i.test(f))
        .map(f => f.replace(/\.glb$/i, '')),
);

interface Ref { itemId: number; itemName: string; icon: string; variantIndex: number; }

const byModel = new Map<number, Ref[]>();
for (const item of items) {
    for (let v = 0; v < item.models.length; v++) {
        const m = item.models[v];
        const ref: Ref = { itemId: item.id, itemName: item.name, icon: item.icon, variantIndex: v };
        const list = byModel.get(m);
        if (list === undefined) byModel.set(m, [ref]); else list.push(ref);
    }
}

function pick(modelIndex: number): { file: string | null; ref: Ref | null; candidates: string[] } {
    const refs = byModel.get(modelIndex) ?? [];
    for (const ref of refs) {
        const candidates = modelNameCandidates(ref.icon, ref.variantIndex);
        for (const c of candidates)
            if (files.has(c))
                return { file: c, ref, candidates };
    }
    const first = refs[0] ?? null;
    return {
        file: null,
        ref: first,
        candidates: first === null ? [] : modelNameCandidates(first.icon, first.variantIndex),
    };
}

const used = new Set<string>();
const ok: string[] = [];
const missing: string[] = [];

for (const modelIndex of Array.from(buildingMeta.keys()).sort((a, b) => a - b)) {
    const { file, ref } = pick(modelIndex);
    if (file !== null) {
        used.add(file);
        if (ref !== null)
            for (const c of modelNameCandidates(ref.icon, ref.variantIndex))
                if (files.has(c)) used.add(c);
        ok.push(`  ${String(modelIndex).padStart(3)} ${(ref?.itemName ?? '?').padEnd(14)} ${ref?.icon ?? '?'} -> ${file}.glb`);
    } else {
        missing.push(`  ${String(modelIndex).padStart(3)} ${(ref?.itemName ?? '?').padEnd(14)} ${ref?.icon ?? '?'} -> (期望 ${(modelNameCandidates(ref?.icon ?? '', 0)).join(' | ') || '无'})`);
    }
}

const unused = Array.from(files).filter(f => !used.has(f)).sort();
const orphans = Array.from(byModel.keys()).filter(m => !buildingMeta.has(m)).sort();

console.log(`建筑元数据条目: ${buildingMeta.size}`);
console.log(`磁盘 GLB 文件: ${files.size}`);
console.log(`\n== 已匹配 ${ok.length} ==`);
console.log(ok.join('\n'));
console.log(`\n== 未匹配（回退元数据表）${missing.length} ==`);
console.log(missing.join('\n') || '  (无)');
console.log(`\n== 目录里有、但没被任何建筑使用 ${unused.length} ==`);
console.log(unused.map(f => `  ${f}.glb`).join('\n') || '  (无)');
console.log(`\n== 有模型号但元数据表缺失 ${orphans.length} ==`);
console.log(orphans.map(m => `  modelIndex ${m} <- ${(byModel.get(m) ?? []).map(r => r.itemName).join('/')}`).join('\n') || '  (无)');
