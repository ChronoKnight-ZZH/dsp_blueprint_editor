const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const { execSync } = require('child_process')

module.exports = defineConfig({
    publicPath: '/dsp_blueprint_editor/',
    transpileDependencies: false,
    // BlueprintViewer demo 页（开发验证用）：http://localhost:8080/dsp_blueprint_editor/demo.html
    pages: {
        index: {
            entry: 'src/main.ts',
            template: 'public/index.html',
            filename: 'index.html',
        },
        demo: {
            entry: 'demo/main.ts',
            template: 'demo/index.html',
            filename: 'demo.html',
        },
    },
    configureWebpack: {
        module: {
            rules: [
                {
                    test: /\/assets\//,
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
                }, {
                    // 建筑通道贴图（法线 / 自发光 / spec-gloss）：独立成文件，输出到 img/models/。
                    // 这些图多为 1~4 MB，内联成 base64 会把 JS 撑爆；
                    // 另外不同建筑目录里有同名贴图（如 color-palette-256.png），
                    // 必须保留建筑子目录才不会互相覆盖 —— 但 [path] 会把 src/assets/icons/models
                    // 前缀一起带进输出路径，所以用函数形式只截取 models/ 之后的相对部分。
                    // 正则要同时兼容 `/` 与 `\`：webpack 在 Windows 上给出的是反斜杠路径，
                    // 只写 `/` 会让规则静默失配、图落到默认的 img/ 目录。
                    test: /assets[\\/]icons[\\/]models[\\/].+\.png$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: (pathData) => {
                            const rel = pathData.filename
                                .replace(/\\/g, '/')
                                .replace(/^.*assets\/icons\/models\//i, '');
                            const idx = rel.lastIndexOf('/');
                            const dir = idx >= 0 ? rel.slice(0, idx + 1) : '';
                            return `img/models/${dir}[name].[contenthash:8][ext]`;
                        },
                    },
                },
            ],
        },
        resolve: {
            alias: {
                three$: 'three/src/Three.js',
            }
        },
        plugins: [
            new webpack.DefinePlugin({
                VERSION: JSON.stringify(execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim()),
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
