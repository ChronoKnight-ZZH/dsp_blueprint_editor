const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const { buildModelBytes } = require('./scripts/lib-build/assetInventory')
const persistence = require('./config/persistence.config')

/** 部署根路径：GitHub Pages 项目页 /<repo>/。改这里等于同时改 publicPath 与 KTX2 转码器目录。 */
const PUBLIC_PATH = '/dsp_blueprint_editor/'

module.exports = defineConfig({
    publicPath: PUBLIC_PATH,
    transpileDependencies: false,
    // BlueprintViewer demo 页（开发验证用）：http://localhost:8080/dsp_blueprint_editor/demo.html
    // ⚠️ `demo/main.ts` / `demo/index.html` 在合并进来的两个分支里都没有被提交
    // （BlueprintViewer 分支只留了这段配置，它自己的 yarn build 就会因
    //  "Can't resolve demo/main.ts" 失败）。这里改成「入口文件存在才注册该页」：
    // 合并分支的 yarn build 可以正常通过，等 demo 入口补上后会自动生效。
    pages: {
        index: {
            entry: 'src/main.ts',
            template: 'public/index.html',
            filename: 'index.html',
        },
        ...(fs.existsSync(path.resolve(__dirname, 'demo/main.ts')) ? {
            demo: {
                entry: 'demo/main.ts',
                template: 'demo/index.html',
                filename: 'demo.html',
            },
        } : {}),
    },
    configureWebpack: {
        module: {
            rules: [
                {
                    test: /\/assets\//,
                    // 排除代码文件：本规则在 Linux（正斜杠路径）下会误命中
                    // src/lib/assets/*.ts，把 TS 模块吞成 asset（只剩 default 导出的
                    // URL 字符串），导致 assetResolver 在 CI 产物里变成 undefined。
                    // Windows 上路径是反斜杠，本规则原本就匹配不到任何文件，行为不变。
                    exclude: /\.[jt]sx?$/,
                    type: 'asset',
                }, {
                    // 物品/配方图标：独立成文件并归入 img/item_recipe/。
                    // 该目录是扁平结构，无需保留子路径；正则兼容 Windows 反斜杠。
                    test: /assets[\\/]icons[\\/]item_recipe[\\/]/,
                    type: 'asset/resource',
                    generator: {
                        filename: 'img/item_recipe/[name].[contenthash:8][ext]',
                    },
                }, {
                    test: /\/assets\/icons\/(signal|tech)\//,
                    exclude: /\.[jt]sx?$/,
                    type: 'asset/resource',
                }, {
                    // 建筑 GLB 模型：强制输出独立文件（不走 <8KB 内联），
                    // 由 webpack 生成带 publicPath 的最终 URL，部署到任意子路径都正确。
                    // 必须排在 `/\/assets\//` 之后，后匹配的规则会覆盖前面的 type。
                    test: /\.glb$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: 'models/[name].[contenthash:8][ext]',
                    },
                },
            ],
        },
        resolve: {
            alias: {
                three$: 'three/src/Three.js',
                // 资产解析层：编辑器构建固定用 webpack 实现（require.context / require /
                // 模板字符串 import），产物与改造前逐字节一致；库构建（yarn build:lib）
                // 通过同一别名的 $ 精确匹配切到 runtime 实现（纯字符串拼接 + 外置资产）。
                '@lib/asset-resolver$': path.resolve(__dirname, 'src/lib/assets/assetResolver.webpack.ts'),
            }
        },
        plugins: [
            new webpack.DefinePlugin({
                VERSION: JSON.stringify(execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim()),
                // Basis 转码器目录（`public/basis/` 会被拷到 dist 根，所以要按 publicPath 拼）。
                // 不能靠运行时 `process.env.BASE_URL`：webpack 5 不注入 process，
                // 那条分支会被常量折叠掉，最后退化成「相对当前 JS chunk」的
                // `/js/basis/`（404）—— 这就是模型全部退回元数据盒的根因。
                __DSP_TRANSCODER_BASE__: JSON.stringify(PUBLIC_PATH + 'basis/'),
                // 构建期模型大小清单（模型名 → 字节数）。GLB 走 asset/resource 原样拷贝，
                // 源文件大小即产物大小；运行时据此零请求算出「未下载模型共多少 MB」。
                __DSP_MODEL_BYTES__: JSON.stringify(buildModelBytes(__dirname)),
                // 模型本地缓存（持久化）的全局开关：唯一来源是 config/persistence.config.js
                // 的 `web` 字段。关闭后运行时换成「空操作」缓存对象——读写都直接返回
                // 未命中/失败，不碰 Cache Storage（见 src/models/modelCache.ts）。
                __DSP_MODEL_CACHE_ENABLED__: JSON.stringify(persistence.web === true),
            }),
        ],
    },
    pwa: {
        name: '戴森球计划蓝图预览',
        themeColor: '#000000',
        msTileColor: null,
        appleMobileWebAppCapable: 'yes',
        appleMobileWebAppStatusBarStyle: 'black',
        manifestOptions: {
            short_name: '蓝图预览',
            icons: [
                {
                    'src': './img/icons/android-chrome-192x192.png',
                    'sizes': '192x192',
                    'type': 'image/png'
                },
                {
                    'src': './img/icons/android-chrome-512x512.png',
                    'sizes': '512x512',
                    'type': 'image/png'
                },
            ],
        },
        iconPaths: {
            faviconSVG: 'img/icons/favicon.svg',
            favicon32: 'img/icons/favicon-32x32.png',
            favicon16: 'img/icons/favicon-16x16.png',
            appleTouchIcon: null,
            maskIcon: null,
            msTileImage: null,
        },
        // Workbox 默认会把 dist 下所有 <2 MB 的文件塞进 precache —— 包括
        // 45 个建筑 GLB（约 40 MB）。后果：首次访问 service worker 装装时就
        // 把这 40 MB 全下一遍（用户可能一栋楼都没看），移动端还会撑爆缓存配额。
        // 建筑模型由 `glbLoader` 自己懒加载（并发闸门 + 负缓存），不需要 precache；
        // 这里显式排除 models/，其余默认排除项必须原样保留（plugin 的
        // Object.assign 会用本数组整体覆盖默认值）。
        workboxOptions: {
            exclude: [
                /\.map$/,
                /img\/icons\//,
                /favicon\.ico$/,
                /^manifest.*\.js?$/,
                /models\//,
                /demo\//,
                // 更新日志必须每次从网络读最新版本；一旦进 precache，
                // 旧页面会拿到旧日志，更新弹窗就失去意义。
                /update-log\.json$/,
            ],
        },
    },

    pluginOptions: {
      i18n: {
        localeDir: 'locales',
        enableLegacy: false,
        runtimeOnly: true,
        compositionOnly: true,
        fullInstall: true
      }
    }
})
