/* eslint-disable @typescript-eslint/no-var-requires */
/// <reference types="node" />
/**
 * 验证修复思路：把蓝图中每根皮带的 yaw[0] 吸附到最近直角（皮带逻辑上永远沿主轴），
 * 再对每根 belt↔belt 分拣器重新 createSorterBetween，对比吸附前后 offset。
 *
 * Usage: npx ts-node tests/tools/verifySnapFix.ts <bp.txt>
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

const snapYaw = (y: number) => Math.round(((y % 360) + 360) % 360 / 90) * 90 % 360;

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    // 吸附所有皮带的逻辑 yaw
    for (const b of data.buildings) {
        if (b.itemId >= 2001 && b.itemId <= 2003)
            b.yaw[0] = snapYaw(b.yaw[0]);
    }
    const byIndex = new Map<any, any>(data.buildings.map((b: any) => [b.index, b]));
    console.log(`=== ${path.basename(file)}`);
    for (const s of data.buildings) {
        if (s.itemId < 2011 || s.itemId > 2014) continue;
        const src = byIndex.get(s.inputObjIdx), dst = byIndex.get(s.outputObjIdx);
        const others = data.buildings.filter((b: any) => b.index !== s.index);
        const rebuilt = createSorterBetween(src, dst, s.itemId, s.modelIndex, others, {});
        const after = rebuilt === null
            ? 'null'
            : `${rebuilt.inputOffset}/${rebuilt.outputOffset}`;
        console.log(
            `(${Math.round(src.localOffset[0].x)},${Math.round(src.localOffset[0].y)})->` +
            `(${Math.round(dst.localOffset[0].x)},${Math.round(dst.localOffset[0].y)})` +
            ` recorded ${s.inputOffset}/${s.outputOffset}` +
            ` -> after snap fix: ${after}`);
    }
}

export {};
