'use strict';

/**
 * 扫描磁盘上的静态资产，产出一份「构建产物里到底有哪些文件」的清单。
 *
 * 用途（两处，都是为了让「库构建」在**不发请求**的前提下知道文件是否存在）：
 * 1. `scripts/lib-build/build.js`：复制资产到 `dist-lib/models/` 与 `dist-lib/img/`，
 *    并用 DefinePlugin 把清单注入 bundle（`__DSP_LIB_ASSET_INVENTORY__`）；
 * 2. `jest.config.js`：单测里没有 webpack，用同一份清单注入 `globals`。
 *
 * 清单里的路径一律相对 `src/assets/` 目录，例如 `models/smelter.glb`、
 * `icons/tech/1001.png`；产物里对应 `models/smelter.glb`、`img/tech/1001.png`，
 * 由运行时 `assetResolver.ts` 做前缀映射。
 *
 * @param {string} rootDir 仓库根目录
 * @returns {{ models: string[], itemRecipe: string[], tech: string[], signal: string[] }}
 */

const fs = require('fs');
const path = require('path');

function listFiles(dir, predicate, label) {
    if (!fs.existsSync(dir))
        throw new Error(`[asset-inventory] 资产目录不存在：${dir}（${label}）`);
    return fs.readdirSync(dir).filter(predicate).sort();
}

function buildInventory(rootDir) {
    const iconsDir = path.join(rootDir, 'src', 'assets', 'icons');

    const models = listFiles(path.join(iconsDir, 'models'), name => /\.glb$/i.test(name), '建筑模型')
        .map(name => `models/${name}`);

    if (models.length === 0)
        throw new Error(`[asset-inventory] ${path.join(iconsDir, 'models')} 下没有任何 .glb，构建/单测会退化成纯元数据模式`);

    const iconList = sub => listFiles(path.join(iconsDir, sub), name => /\.png$/i.test(name), sub)
        .map(name => `icons/${sub}/${name}`);

    return {
        models,
        itemRecipe: iconList('item_recipe'),
        tech: iconList('tech'),
        signal: iconList('signal'),
    };
}

/**
 * 扫描建筑 GLB，产出「模型名 → 字节数」清单。
 *
 * 编辑器构建的 GLB 规则是 `asset/resource`（原样拷贝，不改写内容），
 * 所以源文件大小就是产物大小，构建期读一次即可，运行时无需 HEAD 请求。
 *
 * @param {string} rootDir 仓库根目录
 * @returns {Record<string, number>} 例如 `{ smelter: 123456, ... }`
 */
function buildModelBytes(rootDir) {
    const modelsDir = path.join(rootDir, 'src', 'assets', 'icons', 'models');
    const files = listFiles(modelsDir, name => /\.glb$/i.test(name), '建筑模型');
    /** @type {Record<string, number>} */
    const bytes = {};
    for (const file of files) {
        const name = path.basename(file).replace(/\.glb$/i, '');
        bytes[name] = fs.statSync(path.join(modelsDir, file)).size;
    }
    return bytes;
}

module.exports = { buildInventory, buildModelBytes };

