#!/usr/bin/env ts-node
/**
 * dumpBlueprintData.ts
 *
 * 用项目自带的 parser 从蓝图文本中提取结构化数据。
 * 重点：头部字段、分区、建筑/配方数量、地基矩形与颜色。
 *
 * 用法（项目 tsconfig 为 esnext，需与 package.json 的 cli 脚本一致强制 commonjs 输出）:
 *   npx ts-node -O '{"module":"commonjs"}' tests/tools/dumpBlueprintData.ts <file.txt>
 *   cat blueprint.txt | npx ts-node -O '{"module":"commonjs"}' tests/tools/dumpBlueprintData.ts
 *   npx ts-node -O '{"module":"commonjs"}' tests/tools/dumpBlueprintData.ts <file.txt> --json
 *   npx ts-node -O '{"module":"commonjs"}' tests/tools/dumpBlueprintData.ts <file.txt> --reform
 *   npx ts-node -O '{"module":"commonjs"}' tests/tools/dumpBlueprintData.ts <file.txt> --buildings
 *
 * 依赖（全部来自项目本身）:
 *   src/blueprint/parser.ts   fromStr / BlueprintData
 *   src/data/color.ts         colorPalette256
 *   src/data/items.ts         itemsMap
 *   src/data/recipes.ts       recipesMap
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';
import type { BlueprintData } from '../../src/blueprint/parser';

// ts-node 默认不解析 tsconfig 中的 "@/" 路径别名，而项目源码 parser.ts 使用了该别名。
// 这里注册一个最小解析器，使本工具可独立通过 `npx ts-node` 运行。
const SRC_ROOT = path.resolve(__dirname, '../../src');
const NodeModule = require('module') as any;
const originalRequire = NodeModule.prototype.require;
NodeModule.prototype.require = function (request: string) {
    if (request.startsWith('@/'))
        request = path.join(SRC_ROOT, request.slice(2));
    return originalRequire.call(this, request);
};

// 别名注册完成后再加载项目模块（值导入）
const { fromStr } = require('../../src/blueprint/parser') as typeof import('../../src/blueprint/parser');
const { colorPalette256 } = require('../../src/data/color') as typeof import('../../src/data/color');
const { itemsMap } = require('../../src/data/items') as typeof import('../../src/data/items');
const { recipesMap } = require('../../src/data/recipes') as typeof import('../../src/data/recipes');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 地基 data 字节高 3 位 -> 类型名（未标定的给出 TYPE_n） */
const REFORM_TYPE_NAMES: Record<number, string> = {
  0: 'PLAIN',
  1: 'IBEAM',
  2: 'GRID',
};

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

interface CliOptions {
  file: string | null;
  json: boolean;
  reformOnly: boolean;
  buildingsOnly: boolean;
}

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const file = argv.find(a => !a.startsWith('--')) ?? null;
  return {
    file,
    json: flags.has('--json'),
    reformOnly: flags.has('--reform'),
    buildingsOnly: flags.has('--buildings'),
  };
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** 把 uint32 当作 0xRRGGBBAA 输出（游戏实际字节序以 parser 为准，仅作展示） */
function uint32ToHexRRGGBBAA(c: number): string {
  const u = c >>> 0;
  return `#${hex2((u >>> 24) & 0xff)}${hex2((u >>> 16) & 0xff)}${hex2((u >>> 8) & 0xff)}${hex2(u & 0xff)}`;
}

/**
 * 解析一个地基颜色索引 -> { hex, custom }。
 *
 * 规则（对照 CODE_WIKI §7.5）：
 *   - data 字节低 5 位 = colorIndex (0..31)
 *   - 若 customReformColorMask 的第 colorIndex 位为 0 -> 使用默认调色板 colorPalette256[colorIndex]
 *   - 若为 1 -> 按掩码中低位到高位的顺序从 customReformColors 中取出对应 uint32
 */
function resolveReformColor(
  bp: BlueprintData,
  colorIndex: number
): { hex: string; custom: boolean } {
  const reform = bp.reformData;
  if (!reform) {
    return { hex: colorPalette256[colorIndex] ?? '#000000', custom: false };
  }
  const mask = reform.customReformColorMask >>> 0;
  const isCustom = ((mask >>> colorIndex) & 1) === 1;
  if (!isCustom) {
    return { hex: colorPalette256[colorIndex] ?? '#000000', custom: false };
  }
  let offset = 0;
  for (let i = 0; i < colorIndex; i++) {
    if (((mask >>> i) & 1) === 1) offset++;
  }
  const packed = reform.customReformColors[offset] ?? 0;
  return { hex: uint32ToHexRRGGBBAA(packed), custom: true };
}

// ---------------------------------------------------------------------------
// 名称查询（防御式：Item/Recipe 字段名未知时返回空串）
// ---------------------------------------------------------------------------

function itemLabel(itemId: number): string {
  const item = itemsMap.get(itemId) as any;
  return item ? (item.name ?? item.Name ?? '') : '';
}

function recipeLabel(recipeId: number): string {
  const r = recipesMap.get(recipeId) as any;
  return r ? (r.name ?? r.Name ?? '') : '';
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

interface ReformByIndexEntry {
  count: number;
  hex: string;
  custom: boolean;
}

interface ReformRectSample {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  colorIndex: number;
  colorHex: string;
  custom: boolean;
  areaIndex: number;
}

interface ReformStats {
  totalRects: number;
  customReformColorMask: string;
  customReformColors: string[];
  byType: Record<string, number>;
  byColorIndex: Record<number, ReformByIndexEntry>;
  byColorHex: Record<string, number>;
  rectsSample: ReformRectSample[];
}

interface BlueprintSummary {
  version: number;
  header: unknown;
  numAreas: number;
  areas: unknown[];
  numBuildings: number;
  buildingCounts: Array<{ itemId: number; name: string; count: number }>;
  recipeCounts: Array<{ recipeId: number; name: string; count: number }>;
  reform: ReformStats | null;
}

function summarize(bp: BlueprintData): BlueprintSummary {
  const buildingCounts = new Map<number, number>();
  const recipeCounts = new Map<number, number>();
  for (const b of bp.buildings) {
    buildingCounts.set(b.itemId, (buildingCounts.get(b.itemId) ?? 0) + 1);
    if (b.recipeId > 0) {
      recipeCounts.set(b.recipeId, (recipeCounts.get(b.recipeId) ?? 0) + 1);
    }
  }

  let reform: ReformStats | null = null;
  const rd = bp.reformData;
  if (rd) {
    const byType: Record<string, number> = {};
    const byColorIndex: Record<number, ReformByIndexEntry> = {};
    const byColorHex: Record<string, number> = {};
    const rectsSample: ReformRectSample[] = [];

    for (const r of rd.rects) {
      // parser 已将 data 字节拆分为 type（高 3 位）与 color（低 5 位）
      const type = r.type;
      const colorIndex = r.color;
      const typeName = REFORM_TYPE_NAMES[type] ?? `TYPE_${type}`;
      byType[typeName] = (byType[typeName] ?? 0) + 1;

      const { hex, custom } = resolveReformColor(bp, colorIndex);
      const entry = byColorIndex[colorIndex] ?? (byColorIndex[colorIndex] = { count: 0, hex, custom });
      entry.count++;
      byColorHex[hex] = (byColorHex[hex] ?? 0) + 1;

      if (rectsSample.length < 20) {
        rectsSample.push({
          x: r.x, y: r.y, w: r.w, h: r.h,
          type: typeName,
          colorIndex,
          colorHex: hex,
          custom,
          areaIndex: r.areaIndex,
        });
      }
    }

    reform = {
      totalRects: rd.rects.length,
      customReformColorMask: `0x${(rd.customReformColorMask >>> 0).toString(16).padStart(8, '0')}`,
      customReformColors: rd.customReformColors.map(uint32ToHexRRGGBBAA),
      byType,
      byColorIndex,
      byColorHex,
      rectsSample,
    };
  }

  return {
    version: bp.version,
    header: bp.header,
    numAreas: (bp.areas as unknown[]).length,
    areas: bp.areas as unknown[],
    numBuildings: bp.buildings.length,
    buildingCounts: [...buildingCounts.entries()]
      .map(([itemId, count]) => ({ itemId, name: itemLabel(itemId), count }))
      .sort((a, b) => b.count - a.count),
    recipeCounts: [...recipeCounts.entries()]
      .map(([recipeId, count]) => ({ recipeId, name: recipeLabel(recipeId), count }))
      .sort((a, b) => b.count - a.count),
    reform,
  };
}

// ---------------------------------------------------------------------------
// 打印
// ---------------------------------------------------------------------------

function printReport(s: BlueprintSummary): void {
  const log = console.log;

  log('════════════════════════════════════════');
  log(' 蓝图数据总览');
  log('════════════════════════════════════════');
  log();

  log('--- 头部 ---');
  log(JSON.stringify(s.header, null, 2));
  log();

  log('--- 基础信息 ---');
  log(`version      = ${s.version}`);
  log(`numAreas     = ${s.numAreas}`);
  log(`numBuildings = ${s.numBuildings}`);
  log();

  log('--- 分区 ---');
  s.areas.forEach((a: any, i) => {
    const size = a?.size ?? a?.boxSize ?? '?';
    const anchor = a?.anchorLocalOffset ?? a?.anchor ?? '?';
    log(`  [${i}] parentIndex=${a?.parentIndex} size=${JSON.stringify(size)} anchor=${JSON.stringify(anchor)}`);
  });
  log();

  log('--- 建筑 Top 20 ---');
  s.buildingCounts.slice(0, 20).forEach(({ itemId, name, count }) => {
    log(`  itemId=${String(itemId).padStart(6)}  x${String(count).padStart(5)}  ${name}`);
  });
  log();

  if (s.recipeCounts.length > 0) {
    log('--- 配方 Top 20 ---');
    s.recipeCounts.slice(0, 20).forEach(({ recipeId, name, count }) => {
      log(`  recipeId=${String(recipeId).padStart(4)}  x${String(count).padStart(5)}  ${name}`);
    });
    log();
  }

  if (!s.reform) {
    log('（蓝图不含地基数据）');
    return;
  }

  const r = s.reform;
  log('════════════════════════════════════════');
  log(' 地基 (reformData)');
  log('════════════════════════════════════════');
  log(`总矩形数:        ${r.totalRects}`);
  log(`自定义颜色掩码:  ${r.customReformColorMask}`);
  log(`自定义颜色数量:  ${r.customReformColors.length}`);
  if (r.customReformColors.length > 0) {
    log('自定义颜色列表 (按 mask 置位顺序):');
    r.customReformColors.forEach((hex, i) => log(`  [${i}] ${hex}`));
  }
  log();

  log('按类型:');
  for (const [type, count] of Object.entries(r.byType)) {
    log(`  ${type.padEnd(8)}  x${count}`);
  }
  log();

  log('按颜色索引:');
  const indices = Object.keys(r.byColorIndex).map(Number).sort((a, b) => a - b);
  for (const idx of indices) {
    const e = r.byColorIndex[idx];
    log(`  colorIndex=${String(idx).padStart(2)}  x${String(e.count).padStart(5)}  ${e.hex}${e.custom ? '  (custom)' : ''}`);
  }
  log();

  log('按颜色 HEX 汇总:');
  for (const [hex, count] of Object.entries(r.byColorHex).sort((a, b) => b[1] - a[1])) {
    log(`  ${hex}  x${count}`);
  }
  log();

  log(`矩形样本 (前 ${r.rectsSample.length} 个):`);
  log('   x    y    w   h  type      colorIdx  colorHex    custom  area');
  for (const rec of r.rectsSample) {
    log(
      `  ${String(rec.x).padStart(4)} ${String(rec.y).padStart(4)} ` +
      `${String(rec.w).padStart(3)} ${String(rec.h).padStart(3)}  ` +
      `${rec.type.padEnd(8)}  ${String(rec.colorIndex).padStart(2)}        ` +
      `${rec.colorHex}  ${rec.custom ? 'yes   ' : 'no    '}  ${rec.areaIndex}`
    );
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function main(): void {
  const opts = parseArgs();
  const text = (opts.file ? fs.readFileSync(opts.file, 'utf-8') : readStdin()).trim();
  if (!text) {
    console.error('用法: npx ts-node -O \'{"module":"commonjs"}\' tests/tools/dumpBlueprintData.ts <file.txt> [--json] [--reform] [--buildings]');
    process.exit(1);
  }

  let bp: BlueprintData;
  try {
    bp = fromStr(text);
  } catch (e) {
    console.error('解析失败:', (e as Error).message);
    process.exit(1);
  }

  const summary = summarize(bp);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (opts.reformOnly) {
    console.log(JSON.stringify(summary.reform, null, 2));
    return;
  }
  if (opts.buildingsOnly) {
    console.log(JSON.stringify(
      { buildingCounts: summary.buildingCounts, recipeCounts: summary.recipeCounts },
      null, 2
    ));
    return;
  }

  printReport(summary);
}

main();