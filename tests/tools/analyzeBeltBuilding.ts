/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 分析脚本需先注册 @/ 钩子再 require */
/**
 * 建筑 ↔ 传送带交互分析：把一份蓝图里"非传送带建筑"与所有传送带的连接关系逐条列出来。
 *
 * 用法：
 *   npx ts-node tests/tools/analyzeBeltBuilding.ts <bp.txt> [--cells]
 *
 * 判据（游戏字段）：
 * - 传送带 `newIndex` 指向建筑（`outputObjIdx == building.index`）→ 该带**送入**建筑，建筑是终点；
 *   `outputToSlot` = 建筑上的接入口 slot，`outputOffset` = 带端在带方向上的偏移。
 * - 建筑 → 传送带（`inputObjIdx == building.index`）→ 该带**取出**建筑产物；
 *   `inputFromSlot` = 建筑上的取出口 slot。
 * - 建筑与带同格且两边都没有连接字段（out/in 均 -1）→ 建筑**骑在带上**（并联，带穿过建筑）。
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
const { itemsMap, isBelt, isStation } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? `${it.id}:${it.name}` : `${id}:(unknown)`;
};
const yawOf = (y: number[]) => (((y[0] % 360) + 360) % 360).toFixed(1);

for (const file of process.argv.slice(2).filter((a) => a.endsWith('.txt'))) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const buildings = data.buildings;
    console.log(
        `\n########## ${path.basename(file)}  buildings=${buildings.length}`
    );

    // 传送带的上下游索引
    const beltByCell = new Map<string, number[]>();
    buildings.forEach((b: any) => {
        if (!isBelt(b.itemId)) return;
        const k = `${b.localOffset[0].x.toFixed(0)},${b.localOffset[0].y.toFixed(0)}`;
        if (!beltByCell.has(k)) beltByCell.set(k, []);
        beltByCell.get(k)!.push(b.index);
    });

    for (const b of buildings) {
        if (isBelt(b.itemId)) continue;
        const pos = b.localOffset[0];
        const cell = `${pos.x.toFixed(0)},${pos.y.toFixed(0)}`;
        const fedBy = buildings.filter(
            (o: any) => isBelt(o.itemId) && o.outputObjIdx === b.index
        );
        const feeds = buildings.filter(
            (o: any) => isBelt(o.itemId) && o.inputObjIdx === b.index
        );
        const sameCell = (beltByCell.get(cell) || []).filter(
            (i: number) => i !== b.index
        );
        console.log(
            `#${String(b.index).padStart(3)} ${name(b.itemId)} m=${b.modelIndex}` +
                ` p=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(3)}) yaw=${yawOf(b.yaw)}` +
                ` out=${b.outputObjIdx}/${b.outputToSlot}/${b.outputFromSlot}/${b.outputOffset}` +
                ` in=${b.inputObjIdx}/${b.inputFromSlot}/${b.inputToSlot}/${b.inputOffset}`
        );
        for (const o of fedBy)
            console.log(
                `      ← 带#${o.index} 送入 建筑slot=${o.outputToSlot} (带offset=${o.outputOffset})` +
                    ` 带@(${o.localOffset[0].x.toFixed(2)},${o.localOffset[0].y.toFixed(2)})` +
                    ` 带yaw=${yawOf(o.yaw)} 带out=${o.outputObjIdx}/${o.outputToSlot}`
            );
        for (const o of feeds)
            console.log(
                `      → 带#${o.index} 取出 建筑slot=${o.inputFromSlot} (带offset=${o.inputOffset})` +
                    ` 带@(${o.localOffset[0].x.toFixed(2)},${o.localOffset[0].y.toFixed(2)})` +
                    ` 带yaw=${yawOf(o.yaw)} 带in=${o.inputObjIdx}/${o.inputFromSlot}/${o.inputToSlot}`
            );
        if (fedBy.length === 0 && feeds.length === 0 && sameCell.length > 0)
            console.log(
                `      ~ 无连接字段，但与同格传送带 ${sameCell
                    .map((i: number) => '#' + i)
                    .join(',')} 共格 → 骑在带上（并联）`
            );
        if (isStation(b.itemId) && b.parameters && b.parameters.storage) {
            const p = b.parameters;
            console.log(
                `      [站点] storage=${p.storage.length} slots=${p.slots.length}` +
                    ` workEnergy=${p.workEnergyPerTick} pilerCount=${p.pilerCount}`
            );
            p.storage.forEach((s: any, i: number) =>
                console.log(
                    `        storage[${i}] item=${name(s.itemId)} max=${s.max}` +
                        ` local=${s.localLogic} remote=${s.remoteLogic} keep=${s.keepMode}`
                )
            );
            p.slots.forEach((s: any, i: number) =>
                console.log(
                    `        slots[${i}] dir=${s.dir} storageIdx=${s.storageIdx}`
                )
            );
        }
    }
}

export {};
