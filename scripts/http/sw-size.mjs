import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const sw = readFileSync("dist/service-worker.js", "utf8");
const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
let total = 0;
const perExt = new Map();
const missing = [];
for (const u of urls) {
    const rel = u.replace("/dsp_blueprint_editor/", "");
    const file = join("dist", rel);
    let size = 0;
    try {
        size = statSync(file).size;
    } catch {
        missing.push(rel);
    }
    total += size;
    const ext = (rel.match(/\.([a-z0-9]+)$/i) ?? [, "?"])[1];
    perExt.set(ext, (perExt.get(ext) ?? 0) + size);
}
console.log(`precache 条目 ${urls.length}，合计 ${(total / 1024 / 1024).toFixed(1)} MB`);
for (const [ext, size] of [...perExt].sort((a, b) => b[1] - a[1]))
    console.log(`  ${ext.padEnd(5)} ${(size / 1024 / 1024).toFixed(1)} MB`);
if (missing.length) console.log("缺失文件:", missing);

// GLB 是否因 2MB 默认上限被跳过
const all = readFileSync("dist/service-worker.js", "utf8");
const glbCount = (all.match(/\.glb"/g) ?? []).length;
console.log(`\nprecached GLB: ${glbCount}（dist/models 共 73 个）`);
