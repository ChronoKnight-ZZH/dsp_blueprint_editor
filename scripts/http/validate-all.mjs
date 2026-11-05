/**
 * 全量结构校验：73 个 GLB 是否能被 GLTFLoader + KTX2Loader 正确解析。
 * 只读，不修改任何文件。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MODELS = "src/assets/icons/models";
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
/** glTF 槽位 → 期望的编码（1=BasisLZ/ETC1S，2=UASTC+zstd） */
const EXPECT = { baseColor: 1, emissive: 1, normal: 2, mr: 2, occlusion: 2 };

function readGlb(file) {
    const buf = readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("magic 不是 glTF");
    const version = buf.readUInt32LE(4);
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
        else if (type === 0x004e4942) bin = body;
        off += 8 + len + ((4 - (len % 4)) % 4);
    }
    return { buf, version, json, bin };
}

const problems = [];
const warn = [];
const stats = { models: 0, ktx2: 0, etc1s: 0, uastc: 0, slots: 0, px: 0 };

function schemeOf(json, bin, imageIndex) {
    const img = json.images?.[imageIndex];
    if (!img || img.bufferView === undefined) return null;
    const bv = json.bufferViews?.[img.bufferView];
    if (!bv) return null;
    const start = bv.byteOffset ?? 0;
    if (start + bv.byteLength > bin.length) return "OUT_OF_RANGE";
    const b = bin.subarray(start, start + bv.byteLength);
    if (!KTX2_ID.every((v, k) => b[k] === v)) return "BAD_MAGIC";
    return {
        scheme: b.readUInt32LE(44),
        levels: b.readUInt32LE(40),
        width: b.readUInt32LE(20),
        height: b.readUInt32LE(24),
        vkFormat: b.readUInt32LE(12),
        bytes: b.length,
    };
}

for (const f of readdirSync(MODELS).filter((x) => /\.glb$/i.test(x)).sort()) {
    const name = f.replace(/\.glb$/i, "");
    let parsed;
    try {
        parsed = readGlb(join(MODELS, f));
    } catch (e) {
        problems.push(`${name}: 读取失败 ${e.message}`);
        continue;
    }
    const { json, bin } = parsed;
    stats.models++;
    if (parsed.version !== 2) problems.push(`${name}: glTF version=${parsed.version}`);
    if (!bin) problems.push(`${name}: 没有 BIN chunk`);
    const buffer = json.buffers?.[0];
    if (buffer && bin && buffer.byteLength > bin.length)
        problems.push(`${name}: buffer.byteLength ${buffer.byteLength} > BIN ${bin.length}`);

    const textures = json.textures ?? [];
    const images = json.images ?? [];
    const cache = new Map();
    const infoOf = (i) => {
        if (!cache.has(i)) cache.set(i, schemeOf(json, bin, i));
        return cache.get(i);
    };

    // --- 每个 texture 必须有可用的 source（核心或扩展）
    for (const [ti, tex] of textures.entries()) {
        const extSource = tex.extensions?.KHR_texture_basisu?.source;
        const coreSource = tex.source;
        if (extSource === undefined && coreSource === undefined) {
            problems.push(`${name}: textures[${ti}] 没有任何 source`);
            continue;
        }
        const srcIndex = extSource ?? coreSource;
        if (srcIndex >= images.length) {
            problems.push(`${name}: textures[${ti}].source=${srcIndex} 越界`);
            continue;
        }
        const info = infoOf(srcIndex);
        if (typeof info === "string") {
            problems.push(`${name}: images[${srcIndex}] ${info}`);
            continue;
        }
        if (info.vkFormat !== 0 && info.vkFormat !== 37)
            problems.push(`${name}: images[${srcIndex}] vkFormat=${info.vkFormat}（Basis 应为 0）`);
        stats.ktx2++;
    }

    // --- 材质槽位：编码是否符合「颜色 ETC1S / 数据 UASTC」
    const slotDefs = [
        ["baseColor", (m) => m.pbrMetallicRoughness?.baseColorTexture],
        ["emissive", (m) => m.emissiveTexture],
        ["normal", (m) => m.normalTexture],
        ["mr", (m) => m.pbrMetallicRoughness?.metallicRoughnessTexture],
        ["occlusion", (m) => m.occlusionTexture],
    ];
    for (const mat of json.materials ?? []) {
        for (const [slot, pick] of slotDefs) {
            const info = pick(mat);
            if (!info) continue;
            stats.slots++;
            const tex = textures[info.index];
            if (!tex) {
                problems.push(`${name}::${mat.name}: ${slot} index=${info.index} 越界`);
                continue;
            }
            const srcIndex = tex.extensions?.KHR_texture_basisu?.source ?? tex.source;
            const ktx = infoOf(srcIndex);
            if (typeof ktx === "string") continue;
            const expected = EXPECT[slot];
            if (ktx.scheme !== expected)
                problems.push(
                    `${name}::${mat.name}: ${slot} 用 ${ktx.scheme === 1 ? "ETC1S" : ktx.scheme === 2 ? "UASTC" : `scheme${ktx.scheme}`}，期望 ${expected === 1 ? "ETC1S" : "UASTC"}`
                );
            if (ktx.scheme === 1) stats.etc1s++;
            else stats.uastc++;
            // mip 层数是否合理（log2(max(w,h)) + 1）
            const maxDim = Math.max(ktx.width, ktx.height);
            const expectLevels = Math.floor(Math.log2(maxDim)) + 1;
            if (ktx.levels !== expectLevels)
                warn.push(`${name}::${mat.name}: ${slot} ${ktx.width}x${ktx.height} levels=${ktx.levels}（完整 mip 链应为 ${expectLevels}）`);
            if (ktx.width % 4 !== 0 || ktx.height % 4 !== 0)
                warn.push(`${name}::${mat.name}: ${slot} 尺寸 ${ktx.width}x${ktx.height} 不是 4 的倍数`);
        }
    }

    // --- accessor / bufferView 边界
    for (const [bvi, bv] of (json.bufferViews ?? []).entries()) {
        const start = bv.byteOffset ?? 0;
        if (start + bv.byteLength > bin.length)
            problems.push(`${name}: bufferViews[${bvi}] 越界 (${start}+${bv.byteLength} > ${bin.length})`);
    }
    for (const [ai, acc] of (json.accessors ?? []).entries()) {
        if (acc.bufferView === undefined) continue;
        const bv = json.bufferViews?.[acc.bufferView];
        if (!bv) {
            problems.push(`${name}: accessors[${ai}] 引用了不存在的 bufferView`);
            continue;
        }
        const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] ?? 0;
        const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type] ?? 0;
        const stride = bv.byteStride ?? compSize * numComp;
        const need = stride * (acc.count - 1) + compSize * numComp;
        if ((acc.byteOffset ?? 0) + need > bv.byteLength)
            problems.push(`${name}: accessors[${ai}] 超出 bufferView（${need} > ${bv.byteLength}）`);
    }
}

console.log(`模型 ${stats.models} 个，KTX2 贴图 ${stats.ktx2} 张（ETC1S ${stats.etc1s} / UASTC ${stats.uastc}），槽位引用 ${stats.slots} 处`);
console.log(`\n严重问题 ${problems.length} 条：`);
for (const p of problems.slice(0, 40)) console.log("  ✘ " + p);
console.log(`\n警告 ${warn.length} 条：`);
for (const w of warn.slice(0, 15)) console.log("  ! " + w);
if (warn.length > 15) console.log(`  ... 共 ${warn.length} 条`);
