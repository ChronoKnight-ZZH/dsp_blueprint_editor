import { readFileSync } from "node:fs";
const file = process.argv[2];
const buf = readFileSync(file);
let off = 12;
console.log(file, "size", buf.length);
while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const name = type === 0x4e4f534a ? "JSON" : type === 0x004e4942 ? "BIN" : "0x" + type.toString(16);
    console.log(`chunk ${name} len=${len}`);
    if (type === 0x4e4f534a) {
        const json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString("utf8"));
        console.log("  asset:", JSON.stringify(json.asset));
        console.log("  nodes:", json.nodes?.length, "meshes:", json.meshes?.length, "materials:", json.materials?.length, "buffers:", JSON.stringify(json.buffers), "accessors:", json.accessors?.length);
        if (json.nodes?.length) console.log("  node0:", JSON.stringify(json.nodes[0]).slice(0, 200));
        if (json.meshes?.length) console.log("  mesh0 prim0:", JSON.stringify(json.meshes[0].primitives?.[0]).slice(0, 200));
    }
    off += 8 + len + ((4 - (len % 4)) % 4);
}
