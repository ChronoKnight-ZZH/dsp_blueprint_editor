/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 复现工具"新建蓝图 → 铺传送带 → 加分拣器 → 导出"的完整链路，
 * 打印导出后的分拣器记录（重点看 v2ExtraPose）与传送带数据。
 *
 * 用法: npx ts-node tests/tools/reproExport.ts
 */

const path = require('path');
const Module = require('module');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request.startsWith('@/'))
        request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

const { createEmptyBlueprint, CreateBuildingCommand } = require(path.join(srcDir, 'blueprint', 'create'));
const { buildBeltLine, CreateBeltLineCommand } = require(path.join(srcDir, 'blueprint', 'beltLine'));
const { createSorterBetween } = require(path.join(srcDir, 'blueprint', 'sorter'));
const { toStr, fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));
const { normalizeBlueprintAreas } = require(path.join(srcDir, 'blueprint', 'area'));

// 上排向东（yaw 90）、下排向西（yaw 270），与"工具生成.txt"里跨排分拣器的结构一致
function clone(belts: any[]): any[] {
    return belts.map(b => ({ ...b, localOffset: b.localOffset.map((p: any) => ({ ...p })) }));
}

const bp = createEmptyBlueprint();
new CreateBeltLineCommand(clone(buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 4 }, 90, 'latFirst'))).do(bp);
new CreateBeltLineCommand(clone(buildBeltLine(2001, 35, { x: 6, y: 1 }, { x: 2, y: 1 }, 270, 'latFirst'))).do(bp);

const find = (x: number, y: number) =>
    bp.buildings.find((b: any) => b.localOffset[0].x === x && b.localOffset[0].y === y);

for (const [dx, len] of [[0, 1], [1, 2], [2, 3]] as [number, number][]) {
    const src = find(3 + dx, 4);
    const dst = find(3 + dx, 1);
    const sorter = createSorterBetween(src, dst, 2011, 41, bp.buildings, {
        src: { x: 3 + dx, y: 4 }, dst: { x: 3 + dx, y: 1 },
    });
    if (!sorter) { console.log(`长度 ${len} 的分拣器构造失败`); continue; }
    console.log(`构造（长度 ${len}）: p0=(${sorter.localOffset[0].x},${sorter.localOffset[0].y}) ` +
        `p1=(${sorter.localOffset[1].x},${sorter.localOffset[1].y}) yaw=${JSON.stringify(sorter.yaw)} ` +
        `pose=${JSON.stringify(sorter.v2ExtraPose)}`);
    new CreateBuildingCommand(sorter).do(bp);
}

const normalized = normalizeBlueprintAreas(bp);
console.log('\nnormalizeBlueprintAreas 之后的分拣器 pose:');
for (const b of normalized.buildings.filter((x: any) => x.itemId === 2011))
    console.log(`  #${b.index} yaw=${JSON.stringify(b.yaw)} pose=${JSON.stringify(b.v2ExtraPose)}`);

const parsed = fromStr(toStr(bp));
console.log('\n导出再解析后的分拣器记录:');
for (const b of parsed.buildings.filter((x: any) => x.itemId === 2011)) {
    console.log(`  #${b.index} len=${JSON.stringify(b.parameters)} yaw=${JSON.stringify(b.yaw)} tilt=${b.tilt}`);
    console.log(`      p0=(${b.localOffset[0].x},${b.localOffset[0].y}) p1=(${b.localOffset[1].x},${b.localOffset[1].y})`);
    console.log(`      pose=${JSON.stringify(b.v2ExtraPose)}  → pose[4] 应为 yaw[0]=${b.yaw[0]}`);
}
const counts = new Map<string, number>();
for (const b of parsed.buildings.filter((x: any) => x.itemId === 2001)) {
    const key = `${b.localOffset[0].x},${b.localOffset[0].y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log('\n传送带格:', [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(' '));

// 4) 两次拖拽拼一条 L 形（接缝处重叠），检查拐角 yaw 与是否产生重复格
console.log('\n--- 多次拖拽拼接（模拟"工具生成.txt"的画法）---');
const bp2 = createEmptyBlueprint();
new CreateBeltLineCommand(clone(buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 3 }, 90, 'latFirst'))).do(bp2);
new CreateBeltLineCommand(clone(buildBeltLine(2001, 35, { x: 6, y: 3 }, { x: 2, y: 3 }, 270, 'latFirst'))).do(bp2);
const counts2 = new Map<string, any[]>();
for (const b of bp2.buildings.filter((x: any) => x.itemId === 2001)) {
    const key = `${b.localOffset[0].x},${b.localOffset[0].y}`;
    counts2.set(key, [...(counts2.get(key) ?? []), b]);
}
const byIdx = new Map<number, any>(bp2.buildings.map((b: any) => [b.index, b]));
for (const [key, list] of counts2) {
    for (const b of list) {
        const succ = b.outputObjIdx >= 0 ? byIdx.get(b.outputObjIdx) : null;
        console.log(`  格 ${key}: ${list.length} 条, yaw=${b.yaw[0]}, output→` +
            `${succ ? `(${succ.localOffset[0].x},${succ.localOffset[0].y})` : '无'}` +
            `${list.length > 1 ? '  ← 重复格！' : ''}`);
    }
}
const parsed2 = fromStr(toStr(bp2));
const dup2 = new Map<string, number>();
for (const b of parsed2.buildings.filter((x: any) => x.itemId === 2001)) {
    const key = `${b.localOffset[0].x},${b.localOffset[0].y}`;
    dup2.set(key, (dup2.get(key) ?? 0) + 1);
}
console.log('  导出后重复格:', [...dup2.entries()].filter(([, n]) => n > 1).map(([k]) => k).join(' ') || '无');
console.log('  导出后 yaw:', parsed2.buildings.filter((x: any) => x.itemId === 2001)
    .map((b: any) => `(${b.localOffset[0].x},${b.localOffset[0].y})${b.yaw[0]}`).join(' '));

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
