module.exports = {
    moduleFileExtensions: ["js", "ts", "json", "vue"],
    transform: {
        "^.+\\.jsx?$": "babel-jest",
        "^.+\\.tsx?$": ["ts-jest", { babelConfig: true }],
        "^.+\\.vue$": "@vue/vue3-jest"
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // 贴图在单测里不需要真实解码，统一给个字符串替身
        '\\.(png|jpe?g|gif|webp|ktx2)$': '<rootDir>/tests/unit/fileMock.js'
    },
}
