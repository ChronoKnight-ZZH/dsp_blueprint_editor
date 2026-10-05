/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 扫描蓝图里分拣器的 v2ExtraPose[4] 与 yaw[0] 的角度差，
 * 找出"工具早期版本导出坏掉"的记录（pose[4] 被写成 0）。
 *
 * 用法: npx ts-node tests/tools/checkPoseConsistency.ts <bp.txt> [...]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const srcDir = path.resolve(__dirname, '..', '..', 'src');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request.startsWith('@/'))
        request = path.join(srcDir, request.slice(2));
    return origResolveFilename.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));

const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

for (const file of process.argv.slice(2)) {
    const data = fromStr(fs.readFileSync(file, 'utf8').trim());
    const sorters = data.buildings.filter((b: any) => b.itemId >= 2011 && b.itemId <= 2014);
    const bad: string[] = [];
    let maxDiff = 0;
    for (const s of sorters) {
        const pose = s.v2ExtraPose;
        if (!pose) { bad.push(`#${s.index} 无 pose`); continue; }
        const d = diff(pose[4], s.yaw[0]);
        maxDiff = Math.max(maxDiff, d);
        if (d > 1)
            bad.push(`#${s.index} yaw=${s.yaw[0].toFixed(2)} pose[4]=${pose[4].toFixed(3)} 差=${d.toFixed(2)}°`);
    }
    console.log(`${path.basename(file)}: 分拣器 ${sorters.length} 个，最大差 ${maxDiff.toFixed(3)}°`);
    for (const b of bad.slice(0, 10))
        console.log('   ' + b);
    if (bad.length > 10)
        console.log(`   ... 共 ${bad.length} 个不一致`);
}

// 标记为模块：避免多个 CLI 脚本在同一 tsconfig 下共享全局作用域
export {};
