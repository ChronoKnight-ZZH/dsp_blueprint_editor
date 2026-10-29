#!/usr/bin/env node
/**
 * 贴图清单生成器
 * ============================================================================
 * 职责：把 `src/assets/icons/models/*.glb` 里每个材质的「底色贴图」认出来，
 *       再在对应子目录里找到同名的 `-n` / `-e` / `-s` 三张通道贴图，
 *       生成两张产物：
 *
 *   1. `scripts/texture-mapping.json`  持久映射表（人读 + 可再次生成用）
 *   2. `src/models/textureManifest.ts` 运行期清单（材质键 → 三张图的 URL）
 *
 * 认图规则（不再靠肉眼猜文件名）：
 *   - GLB 内嵌的底色图与磁盘 PNG 做 **MD5 全等**比对 → 100% 确定是同一张图；
 *   - 由命中的文件名剥掉通道标记（a/e/n/s）与 LOD 标记（lod/lod0/lod1/lod2）
 *     得到「词干」，例如 `assembler-mk-a.png` → `assembler-mk`；
 *   - 同目录下同词干的 `-n/-e/-s` 即为该材质的通道贴图，LOD 变体优先取
 *     无 LOD 或 lod0 的那张（当前 GLB 只导出了 LOD0 网格）。
 *
 * 为什么必须先跑这个脚本：GLB 里只内嵌了底色图，没有法线/自发光/高光；
 * 而底色图在磁盘上的命名五花八门（`smelter-a-lod0.png` / `smelter-lod-a.png`），
 * 只有哈希比对能稳定锚定「哪个材质该配哪组通道图」。
 *
 * 用法：
 *   node scripts/gen-texture-manifest.mjs            # 重新生成清单
 *   node scripts/gen-texture-manifest.mjs --report    # 只打印覆盖率报告
 *
 * 注意：删除 `-a` 源图之后哈希比对就无从做起，届时请从
 * `scripts/texture-mapping.json` 复原（`--from-mapping` 选项）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MODELS_DIR = join(REPO, 'src', 'assets', 'icons', 'models');
const MAPPING_PATH = join(HERE, 'texture-mapping.json');
const MANIFEST_PATH = join(REPO, 'src', 'models', 'textureManifest.ts');

/** 通道标记 → 语义 */
const CHANNEL_TOKENS = new Set(['a', 'e', 'n', 's']);
const LOD_TOKENS = new Set(['lod', 'lod0', 'lod1', 'lod2']);

const args = new Set(process.argv.slice(2));
const FROM_MAPPING = args.has('--from-mapping');
const REPORT_ONLY = args.has('--report');
/**
 * 可选的补充素材目录（通常是清理后的备份目录）。
 * 清理掉 `-a` 源图之后，哈希比对就无从做起——此时把备份目录挂进来当「只读素材池」，
 * 生成的映射仍然只引用 `src/assets/icons/models` 下的相对路径，
 * 并输出一份「需要从备份恢复哪些文件」的清单。
 */
const extraIndex = process.argv.indexOf('--extra-root');
const EXTRA_ROOT = extraIndex === -1 ? null : resolve(process.argv[extraIndex + 1]);

// ---------------------------------------------------------------- 工具

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory())
            walkFiles(full, out);
        else
            out.push(full);
    }
    return out;
}

const toPosix = p => p.split(sep).join('/');

/**
 * 解析文件名 → { dir, stem, channel, lod, style }
 *
 * 两种命名家族都要认：
 *   - `dash` ：`assembler-mk-n.png` / `smelter-a-lod0.png` / `smelter-lod-s.png`
 *              （通道是一个独立的 `-n/-a/-s` 片段）
 *   - `glued`：`tesla-tower-1a.png` / `tesla-tower-1n.png`
 *              （通道字母粘在编号后面，没有独立片段，必须靠正则兜底）
 * 同组三张图必须同一家族，否则拼出来的文件名会对不上。
 */
function parseTextureName(relPath) {
    const norm = toPosix(relPath);
    const slash = norm.lastIndexOf('/');
    const dir = slash === -1 ? '' : norm.slice(0, slash);
    const base = norm.slice(slash + 1).replace(/\.png$/i, '');
    const tokens = base.split('-');
    let channel = null;
    let lod = null;
    let style = 'dash';
    const core = [];
    for (const token of tokens) {
        const lower = token.toLowerCase();
        if (channel === null && CHANNEL_TOKENS.has(lower))
            channel = lower;
        else if (LOD_TOKENS.has(lower))
            lod = lower;
        else
            core.push(token);
    }
    if (channel === null) {
        const glued = /^(.+?\d)([aens])$/i.exec(core.join('-'));
        if (glued !== null) {
            channel = glued[2].toLowerCase();
            style = 'glued';
            return { dir, stem: glued[1], channel, lod, style };
        }
    }
    return { dir, stem: core.join('-'), channel, lod, style };
}

/** 读取 GLB 的 JSON chunk 与内嵌图片哈希 */
function parseGlb(file) {
    const data = readFileSync(file);
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF')
        throw new Error(`不是合法的 GLB：${file}`);
    const jsonLength = data.readUInt32LE(12);
    const json = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));

    let bin = Buffer.alloc(0);
    const binHeader = 20 + jsonLength;
    if (binHeader + 8 <= data.length) {
        const binLength = data.readUInt32LE(binHeader);
        bin = data.subarray(binHeader + 8, binHeader + 8 + binLength);
    }

    const imageHashes = (json.images ?? []).map(image => {
        if (image.bufferView === undefined)
            return null;
        const view = json.bufferViews[image.bufferView];
        const start = view.byteOffset ?? 0;
        const bytes = bin.subarray(start, start + view.byteLength);
        return createHash('md5').update(bytes).digest('hex');
    });

    return { json, imageHashes };
}

// ---------------------------------------------------------------- 建索引

const allPngs = walkFiles(MODELS_DIR).filter(f => /\.png$/i.test(f));
const pngByHash = new Map();
const pngByKey = new Map();   // `${dir}/${stem}/${style}` → { n: [...], e: [...], s: [...] }
/** 相对路径 → 是否已经存在于仓库内（false 表示只在 --extra-root 里） */
const inRepo = new Set();

function indexTexture(rel, abs, fromExtra) {
    const hash = createHash('md5').update(readFileSync(abs)).digest('hex');
    if (!pngByHash.has(hash))
        pngByHash.set(hash, []);
    pngByHash.get(hash).push(rel);

    const { dir, stem, channel, lod, style } = parseTextureName(rel);
    if (channel === null || channel === 'a')
        return;
    const key = `${dir}/${stem}/${style}`;
    if (!pngByKey.has(key))
        pngByKey.set(key, {});
    const bucket = pngByKey.get(key);
    if (bucket[channel] === undefined)
        bucket[channel] = [];
    bucket[channel].push({ rel, lod, fromExtra });
}

for (const file of allPngs) {
    const rel = toPosix(relative(MODELS_DIR, file));
    inRepo.add(rel);
    indexTexture(rel, file, false);
}
if (EXTRA_ROOT !== null && existsSync(EXTRA_ROOT)) {
    for (const file of walkFiles(EXTRA_ROOT).filter(f => /\.png$/i.test(f))) {
        const rel = toPosix(relative(EXTRA_ROOT, file));
        if (inRepo.has(rel))
            continue;      // 仓库里已有同名同路径的文件，以仓库为准
        indexTexture(rel, file, true);
    }
}

/** 兜底优先级：无 LOD 标记 > lod0 > `lod`（含义不明）> lod1/lod2 */
function lodRank(lod) {
    if (lod === null)
        return 0;
    if (lod === 'lod0')
        return 1;
    if (lod === 'lod')
        return 2;
    return 3;
}

/**
 * 在同一目录/词干/命名家族里挑某个通道的贴图。
 * 优先挑与底色图**同一个 LOD 层级**的（GLB 内嵌的那张底色属于哪层，通道图就跟着哪层），
 * 这样法线/高光的细节密度和底色才一致。
 */
function pickChannel(dir, stem, style, channel, albedoLod) {
    const bucket = pngByKey.get(`${dir}/${stem}/${style}`)?.[channel];
    if (bucket === undefined || bucket.length === 0)
        return null;
    return [...bucket].sort((a, b) =>
        (a.fromExtra ? 1 : 0) - (b.fromExtra ? 1 : 0)   // 仓库里已有的优先，别没事去备份里翻
        || (a.lod === albedoLod ? 0 : 1) - (b.lod === albedoLod ? 0 : 1)
        || lodRank(a.lod) - lodRank(b.lod)
        || a.rel.length - b.rel.length,
    )[0].rel;
}

// ---------------------------------------------------------------- 生成映射

const glbFiles = walkFiles(MODELS_DIR).filter(f => /\.glb$/i.test(f)).sort();
const mapping = [];

if (FROM_MAPPING) {
    if (!existsSync(MAPPING_PATH))
        throw new Error(`缺少 ${MAPPING_PATH}，无法从旧映射生成`);
    for (const entry of JSON.parse(readFileSync(MAPPING_PATH, 'utf8')).entries)
        mapping.push(entry);
}
else {
    for (const file of glbFiles) {
        const glbName = file.replace(/\\/g, '/').split('/').pop().replace(/\.glb$/i, '');
        const { json, imageHashes } = parseGlb(file);
        const textures = json.textures ?? [];

        for (const material of json.materials ?? []) {
            const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
            if (textureIndex === undefined)
                continue;
            const source = textures[textureIndex]?.source;
            const hash = source === undefined ? null : imageHashes[source];
            const candidates = hash === null ? [] : (pngByHash.get(hash) ?? []);
            if (candidates.length === 0) {
                mapping.push({ glb: glbName, material: material.name ?? '', albedo: null, stem: null, dir: null, normal: null, emissive: null, spec: null });
                continue;
            }
            // 同一张图可能被复制到多个目录：优先仓库里已有的那份，其次取路径最短的
            const albedo = [...candidates].sort((a, b) =>
                (inRepo.has(b) ? 1 : 0) - (inRepo.has(a) ? 1 : 0) || a.length - b.length,
            )[0];
            const { dir, stem, channel, lod, style } = parseTextureName(albedo);
            const isAlbedo = channel === 'a';
            mapping.push({
                glb: glbName,
                material: material.name ?? '',
                albedo,
                stem: isAlbedo ? stem : null,
                dir,
                normal: isAlbedo ? pickChannel(dir, stem, style, 'n', lod) : null,
                emissive: isAlbedo ? pickChannel(dir, stem, style, 'e', lod) : null,
                spec: isAlbedo ? pickChannel(dir, stem, style, 's', lod) : null,
            });
        }
    }
    const unresolved = mapping.filter(e => e.stem === null && e.albedo === null && e.material !== '').length;
    if (unresolved > 0) {
        const total = mapping.filter(e => e.material !== '').length;
        // `-a` 源图被清理掉之后，哈希比对会大面积失配；此时绝不能覆盖已有的好映射。
        // 用 `--extra-root <备份目录>` 把素材池挂进来可以正常生成，返回码 2 表示「有文件需要恢复」。
        if (unresolved / Math.max(1, total) > 0.3 && EXTRA_ROOT === null) {
            console.error(`超过 ${Math.round((unresolved / total) * 100)}% 的材质在磁盘上找不到对应的底色 PNG。`);
            console.error('如果贴图已经清理过，请加 --extra-root <备份目录>，或改用 --from-mapping。');
            process.exit(1);
        }
    }
    writeFileSync(MAPPING_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: mapping }, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------- 报告

const withAny = mapping.filter(e => e.normal || e.emissive || e.spec);
const referenced = new Set();
for (const e of mapping) {
    for (const key of ['normal', 'emissive', 'spec'])
        if (e[key] !== null && e[key] !== undefined)
            referenced.add(e[key]);
}
const stats = {
    glb: glbFiles.length,
    materials: mapping.length,
    materialsWithMaps: withAny.length,
    normal: mapping.filter(e => e.normal).length,
    emissive: mapping.filter(e => e.emissive).length,
    spec: mapping.filter(e => e.spec).length,
    referencedPngs: referenced.size,
    referencedBytes: 0,
};
for (const rel of referenced) {
    try {
        stats.referencedBytes += statSync(join(MODELS_DIR, rel)).size;
    }
    catch { /* 文件可能已移走 */ }
}

/** 映射引用了、但仓库里还没有的文件（只在 --extra-root 里存在时需要搬回来） */
const needRestore = [...referenced].filter(rel => !inRepo.has(rel)).sort();
stats.needRestore = needRestore.length;

if (REPORT_ONLY) {
    console.log(JSON.stringify(stats, null, 2));
    process.exit(0);
}

// ---------------------------------------------------------------- 写 manifest

const usable = mapping.filter(e => e.normal !== null || e.emissive !== null || e.spec !== null);
const lines = [];
lines.push('/**');
lines.push(' * 材质贴图清单（**自动生成，请勿手改**）');
lines.push(' *');
lines.push(' * 由 `node scripts/gen-texture-manifest.mjs` 从 `scripts/texture-mapping.json` 生成：');
lines.push(' * GLB 的底色图（内嵌）与磁盘 PNG 做 MD5 比对，锚定材质 → 再由文件名词干找同组');
lines.push(' * `-n`（法线）/ `-e`（自发光）/ `-s`（spec-gloss）三张贴图。');
lines.push(' *');
lines.push(' * 键格式：`<模型名>::<材质名>`，与 GLTFLoader 赋给材质的 `name` 一致。');
lines.push(' */');
lines.push('');
lines.push('/** 单个材质可用的外部通道贴图（webpack 产出的 URL） */');
lines.push('export interface MaterialMapUrls {');
lines.push('    /** 法线图（切线空间，绿通道朝上） */');
lines.push('    readonly normal?: string;');
lines.push('    /** 自发光图 */');
lines.push('    readonly emissive?: string;');
lines.push('    /** Unity spec-gloss：RGB=高光色，A=光滑度 */');
lines.push('    readonly spec?: string;');
lines.push('}');
lines.push('');
lines.push('export const materialMapUrls: Readonly<Record<string, MaterialMapUrls>> = {');
for (const entry of usable) {
    const fields = [];
    for (const [field, key] of [['normal', 'normal'], ['emissive', 'emissive'], ['spec', 'spec']]) {
        const rel = entry[key];
        if (rel === null || rel === undefined)
            continue;
        fields.push(`        ${field}: require('../assets/icons/models/${rel}'),`);
    }
    lines.push(`    ${JSON.stringify(`${entry.glb}::${entry.material}`)}: {`);
    lines.push(...fields);
    lines.push('    },');
}
lines.push('};');
lines.push('');
lines.push('/** 清单中全部会加载的贴图（供测试与清理脚本核对） */');
lines.push('export const manifestTextureFiles: readonly string[] = [');
const uniqueRefs = [...referenced].sort();
for (const rel of uniqueRefs)
    lines.push(`    ${JSON.stringify(`assets/icons/models/${rel}`)},`);
lines.push('];');
lines.push('');

mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, `${lines.join('\n')}`, 'utf8');

stats.manifestEntries = usable.length;
stats.manifestTextureFiles = uniqueRefs.length;
console.log(JSON.stringify(stats, null, 2));

if (needRestore.length > 0) {
    console.log('\n以下贴图被映射引用、但仓库里还不存在，需要从 --extra-root 目录复制回来：');
    for (const rel of needRestore)
        console.log(`  ${rel}`);
    process.exitCode = 2;
}
