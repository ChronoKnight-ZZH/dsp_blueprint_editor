import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "src/assets/icons/models/accumulator.glb";
const buf = readFileSync(file);
let off = 12, json = null, bin = null;
while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
}
console.log("file", file, (buf.length / 1024 / 1024).toFixed(2), "MB");
console.log("extensionsUsed", json.extensionsUsed);
console.log("extensionsRequired", json.extensionsRequired);
console.log("\n--- materials ---");
console.log(JSON.stringify(json.materials?.slice(0, 3), null, 1));
console.log("\n--- textures ---");
console.log(JSON.stringify(json.textures?.slice(0, 3), null, 1));
console.log("\n--- images (no bufferView dump) ---");
console.log(JSON.stringify(json.images, null, 1));

// KTX2 头解析
const SCHEME = { 0: "none", 1: "BasisLZ(ETC1S)", 2: "Zstandard(UASTC)" };
for (const [i, img] of (json.images ?? []).entries()) {
    const bv = json.bufferViews[img.bufferView];
    const b = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const vkFormat = b.readUInt32LE(12);
    const width = b.readUInt32LE(20);
    const height = b.readUInt32LE(24);
    const levelCount = b.readUInt32LE(40);
    const scheme = b.readUInt32LE(44);
    console.log(
        `image[${i}] ${(b.length / 1024).toFixed(0)}KB ${width}x${height} levels=${levelCount} vkFormat=${vkFormat} scheme=${scheme}(${SCHEME[scheme] ?? "?"})`
    );
}
