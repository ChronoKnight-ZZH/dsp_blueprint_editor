/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * Fit the belt-attachment offset model: offset = floor(main / (1/N)) for integer N.
 * Reports, per belt itemId, the N values that reproduce every real-blueprint sample.
 *
 * Usage: npx ts-node tests/tools/fitBeltOffset.ts <bp.txt> [...]
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

const isIns = (id: number) => id >= 2011 && id <= 2014;
const isBeltId = (id: number) => id >= 2001 && id <= 2003;

function dirFromYaw(yaw: number) {
    const rad = yaw * Math.PI / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
}

interface Row { beltId: number, offset: number, main: number, file: string, idx: number, end: string }
const rows: Row[] = [];

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    for (const s of bs) {
        if (!isIns(s.itemId)) continue;
        for (const [end, objIdx, offset, p] of [
            ['in', s.inputObjIdx, s.inputOffset, s.localOffset[0]],
            ['out', s.outputObjIdx, s.outputOffset, s.localOffset[1]],
        ] as [string, number, number, { x: number, y: number }][]) {
            const obj = bs[objIdx];
            if (!obj || !isBeltId(obj.itemId)) continue;
            const c = obj.localOffset[0];
            const d = dirFromYaw(obj.yaw[0]);
            const relX = p.x - c.x, relY = p.y - c.y;
            rows.push({
                beltId: obj.itemId,
                offset,
                main: relX * d.x + relY * d.y,
                file: path.basename(file), idx: s.index, end,
            });
        }
    }
}

const byBelt = new Map<number, Row[]>();
for (const r of rows) {
    if (!byBelt.has(r.beltId)) byBelt.set(r.beltId, []);
    byBelt.get(r.beltId)!.push(r);
}

for (const [beltId, rs] of byBelt) {
    const good: number[] = [];
    for (let n = 1; n <= 200; n++) {
        if (rs.every(r => Math.floor(r.main * n) === r.offset))
            good.push(n);
    }
    console.log(`belt itemId ${beltId}: ${rs.length} samples; N values that fit floor(main*N)===offset: ${good.join(', ') || '(none)'}`);
    // show near-miss diagnostics for the best candidate
    if (good.length === 0) {
        for (const r of rs.slice(0, 40))
            console.log(`    main=${r.main.toFixed(4)} offset=${r.offset} -> N=21 gives ${Math.floor(r.main * 21)}  ${r.file} #${r.idx} ${r.end}`);
    }
}
console.log(`total samples ${rows.length}`);

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
