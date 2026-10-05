/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 对比两份蓝图中同类型对象的字段（分拣器/传送带/分流器等），逐字段列差异。
 *
 * 用法: npx ts-node tests/tools/compareBlueprints.ts <a.txt> <b.txt> [itemIdPrefix]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request.startsWith('@/'))
        request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));

const [fileA, fileB] = process.argv.slice(2);
const pa = fromStr(fs.readFileSync(fileA, 'utf8').trim());
const pb = fromStr(fs.readFileSync(fileB, 'utf8').trim());

const counts = (bp: { buildings: { itemId: number }[] }) => {
    const m = new Map<number, number>();
    for (const b of bp.buildings) m.set(b.itemId, (m.get(b.itemId) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(' ');
};
console.log(`${path.basename(fileA)}: ${pa.buildings.length} 个对象  ${counts(pa)}`);
console.log(`${path.basename(fileB)}: ${pb.buildings.length} 个对象  ${counts(pb)}`);

const fields = [
    'itemId', 'modelIndex', 'areaIndex', 'yaw', 'tilt', 'localOffset',
    'outputObjIdx', 'inputObjIdx', 'outputToSlot', 'inputFromSlot',
    'outputFromSlot', 'inputToSlot', 'outputOffset', 'inputOffset',
    'recipeId', 'filterId', 'parameters', 'v2ExtraPose', 'content', 'extraBytes',
];

for (const itemId of [2011, 2012, 2013, 2014, 2001, 2002, 2003, 2020, 2040, 2030]) {
    const la = pa.buildings.filter((b: { itemId: number }) => b.itemId === itemId);
    const lb = pb.buildings.filter((b: { itemId: number }) => b.itemId === itemId);
    if (la.length === 0 && lb.length === 0) continue;
    console.log(`\n===== itemId ${itemId}  A=${la.length} B=${lb.length} =====`);
    // 以 index 对齐打印
    const n = Math.max(la.length, lb.length);
    for (let i = 0; i < n && i < 40; i++) {
        const a = la[i], b = lb[i];
        for (const f of fields) {
            const va = a ? JSON.stringify(a[f]) : '(缺)';
            const vb = b ? JSON.stringify(b[f]) : '(缺)';
            if (va !== vb)
                console.log(`  #${i} ${f}:  A=${va}  B=${vb}`);
        }
    }
    if (n > 40) console.log(`  ... 共 ${n} 条`);
}

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
