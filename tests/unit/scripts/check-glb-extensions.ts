/**
 * 检查每个 GLB 是否会因为「需要额外解码器 / 引用外部资源」而解析失败。
 *
 * 这类问题不会报错，只会让 buildingModel 静默回退元数据盒——看起来像“模型没生效”。
 * 用法：npx ts-node -O '{"module":"commonjs","types":["node"]}' scripts/check-glb-extensions.ts
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'src', 'assets', 'icons', 'models');

interface GltfJson {
    extensionsRequired?: string[];
    extensionsUsed?: string[];
    buffers?: { uri?: string }[];
    images?: { uri?: string; bufferView?: number }[];
    meshes?: unknown[];
}

function readJson(file: string): GltfJson {
    const buf = readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB');
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt32LE(offset);
        const type = buf.readUInt32LE(offset + 4);
        if (type === 0x4e4f534a)
            return JSON.parse(buf.subarray(offset + 8, offset + 8 + len).toString('utf8')) as GltfJson;
        offset += 8 + len + ((4 - (len % 4)) % 4);
    }
    throw new Error('缺少 JSON chunk');
}

const required = new Map<string, string[]>();
const used = new Map<string, string[]>();
const external: string[] = [];

for (const f of readdirSync(dir).filter(n => /\.glb$/i.test(n)).sort()) {
    const json = readJson(join(dir, f));
    const name = f.replace(/\.glb$/i, '');
    if (json.extensionsRequired?.length) required.set(name, json.extensionsRequired);
    if (json.extensionsUsed?.length) used.set(name, json.extensionsUsed);
    const ext: string[] = [];
    for (const b of json.buffers ?? [])
        if (b.uri !== undefined) ext.push(`buffer:${b.uri}`);
    for (const img of json.images ?? [])
        if (img.uri !== undefined) ext.push(`image:${img.uri}`);
    if (ext.length) external.push(`${name} -> ${ext.join(', ')}`);
}

console.log(`\n== extensionsRequired（缺少对应 loader 会直接解析失败）==`);
if (required.size === 0) console.log('  (无，纯标准 glTF 2.0)');
for (const [name, exts] of required) console.log(`  ${name}: ${exts.join(', ')}`);

console.log(`\n== extensionsUsed（仅声明，通常无需额外 loader）==`);
if (used.size === 0) console.log('  (无)');
for (const [name, exts] of used) console.log(`  ${name}: ${exts.join(', ')}`);

console.log(`\n== 引用外部文件（打包后路径会失效，导致加载失败）==`);
console.log(external.length ? external.join('\n') : '  (无，全部自包含)');
