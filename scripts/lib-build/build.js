#!/usr/bin/env node
'use strict';

/**
 * `yarn build:lib` —— 产出可发布的「无头黑盒」库。
 *
 * 产物（全部落在 `dist-lib/`）：
 *   dsp-blueprint-editor.umd.js     UMD，内联 three，全局名 DSPBlueprintEditor
 *   dsp-blueprint-editor.esm.js     ESM，three 作 external
 *   index.d.ts                      手写公共类型（tsc 直出会带 @/ 内部别名，宿主无法解析）
 *   host-test.html                  纯静态宿主验证页（Network 零 404 验收用）
 *   assets/                         外置资产：models/、img/models/<建筑>/、icons/{item_recipe,tech,signal}/
 *
 * 关键实现点：
 * 1. 直接用 Node 调 webpack API（仓库没装 webpack-cli）；两个 target 各跑一次编译。
 * 2. UMD/ESM 都必须挂 `LimitChunkCountPlugin({ maxChunks: 1 })`：`glbLoader.ts` 里
 *    GLTFLoader 走的是动态 `import()`，不合并就会甩出独立 chunk，单文件产物直接废掉。
 * 3. 资产解析走 `@lib/asset-resolver` 的 runtime 实现（纯字符串拼接），资产不进 bundle，
 *    因此 webpack 不应该产出任何 asset 文件——脚本会断言这一点。
 * 4. 资产清单（哪些文件真实存在）由 `assetInventory.js` 扫描磁盘得到，用 DefinePlugin
 *    注入 bundle，保证运行时「文件不存在 → 直接回退」而不是先发一个 404。
 *
 * 现有 `yarn build`（vue-cli）完全不受影响：本脚本不读写 `vue.config.js`。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const webpack = require('webpack');

const { buildInventory } = require('./assetInventory');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist-lib');
const ASSETS_OUT = path.join(OUT, 'assets');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');
const ENTRY = path.join(SRC, 'lib', 'index.ts');

const UMD_FILE = 'dsp-blueprint-editor.umd.js';
const ESM_FILE = 'dsp-blueprint-editor.esm.js';
const GLOBAL_NAME = 'DSPBlueprintEditor';

// ---------------------------------------------------------------- 工具

function log(message) {
    process.stdout.write(`[build:lib] ${message}\n`);
}

function fail(message) {
    throw new Error(`[build:lib] ${message}`);
}

/** 读版本号：优先 git describe（与 vue.config.js 的 VERSION 一致），失败退回 package.json */
function readVersion() {
    try {
        const described = execSync('git describe --tags --always --dirty', { cwd: ROOT, encoding: 'utf8' }).trim();
        if (described !== '')
            return described;
    }
    catch {
        // 非 git 环境（或没有 git）时静默退回 package.json
    }
    try {
        return require(path.join(ROOT, 'package.json')).version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
}

/** 递归列出目录下所有文件（绝对路径） */
function walkFiles(dir, predicate) {
    const out = [];
    const walk = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory())
                walk(full);
            else if (entry.isFile() && predicate(full))
                out.push(full);
        }
    };
    walk(dir);
    return out;
}

/** `a/b/c` → `path.join(root, 'a', 'b', 'c')`（清单里的路径一律用 `/`） */
function fromAssetRelative(root, relativePath) {
    return path.join(root, ...relativePath.split('/'));
}

// ---------------------------------------------------------------- webpack 配置

function createConfig(kind, inventory) {
    const isUmd = kind === 'umd';

    /** @type {import('webpack').Configuration} */
    const config = {
        name: kind,
        mode: 'production',
        target: 'web',
        context: ROOT,
        entry: ENTRY,
        devtool: 'source-map',
        output: {
            path: OUT,
            clean: false,
            filename: isUmd ? UMD_FILE : ESM_FILE,
            publicPath: '',
            globalObject: 'this',
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.json'],
            alias: {
                '@': SRC,
                // 库构建固定走 runtime 实现：资产外置 + 纯字符串拼接，不进 webpack 资产管线
                '@lib/asset-resolver$': path.join(SRC, 'lib', 'assets', 'assetResolver.ts'),
            },
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader',
                    exclude: /node_modules/,
                    options: {
                        configFile: TSCONFIG,
                        transpileOnly: true,
                        compilerOptions: {
                            module: 'esnext',
                            target: 'es2019',
                            sourceMap: true,
                            declaration: false,
                            declarationMap: false,
                            noEmit: false,
                        },
                    },
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                VERSION: JSON.stringify(readVersion()),
                // 构建期资产清单（见 assetInventory.js）
                __DSP_LIB_ASSET_INVENTORY__: JSON.stringify(inventory),
            }),
            // 单文件产物：把 gltf-loader 动态 import 拆出来的 chunk 合并回主 chunk
            new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
        ],
        optimization: {
            minimize: true,
            splitChunks: false,
            runtimeChunk: false,
            moduleIds: 'deterministic',
        },
        performance: { hints: false },
        stats: { preset: 'errors-warnings' },
    };

    if (isUmd) {
        config.output.library = { name: GLOBAL_NAME, type: 'umd' };
    }
    else {
        config.experiments = { outputModule: true };
        config.output.library = { type: 'module' };
        config.output.module = true;
        config.output.chunkFormat = 'module';
        config.externalsType = 'module';
        // ESM 只外置 three（宿主自带）；其余依赖（pako 等）内联，宿主只需装 three
        config.externals = { three: 'three' };
    }

    return config;
}

function compile(config) {
    return new Promise((resolve, reject) => {
        const compiler = webpack(config);
        compiler.run((err, stats) => {
            compiler.close(() => { /* 释放缓存/监听，失败也不影响结果判定 */ });
            if (err) {
                reject(err);
                return;
            }
            if (stats === undefined) {
                reject(new Error('[build:lib] webpack 没有返回 stats'));
                return;
            }
            if (stats.hasErrors()) {
                const info = stats.toJson({ all: false, errors: true });
                reject(new Error(`[build:lib] ${config.name} 编译失败：\n${(info.errors ?? [])
                    .map(error => error.message ?? String(error))
                    .join('\n\n')}`));
                return;
            }
            resolve(stats);
        });
    });
}

// ---------------------------------------------------------------- 资产复制

function copyAssets(inventory) {
    const iconsIn = path.join(SRC, 'assets', 'icons');
    let copied = 0;

    // 1) 建筑 GLB：src/assets/icons/models/<name>.glb → assets/models/<name>.glb
    for (const rel of inventory.models) {
        const name = rel.slice('models/'.length);
        copyFile(path.join(iconsIn, 'models', name), fromAssetRelative(ASSETS_OUT, rel));
        copied++;
    }

    // 2) 通道贴图：src/assets/icons/models/<建筑>/<文件>.png → assets/img/models/<建筑>/<文件>.png
    //    （目录名可能含空格，必须原样保留，否则会与贴图清单对不上）
    const textureRoot = path.join(iconsIn, 'models');
    const textureFiles = walkFiles(textureRoot, file => /\.png$/i.test(file));
    for (const from of textureFiles) {
        const rel = path.relative(textureRoot, from).split(path.sep).join('/');
        const to = path.join(ASSETS_OUT, 'img', 'models', ...rel.split('/'));
        copyFile(from, to);
        copied++;
    }

    // 3) 图标：目录结构原样保留（icons/item_recipe、icons/tech、icons/signal）
    for (const rel of [...inventory.itemRecipe, ...inventory.tech, ...inventory.signal]) {
        copyFile(fromAssetRelative(path.join(SRC, 'assets'), rel), fromAssetRelative(ASSETS_OUT, rel));
        copied++;
    }

    return { copied, textures: textureFiles.length };
}

// ---------------------------------------------------------------- 静态文件

function copyStaticFiles() {
    for (const name of ['index.d.ts', 'host-test.html', 'README.md']) {
        const source = path.join(__dirname, name);
        if (!fs.existsSync(source))
            fail(`缺少模板文件：${source}`);
        copyFile(source, path.join(OUT, name));
    }

    // 验证页用的蓝图样本（相对路径 fetch，跟页面一起搬家也不会坏）
    const fixture = path.join(ROOT, 'public', 'demo', 'sample_throughput.txt');
    if (fs.existsSync(fixture))
        copyFile(fixture, path.join(OUT, 'fixtures', 'sample_blueprint.txt'));
    else
        log('警告：public/demo/sample_throughput.txt 不存在，host-test.html 只能手工粘贴蓝图');
}

// ---------------------------------------------------------------- 产物自检

/**
 * three 是否被内联的判据：`'THREE.WebGLRenderer: …'` 是 three 里的**字符串字面量**，
 * 压缩不会改名。UMD 必须能搜到，ESM 必须搜不到（three 走 external）。
 */
const THREE_INLINE_MARKER = 'THREE.WebGLRenderer';

function verify(statsByKind, inventory, copied) {
    const problems = [];

    for (const [kind, file] of [['umd', UMD_FILE], ['esm', ESM_FILE]]) {
        const info = statsByKind[kind].toJson({ all: false, assets: true });
        const emitted = (info.assets ?? [])
            .map(asset => asset.name)
            // 只允许「一个 js + 它的 sourcemap」；出现 chunk/图片说明单文件或资产外置被破坏
            .filter(name => !name.endsWith('.map'));

        if (emitted.length !== 1 || emitted[0] !== file)
            problems.push(`${kind} 产物异常：期望只产出 ${file}，实际 ${JSON.stringify(emitted)}`);

        if (!fs.existsSync(path.join(OUT, file)))
            problems.push(`${kind} 产物缺失：${file}`);
    }

    const umdCode = fs.existsSync(path.join(OUT, UMD_FILE))
        ? fs.readFileSync(path.join(OUT, UMD_FILE), 'utf8')
        : '';
    if (umdCode !== '') {
        if (!umdCode.includes(GLOBAL_NAME))
            problems.push(`UMD 产物里没有全局名 ${GLOBAL_NAME}`);
        if (!umdCode.includes(THREE_INLINE_MARKER))
            problems.push('UMD 产物里找不到 three 的特征字符串，three 没有被内联');
    }

    const esmCode = fs.existsSync(path.join(OUT, ESM_FILE))
        ? fs.readFileSync(path.join(OUT, ESM_FILE), 'utf8')
        : '';
    if (esmCode !== '') {
        if (!/from\s*["']three["']/.test(esmCode))
            problems.push('ESM 产物里没有 `from "three"`，three 没有被外置');
        if (esmCode.includes(THREE_INLINE_MARKER))
            problems.push('ESM 产物里内联了 three，应为 external');
    }

    for (const name of ['index.d.ts', 'host-test.html']) {
        if (!fs.existsSync(path.join(OUT, name)))
            problems.push(`缺失静态文件：${name}`);
    }

    // 资产抽查：每个类别各挑一个真实存在的文件
    for (const rel of [inventory.models[0], inventory.itemRecipe[0], inventory.tech[0], inventory.signal[0]].filter(Boolean)) {
        if (!fs.existsSync(fromAssetRelative(ASSETS_OUT, rel)))
            problems.push(`资产缺失：${rel}`);
    }

    const modelCount = walkFiles(path.join(ASSETS_OUT, 'models'), file => /\.glb$/i.test(file)).length;
    if (modelCount !== inventory.models.length)
        problems.push(`assets/models 下 GLB 数量 ${modelCount} ≠ 清单 ${inventory.models.length}`);

    const textureCount = walkFiles(path.join(ASSETS_OUT, 'img', 'models'), file => /\.png$/i.test(file)).length;
    if (textureCount === 0)
        problems.push('assets/img/models 下没有任何贴图');

    if (problems.length > 0)
        fail(`产物自检失败：\n- ${problems.join('\n- ')}`);

    return { modelCount, textureCount, copied };
}

// ---------------------------------------------------------------- 主流程

async function main() {
    const startedAt = Date.now();

    if (path.basename(OUT) !== 'dist-lib')
        fail(`输出目录异常，拒绝清理：${OUT}`);
    log(`清理输出目录 ${OUT}`);
    fs.rmSync(OUT, { recursive: true, force: true });
    ensureDir(OUT);

    const inventory = buildInventory(ROOT);
    log(`资产清单：${inventory.models.length} 个 GLB / ${inventory.itemRecipe.length} 物品图标 / `
        + `${inventory.tech.length} 科技图标 / ${inventory.signal.length} 信号图标`);

    const statsByKind = {};
    for (const kind of ['umd', 'esm']) {
        log(`编译 ${kind.toUpperCase()} …`);
        statsByKind[kind] = await compile(createConfig(kind, inventory));
        const file = kind === 'umd' ? UMD_FILE : ESM_FILE;
        const size = fs.statSync(path.join(OUT, file)).size;
        log(`  ${file}  ${(size / 1024).toFixed(1)} KB`);
    }

    log('复制资产到 dist-lib/assets …');
    const copyResult = copyAssets(inventory);
    log('复制静态文件（index.d.ts / host-test.html / README.md / fixtures）…');
    copyStaticFiles();

    const summary = verify(statsByKind, inventory, copyResult.copied);

    log(`完成：${summary.modelCount} 个模型、${summary.textureCount} 张贴图、共 ${summary.copied} 个资产文件，`
        + `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    log(`宿主验证页：${path.join(OUT, 'host-test.html')}`);
}

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
