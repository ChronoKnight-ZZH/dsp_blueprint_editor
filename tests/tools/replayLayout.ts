/* eslint-disable @typescript-eslint/no-var-requires */
/// <reference types="node" />
/**
 * 端到端复现：空白 v2 蓝图 → buildBeltLine 铺蛇形皮带（5 段拖拽）→ 命令入库串联 →
 * 在 6 对皮带间 createSorterBetween，打印分拣器 offset 与皮带 yaw，
 * 与游戏蓝图对照。
 *
 * Usage: npx ts-node tests/tools/replayLayout.ts
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createEmptyBlueprint } = require(path.join(srcDir, 'blueprint', 'create'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildBeltLine, CreateBeltLineCommand } = require(path.join(srcDir, 'blueprint', 'beltLine'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSorterBetween } = require(path.join(srcDir, 'blueprint', 'sorter'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CreateBuildingCommand } = require(path.join(srcDir, 'blueprint', 'create'));

const bp = createEmptyBlueprint();
// 拖拽段（latFirst 默认，先走 x）；为避免转角重叠，后一段从转角的下一格开始
const drags: [number, number, number, number][] = [
    [2, 4, 12, 3],   // (2,4)->+(12,4)->(12,3)
    [11, 3, 1, 2],   // (11,3)->(1,3)->(1,2)
    [2, 2, 12, 1],   // (2,2)->(12,2)->(12,1)
    [11, 1, 0, 0],   // (11,1)->(0,1)->(0,0)
    [1, 0, 7, 0],    // (1,0)->(7,0)
];
// 段间串联：前一段结束格 → 后一段第一格（x 相邻）
const segmentLinks: [[number, number], [number, number]][] = [
    [[12, 3], [11, 3]],
    [[1, 2], [2, 2]],
    [[12, 1], [11, 1]],
    [[0, 0], [1, 0]],
];

const beltAt = (x: number, y: number) =>
    bp.buildings.find((b: any) =>
        Math.round(b.localOffset[0].x) === x && Math.round(b.localOffset[0].y) === y);

for (const [x0, y0, x1, y1] of drags) {
    const belts = buildBeltLine(2001, 35, { x: x0, y: y0 }, { x: x1, y: y1 }, 90, 'latFirst');
    new CreateBeltLineCommand(belts).do(bp);
}
for (const [[ax, ay], [bx2, by]] of segmentLinks) {
    const a = beltAt(ax, ay), b = beltAt(bx2, by);
    a.outputObjIdx = b.index;
}

console.log(`belts=${bp.buildings.length}`);
// 打印每根皮带 yaw（按 y,x 排序）
const sorted = [...bp.buildings].sort((p: any, q: any) =>
    p.localOffset[0].y - q.localOffset[0].y || p.localOffset[0].x - q.localOffset[0].x);
for (const b of sorted) {
    const c = b.localOffset[0];
    console.log(
        `belt #${String(b.index).padStart(2)} (${Math.round(c.x)},${Math.round(c.y)})` +
        ` yaw=${b.yaw[0].toFixed(4)} out=${b.outputObjIdx}` +
        ` raw=(${c.x.toFixed(6)},${c.y.toFixed(6)})`);
}

// 放置 6 根分拣器（按游戏蓝图的 6 对）
const pairs: [number, number, number, number, number][] = [
    [7, 4, 7, 1, 3],
    [6, 4, 6, 2, 2],
    [5, 4, 5, 3, 1],
    [4, 4, 4, 1, 3],
    [3, 4, 3, 2, 2],
    [2, 4, 2, 3, 1],
];
for (const [sx, sy, dx, dy, expectLen] of pairs) {
    const src = beltAt(sx, sy), dst = beltAt(dx, dy);
    const s = createSorterBetween(src, dst, 2011, 41, bp.buildings, {});
    if (s === null) {
        console.log(`sorter (${sx},${sy})->(${dx},${dy}): null`);
    } else {
        new CreateBuildingCommand(s).do(bp);
        console.log(
            `sorter (${sx},${sy})->(${dx},${dy}) len=${s.parameters.length}(expect ${expectLen})` +
            ` srcOffset=${s.inputOffset} dstOffset=${s.outputOffset}` +
            ` p0=(${s.localOffset[0].x.toFixed(6)},${s.localOffset[0].y.toFixed(6)})` +
            ` p1=(${s.localOffset[1].x.toFixed(6)},${s.localOffset[1].y.toFixed(6)})`);
    }
}

export {};
