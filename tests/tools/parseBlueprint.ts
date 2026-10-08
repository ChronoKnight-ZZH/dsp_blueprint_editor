/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/**
 * 用项目自身的 fromStr 解析 DSP 蓝图文件，输出格式化 JSON（调试/标定用工具）。
 *
 * 用法（PowerShell，仓库根目录；脚本长期保留，除非明确要求删除）：
 *   $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'
 *   npx ts-node tests/tools/parseBlueprint.ts "<蓝图文件路径>"
 *   # 输出到文件时用 UTF-8：
 *   npx ts-node tests/tools/parseBlueprint.ts "<蓝图路径>" | Out-File -Encoding utf8 out.json
 *
 * 说明：
 * - ts-node 不解析 tsconfig paths 别名（@/），本脚本在 require parser 之前注册
 *   @/ → src 的轻量钩子，无需 tsconfig-paths、无需 node_modules\@ 目录联接。
 * - parser 校验和位于 strData.length-33，输入必须 trim（尾部换行会导致定位失败）。
 */

// ---- @/ → src require 钩子（必须在 require parser 之前注册）----
const Module = require('module');
const path = require('path');
const fs = require('fs');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request.startsWith('@/'))
        request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

const file = process.argv[2];
if (!file) {
    process.stderr.write('usage: ts-node tests/tools/parseBlueprint.ts <blueprint-file>\n');
    process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));

const input = fs.readFileSync(file, 'utf8').trim();
process.stdout.write(JSON.stringify(fromStr(input), null, 2));
export {};