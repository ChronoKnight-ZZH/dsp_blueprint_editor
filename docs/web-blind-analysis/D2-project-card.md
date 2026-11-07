# D2 · 项目卡片模板 v1.0

> 用法：**一次性填写，长期复用**。每次开新对话时，第一粘贴=卡片，第二粘贴=本次相关文件，第三=需求。
> 填了卡片 → 模式进入【卡片态】（精度高、每轮输入少）。
> 不填/填不全 → 【裸态】，模式会显式声明精度受限并把无证据项降级为【需 Agent 确认】。
> 也可以不自己填：让 Web 端受限 AI 用 K9 主动问你（最多 5 问，可回"跳过"）。

---

## 卡片正文（整块复制使用）

```
=== 项目卡片 v1.1 | 生成日期 2026-11-07 ===

[1] 技术栈与运行时版本
    语言/运行时：Node 20（CI 使用；package.json 未声明 engines）【文档依据：§14.1】
    框架：Vue 3（^3.2.13）+ Vue CLI 5（~5.0.1，webpack 5）+ Three.js（^0.160.0）；双产物：SPA/PWA + UMD/ESM 无头库【文档依据：§2、§13】
    包管理器：yarn 1.x（yarn.lock 生效；CI cache: yarn；仓库同时存在 package-lock.json；dependencies 中声明 yarn ^1.22.22）【package.json 原文 + §2.1、§13.1】
    数据库与ORM：无【package.json 原文未出现数据库/ORM 依赖】

[2] 目录树（限定深度，只到本次任务可能触及的层级；★为默认禁改区）
    dsp_blueprint_editor/
    ├── src/
    │   ├── blueprint/          # 纯逻辑：parser.ts、md5.ts、planet.ts、reform.ts、stats.ts、命令类
    │   │   └── ★ parser.ts     # v1/v2 字节布局与 round-trip；改动需先问
    │   ├── lib/                # 发布库：index.ts、BlueprintViewer.ts、core/RenderCore.ts、preview/、assets/
    │   │   └── ★ index.ts      # 发布面刻意收窄；不得擅自改导出集合
    │   ├── models/             # GLB 加载/缓存/KTX2/材质/离线模型包
    │   │   └── ★ textureManifest.ts  # 当前为空清单，登记文件会改变构建资产图
    │   ├── components/         # Vue UI 组件（PascalCase.vue）
    │   ├── data/               # 静态数据表与生成产物
    │   │   └── ★ *Data.ts、color.ts、midi.ts、techIconsData.ts、signalIconsData.ts  # 生成产物
    │   ├── assets/icons/models/ ★ 73 个 GLB，约 128 MB；二进制素材禁改
    │   ├── locales/            ★ zh.json / en.json（由 i18n.py 生成）
    │   ├── App.vue、main.ts、command.ts、PlanetMapControls.ts、renderSettings.ts、cli.ts 等
    ├── tests/unit/             # Jest 单测；★ blueprint/fixtures/ 为测试样本，禁改
    ├── scripts/                # 构建/诊断/GLB-KTX2 管线；★ lib-build/build.js 改动需先问
    ├── public/basis/           ★ KTX2 转码器 basis_transcoder.js/.wasm，禁改
    ├── config/persistence.config.js  # 模型缓存开关；改动需先问
    ├── ★ package.json / yarn.lock / package-lock.json / tsconfig.json / vue.config.js / jest.config.js / babel.config.js / .eslintrc.js / .browserslistrc / .github/workflows/gh-pages.yml
    └── ★ dist/、dist-lib/、node_modules/  # 构建产物/依赖，不手改

[3] 依赖声明文件内容（原样粘贴 package.json / pyproject.toml / pom.xml 等）
    以下为 package.json 原文：

​```json
{
    "name": "dsp_blueprint_editor",
    "version": "1.5.0",
    "private": true,
    "main": "dist-lib/dsp-blueprint-editor.umd.js",
    "module": "dist-lib/dsp-blueprint-editor.esm.js",
    "types": "dist-lib/index.d.ts",
    "unpkg": "dist-lib/dsp-blueprint-editor.umd.js",
    "jsdelivr": "dist-lib/dsp-blueprint-editor.umd.js",
    "files": [
        "dist-lib"
    ],
    "scripts": {
        "serve": "vue-cli-service serve",
        "build": "node scripts/generate-update-log.js && vue-cli-service build",
        "build:lib": "node scripts/lib-build/build.js",
        "test:unit": "jest --watchAll",
        "test:preview": "jest tests/unit/preview",
        "lint": "vue-cli-service lint",
        "build-cli": "tsc --module commonjs --outDir cli",
        "cli": "ts-node -r tsconfig-paths/register -O \"{\\\"module\\\": \\\"commonjs\\\"}\" src/cli.ts",
        "i18n:report": "vue-cli-service i18n:report --src \"./src/**/*.?(js|vue)\" --locales \"./src/locales/**/*.json\"",
        "postinstall": "patch-package",
        "format": "prettier --write \"src/**/*.{js,ts,jsx,tsx,vue,json,css,scss,md}\"",
        "release": "standard-version --release-type minor --commit-message \"chore: release v%VERSION\"",
        "update-log": "node scripts/generate-update-log.js"
    },
    "standard-version": {
        "scripts": {
            "postchangelog": "node scripts/generate-update-log.js"
        }
    },
    "dependencies": {
        "baseline-browser-mapping": "^2.11.29",
        "caniuse-lite": "^1.0.30001816",
        "core-js": "^3.25.5",
        "dompurify": "^3.4.17",
        "marked": "^18.1.1",
        "pako": "^2.0.4",
        "three": "^0.160.0",
        "vue": "^3.2.13",
        "vue-i18n": "^9.1.0",
        "yarn": "^1.22.22"
    },
    "devDependencies": {
        "@babel/core": "^7.0.0",
        "@gltf-transform/cli": "^4.5.1",
        "@gltf-transform/core": "^4.5.1",
        "@gltf-transform/extensions": "^4.5.1",
        "@gltf-transform/functions": "^4.5.1",
        "@intlify/vue-i18n-loader": "^4.2.0",
        "@types/jest": "^29.1.2",
        "@types/node": "^26.6.4",
        "@types/pako": "^2.0.0",
        "@types/three": "^0.160.0",
        "@vue/cli-plugin-babel": "~5.0.1",
        "@vue/cli-plugin-eslint": "~5.0.1",
        "@vue/cli-plugin-pwa": "~5.0.1",
        "@vue/cli-plugin-typescript": "~5.0.1",
        "@vue/cli-service": "~5.0.1",
        "@vue/eslint-config-typescript": "^12.0.0",
        "@vue/test-utils": "^2.0.0-0",
        "@vue/vue3-jest": "^29.0.0",
        "babel-jest": "^29.0.0",
        "eslint": "^8.16.0",
        "eslint-plugin-vue": "^9.0.0",
        "jest": "^29.0.0",
        "patch-package": "^8.0.1",
        "sass": "^1.49.8",
        "sass-loader": "^13.0.0",
        "sharp": "^0.33.0",
        "ts-jest": "^29.0.0",
        "ts-node": "^10.5.0",
        "tsconfig-paths": "^4.2.0",
        "typescript": "^5.1.3",
        "vue-cli-plugin-i18n": "~2.3.2",
        "vue-eslint-parser": "^9.0.2",
        "vue-i18n-extract": "1.2.3",
        "webpack": "^5.0.0"
    },
    "compilerOptions": {
        "types": [
            "node"
        ],
        "moduleResolution": "node",
        "esModuleInterop": true
    }
}
​```

    【注意】package.json 中的 "compilerOptions" 不是 package.json 标准字段；TypeScript 实际读取 tsconfig.json。不要据此推断 tsconfig.json 被替代。

[4] 构建 / 测试 / lint 命令（必须真实可跑；以 package.json scripts 原文为准）
    安装：yarn install
    开发运行：yarn serve
    构建：yarn build（先 node scripts/generate-update-log.js，再 vue-cli-service build；产物 dist/）
    库构建：yarn build:lib（产物 dist-lib/，含 UMD/ESM/GLB/basis）
    单元/集成测试：yarn jest（一次性跑完，推荐用于验收）
    测试监视模式：yarn test:unit（实际是 jest --watchAll，不会自己退出；CI/无 TTY 不要用）
    预览相关测试：yarn test:preview（实际是 jest tests/unit/preview）
    静态检查：yarn lint（实际是 vue-cli-service lint）
    格式化：yarn format（脚本存在：prettier --write "src/**/*.{js,ts,jsx,tsx,vue,json,css,scss,md}"；但 package.json 的 dependencies/devDependencies 中均未声明 prettier，仓库也无 prettier 配置。默认不要运行，涉及格式化先问用户）
    CLI：yarn cli（ts-node -r tsconfig-paths/register -O "{\"module\": \"commonjs\"}" src/cli.ts）；yarn build-cli（tsc --module commonjs --outDir cli）
    更新日志：yarn update-log（node scripts/generate-update-log.js）
    i18n 报告：yarn i18n:report
    发版：yarn release（standard-version --release-type minor --commit-message "chore: release v%VERSION"；package.json 未声明 standard-version 依赖，默认不运行）
    postinstall：patch-package（仓库当前无 patches/ 时为空跑）
    期望成功标志：命令退出码 0；yarn jest 无 failed；yarn build 生成 dist/；yarn build:lib 生成 dist-lib/ 且脚本自检通过；yarn lint 无 error。

[5] 代码风格约定
    缩进/引号/分号：package.json 原文使用 4 空格缩进 + 双引号；其余源码以现有 .editorconfig / .eslintrc.js 为准（本次未提供原文）。【默认规则】不做风格性改写、不整体格式化。
    命名：文件多为 camelCase 与 kebab-case 混用；Vue 组件 PascalCase.vue；函数/变量 camelCase；类型/类 PascalCase；常量 UPPER_SNAKE。
    导入顺序与别名：@/ → src/*；@lib/asset-resolver 为精确别名（webpack 用 $）；three$ → three/src/Three.js。保持现有导入分组，不重排无关导入。
    注释语言：中文为主，保留现有注释；新增注释用中文。
    错误处理惯例：parser 抛中文 Error；glbLoader 永不 reject、失败返回 null；BlueprintViewer 公开方法不抛异常、返回 { ok, error }。【默认规则】改动必须保持所在模块现有错误契约，不改变公共 API 抛错/返回语义。
    日志与埋点惯例：现有使用 console.warn/info 并带 [glb]/[tex]/[env] 等前缀。【默认规则】禁止新增 console.log；必要日志用 console.warn/info 带模块前缀；不新增自动埋点。

[6] 禁改边界（★用户必填；以下为文档依据 + 默认规则，越界拦截）
    禁止修改文件：
      package.json、yarn.lock、package-lock.json、tsconfig.json、vue.config.js、jest.config.js、babel.config.js、.eslintrc.js、.browserslistrc、.github/workflows/gh-pages.yml
      public/basis/*、src/assets/icons/models/*.glb、src/locales/*.json
      src/data/*Data.ts、src/data/color.ts、src/data/midi.ts、src/data/techIconsData.ts、src/data/signalIconsData.ts
      src/models/textureManifest.ts、tests/unit/blueprint/fixtures/*
      config/persistence.config.js（需先问才能动）
    禁止改动目录：
      dist/、dist-lib/、node_modules/、public/basis/、src/assets/icons/models/、tests/unit/blueprint/fixtures/
    禁止行为：
      不得新增依赖；不得改公共接口签名/导出名；不得改 src/lib/index.ts 导出面；
      不得改 parser v1/v2 字节布局与 round-trip 字段（v2ExtraPose/content/extraBytes/tailExtraBytes/patch/reformData 等）；
      不得改命令 silent/merge 语义；不得改资产解析别名契约；不得改 workbox exclude / publicPath；
      不得改测试快照；不得整体格式化文件；不得改 GLB/KTX2 素材；不得把生成产物改成手写。
    需先问我才能动：
      src/blueprint/parser.ts 的字节格式；src/command.ts 的命令队列语义；src/lib/core/RenderCore.ts 的生命周期；
      src/models/modelCacheConfig.ts 与 config/persistence.config.js 的缓存开关；
      vue.config.js 的 publicPath / workbox / asset 规则；src/lib/index.ts 导出面；任何依赖变更。

[7] 常见单文件行数区间（用于出口 B 全量/局部路由）
    多数文件：约 80~300 行
    组件：约 100~400 行
    超大文件：src/blueprint/parser.ts 约 1566 行、src/PlanetMapControls.ts 约 917 行、src/lib/core/RenderCore.ts 约 992 行
    【默认规则】超大文件一律局部替换/最小 diff，不整体重写；组件不因风格问题整体重排。

[8] 卡片已知过期项/待复核（自我提醒）
    - package.json 已提供原文；版本类判断以 [3] 为准，不再凭记忆。
    - package.json 含非标准 "compilerOptions" 字段；TS 实际读取 tsconfig.json，不要据此推断 tsconfig.json 被替代。
    - prettier 未在 dependencies/devDependencies 中声明，仓库无 prettier 配置；yarn format 默认不可假定可跑，格式化需先问。
    - standard-version 未在 dependencies/devDependencies 中声明；yarn release 默认不运行，发版需先问。
    - marked / dompurify 仍在 dependencies，但源码当前未引用；不得据此推断要使用。
    - tests/unit/scripts/ 下部分脚本仍按旧路径假设（仓库根解析为 tests/unit），重跑前需修路径或确认。
    - src/components/SpitterInfo.vue 文件名与组件语义 SplitterInfo 不一致，是否有意保留待确认。
    - BlueprintViewer 默认主题注释写 dark，实现为 editor，注释与实现不一致。
    - 发布库 src/lib/** 未注入环境反射，getBuildingEnvironment() 在库侧恒为 null。
    - textureManifest.ts 当前恒为空清单；effect/dirt/glass 通道素材未提供。
    - belt-1/2/3.glb 为 148 字节空 GLB，传送带实际回退元数据盒；是否误删待确认。
    - 9 个 modelIndex 缺 buildingMeta：47/48/117/372/448/449/450/451/452。
    - src/lib/index.ts 顶部注释称 ESM 外置 three，实际构建脚本两个产物都内联 three。
    - yarn test:unit 是 --watchAll，不是一次性执行；验收用 yarn jest。
    - demo 入口未提交，vue.config.js 的 demo 页条件注册当前不生效。
```

---

## 卡片质量自检（贴之前对着看）

| 检查 | 不合格表现 | 后果 |
|---|---|---|
| [3] 是否原样粘贴真实依赖文件 | 凭记忆写版本号 | 版本类改动全部降级为 `[E5]`，方案不可信 |
| [4] 命令是否真跑过 | 写了不存在的脚本名 | 验证契约失效，回归验证无法闭环 |
| [6] 是否留空 | 空 | 执行方越界**无据可拦**，省下的 token 会被返工吃掉 |
| [2] 是否只贴了顶层 | 缺二级目录 | 锚点定位到错误文件，触发大量"未找到"停止项 |
| 版本/日期 | 无 | 无法判断卡片过期（项目已漂移而你在用旧地图） |

## 维护规则（对应 F2）

- 目录结构、依赖、构建命令任一变化 → 卡片版本号 +0.1，日期更新。
- 建议复核节奏：每 2 周，或每 5 次使用后（按你项目改动速度定）。
- 卡片不需要覆盖整个项目：只覆盖**你可能让 AI 改的那部分**即可。
