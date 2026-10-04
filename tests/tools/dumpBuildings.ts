/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * Compact building dump for a blueprint file: one line per building with the fields
 * needed to reason about sorter/belt geometry.
 *
 * Usage: npx ts-node tests/tools/dumpBuildings.ts <bp.txt> [...]
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

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    console.log(`=== ${path.basename(file)} buildings=${data.buildings.length} areas=${JSON.stringify(data.areas)}`);
    for (const b of data.buildings) {
        const p0 = b.localOffset[0], p1 = b.localOffset[1];
        const len = b.parameters && b.parameters.length !== undefined ? b.parameters.length : '';
        console.log(
            `#${String(b.index).padStart(3)} id=${b.itemId} m=${String(b.modelIndex).padStart(3)}` +
            ` p0=(${p0.x.toFixed(3)},${p0.y.toFixed(3)},${p0.z.toFixed(3)})` +
            ` p1=(${p1.x.toFixed(3)},${p1.y.toFixed(3)},${p1.z.toFixed(3)})` +
            ` yaw=(${b.yaw[0].toFixed(3)},${b.yaw[1].toFixed(3)}) tilt=${b.tilt.toFixed(3)}` +
            ` out=${b.outputObjIdx}/${b.outputToSlot}/${b.outputFromSlot}/${b.outputOffset}` +
            ` in=${b.inputObjIdx}/${b.inputFromSlot}/${b.inputToSlot}/${b.inputOffset}` +
            ` len=${len}`);
    }
}

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
