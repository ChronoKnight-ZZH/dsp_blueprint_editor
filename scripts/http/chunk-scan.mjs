import { readFileSync, readdirSync, statSync } from "node:fs";

const dir = "dist/js";
for (const f of readdirSync(dir)) {
    if (!/\.js$/.test(f)) continue;
    const s = readFileSync(`${dir}/${f}`, "utf8");
    const hits = [];
    for (const p of ["basis/", "__DSP_TRANSCODER_BASE__", "dsp_blueprint_editor/basis"]) {
        let n = 0, i = 0;
        while ((i = s.indexOf(p, i)) >= 0) { n++; i += p.length; }
        if (n) hits.push(`${p}×${n}`);
    }
    if (hits.length) console.log(f.padEnd(28), (statSync(`${dir}/${f}`).size / 1024).toFixed(0) + "KB", hits.join(" "));
}
