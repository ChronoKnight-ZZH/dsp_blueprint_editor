/* eslint-disable @typescript-eslint/no-var-requires */
/// <reference types="node" />
/**
 * 对比两份已解析蓝图 JSON：按"网格坐标(round p0)"匹配建筑，
 * 输出每一条传送带 / 分拣器的字段差异。
 *
 * Usage: npx ts-node tests/tools/compareBp.ts <a.json> <b.json>
 */

const fs = require('fs');

const readJson = (f: string) => {
    let s: string = fs.readFileSync(f, 'utf8');
    if (s.charCodeAt(0) === 0xFEFF)
        s = s.slice(1);
    return JSON.parse(s);
};
const a = readJson(process.argv[2]);
const b = readJson(process.argv[3]);

const keyOf = (x: any) => `${Math.round(x.localOffset[0].x)},${Math.round(x.localOffset[0].y)}`;

function beltKey(x: any): string {
    // 分拣器按 p0->p1 匹配
    if (x.itemId >= 2011 && x.itemId <= 2014)
        return `S ${keyOf(x)} -> ${Math.round(x.localOffset[1].x)},${Math.round(x.localOffset[1].y)}`;
    return `B ${keyOf(x)}`;
}

const ma = new Map<any, any>(a.buildings.map((x: any) => [beltKey(x), x]));
const mb = new Map<any, any>(b.buildings.map((x: any) => [beltKey(x), x]));

const FIELDS: [string, (x: any) => any][] = [
    ['p0.x', (x: any) => x.localOffset[0].x],
    ['p0.y', (x: any) => x.localOffset[0].y],
    ['p1.x', (x: any) => x.localOffset[1].x],
    ['p1.y', (x: any) => x.localOffset[1].y],
    ['yaw0', (x: any) => x.yaw[0]],
    ['outObj', (x: any) => x.outputObjIdx],
    ['inObj', (x: any) => x.inputObjIdx],
    ['outToSlot', (x: any) => x.outputToSlot],
    ['inFromSlot', (x: any) => x.inputFromSlot],
    ['outOffset', (x: any) => x.outputOffset],
    ['inOffset', (x: any) => x.inputOffset],
    ['paramLen', (x: any) => (x.parameters ? x.parameters.length : null)],
];

for (const [k, xa] of ma) {
    const xb = mb.get(k);
    if (!xb) {
        console.log(`ONLY IN A: ${k}`);
        continue;
    }
    const diffs: string[] = [];
    for (const [name, fn] of FIELDS) {
        const va = fn(xa), vb = fn(xb);
        const eq = typeof va === 'number' && typeof vb === 'number'
            ? Math.abs(va - vb) < 1e-9
            : va === vb;
        if (!eq)
            diffs.push(`${name}: ${va} vs ${vb}`);
    }
    if (diffs.length)
        console.log(`${k}\n    ${diffs.join('\n    ')}`);
}
for (const k of mb.keys()) {
    if (!ma.has(k))
        console.log(`ONLY IN B: ${k}`);
}

export {};
