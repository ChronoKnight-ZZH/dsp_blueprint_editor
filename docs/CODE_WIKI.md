# Code Wiki · dsp\_blueprint\_editor

> 戴森球计划（Dyson Sphere Program, DSP）蓝图预览与编辑工具
> 一套「Vue 3 + Three.js 单页应用」+「可嵌入的无头库（UMD / ESM）」双形态前端工程：把游戏蓝图字符串解析为结构化数据，在 3D 星球网格上渲染建筑、地基与货物动画，支持头部信息与建筑参数编辑、批量替换、建筑升降级、生产统计、撤销/重做，并可与游戏的 v1 / v2 蓝图格式做字节级 round-trip。发布层 `BlueprintViewer` 额外提供增量预览（preview-delta）、主题、JSON 导入导出与模型本地缓存。

***

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [整体架构](#3-整体架构)
4. [目录结构](#4-目录结构)
5. [主要模块职责](#5-主要模块职责)
6. [关键类与函数说明](#6-关键类与函数说明)
7. [蓝图二进制格式与参数编解码](#7-蓝图二进制格式与参数编解码)
8. [3D 渲染与交互](#8-3d-渲染与交互)
9. [命令系统与撤销/重做](#9-命令系统与撤销重做)
10. [数据与资源模块](#10-数据与资源模块)
11. [国际化](#11-国际化)
12. [测试体系](#12-测试体系)
13. [运行与构建方式](#13-运行与构建方式)
14. [CI/CD 与部署](#14-cicd-与部署)
15. [附：关键概念速查表](#15-附关键概念速查表)
16. [建筑模型渲染系统（GLB + 内嵌 KTX2 贴图）](#16-建筑模型渲染系统glb--内嵌-ktx2-贴图)

***

## 1. 项目概览

| 项目 | 说明 |
| ---- | ---- |
| 名称 | `dsp_blueprint_editor` |
| 版本 | `1.5.0`（`package.json`；构建期再由 `git describe --tags --always --dirty` 注入 `VERSION`，显示在侧栏页脚） |
| 私有 | 是 —— `private: true`，不作为 npm 包发布；但产物形态已按「可发布库」配好：`main` / `module` / `types` / `unpkg` / `jsdelivr` 全部指向 `dist-lib/`，`files: ["dist-lib"]` |
| 类型 | 双产物：①可独立部署的单页应用（PWA，部署在 GitHub Pages 子路径 `/dsp_blueprint_editor/`）；②可嵌入第三方页面的 UMD / ESM 库 |
| SPA 入口 | `src/main.ts` → `App.vue` |
| 库入口 | `src/lib/index.ts`（`yarn build:lib` → `dist-lib/`） |
| 渲染 | Three.js WebGL：星球网格（按相机距离切 LOD）+ 实例化建筑 + 图标图集 + GLB 模型 / KTX2 内嵌贴图 + 地基网格 |
| 状态 | Vue 3 Composition API + `provide/inject`（`rendererKey` / `commandQueueKey` / `buildingInfoKey`）+ `CommandQueue`（256 步撤销栈、支持命令合并） |
| 兼容 | 戴森球计划蓝图 v1（旧版）与 v2（0.10.30+ 直至 0.10.34+）字节级 round-trip |
| 部署 | `.github/workflows/gh-pages.yml`：push `master` → `yarn install && yarn build` → GitHub Pages |

**核心能力**：

- **蓝图解析与 3D 渲染**：`BLUEPRINT:` + base64(gzip(body)) + 32 位 MD5 校验的字符串 ↔ `BlueprintData` 双向转换（`blueprint/parser.ts`），渲染到 3D 星球表面。
- **信息面板编辑（头部）**：图标布局、缩略图文字、图标槽（`BlueprintIcon` + `IconPickerModal`）、作者、蓝图版本、`properties`（增删属性键值对）、蓝图介绍。
- **信息面板编辑（建筑详情）**：点选建筑后由 `BuildingInfoPanel` 按建筑类型分派到子面板 —— `StationInfo`（物流塔，可改栏位内容与参数，内部有 `SetStationStorageItemCommand` / `SetStationParamCommand`）、`HoloBeaconInfo`（全息信标文本，`SetBeaconContentCommand`）、`SpitterInfo`（四向分流器，在代码中注册为 `SplitterInfo`）、`MonitorInfo`、`DispenserInfo`、`BattleBaseInfo`、`StorageInfo`；其余参数（配方 `BuildingRecipe`、增产剂效果、分拣长度、轨道、模式、储液罐进出口等）为只读展示。
- **3D 场景点选建筑**：左键射线拾取（BVH）选中并高亮，`App.vue` 据此展开侧栏并给出建筑详情；右键点选按 `RemoveBuildingCommand` 剔除单栋建筑（可撤销）。
- **按物品整类剔除**：侧栏「包含设施」图标右键 → `RemoveBuildingsByItemCommand` 一次删掉该 itemId 的全部建筑（可撤销）。
- **批量替换**（`ReplaceModal`，范围可多选）：配方、分拣器筛选、物流塔栏位、传送带图标、蓝图图标，以及建筑升降级（`UpgradeCommand`，支持跳级与降级）。
- **加速模式切换**：批量替换时附带「生产模式」（不改变 / 额外产出 / 生产加速），由 `SetAcceleratorCommand` 只作用于被替换到的建筑；单栋建筑的增产剂效果在 `BuildingInfoPanel` 中为只读展示。
- **建筑多选**：多选高亮与批量定位能力在共享层/发布层（`RenderCore.setSelectedIndexes()`、`BlueprintViewer.selectedBuildings()`、`RemoveBuildingsCommand`）；编辑器侧当前的点选交互仍是单选（多选 UI 尚未接入）。
- **生产统计**（`ProductionStats.vue` + `blueprint/stats.ts`）：按理论满速计算每种物品的每分钟产出 / 消耗 / 净值、总功耗，可选增产剂等级（Mk.I~III / 无）与是否计入喷涂。
- **地基渲染**（`blueprint/reform.ts`）：解析 v2 `reformData` 矩形，按工字铺 / 直铺 / 无装饰三类样式渲染地基（仅渲染，不含逐格编辑）。
- **撤销 / 重做**：`CommandQueue` 256 步，快捷键 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y；命令可声明 `silent`（纯数据变更只递增 `stateVersion`，不重建 3D）。
- **蓝图字符串通道**：文本框直接粘贴、「粘贴」按钮读系统剪贴板、「复制」按钮写系统剪贴板（文本框内 Ctrl+C / Ctrl+X 也走同一条 `toStr` 生成路径）、「选择文件」读 `.txt`、把 `.txt` 拖到「蓝图代码」文本框、`prepareSave()` 生成 Blob 下载 `.txt`。
- **渲染高级设置**（`renderSettings.ts`）：展示真实模型、贴图总开关与 7 个通道开关、每模型最大实例数（含「无限」档），保存于 sessionStorage，重新导入蓝图后生效。
- **离线模型包**：设置面板「高级」里一键下载并持久化全部建筑模型（73 个 GLB，约 128 MB），落盘在 Cache Storage，支持取消与断点续传。
- **中英双语**：`vue-i18n` + `locales/zh.json` / `en.json`，物品/配方名走 `itemName()` / `recipeName()`；语言可选自动 / English / 中文。
- **PWA + 更新日志弹窗**：`@vue/cli-plugin-pwa` 生成 service worker；`swStatus.vue` 监听更新并提供刷新，同时从 `public/update-log.json` 拉取最新日志弹窗展示（24 小时内可「稍后提醒」）。
- **可嵌入的无头 `BlueprintViewer`**：`src/lib/` 提供的类实例渲染器 —— 加载字符串/数据/JSON、增量预览 `preview-delta`（`beginPreview` / `applyPreviewDelta` / `commitPreview` / `discardPreview` / `previewStats`）、主题切换（dark / light / editor）、相机与尺寸控制、选中与定位、截图（`toDataURL` / `toBlob`）、JSON 导入导出、模型本地缓存开关。

**已移除的能力（旧文档描述已过期，勿据此阅读代码）**：

- 新建建筑 / 铺传送带 / 放分拣器 / 建筑放置与删除模式 —— `src/editor/`（`placementState.ts`、`scene.ts`）已整体删除，源码中不存在。
- 地基逐格编辑与自定义 RGBA 色槽、照片 → 地基蓝图（像素画）—— `blueprint/reformEdit.ts`、`blueprint/reformImage.ts`、`data/color.ts` 的色槽 UI 链路、`ReformColorDialog.vue` 均已删除；现仅保留地基**渲染**。
- 使用教程弹窗（`docs/功能说明.md` + marked + DOMPurify 渲染链路）—— `TutorialModal.vue` 已删除；`marked` / `dompurify` 仍留在 `dependencies` 但源码无引用（见 §2）。
- 建筑面板选型（`BuildingPalette.vue`）、快捷键提示（`ShortcutHint.vue`）已删除。

***

## 2. 技术栈与依赖

以下两表逐条对应 `package.json` 现状：`dependencies` 共 10 条、`devDependencies` 共 34 条。

### 2.1 运行时依赖

| 包 | 版本 | 用途 |
| ---- | ---- | ---- |
| `vue` | `^3.2.13` | 响应式 UI 框架（Composition API、`provide/inject`、`defineAsyncComponent`） |
| `three` | `^0.160.0` | 3D 渲染；webpack 用 `three$ → three/src/Three.js` 别名引用未打包源码 |
| `pako` | `^2.0.4` | 蓝图 body 的 gzip 解压（`ungzip`）与再压缩（`gzip`） |
| `vue-i18n` | `^9.1.0` | 国际化（`legacy: false`，`locales/zh.json` + `en.json`） |
| `core-js` | `^3.25.5` | ES polyfill：`@vue/cli-plugin-babel/preset` 按 `.browserslistrc`（`> 1%`、`last 2 versions`、`not dead`、`not ie 11`）注入按需 polyfill |
| `marked` | `^18.1.1` | **已声明、当前源码未引用**（原「使用教程弹窗」的 Markdown 渲染依赖，`TutorialModal.vue` 删除后成孤儿） |
| `dompurify` | `^3.4.17` | **已声明、当前源码未引用**（同上，原用于净化 Markdown 渲染出的 HTML） |
| `baseline-browser-mapping` | `^2.11.29` | 未在源码/脚本中引用；属 browserslist 数据链（`@vue/cli-service` → autoprefixer/postcss 预设）的浏览器基线数据，显式提升为直接依赖以保证构建期数据版本可选 |
| `caniuse-lite` | `^1.0.30001816` | 同上，未在源码/脚本中引用；browserslist 的 caniuse 数据源，显式声明以固定特性支持表版本 |
| `yarn` | `^1.22.22` | 未在源码/脚本中引用；仅为仓库统一 yarn 1.x 工具链（CI `cache: 'yarn'`、`yarn.lock`）而随依赖声明 |

> ⚠️ 待确认：`baseline-browser-mapping`、`caniuse-lite`、`yarn` 三条在仓库内找不到 `import` / `require` / 脚本调用，只能按传递依赖与工具链推定其存在理由；若后续清理 `dependencies`，需先确认 `@vue/cli-service` 的 browserslist 解析是否依赖它们被显式装上。

### 2.2 开发依赖（关键）

| 包 | 版本 | 用途 |
| ---- | ---- | ---- |
| `@vue/cli-service` | `~5.0.1` | SPA 构建 / 开发服务器（`yarn serve` / `yarn build`），webpack 5 内核 |
| `@vue/cli-plugin-babel` | `~5.0.1` | Babel 转译（配合 `@babel/core` 与 `core-js`） |
| `@babel/core` | `^7.0.0` | Babel 编译核心（`@vue/cli-plugin-babel` 的 peer） |
| `@vue/cli-plugin-typescript` | `~5.0.1` | SFC + TS 接入 webpack 编译（含类型检查） |
| `@vue/cli-plugin-eslint` | `~5.0.1` | `yarn lint` |
| `@vue/cli-plugin-pwa` | `~5.0.1` | Workbox service worker 与 manifest 生成 |
| `vue-cli-plugin-i18n` | `~2.3.2` | i18n 报告（`yarn i18n:report`）与 `pluginOptions.i18n` 支持 |
| `@intlify/vue-i18n-loader` | `^4.2.0` | SFC `<i18n>` 块与 JSON locale 加载 |
| `vue-i18n-extract` | `1.2.3` | 抽取源码中的 i18n key 生成报告 |
| `typescript` | `^5.1.3` | 类型系统：`tsconfig.json`（`strict: true`，`@/*` 与 `@lib/asset-resolver` 路径映射）；`yarn build-cli` 用 `tsc --module commonjs --outDir cli` |
| `ts-node` | `^10.5.0` | `yarn cli` 直接运行 `src/cli.ts`（不预编译） |
| `tsconfig-paths` | `^4.2.0` | `yarn cli` 时解析 `@/*` 别名 |
| `webpack` | `^5.0.0` | 构建引擎；`scripts/lib-build/build.js` 也直接用它的 Node API 打库（仓库未装 `webpack-cli`） |
| `jest` | `^29.0.0` | 单元测试运行器（`tests/unit/**`） |
| `ts-jest` | `^29.0.0` | TS 测试用例转译（`jest.config.js` 中 `^.+\.tsx?$`，`babelConfig: true`） |
| `@vue/vue3-jest` | `^29.0.0` | Vue 3 SFC 测试转译 |
| `babel-jest` | `^29.0.0` | Babel 转译路径（与 ts-jest 并存） |
| `@vue/test-utils` | `^2.0.0-0` | 组件测试挂载工具 |
| `@types/jest` | `^29.1.2` | Jest 类型声明 |
| `@types/node` | `^26.6.4` | Node 类型声明（构建脚本、`process.env` 等） |
| `@types/three` | `^0.160.0` | Three.js 类型声明（版本与运行时一致） |
| `@types/pako` | `^2.0.0` | pako 类型声明 |
| `eslint` | `^8.16.0` | 代码检查引擎 |
| `eslint-plugin-vue` | `^9.0.0` | Vue 规则集 |
| `@vue/eslint-config-typescript` | `^12.0.0` | TS + Vue 的 eslint 预设 |
| `vue-eslint-parser` | `^9.0.2` | `.vue` 文件 AST 解析 |
| `sass` | `^1.49.8` | SCSS 编译（`<style lang="scss">`） |
| `sass-loader` | `^13.0.0` | webpack ↔ sass 桥接 |
| `patch-package` | `^8.0.1` | `postinstall` 自动应用 `patches/` 下的 node_modules 补丁（当前仓库无 `patches/` 目录，等于空跑） |
| `@gltf-transform/cli` | `^4.5.1` | KTX2 流水线阶段 2 调用（`scripts/glb-ktx2/02-encode-ktx2.mjs` 通过它做 `toktx` 编码） |
| `@gltf-transform/core` | `^4.5.1` | 读取 / 改写 GLB 文档与贴图（阶段 1 贴图内嵌、阶段 3 校验） |
| `@gltf-transform/extensions` | `^4.5.1` | 注册 `KHRONOS_EXTENSIONS`（含 `KHR_texture_basisu`） |
| `@gltf-transform/functions` | `^4.5.1` | GLB/贴图处理工具函数 |
| `sharp` | `^0.33.0` | 阶段 1 把外置通道贴图打包、缩放、合成进 GLB 前的像素运算 |

> `marked` / `dompurify` 不属于此表：它们仍在 `dependencies`，但源码已无引用（见 §2.1）。

### 2.3 构建期注入常量与模块别名

`vue.config.js` 与 `scripts/lib-build/build.js` 各自 `DefinePlugin` 注入，二者共用 `config/persistence.config.js`：

| 常量 / 别名 | 值来源 | 作用 |
| ---- | ---- | ---- |
| `VERSION` | `git describe --tags --always --dirty` | 侧栏页脚版本号（`src/define.ts` 导出 `version`） |
| `__DSP_TRANSCODER_BASE__` | `publicPath + 'basis/'` | 运行时 `KTX2Loader.setTranscoderPath()` 的目录（末尾带斜杠） |
| `__DSP_MODEL_BYTES__` | `scripts/lib-build/assetInventory.js` 的 `buildModelBytes()` 扫描磁盘 | 构建期「模型名 → 字节数」清单，运行时零请求算出未下载模型的总体积 |
| `__DSP_MODEL_CACHE_ENABLED__` | `config/persistence.config.js` 的 `web`（编辑器）/ `lib`（库） | 模型本地持久化全局开关，关闭时 `modelCache.ts` 返回空操作缓存对象 |
| `publicPath` | 常量 `PUBLIC_PATH = '/dsp_blueprint_editor/'` | 同时决定部署子路径与 Basis 转码器目录 |
| `pages` | `index` → `src/main.ts` + `public/index.html`；`demo` 页仅在 `demo/main.ts` 存在时注册 | 多页构建；仓库中 `demo/` 入口未提交，因此默认只出一个页面 |
| `three$` 别名 | `three/src/Three.js` | 引用未打包的 Three 源码（按需 tree-shake） |
| `@lib/asset-resolver$` 别名 | `src/lib/assets/assetResolver.webpack.ts` | 编辑器构建走 webpack 资产解析；库构建按同一别名的 `$` 精确匹配切到 runtime 实现（纯字符串拼接 + 外置资产）；`tsconfig.json` 与 `jest.config.js` 则映射到 runtime 实现 `assetResolver.ts` |

PWA 侧 `workboxOptions.exclude` 显式排除 `models/`、`update-log.json`、`img/icons/`、`demo/` 等，其余默认排除项原样保留（该数组会整体覆盖插件默认值）。构建期注入的资产规则（`asset` / `asset/resource`、`models/[name].[contenthash:8].glb`）见第 16 章。

***

## 3. 整体架构

主干：`main.ts` → `App.vue`（Vue GUI 外壳）→ 命令层 → `BlueprintEditor.vue`（渲染与拾取）→ `src/blueprint/`（纯逻辑）→ 共享数据层。

```
┌────────────────────────────────────────────────────────────────────┐
│main.ts → createApp(App).use(i18n).mount("#app")                    │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│App.vue   （Vue GUI / 编辑器外壳）                                  │
│  侧栏 3 个 Tab：信息 / 操作 / 统计                                 │
│  provide: rendererKey / commandQueueKey / buildingInfoKey          │
└────────────────────────────────────────────────────────────────────┘
                              │  命令 push / undo / redo（v-model:selectedBuildingIndex）
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│命令层  src/command.ts                                              │
│  CommandQueue（256 步 + merge）→ 命令：replace / upgrade /         │
│  removeBuilding / setAccelerator / setBeaconContent                │
│  Updater（5 个增量通道）→ 局部刷新，不重建场景                     │
└────────────────────────────────────────────────────────────────────┘
                              │  stateVersion → 蓝图代码过期
                              │  execVersion  → 整场景重建
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│BlueprintEditor.vue   （webpackChunkName: "renderer" 异步分包）     │
│  Scene + PerspectiveCamera + PlanetMapControls + skyGradient       │
│    lib/core/planetScene.ts      星球 / 网格 / 灯光 / 网格 LOD      │
│    lib/core/buildBuildings.ts   建筑实例 + 图标 + 货物动画         │
│    lib/core/buildBVH.ts         射线拾取（点选 / 右键剔除）        │
│    blueprint/reform.ts          地基矩形渲染                       │
│    models/*                     GLB / KTX2 / 通道贴图 / 本地缓存   │
└────────────────────────────────────────────────────────────────────┘
                              │  读 / 写 BlueprintData
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│src/blueprint/   （纯逻辑，无 Three.js 依赖 → CLI / 单测可直接调用）│
│  parser.ts   fromStr / toStr（v1 + v2 双格式，字节级 round-trip）  │
│  planet.ts   区域定位 → 建筑变换                                   │
│  reform.ts 地基 · stats.ts 生产统计 · buildingInfo.ts 建筑索引     │
└────────────────────────────────────────────────────────────────────┘
                              │  依赖
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│共享数据层                                                          │
│  data/          items recipes building icons midi color …          │
│  locales/       zh.json / en.json                                  │
│  assets/icons/  item_recipe 192 · signal 41 · tech 323             │
│                 models 73 GLB（约 128 MB）                         │
└────────────────────────────────────────────────────────────────────┘
```

并列的发布层（`yarn build:lib` → `dist-lib/`，与编辑器共用同一份源码与开关）：

```
┌────────────────────────────────────────────────────────────────────┐
│src/lib/index.ts   （发布面：刻意收窄，无任何写死 UI）              │
│  BlueprintViewer → lib/core/RenderCore.ts                          │
│                    （发布层唯一的场景装配器）                      │
│    ├─ lib/core/buildBuildings.ts / buildBVH.ts                     │
│    ├─ lib/core/planetScene.ts / AllBuildings.ts / theme.ts         │
│    ├─ lib/preview/PreviewLayer.ts   增量预览 preview-delta         │
│    └─ lib/blueprintJSON.ts          JSON 导入导出                  │
│  parseBlueprint / serializeBlueprint → blueprint/parser.ts         │
│  configureAssetBaseUrl                → lib/assets/assetBaseUrl.ts │
│  setModelCacheEnabled / isModelCacheEnabled                        │
│                                       → models/modelCacheConfig.ts │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│与编辑器共用同一份：src/blueprint/** · src/data/** ·                │
│src/models/** · src/renderSettingsTypes.ts                          │
│config/persistence.config.js（模型缓存开关）                        │
└────────────────────────────────────────────────────────────────────┘
```

**关键架构特点**

1. **解析与渲染解耦**：`src/blueprint/parser.ts` 是纯逻辑层，只依赖 `pako` 与 `md5.ts`，不 import Three.js，因此 `yarn cli`（`ts-node`）与 Jest 单测可直接调用 `fromStr` / `toStr`。
2. **响应式驱动重建**：`CommandQueue` 暴露两套版本号 —— `stateVersion`（任何命令都自增，供 `App.vue` 判定蓝图代码过期）与 `execVersion`（仅非 `silent` 命令自增，供渲染层整场景重建）。`BlueprintEditor.vue` 用 `computed` 读 `execVersion` / `commandQueue.data` 生成建筑、BVH、地基，再由 `watchEffect` 在 `onCleanup` 里卸载并 `dispose()` 旧对象 —— 即"先构建、后替换"的原子交换；构建抛错时旧模型仍在场景里。
3. **`Updater` 增量通道**：`src/command.ts` 的 `Updater`（基于自带 `EventDispatcher`）提供 `updateBuildingIcon` / `updateBeltIcon` / `updateBeltIconSubscript` / `updateSorterIcon` / `updateStationInfo` 五个通道，纯图标/颜色/文字类命令声明 `silent: true` 只走局部刷新，不重建整场景；场景重建前 `clearAll()` 清掉陈旧回调，避免引用已销毁的 `AllBuildings`。
4. **字节级 round-trip**：v2 body 对未知扩展字段（`v2ExtraPose`、`content`、`extraBytes`、`tailExtraBytes`）以"原样保留 + 重新写出"方式处理，`toStr()` 再补齐 32 位 MD5 校验，保证导出的二进制与原蓝图逐字节一致；`src/lib/blueprintJSON.ts` 单独处理 `header.time`（Date）与 `buildings[].extraBytes`（Uint8Array）这两种不能直接 JSON 往返的字段。
5. **发布面刻意收窄**：`src/lib/index.ts` 只导出 `BlueprintViewer`、`parseBlueprint` / `serializeBlueprint`（`parser` 的 `fromStr` / `toStr` 别名）、`configureAssetBaseUrl`、`isModelCacheEnabled` / `setModelCacheEnabled` 与纯类型；`describeBuild` 等诊断能力留在 `@/lib/core/**` 源码路径，不进发布面。库产物 UMD 内联 Three（全局名 `DSPBlueprintEditor`），ESM 亦内联，宿主零运行时依赖。
6. **预览层与正式场景分离**：`lib/preview/PreviewLayer.ts` 只在 `RenderCore` 内被创建，由 `BlueprintViewer.beginPreview()` 打开；它不产生 `BlueprintData`，增量事件走"摄入 ingest（同步改 SoA 数组，不碰 GPU）+ 呈现 present（每帧指数收敛、只写脏槽与 `addUpdateRange`）"两段，`sequence` 去重、`remove` 缺失静默忽略、`replace` 缺失按 `add` 处理、存活 <120ms 的对象不出场；`commitPreview(blueprint)` 才切换成正式加载。
7. **模型缓存与 KTX2 内嵌贴图**：贴图已内嵌进 GLB 并统一转 KTX2（`KHR_texture_basisu`），外置贴图目录已删除；运行时 `models/ktx2.ts` 懒加载 Basis 转码器并按 GPU 能力 `detectSupport()`。模型按需懒加载（并发闸门 + 负缓存），成功后写入 Cache Storage（键为带 `[contenthash:8]` 的最终 URL，无需版本表）；开关关闭或环境不支持时退化为 `NoopModelCache`，调用方无需分支。
8. **编辑器与库共用渲染内核，但装配器不同**：`BlueprintEditor.vue` 直接调用 `lib/core/` 的 `buildBuildings` / `buildBVH` / `planetScene` / `AllBuildings` 自行装配场景（为了编辑态的选择框、右键剔除、相机控件）；`lib/core/RenderCore.ts` 只被 `BlueprintViewer` 使用，是发布层的场景装配门面。二者共享同一套 `models/` 与 `renderSettingsTypes.ts`。
9. **双产物同源**：编辑器与库共用 `src/` 与 `config/persistence.config.js`，差别只在构建脚本注入的 `__DSP_MODEL_CACHE_ENABLED__`、资产解析别名（webpack vs runtime）与资产根探测方式（`publicPath` vs `import.meta.url` / `<script src>`）。
10. **PWA + 离线**：`vue.config.js` 配置 `@vue/cli-plugin-pwa`，Workbox 显式排除 `models/`（73 个 GLB 约 128 MB，不得进 precache）与 `update-log.json`（必须每次取最新）；`swStatus.vue` 处理更新提示与更新日志弹窗。

***

## 4. 目录结构

仓库同时产出两类东西：**可独立部署的 SPA**（`yarn build` → `dist/`，GitHub Pages 部署在 `/dsp_blueprint_editor/`）与**可发布的库**（`yarn build:lib` → `dist-lib/`，UMD 内联 three、ESM 外置 three）。因此目录也分成「应用侧（`src/` 的 UI + 数据 + 渲染）」与「发布侧（`src/lib/` 无头门面）」两半，下面先给仓库顶层（含 `public/`、`scripts/`、`tests/`、`docs/`），再单独展开 `src/`。

### 4.1 仓库顶层与外围目录

```
dsp_blueprint_editor/                     # 仓库根（vue-cli 5 + TypeScript + Three.js）
├── .github/
│   └── workflows/gh-pages.yml            # CI：master 推送 → node 20 + yarn install/build → 上传 dist/ → 部署 GitHub Pages
├── .screenshots/                         # 截图工具临时目录（当前只有空目录 .tmp/）
├── config/
│   └── persistence.config.js             # 模型本地缓存全局开关 { web: true, lib: false }；两套构建各自编译成 __DSP_MODEL_CACHE_ENABLED__
├── data/                                 # 预览层需求文档与实测样本（20 个文件，非运行时代码）
│   ├── 蓝图预览方案.md                    # 增量预览总体方案（坐标体系/事件契约/动画策略）
│   ├── 1. 需求理解摘要.md
│   ├── 2. 需求确认与补充说明.md
│   ├── 3. 需求更新-v2-同步跟随与开关方案.md
│   ├── 4. 多份源文件体检报告与契约问题清单.md
│   ├── 5. 后端修改需求-T1T2.md
│   ├── 5. 实施记录-v1-预览层与增量接口.md
│   ├── preview-fixture.json              # 基准 fixture（小样本）
│   ├── preview-fixture-<8位哈希>-<13位时间戳>.json   # 6 份真实会话导出的 fixture
│   └── preview-delta-<8位哈希>-<13位时间戳>.json     # 与上面一一对应的 6 份增量事件流
├── dist/                                 # yarn build 产物（315 个文件，约 143 MB）：PWA SPA（含 SW/manifest）+ models/basis/img 资产副本
├── dist-lib/                             # yarn build:lib 产物（656 个文件，约 142 MB）：UMD/ESM/index.d.ts + models/img/basis/fixtures
├── docs/
│   ├── CODE_WIKI.md                      # 本文档
│   ├── 功能说明.md                        # 旧版使用教程正文（当前源码已无任何引用）
│   ├── lib-README.md                     # 发布库的宿主接入说明（导出面 / 资产地址 / 缓存开关）
│   ├── wiki/                             # 另一套分主题维基（14 个文件）
│   │   ├── getting-started.md            # 安装与最小示例
│   │   ├── architecture.md               # 分层架构总览
│   │   ├── api.md                        # 对外 API 参考
│   │   ├── diagrams/
│   │   │   ├── class-diagrams.md         # 类图
│   │   │   └── sequence-diagrams.md      # 时序图
│   │   ├── images/diagram.svg            # 架构图
│   │   └── modules/                      # 模块说明 8 篇
│   │       ├── blueprint-core.md         # 蓝图解析与序列化
│   │       ├── command-system.md         # 命令与撤销重做
│   │       ├── data-layer.md             # 数据表与图标
│   │       ├── 3d-rendering.md           # 渲染管线
│   │       ├── building-operations.md    # 建筑操作
│   │       ├── reform-system.md          # 地基
│   │       ├── image-to-blueprint.md     # 照片 → 蓝图
│   │       └── ui-components.md          # UI 组件
│   ├── images/                           # 5 张配图：01-overview、02-drag-drop、02-parse-error、03-pin-button、03-sidebar-tabs
│   ├── growingTree/                      # 需求过程文档 5 份（与 data/ 下 1.~5. 同名，路径不同）
│   └── DSH日志/                          # 3 个过程记录压缩包：git分支合并 / 打包代码日志 / 构建库
├── node_modules/                         # 依赖安装目录
├── public/                               # SPA 静态资源（构建时整目录拷入 dist/）
│   ├── basis/
│   │   ├── basis_transcoder.js           # KTX2/Basis 转码器（由 scripts/glb-ktx2/copy-basis-transcoder.mjs 拷入）
│   │   └── basis_transcoder.wasm
│   ├── demo/
│   │   ├── preview-fixture.json          # 在线预览演示用 fixture
│   │   ├── sample_throughput.json        # 吞吐示例
│   │   └── sample_throughput.txt         # 吞吐示例（蓝图字符串形态）
│   ├── img/icons/                        # PWA 图标 7 个：chrome 192/512、apple-touch、favicon 16/32/svg、safari-pinned-tab
│   ├── favicon.ico
│   ├── index.html                        # vue-cli 页面模板（SPA 入口）
│   ├── robots.txt
│   └── update-log.json                   # scripts/generate-update-log.js 生成的更新日志（不在 SW precache 内）
├── scripts/                              # 构建与诊断脚本（34 个文件，不进最终产物）
│   ├── generate-update-log.js            # CHANGELOG.md → public/update-log.json（yarn update-log，build 前置执行）
│   ├── glb-ktx2/                         # 模型资源流水线 6 个文件
│   │   ├── 01-embed-textures.mjs         # 把外置贴图内嵌进 GLB
│   │   ├── 02-encode-ktx2.mjs            # 贴图统一转 KTX2（UASTC + zstd）
│   │   ├── 03-verify.mjs                 # 产物校验（尺寸/扩展声明/贴图完整性）
│   │   ├── copy-basis-transcoder.mjs     # 拷贝 basis 转码器 → public/basis/
│   │   ├── ktx2-demo.html                # 转码器加载验证页
│   │   └── README.md                     # 流水线用法与参数
│   ├── http/                             # 本地起服务 + 运行时诊断 19 个文件
│   │   ├── serve.mjs                     # 极简静态服务器，把 dist 挂在 /dsp_blueprint_editor/ 下模拟 Pages
│   │   ├── e2e.mjs                       # 通用 E2E：塞入指定蓝图，统计 GLB/贴图错误并截图
│   │   ├── cdp-run.mjs                   # CDP 驱动无头 Edge，等模型加载+渲染完成后截图取日志
│   │   ├── cdp-app.mjs                   # 端到端：打开 dist，经 #blueprint-file 塞蓝图，收集 console/网络错误
│   │   ├── cdp-app2.mjs                  # 诊断版：抓全部 console、全部资源与未处理拒绝原因
│   │   ├── cdp-shot.png                  # 上面脚本的截图产物
│   │   ├── dom.html                      # 抓取下来的 DOM 快照
│   │   ├── chunk-scan.mjs                # 扫描 dist/js 分包，找渲染器/转码器相关 chunk
│   │   ├── chunk-scan2.mjs               # 按关键字符串（转码器失败、setKTX2Loader 等）探针扫描分包
│   │   ├── bundle-check.mjs              # 包体检查（dist/js 各 chunk 体积清单）
│   │   ├── sw-check.mjs                  # 检查 service-worker.js 的 precache 清单
│   │   ├── sw-size.mjs                   # 统计 precache 资源总体积
│   │   ├── vram-est.mjs                  # 按转码后 GPU 格式（含 mip 链）估算各模型显存占用
│   │   ├── dump-glb.mjs                  # 打印指定 GLB 的 JSON chunk 结构
│   │   ├── inspect-one.mjs               # 单个模型的扩展/贴图体检
│   │   ├── inspect-ktx2.mjs              # 批量确认 GLB 是否已 KTX2 化、体积与扩展声明
│   │   ├── validate-all.mjs              # 只读全量校验：73 个 GLB 能否被 GLTFLoader + KTX2Loader 解析
│   │   ├── decode-test.mjs               # 真解码：用发货的 basis_transcoder.wasm 把 KTX2 转成 RGBA32
│   │   └── wasm-strings.mjs              # 从 basis_transcoder.wasm 里提取字符串，定位转码器能力
│   ├── lib-build/                        # 发布库构建 7 个文件
│   │   ├── build.js                      # 打包 dist-lib（UMD 内联 three / ESM 外置 three），DefinePlugin 注入资产清单与缓存开关
│   │   ├── assetInventory.js             # 扫描磁盘产出资产清单与模型字节表（jest.config.js 也复用）
│   │   ├── index.d.ts                    # 发布类型声明源（拷贝为 dist-lib/index.d.ts）
│   │   ├── esm-test.html                 # ESM 宿主冒烟页
│   │   ├── host-test.html                # UMD 宿主冒烟页
│   │   ├── preview-test.html             # 增量预览冒烟页
│   │   └── README.md                     # 库构建说明
│   └── preview/build-fixture.mjs         # 把后端抓包改造成当前契约格式的预览 fixture（供 lib-build/preview-test.html 与 data/ 样本）
├── src/                                  # 应用与发布库源码（764 个文件，见 4.2）
└── tests/
    └── unit/                             # Jest 单测根（42 个文件，26 个 *.spec.ts）
        ├── fileMock.js                   # 图片/ktx2 资源替身（jest moduleNameMapper）
        ├── blueprint/                    # 8 个 spec + fixtures/ 样本
        │   ├── command.spec.ts           # 命令队列与撤销重做
        │   ├── dense_splitters.spec.ts   # 高密度分拣器蓝图（438 栋，v1 头/v2 体）解析与往返
        │   ├── foundation.spec.ts        # 地基蓝图二进制段（reformData）解析与往返
        │   ├── md5.spec.ts               # 蓝图尾部校验
        │   ├── parser.spec.ts            # 字符串 ↔ BlueprintData 往返
        │   ├── planet.spec.ts            # 星球网格分区与坐标变换
        │   ├── removeBuilding.spec.ts    # 删除建筑命令
        │   ├── stats.spec.ts             # 生产统计
        │   └── fixtures/                 # 9 个蓝图样本：dense_splitters_v1.txt、
        │                                 #   facilities_with_foundation_320.txt、foundation_only_99.txt、
        │                                 #   same_buildings_v2.txt、sample_outpost_ils.txt、
        │                                 #   sample_throughput.txt、starting_base_01029.txt、
        │                                 #   _tmp_fixture.txt、_tmp_fixture.json（后两个为测试回写产物）
        ├── camera/planetMapControls.spec.ts   # 星球地图相机
        ├── lib/                          # 6 个 spec
        │   ├── assetBaseUrl.spec.ts      # 资产根地址与 URL 拼接
        │   ├── blueprintViewer.spec.ts   # BlueprintViewer 门面
        │   ├── buildBVH.spec.ts          # BVH 构建
        │   ├── describeBuild.spec.ts     # 拾取描述/统计
        │   ├── iconTexture.spec.ts       # 图标图集槽位
        │   └── planetMapControls.spec.ts # 相机控制（与 camera/ 下同名，各自独立）
        ├── models/                       # 7 个 spec
        │   ├── modelCache.spec.ts        # 本地持久化缓存
        │   ├── modelMapping.spec.ts      # 模型名 ↔ 建筑映射
        │   ├── modelPack.spec.ts         # 离线模型包
        │   ├── modelTransform.spec.ts    # 变换表每一行都必须有对应 .glb
        │   ├── placement.spec.ts         # 放置矩阵
        │   ├── textureFallback.spec.ts   # 缺失底色贴图兜底
        │   └── textureManifest.spec.ts   # 贴图清单
        ├── preview/                      # 4 个 spec
        │   ├── fixture.spec.ts           # 预览 fixture 的离线回放护栏（嵌套 areas / 缺省字段）
        │   ├── previewLayer.spec.ts      # 增量摄入 + 跟随
        │   ├── projector.spec.ts         # 格坐标 → 世界矩阵投影
        │   └── replay.spec.ts            # 真实增量样本回放（默认跳过，读 data/preview-delta-*.json）
        └── scripts/                      # 模型资源诊断/生成 5 个脚本 + 1 份映射表
            ├── check-glb-extensions.ts   # 校验 GLB 的扩展声明
            ├── inspect-glb.ts            # 打印 GLB 结构
            ├── verify-glb-mapping.ts     # 校验建筑 ↔ 模型映射
            ├── gen-texture-manifest.mjs  # 生成 textureManifest.ts
            ├── prune-model-textures.mjs  # 清理模型里不再引用的贴图
            └── texture-mapping.json      # 模型名::材质名 → 贴图通道 的映射输入
```

根目录文件（全部为真实存在，逐个核对过）：

| 文件 | 作用 |
| ---- | ---- |
| `package.json` | `version 1.5.0`、`private: true`；`main/module/types/unpkg/jsdelivr` 指向 `dist-lib/*`，`files: ["dist-lib"]`；脚本见第 2 章 |
| `package-lock.json` / `yarn.lock` | 两套锁文件并存（CI 用 yarn，`yarn.lock` 生效） |
| `vue.config.js` | SPA 构建配置：`publicPath = '/dsp_blueprint_editor/'`、PWA、`DefinePlugin` 注入缓存开关与资产清单；演示页仅在对应入口文件存在时注册（该入口当前未提交） |
| `tsconfig.json` | 路径别名 `@/*` → `src/*`、`@lib/asset-resolver` → `src/lib/assets/assetResolver.ts` |
| `jest.config.js` | ts-jest + `@vue/vue3-jest`；`globals` 注入 `__DSP_LIB_ASSET_INVENTORY__`（复用 `scripts/lib-build/assetInventory.js`）与 `__DSP_MODEL_CACHE_ENABLED__`（取 `config/persistence.config.js` 的 `web`） |
| `babel.config.js` | Babel 预设 |
| `.eslintrc.js` | ESLint（vue3 + TS）规则 |
| `.browserslistrc` | 目标浏览器范围 |
| `.editorconfig` | 编辑器缩进/换行约定 |
| `.gitignore` | 忽略 `node_modules/`、`dist/` 等 |
| `README.md` | 项目说明、开发/构建命令、在线地址 |
| `CHANGELOG.md` | 版本变更记录（`standard-version` 维护，`public/update-log.json` 的数据源） |

> ⚠️ 待确认：根目录不存在任何 prettier 配置文件（`Get-ChildItem -Force -Filter ".prettier*"` 无输出），但 `package.json` 的 `format` 脚本调用 `prettier`，且 devDependencies 里也没有 `prettier`。是改用编辑器/CI 内置格式化，还是漏了依赖与配置，缺依据。

### 4.2 src/ 源码目录

```
src/
├── main.ts                            # 应用入口：createApp(App).use(i18n).mount('#app')
├── App.vue                            # 根组件：布局装配（3D 编辑器 + 信息/操作/统计三标签侧栏）、导入导出与弹窗
├── define.ts                          # 全局 Symbol key + VERSION 常量
├── i18n.ts                            # vue-i18n 实例、useLang、名称/图标查询
├── command.ts                         # CommandQueue / Command / Updater（撤销重做）
├── utils.ts                           # attachRenderer / attachCamera 等小工具
├── cli.ts                             # Node 端 CLI：蓝图字符串 ↔ JSON（yarn cli）
├── planetConstants.ts                 # 星球半径/格宽/网格尺寸等世界坐标常量（planet.ts、buildingModel、编辑器共用的唯一来源）
├── PlanetMapControls.ts               # 星球地图相机控制（锚点在球面，可自由俯仰）
├── skyGradient.ts                     # 天光背景：大气雾带 + 星空 + 星球边缘光
├── SphereGridGeometry.ts              # 球面经纬网格几何体
├── iconTexture.ts                     # 图标图集纹理（24×24 槽位，每槽 80px）
├── icons.ts                           # 建筑图标 InstancedMesh + 自定义 Shader
├── iconSubscript.ts                   # 传送带/建筑图标上的数字下标渲染
├── cargos.ts                          # 传送带、分拣器上的货物动画
├── renderSettings.ts                  # 渲染高级设置（reactive 单例 + sessionStorage 持久化）
├── renderSettingsTypes.ts             # 渲染设置的纯类型（不 import vue，供 lib/** 与 models/** 复用）
├── swStatus.vue                       # Service Worker 升级提示 + 更新日志弹窗（展示 public/update-log.json）
├── shims-vue.d.ts                     # .vue 模块类型声明
├── assets/
│   ├── dsp-logo-en.png                # logo 资源（当前源码/页面均未引用）
│   ├── logo.png                       # logo 资源（当前源码/页面均未引用）
│   └── icons/
│       ├── item_recipe/               # 192 个物品/配方图标 PNG
│       ├── signal/                    # 41 个信号图标 PNG
│       ├── tech/                      # 323 个科技图标 PNG
│       ├── models/                    # 73 个 .glb 建筑模型，合计约 128 MB（贴图已内嵌并转 KTX2）
│       ├── arrow_left.svg             # 配方「输入 → 输出」的方向图标（BuildingRecipe.vue）
│       ├── close.svg                  # 关闭按钮背景（App.vue）
│       ├── find_replace.svg           # 批量替换按钮图标（App.vue）
│       ├── menu.svg                   # 侧栏展开/收起按钮背景（App.vue）
│       ├── pin.svg                    # 侧栏固定按钮背景（App.vue）
│       ├── redo.svg                   # 重做按钮图标（App.vue）
│       ├── undo.svg                   # 撤销按钮图标（App.vue）
│       ├── settings.svg               # 设置按钮背景（App.vue）
│       ├── translate.svg              # 语言切换按钮图标（App.vue）
│       ├── component-icon.png         # 物品列表分类图标（ItemSelect / RecipeSelect）
│       ├── factory-icon.png           # 建筑列表分类图标（ItemSelect / RecipeSelect）
│       ├── stats-tab-icon.png         # 侧栏统计页签背景图（App.vue）
│       └── update-log.jpg             # 更新日志弹窗配图（swStatus.vue）
├── blueprint/                         # 蓝图字符串层（纯 TS，不依赖 Vue），现存 11 个文件
│   ├── parser.ts                      # 蓝图字符串 ↔ BlueprintData（核心；fromStr/toStr/二进制头尾）
│   ├── md5.ts                         # 纯 JS MD5（蓝图尾部校验）
│   ├── planet.ts                      # 星球网格分区 + 建筑坐标变换（格 ↔ 世界）
│   ├── buildingInfo.ts                # 建筑邻接关系（output/input 链路）
│   ├── reform.ts                      # 地基（reformData）3D 渲染层
│   ├── replace.ts                     # ReplaceCommand（批量替换建筑）
│   ├── removeBuilding.ts              # RemoveBuildingCommand / RemoveBuildingsCommand / RemoveBuildingsByItemCommand
│   ├── stats.ts                       # calculateProductionStats 生产统计
│   ├── setAccelerator.ts              # SetAcceleratorCommand（增产剂模式）
│   ├── setBeaconContent.ts            # SetBeaconContentCommand（信标自定义文本）
│   └── upgrade.ts                     # UpgradeCommand（建筑升降级）
├── bvh/                               # 射线拾取加速结构
│   ├── bvh.ts                         # BVH 构建与求交
│   ├── helper.ts                      # 可视化辅助
│   └── index.ts                       # 统一导出
├── components/                        # Vue UI 组件 24 个文件
│   ├── BlueprintEditor.vue            # 3D 编辑器主体（异步加载）
│   ├── BuildingInfoPanel.vue          # 选中建筑详情面板（按类型分发到下面的 Info 面板）
│   ├── BuildingOverview.vue           # 建筑概览列表
│   ├── BuildingRecipe.vue             # 配方输入/输出图标
│   ├── BuildingIcon.vue               # 单个建筑图标渲染
│   ├── BlueprintIcon.vue              # 蓝图头部图标组合
│   ├── StationInfo.vue                # 物流塔 / 大型采矿机详情（库存栏位与参数；内含 SetStationStorageItemCommand、SetStationParamCommand）
│   ├── SpitterInfo.vue                # 四向分流器详情（只读口示意 + 筛选展示）
│   ├── MonitorInfo.vue                # 流速监测器详情
│   ├── StorageInfo.vue                # 储物仓详情
│   ├── DispenserInfo.vue              # 物流配送器详情
│   ├── HoloBeaconInfo.vue             # 全息信标文本编辑
│   ├── BattleBaseInfo.vue             # 战场分析基站详情
│   ├── ProductionStats.vue            # 生产统计面板
│   ├── ReplaceModal.vue               # 批量替换/升降级弹窗
│   ├── IconPickerModal.vue            # 图标选择器
│   ├── ItemSelect.vue                 # 物品搜索选择
│   ├── RecipeSelect.vue               # 配方搜索选择
│   ├── ModalDSP.vue                   # 通用模态框
│   ├── SwitchDSP.vue                  # 通用开关
│   ├── ParamSlider.vue                # 通用滑块（拖动预览/松手提交）
│   ├── ColorPreview.vue               # 颜色预览
│   ├── WorkEnergyParam.vue            # 工作能耗参数
│   └── _icon-select.scss              # ItemSelect / RecipeSelect 共享样式
├── data/                              # 静态数据表与生成器 23 个文件
│   ├── index.ts                       # 汇总导出（types + itemsMap + recipesMap）
│   ├── types.ts                       # Item / Recipe / Tech / Signal / MIDI 类型
│   ├── items.ts                       # itemsMap（id → Item）构建
│   ├── itemsData.ts                   # 物品原始表（生成产物）
│   ├── recipes.ts                     # recipesMap（id → Recipe）构建
│   ├── recipesData.ts                 # 配方原始表（生成产物）
│   ├── building.ts                    # buildingMeta：盒子尺寸/颜色/图标位/选择框矩阵
│   ├── modelTransform.ts              # 逐模型偏移/旋转/缩放/着色表（62 条，默认全 0）
│   ├── buildingPowerData.ts           # 建筑基础功耗 / 生产速度倍率 / 可否加速
│   ├── acceleratorData.ts             # 增产剂等级与加成（生产/加速/耗电/喷涂容量）
│   ├── icons.ts                       # 图标 ID 体系与 URL（经 @lib/asset-resolver 解析）
│   ├── color.ts                       # colorPalette256 地基调色板
│   ├── midi.ts                        # MIDI 信号表（生成产物）
│   ├── techIconsData.ts               # 科技图标索引（生成产物）
│   ├── signalIconsData.ts             # 信号图标索引（生成产物）
│   ├── gen.sh                         # 生成驱动：把游戏 Asset 导出的 JSON 灌给各 gen_*.py
│   ├── gen_items.py                   # → itemsData.ts
│   ├── gen_recipes.py                 # → recipesData.ts
│   ├── gen_midi.py                    # → midi.ts
│   ├── gen_signal_icons.py            # → signalIconsData.ts
│   ├── gen_tech_icons.py              # → techIconsData.ts
│   ├── gen_color_palette.py           # → color.ts
│   └── i18n.py                        # 由游戏 ProtoSet + locale json 生成多语言名称映射（-o 指定输出）
├── lib/                               # 发布库（无头渲染门面，不依赖 Vue），24 个文件
│   ├── index.ts                       # 库入口：导出 BlueprintViewer、parseBlueprint、serializeBlueprint、configureAssetBaseUrl（导出面刻意收窄）
│   ├── BlueprintViewer.ts             # 门面类：挂载/重建/拾取/预览增量/主题/设置，内部委托 RenderCore
│   ├── blueprintJSON.ts               # BlueprintData ↔ JSON（自定义 reviver 还原 Date 与 Uint8Array）
│   ├── types.ts                       # 公开类型（复用 @/renderSettingsTypes，不引入 Vue）
│   ├── core/
│   │   ├── RenderCore.ts              # 渲染内核：场景/相机/渲染器装配、原子重建、拾取、主题
│   │   ├── buildBuildings.ts          # 建筑实例化（元数据盒 + GLB 两条路径）
│   │   ├── AllBuildings.ts            # 一栋蓝图的可渲染内容集合（建筑网格 + 图标 + 货物 + 下标）
│   │   ├── buildBVH.ts                # 由建筑表构建 BVH
│   │   ├── planetScene.ts             # 星球本体/网格/光照等静态场景元素
│   │   ├── geometryHelpers.ts         # 分拣器抬升等几何小工具（INSERTER_HEIGHT 等）
│   │   ├── iconHelpers.ts             # 图标 id 解析 + 图标在建筑局部空间的位置/缩放
│   │   ├── describeBuild.ts           # 拾取命中描述与构建统计（诊断用，不进发布面）
│   │   ├── theme.ts                   # dark / light / editor 三套主题色板与解析
│   │   └── types.ts                   # 内核内部类型（实例引用、构建统计等）
│   ├── preview/                       # 增量预览层（preview-delta）
│   │   ├── PreviewLayer.ts            # 事件同步摄入（2ms 级）+ 每帧指数收敛跟随
│   │   ├── projector.ts               # 格坐标 → 世界矩阵（layout-grid-v1 的居中/缩放/球面投影）
│   │   ├── pools.ts                   # 按模型分池的 InstancedMesh + SoA 状态表（峰值 3 万级对象）
│   │   ├── materials.ts               # 克隆材质并注入 per-instance 透明度
│   │   ├── mode.ts                    # 预览动画模式运行时解析（auto/on/off，含 DSP_ANIM 构建期旁路）
│   │   └── types.ts                   # 结构宽容的事件类型（扁平/嵌套两种 areas 形态都吃）
│   └── assets/
│       ├── assetBaseUrl.ts            # 资产根地址与 URL 拼接（configureAssetBaseUrl，四种取值来源）
│       ├── assetResolver.ts           # 运行时解析实现（库构建用，清单由构建期注入）
│       ├── assetResolver.webpack.ts   # webpack 解析实现（编辑器构建用，require.context / import()）
│       └── types.ts                   # 资产解析层契约（逻辑资产标识 → 可加载 URL）
├── locales/
│   ├── zh.json                        # 中文文案
│   └── en.json                        # 英文文案
└── models/                            # GLB 模型管线 14 个文件
    ├── glbAssets.ts                   # 资源注册表：模型名索引 / 别名 / 变形候选 / modelUrl
    ├── glbLoader.ts                   # 加载器：懒加载 / 缓存 / 并发去重（上限 10） / 30s 超时 / 失败负缓存 / 释放
    ├── buildingModel.ts               # 解析器：GLB 优先 + 元数据回退、放置矩阵、映射报告
    ├── glbInstances.ts                # 子网格级 InstancedMesh 实例化（几何/材质共享复用）
    ├── textureManifest.ts             # 自动生成：模型名::材质名 → 各通道贴图引用
    ├── textureMaps.ts                 # 通道贴图加载 + Unity spec-gloss → ORM 打包
    ├── materialTextures.ts            # 把通道贴图与调参挂到材质（受 renderSettings 控制）
    ├── modelMaterialTuning.ts         # 73 个模型的材质手调表（emissive/envMap/metalness）
    ├── envMap.ts                      # 程序化中性环境反射（PMREM，只挂建筑材质）
    ├── ktx2.ts                        # KTX2Loader 懒加载 + 转码器路径 + 失败降级
    ├── textureFallback.ts             # 缺失底色贴图时用 1×1 纯色 DataTexture 兜底
    ├── modelPack.ts                   # 「离线模型包」：批量下载并落盘全部 GLB（设置面板手动触发）
    ├── modelCache.ts                  # Cache Storage 持久化缓存（含 NoopModelCache 空实现）
    └── modelCacheConfig.ts            # 缓存开关：运行时覆盖 > 构建期注入 > 默认开启
```

### 4.3 规模速查

| 位置 | 文件数 | 备注（均已实点核对） |
| ---- | ---- | ---- |
| `src/` | 764 | 其中 120 个源码/配置类文件 + 644 个资源 |
| `src/assets/icons/` 顶层 | 13 | UI 图标与插图（9 svg + 3 png + 1 jpg） |
| `src/assets/icons/item_recipe/` | 192 | 物品/配方图标 PNG |
| `src/assets/icons/signal/` | 41 | 信号图标 PNG |
| `src/assets/icons/tech/` | 323 | 科技图标 PNG |
| `src/assets/icons/models/` | 73 | `.glb`，合计约 128 MB |
| `src/blueprint/` | 11 | 见 4.2 |
| `src/lib/` | 24 | `core/` 10 + `preview/` 6 + `assets/` 4 + 顶层 4 |
| `src/models/` | 14 | 见 4.2 |
| `src/data/` | 23 | 15 个 `.ts` + `gen.sh` + 7 个 Python 生成器（6 个 `gen_*.py` + `i18n.py`） |
| `src/components/` | 24 | 23 个 `.vue` + `_icon-select.scss` |
| `src/bvh/` | 3 | `bvh.ts`、`helper.ts`、`index.ts` |
| `src/locales/` | 2 | `zh.json`、`en.json` |
| `tests/unit/` | 42 | 26 个 `*.spec.ts` + 9 个 fixture + 5 个诊断脚本 + `texture-mapping.json` + `fileMock.js` |
| `scripts/` | 34 | `http/` 19 + `lib-build/` 7 + `glb-ktx2/` 6 + `generate-update-log.js` + `preview/build-fixture.mjs` |
| `public/` | 16 | 含 `public/basis/` 2、`public/demo/` 3、`public/img/icons/` 7 |
| `docs/` | 30 | 本文件、`功能说明.md`、`lib-README.md`、`wiki/` 14、`growingTree/` 5、`DSH日志/` 3、`images/` 5 |
| `config/`、`.github/` | 各 1 | `config/persistence.config.js`、`.github/workflows/gh-pages.yml` |
| `data/` | 20 | 7 份 md + 12 份 JSON 样本 + 1 份基准 fixture |
| `dist/`、`dist-lib/` | 315 / 656 | 构建产物，约 143 MB / 142 MB（不入库） |

单测与测试脚本的准确构成：spec 共 26 个（`blueprint/` 8、`camera/` 1、`lib/` 6、`models/` 7、`preview/` 4）；`tests/unit/blueprint/fixtures/` 9 个样本；`tests/unit/scripts/` 是 5 个脚本 + 1 份 `texture-mapping.json`（旧文档写作「6 个脚本」，实际其中一份是 JSON 映射表）。

***

## 5. 主要模块职责

### 5.1 蓝图核心模块 `src/blueprint/`

| 文件 | 职责 |
| ---- | ---- |
| `src/blueprint/parser.ts` | 蓝图字符串 `BLUEPRINT:...` ⇄ `BlueprintData` 的双向编解码（v1 / v2 两套 body 格式、头部 MD5 校验、逐建筑参数字节序），导出 `fromStr` / `toStr`、`BlueprintData` / `BlueprintArea` / `BlueprintBuilding` / `BlueprintReformRect` / `BlueprintReformData`、各类 `*Parameters` 接口与 `IODir` / `LogisticRole` / `AcceleratorMode` / `ResearchMode` / `StorageType` / `EnergyExchangerMode` 等枚举；内部 `parameterParsers` 表按 itemId 分派参数解析器，未登记建筑退回 `unknownParamParser`（整段参数按未知字节原样保留）。 |
| `src/blueprint/md5.ts` | 纯 TypeScript MD5 实现，`digest(data: ArrayBuffer)` 产出蓝图尾部 32 位 hex 校验和，供 `parser.ts` 校验与回写。 |
| `src/blueprint/planet.ts` | 蓝图分区 → 球面定位：`findPosForAreas(areas, segment)` 返回 `PositionedBlueprint`，`calcBuildingTrans(R, pos, building)` 算出每栋建筑的世界矩阵；`gridAreas(segment)` 按纬度带产出网格参数（跨赤道的带不镜像、赤道一侧的带补镜像区间），供 `src/lib/core/planetScene.ts` 的 `buildPlanetGrid` 生成经线。 |
| `src/blueprint/buildingInfo.ts` | `BuildingInfo` 类：按 `outputObjIdx/outputFromSlot`、`inputObjIdx/inputFromSlot` 建立 `adjacency` 邻接表（下标 = 建筑 index、槽位 = 建筑口），供信息面板与分流器面板查上下游连接。 |
| `src/blueprint/reform.ts` | 地基（`reformData`）渲染：`REFORM_TYPE_NONE(0) / REFORM_TYPE_IBEAM(1) / REFORM_TYPE_GRID(2) / REFORM_TYPE_PLAIN(7)` 常量与 `buildReforms(R, pos, reformData)` → `Reforms extends Group`；色板按 `customReformColorMask` + `customReformColors` 解出 32 槽，工字铺/直铺叠加程序化金属板纹理并复用进程级共享几何与材质。 |
| `src/blueprint/removeBuilding.ts` | 删除建筑并维护「数组下标即 index」与 `outputObjIdx/inputObjIdx` 交叉引用（指向被删建筑置 -1、指向其后建筑前移）：`RemoveBuildingsCommand` 基类 + `RemoveBuildingCommand`（单个，3D 视图右键）+ `RemoveBuildingsByItemCommand`（按 itemId 一键剔除同类），被删对象整体保存以便原样插回。 |
| `src/blueprint/replace.ts` | `ReplaceCommand`（`silent=true`，只改数据不重建几何）：按 `ReplaceParams.scope` 的 5 个维度（配方 / 分拣器筛选 / 物流塔栏位 / 传送带图标 / 蓝图图标）批量替换 `recipeId`、`filterId`、`parameters.storage[].itemId`、`parameters.iconId`、`header.icons`。 |
| `src/blueprint/setAccelerator.ts` | `SetAcceleratorCommand`：把带 `acceleratorMode` 字段的建筑（制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机 / 研究站）批量设为「生产加速 / 额外产出」；`SetAcceleratorParams` 支持 `buildingIndexes` 子集与 `labOnly` 过滤，构造时快照原模式，`undo` 逐建筑精确恢复。 |
| `src/blueprint/setBeaconContent.ts` | `SetBeaconContentCommand`：修改全息信标（itemId 2401）的 `content` 文本字段，`silent=true`（不触发 3D 重建）；对同一建筑的连续编辑由 `merge()` 合并成一条撤销记录，空字符串写回 `undefined`。 |
| `src/blueprint/stats.ts` | `calculateProductionStats(bp, options)`：理论满速汇总，返回 `ProductionStats { items: ItemStats[]; totalPower }`，每项含 `produced / consumed / net`（每分钟）；`StatsOptions` 为 `{ useAccelerator, acceleratorItem }`，分馏塔（2314，固定 72 氢→72 重氢）与「研究站研究模式只消耗矩阵」单独特判，倍率取自 `acceleratorData`、功耗与可加速性取自 `buildingPowerData`，并按喷涂流量反推增产剂消耗。 |
| `src/blueprint/upgrade.ts` | 建筑升降级：`upgradeEdges`（有向边，低级→高级）、`upgradeableItems`、`reachableTargets(fromId)`（沿升级+降级邻接表取并集，含跳级）与 `UpgradeCommand`（改写 `itemId` 并同步 `modelIndex = items[id].models[0]`，仅用于各等级参数格式一致的建筑）。 |

### 5.2 命令与状态层 `src/`

| 文件 | 职责 |
| ---- | ---- |
| `src/App.vue` | 应用外壳与状态编排：蓝图字符串的解析/粘贴/拖拽/清空/保存文件与错误提示，`provide(commandQueueKey / buildingInfoKey / rendererKey)`，信息·操作·统计三 Tab 侧栏，渲染高级设置（模型/贴图/实例上限/离线模型包）与 `sessionStorage` 持久化提示，快捷键（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、O 与 0 开关面板），蓝图头信息（作者/版本/图标布局/属性/介绍）编辑，`defineAsyncComponent` + `webpackChunkName: "renderer"` 异步加载 3D 视图。 |
| `src/command.ts` | 撤销栈基础设施：`Command` 接口（`do / undo / merge / silent?`，`silent` 区分「纯数据变更」与「几何拓扑变更」）、`CommandQueue`（默认 `maxSize = 256`、`stateVersion` 每次命令递增、`execVersion` 仅非 silent 命令递增、支持 push 前合并与超限裁剪）、`Updater` 与 `EventDispatcher`（`updateBuildingIcon / updateBeltIcon / updateBeltIconSubscript / updateSorterIcon / updateStationInfo` 五条增量刷新通道 + `clearAll()`）。 |
| `src/define.ts` | `version`（`git describe --tags --always --dirty` 的结果，经 `vue.config.js` 的 `DefinePlugin` 注入常量 `VERSION`）与 `rendererKey` / `buildingInfoKey` / `commandQueueKey` 三个 `InjectionKey`。 |
| `src/i18n.ts` | `createI18n` 实例（`legacy: false`，`zh` / `en` 消息，fallback 取 `navigator.languages`）、`useLang()`（默认 `auto` 跟随浏览器语言，可切 zh/en）与 `itemName(id)` / `recipeName(id)` 名称查询。 |
| `src/utils.ts` | 通用工具：`attachRenderer / attachCamera`（把 Three 的 renderer、camera 与 Vue 容器尺寸及窗口 resize 绑定）、`debugMat`（矩阵分解打印）、`truth`（布尔值转为界面徽标文案）。 |
| `src/cli.ts` | Node CLI（`yarn cli` / `build-cli`）：从文件参数或 stdin 读蓝图字符串，`fromStr` 后输出 JSON；`-o / --out` 写文件，且 `-o` 不带值时按输入文件同名推出 `.json`（stdin 输入时强制要求显式文件名）。 |
| `src/renderSettings.ts` | 渲染设置的全局响应式单例：`showRealModels / texturesEnabled / textures[7 通道 albedo·normal·spec·emissive·effect·dirt·glass] / maxInstancesPerModel`，从 `sessionStorage` 恢复、`persistRenderSettings()` 写回（`Infinity` 序列化为 `null`）；`captureRenderSettings()` / `getAppliedRenderSettings()` 维护「导入蓝图时固化」的已生效快照，因此改设置只影响下次导入，中途任何重建仍按导入时的值渲染。 |
| `src/renderSettingsTypes.ts` | 渲染设置的纯类型层（不 import vue）：`TextureChannelSwitches`、`TextureSettings`、`ViewerRenderSettings`、`FullRenderSettings`，供 `materialTextures` / `glbLoader` / `src/lib/core/**` 与库门面共用，避免把 Vue 带进渲染内核。 |
| `src/planetConstants.ts` | 星球与格子的世界坐标常量唯一来源：`PLANET_RADIUS = 200.2`、`PLANET_SEGMENT = 200`、`GRID_PER_SEGMENT = 5`、`HEIGHT_GRID_SIZE = 4/3`、`GRID_HORIZONTAL`，被 `blueprint/planet.ts`、`models/buildingModel.ts`、相机与 `src/lib` 内核共用；不支持运行时修改。 |
| `src/swStatus.vue` | 页脚 Service Worker 状态与更新日志弹窗：轮询 `upgradeReady` 后提示刷新，`fetch` 取 `update-log.json`（`cache: "no-store"`）渲染版本条目，`localStorage` 记 24 小时静默期，`window.__DSP_UPDATE_MODAL__` 可强制打开。 |

### 5.3 3D 渲染层（编辑期）`src/`

| 文件 | 职责 |
| ---- | ---- |
| `src/PlanetMapControls.ts` | 星球地图相机控制器：`anchor`（球面锚点）+ `viewDir` + `tilt`（0 = 平视、85° = 俯瞰）+ `distance`，左键沿球面平移、滚轮/双指 dolly，距离受 `planetRadius`、`minHeight` 与地平线联动约束；`setHome() / reset()` 回到入场姿态，`update()` 返回本帧相机是否变化，支持鼠标、触摸与键盘平移。 |
| `src/skyGradient.ts` | 天光/星空背景：`createSkyGradient(options)` → `{ mesh, dispose }`，全屏四边形在 `onBeforeRender` 里同步相机，按相机 up 方向绘制顶层渐变、地平线大气雾带 + 辉光、哈希星空与星云噪点、星球轮廓边缘光。 |
| `src/SphereGridGeometry.ts` | 经纬线几何体（只生成顶点与线段索引，不生成三角面）：`SphereLatitudeGridGeometry` 连接同一纬度行相邻顶点成纬线，`SphereLongitudeGridGeometry` 连接上下行同列顶点成经线；参数语义与 `SphereGeometry` 一致。 |
| `src/iconTexture.ts` | 24×24 槽位图标图集：`new IconTexture(renderer)` 按 `allIconIds()` 预分配槽位，`requestIcon(iconId)` 懒加载后 `copyTextureToTexture` 上传（按槽位去重、失败允许重试、`dispose` 后不回写），`has(iconId)` 判槽位是否存在；`TextureSink` 最小接口便于单测注入 stub。 |
| `src/icons.ts` | 建筑图标实例化渲染：`IconGeometry`（每建筑一条实例属性，`addIcon / hasIcon / updateIconId` 局部改 UV）+ `IconsMaterial`（按 iconId 在图集里算 UV、`sizeAttenuation`）+ `Icons extends Mesh`（关闭视锥剔除，避免俯仰角低时整批图标被剔除）。 |
| `src/iconSubscript.ts` | 传送带货物数量下标（如 `12k`）：`FontTexture` 预生成 `0123456789k` 字符图集，`IconSubscript.setText(index, pos, scale, text)` 写实例属性、`needsUpdate()` 提交纹理更新，`TextStyle` 可换主题的填充/描边色（类本身不持有独立纹理，无 `dispose`）。 |
| `src/cargos.ts` | 传送带/分拣器上滑动的货物：`Cargos extends InstancedMesh`（`BoxGeometry` 派生，每实例带 `cargoDistance` 属性）+ `CargoMaterial` 的 `cargoMove` uniform 在着色器里沿 z 轴循环位移，`setCargoDistanceAt(i, d)` 逐实例设距离。 |
| `src/bvh/bvh.ts` | 自实现 BVH：以每栋建筑的选择盒（`Matrix4[]`，`public boxes`）建层次包围盒树，`raycast(ray)` 返回按距离排序的 `{ index, distanceSquared }`；盒为空时抛 `Unexpected empty box`。被 `src/lib/core/buildBVH.ts`（构建）、`describeBuild.ts` 与 `core/types.ts`（类型）使用，编辑器与发布层共用同一实现。 |
| `src/bvh/helper.ts` | `BVHHelper extends LineSegments`：把 BVH 每个节点的包围盒画成线框，用于调试拾取结构。 |
| `src/bvh/index.ts` | 再导出 `BVH` 与 `BVHHelper`；`src/` 内没有对 `@/bvh` 桶文件的引用，场景装配直接 `import { BVH } from "@/bvh/bvh"`。 |

> ⚠️ 待确认：`src/bvh/helper.ts` 的 `BVHHelper` 在 `src/` 内无任何引用，是否仅作为调试工具保留（仓库内无调用点/注释说明）。

### 5.4 UI 组件层 `src/components/`

| 文件 | 职责 |
| ---- | ---- |
| `src/components/BlueprintEditor.vue` | 3D 视图（由 `App.vue` 以 `defineAsyncComponent` + chunk `renderer` 异步加载）：用 `src/lib/core` 的 `buildBuildings / buildBVH / createPlanetScene` 装配场景、`PlanetMapControls` 相机与 `applyHome()` 入场姿态、`createSkyGradient` 背景、`buildReforms` 地基；交互只剩「左键点选单个建筑（带 6px 拖拽阈值）+ 右键剔除单个建筑（`RemoveBuildingCommand`）+ 相机操作」，`registerUpdater` 负责图标/下标/分拣器图标的增量刷新；`defineExpose` 暴露 `selectBoxes / camera / cameraPosVersion / getModel / resetCamera`。**当前不含建筑放置、删除模式与多选**（旧文档的「放置模式 / 删除模式 / 选择」交互已整体删除；多选只在发布层 `src/lib/core/RenderCore.ts` 的 `setSelectedIndexes` 实现）。 |
| `src/components/BuildingInfoPanel.vue` | 选中建筑的主信息面板：标题 + `BuildingRecipe`，按 itemId 分派 `SplitterInfo`（`defineAsyncComponent` 异步加载 `SpitterInfo.vue`）/ `StationInfo` / `MonitorInfo` / `BattleBaseInfo` / `StorageInfo` / `DispenserInfo` / `HoloBeaconInfo`，并展示过滤器、研究站模式、增产剂效果、分拣长度、弹射器轨道与十倍射速、能量枢纽模式、射线接收模式、人造恒星百倍发电、传送带图标与数量、储液罐输入/输出开关；`updater.updateBeltIcon` / `updateSorterIcon` 触发时局部刷新传送带图标与过滤器。 |
| `src/components/BuildingOverview.vue` | 未选中建筑时的概览：按 itemId 聚合图标与数量（「共 N 个」），右键图标 emit `remove-by-item` 由 `App.vue` 推 `RemoveBuildingsByItemCommand` 一键剔除同类建筑（可撤销）。 |
| `src/components/BuildingRecipe.vue` | 单条配方的展示：从 `recipesMap` 取 `from` / `to` 列表，按「输入 → 输出」渲染图标链。 |
| `src/components/BuildingIcon.vue` | 通用图标原子组件：`iconId / alt / count`，异步 `iconUrl()` 取图，有 `count` 时叠加数量角标。 |
| `src/components/BlueprintIcon.vue` | 蓝图头部图标组合：按 `layoutId`（1 / 10 / 11 / 20…51 等布局表）排布 `icons[]`，`editable` 时点击某格 emit `edit(index)` 打开图标选择。 |
| `src/components/StationInfo.vue` | 物流塔（普通 / 星际）与大型采矿机面板：逐栏位渲染 `ItemSelect` + 货物上限 `ParamSlider` + 本地/星际供需下拉（`role-supply / role-demand / role-none` 着色）、自动补充开关、最大充能功率、运输机/运输船最远路程、翘曲相关参数、大型采矿机的「采集速度」与「轨道采集器」开关；内部定义 `SetStationStorageItemCommand`、`SetStationParamCommand`（均 `silent=true`，只 bump `stateVersion`）。**旧文档的「顶部 12 个口方向只读徽标 + `SetStationPortCommand`」已随 `setStationPort.ts` 删除，当前源码无该端口区。** |
| `src/components/SpitterInfo.vue`（文件名为 `Spitter`，组件按 `SplitterInfo` 使用） | 四向分流器面板：按 `parameters.priority[4]` 给 4 个口示意着色（优先口不透明、否则半透明），用 `BuildingInfo.adjacency` 判断每口是输入还是输出并画箭头，展示筛选物品图标；内置小 `WebGLRenderer` 按主相机 `getModel(index)` 投影渲染占位盒，SVG 口示意随 `yaw[0]` 旋转。**只读，不再有优先/取消优先/筛选的点击交互与命令**（`setSplitterPort.ts` 已删除）。 |
| `src/components/MonitorInfo.vue` | 流速监测器面板：目标流量、监测条件运算符、满足/不满足颜色色块、货物过滤图标、生成物品说明，以及警报设置（系统警报模式与图标、声音警报、音色取自 `midiMap`、衰减范围、音高）。 |
| `src/components/BattleBaseInfo.vue` | 战场分析基站面板：自动拾取、自动重建、建设无人机开关与建造优先级（`BattleBaseDroneConstructPriority`）、战斗机开关与 `fighters[]` 编队图标网格、自动补充编队，以及 `WorkEnergyParam`。 |
| `src/components/StorageInfo.vue` | 储物仓面板：`StorageType.FILTERED` 时按容量（30 / 60）渲染过滤网格（`grids[].filter` 图标，超出自动化容量置灰），并显示「自动化容量限制」。 |
| `src/components/DispenserInfo.vue` | 物流配送器面板：向玩家配送模式、回收类型、仓储模式、自动补充与 `WorkEnergyParam`。 |
| `src/components/HoloBeaconInfo.vue` | 全息信标文本编辑：`textarea` 与 dirty 检测，失焦、`Ctrl+Enter` 或「保存」按钮调 `commit()` 推 `SetBeaconContentCommand`；对同一建筑的连续编辑由该命令自身的 `merge()` 合并，避免撤销栈爆炸。 |
| `src/components/ProductionStats.vue` | 统计 Tab：`calculateProductionStats(commandQueue.data, { useAccelerator, acceleratorItem })` 汇总每分钟产/耗/净与总功耗；增产剂等级（无/MkI/MkII/MkIII）选择器状态放在模块级 `sharedAcceleratorItem`，切 Tab 卸载/重挂不丢。 |
| `src/components/ReplaceModal.vue` | 批量替换弹窗：6 个互斥范围开关（配方 / 分拣器筛选 / 物流塔栏位 / 传送带图标 / 蓝图图标 / 升降建筑等级），配方与替换配方走 `RecipeSelect`；勾选配方时附「生产模式」单选组，执行后先推 `ReplaceCommand` 再按需推 `SetAcceleratorCommand`；升降级模式用 `upgradeableItems` / `reachableTargets` 生成源-目标建筑网格并推 `UpgradeCommand`。 |
| `src/components/ParamSlider.vue` | 通用滑块：接收 `label / value / steps / format / disabled`，拖动时只改本地预览索引，松手才 emit `change` 提交最终值（便于命令合并与减少重建）。 |
| `src/components/ItemSelect.vue` | 物品选择：以图标按钮打开 `ModalDSP`，按 `grid[0]` 分 2 页、按 `grid[2]` 分左右列排布 `items`，`v-model:itemId` 双向绑定。 |
| `src/components/RecipeSelect.vue` | 配方选择：同 `ItemSelect` 的两页布局，数据源换成 `recipes`，`v-model:recipeId`。 |
| `src/components/IconPickerModal.vue` | 图标选择模态框：7 个分类 Tab（物品 / 建筑 / 配方 / 信号 / 科技 / 升级I / 升级II），`open()` 暴露给父组件，选中 emit `select(iconId)`，另有「清除图标」；名称解析按 iconId 区间走 `itemName / recipeName` 或「信号 N / 科技 N」。 |
| `src/components/ModalDSP.vue` | `<dialog>` 封装的通用模态框：`open` prop 驱动 `showModal() / close()`，关闭时 emit `update:open`。 |
| `src/components/SwitchDSP.vue` | 开关样式徽标：仅按 `opened` 切换 `opened` class 配色，本身不处理交互（用于储液罐输入/输出等只读状态）。 |
| `src/components/ColorPreview.vue` | 颜色预览块：`colorId` 索引 `colorPalette256` 取 CSS 颜色渲染色块。 |
| `src/components/WorkEnergyParam.vue` | 工作能耗展示：把 `perTick` 能耗换算成 MW/功率文本。 |
| `src/components/_icon-select.scss` | 图标选择器共享样式（`.icon-select`、`.icon-placeholder` 等），被 `ItemSelect.vue` / `RecipeSelect.vue` 等 `@import`。 |

> ⚠️ 待确认：`src/components/SpitterInfo.vue` 文件名（`Spitter`）与导入处的组件语义（`SplitterInfo`）不一致，是否有意保留；另编辑器侧目前只有单选，是否计划把 `src/lib/core/RenderCore.ts` 的多选能力接回编辑器。

### 5.5 数据与资源模块 `src/data/`

| 文件 | 职责 |
| ---- | ---- |
| `src/data/types.ts` | 数据类型定义：`Item`（含 `models[]` 模型号、`icon`、`grid`、`productive`）、`ItemStack`、`Recipe`（`time` 以 1/60 秒计、`from/to`、`grid`、`nonProductive`）、`Tech`、`Signal`、`MIDI`。 |
| `src/data/items.ts` | 由 `itemsData.ts` 建 `itemsMap`，并提供 itemId 分类判定 `isBelt / isInserter / isStation / isInterstellarStation / isSplitter / isLab / isStorage / isTank / isEjector / isRayReciver / isArtificialStar / isEnergyExchanger / isAdvancedMiningMachine / isMonitor / isBattleBase / isDispenser / isHoloBeacon` 与 `allAssemblers`（可加速的制造类集合）。 |
| `src/data/recipes.ts` | 由 `recipesData.ts` 建 `recipesMap`（`Map<recipeId, Recipe>`）。 |
| `src/data/itemsData.ts` | 生成产物：全部 `Item` 数组（含 `models` 模型号与图标名），由 `gen_items.py` 从游戏导出生成。 |
| `src/data/recipesData.ts` | 生成产物：全部 `Recipe` 数组，由 `gen_recipes.py` 生成。 |
| `src/data/building.ts` | 建筑元数据：原始表派生 `buildingMeta: Map<modelIndex, BuildingMeta>`（`color`、`unitBoxTrans`、`selectUnitBoxTrans`、`iconTrans`，以及只读派生字段 `boxSize / boxCenter`（z 轴向上的宽深高与中心））、`noIconBuildings`（分流器/集装机/监测器/喷涂机/电力塔等不画图标的模型）与 `stationSlotTrans`（物流塔 12 个槽位的局部平移）。 |
| `src/data/modelTransform.ts` | 手调模型变换表（62 行）：`ModelTransform`（`x/y/z` 格 + `pitch/yaw/roll` 度 + 可选 `upAxis: y|z` / `align` / `scale`）、`ZERO_MODEL_TRANSFORM` 与 `modelTransformOf(modelIndex)` 查询；供 `models/buildingModel.ts` 生成 GLB 放置矩阵。 |
| `src/data/icons.ts` | 图标 ID 体系与 URL：`signalIconId / itemIconId / recipeIconId / techIconId`（区间 <1000 信号、<20000 物品、<40000 配方、<60000 科技）、`iconUrl(iconId)` 统一分发到 `itemRecipeIconUrl / techIconUrl / signalIconUrl`（三者转调 `@lib/asset-resolver`），`allIconIds()` 产出图集槽位全集。 |
| `src/data/color.ts` | `colorPalette256`：256 项游戏调色板 CSS 颜色表（含 alpha），供 `ColorPreview` 与监测器颜色字段使用。 |
| `src/data/midi.ts` | 流速监测器音色数据：`midi` 数组（`{ id, isInstrument, pitchRange }`）与 `midiMap` 查询表。 |
| `src/data/acceleratorData.ts` | 增产剂数据：`AcceleratorItem` 枚举（`None=0 / MkI=1 / MkII=2 / MkIII=3`）、`AcceleratorBonus`（`accelerate / extraOutput / power / sprayCapacity`）与 `acceleratorBonuses`；供 `stats.ts` 应用倍率、`ProductionStats.vue` 选等级。 |
| `src/data/buildingPowerData.ts` | 建筑功耗/速度表：`BuildingPowerData { itemId, name?, basePower, speedMultiplier, canAccelerate }`、27 条 `buildingPowerData` 与 `buildingPowerMap`（key = itemId）；`stats.ts` 据此算功耗与是否受加速影响。 |
| `src/data/techIconsData.ts` | 生成产物：科技图标索引 `tech: Tech[]`（含 `id`），`gen_tech_icons.py` 输出。 |
| `src/data/signalIconsData.ts` | 生成产物：信号图标索引 `signal: Signal[]`（含 `id` 与 `gridPos`），`gen_signal_icons.py` 输出。 |
| `src/data/index.ts` | 数据层桶文件：`export * from "./types"` + `itemsMap` + `recipesMap`。 |
| `src/data/gen.sh` | 数据再生成脚本：从游戏导出的 `ItemProtoSet / MIDIProtoSet / RecipeProtoSet / SignalProtoSet / TechProtoSet` JSON 调各 `gen_*.py` 输出 `*Data.ts`，并把 `itemrecipe / Texture2D` 贴图拷到 `src/assets/icons/`，最后跑 `i18n.py` 生成本地化。 |
| `src/data/gen_items.py` | 由 `ItemProtoSet.json` 的 `dataArray` 生成 `itemsData.ts`（id / 模型号 / 图标名 / grid / productive）。 |
| `src/data/gen_recipes.py` | 由 `RecipeProtoSet.json` 生成 `recipesData.ts`（含 `from/to` 物品栈与图标）。 |
| `src/data/gen_midi.py` | 由 `MIDIProtoSet.json` 生成 `midi.ts`。 |
| `src/data/gen_signal_icons.py` | 由 `SignalProtoSet.json` 生成 `signalIconsData.ts`（`GridIndex - 1101` 转行列表格坐标）。 |
| `src/data/gen_tech_icons.py` | 由 `TechProtoSet.json` 生成 `techIconsData.ts`（跳过未发布科技）。 |
| `src/data/gen_color_palette.py` | 由调色板 JSON 的 `colorPalette256` 生成 `color.ts`（rgba 分量转 CSS 颜色，alpha ≠ 1 时补第四位）。 |
| `src/data/i18n.py` | 本地化管理脚本：以 `ItemProtoSet`（`GridIndex != 0`）+ `RecipeProtoSet` 必需键为基础，合并 `zh.json` 里额外键，从游戏 Locale 生成 `src/locales/zh.json` 与 `en.json`。 |

### 5.6 国际化 `src/locales/`

| 文件 | 职责 |
| ---- | ---- |
| `src/locales/zh.json` | 中文消息（312 个键）：UI 文案 + 物品名 + 配方名，由 `src/data/i18n.py` 生成，`src/i18n.ts` 注册为 `zh` 语言包；与组件内 7 处 `<i18n>` 局部块（`src/App.vue`、`BuildingInfoPanel / BuildingOverview / HoloBeaconInfo / IconPickerModal / ProductionStats / ReplaceModal`）共同覆盖全部文案。 |
| `src/locales/en.json` | 英文消息（312 个键，键集与 `zh.json` 一致）：UI 文案 + 物品名 + 配方名；`yarn i18n:report`（`vue-cli-service i18n:report`）可扫描 `src/**/*.?(js|vue)` 与 `src/locales/**/*.json` 输出缺失条目报告。 |

### 5.7 发布层 `src/lib/`（BlueprintViewer 门面 / RenderCore / 增量预览 / 资产解析）

| 文件 | 职责 |
| ---- | ---- |
| `src/lib/index.ts` | 库入口（发布面刻意收窄、不含任何写死 UI）：导出 `BlueprintViewer`、`parseBlueprint`（= `fromStr`）、`serializeBlueprint`（= `toStr`）、`configureAssetBaseUrl`、`isModelCacheEnabled / setModelCacheEnabled`，以及全部公共类型（`ViewerOptions / ViewerCallbacks / ViewerError / Preview* / Building* / Theme*` 与 `BlueprintData` 等）。 |
| `src/lib/BlueprintViewer.ts` | 无头门面类：`loadBlueprint / loadBlueprintData / loadBlueprintJSON / exportBlueprintJSON / getBlueprintData`、增量预览 `beginPreview / applyPreviewDelta / commitPreview / discardPreview / previewStats`、选中与定位 `selectBuilding / selectedBuildings / focusBuilding / getBuildingInfo / getSelectedIndex(es)`、相机与尺寸 `resetCamera / getCamera / getCameraVersion / getCanvas / setSize / resetSize`、主题 `setTheme / setCustomTheme / getTheme`、`toDataURL / toBlob / setRenderSettings / setCallbacks / dispose`；解析/定位/构建/生命周期错误统一归一为 `ViewerError { code, phase }`，并提供内存默认 `SettingsPort`。 |
| `src/lib/types.ts` | 门面公共类型：`ViewerOptions`（container / 初始设置 / previewAnimation / autoResize / pixelRatio / keyboardTarget / keepCamera / width·height / theme / settingsPort）、`SettingsPort`、`BuildingPickPayload`、`BuildingInfoPayload`、`ViewerCallbacks`（select / remove / cameraChange / rebuild / error）、`RebuildInfo`、`BlueprintLoadResult` / `BlueprintLoadOutcome`、`ViewerErrorCode` / `ViewerErrorPhase`、`Building(s)LocateResult`、`ViewerQueryResult`、`FocusOptions`、`ThemeName` / `ThemeColors`。 |
| `src/lib/blueprintJSON.ts` | `BlueprintData` ⇄ JSON 的保形转换：`reviveBlueprintData` 把 `header.time` 还原成 `Date`、`buildings[].extraBytes` 还原成 `Uint8Array`（否则 `toStr` 会抛错或算错字节数），`parseBlueprintJSON` / `stringifyBlueprintJSON` / `formatBlueprintJSON`（返回 `BlueprintJSONOutcome`）与 `JSONImportError`（`json-syntax` / `json-shape`）。 |
| `src/lib/core/RenderCore.ts` | 共享渲染内核（不依赖 Vue，编辑器与 Viewer 共用）：scene / camera / `WebGLRendererLike` / `PlanetMapControls` / rAF 循环、原子式 `rebuildScene`（`findPosForAreas` → `buildBuildings` + `buildBVH`，失败保留旧场景）、图标图集跨重建复用、`setBlueprintData / notifyDataChanged / setRenderSettings / resize / setTheme / setCustomTheme`、选中与多选 `setSelectedIndex(es) / clearSelection / selectByBuildingId / focusBuilding`、预览五连 `beginPreview / applyPreviewDelta / discardPreview / previewing / getPreviewStats`、`toDataURL / toBlob / lastBuildStats / dispose`；重建原因 `RebuildReason = load | settings | data | models`。 |
| `src/lib/core/buildBuildings.ts` | `buildBuildings(transforms, buildings, options)`：按设置把建筑分成外部 GLB（`GlbModelInstances`）与元数据白模/占位盒两路，装配图标（`Icons` + `IconTexture`）、货物（`Cargos`）、下标（`IconSubscript`），返回 `{ buildings: AllBuildings, stats: BuildStats, iconTexture }`；未知 `modelIndex` 用占位色兜底不再抛错，`maxInstancesPerModel` 以「存在 glbName 的实例数」计数。 |
| `src/lib/core/AllBuildings.ts` | 一栋蓝图全部可渲染内容的容器（`Object3D`）：持有 `iconsMesh / iconTexture / cargos / modelRef / subscriptMesh / subscriptMap` 并提供 `icons` 访问器与 `dispose()`（跳过 `userData.sharedResource` 的共享几何，图集由 RenderCore 统一释放）。 |
| `src/lib/core/buildBVH.ts` | `buildBVH(transforms, buildings)` → `{ bvh, unknownModelIndexes }`：按 `selectUnitBoxTrans` 生成选择盒（分拣器走 `inserterTrans` 定向盒），未知模型用 1e-6 极小缩放占位（不可见/不可拾取，避免零缩放触发 `Unexpected empty box`）。 |
| `src/lib/core/planetScene.ts` | `buildPlanetGrid(...)`（粗线 + 可选细线，细线按 `gridAreas` 加密）与 `createPlanetScene(radius, segment, addFineGrid)` → `PlanetSceneParts { root, dirLight, sphereMaterial, gridMaterial, fineGridMaterial?, updateGridLOD(), dispose() }`：球体 + 经纬网格 + 环境光 0.3 / 平行光 2，细线用双阈值迟滞做 LOD。 |
| `src/lib/core/geometryHelpers.ts` | 几何小工具：`INSERTER_HEIGHT = 0.3` 与 `inserterTrans(transforms, trans)`（分拣器姿态矩阵 + 沿传送方向长度），供 `buildBuildings` 与 `buildBVH` 共用，保证渲染与拾取几何一致。 |
| `src/lib/core/iconHelpers.ts` | 图标纯计算：`buildingIconId(b)`（有配方用配方图标、否则物品图标）、`buildingIconPos` / `beltIconPos` / `sorterIconPos` 与 `beltIconScale` / `sorterIconScale`，共用临时矩阵避免每次分配。 |
| `src/lib/core/describeBuild.ts` | `describeBuild({ settings, buildings, bvh, stats })` → `BuildDescription`（每 modelIndex 的 glb/fallback/hidden 计数、`glbGroups`、`unknownModelIndexes`、6 位精度的 `selectBoxes`、图标与下标计数），作为可快照诊断基线；当前仅由 `tests/unit/lib/describeBuild.spec.ts` 使用，不进发布面。 |
| `src/lib/core/theme.ts` | 主题色板与解析：`THEME_PALETTE`（`editor` / `dark` / `light` 三套场景背景、星球、网格、文字填充与描边）与 `resolveTheme(theme)`（`auto` 跟随 `prefers-color-scheme: light`，无 `window` 时回落 dark，返回副本）。 |
| `src/lib/core/types.ts` | 内核内部类型：`ModelRefInstanced` / `ModelRefMatrix` / `BuildingModelRef`、`BuildStats`（建筑/GLB 组/实例/回退盒/隐藏/未知模型/图标/下标/货物计数与 `perModelGlbCounts`）、`SceneModel`。 |
| `src/lib/preview/PreviewLayer.ts` | 增量预览层（preview-delta）：「同步摄入 ingest + 每帧呈现 present」两段式——`apply(event)` 内只改 SoA 状态（`sequence` 去重、remove 不存在静默忽略、replace 不存在按 add、<120ms 的被撤销对象不出场），`tick()` 指数收敛并只上传脏槽；另含 `resyncModels()`（GLB 到达后重建池）、`setAnimate()`、`discard()`。 |
| `src/lib/preview/projector.ts` | 预览坐标投影：`PreviewProjector` 把格坐标变换成世界矩阵，支持 `layout-grid-v1`（按流式 bbox 居中+等比缩放压到 `maxSpanDeg` 内再投球面/切平面）与 `blueprint-area-local-v1`（直接复用 `findPosForAreas`，与正式场景一致）；另有 `toBlueprintAreas`（兼容扁平/嵌套两种 area 形态）、`version` 变化必须硬重投影。 |
| `src/lib/preview/pools.ts` | 预览槽池：`SlotPool`（每个模型一份 `InstancedMesh` 组 + `Float32Array`/`Uint8Array` 的 SoA 状态，容量按需翻倍、自由链表复用、`addUpdateRange` 只上传脏段）、`SLOT_FREE / SLOT_ALIVE / SLOT_DYING`、`PoolKind = glb|box|belt|inserter`、`collectGlbParts`、`buildPoolSpec`、`glbAvailable`。 |
| `src/lib/preview/materials.ts` | 预览材质：`cloneFadeMaterial` 在**克隆**的材质上注入 `aOpacity` 实例属性与抖动（dither）丢弃逻辑，避免污染共享 GLB 材质，并用不透明通道代替 `transparent` 以承受 3 万实例。 |
| `src/lib/preview/mode.ts` | 预览动画模式运行时解析：`resolvePreviewAnimation(mode)` 把 `auto` 依据 `prefers-reduced-motion` 与 `navigator.hardwareConcurrency`（≥4 核）解析成确定的 `on` / `off`，`on` / `off` 直接透传。 |
| `src/lib/preview/types.ts` | 增量预览的宽容镜像类型（结构兼容宿主事件、字段全可选）：`PreviewAnimationMode`、`PreviewCoordinateSystem`、`PreviewVec3`、`PreviewAreaLike`（扁平+嵌套两种形态）、`PreviewBuildingLike`、`PreviewOperation`、`PreviewDeltaEvent`、`PreviewBeginOptions`、`PreviewStats`。 |
| `src/lib/assets/assetBaseUrl.ts` | 资产根地址与 URL 拼接：`configureAssetBaseUrl(url)`（显式指定）、`currentAssetBaseUrl()`、`resolveAssetUrl(relativePath)`；优先级为显式配置 → `__DSP_LIB_MODULE_URL__`（ESM `import.meta.url`）→ 加载本库的 `<script src>` 目录（UMD）→ `document.baseURI`。 |
| `src/lib/assets/assetResolver.ts` | **库构建**的资产解析实现：URL 由 `assetBaseUrl` 拼字符串，文件是否存在由构建期注入的 `__DSP_LIB_ASSET_INVENTORY__` 清单决定（未注入时退化为空清单：模型全部回退元数据表、图标直接 reject 不发请求），导出 `assetResolver: AssetResolver`。 |
| `src/lib/assets/assetResolver.webpack.ts` | **编辑器构建**的资产解析实现（`vue.config.js` 用 `resolve.alias` 把 `@lib/asset-resolver` 指到这里）：GLB 走同步 `require.context`，图标走 `eager` 模板字符串 `import()`；通道贴图已内嵌进 GLB，故 `modelTextureUrl()` 恒返回 null、不再扫 PNG。 |
| `src/lib/assets/types.ts` | 资产层契约：`AssetInventory`（`models / itemRecipe / tech / signal` 四类路径清单）与 `AssetResolver`（`glbModelNames / glbModelUrl / modelTextureUrl / itemRecipeIconUrl / techIconUrl / signalIconUrl`），两份实现都由它兜住形状漂移。 |

### 5.8 建筑模型层 `src/models/`

| 文件 | 职责 |
| ---- | ---- |
| `src/models/glbAssets.ts` | GLB 资源注册表：`availableModelNames`（构建产物里真实存在的模型名集合，来自 `@lib/asset-resolver` 的静态清单）、`iconModelAliases`（物品图标名 → 模型名的别名/变形表）、`modelNameCandidates`、`resolveModelName`、`modelUrl(name)`（Promise 缓存，不存在返回 null）。 |
| `src/models/glbLoader.ts` | GLB 加载器：懒加载 + 并发上限 + 并发去重 + 超时 + 失败负缓存，**永不 reject**（失败一律 resolve 成 null 并静默回退元数据表）；同时接入 `modelCache` 读写与 KTX2 转码，导出 `loadGlbModel / getLoadedGlbModel / isGlbModelLoaded / onGlbModelLoaded / glbFailedModels / resetGlbFailure / releaseGlbModel / releaseAllGlbModels / setSettingsProvider / reapplyLoadedModelMaterials`。 |
| `src/models/buildingModel.ts` | 模型解析器（外部 GLB 优先、元数据回退）：`modelIndex → Item.icon → 别名/变形 → .glb`，导出 `resolveBuildingModel`（`glb` / `placement` / `meta`）、`buildModelPlacement`（GLB 模型空间 → 建筑局部 z 轴向上）、`requestBuildingModel`（按需触发加载）、`onBuildingModelsChanged`（到达通知）、`buildingModelName` 与 `getModelMappingReport()` 诊断报告；任一步失败只让 `glb === null`。 |
| `src/models/glbInstances.ts` | `GlbModelInstances extends Group`：遍历 GLB 原型场景的每个子网格各建一个 `InstancedMesh`，几何与材质直接复用缓存（不合并、不烘焙），实例矩阵 = 建筑世界矩阵 × 放置矩阵 × 子网格局部矩阵。 |
| `src/models/ktx2.ts` | KTX2 / Basis Universal 运行时支持：`setKtx2Renderer(renderer)`（延迟注册渲染器，`detectSupport` 决定 ASTC/ETC2/BC7/PVRTC/RGBA32）、`getKtx2Loader()`（懒建并 `setTranscoderPath` 指向 `basis/`）、`isKtx2Supported()`、`disposeKtx2Loader()`；**永不 throw / reject**，不可用时返回 null 让 `glbLoader` 走既有降级。 |
| `src/models/textureFallback.ts` | 缺失底色贴图的兜底：`missingAlbedoColor`（overrides 表 → 材质名启发式 black/glass/water → 中性灰 `0x8f9498`）与 `missingAlbedoTexture` 生成 1×1 纯色 `DataTexture`，避免无 `map` 的材质渲染成刺眼纯白。 |
| `src/models/textureManifest.ts` | 外部通道贴图清单——**当前为空表**（`materialTextureFiles = {}`、`materialMapUrls = {}`、`manifestTextureFiles = []`）：法线/自发光/spec 已全部内嵌进 GLB（KTX2），登记任何文件都会把 PNG 重新拉进依赖图并给库产物多出约 200 MB；历史映射留在 `tests/unit/scripts/texture-mapping.json`。 |
| `src/models/textureMaps.ts` | 通道贴图加载与预处理：`loadMaterialTextureSet`（懒加载 + 去重 + 失败负缓存、永不 reject、`flipY = false` 修 UV 错位、把 Unity spec-gloss 现场打包成 ORM 图）、`setTextureMaxAnisotropy`、`clearTextureCache`；因清单为空，当前构建中这条外置贴图路径不再触发。 |
| `src/models/materialTextures.ts` | 把通道贴图挂到 GLB 材质：`applyModelMaterialTextures` 优先用 GLB 内嵌贴图、缺底色时用 `textureFallback`、按 `textureManifest` 补外部通道、把 spec-gloss 翻译成 metalness/roughness，并遵守 `TextureSettings` 的 7 通道开关；原地改共享材质对象，带 `hasMaterialTextures` 判定。 |
| `src/models/modelMaterialTuning.ts` | 模型材质参数表（唯一手调入口，73 条）：每模型 `emissiveIntensity / envMapIntensity / metalness`，另含 `DEFAULT_MODEL_MATERIAL_TUNING`、`METALNESS_WITHOUT_SPEC_MAP = 0.25` 与 `resolveModelMaterialTuning`。 |
| `src/models/envMap.ts` | 建筑材质的中性环境反射：`createNeutralEnvironment(renderer)` 用 `PMREMGenerator` 从程序化天空/地面渐变生成环境贴图（不引入外部资源），`setBuildingEnvironment` / `getBuildingEnvironment` 注入与读取；只挂 `material.envMap`，不设 `scene.environment`。 |
| `src/models/modelPack.ts` | 「离线模型包」：`isPackSupported` / `isPersistenceEnabled` / `resolvePackFiles` / `inspectPack`（total·cached·missing·missingBytes）/ `downloadPack({ signal, onProgress })`（按文件粒度进度、已缓存不重下、可取消续传）/ `clearPack`；持久化总开关关闭时整体退化为「不支持」，不会出现假成功。 |
| `src/models/modelCache.ts` | GLB 的浏览器本地持久化缓存（Cache Storage，非 IndexedDB）：`MODEL_CACHE_NAME = "dsp-models-v1"`、`modelCacheKey`（带内容哈希的 URL 即键）、`readCachedModel / storeCachedModel / removeCachedModel / cachedModelUrls / clearModelCache / requestPersistentStorage`，以及开关关闭或环境不支持时返回的 `NoopModelCache`（读永不命中、写永远失败、完全不碰 `caches`）。 |
| `src/models/modelCacheConfig.ts` | 模型本地缓存的全局开关：`isModelCacheEnabled()` 优先级为「运行时 `setModelCacheEnabled()` 覆盖 > 构建期 `__DSP_MODEL_CACHE_ENABLED__`（`config/persistence.config.js` 的 `web` / `lib` 字段注入）> 默认开启」，`setModelCacheEnabled(null)` 恢复构建配置值。 |

***

## 6. 关键类与函数说明

本章按模块逐一说明核心类型与类/函数的真实签名、常量取值与行为约束。所有签名、字节布局和数值均以当前源码为准，括号内标注模块是否对外导出（"模块内"表示未写 `export`，只能通过同文件内部调用）。

### 6.1 `blueprint/parser.ts`

蓝图字符串 ⇄ `BlueprintData` 的唯一编解码入口。文件格式为 `BLUEPRINT:` + 头部字段 + `"` + base64(gzip(二进制体)) + `"` + 32 位大写十六进制 MD5；二进制体按 .NET `BinaryWriter` 的小端格式排列，建筑记录分 v1（固定 61 字节）与 v2（0.10.34+，记录标记 + 变长字段）两代。

#### 导出面

| 类别 | 内容 | 数量 |
| ---- | ---- | ---- |
| 函数 | `fromStr`、`toStr` | 2 |
| 蓝图数据结构 | `BlueprintArea`、`BlueprintBuilding`、`BlueprintReformRect`、`BlueprintReformData`、`BlueprintData` | 5 |
| 参数接口 | `StationParameters`、`AdvancedMiningMachineParameters`、`SplitterParameters`、`AssembleParamerters`、`LabParamerters`、`BeltParameters`、`InserterParameters`、`TankParameters`、`StorageGrid`、`StorageParameters`、`Fighter`、`BattleBaseParameters`、`EjectorParameters`、`PowerGeneratorParameters`、`ArtifacialStarParameters`、`EnergyExchangerParameters`、`MonitorParameters`、`DispenserParameters` | 18 |
| 枚举 | `IODir`、`LogisticRole`、`AcceleratorMode`、`ResearchMode`、`StorageType`、`BattleBaseDroneConstructPriority`、`EnergyExchangerMode`、`SpawnItemOperator`、`DispenserPlayerMode`、`DispenserStorageMode` | 10 |

`AllParameters` 是模块内的联合类型（`AssembleParamerters | StationParameters | ... | UnknownParamerters`），**没有导出**，仅作为 `BlueprintBuilding.parameters` 与 `ParamParser` 的类型上界；`UnknownParamerters` 同样只在模块内可见。

#### 入口函数

```ts
export function fromStr(strData: string): BlueprintData;
export function toStr(bp: BlueprintData): string;
```

`fromStr` 流程：校验 `BLUEPRINT:` 前缀 → 按 `"` 定位头部字段串（逗号分隔）→ 头部字段数校验 → 尾部 33 字节定位 `"` 与校验和 → MD5 比对 → 中间段 base64 解码 → `pako.ungzip` → `BufferReader` 依次读 meta（28 字节）/ area 数组 / 建筑数组 → `version >= 2` 时再读 `importTailV2`。

`toStr` 流程：按 `bp.version >= 2` 决定头部格式标记（`1` / `0`）→ 拼头部 → `encodedSize(bp)` 预分配 `Uint8Array` → 写 meta / areas / buildings（v2 走 `exportBuildingV2`，否则 `exportBuilding`）→ v2 追加 `patch` + `reformDataFlag` + 地基数据 + `tailExtraBytes` → `pako.gzip` → base64 → 拼 MD5。

头部字段：v1 为 12 个（`cells[0]` 格式标记、`cells[1]` layout、`cells[2..7)` 5 个图标 id、`cells[7]` 仅导出时写 `0`、`cells[8]` 时间、`cells[9]` 游戏版本、`cells[10]` 短描述、`cells[11]` 长描述）；v2 为 15 个（短描述后多 `cells[11]` 作者、`cells[12]` 蓝图版本、`cells[13]` 属性串，`cells[14]` 长描述）。时间字段是「毫秒 × 10000」，基准为 `TIME_BASE = new Date(0).setUTCFullYear(1)`。

#### 数据结构

```ts
export interface BlueprintArea {
    index: number;
    parentIndex: number;
    tropicAnchor: number;
    areaSegments: number;
    anchorLocalOffset: { x: number; y: number };
    size: { x: number; y: number };
}

export interface BlueprintBuilding {
    index: number;
    areaIndex: number;
    localOffset: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
    yaw: [number, number];
    tilt: number;
    itemId: number;
    modelIndex: number;
    outputObjIdx: number;
    inputObjIdx: number;
    outputToSlot: number;
    inputFromSlot: number;
    outputFromSlot: number;
    inputToSlot: number;
    outputOffset: number;
    inputOffset: number;
    recipeId: number;
    filterId: number;
    parameters: null | AllParameters;
    v2ExtraPose?: number[];   // 分拣器 7 个 float，字节级原样保留
    content?: string;         // -102 记录：信标等自定义文本
    extraBytes?: Uint8Array;  // 未知扩展间隙，原样保留
}

export interface BlueprintReformRect {
    reserved: number;
    x: number; y: number; w: number; h: number;
    type: number;   // data 高 3 位
    color: number;  // data 低 5 位
    areaIndex: number;
}

export interface BlueprintReformData {
    reserved: number;
    rects: BlueprintReformRect[];
    customReformColorMask: number;
    customReformColors: number[];
}

export interface BlueprintData {
    header: {
        layout: number;
        icons: number[];
        time: Date;
        gameVersion: string;
        shortDesc: string;
        author: string;           // v2 新增，旧蓝图为 ""
        blueprintVersion: string; // v2 新增
        properties: string;       // v2 新增，形如 "名称:内容;名称:内容;"
        desc: string;
    };
    version: number;
    cursorOffset: { x: number; y: number };
    cursorTargetArea: number;
    dragBoxSize: { x: number; y: number };
    primaryAreaIdx: number;
    areas: BlueprintArea[];
    buildings: BlueprintBuilding[];
    patch?: number;
    reformData?: BlueprintReformData | null;
    tailExtraBytes?: Uint8Array;
}
```

枚举取值（源码原样）：

| 枚举 | 取值 |
| ---- | ---- |
| `IODir` | `None = 0`、`Output = 1`、`Input = 2` |
| `LogisticRole` | `None = 0`、`Supply = 1`、`Demand = 2` |
| `AcceleratorMode` | `ExtraOutput = 0`、`Accelerate = 1` |
| `ResearchMode` | `None = 0`、`Compose = 1`、`Research = 2` |
| `StorageType` | `DEFAULT = 0`、`FILTERED = 9` |
| `BattleBaseDroneConstructPriority` | `REPARE = 0`、`BALANCE = 1`、`CONSTRUCT = 2` |
| `EnergyExchangerMode` | `Discharge = -1`、`StandBy = 0`、`Charge = 1` |
| `SpawnItemOperator` | `NONE = 0`、`GENERATE = 1`、`CONSUME = 2` |
| `DispenserPlayerMode` | `NONE = 0`、`RECYCLE = 1`、`BOTH = 2`、`SUPPLY = 3` |
| `DispenserStorageMode` | `NONE = 0`、`SUPPLY = 1`、`DEMAND = 2` |

#### 二进制读写（模块内）

- `abstract class BufferIO`：持有 `pos` 与 `DataView`，`getView(length)` 返回子视图并推进 `pos`（越界抛中文错误）。
- `class BufferReader extends BufferIO`：`getUint8 / getInt8 / getInt16 / getInt32 / getUint32 / getFloat32 / getBytes(length) / getString()`，另有 `get position()`；`getString()` 实现 .NET 的 7-bit 编码长度前缀 + UTF-8，`shift > 35` 视为长度前缀损坏。
- `class BufferWriter extends BufferIO`：`setUint8 / setInt8 / setInt16 / setInt32 / setUint32 / setFloat32 / setBytes / setString`，`setString` 先写 7-bit 编码的字节长度。
- 辅助：`encoded7BitLength(value)`、`btoUint8Array`、`Uint8ArrayTob`、`hex(ArrayBuffer)`（大写 16 进制）。

#### 参数解析体系

```ts
interface ParamParser<TParam extends AllParameters> {   // 模块内
    encodedSize(p: TParam, version?: number): number;
    encode(p: TParam, a: DataView): void;
    decode(a: DataView): TParam;
}

function getParam(v: DataView, pos: number, defaultValue?: number): number; // pos 为 int32 槽位
function setParam(v: DataView, pos: number, value: number): void;
function parserFor(itemId: number): ParamParser<AllParameters>;
```

`ParamParser.encodedSize` 返回的是 **int32 槽位数**（`exportBuilding` 里写 `setInt16(length)` 后按 `length * 4` 字节取视图），不是字节数。

参数读写统一以 int32 槽位寻址，`getParam` 在数据段过短时返回 `defaultValue`（未给默认值则抛 `参数解析错误：数据段太短`）。

`parameterParsers` 注册表（`Map<number, ParamParser<AllParameters>>`，共 **34** 个条目：23 条显式登记 + `allAssemblers` 中未登记的 11 个制造类建筑）：

| itemId | 建筑 | parser | encodedSize（int32 槽） |
| ---- | ---- | ---- | ---- |
| 2103 | 物流塔 | `stationParamsParser(stationDesc)` | 2048 |
| 2104 | 星际物流塔 | `stationParamsParser(interstellarStationDesc)` | 2048 |
| 2316 | 大型采矿机 | `advancedMiningMachineParamParser()` | 2048 |
| 2020 | 分流器 | `splitterParamParser` | 4（v1）/ 6（v2） |
| 2901 / 2902 | 研究站 MK1 / MK2 | `labParamParser` | 2 |
| 2001 / 2002 / 2003 | 传送带 MK1~MK3 | `beltParamParser` | 2 |
| 2011 ~ 2014 | 分拣器 MK1~MK4 | `inserterParamParser` | 1 |
| 2101 / 2102 | 小型 / 大型储物仓 | `storageParamParser(30)` / `storageParamParser(60)` | 110 |
| 2106 | 储液罐 | `tankParamParser` | 2 |
| 2311 | 电磁轨道弹射器 | `ejectorParamParser` | 2 |
| 2208 | 射线接收站 | `powerGeneratorParamParser` | 1 |
| 2210 | 人造恒星 | `artifacialStarParamParser` | 1 |
| 2209 | 能量枢纽 | `energyExchangerParamParser` | 1 |
| 2030 | 监测器 | `MonitorParamParser` | 128 |
| 3009 | 战场基站 | `battleBaseParamParser()` | 110 |
| 2107 | 配送器 | `dispenserParamParser` | 128 |
| `allAssemblers` 中未登记项 | 制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机 | `assembleParamParser` | 1 |

`allAssemblers` 共 13 个 id（2303/2304/2305/2318/2302/2315/2319/2308/2309/2317/2310/2901/2902），其中 2901、2902 已有 `labParamParser`，故循环补登记 11 个。未注册的 itemId 退回 `unknownParamParser`，把参数段按原始 `Int32Array` 原样保留（保证未知建筑往返不丢字节）。

其余 parser 的字段布局要点：物流塔 `stationParamsMeta = { base: 320, storage: { base: 0, stride: 6 }, slots: { base: 192, stride: 4 } }`，`numSlots = 12`，`2103` 的 `maxItemKind = 4`、`2104` 为 5、`2316` 为 1（并额外写 `base + 9` 的 `miningSpeed`）；分拣器（`SplitterParameters`）为 4 个 `priority` 布尔 + v2 额外的 2 个 int32（`extra`）；储物仓在 `type === FILTERED` 时才写 `10 + i` 的过滤格。

#### v1 / v2 建筑记录

```ts
function importBuilding(r: BufferReader): BlueprintBuilding;                      // 模块内，也能识别 v2 标记
function importBuildingV2(r: BufferReader, bytes: Uint8Array, last: boolean): BlueprintBuilding;
function exportBuilding(w: BufferWriter, b: BlueprintBuilding): void;
function exportBuildingV2(w: BufferWriter, b: BlueprintBuilding): void;
function v2BuildingSize(b: BlueprintBuilding): number;
function v2ContentSize(content: string | undefined): number;
function isV2RecordMarkerAt(bytes: Uint8Array, off: number): boolean;
```

- v1 记录固定 61 字节：index 4 + areaIndex 1 + localOffset 24 + yaw 8 + itemId 2 + modelIndex 2 + outputObjIdx/inputObjIdx 8 + 6 个 int8 槽位字段 6 + recipeId 2 + filterId 2 + 参数长度 2，之后是参数段。
- v2 记录：`marker(int32)` + `index(int32)` + `itemId(int16)` + `modelIndex(int16)` + `areaIndex(int8)` + 首端 xyz(12) + `yaw0(4)`，传送带/分拣器再加 `tilt(4)`，分拣器再加 7 个 float 姿态（`[reserved, tip.x, tip.y, tip.z, rot.x, rot.y, tip.yaw]`，其中 `1..3` 作为第二端 `localOffset[1]`、`6` 作为 `yaw[1]`），随后是 out/in 索引、6 个槽位字段、recipe/filter、参数段，`-102` 记录再追加 `content`（int32 长度 + 7-bit 前缀字符串），最后是可能的 `extraBytes`。
- `isV2RecordMarkerAt(bytes, off)`：小端读 int32 ≤ `-100` 且偏移 `+7` 的字节 < `0x80`（即随后 index 非负）。
- `importBuilding` 自身以「首 int32 ≤ -100 即视为 marker」判断 v2，因此两种记录都能读；`fromStr` 则按 `meta.version` 决定整段走哪个循环。
- 非最后一条 v2 记录若已知字段结束处不是下一标记，会在 `V2_RECORD_GAP_LIMIT = 64` 字节内搜索下一标记，把间隙存进 `extraBytes`；搜不到抛 `v2 建筑记录存在未知的尾部扩展`。

#### 地基数据与尾部

```ts
function importReformData(r: BufferReader): BlueprintReformData;
function exportReformData(w: BufferWriter, d: BlueprintReformData): void;
function reformDataSize(d: BlueprintReformData): number;
function hasReformData(bp: BlueprintData): bp is BlueprintData & { reformData: BlueprintReformData };
function importTailV2(r: BufferReader, bodyEnd: number): { patch: number; reformData: BlueprintReformData | null; tailExtraBytes?: Uint8Array };
```

- 每矩形 9 字节（reserved 1 + x/y int16 各 2 + w/h 各 1 + data 1 + areaIndex 1），`type = data >> 5`、`color = data & 0x1f`；导出时写回 `((type & 0x07) << 5) | (color & 0x1f)`。
- 尾部顺序：`patch(int32)` → `reformDataFlag(uint8)` → `reformData`（标志非 0 时）→ 剩余字节全部作为 `tailExtraBytes` 保留（0.10.33 实测 5 字节预留）。
- `hasReformData` 只在 `reformData != null && rects.length > 0` 时为真；导出时 `patch` 缺省写 `1`。

#### 关键常量

| 常量 | 值 | 说明 |
| ---- | ---- | ---- |
| `START` | `"BLUEPRINT:"` | 蓝图字符串前缀 |
| `TIME_BASE` | `new Date(0).setUTCFullYear(1)` | 头部时间基准 |
| `V2_RECORD_MARKER` | `-102` | 导出使用的 v2 记录标记（0.10.34 格式） |
| `V2_RECORD_MARKER_MIN` | `-100` | 导入接受的标记下限（兼容 -101 / -102） |
| `V2_BELT_ITEM_IDS` | `{2001, 2002, 2003}` | 带 `tilt` 字段的传送带 |
| `V2_INSERTER_ITEM_IDS` | `{2011, 2012, 2013, 2014}` | 带 `tilt` + 7 float 姿态的分拣器 |
| `V2_RECORD_GAP_LIMIT` | `64` | 未知尾部扩展的最大搜索字节数 |
| `REFORM_COUNT_LIMIT` | `2930400` | 地基矩形数 / 自定义颜色数的合理性上限 |
| 头部字段数 | 12（v1）/ 15（v2） | 由 `cells[0]`（`"0"` / `"1"`）区分 |
| 单条 area 记录 | 14 字节 | `index/parentIndex` int8 + 4 个 int16 + 2 个 int16 |
| v1 建筑记录 | 61 字节 | 不含参数段 |
| meta | 28 字节 | version + cursorOffset.xy + cursorTargetArea + dragBoxSize.xy + primaryAreaIdx（7 个 int32） |

#### 易踩的坑

- `ParamParser.encodedSize` 单位是 int32 槽位；`encodedSize(bp)`（蓝图总体字节数）才是字节数，两者不可混用。
- `toStr` **不做**任何 area 归一化（源码中不存在旧文档提到的 `normalizeBlueprintAreas`），蓝图里的 `areas` 原样写出。
- 参数段只按 `itemId` 选 parser，不校验 `length` 与 `encodedSize` 是否一致：编码时长度由 parser 决定，解码时以记录里的 `length` 为准。
- 未知 itemId 的参数以 `Int32Array` 原样保留，因此新增建筑即使没有 parser 也能安全往返。
- `-101/-100` 记录没有 `content` 字段；只有 `marker <= -102` 才读 content。
- MD5 覆盖「`BLUEPRINT:` 起到校验引号前」的整串 ASCII，校验失败抛 `Checksum mismatch`，前缀/头部/校验和分别抛 `Invalid start` / `Header too short` / `Checksum not found`。

### 6.2 `command.ts`

撤销栈与增量刷新的中枢：`Command` 定义可撤销操作，`CommandQueue` 维护栈与两个版本号，`Updater` 汇总 5 条增量刷新通道。

#### 类型与类

```ts
export class EventDispatcher<TArgs extends Array<any>> {
    on(callback: (...args: TArgs) => void): void;
    onMounted(callback: (...args: TArgs) => void): void; // 内部 onMounted 注册 / onUnmounted 注销
    dispatch(...args: TArgs): void;
    clear(): void;
}

export class Updater {
    updateBuildingIcon: EventDispatcher<[b: BlueprintBuilding]>;
    updateBeltIcon: EventDispatcher<[b: BlueprintBuilding]>;
    updateBeltIconSubscript: EventDispatcher<[b: BlueprintBuilding]>;
    updateSorterIcon: EventDispatcher<[b: BlueprintBuilding]>;
    updateStationInfo: EventDispatcher<[b: BlueprintBuilding]>;
    clearAll(): void;
}

export interface Command {
    do(data: BlueprintData, updater: Updater): void;
    undo(data: BlueprintData, updater: Updater): void;
    merge(c: Command): boolean;
    readonly silent?: boolean; // 省略等价 false
}

export class CommandQueue {
    readonly data: BlueprintData;
    readonly updater: Updater;
    readonly stateVersion: Ref<number>;
    readonly execVersion: Ref<number>;
    get maxSize(): number; set maxSize(value: number);
    push(c: Command): void;
    canUndo(): boolean; undo(): boolean;
    canRedo(): boolean; redo(): boolean;
}
```

#### 5 条刷新通道

| 通道 | 派发方 | 订阅方 |
| ---- | ---- | ---- |
| `updateBuildingIcon` | `ReplaceCommand`（配方）、`SetAcceleratorCommand`、`UpgradeCommand`（非传送带/分拣器） | `BlueprintEditor.vue` 的 `registerUpdater` |
| `updateBeltIcon` | `ReplaceCommand`（传送带图标）、`UpgradeCommand`（传送带）、`StationInfo.vue`（改库存物品时同步该槽位入口传送带的 `parameters.iconId`） | `BlueprintEditor.vue`、`BuildingInfoPanel.vue`（`onMounted` 注册，用于让 `beltVersion` 失效） |
| `updateBeltIconSubscript` | 当前源码**无派发方** | `BlueprintEditor.vue`（重算下标文本并写回 `subscriptMesh`） |
| `updateSorterIcon` | `ReplaceCommand`（过滤物品）、`UpgradeCommand`（分拣器） | `BlueprintEditor.vue`、`BuildingInfoPanel.vue`（让 `filterVersion` 失效） |
| `updateStationInfo` | `ReplaceCommand`（物流塔库存）、`StationInfo.vue` 内部两个命令 | 由物流塔面板自身的响应式数据驱动 |

`EventDispatcher.onMounted` 用 Vue 的 `onMounted` / `onUnmounted` 配对注册与注销，所以只能在组件 `setup` 期间调用（`BuildingInfoPanel.vue` 即如此使用）；`clear()` 用于场景重建前清空陈旧回调，避免引用已销毁的 `AllBuildings`。

#### 版本号语义

| 版本号 | 递增条件 | 消费者 |
| ---- | ---- | ---- |
| `stateVersion` | 任何命令入栈 / 撤销 / 重做 / `trim()` 丢命令 | `App.vue` 用 `watch` 把它映射为 `codeExpired = true`（蓝图字符串需重新生成）；`ProductionStats.vue`、`StationInfo.vue` 也依赖它刷新统计 |
| `execVersion` | 仅当命令 `silent !== true` | `BlueprintEditor.vue` 的建筑重建 `computed`、`BuildingOverview.vue` 的统计 |

- `silent = true`：只改图标/颜色/文字/纯数据，几何与拓扑不变 → 仅 `stateVersion++`，3D 层不重建。当前实现者有 `ReplaceCommand`、`SetAcceleratorCommand`、`SetBeaconContentCommand`，以及 `StationInfo.vue` 内的 `SetStationStorageItemCommand` / `SetStationParamCommand`。
- `silent` 省略（`RemoveBuildingsCommand` 系列、`UpgradeCommand`）→ 同时递增两个版本号，整场景重建。

#### 队列行为

- 容量 `_maxSize = 256`；`maxSize` 的 setter 会立即调用 `trim()`。`trim()` 在超容时从队首丢弃 `min(超出数量, currentPosition)` 条并相应前移 `currentPosition`，同时 `stateVersion++`。
- `push(c)` 顺序：丢弃 `currentPosition` 之后的命令（重做分支）→ **先执行 `c.do`** → 若上一条命令的 `merge(c)` 返回 `true` 则直接返回（不再入栈、也不递增任何版本号，因为效果已被上一条命令吸收）→ 入栈 → `currentPosition++` → `trim()` → `stateVersion++` → 非 silent 再 `execVersion++`。
- 目前只有 `SetBeaconContentCommand` 会在「同一建筑」时返回 `true`，其余命令（`ReplaceCommand`、`RemoveBuildingsCommand`、`UpgradeCommand`、`SetAcceleratorCommand`、`StationInfo.vue` 内两个命令）恒返回 `false`。
- `undo` / `redo`：移动 `currentPosition` 后调用对应 `undo` / `do`，按命令自身的 `silent` 决定是否递增 `execVersion`，并总是递增 `stateVersion`。
- `canUndo()` / `canRedo()` 内部读取 `stateVersion.value`，借此建立响应式依赖（栈位置变化时按钮状态能刷新）。

### 6.3 `blueprint/replace.ts` `ReplaceCommand`

批量替换配方及其派生物（过滤物品、物流塔库存、传送带图标、蓝图头部图标）。**替换维度确认为 5 个**，与 `ReplaceParams.scope` 的 5 个布尔一一对应；「建筑等级」不走本命令，而由 `UpgradeCommand` 处理。

```ts
export interface ReplaceParams {
    searchRecipe: number;
    replaceRecipe: number;
    scope: {
        recipe: boolean;      // 制造类建筑的 recipeId
        filter: boolean;      // 建筑 filterId
        station: boolean;     // 物流塔/星际塔/大型采矿机的库存 itemId
        beltIcon: boolean;    // 传送带 parameters.iconId
        blueprintIcon: boolean; // 蓝图 header.icons[i]
    };
}

export class ReplaceCommand implements Command {
    readonly silent = true;
    recipeBuildings: BlueprintBuilding[];
    filterBuildings: BlueprintBuilding[];
    stationStorage: { b: BlueprintBuilding; i: number }[];
    beltBuildings: BlueprintBuilding[];
    blueprintIconIndex: number[];
    searchRecipeId: number;
    replaceRecipeId: number;
    constructor(bp: BlueprintData, params: ReplaceParams);
    replace(recipeId: number, data: BlueprintData, updater: Updater): void;
    do(data: BlueprintData, updater: Updater): void;   // → replace(this.replaceRecipeId, ...)
    undo(data: BlueprintData, updater: Updater): void; // → replace(this.searchRecipeId, ...)
    merge(): boolean;                                   // 恒 false
}
```

行为要点：

- 构造时先查 `recipesMap.get(params.searchRecipe)`，缺失直接抛 `Unknown search recipe <id>`；搜索产物取 `searchRecipe.to[0].item.id`，搜索图标取 `recipeIconId(params.searchRecipe)`（配方有独立图标时为 `recipeId + 20000`，否则为产物 itemId）。
- 收集规则（按 `scope` 逐个开关）：
  - `recipe`：`b.recipeId === searchRecipe`；
  - `filter`：`b.filterId === 搜索产物 itemId`（用产物而不是图标匹配）；
  - `station`：`isStation(b.itemId)`（2103 / 2104 / 2316 三个 id）时遍历 `parameters.storage`，命中 `itemId === 搜索产物` 的槽位；
  - `beltIcon`：`isBelt(b.itemId)` 且 `parameters.iconId === 搜索图标`；
  - `blueprintIcon`：`header.icons[i] === 搜索图标` 的下标。
- `replace(recipeId, data, updater)`：查 `recipesMap`，缺失抛 `Unknown recipe <id>`；随后把 5 组目标统一改写为新配方的 id / 产物 itemId / 图标，并按通道派发 `updateBuildingIcon`（配方）、`updateSorterIcon`（过滤）、`updateBeltIcon`（传送带图标）、`updateStationInfo`（库存），蓝图头部图标直接写数组。
- `silent = true`：只改数据，不重建 3D 场景；但 `stateVersion` 会递增，蓝图字符串仍会被标记过期。
- `merge` 恒 `false`，连续替换不会合并成一条撤销记录。

> ⚠️ 待确认：`stationStorage` 记录的是 `storage.filter(...).map((s, i) => ({ b, i }))` 里的 `i`，即**过滤后数组下标**而非 `storage` 原下标。当命中的库存项不是从 `storage[0]` 起连续排列时，`replace` 会改到错误槽位。是否为已知缺陷需与维护者确认。

### 6.4 `blueprint/removeBuilding.ts` 三个删除命令

```ts
export class RemoveBuildingsCommand implements Command {
    constructor(indices: number[], data: BlueprintData);
    do(data: BlueprintData): void;
    undo(data: BlueprintData): void;
    merge(): boolean; // false
}
export class RemoveBuildingCommand extends RemoveBuildingsCommand {
    constructor(index: number, data: BlueprintData);
}
export class RemoveBuildingsByItemCommand extends RemoveBuildingsCommand {
    constructor(itemId: number, data: BlueprintData);
}
```

行为要点：

- 构造：`indices` 去重升序后生成 `removed: { index, building }[]` 与 `removeSet: Set<number>`；两个子类只是收集下标的方式不同——`RemoveBuildingCommand` 单删（3D 视图右键），`RemoveBuildingsByItemCommand` 遍历 `data.buildings` 收集所有 `itemId` 相同的下标（列表图标右键「剔除同类」）。
- `do`：先按「数组位置即 `index`」的前提建 `newIndexOf: Int32Array`（-1 表示被删）→ 记录幸存建筑中指向被删建筑的 `outputObjIdx` / `inputObjIdx`（`dangling`，供撤销恢复）→ 倒序 `splice` 删除 → 重排 `b.index` 与两个交叉引用（指向幸存者的按删除数量前移，指向被删者的置 -1）。
- `undo`：按记录的旧位置插回原建筑对象（`parameters` / `content` / `extraBytes` 等全部保留）→ `b.index = i` 重排 → 用 `oldIndexOfNew` 把幸存者引用映射回旧下标 → 先恢复 `dangling` 连接，再跳过 `dangling` 字段，避免二次映射。
- 两个方法都只接收 `data`（未使用 `updater`），因此删除不发生增量刷新，靠 `execVersion++` 触发整场景重建。
- `merge` 恒 `false`：连续剔除不会合并。
- 前提约束：`data.buildings[i].index === i` 必须成立；删除后需保持该不变式（本命令已维护）。

### 6.5 `blueprint/buildingInfo.ts` `BuildingInfo`

```ts
export class BuildingInfo {
    adjacency: BlueprintBuilding[][];
    constructor(buildings: BlueprintBuilding[]);
}
```

- 构造时先把 `adjacency` 初始化为 `buildings.length` 个空数组（行下标 = 建筑 `index`），再遍历建筑按端口槽位挂对端：
  - `outputObjIdx >= 0`：`adjacency[b.index][b.outputFromSlot] = buildings[b.outputObjIdx]`，同时 `adjacency[b.outputObjIdx][b.outputToSlot] = b`（反向登记）；
  - `inputObjIdx >= 0`：`adjacency[b.index][b.inputToSlot] = buildings[b.inputObjIdx]`，同时 `adjacency[b.inputObjIdx][b.inputFromSlot] = b`。
- 结论：`adjacency[i][slot]` 给出「建筑 i 第 slot 号端口上的对端建筑」，未连接的端口是稀疏空洞（`undefined`），不是 `null`。
- 由 `App.vue` 的 `computed` 在蓝图数据变化时整体重建，经 `buildingInfoKey` 提供给下游（如 `SpitterInfo.vue` 用 `adjacency[building.index][i]` 的 `outputObjIdx` 判断端口方向与配色）。

### 6.6 `blueprint/planet.ts`

把蓝图的多 `BlueprintArea` 摆回标准星球，并把建筑局部坐标换算成世界变换矩阵。

```ts
export interface PositionedBlueprint {
    segment: number;
    areas: { longitude: number; latitude: number; segment: number }[];
}

export function* gridAreas(segment = 200): Generator<{ minLatitudeSeg: number; latitudeSeg: number; longitudeSeg: number }>;
export function findPosForAreas(areas: BlueprintArea[], segment = 200): PositionedBlueprint;
export function calcBuildingTrans(R: number, pos: PositionedBlueprint, building: BlueprintBuilding): Matrix4[];
```

模块内部还有：`segmentArr`（14 行 `[minSeg, longitudeSeg]` 纬度带表，最后一行 `[Infinity, Infinity]` 作哨兵）、`segmentMap`（由每行第二列建 `longitudeSeg → 行下标` 的映射，键为 1/4/8/16/20/32/40/60/80/100/120/160/200）、`calcLatitudeSeg(seg, maxSegment = 200)`、`planetAreaByIndex(i, segment = 200)`、`planetAreaByLongitudeSegment(segment, maxSegment = 200)`、`gcd`、`lcm`。

`findPosForAreas` 行为：

1. 以 `parentIndex` 建子节点邻接表，`parentIndex < 0` 的作为根；没有根抛 `No root area found.`。
2. `gridCount[i] = areas[i].areaSegments * GRID_PER_SEGMENT`；`longitudeBase = lcm(所有 gridCount)`；`gridSize[i] = longitudeBase / gridCount[i]`；`period = lcm(所有 gridSize)`。
3. 经度：从 `0` 起按 `gridSize[root]` 步进暴力搜索，`validateArea` 递归校验子 area 的 `tropicAnchor` 锚点是否对齐（`anchor % gridSize[j] === 0`），成功即写入 `longitude / gridSize[i]`；全部失败抛 `No suitable longitude found.`。
4. 纬度：按根 area 的子节点关系判定半球与吸附边界——子 area 段数小于父（`onHighTropic`）时取该带的上边界 `(minLatitudeSeg + latitudeSeg) * GRID_PER_SEGMENT - size.y + 1`；子段数更大（`onLowTropic`）时取 `minLatitudeSeg * GRID_PER_SEGMENT + 1`；无跨带子节点时取带中线并取整。子 area 与父段数相同抛 `Area <j> has the same segments as its parent`，`anchorLocalOffset.y === 0` 抛 `Area <j> unexpected anchorLocalOffsetY == 0`。仅落在负半球时用 `-latitude - size.y + 1` 翻转。
5. 子 area 纬度 = 父纬度 + `anchorLocalOffset.y`，递归填满。

`calcBuildingTrans(R, pos, building)`：

- `longitudeGridSize = 2π / area.segment / GRID_PER_SEGMENT`，`latitudeGridSize = 2π / pos.segment / GRID_PER_SEGMENT`。
- 对 `building.localOffset` 的每个端点：`longitude = (area.longitude + offset.x) * longitudeGridSize`、`latitude = (area.latitude + offset.y) * latitudeGridSize`、`height = R + offset.z * HEIGHT_GRID_SIZE`；用 `Euler(-latitude, longitude, -yaw[i] / 180 * π, "YXZ")` 生成旋转，再与 `translate(0, 0, height)` 相乘。
- 返回的矩阵数组长度等于 `localOffset.length`（通常为 2：传送带/分拣器的两端），直接用于渲染与 `BVH`。
- **不使用 `building.tilt`**；分拣器第二端的姿态来自 `localOffset[1]` 与 `yaw[1]`。
- 依赖常量：`GRID_PER_SEGMENT = 5`、`HEIGHT_GRID_SIZE = 4 / 3`（`src/planetConstants.ts`），调用方传入的 `R` 即 `PLANET_RADIUS = 200.2`。

`gridAreas(segment)` 依次产出各纬度带参数，对完全位于赤道一侧的带（`minLatitudeSeg > 0`）额外产出一条镜像区间；`segment = 200` 时共 **23** 条（`i = 1..12`，其中 11 条带镜像）。仅供 `buildPlanetGrid`（`src/lib/core/planetScene.ts`）使用。

### 6.7 `components/BlueprintEditor.vue`

编辑器的 3D 视图层：负责场景装配、相机控件、BVH 拾取、单选与右键剔除，以及「命令后整场景重建」。渲染构建本身（GLB/白模、图标、货物、下标、BVH）已下沉到 `src/lib/core/`，本组件只保留 Vue 交互与生命周期。

```ts
const props = defineProps<{ selectedBuildingIndex: number | null }>();
const emit = defineEmits<{ (e: "update:selectedBuildingIndex", index: number | null): void }>();
defineExpose({ selectBoxes, camera, cameraPosVersion, getModel, resetCamera });
```

模板只有一个 `div.editor-root`（`tabindex="-1"`，用于接收键盘事件），全部内容由 Three.js 渲染。

#### 职责分解

| 职责 | 实现 |
| ---- | ---- |
| 场景装配 | `createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT)` 产出星球球体 + 经纬网格 + `dirLight`，加入本地 `Scene`；`createSkyGradient({ planetRadius })` 加天光/星空，卸载时 `dispose` |
| 渲染器与贴图管线 | `new WebGLRenderer({ antialias: true })`；`setTextureMaxAnisotropy`、`setKtx2Renderer(renderer)`（KTX2 转码按 GPU 能力选目标格式）、`setBuildingEnvironment(createNeutralEnvironment(renderer))`（只挂建筑材质，不设 `scene.environment`）；`setSettingsProvider(() => getAppliedRenderSettings())` |
| 相机 | `PerspectiveCamera(50)`，`near = 0.5`、`far = 3000`，初始 `z = 2 * PLANET_RADIUS` |
| 图标图集 | `editorIconTexture = new IconTexture(renderer)` 跨重建复用（避免每次重建重发全部图标请求），卸载时 `dispose()` |
| 场景模型 | `b = computed()`：依赖 `commandQueue.execVersion` 与 `modelVersion`，内部依次 `findPosForAreas(d.areas, PLANET_SEGMENT)` → `calcBuildingTrans` → `buildBuildings` → `buildBVH` → `buildReforms` → `registerUpdater`，返回 `{ buildings, bvh, reforms }`（不再包含 `pos`） |
| 挂载/回收 | `watchEffect` 把 `b.value.buildings` / `reforms` 加入场景，`onCleanUp` 里移除并 `buildings.dispose()` |
| 选择盒 | 1×1×1 `BoxGeometry` + 蓝色半透明 `MeshStandardMaterial`（`0x0074e8`，`opacity 0.5`，`depthWrite false`），`matrixAutoUpdate = false`；`watchEffect` 把 `bvh.boxes[selectedBuildingIndex]` 复制给它的 `matrix` |
| 相机控件 | `PlanetMapControls(camera, renderer.domElement)`，`listenToKeyEvents(rootEl)`；`minDistance = 3`、`maxDistance = 1200`、`minHeight = 1.5`、`minTilt = 0`、`maxTilt = 85°`、`tilt = 85°`、`distance = 150`；卸载 `dispose()` |
| 拾取 | `pickBuilding(e)`：由鼠标 NDC 反投影出 `Ray` → `bvh.raycast(ray)`；若射线先命中星球球面（`distanceSquared` 更小）则视为未命中，否则返回最近命中的建筑下标 |
| 单选 | `click`：按下点与松手点距离 > 6px 判为拖拽、不选中；否则 `emit("update:selectedBuildingIndex", pickBuilding(e))`（点空白处 emit `null`） |
| 右键剔除 | `mousedown` 记录右键位置 → `contextmenu`：`preventDefault`、超过 6px 判为拖拽、命中建筑则 `queue.push(new RemoveBuildingCommand(index, queue.data))` 并清空选中 |
| 渲染循环 | `requestAnimationFrame(animate)`：`controls.updateTimeDelta((time - last) / 1000)`、`cargos.cargoMove = (time % 1000) / 1000`、`controls.update()`（相机变化时 `cameraPosVersion++`）、`dirLight.position` 跟随相机、`planetScene.updateGridLOD(camera.position.length())`、`renderer.render(scene, camera)` |
| 外部模型到达 | `onBuildingModelsChanged` 用 150ms 定时器合并成一次 `modelVersion++`，避免每个 GLB 各触发一次重建 |
| 入场视角 | `applyHome()`（即 `resetCamera`）：以 `bvh.boxes` 的质心方向作球面锚点、构造切平面基、按图纸在切平面上的两个延展量选中垂直于长边的 `viewDir`、距离 `max(40, 1.2 * hypot(延展1, 延展2))`，再 `setHome(anchor, viewDir, HOME_TILT = 85°, distance)` + `reset()` |

#### 增量刷新注册

`registerUpdater(updater, buildings, posBP)` 定义在普通 `<script lang="ts">` 块中（因为它依赖 `Updater`/Vue，不能放进 `lib/core`）。它先 `updater.clearAll()`，再注册 4 条通道：

- `updateBuildingIcon`：`hasIcon` 守卫（跳过分流器/监测器等无图标建筑）后 `requestIcon` + `updateIconId`；
- `updateBeltIcon`：取 `parameters.iconId`，已有图标走 `updateIconId`，原先无图标且新图标非 0 时用 `calcBuildingTrans` + `beltIconPos` 动态 `addIcon`；
- `updateBeltIconSubscript`：重算 `count` 文本（`>= 100000` 时用 `k` 缩写），文本长度与初始构建不同则跳过（`subscriptMesh` 是连续字符池，长度变化会破坏后续下标），否则 `setText` + `needsUpdate`；
- `updateSorterIcon`：取 `b.filterId` → `itemIconId`，逻辑同传送带但用 `sorterIconPos` / `sorterIconScale`。
- `updateStationInfo` 刻意不注册（物流塔面板自身响应式刷新即可）。

#### 已不再承担的职责

- 建筑放置 / 删除模式、拖拽铺传送带、地基逐格编辑：对应模块已删除，只剩「右键剔除单个建筑」。
- 星球网格生成（`buildPlanetGrid` 现在 `src/lib/core/planetScene.ts`）、图标位置辅助（`buildingIconId` / `beltIconPos` / `beltIconScale` / `sorterIconPos` / `sorterIconScale` 现在 `src/lib/core/iconHelpers.ts`）、`inserterTrans`（现在 `src/lib/core/geometryHelpers.ts`）、以及旧的 `buildSceneData` / `rebuildScene` 包装（已不存在）。
- 旧文档所述的 `b: shallowRef<SceneModel>` 已改为 `computed`；组件也不再对外暴露 `getModel` 之外的场景模型。

#### `defineExpose` 的 5 项

| 成员 | 类型/含义 | 使用方 |
| ---- | ---- | ---- |
| `selectBoxes` | `ComputedRef<Matrix4[] \| undefined>`，即 `bvh.boxes` | 当前源码内无外部使用者 |
| `camera` | `PerspectiveCamera` 实例 | `SpitterInfo.vue` 取 `matrixWorldInverse` 做投影 |
| `cameraPosVersion` | `Ref<number>`，相机变动时 `++` | `SpitterInfo.vue` 建立响应式依赖 |
| `getModel(index)` | 返回建筑中心的世界 `Matrix4 \| null`（`modelRef` 为实例时读 `getMatrixAt`，否则读 `ref.matrix`） | `SpitterInfo.vue` |
| `resetCamera()` | 重新 `applyHome()` 回到入场姿态 | `App.vue`（蓝图切换/重置视角） |

### 6.8 `iconTexture.ts` `IconTexture`

图标图集：把离散的图标图片按槽位拷进一张固定网格纹理，供图标面片按 UV 取图。

```ts
export interface TextureSink {
    initTexture(texture: Texture): void;
    copyTextureToTexture(position: Vector2, srcTexture: Texture, dstTexture: Texture): void;
}

export class IconTexture {
    static readonly WIDTH = 24;
    static readonly HEIGHT = 24;
    texture: Texture;
    constructor(renderer: TextureSink);
    requestIcon(iconId: number): number; // 返回槽位下标，未知图标返回 0
    has(iconId: number): boolean;
    dispose(): void;
}
```

- 图集尺寸 **24 × 24 = 576 槽**，每槽 **80px**（`ICON_SIZE = 80`），故纹理为 1920 × 1920；初始内容是一张空白 canvas，`name = "icons"`、`RGBAFormat`、`UnsignedByteType`、`flipY = true`、`SRGBColorSpace`，构造时即 `renderer.initTexture` 上传。
- **0 号槽位保留为空图标**；其余槽位在构造时按 `allIconIds()` 的顺序从 1 开始顺序分配，若分配数达到 576 抛 `IconTexture too small`（即可用槽位上限 575）。
- `requestIcon(iconId)`：未分配槽位时 `console.warn` 并返回 0；已加载则直接返回槽位号；否则标记 `loaded[槽位] = true` 并异步 `iconUrl(iconId)` → `TextureLoader.loadAsync` → `renderer.copyTextureToTexture(new Vector2((index % 24) * 80, floor(index / 24) * 80), texture, this.texture)`，随后 `texture.dispose()`。加载失败会把 `loaded[槽位]` 复位以便重试；`dispose()` 之后到达的图片会被直接丢弃。
- 加载状态按**槽位下标**记录（不是 `iconId`），因此同一图标不会重复下载/上传。
- `has(iconId)` 只判断槽位是否已分配，不代表纹理数据已就绪。
- `dispose()` 释放图集纹理（构造时上传过，不释放会每次重建泄漏一张 1920×1920 纹理）并把 `disposed` 置真。
- `TextureSink` 接口的存在是为了单测注入 stub（jsdom 无 WebGL），也让 `src/lib/core/` 不依赖具体 `WebGLRenderer` 生命周期；编辑器与 `BlueprintViewer` 各自复用自己的 `IconTexture` 实例。

### 6.9 `bvh/bvh.ts` `BVH`

建筑选择盒的层次包围盒，用于鼠标拾取。

```ts
export class BVH {
    constructor(boxes: Matrix4[], options?: { maxDepth?: number; leafBoxes?: number });
    readonly boxes: Matrix4[];
    root: BVHNode; // 模块内类型 { children: BVHNode[]; idx: Int32Array; bounding: Box3 }
    raycast(ray: Ray): { index: number; distanceSquared: number }[];
}
```

- 输入是每个建筑的选择盒世界矩阵；构造时按单位立方体 `Box3(-0.5..0.5)` 变换出每个盒的包围盒，并缓存三个轴的盒中心。
- 递归划分：取节点包围盒的**最长轴**，以该轴中心坐标的均值作分割值，`partition`（快排式原地划分）后拆成 `subarray` 两半；默认 `leafBoxes = 1`、`maxDepth = 32`，叶子按 `idx.length <= leafBoxes` 或深度耗尽停止；划分退化为空侧时也停止。
- 空包围盒（所有盒同点，最长轴返回 `null`）抛 `Unexpected empty box`——调用方（`buildBVH`）因此对未知建筑使用 1e-6 的极小缩放而不是零缩放。
- `raycast(ray)`：先用 `ray.intersectBox` 剪枝，叶子内把射线变换到每个盒的局部空间，与单位立方体的 12 个三角形求交（命中即 `break`），把命中点变换回世界后记录 `{ index, distanceSquared }`；结果按距离平方**升序**返回，取 `[0]` 即最近建筑。
- `boxes` 为公开数组，供选择盒高亮与外部查询复用。

### 6.10 `blueprint/upgrade.ts` 建筑升降级

```ts
export const upgradeEdges: [number, number][];          // 12 条有向边
export const upgradeableItems: number[];                // 18 个 itemId，升序
export function reachableTargets(fromId: number): number[];
export class UpgradeCommand implements Command {
    constructor(bp: BlueprintData, fromItemId: number, toItemId: number);
    do(_data: BlueprintData, updater: Updater): void;
    undo(_data: BlueprintData, updater: Updater): void;
    merge(): boolean; // false
}
```

`upgradeEdges` 共 **12** 条边（低级 → 高级）：

| 类别 | 边 |
| ---- | ---- |
| 传送带 | 2001→2002、2002→2003 |
| 分拣器 | 2011→2012、2012→2013、2013→2014 |
| 制造台 | 2303→2304、2304→2305、2305→2318 |
| 熔炉 | 2302→2315、2315→2319 |
| 研究站 | 2901→2902 |
| 化工厂 | 2309→2317 |

源码注释明确修正了旧说明里的 `[2302, 2319] // 位面 → 负熵` 笔误：2302 是电弧熔炉、2315 才是位面熔炉，按「电弧 → 位面 → 负熵」拆为 `2302→2315` 与 `2315→2319`。

- `upAdj` / `downAdj`（模块内 `Record<number, number[]>`）：由 `upgradeEdges` 构建的升级/降级邻接表。
- `upgradeableItems`：把边两端 id 去重升序，共 **18** 个：2001, 2002, 2003, 2011, 2012, 2013, 2014, 2302, 2303, 2304, 2305, 2309, 2315, 2317, 2318, 2319, 2901, 2902。
- `reachN(adj, start, n)`（模块内）：迭代 BFS 求「恰好 `n` 步」的前沿（用 `Set` 去重，不含自身，前沿为空提前退出）。
- `reachableTargets(fromId)`：`fromId` 不在 `upgradeableItems` 时返回 `[]`；否则对 1..`upgradeableItems.length` 步分别取 `upAdj`（升级）与 `downAdj`（降级）的 `reachN` 前沿并取并集，升序返回（等价于图上全部可达节点，含跳级）。

`UpgradeCommand` 行为要点：

- 构造：校验 `toItemId` 在 `itemsMap` 中（否则 `Unknown target item <id>`）且 `models.length > 0`（否则 `Target item <id> has no model`），缓存 `toModelIndex = toItem.models[0]`；遍历 `bp.buildings` 收集所有 `itemId === fromItemId` 的建筑，并快照其 `oldItemId` / `oldModelIndex`。
- `do`：把所有命中建筑的 `itemId` / `modelIndex` 改写为目标值，并按类型派发图标刷新；`undo`：逐建筑恢复快照，同样按类型派发（do/undo 对称）。
- 图标刷新分流 `dispatchIconUpdate(b, updater)`：传送带 → `updateBeltIcon`、分拣器 → `updateSorterIcon`、其它 → `updateBuildingIcon`。原因：传送带/分拣器的图标槽位只在 `iconId > 0` / `filterId > 0` 时登记到 `IconGeometry.indexMap`，统一走 `updateBuildingIcon` 会因找不到槽位而抛 `'No icon to update'`。
- 没有声明 `silent`，因此属于非 silent 命令：升降级会换模型，必须触发 `execVersion++` 整场景重建。
- 适用约束：只覆盖各等级参数格式一致的建筑（传送带 / 分拣器 / 制造台 / 熔炉 / 研究站 / 化工厂），`parameters` 原样保留；调用方 `ReplaceModal.vue` 在勾选「建筑等级」时用 `(bp, sourceItemId, targetItemId)` 构造它。

### 6.11 `blueprint/setAccelerator.ts` 加速模式设置

```ts
export interface SetAcceleratorParams {
    mode: AcceleratorMode;
    buildingIndexes?: number[];
    labOnly?: boolean;
}

export class SetAcceleratorCommand implements Command {
    readonly silent = true;
    targetMode: AcceleratorMode;
    buildings: BlueprintBuilding[];
    originalModes: AcceleratorMode[];
    constructor(bp: BlueprintData, params: SetAcceleratorParams);
    do(_data: BlueprintData, updater: Updater): void;
    undo(_data: BlueprintData, updater: Updater): void;
    merge(): boolean; // false
}
```

- `mode`：目标模式（`AcceleratorMode.Accelerate = 1` 生产加速 / `AcceleratorMode.ExtraOutput = 0` 额外产出）。
- `buildingIndexes`：可选白名单，按 `b.index` 过滤；省略则全蓝图生效。
- `labOnly`：可选，仅作用于研究站（`itemId` 为 2901 / 2902）。
- 构造：先缓存 `targetMode`，再遍历 `bp.buildings` 依次过滤 `buildingIndexes` 与 `labOnly`，最后只保留 `parameters` 里含 `acceleratorMode` 字段的建筑（即 `AssembleParamerters` / `LabParamerters`），并逐条快照原始模式到 `originalModes`（与 `buildings` 一一对应）。
- `apply(modes, updater)`（私有）：把 `parameters.acceleratorMode` 写成对应数组值，并 `updateBuildingIcon.dispatch(b)` 派发增量刷新。
- `do`：用 `buildings.map(() => targetMode)` 统一设为目标模式；`undo`：用 `originalModes` 逐建筑精确恢复——混合模式场景撤销也不会错乱。
- `silent = true`：只改参数，不改变几何/拓扑，仅 `stateVersion++`；`merge` 恒 `false`。
- 作用范围是所有带 `acceleratorMode` 的参数：`assembleParamParser`（`allAssemblers` 全量：制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机）与 `labParamParser`（研究站）解析出的建筑。
- 典型用法（`ReplaceModal.vue`）：勾选「配方」范围并选了加速模式时，先 `push(new ReplaceCommand(...))`，再读取 `replaceCmd.recipeBuildings.map(b => b.index)` 作为 `buildingIndexes` 推送 `SetAcceleratorCommand`，只翻转刚被替换配方的建筑；未执行替换或未勾选配方时则不带 `buildingIndexes`，对全蓝图生效。

### 6.12 `blueprint/stats.ts` 生产统计

#### 类型

```ts
export interface StatsOptions {
    useAccelerator: boolean;              // 是否启用增产剂/加速模式计算
    acceleratorItem: AcceleratorItem;     // 增产剂等级
}

export interface ItemStats {
    itemId: number;
    produced: number;   // 每分钟产出
    consumed: number;   // 每分钟消耗
    net: number;        // 净产出（produced - consumed）
}

export interface ProductionStats {
    items: ItemStats[];
    totalPower: number; // 总功耗，单位 kW
}
```

`AcceleratorItem` 来自 `data/acceleratorData.ts`：`None = 0`、`MkI = 1`、`MkII = 2`、`MkIII = 3`。同文件的 `acceleratorBonuses: Record<AcceleratorItem, AcceleratorBonus>` 给出四档加成（`AcceleratorBonus` 字段：`extraOutput` / `accelerate` / `power` / `sprayCapacity`）：

| 等级 | `extraOutput` | `accelerate` | `power` | `sprayCapacity` |
| ---- | ---- | ---- | ---- | ---- |
| None | 0 | 0 | 0 | 0 |
| MkI | 0.125 | 0.25 | 0.3 | 12 |
| MkII | 0.2 | 0.5 | 0.7 | 24 |
| MkIII | 0.25 | 1.0 | 1.5 | 75 |

#### 建筑数据表（`data/buildingPowerData.ts`）

`BuildingPowerData = { itemId, name?, basePower, speedMultiplier, canAccelerate }`，数组 `buildingPowerData` 共 **27** 条，并由 `buildingPowerMap = new Map(buildingPowerData.map(d => [d.itemId, d]))` 提供 O(1) 查询。表内数值为当前游戏版本数值（`basePower` 单位 kW）：

| itemId | 名称 | `basePower` | `speedMultiplier` | `canAccelerate` |
| ---- | ---- | ---- | ---- | ---- |
| 2303 | 制造台 Mk.I | 270 | 0.75 | true |
| 2304 | 制造台 Mk.II | 540 | 1.0 | true |
| 2305 | 制造台 Mk.III | 1080 | 1.5 | true |
| 2318 | 制造台 Mk.IV | 2700 | 3.0 | true |
| 2302 | 电弧熔炉 | 360 | 1.0 | true |
| 2315 | 位面熔炉 | 1440 | 2.0 | true |
| 2319 | 熔炉 Mk.III | 2880 | 3.0 | true |
| 2309 | 化工厂 | 720 | 1.0 | true |
| 2317 | 化工厂 Mk.II | 2160 | 2.0 | true |
| 2901 | 矩阵研究站 | 480 | 1.0 | true |
| 2902 | 矩阵研究站 Mk.II | 1920 | 3.0 | true |
| 2308 | 原油精炼厂 | 960 | 1.0 | true |
| 2310 | 微型粒子对撞机 | 12000 | 1.0 | true |
| 2314 | 分馏塔 | 3960 | 1.0 | true |
| 2306 | 抽水站 | 0 | 1.0 | false |
| 2307 | 原油萃取站 | 0 | 1.0 | false |
| 2316 | 大型采矿机 | 0 | 1.0 | false |
| 2311 | 电磁轨道弹射器 | 1800 | 1.0 | false |
| 2312 | 垂直发射井 | 18000 | 1.0 | false |
| 2103 | 物流运输站 | 0 | 1.0 | false |
| 2104 | 星际物流运输站 | 0 | 1.0 | false |
| 2011 | 低速分拣器 | 18 | 1.0 | false |
| 2012 | 高速分拣器 | 36 | 1.0 | false |
| 2013 | 极速分拣器 | 72 | 1.0 | false |
| 2040 | 自动集装机 | 144 | 1.0 | false |
| 2030 | 流速器 | 36 | 1.0 | false |
| 2313 | 喷涂机 | 90 | 1.0 | false |

注意：分拣器（2011/2012/2013）**在表内**，所以会贡献功耗；传送带（2001–2003）、四向分流器（2020）等不在表内，既不贡献功耗也不产出物品。

#### 函数

`calculateProductionStats(bp: BlueprintData, options: StatsOptions): ProductionStats`

```ts
// 文件内常量
const FRACTIONATOR_ITEM_ID = 2314;      // 分馏塔（蓝图中无配方）
const HYDROGEN_ID = 1120;
const DEUTERIUM_ID = 1121;
const FRACTIONATOR_BASE_RATE = 72;      // 72 氢 -> 72 重氢 / 分
const PROLIFERATOR_ITEM_IDS = {         // 增产剂等级 -> 物品 ID
    [AcceleratorItem.None]: 0,
    [AcceleratorItem.MkI]: 1141,
    [AcceleratorItem.MkII]: 1142,
    [AcceleratorItem.MkIII]: 1143,
};
```

遍历 `bp.buildings`，对每个能在 `buildingPowerMap` 里查到的建筑：

1. 取加速模式 `mode`：分馏塔强制为 `AcceleratorMode.Accelerate`；其余用内部函数 `acceleratorOf(b)`——令 `p = b.parameters`，`p !== null && "acceleratorMode" in p` 时返回 `p.acceleratorMode`（只有 `AssembleParamerters` / `LabParamerters` 带此字段），否则 `null`。
2. `accelerated = options.useAccelerator && bpData.canAccelerate && mode !== null`。
3. 功耗（**只要在表内就累加，与是否有配方无关**）：`totalPower += basePower × (accelerated ? 1 + bonus.power : 1)`。
4. **分馏塔特例**：`rate = 72 × speedMultiplier`，加速时再 `× (1 + bonus.accelerate)`；记 `H2 consumed += rate`、`D2 produced += rate`，若加速则 `proliferatorBase += rate`，然后 `continue`（不读配方）。
5. 普通配方建筑：`building.recipeId <= 0` 直接跳过（功耗已计）；`recipesMap` 查不到时 `console.warn` 后跳过。
6. 研究站特例：`parameters` 里 `"researchMode" in p && p.researchMode === ResearchMode.Research` 时视为研究模式——**速率不乘增产剂加成**，且按配方的 `to`（矩阵）记 `consumed`，不记 `from` 原料、也不累加 `proliferatorBase`；只有「非研究模式 **且** `accelerated`」才按 `mode` 乘倍率：`Accelerate → ×(1 + bonus.accelerate)`、`ExtraOutput → ×(1 + bonus.extraOutput)`，`mode === null`（如未登记 `acceleratorMode` 的参数类型）则不乘。
7. 节拍：`timesPerMinute = (speedMult × 3600) / recipe.time`，`3600` 即源码注释里的「60 秒 × 60 帧/秒」，`recipe.time` 单位是帧；分别按 `count × timesPerMinute` 累加到原料消耗与产物产出。
8. 增产剂自身消耗：仅当 `proliferatorBase > 0 && bonus.sprayCapacity > 0 && proliferatorItemId > 0` 时，记 `consumed += proliferatorBase / bonus.sprayCapacity`（瓶/分）。
9. 结果按 `net` **降序**排序（净消耗大的在末尾）后返回。

#### 调用方

`src/components/ProductionStats.vue` 的 `stats` computed 里调用，`options` 由 UI 的增产剂下拉构造：

```ts
const options: StatsOptions = {
    useAccelerator: acceleratorItem.value !== AccItem.None,
    acceleratorItem: acceleratorItem.value,
};
return calculateProductionStats(queue.data, options);
```

computed 里显式读了 `queue.stateVersion.value`，因此任何命令（含 `silent` 命令）后统计都会重算。单元测试 `tests/unit/blueprint/stats.spec.ts`。

### 6.13 `blueprint/reform.ts` 地基渲染

#### 常量

| 常量 | 值 | 含义 |
| ---- | ---- | ---- |
| `REFORM_TYPE_NONE` | 0 | 无地基（未改造），不渲染 |
| `REFORM_TYPE_IBEAM` | 1 | 默认工字铺（错缝/跑砖金属板） |
| `REFORM_TYPE_GRID` | 2 | 直铺（2×2 对齐金属板） |
| `REFORM_TYPE_PLAIN` | 7 | 无装饰地基（纯色，无金属板） |
| `REFORM_LIFT` | 0.015 | 地基相对星球表面的抬升量（介于地表与经纬网格线之间） |
| `TILE_SCALE` | 0.985 | 单格板相对网格步距的缩放（略内缩，避免相邻格共边闪烁） |
| `TEXTURE_SIZE` | 128 | 程序化金属板纹理边长（canvas 像素） |
| `GROOVE_COLOR` | `rgb(96,96,96)` | 板缝底色 |
| `DEFAULT_REFORM_COLORS` | 15 个 hex | 游戏内置色板索引 0..14；索引 ≥15 且未置位自定义 mask 时回退 `0x808080` |

`DEFAULT_REFORM_COLORS` 依次为 `0x94948f / 0xd9d9d4 / 0x4f4f4f / 0xc05048 / 0xd17c3e / 0xd8b740 / 0x9eb34a / 0x5ea85c / 0x46a88e / 0x4a9fc2 / 0x4b78c2 / 0x7b60c2 / 0xaf60b5 / 0xd2729a / 0x8a5c3c`（灰、白、黑、红、橙、黄、黄绿、绿、青绿、青蓝、蓝、紫、品红、粉、棕）。

#### 类与函数

```ts
export class Reforms extends Group {}
```

`Reforms` 是空实现的 `Group` 子类，只作类型标记与图层容器；内容全部是 `InstancedMesh`。几何/材质/纹理是**进程级共享资源**（模块级 `plateGeometry` / `baseMaterial` / `ibeamTexture` / `gridTexture` / `ibeamMaterial` / `gridMaterial` 惰性创建，见 `getSharedResources()`），场景重建时只从场景移除、**不释放 GPU 资源**。

```ts
export function buildReforms(
    R: number,
    pos: PositionedBlueprint,
    reformData: BlueprintReformData | null | undefined
): Reforms | null
```

返回 `null` 的三种情况：`reformData` 为 `null`/`undefined`；`reformData.rects.length === 0`；展开后 `cells.length === 0`（所有矩形都是 `type === 0`）。

内部流程：

1. `expandReformCells(data)`：把矩形展开成逐格 `ReformCell = { areaIndex, gx, gy, type, colorIndex }`。键为 `rect.areaIndex * 0x100000000 + ((gx & 0xffff) << 16) + (gy & 0xffff)`（int16 格坐标 + 8 位 areaIndex 塞进一个 double 安全整数），**后出现的矩形覆盖先出现的**（与游戏重复改造一致）；`colorIndex = rect.color & 0x1f`；`type === 0` 的矩形直接跳过。
2. `resolveReformColors(data)`：解析 32 个颜色槽。`customReformColorMask` 第 i 位置位 → 取 `customReformColors[rank]`（按置位槽位升序紧凑存储，`rank++`），按 `v & 0xffffff` 转 `Color`（alpha 丢弃，恒不透明）；未置位 → `DEFAULT_REFORM_COLORS[i] ?? 0x808080`。
3. 统计 `numIBeam` / `numGrid`，建 1 个底色 `InstancedMesh`（容量 = 总格数）+ 最多 2 个纹理覆盖层 `InstancedMesh`（容量分别为 0 时置 `null`）。三者 `frustumCulled = false`（包围球跨整个星球，避免近处浏览被错误剔除）。
4. 逐格写矩阵与实例色：两类覆盖层各自维护独立自增下标，最后统一 `instanceMatrix.needsUpdate = true` / `instanceColor!.needsUpdate = true`。

#### 三种铺法与变换

| `type` | 渲染结果 |
| ---- | ---- |
| 0 `NONE` | 不产生格（`expandReformCells` 就跳过） |
| 1 `IBEAM` | 底色层 + 工字铺纹理覆盖层（`drawIBeamPattern`） |
| 2 `GRID` | 底色层 + 直铺纹理覆盖层（`drawGridPattern`） |
| 7 `PLAIN` | **只进底色层**（纯色，无金属板覆盖） |

单格变换与 `calcBuildingTrans` 同一套经纬约定：

```
longitudeGridSize = 2π / area.segment / 5
latitudeGridSize  = 2π / pos.segment  / 5
longitude = (area.longitude + gx) * longitudeGridSize
latitude  = (area.latitude  + gy) * latitudeGridSize
Euler(-latitude, longitude, 0, "YXZ")
平移 (0, 0, R + REFORM_LIFT) → 前置旋转
缩放 (R * longitudeGridSize * cos(latitude) * TILE_SCALE,
      R * latitudeGridSize * TILE_SCALE, 1)
```

`pos.segment` 是全局分段（200），`area.segment` 是区域分段，因此高纬区域经向格更宽，用 `cos(latitude)` 收缩；纹理覆盖层复用了完全相同的 `tileMatrix`，所以两层严格重合。

#### 纹理与材质

- `drawMetalPlate(ctx, x, y, w, h)`：底色渐变接近白色（`232 → 220 → 206`，因为纹理与实例色是**相乘**关系，浅灰才能让自定义颜色准确显色）+ 左上高光 / 右下阴影倒角 + 四角铆钉。
- `drawGridPattern(ctx)`：`GROOVE_COLOR` 打底，2×2 共 4 块 64×64 金属板对齐铺设。
- `drawIBeamPattern(ctx)`：`GROOVE_COLOR` 打底，4 行、砖高 32、砖宽 64，奇数行左移半砖（跑砖），纹理可向四周无缝拼接。
- `createPlateTexture(pattern)`：`document.createElement("canvas")` → `CanvasTexture`，`colorSpace = SRGBColorSpace`。
- 材质：底色 `MeshLambertMaterial`；两块纹理层 `MeshStandardMaterial({ map, metalness: 0.5, roughness: 0.45 })`（无环境贴图的场景下降低 metalness，保证既有光泽又不过暗）。

#### 接入

只有编辑器渲染链路调用它（`src/components/BlueprintEditor.vue`：`const reforms = buildReforms(PLANET_RADIUS, pos, d.reformData)`，再 `scene.add(reforms)`，清理时只 `scene.remove(reforms)`）。`BlueprintViewer` / `RenderCore` **不含地基图层**（文件头注释即写明「不含地基、放置/删除/预览等编辑态」），所以只读库渲染不出地基。地基的逐格编辑与自定义色槽命令已从代码库删除，本模块现在只负责「按数据渲染」。

### 6.14 `lib/BlueprintViewer.ts` 门面与生命周期

只读蓝图渲染器：与编辑器共用 `src/lib/core/` 的渲染内核，**不依赖 Vue**，也不含地基与编辑态。契约是**公开方法不抛异常**，失败一律返回 `{ ok: false, error }` 并经 `onError` 上报；失败时场景、相机与 `getBlueprintData()` 保持上一次成功状态。

#### 构造参数 `ViewerOptions`

```ts
export interface ViewerOptions {
    container: HTMLElement | string;                    // 必填
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;                           // initialSettings 的语法糖
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    previewAnimation?: PreviewAnimationMode;            // 'auto' | 'on' | 'off'
    autoResize?: boolean;
    pixelRatio?: number;
    keyboardTarget?: HTMLElement | null;
    keepCamera?: boolean;
    width?: number;
    height?: number;
    theme?: ThemeName;
    settingsPort?: SettingsPort;
}
```

| 字段 | 默认 / 行为 |
| ---- | ---- |
| `container` | 字符串按 `document.querySelector` 解析；解析失败 → `no-container`（phase `lifecycle`），之后所有调用都返回该错误 |
| `initialSettings` | 缺省字段取 `DEFAULT_SETTINGS`：`showRealModels: true`、`texturesEnabled: true`、`maxInstancesPerModel: Infinity`、`previewAnimation: "auto"` |
| 4 个平铺字段 | 用条件展开合进 `initialSettings`，**同时给出时平铺字段优先** |
| `previewAnimation` | 与 `initialSettings.previewAnimation` 等价，平铺优先 |
| `autoResize` | `!== false` 且存在 `ResizeObserver` 时观察容器 |
| `pixelRatio` | 缺省 `min(devicePixelRatio, 2)`（`DEFAULT_PIXEL_RATIO_MAX = 2`） |
| `keyboardTarget` | 缺省容器；显式 `null` 表示不监听键盘 |
| `keepCamera` | **默认 `true`**（`options.keepCamera !== false`）：加载后保留当前相机；传 `false` 则每次加载后 `resetCamera()` |
| `width` / `height` | 任一给出即按 `el.getBoundingClientRect()` 补齐另一维并调 `core.setSize(w, h)`；此后容器 resize 不再覆盖，直到 `resetSize()` |
| `theme` | 缺省 `"editor"`（`options.theme ?? "editor"`） |
| `settingsPort` | 缺省用内部 `LocalSettingsPort`（进程内存中的一份投影，`read()` 返回当前值、`write(patch)` 浅合并） |

构造顺序：解析容器 → `new RenderCore({...})`（透传 `initialSettings` 快照、`keyboardTarget`、`autoResize`、`pixelRatio`，并把 4 个回调转发给自己的 `callbacks`，`onRebuild` 里把 `reason` 收窄成 `RebuildReason`）→ 可选 `setSize` → `setTheme(options.theme ?? "editor")`。`RenderCore` 构造抛错（如 WebGL 不可用）时记为 `initError = { code: "no-webgl", phase: "lifecycle" }`。

> ⚠️ 待确认：`setTheme` 的 JSDoc 写「构造时可通过 `theme` 选项指定初始主题，默认 `'dark'`」，与构造函数实际的 `options.theme ?? "editor"` 不一致；`RenderCore` 的初值也是 `THEME_PALETTE.editor`。本文按实现写 `'editor'`，注释是否需要修正待项目方定夺。

#### `SettingsPort`

```ts
export interface SettingsPort {
    read(): ViewerRenderSettings;
    write(patch: Partial<ViewerRenderSettings>): void;   // 必须同步写回宿主
}
```

`ViewerRenderSettings`（来自 `@/renderSettingsTypes`，纯类型、不 import vue）= `{ showRealModels, texturesEnabled, maxInstancesPerModel, previewAnimation? }`。宿主想与编辑器共用同一份设置就传入自己的 port（编辑器场景下 `write` 会连带触发持久化）。

#### 公开方法

**数据加载 / 导出**

| 方法 | 行为 |
| ---- | ---- |
| `loadBlueprint(str: string): BlueprintLoadOutcome` | 内部 `str.trim()` 后走 `fromStr`；解析失败 → phase `parse` |
| `loadBlueprintData(data: BlueprintData): BlueprintLoadOutcome` | 直接注入已解析数据，**总是重建**（不做引用比较） |
| `loadBlueprintJSON(text: string): BlueprintLoadOutcome` | 先 `parseBlueprintJSON`（还原 `Date` / `Uint8Array`）再走同一条应用链路；语法错 → `json-syntax`，结构问题 → `json-shape` |
| `exportBlueprintJSON(): string \| null` | 未加载时为 `null`；否则 2 空格缩进的 JSON 文本，可被 `loadBlueprintJSON` 无损还原 |
| `getBlueprintData(): BlueprintData \| null` | 最近一次**成功**加载的数据（失败不影响它） |

**增量预览**

| 方法 | 行为 |
| ---- | ---- |
| `beginPreview(options?: PreviewBeginOptions): void` | 先 `discardPreview()` 再新建预览层，挂到场景；**不清空当前正式场景** |
| `applyPreviewDelta(event: PreviewDeltaEvent): boolean` | 同步摄入，返回是否应用；已销毁返回 `false`；**绝不抛错** |
| `commitPreview(blueprint: string): BlueprintLoadOutcome` | 先解析、再 `applyData`（先建后换：构建正式场景时预览层仍在显示），随后**无条件** `discardPreview()`；蓝图串解析失败时先丢弃预览再返回错误（不留半截画面） |
| `discardPreview(): void` | 丢弃预览层（失败/中止/离开页面时调用） |
| `get previewing(): boolean` | 预览层存在且未销毁 |
| `previewStats(): PreviewStats \| null` | 未预览时为 `null`，字段见 §6.18 |

**选中 / 定位 / 查询**

| 方法 | 行为 |
| ---- | ---- |
| `selectBuilding(index: number \| null): BuildingLocateResult` | 只点亮高亮盒、**不动相机**；`null` 清除并返回 `index: -1`；失败 `not-loaded` / `building-not-found` |
| `selectedBuildings(indexes: number[] \| null): BuildingsLocateResult` | 批量选中；`null` / 空数组清除并返回 `indexes: []`；**先整体校验再提交**，任一找不到则整次失败、原选中不变；结果去重且保持传入顺序 |
| `focusBuilding(index: number \| null, options: FocusOptions = {}): BuildingLocateResult` | 镜头居中对齐（相机 = 建筑中心 + 法线 × `distance`，看向球心），**不锁镜头**；`index === null` 等价 `resetCamera()`；未知 modelIndex → `not-renderable` |
| `getSelectedIndex(): number \| null` | 多选时返回第一项 |
| `getSelectedIndexes(): number[]` | 全部选中下标副本 |
| `getBuildingInfo(index: number): ViewerQueryResult<BuildingInfoPayload>` | 返回 `{ index, id, matrix }`；未知 modelIndex 的隐藏占位 → `not-renderable` |

`FocusOptions = { distance?: number; select?: boolean }`，`select` 默认 `true`（聚焦同时选中），`distance` 缺省 `PLANET_RADIUS * 0.5 ≈ 100.1`。

`index` 解析统一走 `resolveIndex`：先按数组下标取（`0 <= index < buildings.length` 直接返回），否则按 `BlueprintBuilding.index` 字段兜底 `findIndex`。

**主题 / 尺寸 / 导出 / 其他**

| 方法 | 行为 |
| ---- | ---- |
| `setTheme(theme: ThemeName): void` | 立即改场景背景、星球色、网格色；角标文字颜色要等下次重建才刷新 |
| `setCustomTheme(patch: Partial<ThemeColors>): void` | 在当前主题上覆盖若干颜色 |
| `getTheme(): ThemeColors \| null` | 已销毁 / 未初始化时 `null` |
| `setRenderSettings(partial: Partial<ViewerRenderSettings>): void` | 先 `port.write(partial)`，再 `core.setRenderSettings(port.read())`；内部抛错按 phase `build` 上报 |
| `setSize(w: number, h: number): void` | 显式尺寸，容器 resize 不再覆盖 |
| `resetSize(): void` | 取消显式尺寸，恢复跟随容器 |
| `toDataURL(): string \| null` | base64 PNG；内部先渲染一帧，可在 rAF 之外调用 |
| `toBlob(): Promise<Blob \| null>` | 同上；未初始化时 resolve `null` |
| `getCamera(): PerspectiveCamera \| null` | 只读用途 |
| `getCameraVersion(): number` | 仅在相机真的变化的帧自增 |
| `getCanvas(): HTMLCanvasElement \| null` | `core.rendererRef.domElement` |
| `resetCamera(): void` | 回默认视角 |
| `setCallbacks(cbs: ViewerCallbacks, opts?: { merge?: boolean }): void` | **默认整体替换**；`{ merge: true }` 为合并 |
| `dispose(): void` | 幂等；销毁 core、清空数据/回调/告警集合，之后所有操作返回 `already-disposed` |

`setRenderSettings` 的生效路径（由 `RenderCore` 判定）：`showRealModels` / `maxInstancesPerModel` 变化 → 重建（`reason: "settings"`）；`texturesEnabled` 变化 → 只重挂材质不重建；`previewAnimation` 变化 → 只调预览层插值开关。

#### 错误码 `ViewerErrorCode`

```ts
export type ViewerErrorPhase = "parse" | "position" | "build" | "lifecycle";
```

| code | phase | 触发点 |
| ---- | ---- | ---- |
| `invalid-start` | parse | 报错文案含 `Invalid start` |
| `header-too-short` | parse | 含 `Header too short` |
| `checksum-missing` | parse | 含 `Checksum not found` |
| `checksum-mismatch` | parse | 含 `Checksum mismatch` |
| `buffer-overflow` | parse | 含 `overflow` 或 `out of range` |
| `parse-failed` | parse | parse 阶段其余所有错误 |
| `json-syntax` | parse | `JSONImportError` code `json-syntax`（`JSON.parse` 失败） |
| `json-shape` | parse | `JSONImportError` code `json-shape`（缺 header/areas/buildings 等） |
| `no-root-area` | position | 含 `No root area` |
| `no-longitude` | position | 含 `No suitable longitude` |
| `inconsistent-area` | position | 含 `same segments as its parent` 或 `anchorLocalOffsetY` |
| `build-failed` | build | 构建阶段未归类错误；position 阶段未命中规则时也落到此 code（phase 仍为 `position`） |
| `no-container` | lifecycle | 容器解析失败 |
| `no-webgl` | lifecycle | `RenderCore` 构造抛错 |
| `already-disposed` | lifecycle | 销毁后再调用 |
| `not-loaded` | lifecycle | 尚未成功加载 |
| `building-not-found` | lifecycle | 下标/ID 都找不到 |
| `not-renderable` | lifecycle | 建筑存在但未知 `modelIndex`（占位盒在球心，无可用矩阵） |

共 **18** 个 code。分类逻辑在 `classifyError(e, phase)`：`RenderPhaseError` 递归取 `original` 与自带的 `phase`；`JSONImportError` 直接用其 `code`；其余按上表子串规则匹配，position 阶段命中不了则退化为 `build-failed`。`failLocate` / `failQuery` 产出的错误 phase 固定写 `lifecycle`。

`reportError` 按 `code:message` 去重后调用 `onError`（`try/catch` 包住宿主回调），并额外 `console.warn("[viewer] phase/code: message")`。

#### 当前能力边界

- `onBuildingRemove` 在 Viewer 中**不会被触发**：Viewer 构造 `RenderCore` 时没有传 `interactions`，默认 `select: true / contextRemove: false`，右键剔除的 DOM 监听根本没挂。
- 地基、放置/删除、预览以外的编辑能力都不在本门面内（编辑态只有编辑器自己用 `RenderCore` + `BlueprintEditor.vue` 实现）。
- 单元测试：`tests/unit/lib/blueprintViewer.spec.ts`。

### 6.15 `lib/core/RenderCore.ts` 渲染核心

共享渲染内核：场景 / 相机 / renderer / controls / rAF 循环 / 原子重建 / dispose，**不依赖 Vue**，编辑器与 `BlueprintViewer` 共用。

#### 构造参数 `RenderCoreOptions`

| 字段 | 说明 |
| ---- | ---- |
| `container: HTMLElement` | canvas 挂载点 |
| `settings: ViewerRenderSettings` | 构造期快照；后续变更走 `setRenderSettings` |
| `interactions?: { select?: boolean; contextRemove?: boolean }` | 默认 `select = true`、`contextRemove = false` |
| `keyboardTarget?: HTMLElement \| null` | 缺省容器；显式 `null` 不监听键盘 |
| `autoResize?: boolean` | `!== false` 且存在 `ResizeObserver` 时观察容器 |
| `pixelRatio?: number` | 缺省 `min(devicePixelRatio, 2)` |
| `createRenderer?: (canvas) => WebGLRendererLike` | 测试注入（jsdom 无 WebGL） |
| `createIconTexture?: (renderer) => IconTexture` | 测试注入；注入时 dispose 不释放图集 |
| `textureSettings?: () => TextureSettings` | 完整 7 通道贴图设置；缺省时由本对象按 `texturesEnabled` + 七通道全开合成，并注册全局 `setSettingsProvider` |
| `callbacks?` | `onBuildingSelect` / `onBuildingRemove` / `onCameraChange` / `onRebuild` |

#### 场景装配

1. `new Scene()`。
2. 星球：`createPlanetScene(PLANET_RADIUS = 200.2, PLANET_SEGMENT = 200)` → `scene.add(planet.root)`；材质句柄 `planet.sphereMaterial` / `planet.gridMaterial` 供主题改色。
3. 天光/星空：`createSkyGradient({ planetRadius: PLANET_RADIUS })` → `scene.add(sky.mesh)`，只属于 `editor` 主题。
4. `applyTheme()`（默认 editor 色板，`skyEnabled = true`）。
5. 选中高亮组 `selectGroup`（初值 `visible = false`）+ 共享 `BoxGeometry(1,1,1)` 与 `MeshStandardMaterial({ color: 0x0074e8, opacity: 0.5, transparent: true, depthWrite: false })`，用 `Mesh` 池承载多选。
6. renderer：`new WebGLRenderer({ antialias: true, canvas })`（可注入），`setPixelRatio(pixelRatio)`，然后 `setKtx2Renderer(renderer)`——GLB 贴图统一 KTX2，转码器要按本机 GPU 能力配置。
7. canvas 追加进容器，`syncSize()`。

#### 相机与控件

- `PerspectiveCamera(50)`，`near = 0.5`、`far = 3000`、初始 `position.z = 2 * PLANET_RADIUS`。
- `new PlanetMapControls(camera, renderer.domElement)`；`minDistance = 0.04R`、`maxDistance = 3R`、`targetRadius = R`（控件量的是「相机到锚点」，库侧 API 是「相机到球心 1.04R ~ 4R」，故取差值）；`listenToKeyEvents(keyboardTarget)`；`update()`。
- `resetCamera()` → `controls.reset(2 * PLANET_RADIUS)`。
- `focusBuilding(index, distance?)` → `controls.focusSpherePoint(center, d)`，`d = max(distance ?? 0.5R, 1)`（`FOCUS_DISTANCE_RATIO = 0.5`）；中心取自 `bvh.boxes[index]` 的平移，若 `|center|² < R² × 1e-3`（未知模型占位盒在球心）返回 `false`。

#### 拾取

`pick(e: MouseEvent): number | null`：

1. `bundle === null` → `null`。
2. 射线原点取相机世界矩阵的平移；方向由 canvas 的 `getBoundingClientRect()` 把 `(clientX, clientY)` 归一化到 NDC（`z = 0.5`），`unproject(camera)` 减原点后归一化。
3. `bundle.bvh.raycast(ray)` → 按 `distanceSquared` 升序的命中数组。
4. **星球遮挡判定**：`ray.intersectSphere`（半径 `PLANET_RADIUS`）命中点比最近建筑命中更近 → 返回 `null`。
5. 返回 `intersects[0].index`。

DOM 监听：`click`（仅 `interactions.select`）→ 先 `setSelectedIndex(index)` 更新高亮，再 `callbacks.onBuildingSelect(pickPayload(index))`；`contextRemove` 时额外挂 `mousedown` 记录右键按下位置、`contextmenu` 里 `preventDefault()` 并在拖动距离 > 6 px 时放弃，否则 `onBuildingRemove(index)`。

#### 主题

- `theme: ThemeColors` 初值 `{ ...THEME_PALETTE.editor }`，`skyEnabled = true`。
- `setTheme(theme)`：`resolveTheme(theme)`，`skyEnabled = theme === "editor"`，`applyTheme()`。`'auto'` 由 `resolveTheme` 按 `prefers-color-scheme: light` 在 light/dark 间选择（无 `window` 回落 dark）。
- `setCustomTheme(patch)`：在当前主题上浅合并。
- `getTheme()`：返回副本。
- `applyTheme()` 只改三处 + 天空可见性：`sky.mesh.visible`、`scene.background`、`planet.sphereMaterial.color`、`planet.gridMaterial.color`。**角标文字配色（`textFill` / `textStroke`）烘进 canvas 纹理，只在重建时生效**。

色板 `THEME_PALETTE`（`core/theme.ts`）：

| 主题 | `sceneBackground` | `planet` | `grid` | `textFill` | `textStroke` |
| ---- | ---- | ---- | ---- | ---- | ---- |
| editor | `0x000000` | `0xb0b0b0` | `0xf0f0f0` | `#ffffff` | `#44444488` |
| dark | `0x0d1117` | `0x1c2128` | `0x6e7681` | `#ffffff` | `#44444488` |
| light | `0xd8dee4` | `0xc8d0d8` | `0xffffff` | `#1a1a1a` | `#ffffffaa` |

#### 重建时机

| `RebuildReason` | 入口 |
| ---- | ---- |
| `"load"` | `setBlueprintData(data)`（失败回滚 `this.data` 并抛出，场景不动） |
| `"data"` | `notifyDataChanged()`（原地改完数据后调，编辑器依赖它） |
| `"settings"` | `setRenderSettings` 里只有 `showRealModels` / `maxInstancesPerModel` 变了才重建 |
| `"models"` | `onBuildingModelsChanged` 回调 → 150 ms 合并定时器 → `rebuildScene("models")`（定时器内异常只 `console.warn`，保留旧场景） |

`rebuildScene(reason)` 是原子的：

1. `data === null` → `replaceBundle(null)`，回调 `buildingCount: 0`。
2. **定位阶段**：`findPosForAreas(d.areas, PLANET_SEGMENT)`，抛错包成 `RenderPhaseError("position", e)`。
3. **构建阶段**：`d.buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b))` 得每建筑的世界矩阵数组 → `buildBuildings(transforms, d.buildings, { settings, textureSink: renderer, iconTexture, textureSettings, textStyle: { fill: theme.textFill, stroke: theme.textStroke }, reapplyMaterials: false })` → `buildBVH(transforms, d.buildings)`；非 `RenderPhaseError` 的异常包成 `RenderPhaseError("build", e)`。
4. `replaceBundle({ buildings, bvh, transforms, unknownModelIndexes })`：先加新、再移除并 `dispose` 旧 `AllBuildings`；随后按当前下标重套选中盒（越界项自动清除）。
5. 回调 `onRebuild({ reason, buildingCount, unknownModelIndexes, durationMs })`。

`reapplyMaterials: false` 是有意的：材质是共享对象，模型加载时已经套过贴图，只有 `texturesEnabled` 变更才需要重挂，否则每次重建都要对全部已加载模型重复执行贴图流程。

#### 字号与图标

- 图标图集 `IconTexture` 由 RenderCore 创建并**跨重建复用**（`buildBuildings` 通过 `options.iconTexture` 收同一个实例），避免每次重建重新分配 1920×1920 纹理并重发图标请求；`ownsIconTexture` 决定 dispose 时是否释放。
- 角标（传送带数字）由 `IconSubscript` 渲染：字符烘在一张 canvas 纹理里（`bold 100px monospace`，字集固定为 `"0123456789k"`，描边宽 3px，单字宽度 `cWidth = 0.22` 世界单位），**字号不可配置**；可配置的只有配色——`textStyle = { fill: theme.textFill, stroke: theme.textStroke }`（省略时回落到 `#4448` 描边 / `white` 填充）。因此换主题后角标颜色要等下次重建才变。
- `renderOrder`：图标网格 `Icons` 为 10，下标网格 `IconSubscript` 为 11。
- 图标贴图请求走 `iconTexture.requestIcon(iconId)`；图标 id 由 `core/iconHelpers.ts` 的 `buildingIconId` / `beltIconPos` / `sorterIconPos` 等给出。

#### 对外成员

**方法（29 个）**

| 分类 | 方法 |
| ---- | ---- |
| 数据 / 重建 | `setBlueprintData(data \| null)`、`notifyDataChanged()`、`resize()` |
| 增量预览 | `beginPreview(options?)`、`applyPreviewDelta(event): boolean`、`discardPreview()`、`getPreviewStats(): PreviewStats \| null` |
| 设置 / 主题 | `setRenderSettings(patch)`、`setTheme(theme)`、`setCustomTheme(patch)`、`getTheme()` |
| 尺寸 | `setSize(w, h)`、`clearExplicitSize()` |
| 输出 | `toDataURL()`、`toBlob()` |
| 相机 | `resetCamera()`、`focusBuilding(index, distance?): boolean` |
| 选中 | `setSelectedIndex(index \| null)`、`setSelectedIndexes(indexes)`、`selectByBuildingId(id): number \| null`、`clearSelection()` |
| 查询 | `getBuildingInfo(index)`、`getBuildingModel(index)`、`getSelectBoxMatrix(index)`、`lastBuildStats()`、`isUnknownModel(index)` |
| 其他 | `setCallbacks(cbs)`、`getSettings()`、`dispose()` |

**只读属性（12 个）**：`previewing`、`hasExplicitSize`、`selectedIndex`、`selectedIndexes`、`buildingCount`、`camera`、`controlsRef`、`sceneRef`、`rendererRef`、`sceneModel: SceneBundle | null`、`cameraVersion`、`isDisposed`。

`SceneBundle = { buildings: AllBuildings; bvh: BVH; transforms: Matrix4[][]; unknownModelIndexes: number[] }`。

选中高亮：`setSelectedIndexes` 会先过滤越界/重复下标（以 `bvh.boxes[index] !== undefined` 为准），再按需扩容 `Mesh` 池（未用到的隐藏而非移除），每个盒的矩阵直接拷 `bvh.boxes[i]`；只影响视觉，**不触发 `onBuildingSelect`**。

#### 帧循环

每帧：`controls.updateTimeDelta(dt)` → 若 `bundle !== null` 置 `buildings.cargos.cargoMove = (time % 1000) / 1000` → `controls.update()` → `planet.dirLight.position.copy(camera.position)` → `planet.updateGridLOD(camera.position.length())`（网格 LOD 双阈值迟滞在 `planetScene` 内）→ `preview?.tick(time)` → `renderer.render(scene, camera)` → 若 `controls.update()` 返回 true 则 `cameraVersion++` 并回调 `onCameraChange()`（同一帧最多一次）。

#### dispose

顺序要点：`cancelAnimationFrame` → 清 `modelTimer` → 撤销 `onBuildingModelsChanged` 订阅 → 若自建则 `setSettingsProvider(null)` → 解绑 click / mousedown / contextmenu → `resizeObserver.disconnect()` → `controls.dispose()` → `bundle.buildings.dispose()` → `discardPreview()` → `disposeKtx2Loader()`（**必须在 `renderer.dispose()` 之前**，否则转码器还持有已失效的 GPU 能力引用）→ 自建才 `iconTexture.dispose()` → 清选中池、释放自建几何/材质 → `sky.dispose()` / `planet.dispose()` → `scene.clear()` → `renderer.dispose()` → 从容器移除 canvas。`assertAlive()` 在已销毁时会抛 `Error("RenderCore already disposed")`，但直接 `return` 的幂等方法（`setTheme` / `setCustomTheme` / `setSize` / `clearExplicitSize` / `resetCamera` / `setSelectedIndex(es)` / `focusBuilding` / `applyPreviewDelta` / `discardPreview` / `dispose`）不会抛。

### 6.16 `lib/core/buildBuildings.ts` + `AllBuildings.ts` 建筑构建与实例化

#### 函数签名

```ts
export interface BuildBuildingsOptions {
    settings: ViewerRenderSettings;         // showRealModels / maxInstancesPerModel 决定 GLB 与白模划分
    textureSink: TextureSink;               // 图标图集 sink（真实 renderer 或测试 stub）
    iconTexture?: IconTexture;              // 复用图集；省略时新建（释放责任交给调用方）
    reapplyMaterials?: boolean;             // 是否给图集重挂通道贴图，默认 true
    textureSettings?: TextureSettings;      // 完整 7 通道设置
    textStyle?: TextStyle;                  // 角标文字配色（来自主题）
}

export interface BuildBuildingsResult {
    buildings: AllBuildings;
    stats: BuildStats;
    iconTexture: IconTexture;               // 本次实际使用的图集
}

export function buildBuildings(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[],
    options: BuildBuildingsOptions
): BuildBuildingsResult
```

#### 构建流程

1. `reapplyMaterials !== false` 时 `reapplyLoadedModelMaterials(options.textureSettings)`（材质共享，原地生效）。
2. 分类：`belts = buildings.filter(b => isBelt(b.itemId))`（2001–2003）、`inserters = buildings.filter(b => isInserter(b.itemId))`（2011–2014）、`boxes = 其余`（元数据盒或 GLB）。
3. `buildBoxes(boxes)`：解析模型来源 → 分组 → GLB 实例化 → 元数据盒回退（详见下节）。
4. `buildBelts(belts)`：圆盘 `InstancedMesh`（`CylinderGeometry(0.32, 0.32, 0.1, 8)`，预乘 `translate(0,0,0.05) × rotateX(π/2)`）+ 连线 `InstancedMesh`（`BoxGeometry(0.15, 0.06, 1.0)`，`0.6 × thickness`；用 `lookAt(p1, p2, p1)` + `scale(1,1,len)` + `translate(0, linkThickness/2, -0.5)`）；只有 `outputObjIdx >= 0` 的格产生连线，产生连线时同时 `addCargo(trans, color, len)`。
5. `buildInserters(inserters)`：`BoxGeometry(0.15, 0.06, 1.0)`，姿态与长度由 `inserterTrans(transforms[b.index], trans)` 给出（沿用 `INSERTER_HEIGHT = 0.3` 沿法线抬升），同样写 `addCargo`。
6. 货物：`new Cargos(belts.length + inserters.length)`，`setCargoDistanceAt` 记录每段长度；`count = numCargos` 并标脏 `cargoDistance`。
7. 图标：`buildIcons(iconBuildings, iconBelts, iconInserters, iconTexture)`（见下）。
8. 组装 `AllBuildings`，统计 `BuildStats` 返回。

#### 程序化几何 vs GLB

| 类别 | 几何来源 |
| ---- | ---- |
| 传送带（2001–2003） | 程序化：圆盘 + 连线 + 货物，材质 `MeshLambertMaterial` |
| 分拣器（2011–2014） | 程序化：一条拉伸的盒子 + 货物 |
| 其余建筑 | 外部 GLB（`resolveBuildingModel` 命中且已加载）；未加载/超上限/未知时退回元数据盒 `BoxGeometry(1,1,1) × meta.unitBoxTrans` |

GLB 分组的判定：

- 先 `resolveBuildingModel(b.modelIndex)`（异常时记 `null`，双保险）。
- `meta === undefined` → 未知建筑：记进 `unknownModelIndexes`、进 `fallback`，**不触发下载**。
- `settings.showRealModels` 为真时才做实例计数，**计数口径是「存在 `glbName` 的建筑数」**（不看 GLB 是否已加载），因此同一蓝图同一设置的渲染结果与加载时序无关；`count <= maxInstancesPerModel` 才允许走 GLB。
- 满足「出示模型 + 未超上限 + `glb !== null` + 有 meta」→ 归入 `glbGroups.set(modelIndex, { model, placement, tint, buildings })`。
- 否则进 `fallback`；若「有 `glbName`、`glb === null`、有 meta」则 `requestBuildingModel(b.modelIndex)` 触发懒加载（加载器内部并发去重 + 缓存 + 超时）。

GLB 实例化：每组一个 `GlbModelInstances(model, placement, transforms[b.index][0] 列表, tint)`；构造抛错或 `meshes.length === 0` 时**整组退回元数据盒**（不影响其余建筑）。成功时 `modelRef[b.index] = { matrix: anchor.clone() }`，其中 `anchor = transform × translate(meta.selectUnitBoxTrans 的平移)`——即 GLB 建筑的 `modelRef` 仍是「建筑中心的世界矩阵」，保持旧 `getModel` 的投影语义。

回退盒：一个 `InstancedMesh(BoxGeometry(1,1,1), MeshLambertMaterial, fallback.length)`；有 meta 的写 `transforms[b.index][0] × meta.unitBoxTrans` 并用 `meta.color`；未知建筑写 `makeScale(0,0,0)` 的退化矩阵 + `UNKNOWN_BUILDING_COLOR = 0xdddddd`（不可见、不抛错、不白屏），且**不写 `modelRef`**（所以 `getBuildingInfo` 对它返回失败）。

#### 图标与下标

- `iconBuildings = boxes.filter(b => !noIconBuildings.has(b.itemId))` 且 `buildingIconPos(...)` 返回 true 才真正加图标。
- `iconBelts = belts.filter(b => b.parameters && b.parameters.iconId > 0)`；`iconInserters = inserters.filter(b => b.filterId > 0)`（图标 id 取 `itemIconId(b.filterId)`）。
- 传送带数量角标：`parameters === null` 或 `count === 0` 跳过；`count >= 100000` 显示 `floor(count/1000) + "k"`，否则 `count.toFixed(0)`；总字符数决定 `IconSubscript` 容量，`subscriptMap: Map<BlueprintBuilding, { startIdx, length }>` 供后续局部刷新。
- `IconGeometry(count)` 的 `count` 是候选数（含 `buildingIconPos` 返回 false 而未写入的项），`BuildStats.iconCount` 记的就是它。

#### `BuildStats`（`core/types.ts`）

| 字段 | 含义 |
| ---- | ---- |
| `buildingCount` | 蓝图建筑总数 |
| `glbGroupCount` | 走外部 GLB 的模型组数（`perModelGlbCounts` 键数） |
| `glbInstanceCount` | 走外部 GLB 的实例总数（各组求和） |
| `fallbackBoxCount` | 回退元数据盒的建筑数（**含隐藏占位**） |
| `hiddenCount` | 未知 `modelIndex` 数量（`unknownModelIndexes.size`，按 modelIndex 去重，不是建筑数） |
| `unknownModelIndexes` | 未知 modelIndex 去重升序数组 |
| `iconCount` | 图标候选数 |
| `subscriptCount` | 角标字符总数 |
| `cargoCount` | 货物动画实例数 |
| `perModelGlbCounts` | `Record<modelIndex, 走 GLB 的实例数>` |

#### `AllBuildings`

```ts
export class AllBuildings extends Object3D {
    constructor(
        objects: Object3D[],
        public readonly iconsMesh: Icons,
        public readonly iconTexture: IconTexture,
        public readonly cargos: Cargos,
        public readonly modelRef: BuildingModelRef[],
        public readonly subscriptMesh: IconSubscript | null = null,
        public readonly subscriptMap: Map<BlueprintBuilding, { startIdx: number; length: number }> = new Map()
    );
    get icons(): IconGeometry;
    dispose(): void;
}
```

构造时 `add(...objects)`、`add(iconsMesh)`，`cargos` 与 `subscriptMesh` 非空才 add。`dispose()` 遍历自身：`InstancedMesh` 一律 `dispose()`，但**只有 `userData.sharedResource` 为假的几何才 `geometry.dispose()`**（GLB 几何来自跨场景复用的缓存）；`Mesh` 同理。图标图集是 RenderCore 级单例，**不在这里释放**。

`BuildingModelRef = ModelRefInstanced { mesh, instance } | ModelRefMatrix { matrix }`：程序化/回退建筑用实例引用，GLB 建筑用中心世界矩阵。

### 6.17 `lib/core/buildBVH.ts` + `bvh/bvh.ts` 空间索引与拾取

#### 分工

| 模块 | 职责 |
| ---- | ---- |
| `lib/core/buildBVH.ts` | **适配层**：把「建筑世界变换 + `buildingMeta`」翻译成每个建筑的**选择盒矩阵**，并构建 BVH；顺带汇总未知 modelIndex |
| `bvh/bvh.ts` | **通用层**：只认一组 `Matrix4`（每个矩阵定义一个单位立方体的世界放置），负责构建 AABB 层次结构与射线查询；完全不知道蓝图/建筑的存在 |

```ts
export interface BuildBVHResult {
    bvh: BVH;
    unknownModelIndexes: number[];   // 缺 buildingMeta、只能放退化矩阵（不可拾取）的 modelIndex，去重升序
}

export function buildBVH(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[]
): BuildBVHResult
```

选择盒的三种构造（`selectBoxes = buildings.map((b, i) => ...)`）：

1. 分拣器（`isInserter(b.itemId)`）：`inserterTrans(transforms[i], box)` 得姿态与长度 `len`，再 `× scale(0.5, 0.5, len)`、`× translate(0, 0, -0.5)`——与 `buildBuildings` 的渲染几何共用同一函数（`core/geometryHelpers.ts`：`INSERTER_HEIGHT = 0.3` 沿法线抬升，`lookAt` 对齐两端），否则点选位置会偏移。
2. 有 `buildingMeta`：`transforms[i][0] × meta.selectUnitBoxTrans`。
3. 无 `buildingMeta`：记入 `unknown` 集合并返回 `hidden = makeScale(1e-6, 1e-6, 1e-6)`。

> 坑（源码注释已写明）：占位矩阵**不能用零缩放**。零缩放的包围盒退化成点，`longestAxis` 返回 `null` 后 `BVH` 构造会抛 `Unexpected empty box`（实测蓝图里出现 2 个以上未知建筑即触发）。用 `1e-6` 既能让 BVH 正常构建，视觉上又不可见、拾取几乎不可能命中。

#### `BVH`

```ts
export class BVH {
    root;
    constructor(public boxes: Matrix4[], { maxDepth = 32, leafBoxes = 1 }: BVHOptions = {});
    raycast(ray: Ray): { index: number; distanceSquared: number }[];
}
```

构建：先把每个 `boxes[i]` 的 AABB 算成 `unitBox(-0.5..0.5).applyMatrix4(box)`，并缓存中心点三轴数组；根节点索引为 `Int32Array(0..n-1)`；递归 `split`——`node.idx.length <= leafBoxes || depth === 0` 停止；取包围盒最长轴，用该轴上**中心点均值**作分割值，`partition`（原地双指针）分左右，任一侧为空则停止；子节点用 `subarray` 共享同一份索引数组，并各自缓存自己的 `bounding`。

查询 `raycast(ray)`：从根开始 `ray.intersectBox(node.bounding)` 做粗筛；内部节点递归子节点；叶节点里对每个索引把射线变换到该盒的局部空间（`invert()`），与**单位立方体的 12 个三角形**（`unitBoxTriangles`，由 `BoxGeometry(1,1,1)` 的索引缓冲预计算）逐个求交，命中第一处即 `break`；命中点乘回世界矩阵后按 `distanceSquared = origin.distanceToSquared(v)` 记录。最后整表按 `distanceSquared` 升序返回，**每个盒最多一条**。

#### 射线拾取流程（`RenderCore`）

1. 用 canvas 的 `getBoundingClientRect()` 把鼠标位置换算成 NDC（`z = 0.5`），`unproject(camera)` 得方向。
2. `bvh.raycast(ray)` 得按距离排序的候选。
3. 空 → `null`；否则做**星球遮挡**：`ray.intersectSphere(Sphere(0, PLANET_RADIUS))` 的命中点若比第一个建筑命中更近，判定为点到球面而不是点到建筑 → `null`。
4. 取 `intersects[0].index`（`BlueprintData.buildings` 的数组下标），再包成 `{ index, id }`。

BVH 的另外两个用途：选中高亮盒直接拷 `bvh.boxes[i]`（`setSelectedIndexes` / `getSelectBoxMatrix`）；`focusBuilding` 从 `bvh.boxes[i]` 的平移取建筑中心。单元测试 `tests/unit/lib/buildBVH.spec.ts`。

### 6.18 `lib/preview/PreviewLayer.ts` 增量预览层

预览层是**独立临时层**（`Group.name = "dsp:preview"`），与正式场景（`RenderCore.bundle`）互不影响；`beginPreview` 不会清空当前正式场景，`commit` 时整层丢弃、正式场景走全量重建。

#### 构造

```ts
constructor(options: PreviewBeginOptions & { projectorOptions?: PreviewProjectorOptions } = {})
```

| 选项 | 默认 | 说明 |
| ---- | ---- | ---- |
| `projector` | `"sphere"` | `sphere` 球面投影 / `plane` 锚点切平面 |
| `settleMs` | 100（下限 16） | 指数收敛时间常数 τ |
| `enterDelayMs` | 120（下限 0） | 新对象延迟多久才淡入；`0` 表示立即可见 |
| `minLifeMs` | 120（下限 0） | 抖动抑制：存活短于该值、**且从未露面**（`curOpacity <= 0`）就被撤销的对象直接回收，不出场 |

`RenderCore.beginPreview` 会先 `discardPreview()`，再 `layer.setAnimate(resolvePreviewAnimation(settings.previewAnimation) === "on")`，最后 `scene.add(layer.object3d)`。

#### 四种语义

| 方法 | 语义 |
| ---- | ---- |
| `beginPreview(options?)` | 丢弃旧层、新建并挂场景；正式场景不动 |
| `applyPreviewDelta(event)` → `apply(event, now?)` | **同步摄入、绝不抛错**（内部 `try/catch`，异常只 `console.warn` 并返回 `false`）；返回是否应用了内容 |
| `commitPreview(blueprint)` | 门面侧「先建后换」：先构建正式场景（预览层仍在显示），随后无条件 `discardPreview()`；蓝图串解析失败时先丢预览再报错 |
| `discardPreview()` | `PreviewLayer.discard()`：释放全部池的 GPU 资源、清空 `entries` / `objects`、`group.clear()` 并从父节点移除；之后 `isDisposed = true` |

`PreviewLayer` 自身公开：`object3d`、`isDisposed`、`setAnimate(v)`、`stats: PreviewStats`、`projectorSnapshot()`、`apply(event, now?)`、`tick(now?)`、`resyncModels()`、`discard()`。

#### 摄入规则

`ingest(event, now)` 的判据：

1. `event.kind` 存在且不等于 `"preview-delta"` → 忽略（阶段/完成事件由宿主管文案）。
2. `operations` 缺失或为空 → 忽略。
3. **序号去重**：`typeof event.sequence === "number"` 时，`sequence <= lastSequence` → `droppedEvents++` 并整条丢弃，否则更新 `lastSequence`。跳号是常态（源码注释：最多连跳 18），只做 `>` 比较、不要求连续。
4. `coordinateSystem` / `areas` 变化交给投影器；`projector.currentVersion !== lastVersion` → `reprojectAll()`（**硬重投影、不插值**，因为那是语义跳变不是运动）。
5. 逐条 `applyOperation`：`objectId` 必须是字符串；`remove` 走删除；`add`/`replace` 要求 `building.localOffset` 存在。
6. 只要有任一操作被应用，`events++`、`operations += ops.length`（**计整条事件的操作数，不是成功数**），并更新 `peakAlive`。

#### 坐标系 `layout-grid-v1` / `blueprint-area-local-v1`

| 值 | 投影模式 | 含义 |
| ---- | ---- | ---- |
| `"blueprint-area-local-v1"` | `area` | Area 局部坐标，直接用 `areas` 的 `findPosForAreas` 结果，与正式场景 `calcBuildingTrans` 一致 |
| 其他任意字符串 / 缺失 | `layout` | 生成中的临时布局格坐标，**不当作行星世界坐标**；按流式 bbox 自动居中 + 等比缩放（跨度压到 `maxSpanDeg = 63°` 内）再投球面/切平面 |

切换时 `projector.setCoordinateSystem` 会 `version++`，触发整片硬重投影；`setAreas` 解析失败时保留上一次定位结果（只 `console.warn`，不中断预览）。

#### 未知 add / replace / remove

| 情况 | 处理 | 计数 |
| ---- | ---- | ---- |
| `remove` 一个不存在的 id | 静默忽略 | `unknownRemoves++` |
| `remove` 一个槽已 `SLOT_FREE` 的 id | 从对象表删掉该记录 | 不计数 |
| `replace` 一个不存在的对象 | **按 add 处理**（否则对象永久丢失） | `unknownReplaces++` |
| `add`/`replace` 一个已存在的对象 | 只更新目标值；若该槽正在淡出则**复活**（`SLOT_ALIVE`、`tgtOpacity = 1`、`logicalAlive++`）且**不重新淡入** | 不计数 |

#### 抖动抑制（`enterDelayMs` / `minLifeMs` / `settleMs`）

- `add` 时新槽 `curOpacity = 0`，`tgtOpacity = enterDelayMs > 0 ? 0 : 1`（先不可见）。
- `tick` 里当 `state === SLOT_ALIVE && tgtOpacity === 0 && now - bornAt >= enterDelayMs` 才把 `tgtOpacity` 置 1 开始淡入。
- `remove` 时若 `curOpacity <= 0 && lived < minLifeMs` → 立即 `release`（**从未露面，不产生「闪一下」**），`filteredByThrash++`；否则置 `SLOT_DYING`、`tgtOpacity = 0` 走淡出。
- 淡出收敛判据：`state === SLOT_DYING && curOpacity <= 0.02` → `release` + `forget(id, slot, pool)`（先取 `pool.ids[slot]` 再 release，否则取不到 id 会泄漏对象表记录）。
- `settleMs` 只决定每帧系数：`alpha = animate ? 1 - exp(-dt / settleMs) : 1`，`dt` 首帧取 16.7ms、之后 `clamp(now - lastFrameTs, 0, 100)`。

#### 池化容量上限

| 项 | 值 |
| ---- | ---- |
| 初始容量 `INITIAL_CAPACITY` | `belt: 4096`、`inserter: 512`、`glb: 512`、`box: 512` |
| 单池上限 `MAX_CAPACITY` | `1 << 18 = 262144`（防御性；注释记录实测单模型峰值 29,679） |
| 扩容方式 | 池满 → `growEntry`：容量翻倍（不超过上限）并**逐槽搬迁**到新 `SlotPool`，旧池 `dispose()` 后换入；`highWater` / `alive` 沿用，自由链表按旧状态重建 |
| 到顶仍分配不到 | 本次 add **直接放弃**（返回 `false`），宁可不显示也不在事件回调里分配 GPU 缓冲 |

`SlotPool` 每个「kind + modelIndex」一份（键 `"${kind}:${modelIndex}"`），`PreviewLayer.entries` 保存；`objects: Map<objectId, { entry, slot, outputId }>` 是对象索引。

#### `PreviewStats` 字段

| 字段 | 含义 |
| ---- | ---- |
| `events` | 已摄入并应用的事件数（`ingestEvents`） |
| `operations` | 这些事件里的操作总数（`ingestOps`，按 `ops.length` 累加） |
| `droppedEvents` | 因序号过期被整条丢弃的事件数 |
| `unknownRemoves` | 删除不存在对象的次数（已忽略） |
| `unknownReplaces` | 替换不存在对象、被按 add 处理的次数 |
| `alive` | 逻辑存活数（`logicalAlive`，不含正在淡出的槽） |
| `fading` | `sum(pool.alive) - logicalAlive`，即正在淡出、仍占槽的数量 |
| `peakAlive` | 逻辑存活峰值 |
| `moving` | 当前仍在运动的槽数（各池 `moving.size` 求和） |
| `slots` | 各池 `highWater` 求和（已用到的最大槽号范围） |
| `filteredByThrash` | 被抖动抑制吞掉、从未露面的可见槽数 |
| `coordinateSystem` | 当前坐标语义（`PreviewCoordinateSystem \| null`） |
| `lastIngestMs` | 最近一次摄入耗时（ms），用于对照 ≤50ms 预算 |
| `maxIngestMs` | 摄入耗时峰值（ms） |
| `disposed` | 是否已销毁 |

共 **15** 个字段。验收口径：`lastIngestMs` / `maxIngestMs` 应满足 ≤50ms 预算，稳态 `moving` 应回落到 0，中途订阅时 `unknownRemoves` 非零属正常现象。

#### 呈现（`tick`）

每帧一次：对每个池的 `moving` 集合逐槽 `advance` → `writeSlot` → `markDirty`；收敛后从 `moving` 移除，淡出结束的槽 `release` + 从对象表删除；然后 `flushDirty()`（只上传脏段）、`syncCount()`（`mesh.count = highWater`，`visible = count > 0 && alive > 0`）、货物 `cargoMove = animate ? (now % 1000) / 1000 : 0`。

`writeSlot` 按类型分派：`belt` 写圆盘矩阵 + `writeBeltLink`（从本槽指向输出对象的**当前视觉位置**，长度 `< 1e-3` 或 `> 8` 时写隐藏矩阵，同时写货物长度）；`inserter` 写 `writeInserter`（两端口矩阵 + 沿法线抬升 `INSERTER_HEIGHT`）；其余类型逐部件 `worldMatrix × pre[i]`。

`resyncModels()` 处理 GLB 异步到达：遍历 `entry.kind === "glb"` 但 `pool.kind !== "glb"` 的池，若 `glbAvailable(modelIndex)` 则按同容量重建 spec 并搬迁全部槽状态（含 `SLOT_DYING` 与 `moving`），再由 `swapPool` 换入。

### 6.19 `lib/preview/projector.ts` + `pools.ts` + `mode.ts` + `materials.ts`

#### `projector.ts` 投影

```ts
export interface PreviewProjectorOptions {
    kind?: "sphere" | "plane";
    radius?: number;      // 默认 PLANET_RADIUS = 200.2
    segment?: number;     // 默认 PLANET_SEGMENT = 200
    maxSpanDeg?: number;  // 默认 63
}

export class PreviewProjector {
    kind: "sphere" | "plane";
    constructor(options?: PreviewProjectorOptions);
    setCoordinateSystem(system): boolean;   // true = 语义变化，调用方需硬重投影
    setAreas(areas): boolean;               // 解析失败保留上一次结果并返回 false
    observeGrid(x, y): boolean;             // layout 期喂 bbox，返回是否需要重投影
    writeMatrix(out, x, y, z, yawDeg, areaIndex): void;
    snapshot(): PreviewProjectorSnapshot;   // { kind, mode, scale, centerX, centerY, version }
    get currentVersion(): number;
    get currentMode(): "layout" | "area";
}
```

两种投影：

| `kind` | layout 期的 `writeMatrix` |
| ---- | ---- |
| `sphere` | `writeSpherical(gy * baseCellRad, gx * baseCellRad, height, yawRad)`：`Euler(-lat, lon, yaw, "YXZ")` → `translate(0,0,height)` → 前置旋转 |
| `plane` | `makeRotationZ(yawRad)` + `setPosition(gx * cellWorld, gy * cellWorld, height)`（`cellWorld = baseCellRad * radius`），贴在锚点处，不绕球、永不穿极点 |

公共量：`baseCellRad = 2π / segment / 5`（一格角宽，与 `calcBuildingTrans` 一致）；`yawRad = -yawDeg × π/180`；`height = radius + z × HEIGHT_GRID_SIZE`（`HEIGHT_GRID_SIZE = 4/3`）。

`area` 期的 `writeMatrix` 忽略居中/缩放，直接用 `positioned.areas[areaIndex]`（不存在时退回 `areas[0]`）的 `longitude/latitude` 与 `area.segment`：`lon = (area.longitude + x) × 2π/area.segment/5`、`lat = (area.latitude + y) × 2π/segment/5`，再走同一个 `writeSpherical`。没有任何 area 定位结果时**退化为 layout 期同款球形投影**（不中断预览）。

`refit()` 的自适应阈值（防「每长一格就蠕动」）：`scale = min(1, maxSpanRad / (span × baseCellRad))`；仅当 `|scale - oldScale| > oldScale × 0.08` 或中心移动超过 `max(2, span × 0.06)` 才 `version++`。

`toBlueprintAreas(areas)` 是形态适配器：同时吃扁平（`anchorLocalOffsetX/Y` + `width/height`）与嵌套（`anchorLocalOffset{x,y}` + `size{x,y}`），缺省 `parentIndex = -1`、`tropicAnchor = 0`。

#### `pools.ts` 池化与 SoA

| 常量 / 类型 | 值 |
| ---- | ---- |
| `SLOT_FREE` / `SLOT_ALIVE` / `SLOT_DYING` | 0 / 1 / 2 |
| `PoolKind` | `"glb" \| "box" \| "belt" \| "inserter"` |
| `GlbPart` | `{ geometry（已克隆）, material, localMatrix }` |
| `PoolSpec` | `{ kind, modelIndex, capacity, parts?, placement?, tint?, color?, boxTrans? }` |

`SlotPool` 的 SoA 状态（全部定型数组，槽号即下标）：`curX/curY/curZ/curYaw`、`tgtX/tgtY/tgtZ/tgtYaw`、`curX2/curY2/curZ2`、`tgtX2/tgtY2/tgtZ2`（分拣器第二端）、`areaIndex: Int32Array`、`curOpacity/tgtOpacity`、`bornAt`、`state: Uint8Array`、`ids: (string|null)[]`；另有 `free: number[]` 自由链表、`moving: Set<number>`、`highWater`、`alive`、`opacity: InstancedBufferAttribute`（即 `aOpacity`）、`hidden = makeScale(0,0,0)`，以及 `belt`/`inserter` 才有的 `cargoMesh: Cargos`。

网格构造 `makeFadeMesh`：几何挂 `aOpacity`，`InstancedMesh(geometry, material, capacity)`，`instanceMatrix` 用 `DynamicDrawUsage`，`count = 0`、`frustumCulled = false`、`visible = false`；`paint` 给全部实例预填颜色（无 tint 用白色）并把 `instanceColor` 设为动态。

部件形态：

- `glb`：每个 `GlbPart` 一个 `InstancedMesh`（材质 `cloneFadeMaterial`），`pre = placement × localMatrix`。
- `belt`：圆盘 `CylinderGeometry(0.32, 0.32, 0.1, 8)`（`pre = translate(0,0,0.05) × rotateX(π/2)`）+ 连线 `BoxGeometry(0.15, 0.06, 1.0)`（`pre = 单位矩阵`）。
- `inserter`：`BoxGeometry(0.15, 0.06, 1.0)`（`pre = 单位矩阵`）。
- `box`：`BoxGeometry(1,1,1)`，`pre = boxTrans ?? hidden`（未知模型退化为不可见，保持不抛错）。

`buildPoolSpec(kind, modelIndex, capacity, tintHint)`：`kind === "glb"` 时若 `resolved.glb !== null && resolved.meta !== undefined` 且 `collectGlbParts` 有部件 → 返回真 GLB spec（`placement`、`tint: resolved.tint ?? tintHint`）；否则若有 `glbName` 先 `requestBuildingModel`，并返回 `box` spec（`color: meta?.color`、`boxTrans: meta?.unitBoxTrans ?? null`）。`collectGlbParts(root)` 遍历 `updateMatrixWorld(true)` 后的树，跳过非 Mesh 与 `SkinnedMesh`，**克隆几何**（预览层要挂 `aOpacity`，不能污染正式场景共享的几何）。

`glbAvailable(modelIndex)` = `resolveBuildingModel(...).glbName !== null && meta !== undefined`。

上传策略：`markDirty` 只记脏段 `[dirtyMin, dirtyMax]`；`flushDirty()` 对每个网格 `instanceMatrix.addUpdateRange(start*16, count*16)`、`opacity.addUpdateRange(start, count)`，货物另加 `cargoDistance` 的 `addUpdateRange`，然后统一 `needsUpdate = true`。

`alloc()` 从自由链表尾部弹出（初始逆序填充，因此从 0 开始连续分配）、更新 `highWater` 与 `state/alive`；`release(slot)` 复位 `state/ids/curOpacity/tgtOpacity`、清零 `aOpacity` 与货物长度、把槽推回自由链表并 `markDirty`。

#### `mode.ts` 动画模式判定

```ts
const MIN_CORES = 4;
export function resolvePreviewAnimation(mode: PreviewAnimationMode | undefined): "on" | "off"
```

- `'on'` / `'off'` 直接返回。
- `'auto'`（含 `undefined`）：先看无障碍偏好 `matchMedia("(prefers-reduced-motion: reduce)")`，命中 → `'off'`（`matchMedia` 抛错的嵌入式 WebView 视为无偏好）；否则 `navigator.hardwareConcurrency >= 4` → `'on'`，取不到核数时按 `MIN_CORES` 处理（即 `'on'`）。
- **刻意不做帧率自测**：自测与「首帧可见 ≤50ms」的预算冲突且结果不稳定。

运行期开关走 `ViewerRenderSettings.previewAnimation`：`RenderCore.setRenderSettings` 检测到变化就 `preview.setAnimate(...)`，不重建场景。

#### `materials.ts` 材质与不透明度收尾

```ts
export function cloneFadeMaterial(source: Material | Material[]): Material | Material[]
```

- **必须克隆**：GLB 材质来自缓存、被正式场景的 `InstancedMesh` 共享，直接改共享材质会污染正式场景，且 `reapplyLoadedModelMaterials()` 重贴图时还会冲掉注入。数组按元素逐个克隆，保持原有分组语义。
- **用抖动（dither）而不是混合**：3 万级实例若走 `transparent = true`，排序与过绘制会压垮填充率。注入方式：
  - 顶点：前置 `attribute float aOpacity; varying float vAOpacity;`，并在 `#include <begin_vertex>` 之后写 `vAOpacity = aOpacity;`；
  - 片元：前置 `varying float vAOpacity;`，并在 `#include <dithering_fragment>` 之后注入 `DITHER`——`vAOpacity < 1.0` 时用 `fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)` 算稳定阈值，`vAOpacity <= 阈值` 直接 `discard`。
  - `customProgramCacheKey = () => PROGRAM_KEY`，`PROGRAM_KEY = "dsp-preview-fade-v1"`（改注入逻辑必须改它，否则旧 program 会被复用）。
- 收尾链路：`PreviewLayer.writeSlot` 每帧写 `(pool.opacity.array)[slot] = pool.curOpacity[slot]`；`flushDirty` 把 `aOpacity` 的脏段上传；`discard()` 时 `SlotPool.dispose()` 逐个 `mesh.geometry.dispose()` + 材质（含数组）`dispose()` + `cargoMesh.dispose()`，由 `RenderCore.dispose` / `commitPreview` / `discardPreview` 触发。不透明度的「收尾」指的是淡出结束判据 `curOpacity <= 0.02` 后立刻 `release` 回收槽位，避免半透明槽长期占用显存。

### 6.20 `lib/blueprintJSON.ts` 蓝图 JSON 导入导出

`BlueprintData` 里有两个字段不能经 `JSON.stringify` / `JSON.parse` 原样往返，这是本模块存在的唯一理由：

1. `header.time` 是 `Date` → 序列化成 ISO 字符串，直接 parse 回来是 `string`，而 `toStr()` 会调 `header.time.getTime()`，导出时抛 TypeError。
2. `buildings[].extraBytes` 是 `Uint8Array` → 序列化成 `{"0":1,"1":2,…}` 对象，直接 parse 回来是普通对象，`toStr()` 取 `.length` 得 `undefined`，字节数算错。

#### API

| 导出 | 签名 | 说明 |
| ---- | ---- | ---- |
| `parseBlueprintJSON` | `(text: string) => BlueprintData` | `JSON.parse` + 还原；失败抛 `JSONImportError` |
| `reviveBlueprintData` | `(raw: unknown) => BlueprintData` | 对已 parse 的对象做类型还原 + 最小形状校验 |
| `stringifyBlueprintJSON` | `(data: BlueprintData) => string` | 就是 `JSON.stringify(data, null, 2)`，把约定固化成具名函数 |
| `formatBlueprintJSON` | `(text: string) => BlueprintJSONOutcome` | 校验/格式化用户粘贴的文本；空串返回 `json-shape` + `"输入为空"` |
| `JSONImportError` | `class extends Error { code: "json-syntax" \| "json-shape" }` | 带上区分的内部错误 |

```ts
export type BlueprintJSONOutcome =
    | { ok: true; value: BlueprintData }
    | { ok: false; error: { code: "json-syntax" | "json-shape"; message: string } };
```

#### 还原约定

- `reviveTime(value)`：`Date` 原样返回；`string` / `number` 交给 `new Date(value)`，`NaN` 抛「`header.time` 不是合法时间」；其他类型抛「`header.time` 缺失或类型错误（需要 ISO 字符串或时间戳）」。
- `reviveBytes(value)`：`undefined` / `null` → `undefined`；`Uint8Array` 原样返回；对象按 `{"0":n,…}` 还原——键必须是非负整数下标（否则抛「`extraBytes` 的键不是数组下标」），值 `& 0xff`；**空对象 → 长度 0 的 `Uint8Array`**；其他类型抛「`extraBytes` 应为 Uint8Array 或 {"0":…} 形式的对象」。
- 建筑上 `extraBytes` 还原结果为 `undefined` 时**删掉该字段**（`delete rec.extraBytes`），避免留下 `undefined` 影响 `toStr`。
- 最小形状校验：根必须是对象；必须有 `header` 对象、`areas` 数组、`buildings` 数组；`buildings` 每个元素必须是对象。字段级深校验**不做**——真正的自洽性检查交给 `findPosForAreas`（定位阶段）与 `buildBuildings`（构建阶段），它们给出的错误已能被 `BlueprintViewer` 分类上报。

#### 错误码

| code | 触发 |
| ---- | ---- |
| `json-syntax` | `JSON.parse` 抛错（纯语法问题，空串也走这里；`formatBlueprintJSON` 对空串另给 `json-shape`） |
| `json-shape` | 还原阶段的任何形状错误（缺 `header` / `areas` / `buildings`、建筑非对象、时间非法、`extraBytes` 形状非法） |

`BlueprintViewer.classifyError` 对 `JSONImportError` 直接采信其 `code`，phase 记为 `parse`，因此宿主看到的 `ViewerError.code` 就是这两个值之一。

### 6.21 `lib/assets/` 资产根与解析

#### `assetBaseUrl.ts`

| 导出 | 签名 / 行为 |
| ---- | ---- |
| `configureAssetBaseUrl` | `(baseUrl: string \| null \| undefined) => void`；`null` / `undefined` / 空串（`trim()` 后）清除配置，回到自动探测 |
| `currentAssetBaseUrl` | `() => string`；返回末尾带 `/` 的产物根目录，空串表示「相对当前页面」 |
| `resolveAssetUrl` | `(relativePath: string) => string`；去掉前导 `/` 后与根拼接；根为空时直接返回相对路径 |

四种取值来源，优先级从高到低：

1. `configureAssetBaseUrl(url)` 显式指定；
2. `__DSP_LIB_MODULE_URL__`（构建期 `DefinePlugin` 注入的 `import.meta.url`，ESM 产物才有；**模块自身 URL** 而非页面 URL，因此把 `models/`、`img/` 放在 chunk 同目录即可自动命中）；
3. 加载本库的 `<script src>` 所在目录（UMD 场景；`document.currentScript` 必须在模块求值期抓取，之后取永远是 `null`）；
4. `document.baseURI`。

都探测不到 → 返回空串，交给浏览器按相对页面解析。辅助函数 `toDirectoryUrl(raw)` 负责把绝对 URL / 根相对路径 / 相对路径统一成目录形式，`toRootUrl(dirUrl)` 保证末尾恰好一个 `/`。编辑器构建里函数本身仍会写入配置值，但**没有任何代码读它**（资产 URL 由 webpack `publicPath` 生成的 `assetResolver.webpack.ts` 负责），所以调用它不改变编辑器里的资产地址；两种形态签名一致，宿主无需区分。

#### `types.ts` 契约

```ts
export interface AssetInventory {
    models: readonly string[];       // models/<name>.glb
    itemRecipe: readonly string[];   // icons/item_recipe/<icon>.png
    tech: readonly string[];         // icons/tech/<id>.png
    signal: readonly string[];       // icons/signal/signal-<id>.png
}

export interface AssetResolver {
    glbModelNames(): readonly string[];
    glbModelUrl(name: string): Promise<string | null>;   // 不存在返回 null（调用方静默回退元数据表）
    modelTextureUrl(srcRelativePath: string): string | null;
    itemRecipeIconUrl(name: string): Promise<string>;     // 不存在 reject
    techIconUrl(techId: number): Promise<string>;
    signalIconUrl(signalId: number): Promise<string>;
}
```

全部路径都相对 `src/assets/`；产物里模型落在 `models/…`、图标落在 `img/…`。构建期用 `resolve.alias` 的 `@lib/asset-resolver$` 二选一：

| 环境 | 别名指向 | 配置位置 |
| ---- | ---- | ---- |
| 编辑器构建（webpack） | `src/lib/assets/assetResolver.webpack.ts` | `vue.config.js` 的 `resolve.alias` |
| 库构建（UMD/ESM） | `src/lib/assets/assetResolver.ts` | `scripts/lib-build/build.js` |
| 单测（jest） | `src/lib/assets/assetResolver.ts` | `jest.config.js` 的 `moduleNameMapper` |

调用方只有两处：`src/models/glbAssets.ts` 与 `src/data/icons.ts`，都是 `import { assetResolver } from "@lib/asset-resolver"`。

#### webpack 实现（`assetResolver.webpack.ts`）

- `createGlbContext()`：`require.context("../../assets/icons/models", false, /\.glb$/i)`。**必须先拿到调用结果再判断类型**——写成 `typeof require.context !== 'function'` 会被 webpack 编译成「某空模块的 `.context`」（恒 `undefined`），判断永远成立，GLB 功能会静默失效、全部建筑回退元数据表（源码注释记录了这一实测坑）。打包器不支持时 `console.warn` 并降级为纯元数据模式。
- 参数必须是字面量：换成变量会被当成动态依赖。
- `glbModelNames()` 来自 `context.keys()` 去目录与扩展名；`glbModelUrl(name)` 先查 `glbKeys`（`./` 前缀已剥掉），再 `pickUrl(await context("./" + key))`——`asset/resource` 生成的是**字符串 URL**，但取值时同时兼容 `{ default }` 形态。
- `modelTextureUrl()` **恒返回 `null`**：通道贴图（法线 / 自发光 / spec）已全部内嵌进 GLB 并转 KTX2，编辑器构建不再打包 `models/**.png`；方法保留只为满足接口。
- 图标走 `eager` 模板字符串 `import()`：`itemRecipeIconUrl` → `@/assets/icons/item_recipe/${name}.png`、`techIconUrl` → `@/assets/icons/tech/${techId}.png`、`signalIconUrl` → `@/assets/icons/signal/signal-${signalId}.png`。

#### runtime 实现（`assetResolver.ts`）

- 资产清单由 `DefinePlugin` 注入为 `__DSP_LIB_ASSET_INVENTORY__`（`scripts/lib-build/build.js`，清单本身由 `scripts/lib-build/assetInventory.js` 扫描磁盘得到）；未注入时（直接跑源码）用 `EMPTY_INVENTORY`，GLB 全回退元数据表、图标请求直接 reject，**不产生任何网络请求**。读取必须用 `typeof` 守卫，否则未注入时抛 ReferenceError。
- `models` 建 `modelPaths: Set` 做 O(1) 存在性判断（**注入清单而不是盲猜路径**：`resolveModelName()` 靠 `glbModelNames()` 判断有没有外部模型，猜错会变成「先 404 再回退」，而验收要求 Network 零 404）；`modelNames` 去掉 `models/` 前缀与 `.glb` 后缀。
- 路径前缀映射：清单里的图标键是 `icons/<category>/…`，产物在 `img/<category>/…`（`iconOutputPath`）；`itemRecipeIconUrl` / `techIconUrl` / `signalIconUrl` 命中清单则 `resolveAssetUrl("img/…")`，未命中 `throw new Error("找不到…图标")`。
- `modelTextureUrl(srcRelativePath)`：把 `assets/icons/models/<建筑目录>/<文件>.png` 映射成 `img/models/<相对路径>`（正则 `^.*assets/icons\/models\/`），路径不在该布局下时 `console.warn` 并返回 `null`；全程 `toPosix()` 归一化反斜杠。
- 信号图标文件名是 `signal-<id>.png`（清单键带 `signal-` 前缀），与 webpack 实现一致。

#### 构建期注入清单

| 注入标识 | 值 | 位置 |
| ---- | ---- | ---- |
| `__DSP_LIB_ASSET_INVENTORY__` | `JSON.stringify(buildInventory(root))` | `scripts/lib-build/build.js` 的 `DefinePlugin`；单测由 `jest.config.js` 的 `globals` 提供同一份 |
| `__DSP_LIB_MODULE_URL__` | ESM 注入 `import.meta.url`；UMD / 编辑器构建 / 单测注入 `undefined` | 同上 |
| `__DSP_MODEL_CACHE_ENABLED__` | 编辑器构建取 `persistence.web`、库构建取 `persistence.lib`（`config/persistence.config.js` 为 `{ web: true, lib: false }`）；单测按 `web` | `vue.config.js` / `scripts/lib-build/build.js` 各自的 `DefinePlugin`，单测由 `jest.config.js` 的 `globals` |

`buildInventory` 扫到的清单形状与 `AssetInventory` 一一对应：`models/*.glb` → `models/<name>.glb`，`icons/item_recipe`、`icons/tech`、`icons/signal` 下的 PNG → `icons/<sub>/<file>.png`；`models` 为空时直接抛错（否则构建/单测会静默退化成纯元数据模式）。单元测试 `tests/unit/lib/assetBaseUrl.spec.ts`。

***

## 7. 蓝图二进制格式与参数编解码

本章以 `src/blueprint/parser.ts`（1566 行）与 `src/blueprint/md5.ts` 为准，逐字节描述「蓝图字符串 → 内存结构 → 蓝图字符串」的往返过程。所有 `encodedSize` 的单位是 **int32 单元**（不是字节），字节数 = 单元数 × 4。

### 7.1 字符串整体结构

文本形状（`fromStr` / `toStr`）：

```
BLUEPRINT:<headerFormat>,<layout>,<i1>,<i2>,<i3>,<i4>,<i5>,0,<time>,<gameVersion>,<shortDesc>[,<author>,<blueprintVersion>,<properties>],"<base64(gzip(body))>"<md5>
```

- 前缀常量 `START = "BLUEPRINT:"`；导入时 `startsWith` 不成立直接抛 `Invalid start`。
- 头部字段用半角 `,` 分隔：从 `START.length` 起、到第一个 `"` 之前的子串做 `split(",")`，得到 header cells。
- `cells[0]` 是头部格式标记：`"1"` = 15 字段新版（短描述之后多出 作者 / 蓝图版本 / 属性 三项），`"0"` = 12 字段旧版。字段数不足分别抛 `Header too short`（v2 要求 ≥ 15，v1 要求 ≥ 12）。
- `cells[1]` = `layout`；`cells[2..6]` = 5 个图标 id；`cells[7]` 导出时恒写 `"0"`，导入时**不读取**（保留位）。
- `cells[8]` = 时间：以 `TIME_BASE = new Date(0).setUTCFullYear(1)`（公元 1 年 1 月 1 日 UTC）为基准的毫秒数 × 10000 的高精度 tick。导入 `new Date(TIME_BASE + v / 10000)`，导出 `(time.getTime() - TIME_BASE) * 10000`。
- `cells[9]` = 游戏版本字符串；`cells[10]` = 短描述。
- v2 头：`cells[11]` 作者、`cells[12]` 蓝图版本、`cells[13]` 属性（原始字符串，形如 `名称:内容;`），`cells[14]` 介绍。v1 头：`cells[11]` 即介绍，`author` / `blueprintVersion` / `properties` 一律置空串。
- 短描述 / 作者 / 蓝图版本 / 属性 / 介绍在导入端都过 `decodeURIComponent`，导出端过 `encodeURIComponent`；layout、图标 id、时间、游戏版本原样拼接，不做转义。

尾部与校验：

- base64 区段被一对双引号包住。第一个 `"` 位于头部之后，最后一个 `"` 固定落在 `length - 33`（其后即 32 位摘要）；该位置不是 `"` 时抛 `Checksum not found`。
- 摘要紧跟闭引号、两者之间没有分隔符，是 **32 位大写十六进制**（`hex()` 用 `toString(16).toUpperCase().padStart(2, "0")`）。
- 被校验的区间是 `strData.substring(0, length - 33)`，即「`BLUEPRINT:` 起、含开引号、到 base64 末尾为止」的字符；按 `charCodeAt` 逐字符取低 8 位组成字节数组，交给 `src/blueprint/md5.ts` 的 `digest(data: ArrayBuffer): ArrayBuffer`（纯 TS 的 MD5 实现，无 wasm / Worker 依赖，`K` 表 64 项、`S` 移位表 64 项、`BLOCK_SIZE = 64`）。不一致抛 `Checksum mismatch`。
- body = `pako.ungzip(atob(base64))`；导出反向 `btoa(pako.gzip(body))`（`btoUint8Array` / `Uint8ArrayTob` 做 charCode ↔ 字节的两侧转换）。

### 7.2 body 结构

```
meta（28 字节）
  version            int32
  cursorOffset.x     int32
  cursorOffset.y     int32
  cursorTargetArea   int32
  dragBoxSize.x      int32
  dragBoxSize.y      int32
  primaryAreaIdx     int32
numAreas             uint8
areas[numAreas]      每项 14 字节
numBuildings         int32
buildings[numBuildings]
  version < 2  → v1 记录：61 字节固定头 + 参数段
  version ≥ 2  → v2 记录：变长（见 §7.3）
[仅 version ≥ 2]
  patch              int32
  reformDataFlag     uint8
  [reformData]       flag ≠ 0 时存在（见 §7.5）
  [tailExtraBytes]   body 末尾剩余字节，原样保留
```

区域记录（`importArea` / `exportArea`，14 字节）：

```
index              int8
parentIndex        int8
tropicAnchor       int16
areaSegments       int16
anchorLocalOffset.x int16
anchorLocalOffset.y int16
size.x             int16
size.y             int16
```

v1 建筑记录（`importBuilding` / `exportBuilding`，61 字节固定头，无 tilt / content / 扩展字节）：

```
index              int32
areaIndex          int8
localOffset[0]     float32 × 3（x, y, z）
localOffset[1]     float32 × 3（x, y, z）
yaw[0]             float32
yaw[1]             float32
itemId             int16
modelIndex         int16
outputObjIdx       int32
inputObjIdx        int32
outputToSlot       int8
inputFromSlot      int8
outputFromSlot     int8
inputToSlot        int8
outputOffset       int8
inputOffset        int8
recipeId           int16
filterId           int16
paramLen           int16
paramData          int32 × paramLen
```

- v1 导入把 `tilt` 固定写 0，且不会读取 `content`。
- v1 固定头正好 61 字节（4+1+24+8+2+2+4+4+6+2+2+2），参数段另计。
- 导出时 `paramLen` 取 `parser.encodedSize(b.parameters)`（不传 version，等价 v1）；`parameters === null` 写 0。

v2 尾部（`importTailV2`）：

- `patch`：int32 预留位。导入原值保存；导出写 `bp.patch ?? 1`。
- `reformDataFlag`：uint8，非 0 才继续读地基数据，否则 `reformData` 置 `null`。
- 地基数据之后剩余的全部字节（`bodyEnd - 当前 pos`）整体存入 `tailExtraBytes` 并原样回写（源码注释记录了 0.10.33 实测的 5 字节预留）；`remain < 0` 时抛 `蓝图尾部数据解析错误：地基数据超出 body 范围`。

body 总长由 `encodedSize()` 计算：

```
28 + 1 + 14 × numAreas + 4
+ Σ 建筑记录（v1：61 + 4×paramLen；v2：见 §7.3）
+ [v2] 4（patch）+ 1（flag）+ reformDataSize + tailExtraBytes.length
```

导出按这个值一次性分配 `Uint8Array`，再用 `BufferWriter` 顺序写入，因此任何一处长度算错都会整体错位。

### 7.3 v2 建筑记录

标记与限制常量（全部实测自源码）：

| 常量 | 值 | 含义 |
| ---- | ---- | ---- |
| `V2_RECORD_MARKER` | `-102` | 导出时写入的记录起始标记（0.10.34 格式） |
| `V2_RECORD_MARKER_MIN` | `-100` | 导入接受的标记下限（源码注释：0.10.33 用 -101，0.10.34 用 -102） |
| `V2_RECORD_GAP_LIMIT` | `64` | 非最后一条记录在已知字段后找不到下一标记时的最大前向搜索字节数 |
| `V2_BELT_ITEM_IDS` | `{2001, 2002, 2003}` | 带 tilt 字段的传送带 |
| `V2_INSERTER_ITEM_IDS` | `{2011, 2012, 2013, 2014}` | 带 tilt + 7 个不透明浮点的分拣器 |

字段顺序（`importBuildingV2` / `exportBuildingV2` / `v2BuildingSize` 三者一致）：

```
marker             int32（-102）
index              int32
itemId             int16
modelIndex         int16
areaIndex          int8
p0                 float32 × 3
yaw0               float32
[tilt]             float32         仅传送带 / 分拣器
[v2ExtraPose]      float32 × 7     仅分拣器
outputObjIdx       int32
inputObjIdx        int32
outputToSlot       int8
inputFromSlot      int8
outputFromSlot     int8
inputToSlot        int8
outputOffset       int8
inputOffset        int8
recipeId           int16
filterId           int16
paramLen           int16
paramData          int32 × paramLen
[content]          int32 长度 + （>0 时）7-bit 前缀字符串   仅 marker ≤ -102
[extraBytes]       未知扩展间隙，原样保留                   仅非最后一条记录
```

尺寸拆分（`v2BuildingSize`）：

- 基础 **29** 字节 = marker 4 + index 4 + itemId 2 + modelIndex 2 + areaIndex 1 + p0 12 + yaw0 4。
- 传送带 / 分拣器 **+4**（tilt）；分拣器再 **+28**（7 × float32）。
- 固定尾段 **20** 字节 = outputObjIdx 4 + inputObjIdx 4 + 6 个 int8 + recipeId 2 + filterId 2 + paramLen 2。
- 参数段 = `encodedSize(parameters, 2) × 4`（v2 传 version = 2，只有四向分流器受影响，见 §7.4）。
- content 段 = `v2ContentSize()`：空 / 未定义 4 字节；否则 `4 + encoded7BitLength(utf8ByteLen) + utf8ByteLen`。
- `extraBytes` 全量追加。

行为要点：

- `importBuildingV2` 读到的 marker > -100 时抛 `v2 建筑记录起始标记错误`。
- 7 个浮点的结构约定是 `[reserved, tip.x, tip.y, tip.z, rot.x, rot.y, tip.yaw]`：`localOffset[1]` 取 `pose[1..3]`，`yaw[1]` 取 `pose[6]`，其余 3 个（索引 0 / 4 / 5）只做字节级保留（写回时原样输出）。
- 导出分拣器时：`v2ExtraPose` 缺失或长度不是 7 → 用 `[0, p1.x, p1.y, p1.z, 0, 0, yaw1]` 兜底；存在时复制一份并就地覆盖索引 1/2/3（`localOffset[1]`）与索引 6（`yaw[1]`），其余位保持不变。
- `content` 只在 `marker ≤ -102` 时才读：先读 int32 `contentLength`，> 0 再读 `.NET BinaryWriter` 风格的字符串（7-bit encoded 长度前缀 + UTF-8，`getString` / `setString`；前缀 shift 超过 35 位抛 `字符串长度前缀解析错误`）。导出端写的是 `content.length`（**UTF-16 字符数**），后续字符串体用 UTF-8 字节 + 其字节长度前缀。
- 非最后一条记录：已知字段读完后必须紧邻下一条记录的起始标记；否则在 `V2_RECORD_GAP_LIMIT = 64` 字节内做前向搜索。标记判定 `isV2RecordMarkerAt` 要求「小端 int32 ≤ -100」且「紧随的第 4 个字节（index 的最高字节）< 0x80」（即 index 视为非负）。找到就把整段间隙存进 `extraBytes`，找不到抛 `v2 建筑记录存在未知的尾部扩展`。最后一条记录跳过这项探测（尾部由 §7.2 的 `tailExtraBytes` 负责）。

### 7.4 参数编码与 ParamParser 注册表

接口与契约：

```ts
interface ParamParser<TParam extends AllParameters> {
    encodedSize(p: TParam, version?: number): number; // 单位：int32 单元
    encode(p: TParam, a: DataView): void;             // DataView 已按单元数 × 4 分配
    decode(a: DataView): TParam;
}
```

- 参数段 = `paramLen:int16` + `paramLen × int32`。读取用 `BufferReader.getView(paramLen * 4)`（越界由 `getView` 抛错），读写通过 `getParam` / `setParam`（`pos * 4` 偏移的小端 int32，`getParam` 支持缺省值以容忍短数据）。
- 所有 `encodedSize()` 返回的都是 **int32 单元数**，字节数 = × 4。v2 路径（`exportBuildingV2`、`v2BuildingSize`）传 `version = 2`，v1 路径不传（缺省 1）。
- 未注册的 itemId 落到 `unknownParamParser`：`encodedSize = p.parameters.length`，解码成 `{ parameters: Int32Array }`，整段 int32 原样保留。

注册表 `parameterParsers: Map<number, ParamParser<AllParameters>>` 的真实内容 = 23 条显式条目 + `allAssemblers` 补入的 11 条 = **34** 条：

| itemId | 解析器 | 建筑（名称取自 `data/itemsData.ts`） | `encodedSize`（int32） | 字节 |
| ---- | ---- | ---- | ---- | ---- |
| 2103 | `stationParamsParser(stationDesc)` | 物流运输站 | 2048 | 8192 |
| 2104 | `stationParamsParser(interstellarStationDesc)` | 星际物流运输站 | 2048 | 8192 |
| 2316 | `advancedMiningMachineParamParser()` | 大型采矿机 | 2048 | 8192 |
| 2020 | `splitterParamParser` | 四向分流器 | 4（v1）/ 6（v2） | 16 / 24 |
| 2901、2902 | `labParamParser` | 矩阵研究站 / Mk.II | 2 | 8 |
| 2302、2303、2304、2305、2308、2309、2310、2315、2317、2318、2319 | `assembleParamParser` | 电弧熔炉、制造台 Mk.I–IV、原油精炼厂、化工厂 / Mk.II、微型粒子对撞机、位面熔炉、熔炉 Mk.III | 1 | 4 |
| 2001、2002、2003 | `beltParamParser` | 低/高/极速传送带 | 2 | 8 |
| 2011、2012、2013、2014 | `inserterParamParser` | 低/高/极速分拣器、集装分拣器 | 1 | 4 |
| 2101 | `storageParamParser(30)` | 小型储物仓 | `max(10+30, 110)` = 110 | 440 |
| 2102 | `storageParamParser(60)` | 大型储物仓 | 110 | 440 |
| 3009 | `battleBaseParamParser()` | 战场分析基站 | 110 | 440 |
| 2106 | `tankParamParser` | 储液罐 | 2 | 8 |
| 2311 | `ejectorParamParser` | 电磁轨道弹射器 | 2 | 8 |
| 2208 | `powerGeneratorParamParser` | 射线接收站 | 1 | 4 |
| 2210 | `artifacialStarParamParser` | 人造恒星 | 1 | 4 |
| 2209 | `energyExchangerParamParser` | 能量枢纽 | 1 | 4 |
| 2030 | `MonitorParamParser` | 流速器 | 128 | 512 |
| 2107 | `dispenserParamParser` | 物流配送器 | 128 | 512 |
| 其它 | `unknownParamParser` | 未注册 itemId | `parameters.length` | ×4 |

`allAssemblers`（`src/data/items.ts`）= `{2303, 2304, 2305, 2318, 2302, 2315, 2319, 2308, 2309, 2317, 2310, 2901, 2902}`；注册循环带 `if (!parameterParsers.has(id))` 守卫，因此 2901/2902 保留显式注册的 `labParamParser`，另外 11 个 id 落到 `assembleParamParser`。

各解析器的字段布局：

**物流塔族**（2103 / 2104 / 2316，`stationParamsParser`）。`stationParamsMeta = { base: 320, storage: { base: 0, stride: 6 }, slots: { base: 192, stride: 4 } }`，`encodedSize` 恒为 2048。

- 标量（基址 320）：`+0` `workEnergyPerTick`、`+1` `tripRangeOfDrones × 100000000`、`+2` `tripRangeOfShips / 100`、`+3` `includeOrbitCollector`（真 1 / 假 -1）、`+4` `warpEnableDistance`、`+5` `warperNecessary`（±1）、`+6` `deliveryAmountOfDrones`、`+7` `deliveryAmountOfShips`、`+8` `pilerCount`、`+10` `droneAutoReplenish`（1/0）、`+11` `shipAutoReplenish`（1/0）。`+9` 空出，供大型采矿机写 `miningSpeed`。
- 库存栏位（基址 0、步长 6，只用前 5 个槽）：`+0` `itemId`、`+1` `localLogic`、`+2` `remoteLogic`、`+3` `max`、`+4` `keepMode`（0 = 不锁定）。条数取 `desc.maxItemKind`：`stationDesc = 4`、`interstellarStationDesc = 5`、`AdvancedMiningMachineDesc = 1`。
- 物流口（基址 192、步长 4，固定 12 个）：`+0` `dir`（`IODir`）、`+1` `storageIdx`（**从 1 开始**）。`desc.numSlots` 字段虽然声明（12 / 12 / 9），但编解码循环写死 12，未被读取。

**大型采矿机**（2316）：委托物流塔解析器（`AdvancedMiningMachineDesc`），再把 `miningSpeed` 写在 `base + 9`，`encodedSize` 继承 2048。

**四向分流器**（2020）：`+0..+3` 四个优先级布尔（`priority[i] ? 1 : 0`）；v2 追加 `+4`、`+5` 两个语义未明确的 int32（`extra`），解码时用 `getParam(a, 4, 0)` / `getParam(a, 5, 0)` 容忍 v1 短数据。

**研究站**（2901 / 2902）：`+0` `researchMode`（`ResearchMode`）、`+1` `acceleratorMode`（`AcceleratorMode`）。

**制造台 / 熔炉 / 精炼厂 / 化工厂 / 对撞机**（`assembleParamParser`）：`+0` `acceleratorMode`。

**传送带**（2001–2003）：`+0` `iconId`、`+1` `count`。**分拣器**（2011–2014）：`+0` `length`。

**储液罐**（2106）：`+0` `output`（真 1 / 假 -1）、`+1` `input`（±1）——注意是**输出在前、输入在后**。

**储物仓**（2101 / 2102）：`encodedSize = max(10 + size, 110)`；`+0` `automationLimit`、`+1` `type`（`StorageType.DEFAULT = 0` / `FILTERED = 9`）；`type = 9` 时 `+10+i` 为第 i 格的 `filter`（`i < size`，30 或 60）。

**战场分析基站**（3009）：先按 `storageParamParser(60)` 写存储段，再按 `type` 选后段基址（`DEFAULT → 10`、`FILTERED → 70`，其它抛 `参数解析错误：未知的储存类型`）：`+0` `workEnergyPerTick`、`+1` `autoPickEnabled`、`+2` `autoReplenishFleet`、`+3` `combatEnabled`、`+4` `autoReconstruct`、`+5` `constructionDroneEnabled`、`+6` `droneConstructPriority`、`+7..+18` 共 12 个战斗机 `itemId`。

**单双参数建筑**：电磁轨道弹射器 `+0` `orbitId`、`+1` `boost`；射线接收站 `+0` `productId`；人造恒星 `+0` `boost`；能量枢纽 `+0` `mode`。

**流速器**（2030，128 单元）：`0` `targetBeltId`、`1` `offset`、`2` `targetCargoAmount`、`3` `periodTicksCount`、`4` `passOperator`、`5` `passColorId`、`6` `failColorId`、`7` `tone`、`8` `volume`、`9` `pitch`、`10` `systemWarningMode`、`11` `repeat`（1/0）、`12` `alarmMode`、`13` `length × 10000`、`14` `cargoFilter`、`17` `systemWarningIconId`、`18`/`19` `falloffRadius × 10`、`20` `spawnItemOperator`。`15`、`16` 未写入也未读取。

**物流配送器**（2107，128 单元）：`0` `playerMode`、`1` `storageMode`、`2` `workEnergyPerTick`、`3` `courierAutoReplenish`。

相关枚举（全部与代码数值一致）：`IODir { None, Output, Input }`、`LogisticRole { None, Supply, Demand }`、`AcceleratorMode { ExtraOutput = 0, Accelerate = 1 }`、`ResearchMode { None = 0, Compose = 1, Research = 2 }`、`StorageType { DEFAULT = 0, FILTERED = 9 }`、`EnergyExchangerMode { Discharge = -1, StandBy = 0, Charge = 1 }`、`BattleBaseDroneConstructPriority { REPARE = 0, BALANCE = 1, CONSTRUCT = 2 }`、`SpawnItemOperator { NONE = 0, GENERATE = 1, CONSUME = 2 }`、`DispenserPlayerMode { NONE = 0, RECYCLE = 1, BOTH = 2, SUPPLY = 3 }`、`DispenserStorageMode { NONE = 0, SUPPLY = 1, DEMAND = 2 }`。

### 7.5 地基数据 reformData

`reformDataFlag ≠ 0` 时的结构（`importReformData` / `exportReformData`）：

```
reserved              uint8
rectLen               int32
rects[rectLen]        每项 9 字节
customReformColorMask uint32
colorLen              int32
customReformColors[colorLen]  uint32
```

单个矩形（`BlueprintReformRect`，9 字节）：

```
reserved   uint8
x          int16
y          int16
w          uint8
h          uint8
data       uint8   （高 3 位 = type，低 5 位 = color）
areaIndex  uint8
```

- 位域：导入 `type = data >> 5`、`color = data & 0x1f`；导出 `((type & 0x07) << 5) | (color & 0x1f)`。
- 合理性校验：`rectLen` 与 `colorLen` 都必须落在 `[0, REFORM_COUNT_LIMIT]`，常量 `REFORM_COUNT_LIMIT = 2930400`（源码注释：星球最大格点数量级）；越界抛 `地基数据解析错误：rectLen 超出合法范围` / `...customReformColors 长度超出合法范围`。
- `customReformColorMask` 的第 i 位表示第 i 号颜色槽使用自定义色；`customReformColors` 按置位槽位升序**紧凑**存放。
- `hasReformData()` 的判据是 `reformData != null && reformData.rects.length > 0`。为假时导出只写 `reformDataFlag = 0`，整段地基数据（含 `customReformColors`）都不会写进蓝图。
- 尺寸：`reformDataSize = 1 + 4 + rects.length × 9 + 4 + 4 + customReformColors.length × 4`。

渲染侧常量与语义（`src/blueprint/reform.ts`，被 §8 使用）：

| 常量 | 值 | 含义 |
| ---- | ---- | ---- |
| `REFORM_TYPE_NONE` | `0` | 未改造，不渲染 |
| `REFORM_TYPE_IBEAM` | `1` | 默认工字铺（错缝金属板） |
| `REFORM_TYPE_GRID` | `2` | 直铺（对齐金属板） |
| `REFORM_TYPE_PLAIN` | `7` | 无装饰纯色 |
| `REFORM_LIFT` | `0.015` | 相对星球表面的抬升量（介于地表与经纬网格线之间） |
| `TILE_SCALE` | `0.985` | 单格板相对网格步距的缩放，避免相邻共边闪烁 |

- 矩形展开为逐格：同一格被多个矩形覆盖时**后出现者胜**；`type = 0` 的格子跳过。
- 颜色槽共 32 个：mask 置位的槽按升序紧凑取 `customReformColors[rank]`（uint32 低 24 位当 `0xRRGGBB`），未置位时回退内置色板（`DEFAULT_REFORM_COLORS` 共 15 项，索引 0–14），越界用 `0x808080`。

### 7.6 读写实现的容错与易踩的坑

- 越界保护：`BufferReader.check` / `BufferIO.getView` 统一抛 `蓝图数据读取越界：位置 X，请求 Y 字节，剩余 Z 字节`，不会静默读垃圾。
- 「字节级原样保留」字段清单（少写任何一个都会让蓝图与游戏侧不一致）：`BlueprintBuilding.v2ExtraPose`、`BlueprintBuilding.content`、`BlueprintBuilding.extraBytes`、`BlueprintData.patch`、`BlueprintData.tailExtraBytes`、`BlueprintReformRect.reserved`、`BlueprintReformData.reserved`、`unknownParamParser` 的整段 int32。
- `encodedSize` 的单位陷阱：所有解析器返回的都是 int32 单元数。若按字节返回，`paramLen` 会差 4 倍，并连带把其后的 `content`、`extraBytes`、`patch`、`reformData` 全部读错位。
- `content` 长度字段语义：导出写「UTF-16 字符数」而不是 UTF-8 字节数，紧跟的字符串体才是 7-bit 前缀 + UTF-8。纯 ASCII 时两者相同，含中文时不同；读取端只用 `> 0` 判断，因此解码不受影响。
- 空矩形陷阱：`reformData` 存在但 `rects` 为空时 `hasReformData()` 为假 → 导出直接丢弃地基段与自定义色。
- 分拣器 `v2ExtraPose` 的 7 个浮点必须保持长度 7，否则导出会整组重建，丢弃其中 3 个语义未知的保留位。
- `patch` 缺省值：导入 v1 蓝图（或早期 v2）时 `patch` 为 `undefined`，导出时回落为 1，属有意行为。
- 校验和按字符取字节（`charCodeAt`）：前缀是 ASCII + base64，正常情况等价于 UTF-8 字节；若有人往头部塞非 ASCII 且未编码，校验会与游戏侧不一致。

***

## 8. 3D 渲染与交互

两条渲染路径共用 `src/lib/core/` 的构建函数：

- **SPA / 编辑器**：`App.vue` → `components/BlueprintEditor.vue`，自己 new `Scene` / `PerspectiveCamera` / `WebGLRenderer`，调用 `createPlanetScene` + `buildBuildings` + `buildBVH` + `buildReforms`。
- **库**：`BlueprintViewer` → `lib/core/RenderCore.ts`，同一套构建函数，另加主题、选中池、增量预览层与完整生命周期管理（§8.6）。

### 8.1 场景装配

`createPlanetScene(radius = PLANET_RADIUS, segment = PLANET_SEGMENT, addFineGrid = true)`（`src/lib/core/planetScene.ts`）返回 `{ root, dirLight, sphereMaterial, gridMaterial, fineGridMaterial?, updateGridLOD, dispose }`：

- `root`（`Group`）内依次是：`AmbientLight(0xffffff, 0.3)`、`DirectionalLight(0xffffff, 2)`、`Mesh(SphereGeometry(radius, segment, segment / 2), MeshStandardMaterial({ color: 0xb0b0b0 }))`、经纬网格 `Group`。
- 世界常量全部来自 `src/planetConstants.ts`：`PLANET_RADIUS = 200.2`、`PLANET_SEGMENT = 200`、`GRID_PER_SEGMENT = 5`、`HEIGHT_GRID_SIZE = 4 / 3`、`GRID_HORIZONTAL = 2π / SEGMENT / GRID_PER_SEGMENT × R`。
- 网格半径取 `radius * 1.0001`（略微抬离球面，避免 z-fighting）。
- 粗网格：一条 `SphereLatitudeGridGeometry({ widthSegments: segment, heightSegments: segment / 2 })` 覆盖全纬线，再加按 `gridAreas(segment)`（`src/blueprint/planet.ts`）逐纬度带生成的若干 `SphereLongitudeGridGeometry`（经度向 `longitudeSeg` 段、纬度向 `|latitudeSeg|` 段，`thetaStart = (minLatitudeSeg + segment / 4) × 2π / segment`）；材质 `LineBasicMaterial({ color: 0xf0f0f0, depthWrite: false })`。
- 细网格：密度 ×`GRID_PER_SEGMENT`（即每格一条线），材质 `color 0xf0f0f0` + `opacity 0.4` + `transparent` + `depthWrite: false`（WebGL 不支持可变线宽，只能靠低对比 + 半透明模拟「细」），统一挂在名为 `__planet_fine_grid__` 的子 `Group`。
- 网格 LOD：`FINE_GRID_DISTANCE_IN = PLANET_RADIUS * 1.2`、`FINE_GRID_DISTANCE_OUT = PLANET_RADIUS * 1.3`，双阈值滞回——相机到球心距离小于 IN 显示细线、大于 OUT 隐藏、中间保持上一状态，只在状态真的变化时才写 `visible`。
- 每帧把 `dirLight.position` 设为相机位置（编辑器在 `animate()`、`RenderCore` 在渲染循环里各做一次），保证建筑朝向相机的一侧始终受光。
- 相机：`PerspectiveCamera(50)`，`near = 0.5`、`far = 3000`，初始 `position.z = 2 * PLANET_RADIUS`。`near` 不能再小：24 位深度缓冲在 z ≈ 200 处的精度会掉到地基 `REFORM_LIFT = 0.015` 的抬升量以下，地基会闪烁。
- 球面网格几何（`src/SphereGridGeometry.ts`）：基类 `SphereBaseGridGeometry` 只生成顶点（按 `(纬度, 经度)` 双层循环，每行 `widthSegments + 1` 个点，球坐标转直角坐标），子类分别只连纬线（`SphereLatitudeGridGeometry`，跳过北极退化成点的首行）或只连经线（`SphereLongitudeGridGeometry`），不生成三角面。
- 天光 / 星空（`src/skyGradient.ts`）：`createSkyGradient({ planetRadius })` 生成一个 `PlaneGeometry(2, 2)` 全屏四边形，顶点着色器直接写 NDC（不经过相机/模型矩阵，与 FOV、宽高比无关），`renderOrder = -1000`、`depthTest/depthWrite = false`、`toneMapped = false`、`frustumCulled = false`。uniform 在 `onBeforeRender` 里从相机同步（投影逆矩阵、相机旋转、相机位置、`camera.up`）。片元里的四层效果：
  1. 大气宽雾带 `exp(-elev² × 6.76 / hScale²)`（源码注释：默认高度下约 ±40° 的宽带）与更窄的辉光 `exp(-elev² × 81 / hScale²)`（注释：约 ±12° 的亮边），`elev = dot(dir, up)`；
  2. 两层 3D 网格哈希星空（`scale` 45 / 90，阈值 0.965 / 0.982）+ 一层 FBM 星云噪点；
  3. 星球大气边缘光：解析求「视线到球心最近距离 / R」= `limb`，以 `limb ≈ 1 + 归一化大气层高` 为中心叠一环光 + 一圈薄雾，并用 `smoothstep(1.15, 1.9, |cam| / R)` 限制为「相机确实拉远时才出现」（贴地时交给雾带）；
  4. 高度缩放 `hScale`：`atmosphereHeight / (planetRadius × DEFAULT_ATMOSPHERE_RATIO)`，默认 `DEFAULT_ATMOSPHERE_RATIO = 0.05`（大气层高 ≈ 0.05R ≈ 10 世界单位，归一化后光环中心在 `limb ≈ 1.05`），调大即整体变厚变宽。
- 主题（`src/lib/core/theme.ts`）：`THEME_PALETTE` 三套 `ThemeColors`（`editor` / `dark` / `light`，各含 `sceneBackground`、`planet`、`grid`、`textFill`、`textStroke`），`resolveTheme(name)` 把 `'auto'` 解析为跟随 `prefers-color-scheme: light`（无 `window` 时回落 dark），返回副本。编辑器路径不使用它（固定观感 + 天光），库路径的 `RenderCore.setTheme()` 用（§8.6）。

### 8.2 建筑实例化

`buildBuildings(transforms, buildings, options)`（`src/lib/core/buildBuildings.ts`）→ `{ buildings: AllBuildings, stats: BuildStats, iconTexture }`。输入 `transforms[i]` 是 `calcBuildingTrans()` 给出的 `Matrix4[]`（按 `localOffset` 生成的 1–2 段：起点 + 分拣器终点）。

分类：`isBelt(itemId)` → belts（2001–2003）、`isInserter(itemId)` → inserters（2011–2014）、其余 → boxes。

1. **传送带**：`CylinderGeometry(0.32, 0.32, 0.1, 8)` + 共享 `MeshLambertMaterial` 的 `InstancedMesh`（每实例 = 建筑世界矩阵 × `Tz(0.05)` × `Rx(π/2)`，即圆柱先绕 X 放倒、再沿建筑局部 z 抬 0.05）。另建一个「连接段」`InstancedMesh`：几何 `BoxGeometry(0.15, 0.06, 1.0)`（`linkThickness = 0.6 × thickness`），逐带按 `outputObjIdx >= 0` 连到下游、长度取两端点距离作为 z 缩放，`count` 收窄为实际段数（`outputObjIdx < 0` 的带子没有连接段）。
2. **分拣器**：`BoxGeometry(0.15, 0.06, 1.0)`，姿态由 `inserterTrans(transforms[i], m)` 计算——两端点各沿法线抬 `INSERTER_HEIGHT = 0.3` 后 `lookAt`，返回两端点长度作为 z 缩放（随后再乘 `Tz(-0.5)` 让盒体趴在起点一侧）；`buildBVH` 调用同一函数，保证选取盒与模型严格重合。
3. **其余建筑**：先用 `resolveBuildingModel(modelIndex)` 解析模型来源，再决定走 GLB 还是元数据盒：
   - 走 GLB 的条件：`settings.showRealModels` 为真、该 modelIndex 的实例数（按「存在 `glbName` 的建筑数」统计）≤ `settings.maxInstancesPerModel`、GLB 已加载。命中后按 modelIndex 归组并建 `GlbModelInstances`：GLB 原型里每个子网格一个 `InstancedMesh`，几何与材质直接复用缓存（`userData.sharedResource = true`，`frustumCulled = false`），每实例矩阵 = 建筑世界矩阵 × 放置矩阵 × 子网格局部矩阵；`modelTransform.color` 有值时用 `setColorAt` 染色。
   - 其余情况（未加载 / 超限 / 无元数据）进元数据盒回退组：`BoxGeometry(1, 1, 1)` × `buildingMeta.unitBoxTrans`，颜色取 `buildingMeta.color`；GLB 尚未加载时顺带 `requestBuildingModel()` 触发懒加载（加载器内部做并发去重与缓存）。
   - 计数口径是「存在 glbName 的建筑数」而不是「已加载 GLB 的建筑数」，所以同一蓝图同一设置的渲染结果与加载时序无关。
   - 没有 `buildingMeta` 的 modelIndex：放零缩放矩阵（不可见）+ 占位色 `0xdddddd`，并计入 `stats.unknownModelIndexes`，不再抛错白屏。
   - 模型到达后由 `onBuildingModelsChanged` 触发重建（编辑器侧 150ms 合并一次，见 §8.4）。
4. **货物**：`Cargos`（`src/cargos.ts`）容量 = belts + inserters；带子的货物在「连接段」循环里随段生成（只有 `outputObjIdx >= 0` 的带子有），每个分拣器各一个。几何 `BoxGeometry(0.3, 0.15, 0.4)` 附带自定义实例属性 `cargoDistance`（沿运动方向的行程）；`CargoMaterial.onBeforeCompile` 注入 `cargoMove` uniform，顶点着色器里 `transformed.z -= cargoMove * cargoDistance`。每帧 `cargoMove = (time % 1000) / 1000`，货物沿 z 匀速滑动一个周期。
5. **图标**：`IconTexture`（`src/iconTexture.ts`）是 24×24 槽位的图集、每格 `ICON_SIZE = 80`，即 1920×1920 纹理，槽位 0 空置；`requestIcon(iconId)` 按槽位索引去重（不是按 iconId，这是修过的旧 bug），异步 `copyTextureToTexture` 写入，图集 dispose 后不再回写。
   - 传送带（`parameters.iconId > 0`）→ `beltIconPos`（建筑 × `Tz(0.5)`）+ `beltIconScale = (1.1, 1.1)`；
   - 分拣器（`filterId > 0`）→ `sorterIconPos`（建筑 × `Tz(INSERTER_HEIGHT)`）+ `sorterIconScale = (0.8, 0.8)`；
   - 其余盒子建筑（排除 `noIconBuildings`）→ `buildingIconId()`（`recipeId > 0` 用配方图标，否则物品图标）+ `buildingIconPos`（建筑 × `meta.iconTrans`，缩放从矩阵里取）。
   - 全部图标塞进一个 `IconGeometry`（`InstancedBufferGeometry`）+ `Icons`（自定义 `IconsMaterial`：按 `iconId / iMapSize` 算图集 UV，`iconPos` / `iconScale` 做屏幕对齐，并把深度往相机方向挪 5 个单位让图标浮在建筑上）；`renderOrder = 10`、`frustumCulled = false`（实例散布全球，几何自带包围球无效）。
   - `noIconBuildings`（`src/data/building.ts`）= `{2020 四向分流器, 2040 自动集装机, 2030 流速器, 2313 喷涂机, 2201 电力感应塔, 2202 无线输电塔}`。
6. **下标**：传送带 `count !== 0` 时生成角标文本（`count >= 100000` → `floor(count / 1000) + "k"`，否则 `count.toFixed(0)`）。`IconSubscript`（`src/iconSubscript.ts`）用 canvas 烘出的 `0123456789k` 字体图集（`FontTexture`，bold monospace，描边 + 填充），字符池连续排布、`renderOrder = 11`，同样关闭视锥剔除；`subscriptMap` 记录每栋建筑在池中的 `startIdx / length` 供 §8.4 的局部刷新使用。
7. **汇总**：`AllBuildings extends Object3D`（`src/lib/core/AllBuildings.ts`）挂载所有 mesh + `Icons` + `Cargos` + `IconSubscript`，对外暴露 `icons`（= `iconsMesh.geometry`）、`iconTexture`、`cargos`、`modelRef`、`subscriptMesh`、`subscriptMap`。`modelRef[i]` 是 `{ mesh, instance }`（InstancedMesh 实例下标）或 GLB 建筑的 `{ matrix }`（建筑中心世界矩阵）。`dispose()` 释放 InstancedMesh 与其几何，但跳过 `userData.sharedResource` 的共享几何，也不碰图标图集（图集归调用方）。
8. **统计**：`BuildStats` 汇总 `buildingCount`、`glbGroupCount`、`glbInstanceCount`、`fallbackBoxCount`、`hiddenCount`、`unknownModelIndexes`（去重升序）、`iconCount`、`subscriptCount`、`cargoCount`、`perModelGlbCounts`。

### 8.3 拾取与选择

- `buildBVH(transforms, buildings)`（`src/lib/core/buildBVH.ts`）→ `{ bvh, unknownModelIndexes }`。选择盒：分拣器 = `inserterTrans` 的姿态 × `Scale(0.5, 0.5, len)` × `Tz(-0.5)`；其余 = `transforms[i][0] × meta.selectUnitBoxTrans`；无 `buildingMeta` 时用 `1e-6` 的极小缩放占位——**不能用零缩放**，否则 `BVH` 会把包围盒退化成点、`longestAxis` 返回 null 后抛 `Unexpected empty box`（实测 2 个以上未知建筑即触发）。
- `BVH`（`src/bvh/bvh.ts`）：按最长轴中位数切分的 AABB 树（默认 `maxDepth = 32`、`leafBoxes = 1`），构造期对每个盒生成 `Box3` 与中心点；`raycast(ray)` 先用节点 AABB 粗筛，叶子节点把射线变换到盒的局部空间与 `BoxGeometry(1,1,1)` 的 12 个三角形求交，返回 `{ index, distanceSquared }[]` 并按距离升序。`boxes: Matrix4[]` 保留原始选择盒（高亮盒直接复用它）。
- 拾取（编辑器 `BlueprintEditor.pickBuilding` 与库 `RenderCore.pick` 同语义）：鼠标位置 → NDC → `Ray`（`direction.z = 0.5` 后 `unproject` 再减去原点归一化）→ `bvh.raycast`；若射线先命中半径 `PLANET_RADIUS` 的星球球体，则视为没选中任何建筑。
- **单选**（SPA / 编辑器）：左键 `click` → 计算命中下标并 emit `update:selectedBuildingIndex`；按下与松开的位移超过 **6 CSS px** 视为拖拽，不当作点击（与相机拖拽共存）。选中高亮是一个 `BoxGeometry(1, 1, 1)` + `MeshStandardMaterial({ color: 0x0074e8, opacity: 0.5, transparent: true, depthWrite: false })` 的 `Mesh`，`matrixAutoUpdate = false`，`watchEffect` 里直接把 `bvh.boxes[selected]` 拷进 `matrix`；`selectedBuildingIndex === null` 时移出场景。
- **右键剔除**：`contextmenu` → 同样的 6px 死区 → `queue.push(new RemoveBuildingCommand(index, queue.data))` → 清空选中。
- **多选**只在库层：`RenderCore.setSelectedIndexes(indexes)` 用 Mesh 池承载多个高亮盒（越界与重复下标静默忽略，空数组等价清除），`selectedIndex` 返回第一项，`selectedIndexes` 返回副本；`BlueprintViewer.selectedBuildings(indexes)` 先整体校验再提交（任一建筑找不到则整次失败、原选中不变），`getSelectedIndexes()` 读回。SPA 的 `App.vue` 只有单个 `selectedBuildingIndex`。
- **聚焦** `focusBuilding(index, distance?)`（`RenderCore` + `BlueprintViewer` 同名 API）：取选择盒的平移作为建筑中心；`|center|² < R² × 1e-3` 时判为未知模型的隐藏占位（在球心）并拒绝聚焦，返回 `false` / `not-renderable`；否则 `controls.focusSpherePoint(center, d)`，`d` 缺省 `FOCUS_DISTANCE_RATIO × PLANET_RADIUS = 0.5R ≈ 100.1`、下限 1。`focusSpherePoint` 把 `anchor` 设为该点法线、`viewDir` 设为 `(0,1,0)`（`update()` 会把它投影进切平面）、`tilt = maxTilt`、`distance = distanceForCameraRadius(|center| + d)`；轨道中心仍是球心，因此聚焦后缩放 / 旋转 / 平移照常，不会「镜头锁死」。
- `selectByBuildingId(id)` 按 `BlueprintBuilding.index`（蓝图里的建筑 ID，不是数组下标）线性查找后选中；`isUnknownModel(index)` 可查询某建筑是否只能渲染成隐藏占位。

### 8.4 命令后的场景重建链路

实测链路（旧文档写的「`watchEffect(execVersion)`」不准确：依赖建立在 `computed` 上，`watchEffect` 只负责挂载/回收）：

```
CommandQueue.push / undo / redo
  └─ 非 silent → execVersion++ ；所有命令 → stateVersion++（§9.1）
        ├─ App.vue：provide(commandQueueKey, computed(() => new CommandQueue(data)))
        │     └─ watchEffect(() => watch(stateVersion, () => codeExpired = true))
        │           └─ encodeBp() 在复制 / 导出 / 显示时才真正 toStr()，重建蓝图字符串
        └─ BlueprintEditor.vue：const b = computed(...)
              ├─ 依赖：commandQueue.value.execVersion.value、本地 modelVersion.value
              ├─ findPosForAreas(d.areas, PLANET_SEGMENT)
              ├─ transforms = d.buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b))
              ├─ buildBuildings(transforms, d.buildings, { settings, textureSink, iconTexture: editorIconTexture, textureSettings })
              ├─ buildBVH(transforms, d.buildings)
              ├─ buildReforms(PLANET_RADIUS, pos, d.reformData)
              └─ registerUpdater(commandQueue.value.updater, built.buildings, pos)
        └─ watchEffect((onCleanUp) => …)
              ├─ scene.add(buildings) / scene.add(reforms)
              └─ onCleanUp → scene.remove + buildings.dispose()（旧场景回收）
```

- `registerUpdater`（仍在 `BlueprintEditor.vue`，因为它依赖 import 了 Vue 的 `Updater`）第一步就是 `updater.clearAll()`，清空 5 条 dispatcher 的旧回调，防止陈旧闭包引用已销毁的 `AllBuildings`；随后按通道注册局部刷新：`updateBuildingIcon`（重算图标 id → `icons.updateIconId`）、`updateBeltIcon`（有图标改 UV，原本没图标就 `addIcon` 动态补）、`updateBeltIconSubscript`（重算 count 文本并 `subscriptMesh.setText`，文本长度变了就跳过以免污染连续字符池）、`updateSorterIcon`（同 `updateBeltIcon` 逻辑，id 取 `itemIconId(filterId)`）；`updateStationInfo` 目前没有回调（物流塔面板自己响应式刷新）。这些回调只改 UV / 文本 / 颜色，不碰几何与 BVH。
- `silent` 命令（`ReplaceCommand` / `SetAcceleratorCommand` / `SetBeaconContentCommand` / 两个 StationInfo 命令）不走这条重建路径，只递增 `stateVersion`；它们对 3D 的影响完全靠上述局部回调与面板响应式刷新。
- 模型到达：`onBuildingModelsChanged` → 150ms 去抖 → `modelVersion.value++` → 同一个 `computed` 重建，让新 GLB 接管渲染。
- 图标图集跨重建复用：`editorIconTexture = new IconTexture(renderer)` 在编辑器实例生命周期内只建一次（卸载时 `dispose()`），避免每次重建都重新分配 1920×1920 纹理并重发全部图标请求。
- 渲染设置：编辑器只读「已生效快照」（`getAppliedRenderSettings()`，在「导入蓝图」时由 `captureRenderSettings()` 固化），因此设置变更不触发中途重建，只把 `settingsDirty` 置真并提示「需重新导入蓝图」。
- 相机复位：`parseBp` 判定蓝图确实换了（末尾 33 字符签名或建筑数变化）才 `renderer.value?.resetCamera()`，即 `applyHome()` 重算入场姿态（§8.5）。

### 8.5 相机控件 PlanetMapControls

`PlanetMapControls extends EventDispatcher<{ change; start; end }>`（`src/PlanetMapControls.ts`，917 行），把「绕球心轨道」换成「球面锚点 + 仰角 + 视距」三参数模型。

状态与解算：

- `anchor`：球面上的单位向量，同时是该处的球面法线；相机永远看向 `anchor × R`，所以能出现真正的俯仰。
- `viewDir`：切平面内由锚点指向相机的单位向量；`update()` 每帧把它投影回切平面再归一化（等价于平移时的平行移动），退化时有兜底方向。
- `tilt`：仰角，`minTilt = 0`（平视）/ `maxTilt = 85°`（俯瞰）。不取 90° 是因为正上方时相机 `up` 与视线平行、`lookAt` 会退化。
- `distance`：用户设定的「相机到锚点」期望距离；`effectiveDistance = min(distance, maxDistanceForTilt(tilt))` 是受地平线约束后实际生效的距离。两者分开存，压到平视后再抬回仰角能恢复原缩放级别。
- 每帧位置：`height = minHeight + sin(tilt) × d`、`horizontal = cos(tilt) × d`，`position = anchor × (R + height) + viewDir × horizontal`；`object.up = anchor`，`lookAt(anchor × R)`。因此地平线永远水平、建筑永远竖着，但**不吸附正北**。
- `update()` 在位置或朝向变化超过 `EPS = 1e-6` 的阈值时返回 `true`，`RenderCore` 用它驱动 `cameraVersion` 与 `onCameraChange`。
- 地平线联动：`visibleAt(d, tilt)` 判定 `horizontal ≤ R × acos(R / (R + height))`；`maxDistanceForTilt` / `minTiltForDistance` 各用 32 次二分逼近。`setDistance()` 拉远到会被地平线挡住时自动抬高 `tilt`；`setTilt()` 只夹范围，距离交给 `effectiveDistance` 收。

输入映射：

| 输入 | 行为 | 备注 |
| ---- | ---- | ---- |
| 左键拖拽 | 平移锚点（`MOUSE.PAN`） | `pan()` 按 `worldPerPixel()` 换算，弧长 s → `anchor += s / R` 后归一化 |
| 右键拖拽 | 旋转（`MOUSE.ROTATE`）：水平改方位、竖直改仰角 | 死区通过后才生效 |
| 中键 | 不绑定任何动作（`mouseButtons.MIDDLE = -1`） | 缩放只走滚轮 |
| 滚轮 | 唯一的缩放入口：`setDistance(distance / wheelDollyBase^deltaY)`，`wheelDollyBase = 0.999` | `state !== NONE` 期间忽略滚轮 |
| 单指触摸 | 平移（`touches.ONE = TOUCH.PAN`） | `domElement.style.touchAction = "none"` |
| 双指触摸 | 开合缩放 + 拖动旋转（`touches.TWO = TOUCH.DOLLY_ROTATE`） | |
| W / S / A / D | 键盘平移，`keyPanSpeed = 240` CSS px/s | 与拖拽共用同一套像素→世界换算，每帧按 `dt` 累加 |
| N | `reset()` 回入场姿态 | 需要编辑器根 div 有焦点（`listenToKeyEvents(rootEl)`） |

- 拖拽死区 `dragThreshold = 3` CSS px：位移第一次越过阈值才放行，避免单击时抖一下视角（点击选中/右键剔除另有 6px 死区，见 §8.3）。
- CSS px → 角度的换算用 `anglePerPixel() = fov / domElement.clientHeight`；`rotate(dx, dy)` 里水平分量走 `rotateAzimuth()`（`viewDir.applyAxisAngle(anchor, -dx × k)` 再投影归一化），竖直分量走 `setTilt(tilt + dy × k)`。
- `focusSpherePoint(point, distance)`：见 §8.3（聚焦但不改轨道中心）。
- 入场 / 复位：`setHome(anchor, viewDir, tilt, distance)` 保存副本；`reset(distance?)` 有 `home` 就回到它，否则（库模式无 home）按 `distanceForCameraRadius(2R)` 回「+Z 正上方俯视」。编辑器的 `applyHome()` 用全部选择盒的质心归一化出 `anchor`，在切平面上取 `+Z` 投影作 `e1`、`e2 = n × e1`，量出图纸两个方向的延展后把 `viewDir` 设在垂直于长边的方向（长边因此横在屏幕水平方向），`distance = max(40, 0.5 × 外接圆直径 × 2.4)`、`HOME_TILT = 85°`。
- 编辑器侧参数：`planetRadius = PLANET_RADIUS`、`minDistance = 3`、`maxDistance = 1200`、`minHeight = 1.5`、`minTilt = 0`、`maxTilt = 85°`、`tilt = 85°`、`distance = 150`；库侧（`RenderCore`）换算成 `minDistance = 0.04R`、`maxDistance = 3R`（对应「相机到球心 1.04R ~ 4R」的旧 API 约束）。
- 库侧兼容面：`target` 恒为零向量（轨道中心始终是球心）、`targetRadius` 是 `planetRadius` 的存取别名、`getAzimuthalAngle()` / `getDistance()` 供外部读方位与视距。

### 8.6 lib 侧共用的 RenderCore

`src/lib/core/RenderCore.ts`（992 行）把「场景 / 相机 / renderer / controls / rAF 循环 / 重建 / dispose」收成一个不依赖 Vue 的内核，供 `BlueprintViewer` 使用。

- 构造：可注入 `createRenderer`（单测用 stub）、`createIconTexture`；`setKtx2Renderer(renderer)` 供 GLTFLoader 按 GPU 能力选 KTX2 转码目标；`Scene` + `createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT)` + `createSkyGradient`；`PerspectiveCamera(50)`（`near 0.5`、`far 3000`、`position.z = 2R`）；图标图集跨重建复用；`PlanetMapControls`（`minDistance 0.04R`、`maxDistance 3R`、`targetRadius R`、`listenToKeyEvents(keyboardTarget ?? container)`）；`ResizeObserver` 跟随容器；选中高亮 Mesh 池；拾取监听（`interactions.select` 默认 true、`interactions.contextRemove` 默认 false）；`onBuildingModelsChanged` → 150ms 去抖重建。
- 主题：`setTheme(name)` 解析三套色板并 `skyEnabled = (name === "editor")`；`setCustomTheme(patch)` 在当前色上覆盖；`applyTheme()` 立即改 `scene.background`、球体色、粗网格色，并切换天光层可见性。角标文字色只在下次重建生效（文字烘在 canvas 纹理里）。
- 原子重建 `rebuildScene(reason)`（`reason: "load" | "settings" | "data" | "models"`）：定位阶段（`findPosForAreas`）失败包成 `RenderPhaseError("position")`，构建阶段（`buildBuildings` / `buildBVH`）失败包成 `RenderPhaseError("build")`；只有全部成功才 `replaceBundle()`（挂新 bundle、移除并 `dispose()` 旧 bundle），失败保留旧场景并把错误抛给调用方。
- `setBlueprintData(data)`：失败回滚 `this.data`；成功后 `clearSelection()`（旧下标落到新蓝图上会指向另一栋建筑）。
- 设置生效路径：`showRealModels` / `maxInstancesPerModel` 变更 → 整场景重建；`texturesEnabled` → 只 `reapplyLoadedModelMaterials()`（材质是共享对象，原地重挂）；`previewAnimation` → 只切预览层的插值开关。
- 增量预览层（`src/lib/preview/`）：`beginPreview()` / `applyPreviewDelta()`（同步摄入、绝不抛错）/ `discardPreview()`，是独立于正式 `bundle` 的临时层，提交时仍走全量 `setBlueprintData`。
- 尺寸：`setSize(w, h)` 记住 `explicitSize`，之后的 `ResizeObserver` 与 `resize()` 都不再覆盖，直到 `clearExplicitSize()`（这是相对 v1 的有意改进：v1 的尺寸会被 `window.resize` 无条件覆盖）。
- 截图：`toDataURL()` / `toBlob()` 都先显式 `render()` 一次（`WebGLRenderer` 默认 `preserveDrawingBuffer: false`，在 rAF 之外直接读 canvas 会拿到空白图）。
- 销毁：撤销全局 `settingsProvider`、移除 DOM 监听、`cancelAnimationFrame`、清 `resizeObserver`、`controls.dispose()`、释放 bundle 与预览层、**先** `disposeKtx2Loader()` **再** `renderer.dispose()`、只释放自己创建的图标图集、释放选中池几何/材质、`sky.dispose()`、`planet.dispose()`、`scene.clear()`。

***

## 9. 命令系统与撤销/重做

命令层只有 `src/command.ts`（`EventDispatcher` / `Updater` / `Command` / `CommandQueue`）与 9 个具体命令类，没有独立的撤销栈管理器——栈就长在 `CommandQueue` 里。

### 9.1 流程与 CommandQueue

```text
用户操作（右键剔除 / 批量替换 / 侧栏面板改参数 …）
  → queue.push(new XxxCommand(...))
      1) commands.splice(currentPosition)      丢弃 redo 分支
      2) cmd.do(data, updater)                 改数据 + 派发 Updater 事件
      3) prev.merge(cmd) === true → 直接 return（不入栈、不递增任何版本号）
      4) commands.push(cmd); currentPosition++
      5) trim()                                超出 maxSize 从头部丢弃
      6) stateVersion++                        所有命令
      7) !cmd.silent → execVersion++           非 silent 才让 3D 层重建（§8.4）
```

- 容量：`private _maxSize = 256`，公开 `maxSize` getter/setter（setter 立即 `trim()`）。
- `stateVersion`（`ref(0)`）：**每次**命令（silent 与否）都 +1。用途是通知 `App.vue` 蓝图字符串过期（`codeExpired = true`），也让 `canUndo()/canRedo()` 建立响应式依赖。
- `execVersion`（`ref(0)`）：仅非 silent 命令 +1。用途是通知 `BlueprintEditor` 的 `computed` 整体重建 3D 场景。
- `trim()`：`n = min(commands.length - maxSize, currentPosition)`，`commands.splice(0, n)`、`currentPosition -= n`、`stateVersion++`；不递增 `execVersion`（丢弃历史命令不改变当前几何）。取 `min(溢出量, currentPosition)` 保证 redo 分支（`currentPosition` 之后）不会被裁掉。
- `undo()`：`canUndo()` 为假直接返回 `false`；否则 `cmd = commands[--currentPosition]`、`cmd.undo(...)`、`stateVersion++`、非 silent 再 `execVersion++`。`redo()` 完全对称（`cmd.do` + `currentPosition++`）。
- `Command` 接口：`do(data, updater)`、`undo(data, updater)`、`merge(c): boolean`、可选 `readonly silent?: boolean`（缺省等价 `false`）。
- `Updater`：5 条 `EventDispatcher`——`updateBuildingIcon`、`updateBeltIcon`、`updateBeltIconSubscript`、`updateSorterIcon`、`updateStationInfo`，外加 `clearAll()`（场景重建前清空回调）。`EventDispatcher` 本身提供 `on(cb)`、`onMounted(cb)`（借 Vue 的 `onMounted` / `onUnmounted` 自动注册与注销）、`dispatch(...args)`、`clear()`。
- 命令队列生命周期：`App.vue` 的 `commandQueue = computed(() => data.value === null ? null : new CommandQueue(data.value))`，所以**重新解析蓝图会整体换一个新队列**（历史一次性清空），并通过 `provide(commandQueueKey, commandQueue)` 注入给所有子组件。

### 9.2 命令清单

当前 `src/` 里可被 `CommandQueue` 接受的具体命令类共 **9** 个：7 个直接 `implements Command`（`ReplaceCommand`、`RemoveBuildingsCommand`、`SetAcceleratorCommand`、`SetBeaconContentCommand`、`UpgradeCommand`，以及 `StationInfo.vue` 内的 `SetStationStorageItemCommand`、`SetStationParamCommand`），另有 2 个继承 `RemoveBuildingsCommand` 的子类（`RemoveBuildingCommand`、`RemoveBuildingsByItemCommand`）。

| 命令 | 所在文件 | 职责 | 触发入口 |
| ---- | ---- | ---- | ---- |
| `ReplaceCommand` | `src/blueprint/replace.ts` | 5 个范围的批量替换：配方（`recipeId`）、分拣器筛选（`filterId`）、物流塔库存栏位（`storage[i].itemId`）、传送带图标（`parameters.iconId`）、蓝图图标（`header.icons[i]`）。构造时按 `ReplaceParams.scope` 收集命中项；`do` / `undo` 共用一个 `replace(recipeId, …)`，只是换「目标配方 / 搜索配方」 | `components/ReplaceModal.vue` 的「全部替换」 |
| `RemoveBuildingsCommand` | `src/blueprint/removeBuilding.ts` | 批量剔除。`do`：先记录幸存者指向被删建筑的 `outputObjIdx` / `inputObjIdx`（`dangling`），倒序 `splice`，再把 `index` 重排为数组位置、交叉引用指向被删者置 -1、指向其后建筑的前移。`undo`：按原位置插回原对象（参数与扩展字节原样恢复）、重排 `index`、恢复 `dangling` 与其余引用 | 间接（下列两个子类的基类） |
| `RemoveBuildingCommand` | 同上 | 单栋剔除（3D 视图右键） | `BlueprintEditor.vue` 的 `contextmenu` |
| `RemoveBuildingsByItemCommand` | 同上 | 剔除蓝图内全部同 `itemId` 的建筑 | `App.vue` 的 `removeBuildingsByItem`（侧栏列表图标右键） |
| `SetAcceleratorCommand` | `src/blueprint/setAccelerator.ts` | 一键设「生产加速 / 额外产出」：按 `buildingIndexes` 子集与 `labOnly`（2901 / 2902）过滤，只处理参数对象里带 `acceleratorMode` 的建筑；构造时快照每栋原模式，`undo` 逐栋恢复（混合模式场景撤销也不错乱） | `ReplaceModal.vue`（可带 `replaceCmd.recipeBuildings` 的下标子集） |
| `SetBeaconContentCommand` | `src/blueprint/setBeaconContent.ts` | 修改全息信标（2401）的 `content` 文本；空串归一为 `undefined`（导出即写 0 长度） | `components/HoloBeaconInfo.vue` 的 `commit()` |
| `UpgradeCommand` | `src/blueprint/upgrade.ts` | 建筑升降级：把所有 `itemId === fromItemId` 改成 `toItemId`，`modelIndex` 取目标物品的 `models[0]`；按类型分流图标刷新（带子→`updateBeltIcon`、分拣器→`updateSorterIcon`、其余→`updateBuildingIcon`）。配套导出 `upgradeEdges`（12 条边）、`upgradeableItems`（18 个 itemId）、`reachableTargets(fromId)`（升降级图上可达的全部目标） | `ReplaceModal.vue` 勾选「升降建筑等级」 |
| `SetStationStorageItemCommand` | `src/components/StationInfo.vue`（组件内 `class`） | 物流塔某库存栏位换物品：构造时快照 `itemId` / `localLogic` / `remoteLogic` / `max`，并按 `buildingInfo.adjacency[building.index][slot]` 收集该栏位物流口上挂的传送带；`do` 时非 0 物品强制重置为「本地供应 + 星际供应 + 上限 20000」，再写 `itemId` 并把这些传送带的 `parameters` 同步成该物品图标（`{ iconId: itemIconId(itemId), count: 0 }`），物品为空则置 `null`；`undo` 恢复旧物品与旧逻辑 / 上限 | `StationInfo.vue` 的 `setItemId()` |
| `SetStationParamCommand` | 同上（组件内 `class`） | 通用物流塔参数修改：构造时传入一对 `applyFn(p)` / `revertFn(p)` 闭包，`do` / `undo` 各自调用并派发 `updateStationInfo`。`setParam` / `setMiningSpeed` / `setStorageMax` / `setStorageLogic` 都经它下发 | `StationInfo.vue` 的 `pushParam()` |

`silent` 与 `merge` 策略（`silent` 缺省等价 `false`，即会递增 `execVersion`）：

| 命令 | `silent` | 是否触发 `execVersion++`（3D 重建） | `merge()` 策略 |
| ---- | ---- | ---- | ---- |
| `ReplaceCommand` | `true` | 否 | 恒 `false`（不合并） |
| `RemoveBuildingsCommand` | 未声明 → `false` | 是 | 恒 `false` |
| `RemoveBuildingCommand`（继承） | 未声明 → `false` | 是 | 恒 `false`（继承基类实现） |
| `RemoveBuildingsByItemCommand`（继承） | 未声明 → `false` | 是 | 恒 `false`（继承基类实现） |
| `SetAcceleratorCommand` | `true` | 否 | 恒 `false` |
| `SetBeaconContentCommand` | `true` | 否 | **唯一实现合并的命令**：同类且 `c.building === this.building` 时把 `this.newContent` 换成新命令的值并返回 `true`（`push` 随后早退，不入栈、不递增版本号） |
| `UpgradeCommand` | 未声明 → `false` | 是 | 恒 `false` |
| `SetStationStorageItemCommand` | `true` | 否 | 恒 `false` |
| `SetStationParamCommand` | `true` | 否 | 恒 `false` |

### 9.3 快捷键

撤销 / 重做与侧栏开关在 `App.vue` 的 `hotkey`（挂在 `document.body` 的 `keydown`）：

| 按键 | 行为 | 备注 |
| ---- | ---- | ---- |
| `Ctrl+Z` | `commandQueue.undo()` | 先判定 `event.isComposing` 直接返回；Ctrl 分支早于输入框守卫，所以在输入框里也能撤销 |
| `Ctrl+Shift+Z` | `commandQueue.redo()` | 同上分支 |
| `Ctrl+Y` | `commandQueue.redo()` | 要求 `!event.shiftKey` |
| `Ctrl+Alt+…` / `Alt+…` / `Meta+…` | 不处理 | `ctrlKey && !altKey` 才进 Ctrl 分支，随后 `altKey || metaKey` 直接返回 |
| `O` 或 `0`（`Digit0`） | 切换侧栏展开；展开时把 `activeTab` 切到 `info` | `pinned` 固定态不响应；焦点在 `INPUT` / `TEXTAREA` / `SELECT` / `contentEditable` 时不触发 |

相机键位在 `PlanetMapControls`（只挂在编辑器根 div 上，需要该 div 有焦点）：

| 按键 | 行为 | 备注 |
| ---- | ---- | ---- |
| `N` | `reset()` 回入场姿态 | 等同于 `applyHome()` 的结果（`home` 由它设置） |
| `W` / `S` / `A` / `D` | 平移（视野上 / 下 / 左 / 右） | `keyPanSpeed = 240` CSS px/s，与左键拖拽共用像素→世界换算 |

撤销 / 重做也可以直接用侧栏「操作」页的两个按钮（`@click="commandQueue!.undo()"` 与 `@click="commandQueue!.redo()"`，`:disabled` 分别取 `!commandQueue.canUndo()` / `!commandQueue.canRedo()`），`canUndo()` / `canRedo()` 内部读 `stateVersion` 建立响应式依赖。

### 9.4 已知缺口与易踩的坑

- **`merge` 命中即早退**：`push()` 在 `prev.merge(c)` 返回 `true` 时直接 `return`，既不 push 也不递增 `stateVersion` / `execVersion`。因此连续编辑同一栋信标的文本时，第二次及以后不会把 `codeExpired` 置真（`App.vue` 监听的是 `stateVersion`）；`SetBeaconContentCommand` 是当前唯一实现了 merge 的命令。
- **`updateBeltIconSubscript` 没有派发点**：通道已定义、`clearAll()` 也会清它，但 `src/` 中没有任何 `updater.updateBeltIconSubscript.dispatch(...)` 调用。传送带 `count` 变化目前只能靠非 silent 命令的整场景重建来体现。
- **`trim()` 不递增 `execVersion`**：容量回收只影响历史命令，不影响当前几何，因此不需要重建；但依赖 `stateVersion` 的「蓝图字符串过期」会被顺带触发。
- **`RemoveBuildingsCommand.undo` 的映射前提**：幸存者的 `index` 按「恢复后数组顺序」重排，`dangling` 保存的是被删建筑的原 index；撤销后再 `do()` 会重新采集 `dangling`，可安全往返，但不要在撤销后手工改 `index`。
- **`StationInfo` 两个命令用闭包保存旧值**：`applyFn` / `revertFn` 捕获的是命令构造那一刻的字段值，中间若有其它途径改了同一字段，undo 会覆盖成构造时的值（刻意语义，不是 bug）。
- **`UpgradeCommand` 不校验边**：它只要求目标物品存在且有 `models[0]`，任意 itemId 对都能构造；真正的「边」约束在 `upgradeEdges` / `reachableTargets` 与 UI 侧。
- **`ReplaceCommand` 构造期就会抛错**：`searchRecipe` 不在 `recipesMap` 中抛 `Unknown search recipe`，`do` 时 `replaceRecipe` 不存在抛 `Unknown recipe` —— UI 需要先校验再 push。
- **`ReplaceCommand` 的物流塔栏位下标**：`stationStorage` 收集时用的是 `storage.filter(...).map((s, i) => …)` 里的下标，也就是「过滤后数组下标」而不是原始 `storage` 下标；只有命中项恰好占据前 k 个槽位时两者才相等，否则替换会写到错误的库存栏位（疑似缺陷，本次仅记录未修复）。
- **静默命令的局部刷新依赖场景已构建**：`icons.hasIcon(b)` / `subscriptMap.get(b)` 查不到就静默跳过（例如 `noIconBuildings` 或从未渲染过的建筑），所以 silent 命令本身不会补建缺失的图标槽位。

***

## 10. 数据与资源模块

`src/data/` 有三种角色：**运行时查表**（图标 ID → URL、建筑元数据、物品/配方/科技/信号/MIDI 表）、**资源清单**（`src/assets/icons/` 下的 PNG 与 GLB 由谁解析成 URL）、**离线标定表**（GLB 放置变换）。只有 `building.ts` 依赖 `three`（用 `Color` / `Matrix4` 预算变换矩阵），其余模块都是纯数据或纯函数，Node 环境（CLI、Jest）可直接导入。

### 10.1 图标 ID 体系（`data/icons.ts`）

整个项目用一个整数编码所有图标：低段是信号 ID，中段是物品 ID，配方与科技压到高段偏移。

| 区间 | 含义 | `iconUrl()` 的分支 | 源文件（`src/assets/icons/`） |
| ---- | ---- | ---- | ---- |
| `< 1000` | 信号 | `signalIconUrl(id)` | `signal/signal-{id}.png` |
| `< 20000` | 物品 | `itemRecipeIconUrl(itemsMap.get(id).icon)` | `item_recipe/{icon}.png` |
| `< 40000` | 配方（`recipeId + 20000`） | `itemRecipeIconUrl(recipesMap.get(id - 20000).icon)` | `item_recipe/{recipe.icon}.png` |
| `< 60000` | 科技（`techId + 40000`） | `techIconUrl(id - 40000)` | `tech/{techId}.png` |
| `>= 60000` | — | 抛 `Error('Unknown icon …')` | — |

模块导出：

| 导出 | 形态 | 行为 |
| ---- | ---- | ---- |
| `signalIconId(signalId)` | `(number) => number` | 恒等（信号不偏移） |
| `itemIconId(itemId)` | `(number) => number` | 恒等（物品不偏移） |
| `recipeIconId(recipeId)` | `(number) => number` | 配方自带 `icon` 时返回 `recipeId + 20000`；否则退化成产物的 `itemIconId(recipe.to[0].item.id)` |
| `techIconId(techId)` | `(number) => number` | `techId + 40000` |
| `iconUrl(iconId)` | `(number) => Promise<string>` | 按上表分流；配方分支带非空断言 `recipesMap.get(...)!.icon!` |
| `itemRecipeIconUrl(name)` / `techIconUrl(techId)` / `signalIconUrl(signalId)` | `async` | 全部委托 `assetResolver`（`@lib/asset-resolver`），自身不含 URL 拼接逻辑 |
| `allIconIds()` | `generator<number>` | 物品 → 自带独立图标的配方 → 信号 → 科技，用于图标图集预热 |

URL 由两套 `assetResolver` 实现生成，选择发生在构建层（`vue.config.js` 的 `resolve.alias`）：

| 实现 | 用于 | 取 URL 的方式 | 图标不存在时 |
| ---- | ---- | ---- | ---- |
| `src/lib/assets/assetResolver.webpack.ts` | 编辑器 / PWA 构建 | `eager` 模板字符串 `import()` 三张图，URL 由 `publicPath` 决定 | 打包期即报模块解析失败 |
| `src/lib/assets/assetResolver.ts` | UMD / ESM 库构建、单测 | `assetBaseUrl` 拼字符串 + 构建期注入的清单（`__DSP_LIB_ASSET_INVENTORY__`） | **直接 reject，不发请求**（避免 404） |

产物侧的目录规则由 `vue.config.js` 的 asset 规则决定：`item_recipe` 显式配了 `generator.filename = img/item_recipe/[name].[contenthash:8][ext]`；`signal` / `tech` 只声明 `type: 'asset/resource'`（文件名与落盘目录交给 webpack 默认规则）；库构建（runtime 实现）则统一按 `img/<category>/<源文件名>` 拼（`iconOutputPath()` 把清单键 `icons/…` 换成 `img/…`）。

`allIconIds()` 当前产出 **550** 个 ID（物品 174 + 自带独立图标的配方 14 + 信号 40 + 科技 322），小于图标图集容量 24×24 = 576 格（`src/iconTexture.ts` 的 `WIDTH`/`HEIGHT`，单格 `ICON_SIZE = 80`）；槽位 0 留给「空图标」。

### 10.2 建筑元数据（`data/building.ts`）

`BuildingMeta` 是渲染与拾取共用的唯一元数据来源，六个字段全部由一张手写表派生：

| 字段 | 类型 | 含义 |
| ---- | ---- | ---- |
| `color` | `Color` | 元数据盒颜色；表中 `null` 表示默认灰 `0xdddddd` |
| `unitBoxTrans` | `Matrix4` | **渲染盒**：选中框可视化用，缩放 `0.9 / 0.999 / 0.9` |
| `selectUnitBoxTrans` | `Matrix4` | **拾取盒**：原尺寸，BVH 用 |
| `iconTrans` | `Matrix4` | 图标面片的位置与尺寸（缩放 `2 × 2 × 1`） |
| `boxSize` | `readonly [number, number, number]` | 局部 **z 轴向上**坐标系的尺寸 `[宽, 深, 高]` |
| `boxCenter` | `readonly [number, number, number]` | 局部 z-up 坐标系的中心 `[x, y, z]` |

原始表 `buildingMetaRaw` 共 **62 行**，行格式为 `[modelIndex, { color, box, offset }]`：

| 字段 | 类型 | 单位/约定 |
| ---- | ---- | ---- |
| `box` | `[number, number, number]` | 来自游戏 `SlotConfig.selectSize`；**当前代码约定 `box[1]` 是高度** |
| `offset` | `[number, number, number]` | 来自 `SlotConfig.selectCenter`，选盒中心相对建筑原点的偏移 |

模块加载时按固定公式派生（`for (const [id, d] of buildingMetaRaw)`）：

| 派生量 | 计算式 |
| ---- | ---- |
| `unitBoxTrans` | `Rx(π/2) · T(offset[0], offset[1], -offset[2]) · S(box[0]×0.9, box[1]×0.999, box[2]×0.9)` |
| `selectUnitBoxTrans` | 同上平移与 `Rx(π/2)`，缩放改用原尺寸 `S(box[0], box[1], box[2])` |
| `iconHeight` | `box[1] < 4.0 ? box[1] / 2.0 : box[1] - 2.0` |
| `iconTrans` | `T(offset[0], offset[2], iconHeight) · S(2, 2, 1)` |
| `boxSize` | `[box[0], box[2], box[1]]`（把 y-up 表值重排成 z-up） |
| `boxCenter` | `[offset[0], offset[2], offset[1]]`（同上） |

另外两个导出：

| 导出 | 内容 | 实际使用 |
| ---- | ---- | ---- |
| `noIconBuildings` | 6 个 **itemId**：2020 四向分流器、2040 自动集装机、2030 流速监测器、2313 喷涂机、2201 电力感应塔、2202 无线输电塔 | `src/lib/core/buildBuildings.ts` 过滤图标面片；`src/icons.ts` 的 `updateIconId()` 对没有图标实例的建筑静默跳过（注释点名 `noIconBuildings`） |
| `stationSlotTrans` | 12 个 `Matrix4` 平移（`o1 = 1.256`、`o2 = 2.7` 的正十二边形环） | **当前 `src/` 内没有任何引用**（物流塔槽位的绘制已不走这张表） |

消费方：`src/lib/core/buildBuildings.ts`（`unitBoxTrans` 渲染盒 + `selectUnitBoxTrans` 锚点）、`src/lib/core/buildBVH.ts`（`selectUnitBoxTrans` 拼拾取盒）、`src/lib/core/iconHelpers.ts`（`iconTrans` 定图标面片）、`src/lib/core/describeBuild.ts`（只用 `buildingMeta.has()` 判定未知模型）、`src/lib/preview/pools.ts`（`unitBoxTrans`）、`src/models/buildingModel.ts`（`boxSize` / `boxCenter` 做 GLB 对齐）。

### 10.3 静态数据表与汇总导出

| 文件 | 主要导出 | 规模 | 关键字段 |
| ---- | ---- | ---- | ---- |
| `itemsData.ts` | `items: Item[]` | 174 条 | `id`、`models`（模型号数组）、`grid: [page, row, column]`、`name`（中文键）、`icon`、`productive?` |
| `items.ts` | `itemsMap: Map<number, Item>` + 分类判定函数 | 174 键 | 见 10.6 |
| `recipesData.ts` | `recipes: Recipe[]` | 162 条 | `id`、`name`、`time`（1/60 秒）、`from`/`to: ItemStack[]`、`grid`、`icon?`（仅 14 条有）、`nonProductive?` |
| `recipes.ts` | `recipesMap: Map<number, Recipe>` | 162 键 | — |
| `signalIconsData.ts` | `signal: Signal[]` | 40 条 | `id`（401…802）、`gridPos: [row, column]` |
| `techIconsData.ts` | `tech: Tech[]` | 322 条 | `id`（1…6106，仅 `Published` 的科技） |
| `midi.ts` | `midi: readonly MIDI[]`、`midiMap` | 24 条 | `id`、`isInstrument`、`pitchRange` |
| `color.ts` | `colorPalette256: readonly string[]` | 256 条 | `#RRGGBB` / `#RRGGBBAA` 十六进制串（地基调色板，供 `ColorPreview.vue`） |
| `acceleratorData.ts` | `AcceleratorItem` 枚举、`acceleratorBonuses` | 4 档 | `extraOutput`、`accelerate`、`power`、`sprayCapacity`；Mk.I `0.125/0.25/0.3/12`、Mk.II `0.2/0.5/0.7/24`、Mk.III `0.25/1.0/1.5/75` |
| `buildingPowerData.ts` | `buildingPowerData: BuildingPowerData[]`、`buildingPowerMap` | 27 条 | `itemId`、`basePower`（kW）、`speedMultiplier`、`canAccelerate` |
| `types.ts` | `Item`、`ItemStack`、`Recipe`、`Tech`、`Signal`、`MIDI` | — | 纯接口定义，无运行时代码 |

`data/index.ts` 的汇总导出很克制，只有三行：

```ts
export * from "./types";
export { itemsMap } from "./items";
export { recipesMap } from "./recipes";
```

其它表必须按具体路径导入（例如 `@/data/recipesData`、`@/data/building`、`@/data/modelTransform`）。`items` / `recipes` 原始数组的常见消费方是选择器组件（`ItemSelect.vue`、`RecipeSelect.vue`）；`signal` / `tech` 除了被 `data/icons.ts` 的 `allIconIds()` 遍历（图集预热），只有 `IconPickerModal.vue` 直接导入用于图标挑选。

### 10.4 图标与模型素材

| 目录 | 文件数 | 说明 |
| ---- | ---- | ---- |
| `src/assets/icons/item_recipe/` | 192 个 `.png` | 物品与配方图标，按 `icon` 名去重存放。`itemsData` 的 174 个 `icon` 与 `recipesData` 的 14 个 `icon` 合计 **188** 个不同名字，全部能在磁盘找到；另有 4 个未被引用的历史图：`capsule-deuteron`、`soil-pile`、`turret-jammer`、`warship-shield` |
| `src/assets/icons/signal/` | 41 个 `.png` | `signal-{id}.png`，40 个对应 `signalIconsData` 的 ID，`signal-0.png` 是「空图标」占位 |
| `src/assets/icons/tech/` | 323 个 `.png` | `{techId}.png`，322 个对应 `techIconsData`，`0.png` 是空图标占位 |
| `src/assets/icons/models/` | 73 个 `.glb`，合计约 128 MB | 建筑模型，**平铺**在目录里（`assetResolver.webpack.ts` 用 `require.context(..., false, /\.glb$/i)` 非递归扫描，放子目录会被漏掉） |

模型贴图（法线 / 自发光 / spec）已全部内嵌进 GLB 并统一转 KTX2，因此 `src/models/textureManifest.ts` 是**空清单**（`materialTextureFiles`、`materialMapUrls`、`manifestTextureFiles` 全为空），历史映射数据保留在 `tests/unit/scripts/texture-mapping.json`。

### 10.5 数据生成管线（`data/gen.sh` + `gen_*.py`）

数据表不是手写的，而是从游戏资源（AssetStudio 导出的 MonoBehaviour JSON）离线生成的。`src/data/` 下现存 7 个 Python 脚本：

| 脚本 | 输入 | 输出 | 关键处理 |
| ---- | ---- | ---- | ---- |
| `gen_items.py` | `ItemProtoSet.json` 的 `dataArray` | `itemsData.ts` | `IconPath` 取末段作 `icon`；`ModelIndex/ModelCount` 展开成 `models`；`GridIndex` 拆成 `[//1000, (//100)%10, %100]`；`GridIndex == 0` 的物品跳过；`Productive` 写成 `productive: true` |
| `gen_recipes.py` | `RecipeProtoSet.json` 的 `dataArray` | `recipesData.ts` | `Items/ItemCounts` → `from`、`Results/ResultCounts` → `to`（都经 `itemsMap.get()`）；`IconPath` 非空才写 `icon`；`NonProductive` 写成 `nonProductive: true` |
| `gen_midi.py` | `MIDIProtoSet.json` 的 `dataArray` | `midi.ts` | 输出 `midi` 数组与 `midiMap` |
| `gen_signal_icons.py` | `SignalProtoSet.json` 的 `dataArray` | `signalIconsData.ts` | `GridIndex - 1101` 反算 `(page, row, column)`，断言 `page == 2` |
| `gen_tech_icons.py` | `TechProtoSet.json` 的 `dataArray` | `techIconsData.ts` | 只保留 `Published` 的科技 ID |
| `gen_color_palette.py` | 从 stdin 读 `colorPalette256` 字段 | `color.ts` | `r/g/b` 乘 255 转两位十六进制，`a != 1.0` 时追加 alpha |
| `i18n.py` | `mono_behaviour` 目录（`ItemProtoSet.json`、`RecipeProtoSet.json`）+ 游戏 `Locale` 目录 + `-o` 输出目录 | `../locales/zh.json`、`../locales/en.json` | 必需键 = 物品（`GridIndex != 0`）+ 配方名，并入已有 `zh.json` 的额外键；从 `Locale/2052`、`Locale/1033` 的 UTF-16LE `*.txt`（4 列制表符分隔）取第 4 列 |

`gen.sh` 只串起 5 个数据脚本加 i18n：

```bash
#!/bin/bash

BASE='/path/to/AS_exports'

python3 gen_items.py < $BASE/MonoBehaviour/ItemProtoSet.json > itemsData.ts
python3 gen_midi.py < $BASE/MonoBehaviour/MIDIProtoSet.json > midi.ts
python3 gen_recipes.py < $BASE/MonoBehaviour/RecipeProtoSet.json > recipesData.ts
python3 gen_signal_icons.py < $BASE/MonoBehaviour/SignalProtoSet.json > signalIconsData.ts
python3 gen_tech_icons.py < $BASE/MonoBehaviour/TechProtoSet.json > techIconsData.ts

find $BASE/Texture2D -regex '.*/[0-9]+.png' | xargs cp -t ../assets/icons/tech/
find $BASE/Texture2D -regex '.*/signal-[0-9]+.png' | xargs cp -t ../assets/icons/signal/
cp $BASE/itemrecipe/*.png ../assets/icons/item_recipe/

python3 i18n.py $BASE/MonoBehaviour "$GAME_BASE/Locale" -o ../locales
```

要点与限制：

- **`gen_color_palette.py` 没有被 `gen.sh` 调用**，需要单独手工执行；它的输入文件名在仓库里没有记录。
- 脚本只从 stdin 读、往 stdout 写，重定向在 `gen.sh` 里完成；`i18n.py` 是唯一直接写文件的脚本（`-o` 目录）。
- 仓库**不含** `AS_exports` 源数据，`BASE` 是占位路径，所以这条管线目前不可原地复现；产物（`itemsData.ts` 等）已提交进仓库。
- 贴图是从导出目录「按文件名正则」拷贝的：科技图靠纯数字文件名、信号图靠 `signal-数字` 前缀、物品/配方图靠 `itemrecipe/` 子目录。命名规则一旦变化，`cp` 会静默漏文件（不报错），只能靠 `allIconIds()` 侧的使用暴露。

> ⚠️ 待确认：`colorPalette256` 由哪个游戏 ProtoSet（导出文件）生成；`gen_color_palette.py` 未进 `gen.sh`，也就没有记录输入文件名与 `gen_color_palette.py > color.ts` 的完整命令。

### 10.6 物品分类判定（`data/items.ts`）

`itemsMap` 由 `itemsData` 建表；同文件导出 17 个 `isXxx(id: number)` 判定函数与 `allAssemblers`：

| 函数 | 命中 itemId | 函数 | 命中 itemId |
| ---- | ---- | ---- | ---- |
| `isBelt` | 2001–2003 | `isEjector` | 2311 |
| `isInserter` | 2011–2014 | `isRayReciver` | 2208 |
| `isStation` | 2103、2104、2316 | `isArtificialStar` | 2210 |
| `isInterstellarStation` | 2104 | `isEnergyExchanger` | 2209 |
| `isSplitter` | 2020 | `isAdvancedMiningMachine` | 2316 |
| `isLab` | 2901、2902 | `isMonitor` | 2030 |
| `isStorage` | 2101、2102、3009 | `isBattleBase` | 3009 |
| `isTank` | 2106 | `isDispenser` | 2107 |
| `isHoloBeacon` | 2401 | — | — |

`allAssemblers` 是 13 个 itemId 的 `Set`：制造台 2303/2304/2305/2318、熔炉 2302/2315/2319、原油精炼厂 2308、化工厂 2309/2317、对撞机 2310、研究站 2901/2902。

用途：

- `isXxx` 是 `src/components/BuildingInfoPanel.vue` 的分支依据——决定右侧参数面板渲染哪个子组件/字段块（`SplitterInfo`、`StationInfo`、`MonitorInfo`、`BattleBaseInfo`、`StorageInfo`、`DispenserInfo`、`HoloBeaconInfo` 等）。
- `isBelt` / `isInserter` 同时被渲染层使用：`src/lib/core/buildBuildings.ts`、`buildBVH.ts`、`describeBuild.ts`、`src/lib/preview/PreviewLayer.ts`、`src/blueprint/replace.ts`、`src/blueprint/upgrade.ts`。
- `allAssemblers` 在 `src/blueprint/parser.ts` 里被遍历，为集合内每个 itemId 注册 `assembleParamParser`（配方/生产参数解析）。

有几处 ID 重叠是**照抄游戏分类的结果，不要“修正”**：`isStorage(3009)` 与 `isBattleBase(3009)` 同值，`isStation(2316)` 与 `isAdvancedMiningMachine(2316)` 同值。

### 10.7 逐模型变换表（`data/modelTransform.ts`）

给真实 GLB 模型做「偏移 + 旋转 + 缩放 + 着色」的标定表，与 `buildingMeta` **同键**（modelIndex）、**同为 62 行**，一行一个建筑模型。

`ModelTransform` 接口：7 个必填数值 + 3 个可选字段。

| 字段 | 单位 | 说明 |
| ---- | ---- | ---- |
| `x` / `y` | 格 | 水平偏移，`+x` 向右、`+y` 向前；渲染时 × `GRID_HORIZONTAL`（`2π / 200 / 5 × 200.2 ≈ 1.2579` 世界单位） |
| `z` | 格 | 上下偏移，`+z` 向上（负数下沉）；渲染时 × `HEIGHT_GRID_SIZE`（`4/3`） |
| `pitch` | 度 | 俯仰，绕 X 轴 |
| `yaw` | 度 | 水平旋转，绕 Z 轴（竖直轴） |
| `roll` | 度 | 侧倾，绕 Y 轴 |
| `scale` | 倍率 | 等比缩放，默认 1，必须 > 0 |
| `color?` | `0xRRGGBB` | 只乘到 GLB 材质上（`tint`），**不影响**元数据盒；缺省不着色 |
| `upAxis?` | `'y'` \| `'z'` | GLB 的「上」轴，默认 `'y'`（glTF 标准） |
| `align?` | `'height'` \| `'none'` | 默认按元数据盒高度等比缩放；`'none'` 保持原始比例 |

- `ZERO_MODEL_TRANSFORM`：冻结的全 0 变换（`scale: 1`），未登记的 modelIndex 一律用它，行为与「未接入本表」完全一致。
- `modelTransformOf(modelIndex)`：查表，未登记返回 `ZERO_MODEL_TRANSFORM`，**不抛错**。
- 表内实际带 `color` 的行 **8 条**：制造台 Mk.I/II/III/IV（65/66/67/456）、电弧熔炉/位面熔炉/熔炉 Mk.III（62/194/457）、矩阵研究站 Mk.II（455）。源码文件头的注释只提到「制造台 4 个 + 熔炉 3 个」，落后于表内容。

应用顺序（`src/models/buildingModel.ts` 的 `buildModelPlacement`）：

1. `upAxis === 'y'` 时先绕 X 轴 +90°，把 glTF 的 +y 映射到建筑的 +z。
2. 缩放：`t.scale` × `clamp(元数据盒高 / 模型原始高, 1/3, 3)`（仅 `align === 'height'`）。
3. 旋转：`Roll(绕 Y) → Pitch(绕 X) → Yaw(绕 Z)`，度转弧度。
4. 平移：把变换后的包围盒心对到「元数据盒心 + 格单位偏移」。因为偏移写在最后一步的平移量里，**偏移不受旋转影响**（`z: -10` 就是永远往下 10 格）。

本表**只作用于加载成功的 GLB**：`buildModelPlacement` 仅在模型已加载时被调用，GLB 缺失/加载失败时走元数据盒回退，与不接本表时完全一致。表里同时要求「每一行的建筑都必须有真实 `.glb` 对应」，这条约束由单测守着（见 12.2 的 `modelTransform.spec.ts`）。

***

## 11. 国际化

国际化只有一层薄封装：全局文案放在 `src/locales/{zh,en}.json`，`src/i18n.ts` 建 `vue-i18n` 实例并暴露「语言选择」与「名称查询」，界面上的零散文案另用 SFC 的 `<i18n>` 块就地声明。

### 11.1 机制与构建配置（`i18n.ts`）

```ts
const i18n = createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: [...navigator.languages, "en"],
    messages: { zh, en },
});
```

- `legacy: false`：Composition API 模式，组件里用 `useI18n()` 取 `t`。
- `locale` 初值写死 `'en'`；真正的语言由 `useLang()` 的 `watchEffect` 覆盖。
- `fallbackLocale` 是「浏览器的语言列表 + `en`」——浏览器首选语言不在 `messages` 里时，vue-i18n 自动退到下一个候选，最终落到 `en`。

`useLang()`：

```ts
export function useLang() {
    const lang: Ref<"auto" | typeof i18n.global.locale.value> = ref("auto");

    watchEffect(() => {
        const locale = i18n.global.locale;
        if (lang.value === "auto") {
            locale.value = navigator.language as any;
        } else {
            locale.value = lang.value;
        }
    });

    return lang;
}
```

| 行为 | 实现 | 说明 |
| ---- | ---- | ---- |
| 三态选择 | `ref("auto")`，可写 `'auto' / 'en' / 'zh'` | 初值恒为 `'auto'` |
| `auto` 的语义 | `navigator.language` 原样写入 `i18n.global.locale` | 不做语言码裁剪，区域码（如 `zh-CN`）本身没有对应消息，按 `fallbackLocale` 链回退：先依次试 `navigator.languages` 的其它候选，最后落到 `en`。浏览器列表里含 `zh` 时中文仍会生效，只给 `zh-CN` + `en` 时会显示英文 |
| 持久化 | **没有** | 语言状态只在内存里，刷新页面回到 `'auto'`；`src/` 中唯一的 `localStorage` 用法在 `swStatus.vue`（更新弹窗的「忽略」时间戳），与语言无关 |

唯一的调用方是 `App.vue`（`const lang = useLang();`），模板里挂一个原生 `<select>`：

```html
<select id="select-language" v-model="lang">
    <option value="auto">{{ t("自动选择语言") }}</option>
    <option value="en">English</option>
    <option value="zh">中文</option>
</select>
```

构建期配置（`vue.config.js` 的 `pluginOptions.i18n`）：

| 选项 | 值 | 作用 |
| ---- | ---- | ---- |
| `localeDir` | `'locales'` | 全局 locale 文件目录（相对 `src/`），即 `src/locales/*.json` |
| `enableLegacy` | `false` | 关闭 Legacy API（与 `i18n.ts` 的 `legacy: false` 一致） |
| `runtimeOnly` | `true` | 只打包运行时（不含模板编译器），SFC 里的 `<i18n>` 块在构建期预编译 |
| `compositionOnly` | `true` | 只支持 Composition API |
| `fullInstall` | `true` | 全局安装完整 `vue-i18n` 实例（供 `useI18n()` 在任意组件里使用） |

依赖：运行时 `vue-i18n ^9.1.0`；开发期 `vue-cli-plugin-i18n ~2.3.2`、`@intlify/vue-i18n-loader ^4.2.0`、`vue-i18n-extract 1.2.3`。维护脚本：

```bash
yarn i18n:report   # vue-cli-service i18n:report --src "./src/**/*.?(js|vue)" --locales "./src/locales/**/*.json"
```

### 11.2 locale 文件结构

`src/locales/zh.json`、`src/locales/en.json` 都是**单层扁平**的 JSON：**键是中文原文，值是该语言的译文**，没有嵌套命名空间。

| 文件 | 大小 | 行数 | 顶层键数 | 值互不相同的键数 |
| ---- | ---- | ---- | ---- | ---- |
| `zh.json` | 12 131 B | 314 | 312 | 310 |
| `en.json` | 12 605 B | 314 | 312 | 308 |

```json
{
    "X射线裂解": "X-ray Cracking",
    "临界光子": "Critical Photon",
    "低速传送带": "Conveyor Belt MK.I"
}
```

（上面三条都取自 `en.json` 的实际内容；同三个键在 `zh.json` 里的值分别是 `"X射线裂解"`、`"临界光子"`、`"传送带"`——中文值并不总等于键，例如 Mk.I 传送带在中文里就叫「传送带」。）

键的来源（由 `src/data/i18n.py` 决定）：194 个「物品名 / 配方名」中 187 个进了 locale，其余 125 个键是手工补充的业务文案——187 + 125 = 312。

| 类别 | 数量 | 说明 |
| ---- | ---- | ---- |
| 物品名 / 配方名 | 194 个不同名字（`itemsData` 174 + `recipesData` 162，两者大量重名） | `i18n.py` 生成时必选：物品取 `ItemProtoSet` 中 `GridIndex != 0` 的 `Name`，配方取 `RecipeProtoSet` 全部 `Name` |
| 其中实际落在 locale 里的 | 187 | 剩下 7 个物品/配方名**没有译文**：攻击无人机、黑雾矩阵、黑雾引力透镜、护卫舰、精准无人机、驱逐舰、原型机 |
| 手工补充键 | 125 | 建筑参数、面板标签、音乐音色、警报文案等；第一次生成后手工补进 `zh.json`，`i18n.py` 每次运行会把它们当「额外键」打印并保留 |

两份文件的键集合**完全一致**（没有只存在于一方的键），因此缺键不会造成 zh/en 结构漂移。

SFC 局部文案：`App.vue` 用一个 `<i18n>` 块声明 **55 个键**的 zh/en 文案，覆盖工具栏、文件操作、渲染设置、离线模型包等界面文案。这 55 个键里只有 `玻璃` 与全局 locale 重名，其余 54 个只存在于此块内。

覆盖缺口（重算结果）：`src/` 中字面量 `t("…")` 调用共 204 处、186 个不同键；其中 **78 个键不在 `locales/*.json`**。这 78 个当中 41 个由 `App.vue` 的局部块兜住，剩下 **37 个键既不在一份 locale、也不在局部块**里（因为 `en.json` 的键集与 `zh.json` 相同，切到英文后这些位置仍显示中文原文）：

| 文件 | 缺失键数 | 键 |
| ---- | ---- | ---- |
| `ReplaceModal.vue` | 16 | 不改变、传送带图标、范围：、分拣器筛选、蓝图图标、目标建筑：、配方、请选择源建筑、全部替换、升降建筑等级、生产加速、生产模式：、搜索：、替换：、物流塔栏位、源建筑： |
| `ProductionStats.vue` | 10 | 备注、备注说明、产出/分、净产出/分、生产统计、物品、消耗/分、暂无生产数据、增产剂：、总电力需求： |
| `IconPickerModal.vue` | 4 | 科技、清除图标、信号、选择图标 |
| `HoloBeaconInfo.vue` | 3 | 保存、信标文本、信标文本提示 |
| `BuildingInfoPanel.vue` | 2 | 模式、送入轨道 |
| `App.vue` | 1 | 可选：下载模型到本地 |
| `BuildingOverview.vue` | 1 | 共{total}个（vue-i18n 插值语法，缺键时原样输出） |

### 11.3 名称查询

`src/i18n.ts` 只导出两个查名函数，都是「先查数据表拿到中文键，再用全局 `t()` 翻译」：

```ts
export function itemName(id: number) {
    const item = itemsMap.get(id);
    return item ? i18n.global.t(item.name) : "unknown";
}

export function recipeName(id: number) {
    const r = recipesMap.get(id);
    return r ? i18n.global.t(r.name) : "unknown";
}
```

| 行为 | 说明 |
| ---- | ---- |
| 查不到 ID | 返回字面量 `"unknown"`（不是空串，也不会抛错） |
| 查得到时 | `itemsData` / `recipesData` 的 `name` 是中文键，命中 locale 即得译文；缺键时 vue-i18n 原样回显键（中文原文） |
| 调用点 | `itemName`：`BuildingOverview.vue`、`ItemSelect.vue`、`ProductionStats.vue`（含按名称 `localeCompare` 排序）、`ReplaceModal.vue`、`IconPickerModal.vue`（按图标 ID 区间分流到 `itemName` / `recipeName`）；`recipeName`：`RecipeSelect.vue`、`IconPickerModal.vue` |
| 与图标的关系 | 名称查询只负责文本，图标走 `data/icons.ts` 的 `iconUrl(iconId)`；`IconPickerModal.vue` 用同一套区间规则（`< 20000` 走物品、`< 40000` 走配方）决定该翻译哪个名字 |

***

## 12. 测试体系

测试只有一层：`tests/unit/` 下的 Jest 单元测试，**26 个 `*.spec.ts`**。没有 e2e、没有覆盖率阈值、CI 也不跑测试（`.github/workflows/gh-pages.yml` 只有 `yarn install` + `yarn build`）。

### 12.1 配置

`jest.config.js`（25 行，除 `globals` 外全部是常量）：

| 项 | 内容 |
| ---- | ---- |
| `moduleFileExtensions` | `["js", "ts", "json", "vue"]` |
| `transform` | `^.+\\.jsx?$` → `babel-jest`；`^.+\\.tsx?$` → `["ts-jest", { babelConfig: true }]`；`^.+\\.vue$` → `@vue/vue3-jest` |
| `moduleNameMapper` | `'^@/(.*)$'` → `<rootDir>/src/$1`；`'^@lib/asset-resolver$'` → `<rootDir>/src/lib/assets/assetResolver.ts`（单测没有 webpack，固定走 runtime 实现）；`'\\.(png\|jpe?g\|gif\|webp\|ktx2)$'` → `<rootDir>/tests/unit/fileMock.js` |
| `globals.__DSP_LIB_ASSET_INVENTORY__` | `buildInventory(__dirname)`——来自 `scripts/lib-build/assetInventory.js`，扫磁盘得到「哪些资产真实存在」。runtime 资产解析器靠它判断文件存在，注入清单就不会「先发 404 再回退」 |
| `globals.__DSP_MODEL_CACHE_ENABLED__` | `require('./config/persistence.config').web === true` → 单测默认**开启**模型持久化（对齐 Web 端）。测「关闭」路径时用 `setModelCacheEnabled(false)` 运行时覆盖 |

- 没有 `testMatch` / `roots` 覆盖，走 Jest 默认匹配：全仓库 `*.spec.ts` 共 26 个，全部在 `tests/unit/` 下；`tests/unit/scripts/*` 是脚本不是 spec，不会被执行。
- `babel.config.js` 只有一行预设 `@vue/cli-plugin-babel/preset`，配合 `ts-jest` 的 `babelConfig: true` 生效。
- `tests/unit/fileMock.js` 是图片/ktx2 的替身模块（`module.exports = 'test-texture.png'`）：清单里 `require('.../xxx.png')` 只要有个字符串即可，真实文件存在性由单测自己扫磁盘核对。

目录布局（42 个文件 = 26 spec + 9 fixture + 5 脚本 + 1 映射表 + `fileMock.js`）：

| 目录 | spec 数 | 主题 |
| ---- | ---- | ---- |
| `tests/unit/blueprint/` | 8 | 解析器、MD5、星球网格、删除建筑、地基、统计、命令队列、密集分流器 |
| `tests/unit/camera/` | 1 | 星球地图相机（锚点 + 仰角 + 视距模型） |
| `tests/unit/lib/` | 6 | 发布层：资产根地址、`BlueprintViewer` 门面、BVH、建筑描述、图标图集、相机聚焦 |
| `tests/unit/models/` | 7 | 模型层：变换表、放置矩阵、名称解析、缓存、离线包、贴图兜底、材质参数表 |
| `tests/unit/preview/` | 4 | 增量预览：fixture 护栏、摄入/跟随、投影、真实样本回放 |
| 合计 | **26** | — |

### 12.2 测试用例

**A. 26 个 spec**

| 文件 | 覆盖 |
| ---- | ---- |
| `blueprint/parser.spec.ts` | v1 内联蓝图的字符串往返（`version === 1`、`header.author` 兜底为空、`fromStr(toStr(bp))` 等值）；v2 三份 fixture（`same_buildings_v2` / `sample_outpost_ils` / `sample_throughput`）的**字节级**往返：解压 body 逐字节一致、头部除时间列（index 8）外逐格解码后一致、时间字段允许 1ms 误差 |
| `blueprint/md5.spec.ts` | `md5.digest()` 对空输入、`"a"`、`"abcd"` 三个已知向量逐字节比对 |
| `blueprint/planet.spec.ts` | `findPosForAreas` 的面积定位：单区域、跨赤道、高纬正向（跨/不跨赤道）、低纬正向、南纬、多区域跨赤道时的 `latitude` / `longitude` / `segment` |
| `blueprint/removeBuilding.spec.ts` | `describe.each` 三份 fixture（`dense_splitters_v1` / `starting_base_01029` / `sample_throughput`）上的删除链路：头/中/尾与越界下标删除、index 重排与 `outputObjIdx`/`inputObjIdx` 引用改写、`CommandQueue` 的 undo/redo 精确恢复、散点批量删除、全删后空蓝图、`RemoveBuildingsByItemCommand` 按 itemId 单步删除；每次断言 `index === 数组位置` 且引用为 `-1` 或合法下标 |
| `blueprint/foundation.spec.ts` | 地基（`reformData`）：只有地基的蓝图（0 建筑、1 个 `9×11` rect）、设施+地基 320（16 建筑、1 个 `20×16` rect）不丢建筑、两份 fixture 的「带地基」字节级往返、0.10.33 的 5 个不透明尾部字节 `[0x04,0,0,0,0]` 原样保留、flag=0 的 v2 蓝图仍可解析 |
| `blueprint/dense_splitters.spec.ts` | 「额外蓝图」护栏：`dense_splitters_v1`（0.10.33，v1 头 + v2 体）解析出 438 座建筑、往返后建筑数与分拣器第二端 `localOffset` 在 0.01 内保持；`starting_base_01029`（0.10.29，v1）可解析 |
| `blueprint/command.spec.ts` | `CommandQueue` 的 `stateVersion` / `execVersion` 分流：`ReplaceCommand`、`SetAcceleratorCommand`（silent）push 与 undo 都只加 `stateVersion`；`RemoveBuildingCommand`（非 silent）两个版本都加；「先 silent 后 non-silent」序列里 `execVersion` 只在非 silent 时递增 |
| `blueprint/stats.spec.ts` | `calculateProductionStats`：分馏塔（默认 72 氢→72 氘、3960 kW、不出现增产剂消耗行；Mk.I 90/min、5148 kW、增产剂 90/12；Mk.III 144/min、9900 kW、增产剂 144/75）与普通配方建筑（无增产剂 45/min、270 kW；Mk.III 加速模式 90/min、675 kW、增产剂 90/75） |
| `camera/planetMapControls.spec.ts` | `PlanetMapControls` 的「锚点 + 仰角 + 视距」模型：相机高度 = R + minHeight + sin(tilt)·距离、切向偏移 = cos(tilt)·距离；永远看向球面锚点（不是球心）；`up` 取当地法线；压到平视时距离被地平线收住且抬回仰角可复原缩放级别；拉远时自动抬高仰角；平移后锚点仍在单位球面且绕球心转过「位移 / R」；旋转只改方位/仰角；仰角夹在 `[minTilt, maxTilt]`；中键无操作；WASD 的屏幕方向语义；`reset()` 回到 `setHome()` 的入场姿态 |
| `lib/assetBaseUrl.spec.ts` | 资产根自动探测优先级：`import.meta.url` → `document.currentScript.src` → `document.baseURI` → 空串；`configureAssetBaseUrl()` 覆盖 `import.meta.url`、传 `null`/空串清除配置回到自动探测；无 `document` 时相对路径按字符串归一 |
| `lib/blueprintViewer.spec.ts` | `BlueprintViewer` 门面（10 个 `describe`）：`loadBlueprintData`（成功/`keepCamera` 三态/透传 `unknownModelIndexes`/内核抛错保留上次数据/`RenderPhaseError` 归类为定位阶段/`dispose` 后返回 `already-disposed`/容器解析失败/解析失败不进内核）、`loadBlueprint` 共用同一条链路、`selectBuilding`、`selectedBuildings` 多选去重、`focusBuilding`（默认同时选中、`select: false` 只动镜头、`index: null` 等价 `resetCamera`）、`getSelectedIndex`、`getBuildingInfo`、只读透出与 `setSize`、主题与导出（默认 editor 主题、`setTheme`/`setCustomTheme`/`toDataURL`/`toBlob`、销毁后返回 null）、`setCallbacks`（默认整体替换 vs `merge: true`） |
| `lib/buildBVH.spec.ts` | `buildBVH` 兜底：已知模型得非退化选择盒；未知模型不抛错、放极小占位盒并记入 `unknownModelIndexes`（多模型去重升序）；选择盒数量等于建筑数（含占位） |
| `lib/describeBuild.spec.ts` | `describeBuild` 纯数据基线：空蓝图、按 modelIndex 统计建筑数（未知模型计入 hidden）、走 GLB 的实例从 fallback 扣除、`selectBoxes` 与建筑一一对应且矩阵归一化、同输入两次结果稳定（快照可复现）、`settings` 原样带出、不改动传入的 BVH |
| `lib/iconTexture.spec.ts` | `IconTexture` 图集：构造只上传一次纹理；同一 `iconId` 重复请求复用槽位且只下载一次；不同 `iconId` 分不同槽位；未知 `iconId` 返回 0（空图标）且不分配槽位；`has()` 语义；`dispose()` 释放图集纹理 |
| `lib/planetMapControls.spec.ts` | `focusSpherePoint` / `reset` 回归（「聚焦后镜头被锁死」缺陷）：相机落在「目标点 + 法线 × distance」、`target` 保持球心、目标点投影居中、聚焦后滚轮缩放与拖拽旋转仍可用、`distance` 过小时被抬到贴地最近处；库模式（未 `setHome`）回到正上方俯视、编辑器模式（已 `setHome`）回到入场姿态 |
| `models/modelTransform.spec.ts` | 只守**表的结构**不守具体调参值：每行都对应磁盘上真实 `.glb`；与 `buildingMeta` 键集相等且**长度 62**；7 个核心数值全为有限数；旋转 `\|v\| ≤ 360`、偏移 `\|v\| ≤ 100`、`scale > 0`；至少一行非全 0（防整表被清空）；未登记 modelIndex 返回 `ZERO_MODEL_TRANSFORM` 且不抛错 |
| `models/placement.spec.ts` | 放置矩阵（用 `transformOverride` 注入固定变换，不读表里的值）：水平格/垂直格换算与 `planetConstants` 一致（≈1.2579 / 4/3）、全 0 变换中心落盒心、`yaw=90` 把 +X 转到 +Y、`yaw=180` 翻到 -X、`pitch` 绕 X 与 `roll` 绕 Y 各自生效、`z` 偏移 n 格 = n × 4/3、`x/y` 偏移按格且不受 `yaw` 影响、无模型时回退元数据表并忽略偏移/旋转、不修改元数据表、62 个建筑 × 典型变换矩阵全部有限 |
| `models/modelMapping.spec.ts` | GLB 名称解析表（纯函数层）：无别名直接用 `icon` 名、`assembler-1` 与 icon 同名、`accumulator-full` → `accumulator`、`splitter-4dir` 按 `Item.models` 下标取 `splitter-a/b/c` 且越界钳制到最后一个、别名表结构自检（每条都有 note、fallbacks 不与 primary 冲突）、未登记名返回 `null`（静默回退）、`availableModelNames` 来自资产解析器清单（`smelter` 可解析） |
| `models/textureFallback.spec.ts` | 缺失底色贴图的纯色兜底：显式指定表优先于启发式与默认值；材质名启发式（`black` / `glass` / `water` 各专属色，带空格的材质名也能命中）；无线索时中性灰；`missingAlbedoTexture` 返回 1×1 sRGB `DataTexture`、按颜色缓存复用、RGBA 数据正确 |
| `models/textureManifest.spec.ts` | 实际测的是**建筑材质参数表** `modelMaterialTuning`（不是贴图清单）：磁盘上每个 `.glb` 都有一条可调参数、表里没有已删模型的僵尸条目、`emissiveIntensity`/`envMapIntensity`/`metalness` 均为有限数且在区间内、未登记模型回退 `DEFAULT_MODEL_MATERIAL_TUNING` 且默认值合法（附 `METALNESS_WITHOUT_SPEC_MAP` 区间）。文件头注释说明：通道贴图已全部内嵌 KTX2，`textureManifest` 现为空清单，原「每个清单文件都在磁盘上」的断言已移除 |
| `models/modelCache.spec.ts` | 持久化全局开关与 `NoopModelCache`：开关关闭时 5 个操作全部返回「未命中/失败/空」且**完全不碰 Cache Storage**（连 `open` 都不调）；环境不支持 Cache Storage 时开关开着也退回同一空操作对象；默认跟随构建配置（单测注入 Web 端 = 开启）且运行时覆盖优先；打开时走真实后端能写能读；关闭时 `isPackSupported`/`isPersistenceEnabled` 为 false、`inspectPack` 不谎报、`downloadPack` 直接报错不发请求；重新打开后下载恢复正常 |
| `models/modelPack.spec.ts` | 离线模型包（手搓 `FakeCacheStorage` + `fetch` + `document.baseURI`）：没有 `caches` 时退化为空操作不抛错、存入按 URL 读回原始字节、键归一化成绝对 URL（相对/绝对路径命中同一条）、清单来自磁盘真实 GLB、`inspectPack` 把已缓存算进去、顺手清掉不属于当前构建的旧条目、下载只请求缺失文件且进度单调递增、全齐后再点零请求、HTTP 失败抛错并指明模型、取消（开始前 `AbortError`；途中保留已完成文件、半成品不落盘）、`clearPack` 返回删除条数、不支持本地缓存时下载直接报错不静默成功 |
| `preview/fixture.spec.ts` | `scripts/lib-build/preview-fixture.json` 的可用性护栏（文件不存在时 `describe.skip`）：事件数/操作数与 `stats` 一致、`areas` 必须是嵌套形态（无 `anchorLocalOffsetX`）、`building` 带 `isTemporary`；离线回放后 `stats`（events/operations/alive/peakAlive/unknownRemoves/unknownReplaces/moving/coordinateSystem=`blueprint-area-local-v1`）与 fixture 记录的统计一致 |
| `preview/previewLayer.spec.ts` | `PreviewLayer` 四组：摄入顺序与健壮性（重复/更旧 sequence 整条忽略、跳号照常应用、`remove`/`replace` 未知对象容错、非差量事件不参与几何、坏数据安全跳过）；抖动抑制与淡入（`minLifeMs` 内被撤销的对象不出场、`enterDelayMs` 后才淡入、`enterDelayMs = 0` 立即淡入）；跟随收敛（位置插值、`off` 模式一帧到位、撤销后回归复用同一槽位不重新淡入）；容量与坐标切换（超容量自动扩容，传送带初始池 4096；切到 area-local 后走真实 `areas` 投影且不丢对象） |
| `preview/projector.spec.ts` | `PreviewProjector` 两阶段：layout 期（320 格跨度缩放不越极点、小跨度保持 1:1 格宽、bbox 缓慢增长时重投影次数远少于事件数、高度按 `HEIGHT_GRID_SIZE` 抬升、`plane` 模式贴世界 XY 平面不绕球）；area-local 期（扁平字段与嵌套字段都解析成 `BlueprintArea`、切坐标语义会 bump `version`、投影与 `calcBuildingTrans` 逐位一致、没有 `areas` 时退化为 layout 同款投影） |
| `preview/replay.spec.ts` | 真实样本回放（**默认 `describe.skip`**，需 `PREVIEW_REPLAY=1` 才跑）：样本取自 `data/preview-delta-*.json`，默认只取 < 20 MB 的两个最小样本（`PREVIEW_REPLAY_FILE` 可指定单个、`PREVIEW_REPLAY_VERBOSE=1` 打印 stats）；断言至少存在一份样本、单事件摄入 < 50 ms（`stats.maxIngestMs` 也 < 50）、回放后存活数等于净增量、峰值一致、事件停后 `moving` 归零、`slots > 0` |

**B. 9 个 fixture（`tests/unit/blueprint/fixtures/`）**

| 文件 | 大小 | 蓝图头 | 用途 |
| ---- | ---- | ---- | ---- |
| `dense_splitters_v1.txt` | 11 907 B | `BLUEPRINT:0,10,2020,…,0.10.33.27026,DENSE Splitter,630/Min` | 0.10.33 高密度分流器场景（v1 头 + v2 体，438 座建筑）；`dense_splitters.spec` 解析与往返、`foundation.spec` 校验 5 个不透明尾部字节、`removeBuilding.spec` 删除链路 |
| `starting_base_01029.txt` | 11 084 B | `BLUEPRINT:0,50,1104,…,0.10.29.21950,Starting Base - Part 1` | 0.10.29 老版本基地（v1）；`dense_splitters.spec` 老版本可解析、`removeBuilding.spec` 删除链路 |
| `same_buildings_v2.txt` | 887 B | `BLUEPRINT:1,10,401,…,0.10.34.28529,test,…,test desc` | v2 标准样本；`parser.spec` 字节级往返、`foundation.spec`（flag=0 时 `reformData` 为 null、无尾部字节）、`command.spec` 命令队列版本分流 |
| `sample_outpost_ils.txt` | 1 106 B | `BLUEPRINT:1,51,2104,1003,…,0.10.34.28505,Outpost Miner ILS` | 含星际物流运输站的采矿前哨；`parser.spec` 字节级往返 |
| `sample_throughput.txt` | 3 220 B | `BLUEPRINT:1,31,2030,2003,…,0.10.34.28518,Throughput matcher` | 含流速监测器的吞吐匹配样本；`parser.spec` 字节级往返、`removeBuilding.spec` 删除链路 |
| `foundation_only_99.txt` | 262 B | `BLUEPRINT:1,10,401,…,0.10.34.28529,地基99` | 只有地基、0 建筑、1 个 `9×11` rect；`foundation.spec` 解析 + 带地基字节级往返 |
| `facilities_with_foundation_320.txt` | 936 B | `BLUEPRINT:1,10,401,…,0.10.34.28529,带地基320` | 设施 + 地基（16 建筑、1 个 `20×16` rect）；`foundation.spec` 解析 + 字节级往返 |
| `_tmp_fixture.txt` | 11 084 B | 与 `starting_base_01029.txt` **逐字节相同**（MD5 `a1e1ce7f…`） | 历史遗留副本，**没有任何 spec 引用** |
| `_tmp_fixture.json` | 510 487 B | `{ header, version, cursorOffset, cursorTargetArea, dragBoxSize, primaryAreaIdx, areas, buildings }` | 解析产物转储（502 条建筑记录），历史遗留物，**没有任何 spec 引用** |

两个 `_tmp_fixture.*` 都在 git 里（`git ls-files` 可见），但 `tests/`、`src/`、`scripts/` 中均无引用；它们是早期标定脚本的落盘产物，等同「死数据」，删掉不影响任何测试。

**C. `tests/unit/scripts/` 6 个文件（脚本，非 spec）**

| 文件 | 语言 | 作用 |
| ---- | ---- | ---- |
| `check-glb-extensions.ts` | TS | 逐 GLB 读 JSON chunk，收集 `extensionsRequired` / `extensionsUsed` / 外部 `buffers[].uri` / `images[].uri`，列出「需要额外解码器或引用外部资源」的文件——这些问题不会报错，只会让 `buildingModel` 静默回退元数据盒 |
| `inspect-glb.ts` | TS | 直接从 GLB 二进制里量包围盒（不依赖 three/webpack），验证「是合法 glTF 2.0 二进制」与「模型是 y-up」两个前提 |
| `verify-glb-mapping.ts` | TS | 用纯函数 `modelNameCandidates()` + 磁盘目录比对，独立复核「谁匹配上、谁回退、哪些 GLB 没被引用、哪些 modelIndex 没有模型」 |
| `gen-texture-manifest.mjs` | MJS | 把 GLB 内嵌底色图与磁盘 PNG 做 **MD5 全等比对**，剥掉通道标记（a/e/n/s）与 LOD 标记得到词干，生成 `texture-mapping.json`（持久映射）与 `src/models/textureManifest.ts`（运行期清单）；`--report` 只打覆盖率 |
| `prune-model-textures.mjs` | MJS | 依据 `texture-mapping.json` 把「没被任何 GLB 材质引用」的贴图移出仓库：默认 dry-run，`--apply` 才移动到仓库外备份目录，并写 `MOVE_LIST.md` 与 `restore.ps1` |
| `texture-mapping.json` | JSON | 39 727 B，`{ generatedAt: "2026-10-29T15:30:46.299Z", entries: [126 条] }`，每条 `{ glb, material, albedo, stem, dir, normal, emissive, spec }`，是上述两个脚本的输入/历史数据 |

这 6 个文件的前身在仓库根的 `scripts/`（文件头注释里的用法示例还写着 `scripts/check-glb-extensions.ts` 之类）。搬到 `tests/unit/scripts/` 后，其中 5 个脚本仍在用「上一级就是仓库根」的路径假设（`join(__dirname, '..', 'src', 'assets', 'icons', 'models')`、`const REPO = resolve(HERE, '..')`），从新位置解析会指向不存在的 `tests/unit/src/...`。

> ⚠️ 待确认：这些脚本当前是否还按原路径手工运行；若要让它们在新位置可用，路径常量需要多退两级（对 `tests/unit/scripts` 而言仓库根是 `../../..`）。

### 12.3 运行

```bash
yarn test:unit                                  # jest --watchAll —— 监视模式，不是一次跑完
yarn test:preview                               # jest tests/unit/preview —— 一次跑完 4 个 preview spec
```

命令与真实脚本的对应关系：

| 命令 | 实际执行 | 行为 |
| ---- | ---- | ---- |
| `yarn test:unit` | `jest --watchAll` | 进入交互式监视模式（按 `a` 全跑、`q` 退出）；首次会跑全部 26 个 spec，之后按改动重跑 |
| `yarn test:preview` | `jest tests/unit/preview` | 一次性运行 `tests/unit/preview/` 下的 4 个 spec（不带 `--watchAll`），跑完即退出 |
| 单文件 | `yarn test:unit -- tests/unit/blueprint/stats.spec.ts` | 追加的参数交给 Jest 当路径模式；因为带了 `--watchAll`，仍是监视模式 |
| 真·一遍过 | `yarn jest` | 不带 `--watchAll` 的一次性全量运行——想要「跑完即退出 + 非零退出码」时用它（CI 里没有测试任务，所以仓库内没有这个脚本） |
| 真实样本回放 | `PREVIEW_REPLAY=1 yarn jest tests/unit/preview/replay.spec.ts` | 打开 `preview/replay.spec.ts` 的 `describe.skip`，读 `data/preview-delta-*.json`（默认取 < 20 MB 的两个最小样本）；可用 `PREVIEW_REPLAY_FILE` 指定单个文件、`PREVIEW_REPLAY_VERBOSE=1` 打印 stats |

注意事项：

- `test:unit` 的 `--watchAll` 会停在监视模式等按键（首次跑完全部 spec 后不退出），在无 TTY 的 CI 容器里会一直挂着而不会自己结束——这正是仓库没把它放进 CI 的原因。要「跑完即退出 + 有非零退出码」，用不带 `--watchAll` 的 `yarn jest`。
- `tests/unit/preview/fixture.spec.ts` 依赖 `scripts/lib-build/preview-fixture.json`，该文件**被 `.gitignore` 忽略**（由 `node scripts/preview/build-fixture.mjs` 从 `data/` 的抓包生成），缺失时整块 `describe.skip`，不会让测试变红。
- 涉及 three / WebGL 的用例全部注入了替身（`jest.mock('@/models/buildingModel', …)`、手搓 `caches`/`document`/`fetch`），所以整套单测不需要浏览器或 GPU。
- 仓库里其它文档的测试说明已过时：`README.md` 的「跑单元测试」只写 `yarn test:unit`（没提它进监视模式），`docs/wiki/api.md` 与 `docs/wiki/getting-started.md` 还写着 `yarn test:unit -- --watch`（脚本本身已是 `--watchAll`，再加 `--watch` 无意义）和「测试位于 `tests/unit/blueprint/`」。

***

## 13. 运行与构建方式

本仓库同时是**两个东西**：一个可独立部署的 SPA（`src/main.ts` → `App.vue`，PWA，部署在 GitHub Pages 子路径 `/dsp_blueprint_editor/`），以及一个可发布的**无头渲染库**（`src/lib/`，`yarn build:lib` → `dist-lib/`）。两者的构建入口、产物目录、注入常量都不同，下面分开说明。

### 13.1 环境与安装

```bash
yarn install   # 或 npm install
```

- `package.json` 未声明 `engines`，构建/CI 实际使用 Node 20（见 §14.1）。
- `yarn install` 会触发 `postinstall: patch-package`。仓库当前**没有 `patches/` 目录**，因此这一步是空转（不会报错，也不会改动 `node_modules`）。
- 仓库同时存在 `yarn.lock` 与 `package-lock.json`；CI 与本文件所有示例统一用 yarn（CI 的 `cache: 'yarn'` 也只认 `yarn.lock`）。

### 13.2 全部 npm scripts

`package.json` 的 `scripts` 字段共 **13** 条，逐条如下（「实际命令」列是 `package.json` 原文）：

| 脚本 | 实际命令 | 作用 | 产物 / 注意 |
| ---- | ---- | ---- | ---- |
| `serve` | `vue-cli-service serve` | 开发服务器 + HMR | 因 `publicPath`，本地地址含 `/dsp_blueprint_editor/` 前缀 |
| `build` | `node scripts/generate-update-log.js && vue-cli-service build` | 生产构建（**先**生成更新日志，再打包） | 产物 `dist/`。更新日志脚本失败会中断整个构建（`process.exit(1)`） |
| `build:lib` | `node scripts/lib-build/build.js` | 无头库构建（UMD + ESM + 资产） | 产物 `dist-lib/`，见 §13.6 |
| `test:unit` | `jest --watchAll` | 单元测试，**默认进入 watch 模式** | 非 CI 用法；一次性跑完需自行加 `--watchAll=false` |
| `test:preview` | `jest tests/unit/preview` | 只跑增量预览相关测试 | `tests/unit/preview/` 下 4 个 spec：`fixture.spec.ts`、`previewLayer.spec.ts`、`projector.spec.ts`、`replay.spec.ts` |
| `lint` | `vue-cli-service lint` | ESLint 检查并自动修复 | 配置在 `.eslintrc.js` |
| `build-cli` | `tsc --module commonjs --outDir cli` | 把 TS 源码编译成 CommonJS | 产物写入 `cli/`（该目录未提交，当前工作区不存在） |
| `cli` | `ts-node -r tsconfig-paths/register -O "{\"module\": \"commonjs\"}" src/cli.ts` | 直接以 ts-node 跑 CLI 源码，`tsconfig-paths` 负责 `@/` 别名，`-O` 把模块体系覆盖成 CommonJS | 不落盘，见 §13.3 |
| `i18n:report` | `vue-cli-service i18n:report --src "./src/**/*.?(js|vue)" --locales "./src/locales/**/*.json"` | 生成 i18n 翻译覆盖率报告 | 语种文件是 `src/locales/zh.json`、`src/locales/en.json` |
| `postinstall` | `patch-package` | 安装后给依赖打本地补丁 | 当前无 `patches/`，等价空转 |
| `format` | `prettier --write "src/**/*.{js,ts,jsx,tsx,vue,json,css,scss,md}"` | 格式化 `src/` | `prettier` **未**在 `dependencies`/`devDependencies` 中声明（`node_modules` 里有传递依赖装的副本） |
| `release` | `standard-version --release-type minor --commit-message "chore: release v%VERSION"` | 发版：升版本号、生成 CHANGELOG 段落、打 tag | `standard-version` **未**声明且当前 `node_modules` 里没有安装；`package.json` 的 `standard-version.scripts.postchangelog` 还会在写完 CHANGELOG 后自动跑一次 `node scripts/generate-update-log.js` |
| `update-log` | `node scripts/generate-update-log.js` | 单独生成更新日志 | 写 `public/update-log.json`，见 §13.7 |

### 13.3 CLI 用法

`yarn cli` 直接跑源码（不编译、不落盘），`yarn build-cli` 则用 `tsc` 把源码编译到 `cli/`：

```bash
# 1) 从 stdin 读蓝图字符串，JSON 打到 stdout
echo 'BLUEPRINT:0,10,...' | yarn cli > bp.json

# 2) 直接传输入文件
yarn cli blueprint.txt > bp.json

# 3) 传 -o / --out，把结果写文件（去掉 BOM 后按 UTF-8 写的 JSON）
yarn cli blueprint.txt -o bp.json
yarn cli blueprint.txt --out      # -o 不带值：输出到同名 .json
yarn cli blueprint.txt -o         # 同上
```

`src/cli.ts` 的行为要点：

- 有位置参数则读该文件，否则从 stdin 读；读到的内容先剥掉 BOM（`\uFEFF`）再 `trim()`。
- 输出是 `JSON.stringify(fromStr(input))`，即 `BlueprintData` 的裸 JSON（没有缩进）。
- `-o`/`--out` 不带值时，按输入文件推导「同目录、同名、`.json` 后缀」；**stdin 输入不允许省略文件名**，会打印错误并以退出码 1 结束。
- `-O "{\"module\": \"commonjs\"}"` 是 `ts-node` 的 `--compiler-options` 简写，覆盖 `tsconfig.json` 的 `module: esnext`。

### 13.4 编辑器构建配置（`vue.config.js`）

#### 部署根路径

```js
const PUBLIC_PATH = '/dsp_blueprint_editor/'   // 同时决定 publicPath 与 KTX2 转码器目录
```

#### `pages`：index 必注册，demo 条件注册

| 页面 | 条件 | entry / template / filename |
| ---- | ---- | ---- |
| `index` | 始终注册 | `src/main.ts` / `public/index.html` / `index.html` |
| `demo` | **仅当 `demo/main.ts` 存在**（`fs.existsSync(path.resolve(__dirname, 'demo/main.ts'))`） | `demo/main.ts` / `demo/index.html` / `demo.html` |

仓库当前**没有 `demo/` 目录**，因此只产出 `index.html`；配置注释里明确写了这是为了避免 `Can't resolve demo/main.ts` 让 `yarn build` 失败。补上 `demo/main.ts` 与 `demo/index.html` 后该页自动生效。

#### asset 规则（`configureWebpack.module.rules`，共 4 条）

| # | `test` | `type` | 产物文件名 | 说明 |
| - | ---- | ---- | ---- | ---- |
| 1 | `/\/assets\//` | `asset` | 默认（<8KB 内联） | 通用规则，带 `exclude: /\.[jt]sx?$/`：否则 Linux 下会把 `src/lib/assets/*.ts` 当成 asset，导致 `assetResolver` 在 CI 产物里变成 `undefined` |
| 2 | `/assets[\\/]icons[\\/]item_recipe[\\/]/` | `asset/resource` | `img/item_recipe/[name].[contenthash:8][ext]` | 物品/配方图标，目录扁平，不保留子路径；正则兼容 Windows 反斜杠 |
| 3 | `/\/assets\/icons\/(signal|tech)\//` | `asset/resource` | 默认命名 | 信号图标与科技图标，带 `exclude: /\.[jt]sx?$/` |
| 4 | `/\.glb$/i` | `asset/resource` | `models/[name].[contenthash:8][ext]` | 建筑模型强制独立成文件（不走内联），URL 带 `publicPath`；**必须排在规则 1 之后**，后匹配的规则覆盖前面的 `type` |

#### `resolve.alias`

| 别名 | 指向 | 目的 |
| ---- | ---- | ---- |
| `three$` | `'three/src/Three.js'` | 走 three 的 ESM 源码（可 tree-shake），避免解析到 CJS 的 `three.cjs` |
| `@lib/asset-resolver$` | `src/lib/assets/assetResolver.webpack.ts` | `$` 表示精确匹配。编辑器构建固定用 webpack 实现（`require.context` / 模板字符串 `import()`），产物与改造前逐字节一致 |

#### `DefinePlugin` 注入的 4 个常量

| 常量 | 注入值 | 来源 | 使用方 |
| ---- | ---- | ---- | ---- |
| `VERSION` | `git describe --tags --always --dirty` 的 stdout（`trim()` 后 `JSON.stringify`） | `execSync(...)` | `src/define.ts` 的 `export const version` → `App.vue` 页脚（`App.vue:466`） |
| `__DSP_TRANSCODER_BASE__` | `'/dsp_blueprint_editor/basis/'` | `PUBLIC_PATH + 'basis/'` | `src/models/ktx2.ts` 的 `transcoderPath()`（`setTranscoderPath` 要求末尾带斜杠） |
| `__DSP_MODEL_BYTES__` | `{ 模型名: 字节数 }` 的 JSON | `buildModelBytes(__dirname)`，见 `scripts/lib-build/assetInventory.js`（扫 `src/assets/icons/models/*.glb` 的文件大小） | `src/models/modelPack.ts`，用于「未下载模型共多少 MB」的零请求估算 |
| `__DSP_MODEL_CACHE_ENABLED__` | `true` | `config/persistence.config.js` 的 `persistence.web === true` | `src/models/modelCacheConfig.ts` |

`__DSP_MODEL_CACHE_ENABLED__` 的唯一配置源是 `config/persistence.config.js`（`{ web: true, lib: false }`，共两个字段），编辑器与库两套构建各取一个字段。

#### `pwa`

| 键 | 值 |
| ---- | ---- |
| `name` | `'戴森球计划蓝图预览'` |
| `themeColor` | `'#000000'` |
| `msTileColor` | `null` |
| `appleMobileWebAppCapable` | `'yes'` |
| `appleMobileWebAppStatusBarStyle` | `'black'` |
| `manifestOptions.short_name` | `'蓝图预览'` |
| `manifestOptions.icons` | `./img/icons/android-chrome-192x192.png`、`./img/icons/android-chrome-512x512.png` |
| `iconPaths` | `faviconSVG: img/icons/favicon.svg`、`favicon32: img/icons/favicon-32x32.png`、`favicon16: img/icons/favicon-16x16.png`、`appleTouchIcon / maskIcon / msTileImage: null` |

`workboxOptions.exclude` 共 **7** 条（工作区已被 `vue-cli-plugin-pwa` 用 `Object.assign` 整体覆盖，所以默认项必须原样保留）：

```js
[/\.map$/, /img\/icons\//, /favicon\.ico$/, /^manifest.*\.js?$/, /models\//, /demo\//, /update-log\.json$/]
```

- 排除 `models/`：建筑 GLB 体量太大，不能进 precache；模型由 `glbLoader` 自己懒加载（并发闸门 + 负缓存）。
- 排除 `update-log.json`：更新日志必须每次走网络拿最新版，进了 precache 旧页面就永远看到旧日志。

#### `pluginOptions.i18n`

```js
{ localeDir: 'locales', enableLegacy: false, runtimeOnly: true, compositionOnly: true, fullInstall: true }
```

其余还有两处：`transpileDependencies: false`，以及根目录的 `.browserslistrc`（`> 1%` / `last 2 versions` / `not dead` / `not ie 11`）与 `babel.config.js`（`@vue/cli-plugin-babel/preset`）。

### 13.5 TypeScript 配置（`tsconfig.json`）

**仓库根目录只有 `tsconfig.json` 一个 TS 配置**（`tsconfig.paths.json` 已不存在，任何引用它的说明都是过期的）。

| 键 | 值 |
| ---- | ---- |
| `compilerOptions.target` / `module` | `"esnext"` / `"esnext"` |
| `compilerOptions.strict` | `true` |
| `compilerOptions.moduleResolution` | `"node"` |
| `compilerOptions.jsx` | `"preserve"` |
| `compilerOptions.skipLibCheck` / `esModuleInterop` / `allowSyntheticDefaultImports` / `forceConsistentCasingInFileNames` / `useDefineForClassFields` / `resolveJsonModule` / `sourceMap` | 全部 `true` |
| `compilerOptions.baseUrl` | `"."` |
| `compilerOptions.types` | `["webpack-env", "jest"]` |
| `compilerOptions.paths` | `"@/*": ["src/*"]`、`"@lib/asset-resolver": ["src/lib/assets/assetResolver.ts"]` |
| `compilerOptions.lib` | `["esnext", "dom", "dom.iterable", "scripthost"]` |
| `include` | `src/**/*.ts`、`src/**/*.tsx`、`src/**/*.vue`、`tests/**/*.ts`、`tests/**/*.tsx`、**`demo/**/*.ts`** |
| `exclude` | `node_modules` |

两点容易踩：

1. `paths` 里只有**无 `$` 的** `@lib/asset-resolver`（供类型解析指向 runtime 实现 `assetResolver.ts`）；真正的「选哪个实现」发生在 webpack 的 `@lib/asset-resolver$` 精确别名上（见 §13.4 与 §13.6）。
2. `include` 含 `demo/**/*.ts`，但 `demo/` 目录当前不存在——不匹配的 `include` glob 不会报错，`tsc` 照常工作。

`jest` 相关配置（`jest.config.js`、`tests/unit/fileMock.js`）不属于本章范围。

### 13.6 库构建（`yarn build:lib`）

`scripts/lib-build/build.js` 直接用 **Node 调 webpack API**（仓库没装 `webpack-cli`），对 `src/lib/index.ts` 各编译一次 UMD 与 ESM。

#### 产物（全部落在 `dist-lib/`）

| 产物 | 说明 |
| ---- | ---- |
| `dsp-blueprint-editor.umd.js`（+ `.map`） | UMD，`output.library = { name: 'DSPBlueprintEditor', type: 'umd' }`，`output.globalObject = 'globalThis'`（ESM 顶层 `this` 是 `undefined`，用 `this` 当 root 会让包装器崩） |
| `dsp-blueprint-editor.esm.js`（+ `.map`） | 真 ESM：`experiments.outputModule` + `output.module` + `output.chunkFormat = 'module'` + `library.type = 'module'` |
| `dsp-blueprint-editor.esm.d.ts` | 由 `scripts/lib-build/index.d.ts` 拷贝而来，与 ESM 产物同名，供 TS 按「同名 `.d.ts`」规则解析 |
| `index.d.ts` | `package.json#types` 指向它，内容同 ESM 版 |
| `host-test.html` / `esm-test.html` / `preview-test.html` / `README.md` | 纯静态验收页与说明，均从 `scripts/lib-build/` 拷入 |
| `models/<name>.glb` | 按 `assetInventory.js` 清单从 `src/assets/icons/models/` 复制（贴图已内嵌为 KTX2） |
| `img/item_recipe/*.png`、`img/tech/*.png`、`img/signal/*.png` | 三类图标（`icons/` 前缀改成 `img/`） |
| `img/icons/**`、`img/*.png` | 其余 logo（`icons/` 子目录 → `img/icons/<子目录>/…`，根下文件 → `img/…`） |
| `basis/basis_transcoder.js` + `basis_transcoder.wasm` | 从 `public/basis/` 复制；**缺失会直接失败** |
| `fixtures/sample_blueprint.txt`、`fixtures/sample_blueprint.json`、`preview.json`、`preview-fixture.json` | 可选样本，缺了只打警告不阻断 |

`package.json` 用 `main / module / types / unpkg / jsdelivr` 指向上述 `dist-lib/` 文件，`files: ["dist-lib"]`。

#### three 的处理：**两个产物都内联**

- UMD 与 ESM 都**不设 `externals`**，`three` 一律内联进单文件，宿主不需要（也不应该）安装 `three`。
- `resolve.alias.three$ = 'three/src/Three.js'`：从 three 的 ESM 源码打包，享受 tree-shaking（直接解析 `three` 包会拿到 CJS 的 `build/three.cjs`，体积大且无法摇树）。
- 两个产物都必须挂 `LimitChunkCountPlugin({ maxChunks: 1 })`：`glbLoader.ts` 里的 `GLTFLoader` 走动态 `import()`，不合并就会甩出独立 chunk，单文件产物直接失效。
- 产物自检（`verify()`）会断言：两个 target 只产出「一个 js + sourcemap/license」；UMD 里含全局名 `DSPBlueprintEditor`、含 three 的特征字符串 `THREE.WebGLRenderer`、含 `globalThis`、且**不含 `import.meta`**；ESM 里**不含 `from "three"`**、含 `import.meta.url`、含 `export {`、且不含 `webpackUniversalModuleDefinition`。

> 注意：`src/lib/index.ts` 顶部注释写的是「UMD（内联 three）+ ESM（`three` 外置）」，与脚本实际行为不符——以 `scripts/lib-build/build.js` 及其自检为准：**ESM 也是内联 three**（`scripts/lib-build/README.md` 同样写的是「ESM，three 内联，宿主零运行时依赖」）。

#### 资产解析实现如何切换

| 构建 | webpack 别名 `@lib/asset-resolver$` | 实现方式 |
| ---- | ---- | ---- |
| 编辑器（`vue.config.js`） | `src/lib/assets/assetResolver.webpack.ts` | `require.context`（GLB，同步）与模板字符串 `import()`（图标，eager）——URL 由 `publicPath` 生成，`.glb` 由 asset 规则输出成独立文件 |
| 库（`scripts/lib-build/build.js`） | `src/lib/assets/assetResolver.ts` | 纯字符串拼接 + 外置资产；「哪些文件真实存在」由 `assetInventory.js` 扫盘得到，经 `DefinePlugin` 注入 `__DSP_LIB_ASSET_INVENTORY__`，保证运行时「文件不存在 → 直接回退」而不是先发一个 404 |

库构建另有两个常量：`__DSP_LIB_ASSET_INVENTORY__`（资产清单）、`__DSP_LIB_MODULE_URL__`（ESM 注入 `import.meta.url`，UMD 注入 `undefined`，由 `src/lib/assets/assetBaseUrl.ts` 的 `typeof` 守卫回落到 `<script src>`）；同时注入 `VERSION` 与 `__DSP_MODEL_CACHE_ENABLED__`（取 `persistence.lib`，即 `false`）。

#### 其它行为

- 产物目录先清空（Windows 上目录被占用时退化成「只删内容」并告警；单个文件删不掉则直接失败并提示关闭占用程序）。
- 缺 `public/basis/` 直接 `fail`；缺 `scripts/lib-build/preview-fixture.json`、`public/demo/sample_blueprint.json`、`public/demo/preview.json` 只打警告（当前工作区缺的是后两者与 `preview-fixture.json`）。
- 只允许 `dist-lib/models/` 下存在 `.glb`；若出现 `img/models/*.png`（旧的外置通道贴图）会判定自检失败。

### 13.7 更新日志（update-log）

`scripts/generate-update-log.js` 把 `CHANGELOG.md` **最新一个版本段落**转成 `public/update-log.json`：

| 项 | 内容 |
| ---- | ---- |
| 输入 | `CHANGELOG.md` 中第一个形如 `## <x.y.z> (<YYYY-MM-DD>)` 的标题及其到下一个 `## ` 之间的内容 |
| 输出 | `public/update-log.json`，`{ version, date, items: string[] }`，`JSON.stringify(..., null, 4)` + 换行 |
| 优先章节 | `features`→「新增」、`bug fixes`→「修复」、`performance improvements`→「优化」、`reverts`→「回退」 |
| 回退章节 | 仅当优先章节为空时使用：`documentation`→「文档」、`code refactoring`→「重构」、`styles`→「样式」、`build system`→「构建」、`tests`→「测试」、`ci`→「持续集成」、`chore`→「其他」 |
| 条目清洗 | 去掉 markdown 链接、去掉 `**xx:**` 前缀、去掉行尾 7–40 位提交哈希；被换行折断的条目会拼回一行；重复条目去重 |
| 兜底 | 一条都没有时写入 `['本次更新包含若干优化与修复。']` |
| 失败 | 找不到版本段落 / 版本号解析失败 → `process.exit(1)`（会中断 `yarn build`） |

调用时机有三处：`yarn build` 的前置命令、`yarn update-log`、以及 `standard-version` 的 `postchangelog` 钩子。

前端消费方是 `src/swStatus.vue`：新版本就绪（`registration.waiting` 或 `installing` 变为 `installed` 且已有 controller）时弹出更新窗，并

```ts
fetch(`${process.env.BASE_URL}update-log.json?t=${Date.now()}`, { cache: "no-store" })
```

即**带时间戳、禁缓存地走网络拿最新日志**，所以 `update-log.json` 被明确排除在 precache 之外（§13.4）。弹窗行为：静默键 `app.updateModal.snoozedUntil`（`localStorage`，24 小时）；点「更新」清静默键并 `postMessage({ type: 'SKIP_WAITING' })` 后 reload；本地调试可执行 `window.__DSP_UPDATE_MODAL__ = true` 直接打开弹窗。

### 13.8 本地开发流程

1. `yarn install`
2. `yarn serve` → 浏览器打开提示的地址（含 `/dsp_blueprint_editor/` 前缀）
3. 把游戏内复制的蓝图字符串粘贴到右侧「蓝图代码」文本框，或用「选择文件」加载 `.txt`
4. 在 3D 视图中点选建筑，或在侧栏「操作」Tab 做批量替换/升降级/撤销重做
5. 改动后点「复制」或「保存文件」拿到新蓝图字符串，粘回游戏
6. 改完代码跑 `yarn test:unit`（注意默认 watch）或 `yarn test:preview`；只改库代码时用 `yarn build:lib` 出 `dist-lib/`，再用本地静态服务器打开 `dist-lib/host-test.html` 验收

***

## 14. CI/CD 与部署

### 14.1 GitHub Pages 工作流（`.github/workflows/gh-pages.yml`）

| 项 | 内容 |
| ---- | ---- |
| `name` | `GitHub Pages` |
| 触发 | `push` 到 **`master`** 分支（没有 PR / 手动触发） |
| 构建 job | `build-gh-pages`，`runs-on: ubuntu-latest` |
| 部署 job | `deploy`，`needs: build-gh-pages`，`runs-on: ubuntu-latest` |

`build-gh-pages` 步骤：

1. `actions/checkout@v4`，`with: fetch-depth: 1`（浅克隆，**不是** 0）
2. `actions/setup-node@v4`，`node-version: '20'`，`cache: 'yarn'`
3. `yarn install`
4. `yarn build`（即先跑 `scripts/generate-update-log.js`，再 `vue-cli-service build`）
5. `actions/upload-pages-artifact@v3`，`with: path: dist`

`deploy` job：

- `permissions: { pages: write, id-token: write }`
- `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`
- 单步 `actions/deploy-pages@v4`，`id: deployment`

补充事实：

- 工作流**没有** lint / test / `build:lib` 步骤；`dist-lib/` 的发布不在本 workflow 内（库是手工 `yarn build:lib` + `yarn pack/publish` 的路线）。
- 上传的是 vue-cli 产物 `dist/`，其中 `public/` 下的 `basis/`、`img/icons/`、`robots.txt`、`update-log.json` 等会被原样拷入。
- 部署 URL 形如 `https://<user>.github.io/dsp_blueprint_editor/`，与 `vue.config.js` 的 `publicPath` 对应。
- 因为 `fetch-depth: 1` 且未开启 `fetch-tags`，CI 里通常拿不到 tag，`git describe --tags --always --dirty` 会退化成短提交 SHA；只有本地（或完整克隆）才会得到 `1.5.0-20-gb25a7a0` 这种「tag + 提交数 + 哈希」形态。

### 14.2 版本号与发版

| 项 | 值 / 机制 |
| ---- | ---- |
| `package.json#version` | `1.5.0`（`private: true`，不发布到 npm 公共源） |
| 构建期版本常量 | `vue.config.js` 的 `DefinePlugin` 注入 `VERSION = git describe --tags --always --dirty` |
| 源码里的入口 | `src/define.ts`：`declare const VERSION: string; export const version = VERSION;` |
| 展示位置 | `App.vue` 页脚（`App.vue:466` 渲染 `{{ version }}`） |
| 库构建的版本 | `scripts/lib-build/build.js` 的 `readVersion()`：同样先试 `git describe --tags --always --dirty`，非 git 环境或命令失败时退回 `package.json#version`，再不行 `'0.0.0'` |
| 发版动作 | `yarn release` → `standard-version --release-type minor --commit-message "chore: release v%VERSION"`，随后 `postchangelog` 钩子自动跑 `node scripts/generate-update-log.js` |

也就是说：**CHANGELOG 与 `public/update-log.json` 由发版命令一起更新**，而 GitHub Pages 部署只负责把当前 `master` 的构建产物推上去（不负责打 tag、不负责建 GitHub Release）。页脚显示的版本号在 CI 产物里通常是提交哈希，本地构建才是 tag 形态——排查「线上版本号看起来不对」时先看这一点。

***

## 15. 附：关键概念速查表

| 概念 | 位置 | 说明 |
| ---- | ---- | ---- |
| `BlueprintData` | `src/blueprint/parser.ts` | 解析后的蓝图根对象：`header{layout, icons, time, gameVersion, shortDesc, author, blueprintVersion, properties, desc}`、`version`、`cursorOffset`、`cursorTargetArea`、`dragBoxSize`、`primaryAreaIdx`、`areas`、`buildings`、`patch?`、`reformData?`、`tailExtraBytes?`。 |
| `version` | `src/blueprint/parser.ts` | body 版本：`1` = 旧版固定布局，每条建筑记录 61 字节（`encodedSize` 里 `61 * buildings.length`），参数按 parser 追加；`2` = 变长记录（含 marker / content / extraBytes / reformData / tailExtraBytes）。 |
| `headerFormatV2` | `src/blueprint/parser.ts` | 头部是否含 author / blueprintVersion / properties，由头部首字段 `1`/`0` 决定（`cells[0] === "1"`），与 body 的 `version` 解耦；导出时按 `bp.version >= 2` 写首字段。 |
| `V2_RECORD_MARKER` | `src/blueprint/parser.ts` | `-102`，v2 记录起始标记（0.10.34 导出用）；导入接受 `<= V2_RECORD_MARKER_MIN`（`-100`），因此兼容 `-101`。两个常量都是**模块内私有**，未导出。 |
| `v2ExtraPose` | `src/blueprint/parser.ts` | 分拣器在 yaw/tilt 之后附带的 7 个 float，语义未完全明确，字节级原样保留（`BlueprintBuilding.v2ExtraPose`）。 |
| `extraBytes` | `src/blueprint/parser.ts` | 单条建筑记录里「已知字段与下一记录起始之间」的未知扩展字节，原样保留以保证 round-trip。 |
| `tailExtraBytes` | `src/blueprint/parser.ts` | v2 body 尾部 `reformData` 之后的预留字节（0.10.33 实测 5 字节），原样保留。 |
| `content` | `src/blueprint/parser.ts` | `-102` 记录里的信标等自定义文本，按长度前缀读写的 UTF-8 字符串；空则不存在该字段。 |
| `reformData` | `src/blueprint/parser.ts`、`src/blueprint/reform.ts` | 星球地基（地形改造）数据：`{ reserved, rects[], customReformColorMask, customReformColors[] }`；`reform.ts` 负责把它渲染成地基网格。 |
| `parameterParsers` | `src/blueprint/parser.ts` | `itemId → ParamParser` 的 `Map`，覆盖全部已知建筑；未登记时 `parserFor()` 返回 `unknownParamParser`（且会把未知 itemId 动态登记成装配机 parser）。 |
| `Updater` | `src/command.ts` | 5 个 `EventDispatcher`：`updateBuildingIcon` / `updateBeltIcon` / `updateBeltIconSubscript` / `updateSorterIcon` / `updateStationInfo`，加上 `clearAll()`（场景重建前清空回调，避免陈旧引用）。命令改完数据后据此做**局部**刷新而非整场景重建。 |
| `silent` | `src/command.ts` | `Command` 接口标志位：`true` = 只改图标/颜色/文字/纯数据（仅 `stateVersion++`）；`false` 或省略 = 改了几何/拓扑（`stateVersion++` 且 `execVersion++`，3D 层重建）。 |
| `stateVersion` | `src/command.ts` | `CommandQueue` 的状态版本号 ref，**任何**命令（含 silent）、undo、redo、trim 都递增。`App.vue` 用 `watch` 监听它把 `codeExpired` 置 `true`。 |
| `execVersion` | `src/command.ts` | `CommandQueue` 的执行版本号 ref，仅非 silent 命令递增；`BlueprintEditor.vue` 的 `computed(b)` 依赖它触发整场景重建。 |
| `resetCamera` | `src/components/BlueprintEditor.vue`、`src/lib/core/RenderCore.ts` | 编辑器侧通过 `defineExpose` 暴露，内部调用 `applyHome()`：按 BVH 选择盒质心求球面锚点、按外接圆半径给距离、切向取「垂直于图纸长边」，再回到入场姿态（仰角 85°）。`App.vue.parseBp` 在「末尾 33 字符 MD5 后缀或建筑数变化」时调用它以重置视角。库侧 `RenderCore.resetCamera()` / `BlueprintViewer.resetCamera()` 是独立实现。 |
| `BVH` | `src/bvh/bvh.ts` | 自实现层次包围盒，加速鼠标射线与建筑选择盒求交；`BlueprintEditor` 通过 `b.bvh.boxes` 取选择盒世界矩阵。 |
| `IconTexture` | `src/iconTexture.ts` | 24×24 槽位的图标图集（每格 `ICON_SIZE = 80` px，整张 1920×1920），槽位 0 留给空图标；图标懒加载后 `copyTextureToTexture` 上传。`TextureSink` 抽出了 `initTexture` / `copyTextureToTexture` 两个方法以便单测注入。 |
| `buildingMeta` | `src/data/building.ts` | `Map<modelIndex, BuildingMeta>`：颜色、单位盒变换（`unitBoxTrans`）、选择盒变换（`selectUnitBoxTrans`）、图标变换（`iconTrans`），以及局部 z 轴向上的 `boxSize` / `boxCenter`。 |
| `findPosForAreas` | `src/blueprint/planet.ts` | 把蓝图多个分区摆回标准星球（默认 200 段），返回 `PositionedBlueprint { segment, areas[{longitude, latitude, segment}] }`。 |
| `calcBuildingTrans` | `src/blueprint/planet.ts` | 把建筑 `localOffset`（两端点）+ yaw/tilt 转成 3D 世界变换矩阵。 |
| `CommandQueue` | `src/command.ts` | 撤销栈，`maxSize` 默认 **256**（超出后从头部裁剪并 `stateVersion++`），`push` 时尝试与前一条 `merge` 合并连续命令。 |
| `noIconBuildings` | `src/data/building.ts` | 不渲染图标的 itemId 集合：四向分流器 2020、自动集装机 2040、流速监测器 2030、喷涂机 2313、电力感应塔 2201、无线输电塔 2202。 |
| `VERSION` | `vue.config.js` → `src/define.ts` | webpack `DefinePlugin` 注入的全局常量（`git describe --tags --always --dirty`），`define.ts` 把它导出为 `version` 供 `App.vue` 显示。 |
| `publicPath` | `vue.config.js` | `/dsp_blueprint_editor/`，由 `PUBLIC_PATH` 常量统一决定，与 GitHub Pages 子路径一致。 |
| `upgradeEdges` | `src/blueprint/upgrade.ts` | 升降级有向边（低级→高级）共 12 条：传送带 2001→2002→2003、分拣器 2011→2012→2013→2014、制造台 2303→2304→2305→2318、熔炉 2302→2315→2319、研究站 2901→2902、化工厂 2309→2317。`upAdj` / `downAdj` 是其正反向邻接表（模块内私有）。 |
| `reachableTargets(fromId)` | `src/blueprint/upgrade.ts` | 在升降级图上从 `fromId` 出发能到达的全部 itemId（升级 + 降级 + 跳级，基于 `reachN`），供 `ReplaceModal` 渲染目标建筑候选。 |
| `UpgradeCommand` | `src/blueprint/upgrade.ts` | 建筑升降级命令：改写 itemId / modelIndex / 参数，并按类型分流到 `dispatchIconUpdate` 的三个图标刷新通道。 |
| `SetAcceleratorCommand` | `src/blueprint/setAccelerator.ts` | 一键设置加速模式的 `silent` 命令：构造时快照每个建筑的原始模式，`do` 统一设为目标、`undo` 逐建筑精确恢复。作用范围是所有带 `acceleratorMode` 字段的参数（由 `assembleParamParser` / `labParamParser` 解析的制造台/熔炉/精炼厂/化工厂/对撞机/研究站）；支持 `buildingIndexes` 与 `labOnly` 过滤。`ReplaceModal` 在替换配方后会顺带推一条它来翻转模式。 |
| `AcceleratorMode` | `src/blueprint/parser.ts` | 加速模式枚举：`ExtraOutput = 0`（额外产出）、`Accelerate = 1`（生产加速）。注意数值顺序与直觉相反。 |
| `dispatchIconUpdate` | `src/blueprint/upgrade.ts` | `UpgradeCommand` 的私有图标刷新分流方法，按建筑类型分别派发到 `updateBeltIcon` / `updateSorterIcon` / `updateBuildingIcon`，避免走错通道。 |
| `calculateProductionStats(bp, options)` | `src/blueprint/stats.ts` | 生产统计（理论满速）：遍历建筑按配方节拍算每分钟产出/消耗，叠加增产剂倍率与功耗；分馏塔（2314）按固定 72 氢→72 重氢、不读配方；研究站研究模式下的矩阵消耗不受加速影响；未登记在 `buildingPowerMap` 的建筑直接跳过。`options` 为 `{ useAccelerator, acceleratorItem }`。 |
| `AcceleratorItem` / `acceleratorBonuses` | `src/data/acceleratorData.ts` | 增产剂等级枚举 `None=0 / MkI=1 / MkII=2 / MkIII=3` 与加成表：`accelerate`（生产加速倍率）、`extraOutput`（额外产出倍率）、`power`（耗电加成）、`sprayCapacity`（每瓶可喷涂物品数）。 |
| `buildingPowerMap` | `src/data/buildingPowerData.ts` | `Map<itemId, BuildingPowerData>`（`{basePower, speedMultiplier, canAccelerate}` 等），`stats.ts` 计算功耗、节拍与「是否允许加速」的依据。 |
| `REFORM_TYPE_GRID` | `src/blueprint/reform.ts` | 直铺地基类型常量 = `2`；同文件还有 `REFORM_TYPE_NONE = 0`、`REFORM_TYPE_IBEAM = 1`（默认工字铺）、`REFORM_TYPE_PLAIN = 7`（无装饰）。 |
| `DEFAULT_REFORM_COLORS` | `src/blueprint/reform.ts` | 游戏内置地基色板 **15** 色（索引 0..14）hex 表，模块内私有；槽位 `customReformColorMask` 未置位时取此表，置位时取 `customReformColors`（按置位槽位升序紧凑存储），共 32 个槽位。 |
| `resolveBuildingModel(modelIndex)` | `src/models/buildingModel.ts` | 模型解析：`glbName / glb / meta / placement / source`，按 modelIndex 缓存；任何异常只让 `glb = null`，绝不影响元数据回退。 |
| `modelTransformOf(modelIndex)` | `src/data/modelTransform.ts` | 取逐模型手调变换：`x/y/z`（格）、`pitch/yaw/roll`（度），可选 `upAxis/align/scale/color`；未登记返回全 0。 |
| `GlbModelInstances` | `src/models/glbInstances.ts` | GLB 实例化渲染组：每个子网格一个 `InstancedMesh`，矩阵 = 建筑世界矩阵 × placement × 子网格局部矩阵。 |
| `renderSettings` / `persistRenderSettings()` | `src/renderSettings.ts` | 渲染高级设置单例：`showRealModels` / `texturesEnabled` / `textures`（7 通道开关）/ `maxInstancesPerModel`；持久化在 **`sessionStorage`**（键 `dsp-blueprint-editor:render-settings`，`Infinity` ↔ `null`）。配合 `captureRenderSettings()`：设置只在「导入蓝图」时固化成已生效快照，中途重建仍按快照渲染。 |
| `getModelMappingReport()` | `src/models/buildingModel.ts` | 运行时权威映射报告：`availableFiles` / `mapped` / `unmappedBuildings` / `missingMetaModels` / `unusedFiles` / `failedModels`（条目含 `modelIndex`、`itemId`、`icon`、`variantIndex`、`glbName`、`candidates`）。 |
| `materialMapUrls` / `manifestTextureFiles` | `src/models/textureManifest.ts` | 「外部通道贴图」清单，**当前恒为空**：法线/自发光/spec 已全部内嵌进 GLB（KTX2），`materialMapUrls = {}`、`manifestTextureFiles = []`，`modelTextureUrl()` 恒返回 null。历史映射数据保留在 `tests/unit/scripts/texture-mapping.json`。 |
| `BlueprintViewer` | `src/lib/BlueprintViewer.ts`（入口导出 `src/lib/index.ts`） | 无头只读渲染器门面：持有一个 `RenderCore`，全部公开方法**不抛异常**，统一返回 `{ ok: true, value } \| { ok: false, error }` 并经 `onError` 上报；初始化 / 解析 / 定位 / 构建分阶段给 `ViewerError.phase`。发布面只有 4 个导出：`BlueprintViewer`、`parseBlueprint`、`serializeBlueprint`、`configureAssetBaseUrl`（另导出 `isModelCacheEnabled` / `setModelCacheEnabled` 与类型）。 |
| `RenderCore` | `src/lib/core/RenderCore.ts` | 编辑器与库共用的渲染内核：`Scene` + `PerspectiveCamera` + `WebGLRenderer` + `PlanetMapControls`，负责场景装配（`createPlanetScene` / `buildBuildings` / `buildBVH`）、选中与拾取、截图、主题、尺寸、`resetCamera`，以及增量预览层的生命周期。重建原因 `RebuildReason = "load" \| "settings" \| "data" \| "models"`。 |
| `preview-delta`（增量预览） | `src/lib/BlueprintViewer.ts`、`src/lib/core/RenderCore.ts`、`src/lib/preview/` | 生成过程中的流式预览：`beginPreview()` → 在宿主 `onProgress` 里逐条 `applyPreviewDelta(event)`（返回是否摄入）→ `commitPreview(blueprint)` 收尾；异常/中止走 `discardPreview()`。`previewing` / `previewStats()` 提供运行期状态（`lastIngestMs`、`maxIngestMs`、`moving`、`unknownRemoves` 等）。事件类型在 `src/lib/preview/types.ts` 里是**全可选的镜像类型**，宿主对象可直接传入。 |
| `PreviewLayer` | `src/lib/preview/PreviewLayer.ts` | 预览层本体：一个 `Group` + 按模型分组的槽池（`pools.ts`，`belt` / `inserter` / `glb` / `box` 四类，初始容量 4096/512/512/512，上限 `1 << 18`）。分两段：**摄入**（同步改 SoA 内存状态，不碰 GPU）与**呈现**（每帧指数收敛，只上传脏槽 `instanceMatrix` / `aOpacity`）。`sequence` 用 `>` 去重、`remove` 未知对象静默忽略、`replace` 未知对象按 add 处理、存活 <120ms 即被撤销的对象不出场（抖动抑制）。 |
| `coordinateSystem` | `src/lib/preview/types.ts`、`src/lib/preview/projector.ts` | 预览坐标语义，两个取值：`layout-grid-v1` = 生成中的**临时布局格坐标**（按流式 bbox 自动居中 + 等比缩放把跨度压到 `maxSpanDeg`（默认 63°）以内再投球面/切平面，不能当行星世界坐标直接用）；`blueprint-area-local-v1` = Area 局部坐标（走真实 `findPosForAreas` 结果，与正式场景的 `calcBuildingTrans` 一致）。未知值按 layout 处理；语义切换时**硬重投影、不插值**。 |
| `commitPreview(blueprint)` | `src/lib/BlueprintViewer.ts` | 预览收尾：**先建后换**——先解析并构建正式场景（此时预览层仍在显示），成功后 `discardPreview()`；蓝图串解析失败则先丢弃预览再返回错误，不留半截画面。 |
| `selectedBuildings(indexes)` | `src/lib/BlueprintViewer.ts` | 批量选中（v1 没有的能力）：`null`/空数组清空；每个元素先按数组下标、越界按建筑 ID 兜底解析；**先整体校验再提交**，任一找不到则整次失败且原选中不变；返回去重且保持传入顺序的下标数组。配合 `getSelectedIndex()` / `getSelectedIndexes()` / `selectBuilding()` 使用。 |
| `focusBuilding(index, options)` | `src/lib/BlueprintViewer.ts` | 镜头居中对齐到指定建筑且**不锁镜头**：相机搬到「建筑中心 + 建筑法线 × distance」并看向球心，控件目标点仍在球心，聚焦后缩放/旋转/平移照常。`options.select !== false` 时同时选中；`index === null` 等价 `resetCamera()`；建筑无 `buildingMeta` 时返回 `not-renderable` 且镜头不动。 |
| `exportBlueprintJSON()` | `src/lib/BlueprintViewer.ts`、`src/lib/blueprintJSON.ts` | 把当前数据导出成 2 空格缩进的 JSON 文本（`Date` → ISO 串、`Uint8Array` → 可还原对象）；配套 `loadBlueprintJSON(text)` 无损还原，`blueprintJSON.ts` 提供 `parseBlueprintJSON` / `stringifyBlueprintJSON` / `formatBlueprintJSON` 与 `JSONImportError`（code 为 `json-syntax` / `json-shape`）。 |
| `describeBuild(input)` | `src/lib/core/describeBuild.ts` | 从一次构建产物生成可快照的诊断对象 `BuildDescription`：`settings`、`buildingCount`、`perModelIndex`（total/glb/fallback/hidden）、`glbGroups`、`fallbackBoxCount`、`unknownModelIndexes`、`selectBoxes`（矩阵元素四舍五入到 6 位）、`subscriptCount`、`iconCount`。用于阶段快照基线、线上定位、以及 Viewer / Editor 一致性校验。**不进入发布面**（`src/lib/index.ts` 只在注释里提到它）。 |
| `modelCache` | `src/models/modelCache.ts` | 建筑 GLB 的浏览器持久化缓存（Cache Storage，缓存名 `MODEL_CACHE_NAME = "dsp-models-v1"`，MIME `model/gltf-binary`）。由页面直接读写、不依赖 service worker；缓存键是带 `[contenthash:8]` 的最终 URL，所以不需要版本表。开关关闭或环境不支持时 `getModelCache()` 返回 `NoopModelCache`（读未命中 / 写失败 / 清单空 / 清空 0 条，完全不碰 `caches`）。 |
| `setModelCacheEnabled` / `isModelCacheEnabled` | `src/models/modelCacheConfig.ts` | 持久化总开关的运行时覆盖层。优先级：运行时覆盖 > 构建期注入的 `__DSP_MODEL_CACHE_ENABLED__` > 默认值（`true`）。编辑器用 `config/persistence.config.js` 的 `web` 字段，发布库用 `lib` 字段（默认 `false`，宿主显式 `setModelCacheEnabled(true)` 才落盘；传 `null` 恢复构建配置值）。 |
| `modelPack`（离线模型包） | `src/models/modelPack.ts` | 把全部建筑模型一次性下载并持久化，用于「断网随便翻蓝图」。`isPackSupported()`（= `isModelCacheActive()`）、状态 `{supported,total,cached,missing,missingBytes,pruned}`、`downloadPack({signal,onProgress})` 按文件粒度汇报进度；已缓存的不算入本次 `total`，因此「取消 → 再点」是断点续传。`missingBytes` 由构建期注入的 `__DSP_MODEL_BYTES__` 估算，未注入时为 `null`（只显示数量）。入口是设置面板「高级」里的按钮，不自动预取。 |
| KTX2（`ktx2.ts`） | `src/models/ktx2.ts` | KTX2 / Basis Universal 运行时支持：懒加载 `KTX2Loader`，`setTranscoderPath()` 指向 `public/basis/`（编辑器走注入常量 `__DSP_TRANSCODER_BASE__ = '/dsp_blueprint_editor/basis/'`，库走 `resolveAssetUrl("basis/")`），并须在 `new WebGLRenderer()` 之后调 `setKtx2Renderer(renderer)` 以 `detectSupport` 决定 GPU 格式。契约是**永不 throw、永不 reject**，拿不到就返回 `null` 让 `glbLoader` 走「元数据盒」兜底。 |
| `textureFallback` | `src/models/textureFallback.ts` | 缺失底色贴图的兜底：按 `<模型名>::<材质名>` 查 `missingAlbedoColorOverrides`，否则按材质名启发式（含 `black` → 深黑、`glass` → 玻璃蓝灰、`water` → 水蓝），最后落中性灰 `0x8f9498`，生成 1×1 `DataTexture` 顶到 `material.map`，避免整块渲染成纯白。 |
| `update-log` | `scripts/generate-update-log.js` → `public/update-log.json` → `src/swStatus.vue` | 更新弹窗的数据链路：构建期从 `CHANGELOG.md` 最新段落生成 `{version,date,items}`；运行时 `swStatus.vue` 用 `fetch(`${process.env.BASE_URL}update-log.json?t=<时间戳>`, { cache: "no-store" })` 取最新版，24 小时静默期（`localStorage` 键 `app.updateModal.snoozedUntil`），并被排除在 workbox precache 之外。 |
| `assetResolver` | `src/lib/assets/assetResolver.ts`（库）、`src/lib/assets/assetResolver.webpack.ts`（编辑器）、`src/lib/assets/assetBaseUrl.ts` | 资产解析层，由 webpack 别名 `@lib/asset-resolver$` 二选一：webpack 实现用 `require.context` / 模板字符串 `import()`，URL 由 `publicPath` 生成；runtime 实现是纯字符串拼接 + 构建期注入的 `__DSP_LIB_ASSET_INVENTORY__`（保证「文件不存在 → 直接回退」而不发 404）。`assetBaseUrl.ts` 负责资产根探测：`configureAssetBaseUrl(base)` 显式指定，否则 ESM 用 `import.meta.url`、UMD 回落到加载本库的 `<script src>`。 |

***

## 16. 建筑模型渲染系统（GLB + 内嵌 KTX2 贴图）

建筑外观来自 `src/assets/icons/models/` 下的 **73 个 `.glb`（合计 127.98 MB）**，素材包能提供的法线 / 自发光 / spec-gloss 通道图已离线烘进 GLB 并统一编码为 KTX2（`KHR_texture_basisu`），运行时不再加载任何建筑 PNG。整条链路的每一步都遵守「GLB 优先、元数据盒兜底」：解析、加载、实例化、材质任一环节失败，只是该建筑回退成 `@/data/building` 的彩色方块，不会中断渲染。

本节覆盖 §16.1~§16.8；渲染高级设置（开关与存储）与离线模型包的界面入口见本章后续小节。

### 16.1 模块总览

模型链路由三部分组成：`src/models/` 下的 14 个运行时模块、`src/data/` 的两张数据表，以及 `scripts/glb-ktx2/` 的离线转换管线。

| 文件 | 职责 |
| ---- | ---- |
| `src/models/glbAssets.ts` | 模型名注册表：`availableModelNames`（来自 `@lib/asset-resolver` 的静态清单）、5 条别名/变形规则、`modelNameCandidates()` / `resolveModelName()` / `modelUrl()`（Promise 缓存）。自身不再写 `require.context`。 |
| `src/models/buildingModel.ts` | 解析器：`modelIndex → Item.models 下标 → Item.icon → GLB`、`buildModelPlacement()` 放置矩阵、解析结果缓存、变更订阅、`getModelMappingReport()`。 |
| `src/models/glbLoader.ts` | 加载器：懒加载 + `loaded / pending / failed` 三层缓存 + 并发闸门（`MAX_CONCURRENT_LOADS = 10`）+ 超时（`DEFAULT_TIMEOUT_MS = 30000`）+ 本地持久化缓存读写 + 成功监听 + 释放；契约「永不 reject」。 |
| `src/models/glbInstances.ts` | `GlbModelInstances`：每个 GLB 子网格一个 `InstancedMesh`，几何/材质直接复用 GLB 缓存对象。 |
| `src/models/ktx2.ts` | `KTX2Loader` 懒加载、转码器目录解析（`__DSP_TRANSCODER_BASE__` / `resolveAssetUrl("basis/")`）、`detectSupport(renderer)`、失败降级为 `null`。 |
| `src/models/textureFallback.ts` | 缺底色贴图的材质用 1×1 纯色 `DataTexture` 兜底（按 `<模型名>::<材质名>` 解析颜色）。 |
| `src/models/textureManifest.ts` | 外部通道贴图清单；**当前为空**（文件 1848 B）。只保留 `MaterialMapUrls` / `MaterialMapFiles` 类型与三张空表。 |
| `src/models/textureMaps.ts` | 历史外置 PNG 的加载/去重/15s 超时/`flipY = false`/spec-gloss → ORM 现场打包。当前只有 `setTextureMaxAnisotropy()` 仍被编辑器调用，通道贴图路径不再触发。 |
| `src/models/materialTextures.ts` | 把「GLB 内嵌贴图（KTX2）」与调参挂到 `MeshStandardMaterial`，并遵守 `TextureSettings` 的通道开关。 |
| `src/models/modelMaterialTuning.ts` | 73 个模型（= 当前 GLB 数量）的 `emissiveIntensity / envMapIntensity / metalness` 手调表，以及默认值。 |
| `src/models/envMap.ts` | 程序化中性环境反射：256×128 渐变 canvas → PMREM，只挂 `material.envMap`。 |
| `src/models/modelCache.ts` | Cache Storage 持久化缓存（缓存名 `dsp-models-v1`）：`ModelCache` 接口、`getModelCache()`、`NoopModelCache` 与便捷读写函数。 |
| `src/models/modelCacheConfig.ts` | 持久化全局开关：读构建期 `__DSP_MODEL_CACHE_ENABLED__`，并提供运行时覆盖 `setModelCacheEnabled()`。 |
| `src/models/modelPack.ts` | 「离线模型包」：`resolvePackFiles / inspectPack / downloadPack / clearPack`，只补缺失文件、按文件粒度报进度、`AbortController` 可取消。 |
| `src/data/modelTransform.ts` | 逐模型偏移/旋转/缩放/着色表（**62 行**，与 `buildingMeta` 同键）。 |
| `src/data/building.ts` | `buildingMeta`（62 条）：`unitBoxTrans` / `selectUnitBoxTrans` / `boxSize` / `boxCenter`；后两者是 GLB 对齐的数据来源。 |
| `src/lib/core/buildBuildings.ts` | 建筑装配总入口：分类、GLB 分组、实例化、回退盒、图标、`BuildStats`（编辑器与库共用）。 |
| `src/lib/core/AllBuildings.ts` | 一次蓝图全部可渲染对象的容器；`dispose()` 跳过 `userData.sharedResource` 的几何。 |
| `src/lib/assets/assetResolver.webpack.ts` / `assetResolver.ts` | GLB 清单与 URL 的两种实现：编辑器用 `require.context`；库构建用构建期注入的资产清单 + `resolveAssetUrl()`。 |
| `scripts/glb-ktx2/` | 「外置 PNG → GLB 内嵌 → KTX2」三段式离线管线，外加 `copy-basis-transcoder.mjs`（把 three 的 Basis 转码器拷进 `public/basis/`）。 |
| `tests/unit/scripts/` | 历史诊断/生成脚本（`gen-texture-manifest.mjs`、`prune-model-textures.mjs`、`verify-glb-mapping.ts`、`check-glb-extensions.ts`、`inspect-glb.ts`）与历史映射表 `texture-mapping.json`；运行期不依赖。 |

当前素材规模（自行复核，见 §16.6 与自查报告）：

- `src/assets/icons/models/` 下**只有 73 个 `.glb`**，没有子目录、没有 PNG；单文件最大 `turret-plasma.glb`（5.51 MB）。
- 73 个文件内嵌图像合计 **312 张，全部为 `image/ktx2`**；其中 65 个 GLB 声明 `KHR_texture_basisu`，其余 8 个不含任何图像：`belt-1/2/3`、`energy-exchanger-mcl-0/1/2`、`space-capsule`、`stone-wall`。
- 调用关系：编辑器 `src/components/BlueprintEditor.vue` 与库 `src/lib/core/RenderCore.ts` 都调用 `buildBuildings()`；两者在建渲染器后都会 `setKtx2Renderer(renderer)`。`src/App.vue` 用 `import(/* webpackChunkName: "model-pack" */ "@/models/modelPack")` 懒加载离线包模块。
- 发布形态：`yarn build:lib` 把 GLB 复制到 `dist-lib/models/`、把 `public/basis/` 复制到 `dist-lib/basis/`；**UMD 与 ESM 两个产物都内联 three**（`scripts/lib-build/build.js` 的校验会因为 ESM 出现 `from "three"` 而判失败），宿主不需要自带 three。`src/lib/index.ts` 顶部「ESM（`three` 外置）」的注释已过期，以构建脚本为准。

### 16.2 解析链与回退策略（glbAssets.ts + buildingModel.ts）

```text
modelIndex
  └─ modelIndexItems（遍历 itemsMap：Item.models 的每个下标 → { itemId, itemName, icon, variantIndex }）
       └─ Item.icon ──iconModelAliases──▶ 候选模型名（variants 优先，其次 primary + fallbacks）
            └─ availableModelNames（编译期静态文件清单）──▶ 首个存在的名字
                 └─ *.glb
```

- **文件名真相**：GLB 文件名 = `itemsData.ts` 条目的 `icon` 字段，不是中文名。例如「无线输电塔」的 `icon` 是 `charging-pole`，对应 `charging-pole.glb`。
- **清单来源**（`glbAssets.ts` 只读 `assetResolver.glbModelNames()`）：
  - 编辑器构建：`assetResolver.webpack.ts` 里的 `require.context("../../assets/icons/models", false, /\.glb$/i)`；`keys()` 是编译期静态文件名列表，**判定「文件不存在」零网络请求**；
  - 库构建：`scripts/lib-build/assetInventory.js` 扫描磁盘，经 DefinePlugin 注入 `__DSP_LIB_ASSET_INVENTORY__`，`assetResolver.ts` 用其中的 `models/<name>.glb` 集合做 O(1) 判定；
  - 单测：`jest.config.js` 的 `globals` 提供同一份清单。
  - 三种实现都只提供「静态文件清单」，因此 `resolveModelName()` 不会先发 404 再回退。
- `availableModelNames` 读取失败时打印 `[glb] 读取模型清单失败，全部建筑回退元数据表` 并退化为空集合，不会抛错。
- **URL 解析**：`modelUrl(name)` 先查 `urlCache: Map<string, Promise<string | null>>`；未注册返回 `null`；`assetResolver.glbModelUrl()` 抛错也只 `warn` 并返回 `null`。同一个名字只解析一次。
- **别名/变形表** `iconModelAliases` 共 **5 条**：

| `Item.icon` | 解析结果 | 类型 |
| ---- | ---- | ---- |
| `assembler-1` | `assembler-1` | 显式登记（旧 `assembler.glb` 已清理，**没有** `assembler` 回退） |
| `splitter-4dir` | 按 `variantIndex` 取 `splitter-a / splitter-b / splitter-c`（`Item.models = [38,39,40]` 的下标 0/1/2） | 变形 variants |
| `accumulator-full` | `accumulator` | 别名（蓄电器与蓄电器〔满〕共用模型 46） |
| `mining-drill` | `mining-drill` | 显式登记（避免两代采矿机被合并） |
| `mining-drill-mk2` | `mining-drill-mk2` | 显式登记（`mk2` 是导出名 = 大型采矿机） |

- `modelNameCandidates(iconName, variantIndex = 0)`：有 `variants` 时下标先 `clamp` 到 `[0, variants.length - 1]`，只返回该变形；否则返回 `[primary, ...fallbacks]`；未登记时返回 `[iconName]`。
- **禁止模糊匹配**：未登记且文件名与图标名不一致的一律视为未匹配 → 回退元数据表，避免把 A 建筑的模型错挂到 B 建筑上。
- **`modelIndex → Item` 的反向索引**：`buildingModel.ts` 在模块加载时遍历 `itemsMap` 建 `modelIndexItems: Map<number, ModelItemRef[]>`。同一 `modelIndex` 可以被多个 `Item` 引用（例如蓄电器 / 蓄电器〔满〕共用 46），因此值始终是数组；`buildingModelName()` 按数组顺序逐个尝试，返回第一个能解析出文件的名字。
- `resolveBuildingModel(modelIndex)` 返回 `ResolvedBuildingModel`：

| 字段 | 含义 |
| ---- | ---- |
| `modelIndex` | 输入模型号 |
| `glbName` | 解析出的 GLB 文件名（不含扩展名）；`null` = 该建筑没有外部模型 |
| `glb` | 已加载完成的 `LoadedGlbModel`；`null` = 未加载 / 加载失败 / 无外部模型 |
| `meta` | `buildingMeta.get(modelIndex)`，回退基准，始终保留 |
| `tint` | `modelTransformOf(modelIndex).color ?? null`，真实模型着色 |
| `placement` | GLB 模型空间 → 建筑局部空间的矩阵；无 GLB 时为单位矩阵 |
| `source` | `'glb'`（`glb !== null && meta !== undefined`）/ `'meta'` / `'unknown'` |

- 整个解析与放置过程包在 `try/catch` 中：任何异常只让 `glb = null`、`placement = 单位矩阵`，`meta` 照常返回；结果按 `modelIndex` 缓存在 `resolvedCache`。
- `requestBuildingModel(modelIndex)` 只在「有 `glbName`、`glb === null`、且该 `modelIndex` 尚未请求过（`requested` 集合）」时调 `loadGlbModel()`，fire-and-forget，失败也只是继续回退。
- 模型到达后：模块级 `onGlbModelLoaded()` 回调清空 `resolvedCache` 并逐个通知 `onBuildingModelsChanged()` 的订阅者；订阅者抛错被 `warn` 吞掉。
- `getModelMappingReport()` 是运行时权威映射报告，返回 6 个字段：

| 字段 | 含义 |
| ---- | ---- |
| `availableFiles` | 磁盘上实际存在的 GLB 名（升序） |
| `mapped` | 已匹配到 GLB 的 `modelIndex` 条目 |
| `unmappedBuildings` | 有 `buildingMeta` 但没匹配到 GLB、回退元数据表的条目 |
| `missingMetaModels` | 有 GLB 但没有 `buildingMeta`、目前无法渲染的条目 |
| `unusedFiles` | 磁盘上存在但没有被任何模型引用的文件 |
| `failedModels` | 加载失败（负缓存）的模型名 |

  每个 `ModelMappingEntry` 含 `modelIndex / itemId / itemName / icon / variantIndex / glbName / candidates`。`unusedFiles` 的判定会把同一 `modelIndex` 所有引用图标的全部候选文件都登记为「已使用」，因此蓄电器这种多 Item 共用模型不会误报。当前 `src/` 与 `tests/` 中都没有调用点，供人工核对与实现报告使用（`tests/unit/models/modelMapping.spec.ts` 校验的是解析结果本身，不是这个报告对象）。

### 16.3 加载器（glbLoader.ts）

| 场景 | 行为 |
| ---- | ---- |
| 正常 | 写入 `loaded`（`Map<string, LoadedGlbModel>`），逐个回调监听器（监听器抛错只 warn），返回 `{ name, url, scene, bbox }`。 |
| 文件不存在 | `modelUrl()` 返回 `null` → 记入 `failed` 负缓存 → 返回 `null`。 |
| HTTP 非 2xx | `throw new Error("HTTP <status>")` → 记入 `failed` → 返回 `null`。 |
| 空场景 / 空包围盒 | `GLB 中没有可用场景` / `GLB 包围盒为空` → 记入 `failed` → 返回 `null`。 |
| 超时（`DEFAULT_TIMEOUT_MS = 30000`，覆盖 `modelUrl + fetch + parse`） | `withTimeout()` 抛错，同时 `controller.abort()` 主动断掉底层 fetch，返回 `null`。 |
| 并发请求同一模型 | 复用 `pending` 里的同一个 Promise（去重），结束后从 `pending` 删除。 |
| 并发请求多个模型 | 信号量闸门 `MAX_CONCURRENT_LOADS = 10`：`acquireSlot()` / `releaseSlot()` 用 `activeLoads` + `waitingSlots` 队列实现。 |
| 失败后再次请求 | `failed` 命中直接返回 `null`；需要重试时调用 `resetGlbFailure(name?)`（不传则清全部）。 |
| 本地缓存命中 | `readCachedModel(url)` 返回非空 Response 就直接用，**一个网络请求都不发**（断网也成立）；持久化关闭时它是 `NoopModelCache`，恒未命中。 |
| 首次从网络拿到 | 解析前 `storeCachedModel(url, buffer.slice(0))` 落盘；复制是必须的，KTX2 转码会把 `bufferView` transfer 给 worker，原 `ArrayBuffer` 可能被 detach。 |
| 本地副本解析失败 | `removeCachedModel(url)` 删掉该条缓存并照常记负缓存，避免坏数据永久命中「白模」。 |
| 释放 | `releaseGlbModel(name)` / `releaseAllGlbModels()`：释放几何、材质与材质上的非共享贴图（`userData.sharedTexture === true` 的贴图跳过）。 |

- 对外 API：`loadGlbModel(name, options?)`、`getLoadedGlbModel(name)`、`isGlbModelLoaded(name)`、`glbFailedModels()`、`onGlbModelLoaded(cb)`（返回取消订阅函数）、`resetGlbFailure(name?)`、`releaseGlbModel(name)`、`releaseAllGlbModels()`、`reapplyLoadedModelMaterials(settings?)`。
- 贴图设置注入：`setSettingsProvider(provider | null)` 注入「当前生效设置」读取函数；`currentTextureSettings()` 在未注入或读取抛错时回退 `DEFAULT_TEXTURE_SETTINGS`（`texturesEnabled: true` + 7 通道全开）；`resolveTextureSettings(override?)` 优先显式参数。编辑器注入的是 `getAppliedRenderSettings()`（导入蓝图时固化的快照），`RenderCore` 在 `options.textureSettings` 未提供时注入自己的 provider。
- `LoadedGlbModel`：`name`（不含 `.glb`）、`url`（最终 URL，带内容哈希）、`scene`（原型场景根，**不要直接加进场景**）、`bbox`（`Box3`，未做方向/缩放处理）。
- **`GLTFLoader` 本身懒加载**：`parseGlb()` 里 `await import(/* webpackChunkName: "gltf-loader" */ "three/examples/jsm/loaders/GLTFLoader.js")`，首屏不为解析器付费。拿到实例后 `getKtx2Loader()`，非 `null` 才 `setKTX2Loader()`；为 `null` 时行为与改造前一致。
- 加载成功后 `void applyModelMaterialTextures(model, currentTextureSettings()).catch(...)`：通道贴图**不 await**，没到之前先显示底色，到了材质原地更新；失败只 `warn`。
- `reapplyLoadedModelMaterials(settings?)` 遍历所有已加载模型按当前设置重挂贴图（材质是共享对象，原地生效，不重建场景）；`buildBuildings` 在 `reapplyMaterials !== false` 时调用它，`RenderCore` 重建时显式传 `reapplyMaterials: false`，只有 `texturesEnabled` 变化才单独重挂。
- 监听器抛错、`controller.abort()` 抛错都被 `try/catch` 吞掉，**`loadGlbModel()` 永不 reject**。

### 16.4 放置矩阵与变换表（buildingModel.ts + data/modelTransform.ts）

- 格 → 世界单位来自 `src/planetConstants.ts`（唯一来源，不支持运行时修改）：

```ts
PLANET_RADIUS   = 200.2
PLANET_SEGMENT  = 200
GRID_PER_SEGMENT = 5
HEIGHT_GRID_SIZE = 4 / 3                    // 垂直格
GRID_HORIZONTAL  = (2π / 200 / 5) * 200.2   // ≈ 1.2579，水平格
```

- 建筑局部空间约定（与 `buildingMeta.unitBoxTrans` 完全一致）：`x / y` 水平，`+z` 指向星球法线（向上）；`meta.boxSize = [x 宽, y 深, 高度]`、`meta.boxCenter = [x, y, z]`。二者在 `building.ts` 里由 `buildingMetaRaw` 的 `box` / `offset` 派生：`boxSize = [box[0], box[2], box[1]]`、`boxCenter = [offset[0], offset[2], offset[1]]`（只做轴向重排，不改数值）。`selectUnitBoxTrans` 用于 `buildBuildings` 里 GLB 建筑的 `modelRef.matrix` 锚点。
- `buildModelPlacement(glb, meta, modelIndex, transformOverride?)` 的变换顺序（与 `buildingModel.ts` 逐行一致）：

```text
1) 朝向修正：upAxis === 'y'（默认）时 Rx +90°，把 glTF 的 +y 映射到建筑局部 +z；upAxis === 'z' 时为单位矩阵
2) 缩放：scale = (t.scale ?? 1) × [align === 'height' 且模型高度 > 1e-6 时 clamp(boxHeight / modelHeight, 1/3, 3)]
3) 旋转：Roll(绕 Y) → Pitch(绕 X) → Yaw(绕 Z)，角度按 DEG_TO_RAD 转弧度
4) 平移：把「变换后的模型包围盒中心」对到「元数据盒心 + 格单位偏移」，偏移最后乘在平移量上
```

- 缩放收紧区间 `AUTO_SCALE_MIN = 1/3`、`AUTO_SCALE_MAX = 3`：`buildingMeta` 的盒高多为近似值，个别 GLB 实测高度差数倍，超出部分用 `modelTransform` 的 `scale` 逐条修正。
- 偏移**不受旋转影响**：`x` / `y` 乘 `GRID_HORIZONTAL`、`z` 乘 `HEIGHT_GRID_SIZE`，直接加在最终平移量上（`z: -8` 永远往下 8 格）。
- 没有元数据时（`meta === undefined`）：`targetX = targetY = 0`，`targetZ = (modelHeight × scale) / 2`，把模型底面贴到原点平面。当前 `buildBuildings` 不会为无元数据的建筑请求 GLB，这条分支只在显式调用时出现。
- `modelTransform` 字段：

| 字段 | 含义 | 单位 |
| ---- | ---- | ---- |
| `x` / `y` / `z` | 左右 / 前后 / 上下偏移 | 格 |
| `pitch` | 俯仰，绕 X 轴 | 度 |
| `yaw` | 水平旋转，绕 Z 轴（竖直轴） | 度 |
| `roll` | 侧倾，绕 Y 轴 | 度 |
| `scale` | 等比缩放系数（默认 1） | — |
| `color` | 可选，真实模型着色 `0xRRGGBB`（乘到实例颜色上） | — |
| `upAxis` / `align` | 可选高级项，默认 `'y'` / `'height'` | — |

- 表规模：**62 行**，与 `buildingMeta` 的 62 条一一对应；其中 **29 行**至少有一项非默认，其余 **33 行**的变换值全为默认（全 0 + `scale: 1`），**8 行**带 `color`。当前没有任何一行使用 `upAxis` / `align`。
- 29 行非默认项（未列出的项均为 0 / 1）：

| modelIndex | 建筑 | 非默认项 |
| ---- | ---- | ---- |
| 38 / 39 / 40 | 四向分流器 a / b / c | `z: -0.4` |
| 257 | 自动集装机 | `z: -0.5`, `scale: 1.4` |
| 208 | 流速监测器 | `z: -0.1` |
| 120 | 喷涂机 | `y: -0.3`, `z: -0.4`, `yaw: -180`, `scale: 1.3` |
| 371 | 物流配送器 | `z: -0.5`, `scale: 1.2` |
| 51 / 52 | 小型 / 大型储物仓 | `z: -0.3`, `scale: 1.2` |
| 121 | 储液罐 | `z: -0.5` |
| 44 | 电力感应塔 | `z: -0.1` |
| 71 | 无线输电塔 | `scale: 0.5` |
| 68 | 卫星配电站 | `z: -13.5`, `scale: 1.8` |
| 53 | 风力涡轮机 | `z: -3`, `scale: 2` |
| 255 | 地热发电站 | `z: -12.5`, `scale: 2` |
| 55 | 太阳能板 | `z: -1`, `scale: 0.5` |
| 74 | 垂直发射井 | `z: -4`, `scale: 2` |
| 57 | 采矿机 | `z: -1`, `scale: 0.8` |
| 256 | 大型采矿机 | `z: 0.5`, `scale: 1.2` |
| 60 | 抽水站 | `z: -1` |
| 61 | 原油萃取站 | `scale: 1.2` |
| 63 | 原油精炼厂 | `yaw: -180`, `scale: 1.2` |
| 69 | 微型粒子对撞机 | `yaw: 180`, `scale: 1.5` |
| 70 | 矩阵研究站 | `scale: 2` |
| 455 | 矩阵研究站 Mk.II | `scale: 2`, `color: 0x365258` |
| 403 | 信标 | `scale: 2` |
| 422 | 干扰塔 | `z: -2.3` |
| 453 | 战场分析基站 | `z: 1.2`, `yaw: -180`, `scale: 1.6` |
| 664 | 全息信标 | `z: -2`, `scale: 2.2` |

- 8 行带 `color`：65 制造台 Mk.I `0xedab5c`、66 Mk.II `0x38e5e1`、67 Mk.III `0x45c6e5`、456 Mk.IV `0x365258`、62 电弧熔炉 `0x739ce5`、194 位面熔炉 `0xc84f58`、457 熔炉 Mk.III `0x365258`、455 矩阵研究站 Mk.II `0x365258`（其中 455 已出现在上一张表，其余 7 行的变换值全为默认）。
- **本表只作用于真实加载成功的 GLB**：`buildModelPlacement()` 只在 `glb !== null` 时被调用，因此这些数值不会影响元数据盒渲染；GLB 缺失/加载失败时回退渲染与未接入本表时完全一致。
- `tests/unit/models/modelTransform.spec.ts` 校验：每行都能对应真实存在的 `.glb`、与 `buildingMeta` 键集合完全一致（长度为 62）、7 个核心数值都写满且为有限数、旋转 `|v| <= 360`、偏移 `|v| <= 100`、`scale > 0`。

### 16.5 实例化渲染（glbInstances.ts + lib/core/buildBuildings.ts）

- `GlbModelInstances extends Group`，构造签名 `(model: LoadedGlbModel, placement: Matrix4, buildingTransforms: readonly Matrix4[], tint: number | null = null)`，`name = "glb:<模型名>"`，`meshes` 暴露本组创建的 `InstancedMesh[]`。
- `collectParts(root)`：`root.updateMatrixWorld(true)` 后遍历，**每个普通网格一个 part**（`isSkinnedMesh === true` 的跳过，避免实例化后骨骼错位）；part 保存 `geometry` / `material`（原引用，不复制）、`localMatrix = matrixWorld.clone()`。
- 每个子网格一个 `InstancedMesh(part.geometry, part.material, count)`：几何/材质与 GLB 缓存共用，显存只有一份；`userData.sharedResource = true`；`frustumCulled = false`（实例散布在球面，几何自身包围球不适用视锥剔除）。
- 实例矩阵 = `建筑世界矩阵 × placement × 子网格局部矩阵`；传了 `tint` 时逐实例 `setColorAt(i, new Color(tint))`。`count === 0` 或 `parts.length === 0` 时只返回空组（不抛错），调用方据此整组回退。
- `buildBuildings(transforms, buildings, options)`（`src/lib/core/buildBuildings.ts`）是编辑器与库共用的装配入口，返回 `{ buildings: AllBuildings, stats: BuildStats, iconTexture }`。`options` 含 `settings: ViewerRenderSettings`、`textureSink`、可复用的 `iconTexture`、`reapplyMaterials?`（默认 `true`）、`textureSettings?`、`textStyle?`。
- `buildBoxes` 的 5 步（只处理非传送带、非分拣器的建筑）：
  1. 对每个建筑调用 `resolveBuildingModel(modelIndex)`，异常时记为 `null`（resolver 内部已兜底，这里只是双保险）；
  2. `settings.showRealModels` 为真时统计 `glbInstanceCounts`：**计数口径是「存在 `glbName` 且有 `meta` 的建筑数」**，与 GLB 是否已加载无关 —— 这样同一蓝图同一设置的渲染结果与加载时序无关，不会「先白模、加载后再跳回 GLB」；
  3. 分组：无 `meta` 的未知建筑直接进回退集（并记入 `unknownModelIndexes`，不为它下载 GLB）；`showRealModels && 计数 <= maxInstancesPerModel && r.glb !== null && r.meta !== undefined` 时按 `modelIndex` 进 `glbGroups`，其余进 `fallback`；进 `fallback` 但有 `glbName`、`glb === null`、有 `meta` 的建筑调 `requestBuildingModel()`；
  4. 对每个 GLB 组 `new GlbModelInstances(...)`，抛错或 `meshes.length === 0` 时把该组建筑全部推回 `fallback`，其余建筑不受影响；成功则记 `perModelGlbCounts[modelIndex]`，并为每栋建筑写 `modelRef[b.index] = { matrix: 建筑中心世界矩阵 }`（含 `meta.selectUnitBoxTrans` 的锚点偏移）；
  5. 回退集统一用 `BoxGeometry(1,1,1)` + `MeshLambertMaterial` 的一个 `InstancedMesh`：`transforms × meta.unitBoxTrans` + `setColorAt(meta.color)`；无 `meta` 的未知建筑放退化矩阵 `makeScale(0,0,0)` 占位（不可见、不报错），颜色 `0xdddddd`。
- `modelRef` 保持旧语义：GLB 建筑存 `{ matrix }`（建筑中心世界矩阵，供 `SpitterInfo` 等做投影），元数据盒/传送带/分拣器存 `{ mesh, instance }`；两种形态由 `BuildingModelRef` 联合类型表达。
- `maxInstancesPerModel` 的默认值取决于设置来源：编辑器 `renderSettings.ts` 默认 **1024**，库 `BlueprintViewer` 默认 **Infinity**；判定在构建期完成，运行期改这个值需要重建场景。
- 模型到达 → `onBuildingModelsChanged` → **150 ms 节流** → 编辑器 `modelVersion++` 触发 `b` computed 重建；`RenderCore.scheduleModelRebuild()` 同样 150 ms 合并，重建后还会 `preview.resyncModels()`。节流的意义是避免 N 个模型各触发一次整场景重建。
- `AllBuildings.dispose()` 遍历场景：`InstancedMesh` 先 `dispose()`，`userData.sharedResource` 为真的不释放 `geometry`；普通 `Mesh` 同样跳过共享几何。图标图集 `IconTexture` 由调用方（`RenderCore`）统一释放。
- `BuildStats` 字段：`buildingCount / glbGroupCount / glbInstanceCount / fallbackBoxCount / hiddenCount / unknownModelIndexes / iconCount / subscriptCount / cargoCount / perModelGlbCounts`。
- **传送带 / 分拣器仍走程序化几何**（圆柱 + 连杆 + `Cargos` 货物动画），不接 GLB；`isBelt()` / `isInserter()` 决定分类。
- 预览层（`src/lib/preview/pools.ts`）也复用 `resolveBuildingModel()` / `requestBuildingModel()`，但它用 `collectGlbParts()` 并把几何 **clone**（预览层要往几何上挂 `aOpacity` 属性），不经过 `GlbModelInstances`。

### 16.6 KTX2 内嵌贴图与转码管线（ktx2.ts + public/basis + scripts/glb-ktx2）

优化后的 GLB 里贴图是 KTX2（`KHR_texture_basisu`），这是 glTF 的 **required 扩展**：没挂 `KTX2Loader` 的 `GLTFLoader` 会直接抛错，而不是静默降级，所以「先转 GLB、后改代码」会让所有模型看起来全坏。

**运行期接入（`src/models/ktx2.ts`）**

| API | 行为 |
| ---- | ---- |
| `setKtx2Renderer(renderer)` | 注册渲染器；重复调用传入不同渲染器时重置缓存 loader（能力集可能不同，必须重新 `detectSupport`）。传 `null/undefined` 直接忽略。 |
| `isKtx2Supported()` | 是否已注册渲染器（有渲染器即有 KTX2 解析能力）。 |
| `getKtx2Loader()` | 懒加载 `import(/* webpackChunkName: "ktx2-loader" */ "three/examples/jsm/loaders/KTX2Loader.js")`，`new KTX2Loader()` → `setTranscoderPath(transcoderPath())` → `detectSupport(renderer)`；未注册渲染器时打印一次 warn 并返回 `null`；初始化失败同样返回 `null`，且**不缓存失败**（`loaderPromise = null`），允许下次重试。 |
| `disposeKtx2Loader()` | 渲染器销毁时调用，清空 `rendererRef` 与 `loaderPromise`（`RenderCore` 的 dispose 已调用）。 |

- 转码器目录 `transcoderPath()`：优先构建期常量 `__DSP_TRANSCODER_BASE__`（`vue.config.js` 的 DefinePlugin 注入 `PUBLIC_PATH + 'basis/'`，因此编辑器里是 `/dsp_blueprint_editor/basis/`），常量不存在时回退 `resolveAssetUrl("basis/")`（库宿主把 `dist-lib/` 搬到任何子目录或 CDN 都能命中 `basis/basis_transcoder.js`）。`setTranscoderPath()` 要求**末尾带斜杠**，函数会补齐。
- 不能用 `process.env.BASE_URL`：webpack 5 不注入 `process`，该分支会被常量折叠删掉，最后退化成相对当前 JS chunk 的 `/js/basis/` → 404 → 所有模型退回元数据盒（已实测踩过）。
- `public/basis/` 只有两个文件：`basis_transcoder.js`（62 358 B）与 `basis_transcoder.wasm`（499 935 B，合计 562 293 B ≈ 549 KB）。由 `scripts/glb-ktx2/copy-basis-transcoder.mjs` 从 `node_modules/three/examples/jsm/libs/basis/` 原样拷贝（`--check` 只检查是否就位，并会提示目录里混入的旧版额外文件）。
- 降级链路：`glbLoader.parseGlb()` 里 `getKtx2Loader()` 为 `null` 时不调用 `setKTX2Loader()` → 带 KTX2 的 GLB 由 `GLTFLoader` 抛错 → 由加载器既有的 `catch` 记负缓存、返回 `null` → 该建筑回退元数据盒。整个过程不向用户抛异常。
- 发布形态：`scripts/lib-build/build.js` 把 `public/basis/` 拷到 `dist-lib/basis/`，并在校验阶段要求这两个文件存在；同时把 73 个 GLB 拷到 `dist-lib/models/`，并断言 `dist-lib/img/models` 下没有通道贴图（已内嵌）。

**离线转换管线（`scripts/glb-ktx2/`）**

```text
原始（改造前）                        管线产物
src/assets/icons/models/*.glb   ┐
  + <建筑目录>/*-a/-n/-e/-s.png ├─ 01-embed-textures.mjs → temp/ktx2/01-embedded/*.glb（PNG 内嵌 + ORM 打包）
                                └─ 02-encode-ktx2.mjs   → temp/ktx2/02-ktx2/*.glb（ETC1S / UASTC）
                                    03-verify.mjs --apply → src/assets/icons/models/*.glb（备份在 temp/ktx2/backup-original）
```

- 为什么必须分三段：`gltf-transform etc1s/uastc` 只处理**已挂在正确槽位**上的贴图，不认识 `<建筑>/<文件>.png` 的外置约定；色彩空间是按槽位推导的（必须先挂槽位再编码，否则得到发灰的贴图）；`-s` 是 Unity spec-gloss，必须在编码前重打包成 ORM。
- **阶段 1 `01-embed-textures.mjs`**：读 `tests/unit/scripts/texture-mapping.json`（MD5 锚定生成的权威映射），用 `sharp` 读 PNG、`@gltf-transform/core` 的 `NodeIO` 写 GLB；法线 → `normalTexture`、自发光 → `emissiveTexture`、`-s` → 离线重打包 ORM 后写 `metallicRoughnessTexture`。关键副作用：
  - `emissiveFactor` 归零（运行期开启自发光时 `materialTextures` 才把 factor 改成白色，否则关闭自发光后整块材质会白到发光）；
  - 有 `-s` 时 `metallicFactor = 1`、`roughnessFactor = 1`（金属度作为乘数交给运行期 `tuning.metalness`）；
  - ORM 打包与 `textureMaps.packOrm()` 逐像素等价：`R = 255`、`G = (1 - A) × 255`（粗糙度）、`B = 0.299R + 0.587G + 0.114B`（金属度）；
  - 同一模型内同一 PNG 只生成一个 Texture 节点；文件名后缀（`-a/-e/-n/-s`）只作旁证，与清单冲突时只告警（清单优先）。
  - 参数：`--only <正则>`、`--concurrency <n>`（默认 4）；产物 `temp/ktx2/01-embedded/` 与 `_report.json`；**只读 `src/`**。
- **阶段 2 `02-encode-ktx2.mjs`**：对 `temp/ktx2/01-embedded/` 调 `@gltf-transform/cli`，按槽位分两遍：

| 遍次 | `--slots` | 编码 | 参数 |
| ---- | ---- | ---- | ---- |
| 1 | `{baseColorTexture,emissiveTexture}` | ETC1S | `--quality 128`（`--qlevel 128`）、`--compression 2`（`--clevel 2`）、`--mipmaps` |
| 2 | `{normalTexture,metallicRoughnessTexture,occlusionTexture}` | UASTC | `--level 2`、`--rdo --rdo-lambda 4`、`--zstd 18`、`--mipmaps` |

  - 法线图**不会**吃到 RDO：`gltf-transform` 的 `toktx` 命中 `*normal*` 槽就整段跳过 `--uastc-rdo`（KTX-Software #600，RDO 会伤法线方向精度），这是期望行为。
  - 参数：`--only`、`--concurrency`（默认 2）、`--jobs`（默认 4，单文件内 ktx 线程数）、`--force`（重编已有产物）、`--resize`；子进程 stdout/stderr 写 `temp/ktx2/logs/*.log`（不走管道，避免大日志与受限环境 EPERM）；CLI 入口优先用 `node_modules/@gltf-transform/cli/bin/cli.js`。
- **阶段 3 `03-verify.mjs`**：只读校验（任一失败非 0 退出），逐项检查 `extensionsRequired` 含 `KHR_texture_basisu`、所有 `images[]` 的 `mimeType` 为 `image/ktx2` 且无外链 `uri`、每个 `images[].bufferView` 以 KTX2 魔数 `AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A` 开头、每个材质的每个贴图槽 → `textures[].extensions.KHR_texture_basisu.source`、`buffers[]` 无外链、以及「清单里声明有 normal/emissive/spec 的材质，产物里对应槽位仍在」。加 `--apply` 才回写 `src/assets/icons/models/`，并把原文件备份到 `temp/ktx2/backup-original/`。
- 当前仓库状态：源 PNG 与 `<建筑目录>/` 已全部移除（`src/assets/icons/models/` 只有 73 个 `.glb`），`temp/` 也不在仓库中（管线中间产物，可丢），因此**阶段 1 在当前仓库上无法直接重跑**（它依赖 `texture-mapping.json` 指向的原图）；已有的 GLB 都是管线产物：312 张内嵌图像全部为 `image/ktx2`，65 个 GLB 带 `KHR_texture_basisu`。
- 独立 Demo：`scripts/glb-ktx2/ktx2-demo.html`（不依赖本项目构建，用 CDN three 打开一个内嵌 KTX2 的 GLB，可切换「置空 / 纯色占位 / 恢复」三种情形）。
- 常见坑（脚本 README 里逐条记录，运行期也适用）：色彩空间由 `--assign-tf` 在 KTX2 头部写死、法线永远不要 ETC1S、`-s` 不能直接当 `roughnessMap`、`flipY` 必须为 `false`、`setTranscoderPath()` 末尾斜杠、必须调 `detectSupport()`、`--mipmaps` 不能关、不要把 `prune --keep-solid-textures` 和 KTX2 混跑。

### 16.7 贴图兜底（textureFallback.ts）

- 触发条件：**材质本身没有底色图**（GLB 里 `map` 为空）。典型来源是 `*-black`（黑漆结构件）、`*-glass-back`（玻璃背面）、`DefaultMaterial`（导出时没赋材质的网格），以及 `space-capsule` / `belt-*` 这种整个文件都不含图像的模型。glTF 里这些材质的 `baseColorFactor` 是默认白色，three 会把整块渲染成刺眼的纯白。
- 颜色解析顺序：
  1. 显式表 `missingAlbedoColorOverrides`（键 = `<模型名>::<材质名>`；无材质网格的材质名是空串，键写成 `<模型名>::`）；
  2. 材质名启发式：含 `black` → `0x101216`、含 `glass` → `0xa8bcc4`、含 `water` → `0x2e6f8e`；
  3. 默认中性灰 `0x8f9498`。
- 显式表当前 **11 条**：`space-capsule::`、`belt-1::` / `belt-2::` / `belt-3::`、`stone-wall::stone-wall`、`fusion-reactor::fusion-reactor-effect`、`piler::piler-mask`、`energy-exchanger-mcl-0/1/2::Default-Material`、`vertical-launching-silo::DefaultMaterial`。
- 贴图构造：`missingAlbedoTexture(modelName, materialName)` 按颜色缓存（`Map<number, DataTexture>`，同一颜色全局只建一次），1×1 `RGBAFormat` + `UnsignedByteType`；`colorSpace = SRGBColorSpace`（否则渲染偏亮）、`flipY = false`（与 glTF UV 约定一致）、`magFilter/minFilter = LinearFilter`、`generateMipmaps = false`、`userData.sharedTexture = true`（不随单个材质释放）、`name = "fallback-albedo-<RRGGBB>"`。
- 接入点：`materialTextures.applyModelMaterialTextures()` 里用**快照里的原始 `map`** 判断（重跑时 `material.map` 可能已被上次改成兜底贴图），为 `null` 才算缺底色；每个材质只 `console.info` 一次（`WeakSet` 去重），日志形如 `[tex] 材质 <模型>::<材质> 缺少底色贴图，使用纯色兜底 #...`。
- 兜底只影响「底色」这一项：`settings.textures.albedo` 关闭时 `material.map` 直接置 `null`（回到纯色材质，不用兜底图）；正常通道（法线/自发光/ORM）仍按 §16.8 流程处理。

### 16.8 材质接入与调参（materialTextures.ts + modelMaterialTuning.ts + textureManifest.ts）

**入口**：`applyModelMaterialTextures(model: LoadedGlbModel, settings: TextureSettings): Promise<number>`

- 收集模型场景里所有 `isMeshStandardMaterial === true` 的材质，按 `uuid` 去重（同一材质只改一次）；场景里没有标准材质时返回 0。
- 首次接触某材质时把原始状态存入 `originalStates: WeakMap` 快照：`map / metalness / roughness / normalMap / emissiveMap / emissive[r,g,b] / emissiveIntensity / metalnessMap / roughnessMap`，供关闭某通道时逐项恢复。
- 返回值是「真正挂上了通道贴图的材质数」；函数设计契约是不 reject，并且调用方（`glbLoader`）仍统一 `.catch()`，失败只保留底色。
- 通道贴图的**权威来源优先 GLB 内嵌**（KTX2 化之后的常态），`textureManifest` 的外部 PNG 只在「GLB 里没有该通道」时才作为回退：

| 通道 | 优先级 |
| ---- | ---- |
| 法线 | `快照.normalMap`（内嵌）→ `textures.normal`（外部 PNG）→ 无 |
| 自发光 | `快照.emissiveMap`（内嵌）→ `textures.emissive`（外部 PNG）→ 无 |
| spec/ORM | `快照.roughnessMap ?? 快照.metalnessMap`（内嵌）→ `textures.orm`（外部 PNG 现场打包）→ 无 |

- `bakedCovers` 判定：清单里声明了的通道，如果 GLB 快照里都已有对应贴图，就**完全不下载/解码任何 PNG**（`textures` 传 `null`），连 `loadMaterialTextureSet()` 都不调。这正是「某个 GLB 一旦烘进通道图，运行期就零 PNG 请求」的灰度机制。
- 逐项应用（`settings = texturesEnabled + 7 通道开关`）：
  1. **底色**：`texturesEnabled && textures.albedo` 时 `material.map = 快照.map ?? 兜底纯色`；否则 `null`。
  2. **环境反射**：对所有标准材质都设 `material.envMap = getBuildingEnvironment()`、`envMapIntensity = tuning.envMapIntensity`（玻璃/金属都有反射可吃，避免发黑）。
  3. **金属度/粗糙度**：`texturesEnabled && textures.spec && orm !== null` 时 `metalness = clamp01(tuning.metalness)`（作乘数）、`roughness = 1`、`metalnessMap = roughnessMap = orm`；否则 `metalness = clamp01(tuning.metalness × METALNESS_WITHOUT_SPEC_MAP)`（`METALNESS_WITHOUT_SPEC_MAP = 0.25`）、`roughness = 快照.roughness`、两张贴图恢复快照值。
  4. **自发光**：`texturesEnabled && textures.emissive && emissive !== null` 时 `emissive` 设为白色 `(1,1,1)`、挂 `emissiveMap`、`emissiveIntensity = tuning.emissiveIntensity`；否则恢复快照的 `emissive` 与 `emissiveIntensity`。
  5. **法线**：`texturesEnabled && textures.normal && normal !== null` 时挂 `normalMap` 并 `normalScale.set(1, 1)`（`NORMAL_SCALE_X/Y = 1`；若上机发现凹凸方向相反，把 `NORMAL_SCALE_Y` 取负即可）；否则恢复快照。
  6. 末尾 `material.needsUpdate = true`。
- 材质是 GLB 缓存里的**共享对象**，原地修改即对已建好的实例生效；设置变更后 `glbLoader.reapplyLoadedModelMaterials(settings)` 重跑同一流程，但**不重建场景**（编辑器 `BlueprintEditor.vue` 注入的是 `getAppliedRenderSettings()` 快照，`RenderCore` 在 `setRenderSettings` 里按 `texturesEnabled` 变化触发重挂）。
- **环境贴图（`envMap.ts`）**：只设 `material.envMap` / `envMapIntensity`，**不设 `scene.environment`**（否则行星本体与经纬网格会一起泛白）；生成、注入与「库侧没有调用」的现状见 §16.9。
- **调参表（`modelMaterialTuning.ts`）**：`modelMaterialTunings` 键 = `.glb` 文件名（不含扩展名），当前 **73 条**，与 GLB 数量一致；每条都显式写出三个值，当前**全部为 `emissiveIntensity: 1.0` / `envMapIntensity: 0.8` / `metalness: 1.0`**（即结构性占位，尚未按模型微调）。`resolveModelMaterialTuning(modelName)` 用 `DEFAULT_MODEL_MATERIAL_TUNING` 补齐缺字段；默认值 `{ emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 }`。每条后的注释标注了该模型实际可用的通道图（`〔n+e+s〕` / `〔n+s〕` / `〔无通道图〕`）。
- 调参语义：`emissiveIntensity` 只在有自发光图时有意义；`envMapIntensity` 是整批偏暗时的第一顺位；`metalness` 在有 `-s/ORM` 时是乘数、没有时按 0.25 缩放后作为固定金属度。调参建议区间：`envMapIntensity` 0.6~1.2、`emissiveIntensity` 0.6~1.5、`metalness` 0.4~1.0。
- **贴图清单（`textureManifest.ts`，1848 B）已空**：`materialTextureFiles = {}`、`materialMapUrls = {}`、`manifestTextureFiles = []`，因此 `materialTextures` 里 `materialMapUrls["模型::材质"]` 恒为 `undefined`、`hasMaterialTextures()` 恒为 `false`，外部 PNG 路径在运行期不再触发。保留空表是刻意的：一旦登记某个文件，编辑器构建的 `assetResolver.modelTextureUrl()` 会把对应 PNG 重新拉进 webpack 依赖图，库构建也会把它们拷进 `dist-lib/img/models/`（会多出约 200 MB 的已内嵌素材）。
- 历史数据：`tests/unit/scripts/texture-mapping.json`（**126 条**材质记录、覆盖 **65** 个 GLB；带 normal 65、emissive 59、spec 67、至少一张 67）仍是 `scripts/glb-ktx2` 的输入与清理脚本的核对依据，**运行期不读**。
- `textureMaps.ts` 的现状：`setTextureMaxAnisotropy(value)` 仍被 `BlueprintEditor.vue` 用 `renderer.capabilities.getMaxAnisotropy()` 注入，但只有该模块自己构造的外置 PNG 贴图会用到 `anisotropy`；KTX2 内嵌贴图由 `KTX2Loader` 创建，当前没有设置各向异性。其余能力（`LOAD_TIMEOUT_MS = 15000` 单图超时、`flipY = false`、`imageCache`/`setCache` 两级 Promise 去重、失败返回 `null` 且整体不 reject、`packOrm()` 现场重打包）都保留在代码里，因为在清单重新登记外部贴图时仍是唯一位图加载通道。
- 已知缺口（原素材就没有该图）：`inserter-1..4`、`monitor`、`splitter-a/b/c` 没有自发光图；`smelter-2-glass-1/2` 没有法线图 —— 现在这些信息体现在 `texture-mapping.json` 的历史记录里，运行期由「内嵌有就挂、没有就不挂」自然处理，不会再出现下载失败。

> ⚠️ 待确认：`tests/unit/scripts/` 下的历史脚本（`gen-texture-manifest.mjs`、`prune-model-textures.mjs`）仍按「脚本位于 `scripts/`」计算仓库根（`REPO = resolve(HERE, '..')`），在当前 `tests/unit/scripts/` 位置直接运行会把模型目录解析成 `tests/unit/src/assets/icons/models`；它们是否仍被维护/使用、重跑前是否需要修路径，需要维护者确认。

### 16.9 环境反射（envMap.ts）

`src/models/envMap.ts`（73 行）只做一件事：用 `PMREMGenerator` 从一张**程序化生成的天空/地面渐变图**造出中性环境贴图，再交给建筑材质当 `material.envMap`，**不引入任何外部资源文件**。

为什么需要它：GLB 的 glTF 材质默认 `metallicFactor = 1`，场景里没有环境贴图时，金属面只剩方向光的镜面高光，其余部分直接算成黑色——这正是贴了 `-s`（spec-gloss）之后金属面「发黑」的根因。

| 导出 | 签名 | 语义 |
| ---- | ---- | ---- |
| `getBuildingEnvironment` | `(): Texture \| null` | 当前建筑材质使用的环境贴图；未初始化或生成失败时为 `null` |
| `setBuildingEnvironment` | `(texture: Texture \| null): void` | 由场景初始化处注入；传 `null` 表示关闭环境反射 |
| `createNeutralEnvironment` | `(renderer: WebGLRenderer): Texture \| null` | 程序化生成 PMREM 环境贴图；失败返回 `null`（调用方按「无环境反射」降级） |

模块级状态只有一个 `let buildingEnvironment: Texture | null = null`，即全局单例——所有模型共用同一张环境图，不会每个模型各生成一张。

`createNeutralEnvironment` 的生成步骤：

1. `document.createElement("canvas")`，尺寸固定 **256×128**；`getContext("2d")` 返回 `null` 时直接 `return null`。
2. `createLinearGradient(0, 0, 0, canvas.height)` + `fillRect` 铺满，5 个停靠点（0.0 在天顶、1.0 在地面）：

   | 位置 | 颜色 | 注释里的含义 |
   | ---- | ---- | ---- |
   | 0.0 | `#c9d6e5` | 天顶 |
   | 0.42 | `#f2f4f6` | 高空散射 |
   | 0.5 | `#dfe2e4` | 地平线 |
   | 0.58 | `#8b9096` | 地面反射带 |
   | 1.0 | `#33383d` | 地面 |

3. `new CanvasTexture(canvas)`，设 `mapping = EquirectangularReflectionMapping`、`colorSpace = SRGBColorSpace`。
4. `new PMREMGenerator(renderer)` → `compileEquirectangularShader()` → `fromEquirectangular(source)` 得到 render target。
5. `pmrem.dispose()`、`source.dispose()` 之后 `return target.texture`——只释放生成器与源 canvas，**返回的 render target 纹理本身保留**（再 dispose 就什么都没了）。
6. 整个过程包在 `try/catch` 里：异常时 `console.warn("[env] 中性环境贴图生成失败，建筑材质将没有环境反射", e)` 并返回 `null`。

接线与消费：

- 唯一注入点：`src/components/BlueprintEditor.vue:194`，在 `setTextureMaxAnisotropy(...)`、`setKtx2Renderer(renderer)` 之后执行 `setBuildingEnvironment(createNeutralEnvironment(renderer))`。
- 唯一消费点：`src/models/materialTextures.ts:173-174`，对每个 `MeshStandardMaterial` 设 `material.envMap = getBuildingEnvironment()` 与 `material.envMapIntensity = tuning.envMapIntensity`（`tuning` 来自 `modelMaterialTuning.ts`）。

**不设 `scene.environment`**：全仓库 `grep scene.environment` 只命中注释，没有任何赋值。一旦设了全局环境，行星本体、经纬网格、图标也会被环境光洗亮、整屏泛白。

> ⚠️ 已知边界：`src/lib/**`（`BlueprintViewer` / `RenderCore`）**没有**调用 `createNeutralEnvironment`，也没有任何 `envMap` 注入点，因此发布库（`dist-lib/`）里 `getBuildingEnvironment()` 恒为 `null`，金属面只吃场景方向光，观感会比编辑器暗。见 §16.14。

### 16.10 渲染高级设置（renderSettings.ts + renderSettingsTypes.ts）

两个文件分工明确：

| 文件 | 职责 | 依赖 |
| ---- | ---- | ---- |
| `src/renderSettings.ts` | 面板侧的**响应式单例** + 「已生效」快照 + `sessionStorage` 读写 | `import { reactive } from "vue"` |
| `src/renderSettingsTypes.ts` | **纯类型**定义（`TextureChannelSwitches` / `TextureSettings` / `ViewerRenderSettings` / `FullRenderSettings`） | 零运行时依赖，**不 import vue** |

这样拆的原因：`materialTextures.ts`、`glbLoader.ts`、`src/lib/core/**` 需要知道「贴图设置长什么样」，但不能把 Vue 拖进本应纯 TS 的渲染内核。

**字段与真实默认值**（`defaultSettings()`，注意与旧文档的 `true` / `Infinity` 不同）：

| 字段 | 类型 | 默认值 | 作用 |
| ---- | ---- | ---- | ---- |
| `showRealModels` | `boolean` | **`false`** | 总开关；关闭后全部回退元数据方块 |
| `texturesEnabled` | `boolean` | **`false`** | 贴图总开关；关闭后不挂任何通道贴图 |
| `textures` | `Record<TextureChannel, boolean>` | 7 个通道**全 `true`** | 逐通道开关；总开关关闭时这些值不生效 |
| `maxInstancesPerModel` | `number` | **`1024`** | 同一模型最多用 GLB 渲染的实例数；`Infinity` = 无限 |

`TextureChannel` 是 7 个字面量的联合类型：`"albedo" | "normal" | "spec" | "emissive" | "effect" | "dirt" | "glass"`（对应 `-a` / `-n` / `-s` / `-e` / `-eff` / `-dirt` / `-glass`）。

**持久化**：键 `dsp-blueprint-editor:render-settings`，存 **`sessionStorage`**（刷新保留、关标签页清空）。约定 `Infinity` 序列化为 `null`，读取时 `null` 还原成 `Infinity`。

- `loadSettings()` 逐字段做类型校验：布尔字段非 `boolean` 就忽略；`textures` 逐通道校验；`maxInstancesPerModel` 为 `null` → `Infinity`，为有限正数 → `Math.floor`，其余（含 `0`、负数、`NaN`）保留默认值。`sessionStorage` 不可用或 JSON 损坏 → 静默用默认值（不是抛错，也不是整块丢弃）。
- `persistRenderSettings()`：`Number.isFinite` 为真就写数值，否则写 `null`；`setItem` 失败只影响「刷新后保持」，不影响当前会话。
- 模块导入时即执行 `export const renderSettings = reactive(loadSettings())`，所以设置面板是最新值、不需要额外初始化调用。

**「已生效」快照**（这是理解设置生效时机唯一的钥匙）：

| 导出/内部 | 说明 |
| ---- | ---- |
| `appliedSettings`（模块内私有） | 普通对象，初值 = 启动时（含 `sessionStorage` 恢复）的 `renderSettings` |
| `getAppliedRenderSettings()` | 渲染层唯一读取入口；返回上面那个对象 |
| `captureRenderSettings()` | 把当前面板设置拷贝进快照；**只在导入蓝图时**由 `App.vue` 的 `parseBp` 调用（`App.vue:1100`） |

由此得出两条硬语义：

1. 改面板只影响**下次导入**；中途任何原因的建场景（剔除建筑、撤销/重做、GLB 模型加载完成触发重建）都仍按导入时的值渲染。
2. 快照必须是普通对象：建场景发生在 Vue `computed` 里（`BlueprintEditor.vue` 的 `b`），若那里直接读响应式 `renderSettings`，设置就会被收集成 computed 依赖，改一个开关立刻**整场重建**，与上面的语义相反——`renderSettings.ts` 的注释专门锁了这一点。

编辑器侧还有一条独立通道：`BlueprintEditor.vue:168` 调 `setSettingsProvider(() => getAppliedRenderSettings())`，把「贴图设置从哪读」注入 `glbLoader`，供 `reapplyLoadedModelMaterials()` 原地重挂贴图用。它**不是** `SettingsPort`（`SettingsPort` 只在发布库侧存在，见下）。

**面板 UI**（`App.vue` 侧栏「操作」标签页最后一个条目，折叠标题 `t("高级")`）：

| 控件 | i18n 键 | 细节 |
| ---- | ---- | ---- |
| 折叠按钮 | `高级` | `advancedOpen` 默认 `false`；展开时才去数一次本地缓存（见 §16.12） |
| 总开关 | `展示真实模型` | `v-model="renderSettings.showRealModels"`；下载离线包期间 `:disabled="packBusy"` |
| 贴图总开关 | `开启贴图` | `v-model="renderSettings.texturesEnabled"`；同样受 `packBusy` 影响 |
| 通道列表 | `反照率`/`法线`/`高光/粗糙`/`自发光`/`特效`/`污渍`/`玻璃` | 每行 = 中文名 + `<code>-a</code>` 后缀 + 开关；`texturesEnabled` 关闭或 `packBusy` 时整列禁用（容器加 `.disabled`） |
| 数量文本框 | `渲染最大模型` | `:value="maxModelText"`，`@change="commitMaxModel"`；`Infinity` 显示为 `t("无限")` |
| 滑块 | `无限` | `min=1`，`max=limitSliderMax + 1 = 2049`；`limitSliderMax = 2048`，最右一档赋成 `Infinity` |
| 生效提示 | `设置已修改，重新导入蓝图后生效` / `修改后需重新导入蓝图才能生效` | 前者在 `settingsDirty` 为真时显示（`dirty` class 变红），后者是常态提示 |

- `effect` / `dirt` / `glass` 三项在 `textureChannels` 里标了 `unavailable: true`，作用是**悬停提示**「当前素材包未提供该通道贴图」。注意：它们**不会**被单独禁用（输入框只受 `texturesEnabled` 与 `packBusy` 控制），开关能拨动但不产生任何效果。
- `parseLimitText()` 接受 `无限` / `∞` / `inf` / `infinite` / `infinity`（大小写与首尾空格都归一）→ `Infinity`；空串或非有限数 → **保持原值**；其余取 `Math.max(1, Math.floor(value))`。
- 面板上任何改动都会触发 `watch(renderSettings, { deep: true })`：立即 `persistRenderSettings()` 并置 `settingsDirty = true`。导入蓝图后 `captureRenderSettings()` + `settingsDirty = false`，提示回到常态文案。

**发布库侧**（`src/lib/BlueprintViewer.ts` + `src/lib/core/RenderCore.ts`）：

- `ViewerOptions` 提供 `initialSettings?: Partial<ViewerRenderSettings>`，以及三个平铺语法糖 `showRealModels` / `texturesEnabled` / `maxInstancesPerModel`（同时给出时**平铺字段优先**，用条件展开构造，避免给 readonly 属性赋值报 TS2540）。
- `settingsPort?: SettingsPort`：`{ read(): ViewerRenderSettings; write(patch): void }`。缺省用进程内存里的 `LocalSettingsPort`；编辑器场景则由宿主传入（`read: () => renderSettings`、`write: p => Object.assign(renderSettings, p)`）。
- `BlueprintViewer.setRenderSettings(partial)` → `port.write(partial)` 后 `core.setRenderSettings(port.read())`。
- `RenderCore.setRenderSettings(patch)` 的生效路径分三档：`showRealModels` / `maxInstancesPerModel` 变更 → `rebuildScene("settings")`（分组决策在建场景时做，必须重建）；`texturesEnabled` 变更 → `reapplyLoadedModelMaterials(textureSettingsProvider())`（材质是共享对象，原地重挂，不重建）；`previewAnimation` 变更 → 只调 `preview.setAnimate(...)`。
- 库侧默认值 `DEFAULT_SETTINGS = { showRealModels: true, texturesEnabled: true, maxInstancesPerModel: Infinity, previewAnimation: "auto" }`。

> ⚠️ 待确认：`BlueprintViewer.ts` 的注释写「默认设置：与 `@/renderSettings` 的默认值保持一致」，但编辑器 `defaultSettings()` 实际是 `false` / `false` / `1024`，库侧是 `true` / `true` / `Infinity`——两处并不一致。是「库为了开箱即用故意不同」，还是注释与实现各自漂移，需要作者确认后统一（文档当前按代码事实分别记录）。

`renderSettingsTypes.ts` 中的 `previewAnimation?: PreviewAnimationMode`（`"auto"` / `"on"` / `"off"`）是**发布库独有的运行时开关**，编辑器面板没有对应控件；声明为可选，宿主省略等价于 `auto`。`renderSettings.ts` 末尾还有一处编译期断言 `const _renderSettingsCompat: FullRenderSettings = null as unknown as RenderSettings`，任一侧字段改名/改类型都会在此报错。

### 16.11 本地持久化缓存（modelCache.ts + modelCacheConfig.ts + config/persistence.config.js）

模型是懒加载的：只下载真的出现在蓝图里的那几个。为了「看过的模型断网也能看」，需要一层**浏览器本地持久化**，选型是 Cache Storage 而不是 IndexedDB——它天生就是「按 URL 存 Response」，命中判定、整体清理、按 URL 覆盖都是原生语义，不用自己维护 ArrayBuffer 序列化与版本表。

**常量与接口**（`src/models/modelCache.ts`）：

| 名称 | 值 / 签名 | 说明 |
| ---- | ---- | ---- |
| `MODEL_CACHE_NAME` | `"dsp-models-v1"` | 缓存名；只放建筑模型 GLB |
| `MODEL_CONTENT_TYPE` | `"model/gltf-binary"` | 写入时的 MIME（读取方按 ArrayBuffer 解析，标注只是给 DevTools 看的） |
| `ModelCache.kind` | `"cache-storage" \| "noop"` | 后端身份，诊断/单测用 |
| `ModelCache.read` | `(url: string) => Promise<Response \| null>` | 未命中 / 不可用 / 读失败一律 `null`，永不抛错 |
| `ModelCache.store` | `(url, data: Blob \| ArrayBuffer, contentType?) => Promise<boolean>` | 返回是否真的写进去了；失败只 `warn` |
| `ModelCache.remove` | `(url: string) => Promise<boolean>` | 删单条（本地副本损坏时用） |
| `ModelCache.keys` | `() => Promise<Set<string>>` | 缓存里已存在的**绝对 URL** 集合 |
| `ModelCache.clear` | `() => Promise<number>` | 清空整个缓存，返回删除条目数 |

便捷函数全部转发给 `getModelCache()`，因此自动继承「关闭即空操作」语义：`readCachedModel` / `storeCachedModel` / `removeCachedModel` / `cachedModelUrls` / `clearModelCache`。

**键的归一化**：`modelCacheKey(url)` 用 `new URL(url, document.baseURI).href` 转成绝对 URL；没有 `document`（Node 单测）或 URL 非法时原样返回。读写与比对都走它，避免同一文件出现两种键。

**三层判定，不要混用**：

| 函数 | 判什么 | 典型用法 |
| ---- | ---- | ---- |
| `isModelCacheEnabled()`（在 `modelCacheConfig.ts`） | **只判开关**，与浏览器能力无关 | 界面区分「构建配置关闭」与「浏览器不支持」两种文案 |
| `isModelCacheSupported()` | 只判能力：`typeof caches !== "undefined" && typeof caches.open === "function"` | 内部 |
| `isModelCacheActive()` | 开关 **且** 能力 | 「能不能存」的唯一判定入口（`modelPack` 用它） |

**空操作后端**（Null Object）：开关关闭或环境不支持时，`getModelCache()` 返回 `Object.freeze` 过的 `NoopModelCache`（`kind: "noop"`）：读恒 `null`、写恒 `false`、删恒 `false`、清单恒空 `Set`、清空恒 `0`，并且**完全不碰 `caches`**（连 `caches.open` 都不调）、不打印日志。所以「关闭」与「不可用」是同一条降级路径，调用方（`glbLoader` / `modelPack` / 宿主）不需要任何分支判断。真实后端每个方法也都各自 `try/catch`，失败只 `console.warn` 并返回「未命中 / 失败」，绝不影响本次渲染。

**开关的优先级**（`src/models/modelCacheConfig.ts`）：

| 优先级 | 来源 | 实现 |
| ---- | ---- | ---- |
| 1（最高） | 运行时覆盖 | `setModelCacheEnabled(enabled: boolean \| null)`；`null` = 恢复构建配置值 |
| 2 | 构建期注入常量 | `__DSP_MODEL_CACHE_ENABLED__`（缺失或为 `null` 时读不到） |
| 3（兜底） | 默认值 | `DEFAULT_ENABLED = true`（未配置的宿主 / Node 单测保持「看过的模型可离线」） |

`readBuildSwitch()` 用 `typeof __DSP_MODEL_CACHE_ENABLED__ === "undefined"` 守卫，常量不存在时返回 `null`；`buildEnabled` 在模块加载时算一次，`runtimeOverride` 之后可随时改。`setModelCacheEnabled` 只认 `true`，其余真值一律归为 `false`（`enabled === null ? null : enabled === true`）。

**唯一配置源** `config/persistence.config.js`：

```js
module.exports = { web: true, lib: false };
```

| 消费方 | 注入 | 值 |
| ---- | ---- | ---- |
| `vue.config.js`（编辑器 / PWA） | `__DSP_MODEL_CACHE_ENABLED__` | `persistence.web === true` → **开** |
| `scripts/lib-build/build.js`（`dist-lib/`） | `__DSP_MODEL_CACHE_ENABLED__` | `persistence.lib === true` → **关** |
| `jest.config.js`（单测） | `globals.__DSP_MODEL_CACHE_ENABLED__` | `persistence.web === true` → 开（测关闭路径用 `setModelCacheEnabled(false)` 运行时覆盖） |

改完必须重新构建对应产物才生效（`yarn build` / `yarn serve` 或 `yarn build:lib`）。发布库默认不替宿主写存储；宿主在创建 Viewer 前调 `setModelCacheEnabled(true)` 即可开启，`null` 恢复构建配置值——这两个函数由 `src/lib/index.ts` 导出。

**与 `glbLoader` 的接线**（`src/models/glbLoader.ts`）：

| 时机 | 行为 |
| ---- | ---- |
| 取模型前 | `const local = await readCachedModel(url)`；命中就**完全不发网络请求**（断网同样成立） |
| 首次从网络拿到 | `void storeCachedModel(url, buffer.slice(0))`——必须复制一份，因为 KTX2 转码会把 `bufferView` 交给 worker，原 `ArrayBuffer` 可能被 transfer（detach） |
| 解析失败且来源是本地 | `void removeCachedModel(url)` 丢掉坏副本，下次重新下载；否则坏数据会一直命中，表现为「这个模型永远是白模」 |

并发上限 `MAX_CONCURRENT_LOADS = 10`、整体超时 `DEFAULT_TIMEOUT_MS = 30000`（覆盖 chunk 加载 + fetch + parse 全过程），超时会主动 `abort` 底层 fetch。

**持久化权限**：`requestPersistentStorage()` 先查 `isModelCacheEnabled()`（关闭时直接 `false`，不弹权限请求），再走 `navigator.storage`：`persisted()` 已为真直接返回 `true`，否则 `await storage.persist()`；被拒绝或任何异常都只是 `false`，不是错误。调用点是「用户主动点下载离线包」之后（`downloadPack` 内），**不在**每次 `storeCachedModel` 时调用。

### 16.12 离线模型包（modelPack.ts）

入口是「高级」面板里的一个按钮，不做启动预取：把 73 个 GLB（合计约 128 MB）预先备齐的成本必须由用户**主动点击**承担。

**数据结构**（`src/models/modelPack.ts`）：

| 类型 | 字段 |
| ---- | ---- |
| `PackFile` | `name`（不含 `.glb`）、`url`（带内容哈希的最终 URL） |
| `PackStatus` | `supported`、`total`、`cached`、`missing`、`missingBytes: number \| null`、`pruned` |
| `PackProgress` | `completed`、`total`、`bytes`、`current: string \| null` |
| `DownloadPackOptions` | `signal?: AbortSignal`、`onProgress?: (p: PackProgress) => void` |

导出函数：

| 函数 | 语义 |
| ---- | ---- |
| `isPackSupported()` | `isModelCacheActive()`：开关打开**且**浏览器支持 Cache Storage |
| `isPersistenceEnabled()` | `isModelCacheEnabled()`：只表示开关，用来把「已关闭」和「不支持」两种提示分开 |
| `resolvePackFiles()` | `availableModelNames` 排序后逐个 `modelUrl(name)`，返回 `null` 的直接跳过（解析失败 = 文件不存在） |
| `inspectPack()` | 只统计不下载；不支持时返回 `{supported:false,total:0,cached:0,missing:0,missingBytes:null,pruned:0}` |
| `downloadPack(options)` | 下载缺失文件；不支持时抛错 |
| `clearPack()` | 清空整个模型缓存，返回删除条数 |
| `isAbortError(error)` | 按 `error.name === "AbortError"` 判定「用户取消」与真错误 |

**`inspectPack()` 的两个细节**：

- **顺手清理过期条目**：缓存键是带内容哈希的 URL，旧版本 URL 永远不会再被请求，留着只白占空间（每发一版最多累积一份全量模型）。所以拿「当前构建的键集合」和缓存清单做差，不在集合里的 `removeCachedModel` 并计入 `pruned`。
- 但 `files.length === 0`（资源解析整体失败）时**不清**，避免把有效缓存误删光。
- `missingBytes` 由 `MODEL_BYTES[file.name]` 累加；任一缺失模型在清单里查不到或 `<= 0`，则整体置 `null`（表示「构建清单缺失，只显示数量」）。

**`downloadPack()` 的语义**：

1. 先判 `isPackSupported()`，不支持直接抛：开关关着报 `本地持久化已关闭（config/persistence.config.js）`，开关开着报 `当前浏览器不支持本地缓存`——绝不出现「显示下载完成其实什么都没存」。
2. `pending` = 清单中未被缓存的项；`onProgress` 先回调一次全 0 的快照；`pending.length === 0` 立即返回（已离线，零请求）。
3. `await requestPersistentStorage()`（用户已明确要这份数据，顺手申请持久化权限）。
4. **顺序下载、并发 1**：进度按文件粒度推进，不会被并发请求搅乱，也不会在移动端同时占满连接。每个文件：
   - `signal?.aborted` → 抛 `AbortError`；
   - 再查一次 `readCachedModel(file.url)`（期间可能被 `glbLoader` 顺手缓存），命中则 `completed++` 跳过；
   - `fetch(file.url, { signal })`；`!response.ok` → 抛 `下载失败：${name}（HTTP ${status}）`；
   - `readBlob()` 流式读 `response.body`（`null` 时退化为 `blob()`），边读边报 `bytes`；
   - `storeCachedModel(file.url, blob)` 返回 `false` → 抛 `无法写入本地缓存：${name}（存储空间可能已满）`。
5. 任一文件失败即抛错，**已完成的文件保持有效**；用户取消时正在下载的那个文件**不落盘**（不留半成品）。因此「取消 → 再点」天然是**断点续传**。

进度语义要点：`PackProgress.completed / total` 都是**本次要补的文件数**（已缓存的不算），不是全量。`total: 0` 表示「一个都不缺」。

**`App.vue` 的接线**（「离线模型包」面板）：

| 关注点 | 实现 |
| ---- | ---- |
| 懒加载 | `loadPackModule()` 走 `import(/* webpackChunkName: "model-pack" */ "@/models/modelPack")`，不进首屏 |
| 状态机 | `PackState = "idle" \| "checking" \| "downloading" \| "complete" \| "partial" \| "unsupported" \| "error"` |
| 何时统计 | `watch(advancedOpen)`：只有展开「高级」才 `refreshPackState()`，首屏零请求零耗时 |
| 文案分流 | `packPersistenceOff = !pack.isPersistenceEnabled()`；`unsupported` 时显示 `已关闭`（构建配置关）或 `不支持`（浏览器不支持），提示语分别是「本地持久化已在构建配置中关闭，模型仍可在联网时加载」/「当前浏览器不支持本地缓存，模型仍可在联网时加载」 |
| 按钮文案 | `下载全部模型（N）` / `取消下载` / `继续下载（cached/total）` / `已是离线状态` / `重试下载` / `检查中…` |
| 进度 | `packDone = status.cached + progress.completed`，`packPercent = round(packDone / packTotal * 100)`；下载中提示「n/total · 已收 / 待下载 · 下载完成前无法切换渲染设置」 |
| 取消 | `packAbort = new AbortController()`，`cancelPackDownload()` 只 `abort()`；`AbortError` 分支保留已完成文件、把 `missingBytes` 置 `null`（已下部分构成未知） |
| 下载期间锁设置 | `packBusy = packState === "downloading"`，禁用「展示真实模型」「开启贴图」与全部通道开关，避免一半模型按新设置、一半按旧设置 |
| 完成收尾 | `resetGlbFailure()`：之前网络抖动加载失败的模型现在本地有了，清掉负缓存，下次重建就能用上 |
| 检查期间 | `packChecking` 让进度条走不确定动画；`packDisabled` 阻止重复点击 |

**数量与体积**（本仓库实测）：`src/assets/icons/models/` 下 **73** 个 `.glb`，合计 **134,193,652 字节 ≈ 128.0 MiB**；单文件最大 `turret-plasma.glb`，5,778,056 字节 ≈ 5.51 MiB。`__DSP_MODEL_BYTES__` 由构建期扫描得到（见 §16.13），因此运行时算「还差多少 MB」零请求。

### 16.13 构建期资产清单与模型体积（scripts/lib-build/assetInventory.js）

`scripts/lib-build/assetInventory.js`（70 行）是**一份磁盘扫描逻辑，三个构建/测试入口共用**。它解决的核心问题是：库构建与单测都没有 webpack 资产管线，却需要在不发请求的前提下知道「哪些文件真实存在」。

| 导出 | 签名 | 返回 |
| ---- | ---- | ---- |
| `buildInventory` | `(rootDir: string) => { models: string[]; itemRecipe: string[]; tech: string[]; signal: string[] }` | 路径一律相对 `src/assets/`，如 `models/smelter.glb`、`icons/tech/1001.png`，各自排序 |
| `buildModelBytes` | `(rootDir: string) => Record<string, number>` | 键是**去掉扩展名**的模型名（`smelter`），值是该 `.glb` 的字节数 |

实现要点：

- `listFiles(dir, predicate, label)`：目录不存在直接抛 `[asset-inventory] 资产目录不存在：…`；只收 `.glb` / `.png`，结果 `.sort()` 保证清单稳定（构建可复现）。
- `buildInventory` 额外有一道断言：`models.length === 0` 时抛「下没有任何 .glb，构建/单测会退化成纯元数据模式」——宁可构建失败，也不要静默产出没有模型的包。
- `buildModelBytes` 用 `fs.statSync().size`。编辑器构建的 `.glb` 规则是 `asset/resource`（原样拷贝、不改写内容），所以**源文件大小就是产物大小**，构建期读一次即可，运行时无需 `HEAD` 请求。

三个消费方：

| 消费方 | 调用 | 注入 / 用途 |
| ---- | ---- | ---- |
| `vue.config.js:88` | `buildModelBytes(__dirname)` | DefinePlugin → `__DSP_MODEL_BYTES__`，供 `modelPack.ts` 算 `missingBytes`（「待下载 xx MB」） |
| `jest.config.js:20` | `buildInventory(__dirname)` | `globals.__DSP_LIB_ASSET_INVENTORY__`：单测没有构建步骤，用同一份扫描结果判定「文件存在」；同处还注入 `__DSP_MODEL_CACHE_ENABLED__ = require('./config/persistence.config').web === true` |
| `scripts/lib-build/build.js:498` | `buildInventory(ROOT)` | DefinePlugin → `__DSP_LIB_ASSET_INVENTORY__`；同一份清单还驱动 `copyAssets()`（GLB → `dist-lib/models/`，图标 → `dist-lib/img/...`）与 `verify()` 的产物体检（`models` 下 GLB 数量必须等于清单长度、`dist-lib/img/models/` 不许再有 PNG） |

清单内的路径与产物路径的映射由 `scripts/lib-build/build.js` 的 `toOutputRelative()` 完成：`icons/` 前缀换成 `img/`，其余原样；运行时由 `assetResolver` 做同样的前缀映射。

**本仓库的实测数字**（重算依据：`Get-ChildItem src/assets/icons/models -Filter *.glb`、`src/assets/icons/{item_recipe,signal,tech}` 计数）：

| 断言 | 值 |
| ---- | ---- |
| 建筑模型 `.glb` 数量 | 73 |
| 建筑模型总体积 | 134,193,652 字节（128.0 MiB） |
| 单个最大 | `turret-plasma.glb` 5,778,056 字节（5.51 MiB） |
| 物品/配方图标 `item_recipe/*.png` | 192 |
| 信号图标 `signal/*.png` | 41 |
| 科技图标 `tech/*.png` | 323 |
| `models/` 下非 `.glb` 文件 | 0（贴图目录已删除） |

### 16.14 诊断、测试与已知缺口

**运行时映射报告**：`getModelMappingReport()`（`src/models/buildingModel.ts:328`）返回 `ModelMappingReport`：

| 字段 | 含义 |
| ---- | ---- |
| `availableFiles` | 磁盘上实际存在的 GLB 文件名 |
| `mapped` | 已匹配到 GLB 的模型号（`ModelMappingEntry[]`） |
| `unmappedBuildings` | 未匹配、回退元数据表的模型号 |
| `missingMetaModels` | **有 GLB 但缺 `buildingMeta`** 的模型号 |
| `unusedFiles` | 磁盘上存在但没有任何模型号引用的文件 |
| `failedModels` | 加载失败的模型名（失败负缓存） |

`ModelMappingEntry` 的字段是 `{ modelIndex, itemId, itemName, icon, variantIndex, glbName, candidates }`，其中 `itemName` 在 `itemsData` 未登记时给 `"(itemsData 未登记)"`。

**其它诊断接口**：

| 接口 | 位置 | 用途 |
| ---- | ---- | ---- |
| `glbFailedModels()` | `glbLoader.ts:112` | 失败负缓存快照 |
| `resetGlbFailure(name?)` | `glbLoader.ts:346` | 清全部或单个失败记录，允许重试（离线包下载完成后即调用） |
| `releaseGlbModel(name)` / `releaseAllGlbModels()` | `glbLoader.ts:402 / 414` | 释放 GPU 资源并移出缓存 |
| `reapplyLoadedModelMaterials(settings?)` | `glbLoader.ts:357` | 按当前设置原地重挂所有已加载模型的通道贴图 |
| `hasMaterialTextures(modelName, materialName)` | `materialTextures.ts:319` | 查清单（键为 `模型名::材质名`）；因清单恒空，**永远返回 `false`** |

**单测**（`tests/unit/` 共 26 个 `*.spec.ts`，其中 `tests/unit/models/` 7 个）：

| spec | 覆盖什么 |
| ---- | ---- |
| `modelCache.spec.ts` | 开关 × 后端的全矩阵：`NoopModelCache` 五个操作全返回「未命中/失败/空」、**连 `caches.open` 都不调**、环境不支持时开关开着也退回同一个空操作对象、运行时覆盖优先于构建配置、重新打开后立刻恢复真实落盘、`modelPack` 在关闭态的降级（`isPackSupported=false`、`inspectPack` 不谎报、`downloadPack` 直接报错） |
| `modelPack.spec.ts` | Cache Storage 读写（存入能读回原始字节、键归一化成绝对 URL）、清单来自磁盘真值、`inspectPack` 把已缓存算进去、顺手清掉不属于当前构建的旧条目、只请求缺失文件且进度单调递增、下载完再点零请求、HTTP 失败报出模型名、开始前取消抛 `AbortError` 且不写文件、途中取消保留已完成文件、`clearPack` 返回删除条数、不支持时下载直接报错 |
| `modelMapping.spec.ts` | 图标名 → GLB 文件名：无别名直接用图标名、`assembler-1` 特例、`accumulator-full` 复用 `accumulator`、四向分流器三种变形按 `Item.models` 下标取 `splitter-a/b/c`、别名表结构自检（每条的 `note`、`variants` 与 `primary` 不冲突）、未登记返回 `null`、模型清单与构建同源 |
| `modelTransform.spec.ts` | `src/data/modelTransform.ts`（62 行）的完整性：每行都对应真实 `.glb`、与 `buildingMeta` 一一对应、7 个核心数值都写满、旋转在 `|v| <= 360`、偏移在 `|v| <= 100`、`scale` 为正、至少一行被标定过、未登记 `modelIndex` 返回全 0 不抛错、每个键都能在 `buildingMeta` 找到 |
| `placement.spec.ts` | `planetConstants` 换算一致、GLB 放置矩阵（全 0 变换 / Yaw 90 / 180 / Pitch / Roll / z 偏移按格 ×4/3 / x-y 偏移不受 yaw 影响 / 无可用模型时完全忽略变换表 / 放置计算不改元数据表）、格换算系数（水平 ≈1.2579、垂直 =4/3）、62 个建筑 × 典型变换矩阵有限 |
| `textureFallback.spec.ts` | 缺失底色贴图的纯色兜底：显式指定表优先于启发式与默认值、材质名启发式（`black` / `glass` / `water` 各有专属色）、无线索返回中性灰、纯色贴图按颜色缓存成 1×1 sRGB `DataTexture` |
| `textureManifest.spec.ts` | 实际校验的是 `modelMaterialTuning`：每个真实存在的 `.glb` 都有一条可调参数、参数表里没有已删除的模型、三个参数都是有限数且在合理区间、未登记返回合法默认值 |

> ⚠️ 待确认：`textureManifest.spec.ts` 的文件名与内容已不匹配（清单恒空、实际测的是 `modelMaterialTuning`）。是否改名/拆分由作者决定，文档如实按内容描述。

**`tests/unit/scripts/` 下的 6 个诊断/生成工具**（不在 jest 收集范围内，`npx ts-node ...` / `node ...` 手动执行）：

| 文件 | 用途 |
| ---- | ---- |
| `check-glb-extensions.ts` | 检查每个 GLB 是否「需要额外解码器 / 引用外部资源」——这类问题**不报错**，只会让模型静默回退元数据盒 |
| `inspect-glb.ts` | 直接从二进制量包围盒，验证「合法 glTF 2.0」与「模型是 y-up」两个前提（`buildModelPlacement` 的默认假设） |
| `verify-glb-mapping.ts` | 不依赖 webpack，用纯函数 `modelNameCandidates` + 磁盘目录复核「谁匹配上、谁回退」 |
| `gen-texture-manifest.mjs` | 贴图清单生成器：GLB 内嵌底色图与磁盘 PNG 做 MD5 全等比对锚定材质，再找同词干的 `-n/-e/-s`，产出映射表与运行期清单（当前清单已恒空，保留该脚本用于回滚） |
| `prune-model-textures.mjs` | 按映射表把「没被任何 GLB 材质引用」的贴图**移出**仓库（默认 dry-run，`--apply` 才移动，并写 `MOVE_LIST.md` 与 `restore.ps1`） |
| `texture-mapping.json` | 历史映射数据（材质 → `-n/-e/-s` 文件），供 `scripts/glb-ktx2` 与清理脚本核对；确需回滚到外部贴图方案时从这里重新生成 |

**`scripts/http/`（19 个文件）中有代表性的诊断脚本**：

| 脚本 | 用途 |
| ---- | ---- |
| `serve.mjs` | 极简静态服务器，把 `dist` 挂在 `/dsp_blueprint_editor/` 下，模拟 GitHub Pages（端口默认 5055） |
| `e2e.mjs` | 无头 Edge + CDP 端到端：塞入指定蓝图、统计 GLB 请求与贴图错误、截图 |
| `validate-all.mjs` | 全量结构校验：73 个 GLB 能否被 GLTFLoader + KTX2Loader 正确解析，并核对每个槽位的 Basis 编码（baseColor/emissive 期望 ETC1S，normal/mr/occlusion 期望 UASTC） |
| `inspect-ktx2.mjs` | 只读体检：确认 GLB 真的已 KTX2 化、体积多少、扩展声明是否正确 |
| `vram-est.mjs` | 按转码后的 GPU 格式（ETC2 0.5 B/px、BC7/ASTC 1 B/px）加 mip 链（×4/3）估算各模型显存 |
| `dump-glb.mjs` | 打印单个 GLB 的 chunk 结构、`asset`、节点/网格/材质/accessor 数量与首个 primitive |

同目录下还有 `bundle-check.mjs`、`chunk-scan*.mjs`、`sw-check.mjs`、`sw-size.mjs`、`wasm-strings.mjs`、`decode-test.mjs`、`inspect-one.mjs`、`cdp-*.mjs` 等一次性排查脚本（部分带历史产物 `dom.html` / `cdp-shot.png`）。

**已知缺口**（逐条按当前代码核实）：

1. **缺元数据的模型号共 9 个**：`47`（物流运输机）、`48`（星际物流运输船）、`117`（轨道采集器）、`372`（配送无人机）、`448`、`449`、`450`、`451`、`452`（icon 依次为 `fighter-shield`、`fighter-plasma`、`fighter-laser`、`warship-plasma`、`warship-laser`）。它们被 `itemsData` 的 `models` 引用，但 `buildingMeta`（62 条）里没有对应项 —— 蓝图里出现这些 `modelIndex` 时按「未知建筑」隐藏占位处理、不参与拾取，`orbital-collector.glb` / `logistic-vessel.glb` 等文件因此进了 `unusedFiles`。
2. **`belt-1/2/3.glb` 是 148 字节的空 GLB**：只有 JSON chunk（`{"asset":...,"nodes":[{"name":"belt-1"}],"scenes":[...]}`），没有 mesh。`glbLoader` 在 `bbox.isEmpty()` 时会抛「GLB 包围盒为空（可能是纯空节点或解析异常）」→ 加载判失败并进失败负缓存，三条传送带（模型号 35/36/37）实际永远走元数据盒回退。
   > ⚠️ 待确认：这是「GLB 清理时被误删网格」还是「传送带本来就不打算渲染」——`modelTransform.ts` 里仍给 35/36/37 留了三行并注明对应 `belt-1/2/3.glb`，看起来是前者。
3. **发布库没有环境反射**：`src/lib/**` 不调用 `createNeutralEnvironment`，`getBuildingEnvironment()` 在库侧恒为 `null`（详见 §16.9）。
4. **贴图清单恒空**：`materialMapUrls = {}`、`materialTextureFiles = {}`、`manifestTextureFiles = []`，`hasMaterialTextures()` 永远 `false`。通道贴图全部内嵌在 GLB（KTX2），外置 PNG 通路只是保留能力；`effect` / `dirt` / `glass` 三个通道当前素材包未提供。
5. **编辑器默认不开真实模型**：`showRealModels` / `texturesEnabled` 默认都是 `false`，首次使用看到的是元数据色块，需要用户手动打开「高级 › 展示真实模型」。

### 16.15 易踩的坑（改代码前先读）

1. **`__DSP_TRANSCODER_BASE__` 不能用 `process.env.BASE_URL`**：webpack 5 不注入 `process`，那条分支会被常量折叠掉，最后退化成相对当前 chunk 的 `/js/basis/`（404）——这就是「模型全部退回元数据盒」的根因。`vue.config.js` 里必须用 `JSON.stringify(PUBLIC_PATH + 'basis/')` 注入；`PUBLIC_PATH = '/dsp_blueprint_editor/'` 同时决定 `publicPath` 与转码器目录。
2. **workbox 默认会把模型全塞进 precache**：默认规则会把 `dist` 下所有 <2 MB 的文件预缓存 —— 本仓库当前有 **45** 个 GLB 小于 2 MB，合计 **39.5 MB**。后果是首次访问 SW 安装时就把这 40 MB 全下一遍（用户可能一栋楼都没看），移动端还会撑爆配额。所以 `workboxOptions.exclude` 必须显式带上 `/models\//`（还有 `/demo\//`、`/update-log\.json$/`）；而 plugin 的 `Object.assign` 会用**本数组整体覆盖默认值**，所以 `/\.map$/`、`/img\/icons\//`、`/favicon\.ico$/`、`/^manifest.*\.js?$/` 必须原样保留。
3. **`/\/assets\//` 规则必须 `exclude: /\.[jt]sx?$/`**：该正则用正斜杠匹配，在 Linux（路径是正斜杠）下会**误命中 `src/lib/assets/*.ts`**，把 TS 模块吞成 `asset`（只剩 URL 字符串），导致 CI 产物里 `assetResolver` 变成 `undefined`。Windows 上路径是反斜杠、这条规则本来匹配不到任何文件，所以本地构建**看不出问题**，别用「本地能跑」当验证。
4. **资产规则的先后顺序**：`/\/assets\//`（`type: 'asset'`）必须排在 `.glb`（`type: 'asset/resource'`）**之前**，后匹配的规则会覆盖前面的 `type`。同理，`item_recipe` 与 `signal|tech` 的规则也要在 `.glb` 之前。另外这两个图标规则用的是 `assets[\\/]icons…` 双分隔符写法（Windows 下 webpack 给的是反斜杠路径），照 `/assets/icons/` 单写会静默失配。
5. **不要探测 `typeof require.context`**：webpack 会把属性访问编译成「某空模块的 `.context`」（恒 `undefined`），判断永远成立，整个 GLB 功能静默失效、全部建筑回退元数据表（`assetResolver.webpack.ts:34-37` 的注释记录了实测结论）。必须取 `require.context(...)` 的**调用结果**再判断类型；三个参数必须是**字面量**，否则 webpack 无法静态解析。取 URL 用 `pickUrl()`（`assetResolver.webpack.ts:54`，旧文档里的名字是 `pickModelUrl`），它同时兼容「`asset/resource` 直接导出字符串 URL」与 `{ default: url }` 两种形态。
6. **KTX2 是 required 扩展，必须先挂转码器**：优化后的 GLB 用 `KHR_texture_basisu`，没挂 `setKTX2Loader` 时 `GLTFLoader.parse` 会**直接抛错**（不是静默降级）。因此必须先把渲染器交给 `setKtx2Renderer(renderer)`（`BlueprintEditor.vue:193`）、再让任何模型开始加载；转码目标格式按 GPU 能力挑（ASTC / ETC2 / BC7 / PVRTC）。
7. **`flipY = false` 不能丢**：GLB 用 glTF 的 UV 约定（v 轴朝下），three 默认 `flipY = true` 会把图翻回来，导致法线/自发光整体上下错位。`textureMaps.ts:81/142`、`textureFallback.ts:91` 都手动关了；新增任何运行时生成的贴图都要照做（`iconTexture.ts` 的角标图是 canvas 自绘、走另一套约定，`flipY = true`）。
8. **环境反射只挂 `material.envMap`，绝不设 `scene.environment`**：设了全局环境会把行星本体、经纬网格、图标一起洗亮。另外注意库构建根本没有注入环境贴图（见 §16.14 第 3 条），别在库里断言 `getBuildingEnvironment() !== null`。
9. **共享资源的 `dispose` 要跳过**：GLB 缓存里的几何与贴图是跨模型、跨场景复用的——`AllBuildings.ts:53/56` 只在 `userData.sharedResource` 不为真时释放几何与材质，`glbLoader.ts:376` 只释放 `userData.sharedTexture !== true` 的贴图。漏了这个判断会释放掉其他场景仍在用的资源（表现为某些建筑突然变白/变黑）。
10. **缓存写入前必须复制 buffer**：`storeCachedModel(url, buffer.slice(0))`。KTX2 转码会把 `bufferView` 交给 worker，原 `ArrayBuffer` 可能被 transfer（detach），直接存原引用会写进一个已失效的视图。
11. **持久化开关只有一处配置**：`config/persistence.config.js`。不要在代码里读 `localStorage` 或再写一个开关；改完 `web` / `lib` 都得重新构建对应产物才生效。另注意 `isModelCacheEnabled()` 只表示开关，**不表示浏览器能力**，判断「能不能存」要用 `isModelCacheActive()`（否则会把「浏览器不支持」错报成「已开启」）。
12. **渲染设置不要在 `computed` 里读响应式单例**：建场景发生在 Vue `computed` 里，直接读 `renderSettings` 会把设置收集成依赖，改一个开关就整场重建，破坏「导入时固化、重新导入才生效」的语义。要读「已生效」快照 `getAppliedRenderSettings()`（`captureRenderSettings()` 只在导入蓝图时调用）。
13. **`Infinity` 过不了 JSON**：`maxInstancesPerModel` 在 `sessionStorage` 里用 `null` 表示无限，读回时还原。手写配置文件或迁移旧数据时若塞进 `""` / `0` / `"Infinity"`，会被 `loadSettings()` 判为非法并**静默退回默认值 1024**，排查时要先看这一层。
14. **`update-log.json` 不能进 precache**：更新日志必须每次从网络读最新版本，一旦被预缓存，旧页面会拿到旧日志，更新弹窗就失去意义（已在 `workboxOptions.exclude` 里显式排除）。
15. **自动缩放必须 clamp `[1/3, 3]`**（`buildingModel.ts:113-114` 的 `AUTO_SCALE_MIN` / `AUTO_SCALE_MAX`）：`buildingMeta` 的 box 高度只是近似值，个别 GLB 实测高度相差数倍，不夹紧会被等比缩放压成一个点；超出区间的用 `src/data/modelTransform.ts` 的 `scale` 逐条修正，别改 clamp 去迁就单个模型。
