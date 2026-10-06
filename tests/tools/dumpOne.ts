/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 打印指定下标对象的完整字段（含 v2ExtraPose / parameters / extraBytes），
 * 用于逐字段比对游戏生成与工具生成的分拣器/传送带记录。
 *
 * 用法: npx ts-node tests/tools/dumpOne.ts <bp.txt> <idx> [idx...]
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

const file = process.argv[2];
const data = fromStr(fs.readFileSync(file, 'utf8').trim());
const bs = data.buildings;
console.log(`--- ${path.basename(file)} (${bs.length} 个对象) ---`);
for (const arg of process.argv.slice(3)) {
    const i = Number(arg);
    const b = bs[i];
    if (!b) { console.log(`#${i} 不存在`); continue; }
    const f = (v: any) => JSON.stringify(v);
    console.log(`#${i} item=${b.itemId} model=${b.modelIndex} area=${b.areaIndex}`);
    console.log(`    p0=${f(b.localOffset[0])} p1=${f(b.localOffset[1])}`);
    console.log(`    yaw=${f(b.yaw)} tilt=${b.tilt}`);
    console.log(`    out=${b.outputObjIdx} outToSlot=${b.outputToSlot} outFromSlot=${b.outputFromSlot} outOffset=${b.outputOffset}`);
    console.log(`    in=${b.inputObjIdx} inFromSlot=${b.inputFromSlot} inToSlot=${b.inputToSlot} inOffset=${b.inputOffset}`);
    console.log(`    recipe=${b.recipeId} filter=${b.filterId} parameters=${f(b.parameters)}`);
    console.log(`    v2ExtraPose=${f(b.v2ExtraPose)}`);
    console.log(`    content=${f(b.content)} extraBytes=${b.extraBytes ? b.extraBytes.length + ' 字节' : 'undefined'}`);
}

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
