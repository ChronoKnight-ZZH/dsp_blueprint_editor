/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require */
/// <reference types="node" />
/**
 * 字节级 round-trip 检查：解析 → 重新导出 → 解压 body 与原 body 逐字节比对，
 * 打印首个差异偏移附近的内容。用于判断"某些字段是否被解析器丢掉"（丢了就会在导出时被清零）。
 *
 * 用法: npx ts-node tests/tools/byteRoundTrip.ts <bp.txt> [...]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const pako = require('pako');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request.startsWith('@/'))
        request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

const { fromStr, toStr } = require(path.join(srcDir, 'blueprint', 'parser'));

function bodyOf(str: string): Uint8Array {
    const p1 = str.indexOf('"', 'BLUEPRINT:'.length) + 1;
    const p2 = str.length - 33;
    return pako.ungzip(
        new Uint8Array(Buffer.from(str.substring(p1, p2), 'base64'))
    );
}

for (const file of process.argv.slice(2)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const bp = fromStr(raw);
    const out = toStr(bp);
    const a = bodyOf(raw);
    const b = bodyOf(out);
    const diffs: number[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (a[i] !== b[i]) diffs.push(i);
    console.log(
        `${path.basename(file)}: 原=${a.length}B 重出=${b.length}B 差异字节=${diffs.length}` +
            (diffs.length ? ` 首个@${diffs[0]}` : '  ✔逐字节一致')
    );
    for (const i of diffs.slice(0, 12))
        console.log(
            `   @${i}: 原=${a[i]} 新=${b[i]}` +
                ` 上下文原=[${Array.from(a.slice(Math.max(0, i - 4), i + 8)).join(',')}]`
        );
}

export {};
