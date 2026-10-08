/* eslint-disable @typescript-eslint/no-var-requires -- CLI 脚本需先注册 @/ 钩子再 require parser */
/// <reference types="node" />
/**
 * 参数级样本扫描：把真实蓝图里"带数据的"建筑打出来，用于标定工具尚未覆盖的字段。
 * - 传送带 (2001-2003)：parameters 非空（图标 / 数量）
 * - 四向分流器 (2020)：priority 任一为真、extra 非零、或 filterId > 0
 * - 矩阵研究站 (2901/2902)：researchMode / recipeId
 *
 * 用法：
 *   npx ts-node tests/tools/dumpParams.ts <bp.txt> [...]
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

for (const file of process.argv.slice(2)) {
    let data;
    try {
        data = fromStr(fs.readFileSync(file, 'utf8').trim());
    } catch (e) {
        console.log(`${path.basename(file)}: 解析失败 ${(e as Error).message}`);
        continue;
    }
    const out: string[] = [];
    let beltWith = 0;
    let splitterWith = 0;
    let labWith = 0;
    for (const b of data.buildings) {
        if (b.itemId >= 2001 && b.itemId <= 2003 && b.parameters !== null) {
            beltWith++;
            if (beltWith <= 3)
                out.push(`  皮带#${b.index} icon=${b.parameters.iconId} count=${b.parameters.count}`);
        } else if (b.itemId === 2020) {
            const p = b.parameters;
            const prio = p ? (p.priority as boolean[]) : [];
            const extra = p ? (p.extra as number[]) : [];
            const anyPrio = prio.some((x) => x);
            const anyExtra = extra.some((x) => x !== 0);
            if (anyPrio || anyExtra || b.filterId > 0) {
                splitterWith++;
                if (splitterWith <= 6)
                    out.push(
                        `  分流器#${b.index} model=${b.modelIndex} priority=[${prio.map((x) => (x ? 1 : 0)).join(',')}]` +
                        ` extra=[${extra.join(',')}] filterId=${b.filterId}`
                    );
            }
        } else if ((b.itemId === 2901 || b.itemId === 2902) && b.parameters !== null) {
            labWith++;
            if (labWith <= 3)
                out.push(`  研究站#${b.index} item=${b.itemId} mode=${b.parameters.researchMode} recipe=${b.recipeId}`);
        }
    }
    console.log(
        `${path.basename(file)}: buildings=${data.buildings.length}` +
        ` 带参数皮带=${beltWith} 有优先级/筛选的分流器=${splitterWith} 研究站=${labWith}`
    );
    for (const l of out) console.log(l);
}

// 标记为模块
export {};
