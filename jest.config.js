const { buildInventory } = require('./scripts/lib-build/assetInventory');

module.exports = {
    moduleFileExtensions: ["js", "ts", "json", "vue"],
    transform: {
        "^.+\\.jsx?$": "babel-jest",
        "^.+\\.tsx?$": ["ts-jest", { babelConfig: true }],
        "^.+\\.vue$": "@vue/vue3-jest"
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // 资产解析层：单测里没有 webpack，统一走 runtime 实现（纯字符串拼接）
        '^@lib/asset-resolver$': '<rootDir>/src/lib/assets/assetResolver.ts',
        // 贴图在单测里不需要真实解码，统一给个字符串替身
        '\\.(png|jpe?g|gif|webp|ktx2)$': '<rootDir>/tests/unit/fileMock.js',
    },
    globals: {
        // runtime 资产解析器靠「构建期注入的清单」判断文件是否存在；
        // 单测没有构建步骤，这里用同一套磁盘扫描逻辑注入（见 lib-build/assetInventory.js）
        __DSP_LIB_ASSET_INVENTORY__: buildInventory(__dirname),
    },
}
