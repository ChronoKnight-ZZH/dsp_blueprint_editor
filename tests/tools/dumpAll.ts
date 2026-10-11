/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 分析脚本需先注册 @/ 钩子再 require */
/**
 * 通用逐建筑转储：位置/yaw/连接字段/参数（分流器 priority+filterId、站点 storage/slots）。
 *
 * 用法：npx ts-node tests/tools/dumpAll.ts <bp.txt> [...]
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request.startsWith('@/')) request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

const { fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));
const { itemsMap, isBelt, isSplitter } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? `${it.name}` : `${id}`;
};

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    console.log(`\n########## ${path.basename(file)} buildings=${data.buildings.length}`);
    for (const b of data.buildings) {
        const p = b.localOffset[0];
        console.log(
            `#${String(b.index).padStart(3)} ${name(b.itemId)}(id=${b.itemId} m=${b.modelIndex})` +
                ` @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(3)}) yaw=${b.yaw[0].toFixed(1)}` +
                ` out=${b.outputObjIdx}/${b.outputToSlot}/${b.outputFromSlot}/${b.outputOffset}` +
                ` in=${b.inputObjIdx}/${b.inputFromSlot}/${b.inputToSlot}/${b.inputOffset}` +
                ` recipe=${b.recipeId} filter=${b.filterId}`
        );
        if (isSplitter(b.itemId) && b.parameters)
            console.log(
                `      [分流器] priority=${JSON.stringify(b.parameters.priority)}` +
                    ` extra=${JSON.stringify(b.parameters.extra)}`
            );
        if (!isBelt(b.itemId) && b.parameters && b.parameters.storage)
            console.log(
                `      [站点] workEnergy=${b.parameters.workEnergyPerTick}` +
                    ` slots=${b.parameters.slots
                        .map((s: any, i: number) =>
                            s.dir || s.storageIdx
                                ? `${i}:${s.dir}/${s.storageIdx}`
                                : null
                        )
                        .filter(Boolean)
                        .join(' ')}`
            );
    }
}

export {};
