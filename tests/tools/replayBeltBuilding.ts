/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 复现脚本需先注册 @/ 钩子再 require */
/**
 * 复现"建筑 ↔ 传送带"连接：把样本里每条接在建筑口上的带线，用编辑器自己的
 * `buildBeltLine` 从端点重建，逐格比对格身份与连接字段。
 *
 * 用法：npx ts-node tests/tools/replayBeltBuilding.ts <bp.txt> [...]
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
const { buildBeltLine } = require(path.join(srcDir, 'blueprint', 'beltLine'));
const { findPosForAreas } = require(path.join(srcDir, 'blueprint', 'planet'));
const { beltPortAt, portWorldNormal, portWorldOffset } = require(path.join(
    srcDir,
    'data',
    'beltPorts'
));
const { itemsMap, isBelt } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? it.name : String(id);
};
const SEGMENT = 200;
const wrap = (x: number) => ((x % 1000) + 1000) % 1000;
const cellOf = (p: { x: number; y: number }) =>
    `${wrap(Math.round(p.x))},${Math.round(p.y)}`;

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const pos = findPosForAreas(data.areas, SEGMENT);
    const byIndex = new Map<number, any>(
        data.buildings.map((b: any) => [b.index, b])
    );
    console.log(`\n########## ${path.basename(file)}`);
    for (const b of data.buildings) {
        if (isBelt(b.itemId)) continue;
        const portOf = (slot: number) => beltPortAt(b.itemId, b.modelIndex, slot);
        const portEnd = (slot: number) => {
            const port = portOf(slot);
            if (!port) return null;
            const area = pos.areas[b.areaIndex];
            const lat =
                (area.latitude + b.localOffset[0].y) *
                ((2 * Math.PI) / (SEGMENT * 5));
            const cosLat = Math.cos(lat);
            const off = portWorldOffset(port, b.yaw[0], cosLat);
            const n = portWorldNormal(port, b.yaw[0]);
            return {
                building: b,
                slot,
                point: {
                    x: b.localOffset[0].x + off.x,
                    y: b.localOffset[0].y + off.y,
                    z: off.z,
                },
                nx: n.x,
                ny: n.y,
            };
        };
        for (const o of data.buildings) {
            if (!isBelt(o.itemId)) continue;
            // 取出：带从建筑口取出
            if (o.inputObjIdx === b.index) {
                const cells = [o];
                let cur = o;
                while (cur.outputObjIdx >= 0) {
                    const nxt = byIndex.get(cur.outputObjIdx);
                    if (!nxt || !isBelt(nxt.itemId)) break;
                    cells.push(nxt);
                    cur = nxt;
                }
                const start = portEnd(o.inputFromSlot);
                if (!start) {
                    console.log(
                        `#${b.index} ${name(b.itemId)} slot=${o.inputFromSlot} 口表缺失！`
                    );
                    continue;
                }
                const rebuilt = buildBeltLine(
                    o.itemId,
                    o.modelIndex,
                    { x: Math.round(start.point.x), y: Math.round(start.point.y) },
                    cells[cells.length - 1].localOffset[0],
                    0,
                    'latFirst',
                    start,
                    null
                );
                const same =
                    rebuilt.length === cells.length &&
                    rebuilt.every(
                        (r: any, i: number) =>
                            cellOf(r.localOffset[0]) === cellOf(cells[i].localOffset[0])
                    );
                console.log(
                    `#${b.index} ${name(b.itemId)} 取出 slot=${o.inputFromSlot}: ` +
                        `样本 ${cells.length} 格 [${cells.map((c: any) => cellOf(c.localOffset[0])).join(' ')}]` +
                        ` / 重建 ${rebuilt.length} 格 [${rebuilt.map((r: any) => cellOf(r.localOffset[0])).join(' ')}]` +
                        `  ${same ? '✔' : '✘ 不一致'}`
                );
            }
            // 送入：带送进建筑口
            if (o.outputObjIdx === b.index) {
                const cells = [o];
                let cur = o;
                for (;;) {
                    const pred = data.buildings.find(
                        (x: any) => isBelt(x.itemId) && x.outputObjIdx === cur.index
                    );
                    if (!pred) break;
                    cells.unshift(pred);
                    cur = pred;
                }
                const end = portEnd(o.outputToSlot);
                if (!end) {
                    console.log(
                        `#${b.index} ${name(b.itemId)} slot=${o.outputToSlot} 口表缺失！`
                    );
                    continue;
                }
                const rebuilt = buildBeltLine(
                    o.itemId,
                    o.modelIndex,
                    cells[0].localOffset[0],
                    { x: Math.round(end.point.x), y: Math.round(end.point.y) },
                    0,
                    'latFirst',
                    null,
                    end
                );
                const same =
                    rebuilt.length === cells.length &&
                    rebuilt.every(
                        (r: any, i: number) =>
                            cellOf(r.localOffset[0]) === cellOf(cells[i].localOffset[0])
                    );
                console.log(
                    `#${b.index} ${name(b.itemId)} 送入 slot=${o.outputToSlot}: ` +
                        `样本 ${cells.length} 格 [${cells.map((c: any) => cellOf(c.localOffset[0])).join(' ')}]` +
                        ` / 重建 ${rebuilt.length} 格 [${rebuilt.map((r: any) => cellOf(r.localOffset[0])).join(' ')}]` +
                        `  ${same ? '✔' : '✘ 不一致'}`
                );
            }
        }
    }
}

export {};
