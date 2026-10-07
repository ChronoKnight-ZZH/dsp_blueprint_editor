/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 打印每个分拣器给某建筑某个 slot 贡献的**原始**样本（不做平均），
 * 用于分辨"同一 slot 多建筑平均后重合"与"两个 slot 真实重合"。
 *
 * 用法：
 *   npx ts-node tests/tools/dumpSlotSamples.ts <itemId> <bp.txt> [...]
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

const wantItem = parseInt(process.argv[2]);
const isIns = (id: number) => id >= 2011 && id <= 2014;

function toLocal(yaw: number, dx: number, dy: number): [number, number] {
    const rad = (yaw * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

interface Row {
    file: string; sorter: number; building: number; slot: number;
    x: number; y: number; yaw: number; cx: number; cy: number;
    ex: number; ey: number; z: number;
}
const rows: Row[] = [];
for (const file of process.argv.slice(3)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    for (const s of bs) {
        if (!isIns(s.itemId)) continue;
        for (const [objIdx, slot, p] of [
            [s.inputObjIdx, s.inputFromSlot, s.localOffset[0]],
            [s.outputObjIdx, s.outputToSlot, s.localOffset[1]],
        ] as [number, number, { x: number; y: number; z: number }][]) {
            const obj = bs[objIdx];
            if (!obj || slot < 0 || obj.itemId !== wantItem) continue;
            const c = obj.localOffset[0];
            const [lx, ly] = toLocal(obj.yaw[0], p.x - c.x, p.y - c.y);
            rows.push({
                file: path.basename(file), sorter: s.index, building: objIdx, slot,
                x: lx, y: ly, yaw: obj.yaw[0],
                cx: c.x, cy: c.y, ex: p.x, ey: p.y, z: p.z - c.z,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        }
    }
}

rows.sort((a, b) => a.slot - b.slot || a.file.localeCompare(b.file) || a.sorter - b.sorter);
let cur = -1;
for (const r of rows) {
    if (r.slot !== cur) {
        cur = r.slot;
        console.log(`--- slot ${cur} ---`);
    }
    console.log(
        `  (${r.x.toFixed(4)}, ${r.y.toFixed(4)}) dz=${r.z.toFixed(4)}` +
        `  bld#${r.building}@${r.file} yaw=${r.yaw.toFixed(1)} c=(${r.cx.toFixed(3)},${r.cy.toFixed(3)})` +
        ` end=(${r.ex.toFixed(4)},${r.ey.toFixed(4)}) sorter#${r.sorter}`
    );
}
console.log(`总计 ${rows.length} 个样本，itemId=${wantItem}`);

// 标记为模块
export {};
