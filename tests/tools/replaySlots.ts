/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 用工具自身的 createSorterBetween 复现真实蓝图里"建筑端 slot"的选择，
 * 与游戏写死的 inputFromSlot / outputToSlot 逐条比对。
 *
 * 用途：验证角 slot 归属（例如电弧熔炉/储物仓的 slot 2 与 slot 3 坐标完全重合，
 * 靠"分拣器从哪个面离开"区分）——分组错误时会选成相邻面的 slot。
 *
 * 用法：
 *   npx ts-node tests/tools/replaySlots.ts <bp.txt> [...]
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hasSlots } = require(path.join(srcDir, 'data', 'buildingSlots'));

const isIns = (id: number) => id >= 2011 && id <= 2014;
let total = 0;
let ok = 0;
let skipped = 0;
let bad = 0;

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    for (const s of bs) {
        if (!isIns(s.itemId)) continue;
        for (const [bldIdx, slot, mine, theirs] of [
            [s.outputObjIdx, s.outputToSlot, s.localOffset[1], s.localOffset[0]],
            [s.inputObjIdx, s.inputFromSlot, s.localOffset[0], s.localOffset[1]],
        ] as [number, number, { x: number; y: number; z: number }, { x: number; y: number; z: number }][]) {
            const bld = bs[bldIdx];
            if (!bld || slot < 0 || !hasSlots(bld.itemId)) continue;
            // 另一端（皮带或建筑）
            const otherIdx = s.outputObjIdx === bldIdx ? s.inputObjIdx : s.outputObjIdx;
            const other = bs[otherIdx];
            if (!other) continue;
            const isSrc = s.inputObjIdx === bldIdx;
            const src = isSrc ? bld : other;
            const dst = isSrc ? other : bld;
            const anchors = isSrc
                ? { src: s.localOffset[0], dst: s.localOffset[1] }
                : { src: s.localOffset[0], dst: s.localOffset[1] };
            void mine;
            void theirs;
            total++;
            const made = createSorterBetween(src, dst, s.itemId, s.modelIndex, [src, dst], anchors);
            if (made === null) {
                skipped++;
                console.log(`  跳过 #${s.index} ${bld.itemId}#${bldIdx} slot${slot}: 工具判定不可放置`);
                continue;
            }
            const got = made.outputObjIdx === bldIdx ? made.outputToSlot : made.inputFromSlot;
            if (got === slot) ok++;
            else {
                bad++;
                console.log(
                    `  ✗ #${s.index} ${bld.itemId}#${bldIdx}: 游戏 slot ${slot}，工具 slot ${got}` +
                    ` (${path.basename(file)})`
                );
            }
        }
    }
}
console.log(`\nslot 复现：${ok}/${total} 一致，${bad} 不一致，${skipped} 跳过`);

// 标记为模块
export {};
