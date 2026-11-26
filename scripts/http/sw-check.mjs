import { readFileSync } from "node:fs";

const sw = readFileSync("dist/service-worker.js", "utf8");
const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
console.log("precache entries:", urls.length);
const byExt = new Map();
let totalHint = 0;
for (const u of urls) {
    const ext = (u.match(/\.([a-z0-9]+)$/i) ?? [, "?"])[1].toLowerCase();
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
}
for (const [ext, n] of [...byExt].sort((a, b) => b[1] - a[1])) console.log(`  ${ext.padEnd(6)} ${n}`);

// 检查是否有 runtimeCaching / 特殊路由
console.log("\nruntimeCaching 关键字:", /runtimeCaching/.test(sw));
console.log("NetworkFirst:", /NetworkFirst/.test(sw));
console.log("maximumFileSizeToCacheInBytes 出现:", /maximumFileSize/.test(sw));
void totalHint;
