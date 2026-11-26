import { readFileSync, readdirSync } from "node:fs";

const probes = ["还没有注册渲染器", "转码器初始化失败", "ktx2-loader", "setKTX2Loader", "renderer.js"];
for (const f of readdirSync("dist/js")) {
    if (!/\.js$/.test(f)) continue;
    const s = readFileSync(`dist/js/${f}`, "utf8");
    const found = probes.filter((p) => s.includes(p));
    console.log(f.padEnd(30), found.join(" | ") || "-");
}
const idx = readdirSync("dist/js").find((n) => /^index\./.test(n));
const s = readFileSync(`dist/js/${idx}`, "utf8");
const i = s.indexOf("还没有注册渲染器");
console.log("\n--- index context ---");
console.log(i < 0 ? "(not found)" : s.slice(Math.max(0, i - 600), i + 400));
