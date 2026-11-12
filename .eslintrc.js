module.exports = {
    root: true,
    env: {
        node: true,
        "vue/setup-compiler-macros": true,
    },
    parser: 'vue-eslint-parser',
    'extends': [
        'plugin:vue/vue3-essential',
        'eslint:recommended',
        '@vue/typescript/recommended'
    ],
    parserOptions: {
        ecmaVersion: 2020
    },
    rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off'
    },
    overrides: [
        {
            // lib 发布层必须保持「零 Vue 运行时依赖」：`src/command.ts` 顶层 import vue
            // （ref / 生命周期），虽然当前对它的引用都只是类型、构建时会被擦除，
            // 但一旦有人 import 了它的值成员，Vue 就会被打进 dist-lib。这里直接禁掉。
            files: ['src/lib/**/*.ts'],
            rules: {
                'no-restricted-imports': [
                    'error',
                    {
                        patterns: [
                            {
                                group: ['@/command', '**/command', 'vue', 'vue/*'],
                                message:
                                    'lib 发布层不得依赖 Vue 运行时或 src/command.ts；删除能力请复用 @/blueprint/removeBuilding 的命令类。'
                            }
                        ]
                    }
                ]
            }
        },
        {
            files: [
                '**/__tests__/*.{j,t}s?(x)',
                '**/tests/unit/**/*.spec.{j,t}s?(x)'
            ],
            env: {
                jest: true
            }
        }
    ]
}
