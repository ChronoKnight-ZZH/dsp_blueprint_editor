// 只读体检：确认 GLB 是否真的已经 KTX2 化、体积多少、扩展声明是否正确。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const MODELS = "src/assets/icons/models";
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

function readGlb(file) {
    const buf = readFileSync(file);
    let offset = 12;
    let json = null;
    let bin = null;
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt32LE(offset);
        const type = buf.readUInt32LE(offset + 4);
        const body = buf.subarray(offset + 8, offset + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
        else if (type === 0x004e4942) bin = body;
        offset += 8 + len + ((4 - (len % 4)) % 4);
    }
    return { size: buf.length, json, bin };
}

const files = readdirSync(MODELS).filter((f) => /\.glb$/i.test(f)).sort();
const rows = [];
let total = 0;
const problems = [];

for (const f of files) {
    const name = f.replace(/\.glb$/i, "");
    const { size, json, bin } = readGlb(join(MODELS, f));
    total += size;
    const images = json.images ?? [];
    const used = json.extensionsUsed ?? [];
    const required = json.extensionsRequired ?? [];
    const mimes = [...new Set(images.map((i) => i.mimeType ?? (i.uri ? `uri:${i.uri}` : "-")))];

    // 每个 image 的 bufferView 是否真是 KTX2 头
    let magicOk = 0;
    let magicBad = 0;
    for (const [i, img] of images.entries()) {
        if (img.bufferView === undefined) continue;
        const bv = json.bufferViews?.[img.bufferView];
        const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
        const ok = KTX2_ID.every((v, k) => bytes[k] === v);
        if (ok) magicOk++;
        else {
            magicBad++;
            problems.push(`${name}: images[${i}] 魔数不是 KTX2 (${img.mimeType})`);
        }
    }
    if (images.length > 0 && !required.includes("KHR_texture_basisu"))
        problems.push(`${name}: 有图但 extensionsRequired 缺 KHR_texture_basisu`);
    for (const b of json.buffers ?? []) if (b.uri) problems.push(`${name}: buffer 外链 ${b.uri}`);
    for (const img of images) if (img.uri) problems.push(`${name}: image 外链 ${img.uri}`);

    // 材质贴图槽统计
    const mats = json.materials ?? [];
    let slots = { base: 0, normal: 0, emissive: 0, mr: 0, occ: 0 };
    let legacyIndex = 0;
    for (const m of mats) {
        const check = (info) => {
            if (!info) return false;
            if (info.extensions?.KHR_texture_basisu?.source === undefined) legacyIndex++;
            return true;
        };
        if (check(m.pbrMetallicRoughness?.baseColorTexture)) slots.base++;
        if (check(m.normalTexture)) slots.normal++;
        if (check(m.emissiveTexture)) slots.emissive++;
        if (check(m.pbrMetallicRoughness?.metallicRoughnessTexture)) slots.mr++;
        if (check(m.occlusionTexture)) slots.occ++;
    }
    if (legacyIndex > 0) problems.push(`${name}: ${legacyIndex} 个贴图槽仍在用旧式 index`);

    rows.push({ name, size, images: images.length, magicOk, magicBad, mimes: mimes.join(","), mats: mats.length, ...slots });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("模型", 34) + pad("KB", 9) + pad("图", 4) + pad("base/ n/ e/ mr", 18) + "mime");
for (const r of rows.sort((a, b) => b.size - a.size)) {
    console.log(
        pad(r.name, 34) +
            pad((r.size / 1024).toFixed(0), 9) +
            pad(r.images, 4) +
            pad(`${r.base}/${r.normal}/${r.emissive}/${r.mr}`, 18) +
            r.mimes
    );
}

console.log(`\n模型 ${rows.length} 个，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log(`有 ktx2 图的模型：${rows.filter((r) => r.magicOk > 0).length} / ${rows.length}`);
console.log(`无图模型：${rows.filter((r) => r.images === 0).map((r) => r.name).join(", ") || "(无)"}`);
console.log(`\n问题 ${problems.length} 条：`);
for (const p of problems.slice(0, 40)) console.log("  - " + p);
