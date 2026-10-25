const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const { execSync } = require('child_process')

module.exports = defineConfig({
    publicPath: '/dsp_blueprint_editor/',
    transpileDependencies: false,
    configureWebpack: {
        module: {
            rules: [
                {
                    test: /\/assets\//,
                    type: 'asset',
                }, {
                    test: /\/assets\/icons\/(item_recipe|signal|tech)\//,
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
