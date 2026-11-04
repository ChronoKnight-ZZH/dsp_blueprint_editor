#!/usr/bin/env node
/**
 * 把 three 自带的 Basis Universal 转码器拷进 `public/basis/`。
 *
 * 为什么必须拷贝而不是 import：
 *  `KTX2Loader` 在**运行期**用 `fetch()` 拉 `basis_transcoder.js` + `.wasm`，
 *  这两个文件不能走 webpack 的模块图（wasm 需要从 URL 取，且转码器内部自己
 *  new Worker）。所以它们必须作为「静态资源」原样出现在最终 URL 下。
 *
 * 用法：
 *   node scripts/glb-ktx2/copy-basis-transcoder.mjs
 *   node scripts/glb-ktx2/copy-basis-transcoder.mjs --check   # 只检查是否已就位
 */

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** three 是唯一来源：版本必须和 package.json 的 three 完全一致 */
const FROM_DIR = join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis");
const TO_DIR = join(ROOT, "public", "basis");

/** 必须存在且必须同源的两个文件 */
const FILES = ["basis_transcoder.js", "basis_transcoder.wasm"];

const CHECK_ONLY = process.argv.includes("--check");

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function main() {
    if (!existsSync(FROM_DIR)) {
        throw new Error(
            `找不到 three 的转码器目录：${FROM_DIR}\n先 npm i（three 已列在 dependencies）`
        );
    }

    const missing = [];
    for (const file of FILES) {
        if (!existsSync(join(FROM_DIR, file))) missing.push(file);
        if (CHECK_ONLY && !existsSync(join(TO_DIR, file))) missing.push(`public/basis/${file}`);
    }
    if (missing.length > 0) {
        throw new Error(`缺少文件：\n  ${missing.join("\n  ")}`);
    }

    const extra = existsSync(TO_DIR)
        ? (await readdir(TO_DIR)).filter((name) => !FILES.includes(name))
        : [];
    if (extra.length > 0) {
        console.warn(
            `[basis] public/basis 里有额外文件（可能是旧版转码器，建议删掉以免混用）：${extra.join(", ")}`
        );
    }

    if (CHECK_ONLY) {
        console.log(`[basis] 已就位：${TO_DIR.replace(ROOT, ".")}`);
        return;
    }

    await mkdir(TO_DIR, { recursive: true });
    let total = 0;
    for (const file of FILES) {
        const target = join(TO_DIR, file);
        await copyFile(join(FROM_DIR, file), target);
        const size = (await stat(target)).size;
        total += size;
        console.log(`[basis] ${file.padEnd(24)} ${mb(size).padStart(9)} → public/basis/`);
    }

    console.log(
        `\n[basis] 完成，共 ${mb(total)}\n` +
            `        前端路径必须写成 \`\${BASE_URL}basis/\`（末尾带斜杠）：\n` +
            `        本项目 publicPath 是 /dsp_blueprint_editor/，\n` +
            `        所以实际请求 /dsp_blueprint_editor/basis/basis_transcoder.js\n` +
            `        建议把这两个文件提交进仓库（体积小、版本要和 three 对齐）。\n`
    );
}

main().catch((e) => {
    console.error("[basis] 失败：", e?.message ?? e);
    process.exitCode = 1;
});
