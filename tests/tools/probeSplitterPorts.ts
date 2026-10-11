/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 探针脚本需先注册 @/ 钩子再 require */
/**
 * 分流器口角色探针：对每台四向分流器打印 4 个口的连接角色（in/out/未连接）、
 * 优先位与筛选物品，用于核对 `splitterPorts.ts` 的判定与游戏蓝图是否一致。
 *
 * 用法：npx ts-node tests/tools/probeSplitterPorts.ts <bp.txt> [...]
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
const {
    splitterPortKinds,
} = require(path.join(srcDir, 'blueprint', 'splitterPorts'));
const { itemsMap, isSplitter } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? it.name : '无';
};

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    console.log(`\n########## ${path.basename(file)}`);
    for (const b of data.buildings) {
        if (!isSplitter(b.itemId)) continue;
        const kinds = splitterPortKinds(data.buildings, b.index);
        const p = b.parameters;
        console.log(
            `#${b.index} ${name(b.itemId)} @(${b.localOffset[0].x.toFixed(1)},${b.localOffset[0].y.toFixed(1)})` +
                ` model=${b.modelIndex}` +
                ` 口=${[0, 1, 2, 3]
                    .map((port) => {
                        const kind = kinds.get(port) ?? null;
                        const prio = p && p.priority[port] ? '优先' : '';
                        return `${port}:${kind ?? '未连接'}${prio ? '/' + prio : ''}`;
                    })
                    .join(' ')}` +
                ` filter=${b.filterId > 0 ? name(b.filterId) + '(' + b.filterId + ')' : '无'}` +
                ` extra=${JSON.stringify(p ? p.extra : null)}`
        );
    }
}

export {};
