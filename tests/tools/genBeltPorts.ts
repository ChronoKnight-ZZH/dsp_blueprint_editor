/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 分析脚本需先注册 @/ 钩子再 require */
/**
 * 生成"建筑 → 传送带口"标定表：扫描所有样本里 `带.outputObjIdx/inputFromSlot = 建筑index` 的连接，
 * 把带端位置换算到建筑局部系（`slot_local = R_Z(+yaw)·(端点 − 中心)`，与 sorter/deriveSlots 同约定）、
 * 经向按纬度归一（x_eq = x·cos(lat)）、并从连接方向反推口的**朝外法线**，最后打印可直接粘进
 * `src/data/beltPorts.ts` 的表体。
 *
 * 用法：npx ts-node tests/tools/genBeltPorts.ts [目录或文件...]（默认扫 tests 下所有 .txt）
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
const { findPosForAreas } = require(path.join(srcDir, 'blueprint', 'planet'));
const { itemsMap, isBelt } = require(path.join(srcDir, 'data', 'items'));

const name = (id: number) => {
    const it = itemsMap.get(id);
    return it ? `${it.name}` : `${id}`;
};
const rad = (d: number) => (d * Math.PI) / 180;
const SEGMENT = 200;

const files: string[] = [];
const collect = (p: string) => {
    const st = fs.statSync(p);
    if (st.isDirectory())
        for (const f of fs.readdirSync(p)) {
            const q = path.join(p, f);
            if (fs.statSync(q).isDirectory()) collect(q);
            else if (f.endsWith('.txt')) files.push(q);
        }
    else if (p.endsWith('.txt')) files.push(p);
};
const args = process.argv.slice(2);
if (args.length === 0) collect(path.resolve(__dirname, '..'));
else args.forEach(collect);

/** key = itemId|model|slot → 观测样本 */
const obs = new Map<
    string,
    {
        itemId: number;
        model: number;
        slot: number;
        x: number[];
        y: number[];
        z: number[];
        nx: number[];
        ny: number[];
        dirs: Set<string>;
    }
>();

/** yaw → 单位方向（编辑器约定：0=+y，90=−x，180=−y，270=+x） */
const yawVec = (yaw: number): [number, number] => {
    const a = rad(((yaw % 360) + 360) % 360);
    // 采样四舍五入到最近的 90°
    const k = Math.round((((yaw % 360) + 360) % 360) / 90) % 4;
    void a;
    return [
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 0],
    ][k] as [number, number];
};

for (const file of files) {
    let data;
    try {
        data = fromStr(fs.readFileSync(file, 'utf8').trim());
    } catch {
        continue;
    }
    const pos = findPosForAreas(data.areas, SEGMENT);
    for (const b of data.buildings) {
        if (isBelt(b.itemId)) continue;
        const rel = data.buildings.filter(
            (o: any) =>
                isBelt(o.itemId) &&
                (o.outputObjIdx === b.index || o.inputObjIdx === b.index)
        );
        if (rel.length === 0) continue;
        const bp = b.localOffset[0];
        const area = pos.areas[b.areaIndex];
        const lat = (area.latitude + bp.y) * ((2 * Math.PI) / (SEGMENT * 5));
        const cos = Math.cos(lat);
        for (const o of rel) {
            const isFeed = o.outputObjIdx === b.index;
            const slot = isFeed ? o.outputToSlot : o.inputFromSlot;
            const dx = o.localOffset[0].x - bp.x;
            const dy = o.localOffset[0].y - bp.y;
            const a = rad(b.yaw[0]);
            const lx = dx * Math.cos(a) - dy * Math.sin(a);
            const ly = dx * Math.sin(a) + dy * Math.cos(a);
            // 带朝向：取出时背离建筑 = 口法线；送入时朝向建筑 = 法线反向
            const [ux, uy] = yawVec(o.yaw[0]);
            const s = isFeed ? -1 : 1;
            const key = `${b.itemId}|${b.modelIndex}|${slot}`;
            if (!obs.has(key))
                obs.set(key, {
                    itemId: b.itemId,
                    model: b.modelIndex,
                    slot,
                    x: [],
                    y: [],
                    z: [],
                    nx: [],
                    ny: [],
                    dirs: new Set(),
                });
            const e = obs.get(key)!;
            e.x.push(lx * cos);
            e.y.push(ly);
            e.z.push(o.localOffset[0].z);
            e.nx.push(ux * s);
            e.ny.push(uy * s);
            e.dirs.add(isFeed ? '送入' : '取出');
        }
    }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
const r2 = (v: number) => Math.round(v * 100) / 100;

const keys = [...obs.keys()].sort((a, b) => {
    const [ia, ma, sa] = a.split('|').map(Number);
    const [ib, mb, sb] = b.split('|').map(Number);
    return ia - ib || ma - mb || sa - sb;
});

console.log('// ==== 标定明细（x 已归一化到赤道，y/z 为原始格）====');
for (const k of keys) {
    const e = obs.get(k)!;
    console.log(
        `// ${k.padEnd(14)} ${name(e.itemId).padEnd(12)}` +
            ` 口=(${mean(e.x).toFixed(4)}, ${mean(e.y).toFixed(4)}, ${mean(
                e.z
            ).toFixed(3)})` +
            ` 法线=(${mean(e.nx).toFixed(2)}, ${mean(e.ny).toFixed(2)})` +
            ` n=${e.x.length} 离散=(${spread(e.x).toFixed(3)}, ${spread(
                e.y
            ).toFixed(3)}, ${spread(e.z).toFixed(3)})` +
            ` ${[...e.dirs].join('/')}`
    );
}

console.log('\n// ==== 表体（可粘贴进 beltPorts.ts）====');
const byItem = new Map<number, typeof keys>();
for (const k of keys) {
    const itemId = obs.get(k)!.itemId;
    if (!byItem.has(itemId)) byItem.set(itemId, []);
    byItem.get(itemId)!.push(k);
}
for (const [itemId, ks] of [...byItem.entries()].sort((a, b) => a[0] - b[0])) {
    const models = [...new Set(ks.map((k) => obs.get(k)!.model))].sort(
        (a, b) => a - b
    );
    console.log(
        `    // ${itemId} ${name(itemId)}  models=${models.join('/')}`
    );
    for (const k of ks) {
        const e = obs.get(k)!;
        console.log(
            `    [${itemId}, ${e.model}, ${e.slot}, { x: ${r2(
                mean(e.x)
            )}, y: ${r2(mean(e.y))}, z: ${r2(mean(e.z))}, nx: ${r2(
                mean(e.nx)
            )}, ny: ${r2(mean(e.ny))} }],`
        );
    }
}

export {};
