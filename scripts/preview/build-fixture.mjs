#!/usr/bin/env node
/**
 * 把「后端抓包」改造成**当前需求格式**的预览测试数据。
 *
 * 用途：给 `scripts/lib-build/preview-test.html` 提供 fixture。
 *
 * 改造内容（对应 `data/4.` 的契约清单）：
 * 1. `areas`：扁平字段 → **嵌套**（`anchorLocalOffset{x,y}` + `size{x,y}`，即后端 T1 之后的样子）；
 * 2. `building`：新增 `isTemporary`（后端 T2），删掉恒为 0 的 `tilt/tilt2/pitch/pitch2`，
 *    删掉与 `yaw` 恒等的 `yaw2`（前端按"缺省即 yaw"处理）；
 * 3. 只保留渲染需要的字段，体积大约降到原始的 1/3；
 * 4. 附带统计（事件数、操作数、净存活数），供测试页直接断言。
 *
 * 用法：
 *   node scripts/preview/build-fixture.mjs
 *   node scripts/preview/build-fixture.mjs --in data/xxx.json --out scripts/lib-build/preview-fixture.json --limit 120
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
        args[key] = value;
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(
    ROOT,
    args.in ?? "data/preview-delta-044ac41b-1793883142890.json"
);
const output = path.resolve(
    ROOT,
    args.out ?? "scripts/lib-build/preview-fixture.json"
);
const limit = args.limit === undefined ? Infinity : Math.max(1, Number(args.limit));

if (!fs.existsSync(input)) {
    console.error(`[fixture] 输入不存在：${input}`);
    process.exit(1);
}

/** 扁平/嵌套两种 area 形态 → 统一的嵌套形态 */
function normalizeArea(area) {
    const normalized = {
        index: area.index,
        parentIndex: area.parentIndex ?? -1,
        tropicAnchor: area.tropicAnchor ?? 0,
        areaSegments: area.areaSegments,
        anchorLocalOffset: {
            x: area.anchorLocalOffset?.x ?? area.anchorLocalOffsetX ?? 0,
            y: area.anchorLocalOffset?.y ?? area.anchorLocalOffsetY ?? 0,
        },
        size: {
            x: area.size?.x ?? area.width ?? 0,
            y: area.size?.y ?? area.height ?? 0,
        },
    };
    return normalized;
}

/** 只保留渲染需要的字段，并按新契约补 `isTemporary` */
function normalizeBuilding(building) {
    const out = {
        index: building.index ?? -1,
        isTemporary: building.isTemporary ?? (building.index ?? -1) === -1,
        itemId: building.itemId,
        modelIndex: building.modelIndex,
        areaIndex: building.areaIndex ?? 0,
        localOffset: {
            x: building.localOffset.x,
            y: building.localOffset.y,
            z: building.localOffset.z,
        },
        localOffset2: {
            x: building.localOffset2?.x ?? building.localOffset.x,
            y: building.localOffset2?.y ?? building.localOffset.y,
            z: building.localOffset2?.z ?? building.localOffset.z,
        },
        yaw: building.yaw,
        inputFromSlot: building.inputFromSlot ?? 0,
        outputToSlot: building.outputToSlot ?? 0,
        productionIndex: building.productionIndex ?? -1,
    };
    if (typeof building.inputObjectId === "string") out.inputObjectId = building.inputObjectId;
    if (typeof building.outputObjectId === "string") out.outputObjectId = building.outputObjectId;
    return out;
}

function normalizeEvent(event) {
    const normalized = {
        taskId: event.taskId,
        kind: event.kind,
        protocolVersion: event.protocolVersion,
        sequence: event.sequence,
        stage: event.stage,
        message: event.message,
        coordinateSystem: event.coordinateSystem,
    };
    if (event.primaryAreaIndex !== undefined) normalized.primaryAreaIndex = event.primaryAreaIndex;
    if (Array.isArray(event.areas) && event.areas.length > 0)
        normalized.areas = event.areas.map(normalizeArea);
    if (Array.isArray(event.operations)) {
        normalized.operations = event.operations.map((op) =>
            op.type === "remove"
                ? { type: "remove", objectId: op.objectId }
                : { type: op.type, objectId: op.objectId, building: normalizeBuilding(op.building) }
        );
    }
    return normalized;
}

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const events = (Array.isArray(raw) ? raw : raw.events ?? []).slice(0, limit);
const normalized = events.map(normalizeEvent);

// ---- 统计（测试页据此断言）
const alive = new Set();
let peak = 0;
let operations = 0;
let unknownRemoves = 0;
let unknownReplaces = 0;
const switchSeqs = [];
let lastSystem = null;
const byType = { add: 0, replace: 0, remove: 0 };
for (const event of normalized) {
    for (const op of event.operations ?? []) {
        operations++;
        byType[op.type] = (byType[op.type] ?? 0) + 1;
        if (op.type === "remove") {
            if (!alive.has(op.objectId)) unknownRemoves++;
            alive.delete(op.objectId);
        } else {
            if (op.type === "replace" && !alive.has(op.objectId)) unknownReplaces++;
            alive.add(op.objectId);
        }
    }
    if (alive.size > peak) peak = alive.size;
    if (lastSystem !== null && lastSystem !== event.coordinateSystem)
        switchSeqs.push(event.sequence);
    lastSystem = event.coordinateSystem;
}

const fixture = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, input).replace(/\\/g, "/"),
    stats: {
        events: normalized.length,
        operations,
        expectedAlive: alive.size,
        expectedPeak: peak,
        unknownRemoves,
        unknownReplaces,
        byType,
        firstSequence: normalized[0]?.sequence ?? null,
        lastSequence: normalized[normalized.length - 1]?.sequence ?? null,
        switchSequences: switchSeqs,
    },
    events: normalized,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(fixture), "utf8");

const kb = (value) => `${(value / 1024).toFixed(0)} KiB`;
console.log("[fixture] 输入：", path.relative(ROOT, input), kb(fs.statSync(input).size));
console.log("[fixture] 输出：", path.relative(ROOT, output), kb(fs.statSync(output).size));
console.log("[fixture] 事件：", fixture.stats.events, "操作：", operations, "末态存活：", alive.size, "峰值：", peak);
console.log("[fixture] 未知 remove/replace：", unknownRemoves, "/", unknownReplaces);
console.log("[fixture] 坐标切换发生在 sequence：", switchSeqs.join(", ") || "(无)");
