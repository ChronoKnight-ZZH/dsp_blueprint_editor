/** 估算各模型的显存占用（按转码后的 GPU 格式，含 mip 链） */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MODELS = "src/assets/icons/models";
// GPU 端每像素字节数：ETC1S→ETC2_RGB(0.5B/px，带 alpha 时 1B/px)；UASTC→BC7/ASTC(1B/px)
const BPP = { 1: 0.5, 2: 1 };
const MIP_FACTOR = 4 / 3;

function readGlb(file) {
    const buf = readFileSync(file);
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
        else if (type === 0x004e4942) bin = body;
        off += 8 + len + ((4 - (len % 4)) % 4);
    }
    return { json, bin };
}

let totalBytes = 0, totalVram = 0;
const rows = [];
for (const f of readdirSync(MODELS).filter((x) => /\.glb$/i.test(x))) {
    const { json, bin } = readGlb(join(MODELS, f));
    let vram = 0, count = 0, maxDim = 0;
    for (const img of json.images ?? []) {
        const bv = json.bufferViews[img.bufferView];
        const b = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
        const scheme = b.readUInt32LE(44);
        const w = b.readUInt32LE(20), h = b.readUInt32LE(24);
        vram += w * h * (BPP[scheme] ?? 1) * MIP_FACTOR;
        count++;
        maxDim = Math.max(maxDim, w, h);
    }
    totalBytes += readFileSync(join(MODELS, f)).length;
    totalVram += vram;
    rows.push({ name: f.replace(/\.glb$/, ""), count, maxDim, vram: vram / 1024 / 1024 });
}

rows.sort((a, b) => b.vram - a.vram);
console.log("显存占用 Top 12（含 mip）:");
for (const r of rows.slice(0, 12))
    console.log(`  ${r.name.padEnd(30)} ${String(r.count).padStart(2)}张 最大${r.maxDim}px  ${r.vram.toFixed(1)} MB`);
console.log(`\n全部 ${rows.length} 个模型：下载 ${(totalBytes / 1024 / 1024).toFixed(1)} MB，显存约 ${(totalVram / 1024 / 1024).toFixed(0)} MB`);
console.log(`平均每个模型：下载 ${(totalBytes / 1024 / 1024 / rows.length).toFixed(2)} MB，显存 ${(totalVram / 1024 / 1024 / rows.length).toFixed(1)} MB`);
