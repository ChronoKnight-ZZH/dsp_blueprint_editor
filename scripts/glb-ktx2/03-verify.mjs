#!/usr/bin/env node
/**
 * 阶段 3/3：校验 KTX2 产物，可选回写源码目录。
 *
 * 校验项（任一不过就以非 0 退出，别急着删源图）：
 *  1. `extensionsRequired` 含 `KHR_texture_basisu`（只要文件里有 ktx2 就必须声明）；
 *  2. 所有 `images[]` 的 `mimeType` 为 `image/ktx2`，且没有外链 `uri`；
 *  3. 每个 `images[].bufferView` 的数据以 KTX2 魔数开头
 *     （`AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A`）——防止「扩展声明了但字节还是 PNG」；
 *  4. 每个材质的每个贴图槽 → `textures[index]` → `extensions.KHR_texture_basisu.source`
 *     （basisu 声明在 `textures[]` 上，材质 textureInfo 保持普通 `index` 才是规范写法）；
 *  5. `buffers[]` 无外链 `uri`（自包含）；
 *  6. 对照 `texture-mapping.json`：清单里声明有 normal/emissive/spec 的材质，
 *     产物里必须仍然挂着对应槽位（防「编码把槽丢了」）。
 *
 * 用法：
 *   node scripts/glb-ktx2/03-verify.mjs                    # 只校验
 *   node scripts/glb-ktx2/03-verify.mjs --apply            # 校验通过后回写 src/（自动备份）
 */

import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SRC_DIR = join(ROOT, "src", "assets", "icons", "models");
const IN_DIR = join(ROOT, "temp", "ktx2", "01-embedded");
const OUT_DIR = join(ROOT, "temp", "ktx2", "02-ktx2");
const BACKUP_DIR = join(ROOT, "temp", "ktx2", "backup-original");
const MAPPING_FILE = join(ROOT, "tests", "unit", "scripts", "texture-mapping.json");

const APPLY = process.argv.includes("--apply");

/** KTX2 文件头标识（12 字节） */
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

const SLOTS = [
    "baseColorTexture",
    "normalTexture",
    "emissiveTexture",
    "metallicRoughnessTexture",
    "occlusionTexture",
];

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ---------------------------------------------------------------- GLB 解析

/** 极简 GLB 读取：返回 JSON chunk 与 BIN chunk（不依赖 three / gltf-transform） */
function readGlb(buffer) {
    if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("不是 GLB（magic 不匹配）");
    const version = buffer.readUInt32LE(4);
    let offset = 12;
    let json = null;
    let bin = null;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32LE(offset);
        const type = buffer.readUInt32LE(offset + 4);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
        else if (type === 0x004e4942) bin = body;
        offset += 8 + length + ((4 - (length % 4)) % 4);
    }
    if (json === null) throw new Error("缺少 JSON chunk");
    return { version, json, bin };
}

function imageBytes(json, bin, index) {
    const image = json.images?.[index];
    if (image === undefined) return null;
    if (image.bufferView === undefined) return null;
    const view = json.bufferViews?.[image.bufferView];
    if (view === undefined || bin === null) return null;
    return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

function hasKtx2Magic(bytes) {
    if (bytes === null || bytes.length < KTX2_ID.length) return false;
    return KTX2_ID.every((value, i) => bytes[i] === value);
}

/** baseColor / metallicRoughness 挂在 pbrMetallicRoughness 下，其余在材质顶层 */
function slotInfo(material, slot) {
    return slot === "baseColorTexture" || slot === "metallicRoughnessTexture"
        ? material.pbrMetallicRoughness?.[slot]
        : material[slot];
}

// ---------------------------------------------------------------- 单文件校验

async function verifyModel(model, expected) {
    const path = join(OUT_DIR, `${model}.glb`);
    const problems = [];
    const stats = {};

    const buffer = await readFile(path);
    const { json, bin } = readGlb(buffer);

    const images = json.images ?? [];
    const textures = json.textures ?? [];
    stats.images = images.length;
    stats.bytes = buffer.length;

    // 2) 图片格式 / 外链
    for (const [i, image] of images.entries()) {
        if (image.uri !== undefined) {
            problems.push(`images[${i}] 仍引用外部文件：${image.uri}`);
            continue;
        }
        if (image.mimeType !== "image/ktx2") {
            problems.push(`images[${i}] mimeType=${image.mimeType ?? "(空)"}，期望 image/ktx2`);
            continue;
        }
        // 3) 魔数
        const bytes = imageBytes(json, bin, i);
        if (bytes === null) {
            problems.push(`images[${i}] 没有可读的 bufferView`);
        } else if (!hasKtx2Magic(bytes)) {
            problems.push(`images[${i}] 字节不是 KTX2（魔数不符），可能仍是 PNG`);
        } else {
            stats.ktx2Bytes = (stats.ktx2Bytes ?? 0) + bytes.length;
        }
    }

    // 1) 扩展声明
    const required = json.extensionsRequired ?? [];
    const used = json.extensionsUsed ?? [];
    if (images.length > 0) {
        if (!used.includes("KHR_texture_basisu")) {
            problems.push("extensionsUsed 缺少 KHR_texture_basisu");
        }
        if (!required.includes("KHR_texture_basisu")) {
            problems.push("extensionsRequired 缺少 KHR_texture_basisu（客户端会静默不加载贴图）");
        }
    }
    stats.extensions = used.join(",");

    // 5) buffer 自包含
    for (const [i, b] of (json.buffers ?? []).entries()) {
        if (b.uri !== undefined) problems.push(`buffers[${i}] 引用外部文件：${b.uri}`);
    }

    // 4) 槽位 → textures[index] → KHR_texture_basisu.source
    const materials = json.materials ?? [];
    const byName = new Map();
    for (const material of materials) byName.set(material.name ?? "", material);

    for (const material of materials) {
        for (const slot of SLOTS) {
            const info = slotInfo(material, slot);
            if (info === undefined) continue;
            const label = `材质 ${material.name ?? "(无名)"} 的 ${slot}`;
            const texture = textures[info.index];
            if (texture === undefined) {
                problems.push(`${label} 的 index=${info.index ?? "(空)"} 越界`);
                continue;
            }
            const imageIndex = texture.extensions?.KHR_texture_basisu?.source;
            if (imageIndex === undefined) {
                problems.push(
                    `${label} 指向 textures[${info.index}]，该贴图未声明 KHR_texture_basisu`
                );
                continue;
            }
            if (!hasKtx2Magic(imageBytes(json, bin, imageIndex))) {
                problems.push(`${label} 指向的 image[${imageIndex}] 不是 KTX2`);
            }
        }
    }

    // 6) 对照清单：声明的槽位还在不在
    for (const entry of expected) {
        const material = byName.get(entry.material);
        if (material === undefined) {
            problems.push(`清单材质 ${entry.material} 在产物中不存在`);
            continue;
        }
        if (entry.normal && material.normalTexture === undefined)
            problems.push(`材质 ${entry.material} 丢了 normalTexture`);
        if (entry.emissive && material.emissiveTexture === undefined)
            problems.push(`材质 ${entry.material} 丢了 emissiveTexture`);
        if (entry.spec && material.pbrMetallicRoughness?.metallicRoughnessTexture === undefined)
            problems.push(`材质 ${entry.material} 丢了 metallicRoughnessTexture`);
    }

    return { model, problems, stats };
}

// ---------------------------------------------------------------- 主流程

async function main() {
    for (const dir of [IN_DIR, OUT_DIR]) {
        if (!existsSync(dir)) {
            throw new Error(`缺少目录 ${dir}，先跑阶段 ${dir === IN_DIR ? "1" : "2"}`);
        }
    }

    const mapping = JSON.parse(await readFile(MAPPING_FILE, "utf8"));
    const expectedByModel = new Map();
    for (const entry of mapping.entries ?? []) {
        if (!expectedByModel.has(entry.glb)) expectedByModel.set(entry.glb, []);
        expectedByModel.get(entry.glb).push(entry);
    }

    const models = (await readdir(OUT_DIR))
        .filter((f) => /\.glb$/i.test(f))
        .map((f) => f.replace(/\.glb$/i, ""))
        .sort();

    console.log(`\n[03] 校验 ${models.length} 个产物\n`);

    const rows = [];
    let failed = 0;
    for (const model of models) {
        const expected = expectedByModel.get(model) ?? [];
        try {
            const result = await verifyModel(model, expected);
            const before = (await stat(join(IN_DIR, `${model}.glb`))).size;
            rows.push({ ...result, before });
            if (result.problems.length > 0) failed++;
        } catch (e) {
            rows.push({
                model,
                problems: [`解析失败：${e?.message ?? e}`],
                stats: { bytes: 0 },
                before: 0,
            });
            failed++;
        }
    }

    const sumBefore = rows.reduce((s, r) => s + r.before, 0);
    const sumAfter = rows.reduce((s, r) => s + r.stats.bytes, 0);

    for (const row of rows) {
        const flag = row.problems.length === 0 ? "OK  " : "FAIL";
        const ratio =
            row.before > 0 ? `${((row.stats.bytes / row.before) * 100).toFixed(0)}%` : "-";
        console.log(
            `${flag} ${row.model.padEnd(34)} ` +
                `${String(row.stats.images ?? 0).padStart(2)} 张 ktx2  ` +
                `${mb(row.before).padStart(9)} → ${mb(row.stats.bytes).padStart(9)}  ${ratio.padStart(4)}`
        );
        for (const problem of row.problems.slice(0, 6)) console.log(`     ! ${problem}`);
        if (row.problems.length > 6) console.log(`     ! ...还有 ${row.problems.length - 6} 条`);
    }

    console.log(
        `\n[03] ${rows.length - failed}/${rows.length} 通过；` +
            `GLB ${mb(sumBefore)} → ${mb(sumAfter)}` +
            `（省 ${sumBefore > 0 ? ((1 - sumAfter / sumBefore) * 100).toFixed(1) : 0}%）\n`
    );

    const report = {
        generatedAt: new Date().toISOString(),
        stage: "03-verify",
        passed: rows.length - failed,
        total: rows.length,
        totals: { before: sumBefore, after: sumAfter },
        rows,
    };
    await writeFile(
        join(OUT_DIR, "_verify.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
    );

    if (failed > 0) {
        console.error(`[03] 有 ${failed} 个产物不合格，不要回写源码目录。详见 _verify.json\n`);
        process.exitCode = 1;
        return;
    }

    if (!APPLY) {
        console.log(
            `[03] 全部通过。确认无误后回写源码目录：\n` +
                `     node scripts/glb-ktx2/03-verify.mjs --apply\n` +
                `     （会把 src/assets/icons/models/*.glb 备份到 temp/ktx2/backup-original/）\n`
        );
        return;
    }

    // ------------------------------------------------------------ 回写
    await mkdir(BACKUP_DIR, { recursive: true });
    let written = 0;
    for (const row of rows) {
        const target = join(SRC_DIR, `${row.model}.glb`);
        if (existsSync(target)) {
            await copyFile(target, join(BACKUP_DIR, basename(target)));
        }
        await copyFile(join(OUT_DIR, `${row.model}.glb`), target);
        written++;
    }
    console.log(
        `[03] 已回写 ${written} 个 GLB 到 src/assets/icons/models/\n` +
            `     原文件备份：temp/ktx2/backup-original/（确认无用后可整目录删除）\n` +
            `     下一步：\n` +
            `       1) 跑 copy-basis-transcoder.mjs 把转码器放进 public/basis/\n` +
            `       2) 按 README「前端接入」改 glbLoader / materialTextures\n` +
            `       3) 外部 PNG 暂留（运行期是兜底路径），确认观感无误后再清理\n`
    );
}

main().catch((e) => {
    console.error("[03] 致命错误：", e?.message ?? e);
    process.exitCode = 1;
});
