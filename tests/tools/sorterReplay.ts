/// <reference types="node" />
/**
 * Replay a real blueprint through createSorterBetween and report field-level diffs.
 * Anchors are derived from the game's own endpoint cells (as the UI derives them from
 * the player's click), so the whole connection record must be reproducible.
 *
 * Usage: npx ts-node tests/tools/sorterReplay.ts <bp.txt>
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

const isIns = (id: number) => id >= 2011 && id <= 2014;

const file = process.argv[2];
const data = fromStr(fs.readFileSync(file, 'utf8').trim());
const bs = data.buildings;
const sorters = bs.filter((b: { itemId: number }) => isIns(b.itemId));
console.log(`${path.basename(file)}: buildings=${bs.length} sorters=${sorters.length}`);

let nPass = 0, nFail = 0;
for (const s of sorters) {
    const src = bs[s.inputObjIdx];
    const dst = bs[s.outputObjIdx];
    const before = bs.filter((b: { index: number }) => b.index !== s.index);
    const cell = (p: { x: number, y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    const replay = createSorterBetween(src, dst, s.itemId, s.modelIndex, before, {
        src: cell(s.localOffset[0]),
        dst: cell(s.localOffset[1]),
    });
    const diffs: string[] = [];
    if (!replay) {
        diffs.push('null');
    } else {
        const cmp = (name: string, a: number, b: number, tol: number) => {
            if (Math.abs(a - b) > tol) diffs.push(`${name} ${a.toFixed(3)} != ${b.toFixed(3)}`);
        };
        /** 角度差（处理 359.8 ≈ -0.2 的环绕） */
        const cmpAngle = (name: string, a: number, b: number, tol: number) => {
            const d = ((a - b + 540) % 360) - 180;
            if (Math.abs(d) > tol) diffs.push(`${name} ${a.toFixed(3)} != ${b.toFixed(3)}`);
        };
        cmp('len', (replay.parameters || {}).length, (s.parameters || {}).length, 0);
        cmp('inputFromSlot', replay.inputFromSlot, s.inputFromSlot, 0);
        cmp('outputToSlot', replay.outputToSlot, s.outputToSlot, 0);
        cmp('inputToSlot', replay.inputToSlot, s.inputToSlot, 0);
        cmp('outputFromSlot', replay.outputFromSlot, s.outputFromSlot, 0);
        cmp('inputOffset', replay.inputOffset, s.inputOffset, 1);
        cmp('outputOffset', replay.outputOffset, s.outputOffset, 1);
        cmp('p0.x', replay.localOffset[0].x, s.localOffset[0].x, 0.005);
        cmp('p0.y', replay.localOffset[0].y, s.localOffset[0].y, 0.005);
        cmp('p1.x', replay.localOffset[1].x, s.localOffset[1].x, 0.005);
        cmp('p1.y', replay.localOffset[1].y, s.localOffset[1].y, 0.005);
        cmpAngle('yaw0', replay.yaw[0], s.yaw[0], 0.5);
        cmpAngle('yaw1', replay.yaw[1], s.yaw[1], 0.5);
        cmpAngle('tilt', replay.tilt, s.tilt, 0.5);
        if (s.v2ExtraPose && replay.v2ExtraPose)
            cmpAngle('pose0', replay.v2ExtraPose[0], s.v2ExtraPose[0], 0.1);
    }
    if (diffs.length === 0) { nPass++; continue; }
    nFail++;
    console.log(`#${s.index} FAIL: ${diffs.join('; ')}`);
    console.log(`    game  : p0=(${s.localOffset[0].x.toFixed(3)},${s.localOffset[0].y.toFixed(3)}) p1=(${s.localOffset[1].x.toFixed(3)},${s.localOffset[1].y.toFixed(3)}) yaw=${s.yaw[0].toFixed(2)}/${s.yaw[1].toFixed(2)} slotIn=${s.inputFromSlot} slotOut=${s.outputToSlot} offIn=${s.inputOffset} offOut=${s.outputOffset} len=${(s.parameters || {}).length} pose0=${(s.v2ExtraPose || [])[0]}`);
    if (replay)
        console.log(`    replay: p0=(${replay.localOffset[0].x.toFixed(3)},${replay.localOffset[0].y.toFixed(3)}) p1=(${replay.localOffset[1].x.toFixed(3)},${replay.localOffset[1].y.toFixed(3)}) yaw=${replay.yaw[0].toFixed(2)}/${replay.yaw[1].toFixed(2)} slotIn=${replay.inputFromSlot} slotOut=${replay.outputToSlot} offIn=${replay.inputOffset} offOut=${replay.outputOffset} len=${(replay.parameters || {}).length} pose0=${(replay.v2ExtraPose || [])[0]}`);
    console.log(`    src #${s.inputObjIdx} id=${src.itemId} @(${src.localOffset[0].x.toFixed(3)},${src.localOffset[0].y.toFixed(3)}) yaw=${src.yaw[0].toFixed(2)}`);
    console.log(`    dst #${s.outputObjIdx} id=${dst.itemId} @(${dst.localOffset[0].x.toFixed(3)},${dst.localOffset[0].y.toFixed(3)}) yaw=${dst.yaw[0].toFixed(2)}`);
}
console.log(`pass=${nPass} fail=${nFail}`);

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
