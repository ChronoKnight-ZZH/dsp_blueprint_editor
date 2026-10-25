/**
 * 直接从 GLB 二进制里量包围盒，用来验证两个假设：
 *   1. 文件是合法的 glTF 2.0 二进制；
 *   2. 模型是 **y-up**（高度在 y 轴）——这是 buildingModel.buildPlacement 的默认前提。
 *
 * 用法：npx ts-node -O '{"module":"commonjs","types":["node"]}' scripts/inspect-glb.ts
 * 只读文件，不依赖 three / webpack。
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'src', 'assets', 'icons', 'models');

interface JsonChunk {
    meshes?: { primitives: { attributes: Record<string, number> }[] }[];
    accessors?: { min?: number[]; max?: number[]; type?: string }[];
}

function readGlb(file: string) {
    const buf = readFileSync(file);
    const magic = buf.readUInt32LE(0);
    const version = buf.readUInt32LE(4);
    if (magic !== 0x46546c67) throw new Error('不是 GLB（magic 不匹配）');
    let offset = 12;
    let json: JsonChunk | null = null;
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt32LE(offset);
        const type = buf.readUInt32LE(offset + 4);
        const body = buf.subarray(offset + 8, offset + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')) as JsonChunk;
        offset += 8 + len + ((4 - (len % 4)) % 4);
    }
    if (json === null) throw new Error('缺少 JSON chunk');
    return { version, json };
}

function bboxOf(json: JsonChunk) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let found = false;
    for (const mesh of json.meshes ?? []) {
        for (const prim of mesh.primitives ?? []) {
            const idx = prim.attributes.POSITION;
            if (idx === undefined) continue;
            const acc = json.accessors?.[idx];
            if (acc?.min === undefined || acc.max === undefined) continue;
            found = true;
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], acc.min[i]);
                max[i] = Math.max(max[i], acc.max[i]);
            }
        }
    }
    return found ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] } : null;
}

const rows: { name: string; size: number[]; dx: number; dy: number; dz: number }[] = [];
let bad = 0;

for (const f of readdirSync(dir).filter(n => /\.glb$/i.test(n)).sort()) {
    try {
        const { version, json } = readGlb(join(dir, f));
        if (version !== 2) throw new Error(`glTF version=${version}`);
        const bb = bboxOf(json);
        if (bb === null) throw new Error('没有可用的 POSITION 包围盒');
        const [sx, sy, sz] = bb.size;
        rows.push({ name: f.replace(/\.glb$/i, ''), size: bb.size, dx: sx, dy: sy, dz: sz });
    } catch (e) {
        bad++;
        console.log(`!! ${f}: ${(e as Error).message}`);
    }
}

console.log(`\n解析成功 ${rows.length} / 失败 ${bad}\n`);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad('模型', 30)}${pad('x 宽', 10)}${pad('y 高', 10)}${pad('z 深', 10)}上轴判定`);
for (const r of rows) {
    // y-up 的判据：y 是唯一明显最大的轴，或 y 与另一轴接近时取 y
    const yMax = r.dy >= r.dx && r.dy >= r.dz;
    console.log(
        `${pad(r.name, 30)}${pad(r.dx.toFixed(3), 10)}${pad(r.dy.toFixed(3), 10)}${pad(r.dz.toFixed(3), 10)}${yMax ? 'y-up' : '⚠ y 不是最大轴'}`,
    );
}

const flat = rows.filter(r => r.dy >= r.dx && r.dy >= r.dz).length;
console.log(`\n高度落在 y 轴的比例: ${flat}/${rows.length}`);
