/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 反推/校验建筑 slot 坐标表。
 *
 * 原理：分拣器记录里，建筑端端点 = 建筑中心 + R_Z(-yaw)·slot_local
 * （`calcBuildingTrans` 的约定），于是
 *     slot_local = R_Z(+yaw)·(端点 - 中心)
 * 对真实蓝图里所有 itemId + slot 号相同的样本求值，即可反推该 slot 的局部坐标，
 * 并与 src/data/buildingSlots.ts 现有表逐项比对（含 180° 翻转对照，用于识别
 * "源蓝图 yaw=90/270 时用错逆变换"导致的整表翻转）。
 *
 * 用法（仓库根目录）：
 *   npx ts-node tests/tools/deriveSlots.ts <bp.txt> [...]
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
const { getBuildingSlots } = require(path.join(srcDir, 'data', 'buildingSlots'));

const isIns = (id: number) => id >= 2011 && id <= 2014;

interface Sample { itemId: number, modelIndex: number, slot: number, x: number, y: number, file: string, idx: number }

function toLocal(yaw: number, dx: number, dy: number): [number, number] {
    const rad = yaw * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

const samples: Sample[] = [];
for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const bs = data.buildings;
    for (const s of bs) {
        if (!isIns(s.itemId)) continue;
        for (const [objIdx, slot, p] of [
            [s.inputObjIdx, s.inputFromSlot, s.localOffset[0]],
            [s.outputObjIdx, s.outputToSlot, s.localOffset[1]],
        ] as [number, number, { x: number, y: number }][]) {
            const obj = bs[objIdx];
            if (!obj || slot < 0) continue;
            const c = obj.localOffset[0];
            const [lx, ly] = toLocal(obj.yaw[0], p.x - c.x, p.y - c.y);
            samples.push({
                itemId: obj.itemId, modelIndex: obj.modelIndex, slot,
                x: lx, y: ly, file: path.basename(file), idx: s.index,
            });
        }
    }
}

/** 按 itemId + slot 聚合 */
const groups = new Map<string, Sample[]>();
for (const s of samples) {
    const key = `${s.itemId}#${s.slot}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
}

const itemIds = [...new Set(samples.map(s => s.itemId))].sort((a, b) => a - b);
for (const itemId of itemIds) {
    const modelIndexes = [...new Set(samples.filter(s => s.itemId === itemId).map(s => s.modelIndex))];
    const table = getBuildingSlots(itemId);
    console.log(`\n===== itemId ${itemId} (model ${modelIndexes.join('/')}) 现有表 ${table.length} 项 =====`);
    const slots = [...new Set(samples.filter(s => s.itemId === itemId).map(s => s.slot))].sort((a, b) => a - b);
    for (const slot of slots) {
        const g = groups.get(`${itemId}#${slot}`)!;
        const mx = g.reduce((a, s) => a + s.x, 0) / g.length;
        const my = g.reduce((a, s) => a + s.y, 0) / g.length;
        const spreadX = Math.max(...g.map(s => s.x)) - Math.min(...g.map(s => s.x));
        const spreadY = Math.max(...g.map(s => s.y)) - Math.min(...g.map(s => s.y));
        const cur = table[slot];
        const curTxt = cur ? `现有(${cur.x.toFixed(4)}, ${cur.y.toFixed(4)})` : '现有(无)';
        const d0 = cur ? Math.hypot(cur.x - mx, cur.y - my) : NaN;
        const d180 = cur ? Math.hypot(-cur.x - mx, -cur.y - my) : NaN;
        console.log(
            `  slot ${String(slot).padStart(2)}: 反推(${mx.toFixed(4)}, ${my.toFixed(4)}) n=${g.length}` +
            ` 散布(${spreadX.toFixed(3)}, ${spreadY.toFixed(3)})  ${curTxt}` +
            `  差=${d0.toFixed(3)} 180°差=${d180.toFixed(3)}`);
        if (g.length > 1 && (spreadX > 0.05 || spreadY > 0.05)) {
            for (const s of g)
                console.log(`        (${s.x.toFixed(4)}, ${s.y.toFixed(4)})  ${s.file} #${s.idx}`);
        }
    }
}

// 未被任何样本覆盖、但现有表里有的 itemId（仅提示）
const covered = new Set(itemIds);
console.log('\n未被样本覆盖的 itemId（无法反推）:', [2101, 2102, 2204, 2210, 2302, 2303, 2309, 2310, 2311, 2312, 2901, 3009].filter(i => !covered.has(i)).join(', ') || '(无)');

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
