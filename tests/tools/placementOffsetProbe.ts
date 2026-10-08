/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires -- 探针脚本需先注册 @/ 钩子再 require */
/**
 * 诊断探针：编辑模式下"放置预览/放置位置"与鼠标所指点是否重合。
 *
 * 现象（修复前）：导入蓝图后进入编辑模式，跟随鼠标的绿色预览盒与光标位置错开；
 * 未导入蓝图（工具自建空蓝图）时两者一致。
 *
 * 原理：光标 → 局部格用 `planetToLocal`。它一度硬编码"根区域原点纬度 = -80、
 * 经向 1000 格/圈"，只有 `size.y=161` 的自建画布成立；而局部格 → 世界格用
 * `calcBuildingTrans`，用的是 `findPosForAreas` 按区域元数据算出的**真实**原点。
 * 两者不互逆时误差 = `(-floor(原区域size.y/2)) - (-80)` 格（纬向），
 * 即 `80 - floor(size.y/2)` 格 —— 导入蓝图动辄错开几十格（十几度）。
 *
 * 现在 `planetToLocal(latGrid, lonGrid, area)` 要求传入区域定位，本探针的判据是：
 * 把某建筑端点的世界格反算回局部格，应当逐位等于该建筑自己的 `localOffset`。
 *
 * 用法：
 *   npx ts-node tests/tools/placementOffsetProbe.ts [蓝图文件...]
 * 默认扫描 tests/unit/blueprint/fixtures/*.txt
 */

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

const { fromStr } = require(path.join(srcDir, 'blueprint', 'parser'));
const { findPosForAreas } = require(path.join(srcDir, 'blueprint', 'planet'));
const { planetToLocal } = require(path.join(srcDir, 'blueprint', 'area'));
const { createEmptyBlueprint } = require(path.join(
    srcDir,
    'blueprint',
    'create'
));

const SEGMENT = 200;

function check(label: string, data: any) {
    const pos = findPosForAreas(data.areas, SEGMENT);
    const root = data.areas[0];
    // 局部格 → 世界格（= calcBuildingTrans 的经纬部分）
    const toWorld = (areaIndex: number, p: { x: number; y: number }) => {
        const area = pos.areas[areaIndex];
        return {
            latGrid: area.latitude + p.y,
            lonGrid:
                (area.longitude + p.x) * (area.segment / SEGMENT),
        };
    };
    let worst = 0;
    let checked = 0;
    for (const b of data.buildings) {
        if (b.areaIndex !== 0) continue; // 放置只写根区域，其它区域不参与
        const target = b.localOffset[0];
        const w = toWorld(b.areaIndex, target);
        const back = planetToLocal(w.latGrid, w.lonGrid, pos.areas[0]);
        const dLon = ((back.x - target.x) % 1000 + 1500) % 1000 - 500;
        const dLat = back.y - target.y;
        worst = Math.max(worst, Math.abs(dLat), Math.abs(dLon));
        checked++;
    }
    const p = pos.areas[0];
    console.log(`--- ${label}`);
    console.log(
        `  areas=${data.areas.length} root{seg=${root.areaSegments}, size=${root.size.x}x${root.size.y}}` +
            ` → 定位{lon=${p.longitude}, lat=${p.latitude}}` +
            `（旧代码假设 lat=-80）`
    );
    console.log(
        `  建筑端点数=${checked}  反算回局部格最大误差=${worst.toFixed(4)} 格` +
            (checked === 0
                ? '  （无根区域建筑，跳过）'
                : worst < 1e-6
                  ? '  ✔一致'
                  : '  ✘偏移')
    );
}

const args = process.argv.slice(2);
const files: string[] =
    args.length > 0
        ? args
        : fs
              .readdirSync(
                  path.resolve(__dirname, '..', 'unit', 'blueprint', 'fixtures')
              )
              .filter((f: string) => f.endsWith('.txt'))
              .map((f: string) =>
                  path.resolve(
                      __dirname,
                      '..',
                      'unit',
                      'blueprint',
                      'fixtures',
                      f
                  )
              );

for (const file of files) {
    const input = fs.readFileSync(file, 'utf8').trim();
    let data;
    try {
        data = fromStr(input);
    } catch (e) {
        console.log(
            `--- ${path.basename(file)}  解析失败: ${(e as Error).message}`
        );
        continue;
    }
    check(path.basename(file), data);
}

// 对照组：工具自建空蓝图（根区域 size.y=161，原点纬度 -80）
check('(工具新建空蓝图)', createEmptyBlueprint());

// 让本文件保持"模块"（与 tests/tools 下其它脚本一致）：
// 否则顶层 `const fs/path/Module` 会落到全局脚本作用域，与同样没有 import/export 的
// parseBlueprint.ts 相互重名（TS2451），把 `yarn build` 的类型检查整个搞挂。
export {};
