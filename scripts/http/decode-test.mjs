/**
 * 真解码验证：用项目实际发货的 basis_transcoder.wasm，把 GLB 里的 KTX2 贴图转成 RGBA32。
 * 这一步能证明「UASTC + zstd 超压缩」在本项目的转码器里真的能解开，
 * 而不只是文件头看起来对。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");

const BASIS = require(resolve(ROOT, "public/basis/basis_transcoder.js"));
const wasmBinary = readFileSync(resolve(ROOT, "public/basis/basis_transcoder.wasm"));

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

function imagesOf(glbPath) {
    const buf = readFileSync(glbPath);
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
        else if (type === 0x004e4942) bin = body;
        off += 8 + len + ((4 - (len % 4)) % 4);
    }
    return (json.images ?? []).map((img) => {
        const bv = json.bufferViews[img.bufferView];
        const start = bv.byteOffset ?? 0;
        return {
            name: img.name ?? `image#${img.bufferView}`,
            bytes: bin.subarray(start, start + bv.byteLength),
        };
    });
}

const mod = await BASIS({ wasmBinary });
mod.initializeBasis();
console.log("转码器已初始化，KTX2File 可用:", typeof mod.KTX2File === "function");

const targets = [
    "accumulator",
    "mining-drill-mk2",
    "turret-plasma",
    "smelter-2",
    "inserter-1",
];

let pass = 0;
let fail = 0;

for (const model of targets) {
    const glb = resolve(ROOT, "src/assets/icons/models", `${model}.glb`);
    const images = imagesOf(glb);
    console.log(`\n=== ${model} (${images.length} 张) ===`);
    for (const image of images) {
        const bytes = new Uint8Array(image.bytes);
        if (!KTX2_ID.every((v, k) => bytes[k] === v)) {
            console.log(`  ✘ ${image.name}: 不是 KTX2`);
            fail++;
            continue;
        }
        let file;
        try {
            file = new mod.KTX2File(bytes);
            if (!file.isValid()) throw new Error("isValid() = false");
            const scheme = image.bytes.readUInt32LE(44);
            const w = file.getWidth();
            const h = file.getHeight();
            const levels = file.getLevels();
            const uastc = file.isUASTC();
            if (!file.startTranscoding()) throw new Error("startTranscoding() 失败");
            const size = file.getImageTranscodedSizeInBytes(0, 0, 0, 13 /* RGBA32 */);
            const dst = new Uint8Array(size);
            const status = file.transcodeImage(dst, 0, 0, 0, 13, 0, -1, -1);
            if (status === 0) throw new Error("transcodeImage() 返回 0");

            // 解码结果合理性：RGBA32 应等于 w*h*4，且不是一片纯零
            let nonZero = 0;
            for (let i = 0; i < dst.length; i += 997) if (dst[i] !== 0) nonZero++;
            const uniform = nonZero === 0;
            if (size !== w * h * 4) throw new Error(`RGBA32 尺寸异常 ${size} ≠ ${w * h * 4}`);
            if (uniform) throw new Error("解码结果全零");

            console.log(
                `  ✔ ${image.name.padEnd(28)} ${w}x${h} L=${levels} ${uastc ? "UASTC" : "ETC1S"} scheme=${scheme} → RGBA32 ${(
                    size / 1024 / 1024
                ).toFixed(1)}MB OK`
            );
            pass++;
        } catch (e) {
            console.log(`  ✘ ${image.name}: ${e.message}`);
            fail++;
        } finally {
            try {
                file?.close();
                file?.delete();
            } catch {
                /* 忽略 */
            }
        }
    }
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
