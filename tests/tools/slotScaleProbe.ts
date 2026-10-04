/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 诊断：同一建筑（slot x 坐标）在不同蓝图/不同分区下的反推值差异，
 * 用于判断 localOffset 的横向（经度 x）是否存在分区相关的尺度差异。
 *
 * 用法: npx ts-node tests/tools/slotScaleProbe.ts <bp.txt> [...]
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
const { findPosForAreas } = require(path.join(srcDir, 'blueprint', 'planet'));

const isIns = (id: number) => id >= 2011 && id <= 2014;
const TARGET_ITEM = Number(process.argv[2]);
const files = process.argv.slice(3);

function toLocal(yaw: number, dx: number, dy: number): [number, number] {
    const rad = yaw * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

for (const file of files) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    let pos = null;
    try { pos = findPosForAreas(data.areas, 200); } catch { /* ignore */ }
    const rows: string[] = [];
    for (const s of bs) {
        if (!isIns(s.itemId)) continue;
        for (const [objIdx, slot, p] of [
            [s.inputObjIdx, s.inputFromSlot, s.localOffset[0]],
            [s.outputObjIdx, s.outputToSlot, s.localOffset[1]],
        ] as [number, number, { x: number, y: number }][]) {
            const obj = bs[objIdx];
            if (!obj || obj.itemId !== TARGET_ITEM || slot < 0) continue;
            const c = obj.localOffset[0];
            const [lx, ly] = toLocal(obj.yaw[0], p.x - c.x, p.y - c.y);
            const areaLat = pos ? pos.areas[obj.areaIndex].latitude : NaN;
            rows.push(`area=${obj.areaIndex} areaLat=${areaLat} localY=${c.y.toFixed(2)} absLat=${(areaLat + c.y).toFixed(2)} slot=${slot} -> local=(${lx.toFixed(4)}, ${ly.toFixed(4)}) #${s.index}`);
        }
    }
    console.log(`--- ${path.basename(file)}: areas=${JSON.stringify(data.areas.map((a: { index: number, size: { x: number, y: number } }) => ({ i: a.index, w: a.size.x, h: a.size.y })))}`);
    for (const r of rows.slice(0, 40))
        console.log('   ' + r);
    if (rows.length > 40)
        console.log(`   ... 共 ${rows.length} 条`);
}

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
