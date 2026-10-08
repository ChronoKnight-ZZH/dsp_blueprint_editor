/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 分析脚本需先注册 @/ 钩子再 require */
/**
 * 全样本扫描：物流站（2103 小塔 / 2104 大塔 / 2316 大型采矿机）的 storage 与 slots(kind/idx) 分布。
 *
 * 目的：标定"传送带出塔时选择物品"这一字段的取值范围——尤其是
 *  - storage 数组长度（parser 的 maxItemKind：2103=4、2104=5）
 *  - slots[].storageIdx 的最大值（大塔样本里出现过 6）
 *
 * 用法：npx ts-node tests/tools/scanStationSlots.ts <dir|file...>
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
const { itemsMap } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? `${it.name}(${id})` : `无(0)`;
};

const files: string[] = [];
for (const a of process.argv.slice(2)) {
    const st = fs.statSync(a);
    if (st.isDirectory())
        for (const f of fs.readdirSync(a))
            if (f.endsWith('.txt')) files.push(path.join(a, f));
    else files.push(a);
}

const idxMax = new Map<number, number>();
for (const file of files) {
    let data;
    try {
        data = fromStr(fs.readFileSync(file, 'utf8').trim());
    } catch {
        continue;
    }
    for (const b of data.buildings) {
        const p = b.parameters;
        if (!p || p.storage === undefined) continue;
        const used = p.slots.filter((s: any) => s.storageIdx > 0);
        const byKind = new Map<number, number>();
        p.slots.forEach((s: any) => {
            if (s.storageIdx <= 0) return;
            byKind.set(s.storageIdx, (byKind.get(s.storageIdx) || 0) + 1);
            idxMax.set(b.itemId, Math.max(idxMax.get(b.itemId) || 0, s.storageIdx));
        });
        console.log(
            `${path.basename(file)} #${b.index} item=${b.itemId} storage.len=${p.storage.length}` +
                ` items=[${p.storage.map((s: any) => name(s.itemId)).join(', ')}]` +
                ` 已设口数=${used.length}` +
                ` 口→物品序号=${[...byKind.entries()]
                    .map(([k, v]) => `${k}×${v}`)
                    .join(' ')}`
        );
    }
}
console.log(
    `\n各 itemId 的 storageIdx 最大值：${[...idxMax.entries()]
        .map(([k, v]) => `${k}→${v}`)
        .join(', ')}`
);

export {};
