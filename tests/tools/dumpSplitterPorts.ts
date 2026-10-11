/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 分流器诊断：逐个分流器打印
 * - parameters.priority / filterId（游戏里的设置）
 * - 工具 `splitterPortKinds` 判出的口角色
 * - 每个口相邻的传送带/分拣器及其 wire 字段（用于找出"明明接上了却判成未连接"的情况）
 *
 * 用法：
 *   npx ts-node tests/tools/dumpSplitterPorts.ts <bp.txt> [...]
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
const { splitterPortKinds } = require(path.join(srcDir, 'blueprint', 'splitterPorts'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { splitterPorts, splitterPortPos } = require(path.join(srcDir, 'data', 'splitter'));

const isBelt = (id: number) => id >= 2001 && id <= 2003;
const isIns = (id: number) => id >= 2011 && id <= 2014;

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    console.log(`=== ${path.basename(file)} buildings=${bs.length}`);
    for (const sp of bs) {
        if (sp.itemId !== 2020) continue;
        const p = sp.parameters;
        const prio = p ? p.priority.map((x: boolean) => (x ? 1 : 0)).join('') : '-';
        const kinds = splitterPortKinds(bs, sp.index);
        console.log(
            `分流器 #${sp.index} (${sp.localOffset[0].x},${sp.localOffset[0].y}) model=${sp.modelIndex}` +
            ` priority=${prio} filterId=${sp.filterId}` +
            ` 判出口=${[...kinds.entries()].map(([k, v]) => `${k}:${v}`).join(',') || '(无)'}`
        );
        // 该分流器各口附近（相邻一格内）的传送带/分拣器，打印其 wire 字段
        for (const { port } of splitterPorts(sp.modelIndex)) {
            const local = splitterPortPos(port);
            const rad = (sp.yaw[0] * Math.PI) / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const cx = sp.localOffset[0].x + local.x * cos - local.y * sin;
            const cy = sp.localOffset[0].y + local.x * sin + local.y * cos;
            const near = bs.filter((b: { itemId: number; localOffset: { x: number; y: number }[] }) =>
                (isBelt(b.itemId) || isIns(b.itemId)) &&
                Math.hypot(b.localOffset[0].x - cx, b.localOffset[0].y - cy) <= 1.2
            );
            const desc = near
                .map((b: { index: number; itemId: number; localOffset: { x: number; y: number }[]; outputObjIdx: number; outputToSlot: number; inputObjIdx: number; inputFromSlot: number; yaw: number[] }) =>
                    `#${b.index}(id${b.itemId}@${b.localOffset[0].x.toFixed(2)},${b.localOffset[0].y.toFixed(2)}` +
                    ` yaw=${b.yaw[0].toFixed(0)} out=${b.outputObjIdx}/${b.outputToSlot} in=${b.inputObjIdx}/${b.inputFromSlot})`
                )
                .join(' ');
            console.log(
                `    口${port} 位置(${cx.toFixed(2)},${cy.toFixed(2)}) 角色=${kinds.get(port) ?? '未连接'}` +
                ` 相邻: ${desc || '(无)'}`
            );
        }
    }
}

// 标记为模块
export {};
