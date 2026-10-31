#!/usr/bin/env node
/**
 * 贴图清理脚本：把「没被任何 GLB 材质引用」的贴图移出仓库（不删除）。
 * ============================================================================
 * 判定依据：`scripts/texture-mapping.json`（由 gen-texture-manifest.mjs 生成），
 * 其中 `normal` / `emissive` / `spec` 三个字段就是运行期真正会加载的贴图。
 * 其余 PNG（LOD1/LOD2 变体、未接入的特效图、与 GLB 内嵌图完全一致的 `-a` 源图、
 * 没有对应建筑的目录……）一律视为无用。
 *
 * 安全策略：
 *   - 默认 **dry-run**，只打印统计与清单，不动文件；
 *   - `--apply` 才真正移动，且只移动到仓库外的备份目录（保持原相对路径），
 *     因此随时可以整体搬回；
 *   - 同时在备份目录写 `MOVE_LIST.md`（原路径 → 备份路径 → 大小），
 *     并写 `restore.ps1` 一键还原。
 *
 * 用法：
 *   node scripts/prune-model-textures.mjs                 # 预演
 *   node scripts/prune-model-textures.mjs --apply         # 真正移动
 *   node scripts/prune-model-textures.mjs --apply --dest D:\backup\tex
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MODELS_DIR = join(REPO, 'src', 'assets', 'icons', 'models');
const MAPPING_PATH = join(HERE, 'texture-mapping.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const destIndex = args.indexOf('--dest');
const DEFAULT_DEST = resolve(REPO, '..', `_unused_textures_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
const DEST = destIndex === -1 ? DEFAULT_DEST : resolve(args[destIndex + 1]);

const toPosix = p => p.split(sep).join('/');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory())
            walk(full, out);
        else
            out.push(full);
    }
    return out;
}

// ---------------------------------------------------------------- 计算 keep 集

const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'));
const keep = new Set();
for (const entry of mapping.entries) {
    for (const key of ['normal', 'emissive', 'spec'])
        if (entry[key] !== null && entry[key] !== undefined)
            keep.add(entry[key]);
}

const allPngs = walk(MODELS_DIR).filter(f => /\.png$/i.test(f));
const keepFiles = [];
const moveFiles = [];
for (const file of allPngs) {
    const rel = toPosix(relative(MODELS_DIR, file));
    (keep.has(rel) ? keepFiles : moveFiles).push({ rel, abs: file, size: statSync(file).size });
}

// 双向校验：keep 集里不能有磁盘上不存在的文件
const dangling = [...keep].filter(rel => !existsSync(join(MODELS_DIR, rel)));
if (dangling.length > 0) {
    console.error('映射表引用了不存在的贴图，先重跑 gen-texture-manifest.mjs：');
    for (const rel of dangling)
        console.error(`  - ${rel}`);
    process.exit(1);
}

const sum = list => list.reduce((acc, f) => acc + f.size, 0);
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log(JSON.stringify({
    dryRun: !APPLY,
    dest: DEST,
    total: allPngs.length,
    keep: keepFiles.length,
    keepSize: mb(sum(keepFiles)),
    moveOut: moveFiles.length,
    moveOutSize: mb(sum(moveFiles)),
    referencedByGlb: [...keep].length,
}, null, 2));

if (!APPLY) {
    console.log('\n（预演模式，未移动任何文件；加 --apply 执行）');
    process.exit(0);
}

// ---------------------------------------------------------------- 执行移动

mkdirSync(DEST, { recursive: true });
const movedThisRun = [];
for (const file of moveFiles) {
    const target = join(DEST, file.rel.split('/').join(sep));
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target))
        rmSync(target);
    renameSync(file.abs, target);

    // 校验：搬过去的字节数一致
    const movedSize = statSync(target).size;
    if (movedSize !== file.size)
        throw new Error(`移动后大小不一致：${file.rel}（${file.size} → ${movedSize}）`);

    movedThisRun.push(`| \`${file.rel}\` | ${(file.size / 1024).toFixed(0)} KB |`);
}

// 清单以备份目录的**实际内容**为准（多次执行也不会丢历史记录）
const movedInventory = walk(DEST)
    .filter(f => /\.png$/i.test(f))
    .map(f => ({
        rel: toPosix(relative(DEST, f)),
        size: statSync(f).size,
    }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

const totalMoved = sum(moveFiles);
const inventoryBytes = movedInventory.reduce((acc, f) => acc + f.size, 0);
const md = [
    '# 建筑贴图清理记录',
    '',
    `- 最近一次执行：${new Date().toISOString()}`,
    `- 备份根目录：\`${DEST}\``,
    `- 备份中累计文件数：**${movedInventory.length}**（${mb(inventoryBytes)}）`,
    `- 本次移动：**${moveFiles.length}**（${mb(totalMoved)}）`,
    `- 仓库内保留：**${keepFiles.length}**（${mb(sum(keepFiles))}），即被 GLB 材质真正引用的通道贴图`,
    '',
    '## 判定口径',
    '',
    '保留 = `scripts/texture-mapping.json` 中 `normal` / `emissive` / `spec` 指向的贴图（运行期会加载）。',
    '移走 = 其余全部 PNG：LOD1/LOD2 变体、未接入的特效/遮罩图、与 GLB 内嵌图完全一致的 `-a` 源图、',
    '以及没有对应建筑模型的目录。',
    '',
    '## 还原方式',
    '',
    '在本目录执行 `powershell -File restore.ps1`，即可把全部贴图按原相对路径搬回仓库。',
    '',
    '## 明细',
    '',
    '| 备份内路径（相对 `src/assets/icons/models`） | 大小 |',
    '| --- | --- |',
    ...movedInventory.map(f => `| \`${f.rel}\` | ${(f.size / 1024).toFixed(0)} KB |`),
    '',
    '## 本次移动',
    '',
    '| 路径 | 大小 |',
    '| --- | --- |',
    ...(movedThisRun.length > 0 ? movedThisRun : ['| （本次没有新增移动） | — |']),
    '',
];
writeFileSync(join(DEST, 'MOVE_LIST.md'), md.join('\n'), 'utf8');

const restore = [
    '# 把移走的贴图原样搬回仓库',
    "$ErrorActionPreference = 'Stop'",
    `$backup = '${DEST}'`,
    `$models = '${join(REPO, 'src', 'assets', 'icons', 'models')}'`,
    '$count = 0',
    'Get-ChildItem -Recurse $backup -Filter *.png | ForEach-Object {',
    '    $rel = $_.FullName.Substring($backup.Length + 1)',
    '    $dst = Join-Path $models $rel',
    '    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null',
    '    Copy-Item $_.FullName $dst -Force',
    '    $count++',
    '}',
    'Write-Host "已还原 $count 张贴图到 $models"',
    '',
].join('\n');
writeFileSync(join(DEST, 'restore.ps1'), restore, 'utf8');

console.log(`\n已移动 ${moveFiles.length} 个文件（${mb(totalMoved)}）到 ${DEST}`);
console.log(`保留 ${keepFiles.length} 个文件（${mb(sum(keepFiles))}）`);
console.log(`明细：${join(DEST, 'MOVE_LIST.md')}`);
