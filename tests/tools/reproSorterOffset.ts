/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require */
/// <reference types="node" />
/**
 * 复现：对蓝图中每一根 belt↔belt 分拣器，用 createSorterBetween 按两端中心
 * 重新计算，并把结果 offset 与蓝图记录逐端对比；同时打印投影 main 原始值。
 *
 * Usage: npx ts-node tests/tools/reproSorterOffset.ts <bp.txt>
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSorterBetween } = require(path.join(srcDir, 'blueprint', 'sorter'));

const file = process.argv[2];
const data = fromStr(fs.readFileSync(file, 'utf8').trim());
const byIndex = new Map<any, any>(data.buildings.map((b: any) => [b.index, b]));

const beltDir = (b: any) => {
    const rad = b.yaw[0] * Math.PI / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
};
const mainOf = (belt: any, p: any) => {
    const c = belt.localOffset[0], d = beltDir(belt);
    return (p.x - c.x) * d.x + (p.y - c.y) * d.y;
};

for (const s of data.buildings) {
    if (s.itemId < 2011 || s.itemId > 2014) continue;
    const src = byIndex.get(s.inputObjIdx);
    const dst = byIndex.get(s.outputObjIdx);
    if (!src || !dst) continue;
    // 记录里两端点坐标
    const pSrc = s.localOffset[0];
    const pDst = s.localOffset[1];
    console.log(
        `sorter#${s.index} len=${(s.parameters as any)?.length}  ` +
        `src=#${src.index}@(${src.localOffset[0].x},${src.localOffset[0].y}) yaw=${src.yaw[0]}  ` +
        `dst=#${dst.index}@(${dst.localOffset[0].x},${dst.localOffset[0].y}) yaw=${dst.yaw[0]}`);
    console.log(
        `   recorded: srcOffset=${s.inputOffset} dstOffset=${s.outputOffset}` +
        `   raw main: src=${mainOf(src, pSrc).toFixed(6)} dst=${mainOf(dst, pDst).toFixed(6)}`);
    // 无锚点重算（两端中心）；排除自身，否则重复端点检测会返回 null
    const others = data.buildings.filter((b: any) => b.index !== s.index);
    const rebuilt = createSorterBetween(
        src, dst, s.itemId, s.modelIndex, others, {});
    if (rebuilt === null) {
        console.log('   rebuilt: null');
    } else {
        console.log(
            `   rebuilt : srcOffset=${rebuilt.inputOffset} dstOffset=${rebuilt.outputOffset}` +
            `   raw main: src=${mainOf(src, rebuilt.localOffset[0]).toFixed(6)}` +
            ` dst=${mainOf(dst, rebuilt.localOffset[1]).toFixed(6)}`);
    }
}

export {};
