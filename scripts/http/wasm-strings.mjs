import { readFileSync } from "node:fs";

const buf = readFileSync("public/basis/basis_transcoder.wasm");
const runs = [];
let cur = [];
for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) cur.push(c);
    else {
        if (cur.length >= 6) runs.push(Buffer.from(cur).toString("latin1"));
        cur = [];
    }
}
if (cur.length >= 6) runs.push(Buffer.from(cur).toString("latin1"));

console.log("printable runs:", runs.length);
const pats = ["zstd", "Zstd", "ZSTD", "Zstandard", "supercompression", "Supercompression", "supercompress", "Corruption", "corruption", "Restart", "Src size", "Huff", "KTX2", "basisu"];
for (const p of pats) {
    const hits = runs.filter((r) => r.includes(p));
    console.log(`${p.padEnd(18)} runs=${hits.length}`);
    for (const h of hits.slice(0, 3)) console.log("    " + h.slice(0, 120));
}
