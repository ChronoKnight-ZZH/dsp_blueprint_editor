import { readFileSync, readdirSync } from "node:fs";

const dir = "dist/js";
const file = readdirSync(dir).find((n) => /^index\..*\.js$/.test(n));
const s = readFileSync(`${dir}/${file}`, "utf8");
console.log("bundle:", file, "length:", s.length);
for (const p of ["BASE_URL", "dsp_blueprint_editor/", "basis/", "typeof process", "process.env"]) {
    let count = 0;
    let idx = 0;
    while ((idx = s.indexOf(p, idx)) >= 0) { count++; idx += p.length; }
    console.log(String(p).padEnd(24), count);
}
const i = s.indexOf("basis/");
console.log("\n--- context around first 'basis/' ---");
console.log(s.slice(Math.max(0, i - 500), i + 260));
const j = s.indexOf("dsp_blueprint_editor/");
console.log("\n--- context around first 'dsp_blueprint_editor/' ---");
console.log(s.slice(Math.max(0, j - 300), j + 300));
