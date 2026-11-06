#!/usr/bin/env node
'use strict';

/**
 * `yarn build:lib` —— 产出可发布的「无头黑盒」库。
 *
 * 产物（全部落在 `dist-lib/`）：
 *   dsp-blueprint-editor.esm.js     ESM，**three 内联**，宿主零运行时依赖
 *   dsp-blueprint-editor.esm.d.ts   与 ESM 产物同名的类型声明（TS 按同名规则解析）
 *   dsp-blueprint-editor.umd.js     UMD，内联 three，全局名 DSPBlueprintEditor
 *   index.d.ts                      手写公共类型（`package.json#types` 指向它，内容同 ESM 版）
 *   host-test.html                  纯静态宿主验证页（UMD 形态，Network 零 404 验收用）
 *   esm-test.html                   纯静态宿主验证页（ESM + import.meta.url 资产探测验收用）
 *   models/<name>.glb               建筑模型（法线/自发光/spec 已内嵌为 KTX2）
 *   basis/                          Basis Universal 转码器（basis_transcoder.js + .wasm）
 *   img/item_recipe/*.png           物品与配方图标
 *   img/tech/*.png                  科技图标
 *   img/signal/*.png                信号图标
 *
 * 关键实现点：
 * 1. 直接用 Node 调 webpack API（仓库没装 webpack-cli）；两个 target 各跑一次编译。
 * 2. 两个 target 都必须挂 `LimitChunkCountPlugin({ maxChunks: 1 })`：`glbLoader.ts` 里
 *    GLTFLoader 走的是动态 `import()`，不合并就会甩出独立 chunk，单文件产物直接废掉。
 * 3. ESM 是**真 ESM**（`output.module` + `library.type: 'module'`），
 *    不再有 UMD 的 CJS `exports`/`module` 分支探测，顶层也没有 `this` 包装器；
 *    `three` 不再 external —— 内联进产物，宿主不需要（也不应该）装 three。
 * 4. 资产根探测：ESM 产物由 DefinePlugin 注入 `import.meta.url`，UMD 注入 `undefined`
 *    并回落到 `<script src>`（见 `src/lib/assets/assetBaseUrl.ts`）。
 * 5. 资产解析走 `@lib/asset-resolver` 的 runtime 实现（纯字符串拼接），资产不进 bundle，
 *    因此 webpack 不应该产出任何 asset 文件——脚本会断言这一点。
 * 6. 资产清单（哪些文件真实存在）由 `assetInventory.js` 扫描磁盘得到，用 DefinePlugin
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
const TSCONFIG = path.join(ROOT, 'tsconfig.json');
const ENTRY = path.join(SRC, 'lib', 'index.ts');

const UMD_FILE = 'dsp-blueprint-editor.umd.js';
const ESM_FILE = 'dsp-blueprint-editor.esm.js';
/** 与 ESM 产物同名：TS 解析 `import('./x.js')` 时会找 `x.d.ts` */
const ESM_TYPES_FILE = 'dsp-blueprint-editor.esm.d.ts';
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

/** 清单键（相对 `src/assets/`）→ 产物内相对路径：`icons/` 落 `img/`，其余原样 */
function toOutputRelative(relativePath) {
    return relativePath.startsWith('icons/') ? `img/${relativePath.slice('icons/'.length)}` : relativePath;
}

// ---------------------------------------------------------------- webpack 配置

function createConfig(kind, inventory) {
    const isUmd = kind === 'umd';

    /** @type {import('webpack').Configuration} */
    const config = {
        name: kind,
        mode: 'production',
        // 运行壳是 WebView2（Chromium），ES2020 语法无需降级
        target: ['web', 'es2020'],
        context: ROOT,
        entry: ENTRY,
        devtool: 'source-map',
        output: {
            path: OUT,
            clean: false,
            filename: isUmd ? UMD_FILE : ESM_FILE,
            publicPath: '',
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.json'],
            alias: {
                '@': SRC,
                // 库构建固定走 runtime 实现：资产外置 + 纯字符串拼接，不进 webpack 资产管线
                '@lib/asset-resolver$': path.join(SRC, 'lib', 'assets', 'assetResolver.ts'),
                // 与编辑器构建保持一致：走 three 的 ESM 源码，享受 tree-shaking
                // （直接解析 `three` 包会拿到 CJS 的 build/three.cjs，体积大且无法摇树）
                three$: 'three/src/Three.js',
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
                            target: 'es2020',
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
                // 资产根自动探测：ESM 注入产物自身 URL；UMD 注入 undefined，
                // 由源码里的 typeof 守卫跳过并回落到 <script src>（见 assetBaseUrl.ts）
                __DSP_LIB_MODULE_URL__: isUmd ? 'undefined' : 'import.meta.url',
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
        // 关键：ESM 顶层 `this` 是 undefined，用 `this` 当 root 会让 UMD 包装器直接崩。
        // globalThis 在 ESM / CJS / 浏览器 script 里都指向全局对象。
        config.output.globalObject = 'globalThis';
    }
    else {
        // 真 ESM：宿主按普通依赖 `import`，不再探测 exports/module（Wails 会注入它们）
        config.experiments = { outputModule: true };
        config.output.library = { type: 'module' };
        config.output.module = true;
        config.output.chunkFormat = 'module';
        // three 有意内联：宿主没装 three（也不该让它挑版本），产物单文件自足。
        // 因此这里**不能**再设 config.externals / externalsType。
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
    const imgOut = path.join(OUT, 'img');          // 所有图片的目标根
    const modelsOut = path.join(OUT, 'models');    // GLB 直接放 dist-lib/models
    let copied = 0;

    // 1) 建筑 GLB：src/assets/icons/models/<name>.glb → dist-lib/models/<name>.glb
    //    注意：只复制 .glb，避免把 models 下的贴图目录也带过来
    for (const rel of inventory.models) {
        const name = rel.slice('models/'.length);
        copyFile(path.join(iconsIn, 'models', name), path.join(modelsOut, ...name.split('/')));
        copied++;
    }

    // 2) 三类图标：src/assets/icons/{item_recipe,tech,signal}/... → dist-lib/img/{item_recipe,tech,signal}/...
    const iconGroups = [
        ['item_recipe', inventory.itemRecipe],
        ['tech', inventory.tech],
        ['signal', inventory.signal],
    ];
    for (const [category, list] of iconGroups) {
        for (const rel of list) {
            // inventory 里的 rel 形如 `icons/item_recipe/xxx.png`，去掉 `icons/<category>/` 前缀
            const prefix = `icons/${category}/`;
            const name = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel.slice(rel.indexOf('/', 6) + 1);
            copyFile(
                fromAssetRelative(path.join(SRC, 'assets'), rel),
                path.join(imgOut, category, ...name.split('/')),
            );
            copied++;
        }
    }

    // 3) 其他 logo 图片：src/assets/icons/ 下除 models/ 以外的所有图片
    //    - icons/<子目录>/... → dist-lib/img/icons/<子目录>/...
    //    - icons/<文件>      → dist-lib/img/<文件>
    const otherFiles = walkFiles(iconsIn, file => {
        if (!/\.(png|jpe?g|svg|webp|gif)$/i.test(file))
            return false;
        const rel = path.relative(iconsIn, file).split(path.sep).join('/');
        // 排除已单独处理的 models（GLB + 贴图）和三类图标
        if (rel.startsWith('models/'))
            return false;
        if (/^(item_recipe|tech|signal)\//.test(rel))
            return false;
        return true;
    });
    for (const from of otherFiles) {
        const rel = path.relative(iconsIn, from).split(path.sep).join('/');
        const segments = rel.split('/');
        // 根下的文件直接进 img/；子目录的进 img/icons/<子目录>/...
        const to = segments.length === 1
            ? path.join(imgOut, ...segments)
            : path.join(imgOut, 'icons', ...segments);
        copyFile(from, to);
        copied++;
    }

    return { copied };
}


// ---------------------------------------------------------------- 静态文件

function copyStaticFiles() {
    for (const name of ['index.d.ts', 'host-test.html', 'esm-test.html', 'preview-test.html', 'README.md']) {
        const source = path.join(__dirname, name);
        if (!fs.existsSync(source))
            fail(`缺少模板文件：${source}`);
        copyFile(source, path.join(OUT, name));
    }

    // 增量预览测试页的数据（`node scripts/preview/build-fixture.mjs` 生成）。
    // 缺了不阻断构建，只警告：该页仅用于人工验收动画效果。
    const previewFixture = path.join(__dirname, 'preview-fixture.json');
    if (fs.existsSync(previewFixture))
        copyFile(previewFixture, path.join(OUT, 'preview-fixture.json'));
    else
        log('警告：scripts/lib-build/preview-fixture.json 不存在，preview-test.html 无法回放（先跑 node scripts/preview/build-fixture.mjs）');

    // 与 ESM 产物同名的类型声明：宿主 `import('./dsp-blueprint-editor.esm.js')`
    // 时 TS 按「同名 .d.ts」规则命中它，不需要额外包元数据。
    copyFile(path.join(__dirname, 'index.d.ts'), path.join(OUT, ESM_TYPES_FILE));

    // 验证页用的蓝图样本（相对路径 fetch，跟页面一起搬家也不会坏）
    const fixture = path.join(ROOT, 'public', 'demo', 'sample_throughput.txt');
    const fixturejson = path.join(ROOT, 'public', 'demo', 'sample_blueprint.json');
    const preview = path.join(ROOT, 'public', 'demo', 'preview.json');
    if (fs.existsSync(fixture))
        copyFile(fixture, path.join(OUT, 'fixtures', 'sample_blueprint.txt'));
    else
        log('警告：public/demo/sample_throughput.txt 不存在，host-test.html 只能手工粘贴蓝图');
    if (fs.existsSync(fixturejson))
        copyFile(fixturejson, path.join(OUT, 'fixtures', 'sample_blueprint.json'));
    else
        log('警告：public/demo/sample_blueprint.json 不存在，host-test.html 只能手工粘贴蓝图');
    if (fs.existsSync(preview))
        copyFile(preview, path.join(OUT, 'preview.json'));
    else
        log('警告：public/demo/preview.json 不存在，preview-test.html 无法回放');

    // Basis 转码器：public/basis/ → dist-lib/basis/
    // 运行时 `resolveAssetUrl("basis/")` 或 `${BASE_URL}basis/` 都会命中这里。
    const basisIn = path.join(ROOT, 'public', 'basis');
    const basisOut = path.join(OUT, 'basis');
    if (fs.existsSync(basisIn)) {
        for (const file of fs.readdirSync(basisIn)) {
            copyFile(path.join(basisIn, file), path.join(basisOut, file));
        }
    }
    else {
        fail('缺少 public/basis/（先跑 node scripts/glb-ktx2/copy-basis-transcoder.mjs）');
    }
}

// ---------------------------------------------------------------- 产物自检

/**
 * three 是否被内联的判据：`'THREE.WebGLRenderer: …'` 是 three 里的**字符串字面量**，
 * 压缩不会改名。ESM 与 UMD 都必须能搜到（three 一律内联）。
 */
const THREE_INLINE_MARKER = 'THREE.WebGLRenderer';

function verify(statsByKind, inventory, copied) {
    const problems = [];

    for (const [kind, file] of [['umd', UMD_FILE], ['esm', ESM_FILE]]) {
        const info = statsByKind[kind].toJson({ all: false, assets: true });
        const emitted = (info.assets ?? [])
            .map(asset => asset.name)
            // 只允许「一个 js + 它的 sourcemap / license」；出现 chunk/图片说明单文件或资产外置被破坏
            .filter(name => !name.endsWith('.map') && !name.endsWith('.LICENSE.txt'));

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
        if (/import\.meta/.test(umdCode))
            problems.push('UMD 产物里出现了 import.meta：非 ESM 输出会直接语法崩溃');
        if (!umdCode.includes('globalThis'))
            problems.push('UMD 产物里没有 globalThis，包装器可能仍在用 this 当 root');
    }

    const esmCode = fs.existsSync(path.join(OUT, ESM_FILE))
        ? fs.readFileSync(path.join(OUT, ESM_FILE), 'utf8')
        : '';
    if (esmCode !== '') {
        if (/\bfrom\s*["']three["']/.test(esmCode))
            problems.push('ESM 产物里仍有 `from "three"`，three 没有被内联');
        if (!esmCode.includes(THREE_INLINE_MARKER))
            problems.push('ESM 产物里找不到 three 的特征字符串，three 没有被内联');
        if (!/import\.meta\.url/.test(esmCode))
            problems.push('ESM 产物里没有 import.meta.url，资产根兜底探测失效');
        if (!/\bexport\s*\{/.test(esmCode))
            problems.push('ESM 产物里没有 `export {`，不是可 import 的模块');
        if (esmCode.includes('webpackUniversalModuleDefinition'))
            problems.push('ESM 产物是 UMD 包装器，output.module 没生效');
    }

    for (const name of ['index.d.ts', ESM_TYPES_FILE, 'host-test.html', 'esm-test.html', 'preview-test.html']) {
        if (!fs.existsSync(path.join(OUT, name)))
            problems.push(`缺失静态文件：${name}`);
    }

    // 类型声明必须是纯模块：`export as namespace` 会向宿主全局注入名字，导致交叉类型冲突
    const typesPath = path.join(OUT, 'index.d.ts');
    if (fs.existsSync(typesPath) && /^\s*export\s+as\s+namespace\b/m.test(fs.readFileSync(typesPath, 'utf8')))
        problems.push('index.d.ts 里仍有 `export as namespace`，会污染宿主全局');

    // 资产抽查：每个类别各挑一个真实存在的文件
    for (const rel of [inventory.models[0], inventory.itemRecipe[0], inventory.tech[0], inventory.signal[0]].filter(Boolean)) {
        if (!fs.existsSync(fromAssetRelative(OUT, toOutputRelative(rel))))
            problems.push(`资产缺失：${rel}`);
    }

    const modelCount = walkFiles(path.join(OUT, 'models'), file => /\.glb$/i.test(file)).length;
    if (modelCount !== inventory.models.length)
        problems.push(`models 下 GLB 数量 ${modelCount} ≠ 清单 ${inventory.models.length}`);

    const legacyTextureDir = path.join(OUT, 'img', 'models');
    const legacyTextureCount = fs.existsSync(legacyTextureDir)
        ? walkFiles(legacyTextureDir, file => /\.png$/i.test(file)).length
        : 0;
    if (legacyTextureCount > 0)
        problems.push(`dist-lib 仍含 ${legacyTextureCount} 张 img/models 通道贴图（应已内嵌进 GLB）`);

    // Basis 转码器必须随产物一起走（resolveAssetUrl("basis/") 会命中 dist-lib/basis/）
    const basisDir = path.join(OUT, 'basis');
    const basisFiles = fs.existsSync(basisDir) ? fs.readdirSync(basisDir) : [];
    const requiredBasis = ['basis_transcoder.js', 'basis_transcoder.wasm'];
    const missingBasis = requiredBasis.filter(name => !basisFiles.includes(name));
    if (missingBasis.length > 0)
        problems.push(`dist-lib/basis/ 缺少：${missingBasis.join(', ')}`);

    if (problems.length > 0)
        fail(`产物自检失败：\n- ${problems.join('\n- ')}`);

    return { modelCount, copied };
}

// ---------------------------------------------------------------- 主流程

/**
 * 清空输出目录。
 *
 * 常见坑：目录被别的进程当成 cwd（例如你正用它跑 `http-server dist-lib`），
 * Windows 会拒绝 rmdir 并抛 EBUSY。此时退化成「只删内容、留下目录本身」——
 * 构建结果一样正确，也不要求你先关掉预览服务。
 */
function cleanOutputDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        return;
    }
    catch (e) {
        if (e.code !== 'EBUSY' && e.code !== 'EPERM')
            throw e;
        log(`  目录被占用（${e.code}），改为逐个删除内容`);
    }

    if (!fs.existsSync(dir))
        return;
    for (const entry of fs.readdirSync(dir)) {
        try {
            fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
        catch (e) {
            // 单个文件删不掉（例如正被打开）：说明清楚，别让构建带着旧产物继续
            fail(`无法删除 ${entry}（${e.code}）：请先关闭占用 dist-lib 的程序再重试`);
        }
    }
}

async function main() {
    const startedAt = Date.now();

    if (path.basename(OUT) !== 'dist-lib')
        fail(`输出目录异常，拒绝清理：${OUT}`);
    log(`清理输出目录 ${OUT}`);
    cleanOutputDir(OUT);
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

    log('复制资产到 dist-lib（models/ + img/）…');
    const copyResult = copyAssets(inventory);
    log('复制静态文件（index.d.ts / esm.d.ts / host-test.html / esm-test.html / preview-test.html / README.md / fixtures）…');
    copyStaticFiles();

    const summary = verify(statsByKind, inventory, copyResult.copied);

    log(`完成：${summary.modelCount} 个模型、共 ${summary.copied} 个资产文件，`
        + `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    log(`宿主验证页：${path.join(OUT, 'host-test.html')}`);
    log(`增量预览测试页：${path.join(OUT, 'preview-test.html')}`);
}

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
