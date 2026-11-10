# 代码规范与落地执行流程

> 项目：`dsp_blueprint_editor`（戴森球计划蓝图预览与编辑工具）
> 形态：Vue 3 + Three.js 单页应用 + 可嵌入无头库（`BlueprintViewer`，`src/lib` → `dist-lib`）
> 版本：v1.0.0 · 生效日期：2026-11-10

本规范定义「依赖方向」「文件归属」「命名」「注释」四类规则，以及配套的「落地执行流程」「验证标准」「禁止事项」。规则以**当前项目实际目录**为基准（已将通用分层术语映射到本仓库），落地整改时严格按「五、落地执行流程」分批推进，任何一批不得在未经确认前大范围改代码。

---

## 目录

1. [术语与目录映射](#1-术语与目录映射)
2. [依赖方向约束](#2-依赖方向约束)
3. [文件归属规范](#3-文件归属规范)
4. [命名规范](#4-命名规范)
5. [注释规范](#5-注释规范)
6. [落地执行流程](#6-落地执行流程)
7. [验证标准](#7-验证标准)
8. [禁止事项](#8-禁止事项)

---

## 1. 术语与目录映射

通用分层术语（pages / components / composables / stores / three / utils / types / 库模块）与本仓库实际目录的对应关系如下，后续各章节均以「实际目录」表述。

| 分层术语 | 当前项目实际目录 / 文件 | 说明 |
| ---- | ---- | ---- |
| pages（页面） | `src/App.vue`、`src/swStatus.vue` | 当前唯一页面根组件；若未来拆出多页面，统一收口到 `src/pages/` |
| components（组件） | `src/components/` | 已存在，24 个可复用 SFC |
| composables（组合式函数） | `src/composables/`（目标，新建） | 当前组合式逻辑内联于组件与 `src/lib/core/`，落地时抽取为 `useXxx.ts` |
| stores（状态/命令） | `src/command.ts`（`CommandQueue` 撤销栈）+ 组件 `provide/inject` | 无 Pinia / Vuex；若引入状态库则统一放 `src/stores/` |
| three（场景对象） | `src/lib/core/`、`src/models/`、`src/bvh/`，及根目录场景对象：`src/cargos.ts`、`src/icons.ts`、`src/iconSubscript.ts`、`src/iconTexture.ts`、`src/PlanetMapControls.ts`、`src/SphereGridGeometry.ts`、`src/skyGradient.ts` | 每个独立对象单独一个文件 |
| 领域数据（blueprint / data） | `src/blueprint/`、`src/data/` | 蓝图解析/编辑 + 游戏静态数据 |
| utils | `src/utils.ts` | 纯工具函数 |
| types（共享类型） | `src/types/`（目标，收敛）；当前分散于 `src/lib/types.ts`、`src/lib/core/types.ts`、`src/lib/preview/types.ts`、`src/lib/assets/types.ts`、`src/data/types.ts`、`src/renderSettingsTypes.ts` | 落地时统一收敛 |
| 库模块（对外发布） | `src/lib/`（入口 `src/lib/index.ts`，产物 `dist-lib/`，构建 `build:lib`） | 等价于规范原文的「MES 库」/ `packages/mes` |
| 库模块公开类型 | `src/lib/types.ts` | 等价于规范原文的 `packages/mes/types.ts` |

### 命令映射

| 规范原文命令 | 当前项目实际命令 | 说明 |
| ---- | ---- | ---- |
| `npm run type-check` | 暂无，需新增 `type-check` 脚本 | 建议 `vue-tsc --noEmit`（需新增 `vue-tsc` devDependency）；退而求其次 `tsc --noEmit` 仅覆盖 `.ts` |
| `npm run build` | `npm run build` | 已存在 |
| `npm run build:mes` | `npm run build:lib` | 库构建 |
| `npm run dev` | `npm run serve` | 本仓库 dev 脚本名为 `serve` |
| 自动生成产物 | `dist-lib/`（`build:lib`）、`dist/`（`build`）、`cli/`（`build-cli`） | 本仓库无 `components.d.ts` / `typed-router.d.ts`；以上产物禁止手动修改 |

---

## 2. 依赖方向约束

严格遵循单向依赖，箭头「→」表示允许依赖，禁止反向依赖。分层自顶向下：

| 层 | 实际目录 |
| ---- | ---- |
| ① UI 层 | `src/App.vue`、`src/swStatus.vue`、`src/components/` |
| ② 组合式函数层 | `src/composables/`（目标，新建） |
| ③ 状态/命令层 | `src/command.ts` |
| ④ 渲染层（three） | `src/lib/core/`、`src/models/`、`src/bvh/`、根目录场景对象 |
| ⑤ 领域数据层 | `src/blueprint/`、`src/data/` |
| ⑥ 工具层 | `src/utils.ts` |
| ⑦ 类型层 | `src/types/`（共享类型） |

依赖流向：

- UI 层 → 组合式函数层 / 状态层 / 渲染层 / 领域数据层 / 工具层 / 类型层
- 组合式函数层 → 状态层 / 渲染层 / 领域数据层 / 工具层 / 类型层
- 状态层 → 渲染层 / 领域数据层 / 工具层 / 类型层
- 渲染层 → 领域数据层 / 工具层 / 类型层
- 领域数据层 → 工具层 / 类型层
- 工具层 → 仅标准库与 Three.js 数学类型（`Matrix4` / `Vector3` / `Color` 等），不得依赖项目内其它任何层级
- 库模块 `src/lib/` → 仅可依赖 `src` 中无 DOM 依赖的模块（渲染 core、领域数据、工具、类型），不得依赖路由、`src/main.ts`、`src/App.vue` 等 SPA 专属模块

禁止规则：

- `src/utils.ts` 不得导入 `src/components/`、`src/App.vue`、`src/swStatus.vue`、`src/command.ts` 下的任何内容
- 库模块 `src/lib/` 不得依赖 `src/main.ts`、`src/App.vue`、`src/components/`、路由、`src/i18n.ts` 等 SPA 专属模块
- 类型层 `src/types/` 不得反向依赖 UI / 状态 / 渲染 / 领域数据层

---

## 3. 文件归属规范

所有文件必须按以下规则归类，不得随意放置：

- 页面级组件 → `src/App.vue`（当前）、`src/swStatus.vue`；未来多页面统一放 `src/pages/`
- 可复用 UI 组件 → `src/components/`
- 组合式函数 → `src/composables/`，文件名格式 `useXxx.ts`
- Three.js 场景对象 → `src/lib/core/`（渲染核心对象）、`src/models/`（GLB 加载）、`src/bvh/`（拾取加速结构），以及根目录的独立场景对象（`cargos.ts`、`icons.ts`、`iconSubscript.ts`、`iconTexture.ts`、`PlanetMapControls.ts`、`SphereGridGeometry.ts`、`skyGradient.ts`）；每个独立对象单独一个文件
- 全局共享类型 → `src/types/`（目标，收敛现有分散的 `types.ts`）；库模块对外暴露的公共类型 → `src/lib/types.ts`
- 禁止为了凑目录结构创建空目录或占位文件

---

## 4. 命名规范

### 4.1 目录与文件命名

- 目录名：统一 `kebab-case`，示例：`lib/core`、`lib/preview`
- 普通 TS 文件：统一 `kebab-case`，示例：`build-buildings.ts`、`geometry-helpers.ts`、`use-resize.ts`
- Vue 组件文件：统一 `PascalCase.vue`，示例：`BlueprintEditor.vue`、`ReplaceModal.vue`
- Composable 文件：统一 `useXxx.ts`，示例：`useRenderer.ts`、`useScene.ts`
- 类型文件：统一 `kebab-case.ts`，示例：`scene-types.ts`、`render-settings-types.ts`

### 4.2 函数与方法命名

- 以动词开头，清晰表达意图：`createScene`、`disposeObject`、`loadModel`、`updateCamera`
- 单一职责：一个函数只做一件事；函数名无法清晰描述职责时优先拆分
- 布尔返回值函数以 `is` / `has` / `can` / `should` 开头：`isDisposed`、`hasModel`
- 事件处理函数以 `handle` 开头：`handleResize`、`handleClick`
- 禁止无意义命名：`handleData`、`process`、`doSomething`、`tmp`、`data2` 等

### 4.3 变量、常量与类型命名

- 普通变量：`camelCase`，完整表达含义，禁止无意义缩写
- 常量：`UPPER_SNAKE_CASE`，同类常量集中定义，禁止散落魔法值
- 类型 / 接口：`PascalCase`，使用名词或名词短语
- 枚举值：`PascalCase`，必须携带语义前缀

### 4.4 Three.js 专用命名

- 场景对象实例：`<用途><类型>`，示例：`mainScene`、`heroMesh`、`groundPlane`、`skyGroup`
- 材质对象：`<用途>Material`，示例：`heroMaterial`、`wireframeMaterial`
- 几何体对象：`<用途>Geometry`，示例：`boxGeometry`
- 加载器对象：`<类型>Loader`，示例：`gltfLoader`、`textureLoader`
- 渲染循环回调：全项目统一使用 `renderLoop` 或 `animate` 其中一种，不得混用
- 资源释放函数：`dispose<对象>`，示例：`disposeScene`、`disposeMaterial`

### 4.5 通用禁止项

- 禁止拼音、无意义缩写、拼写错误命名
- 同一概念在不同文件必须使用完全一致的命名
- 禁止命名与实际实现不符（名为 `validate` 却实现创建、名为 `create` 却返回单例复用）
- Three.js 对象命名禁止省略类型后缀（如仅命名为 `hero`，无法区分 Mesh / Group / Material）

---

## 5. 注释规范

### 5.1 总则

- 所有新增或修改的注释必须使用中文编写
- 注释是项目契约的一部分，仅解释「为什么这么做」与「边界约束」，不得复述代码逻辑
- 所有有业务意义的声明必须添加注释，覆盖三要素：
  1. **职责**：核心功能
  2. **使用**：调用方场景与依赖关系
  3. **边界**：不实现的功能、失败/回退行为、职责归属划分
- 代码修改时必须同步更新对应注释，过期注释视为代码缺陷

### 5.2 TS 文件注释规范

- 文件级注释：每个 `.ts` 文件顶部（import 之后）添加文件级注释，完整覆盖三要素
- 类型 / 接口注释：每个导出类型说明用途、使用场景与边界
- 函数 / 方法注释：每个导出函数说明功能、调用条件、边界约束
- 常量 / 枚举注释：每个常量、枚举值说明定义含义与使用场景
- 复杂逻辑注释：跨多步骤的函数添加逻辑流注释，清晰描述执行路径与失败分支

### 5.3 Vue SFC 注释规范

- `<script setup>`：使用分隔注释标记不同功能模块，每个模块说明职责与边界
- `<template>`：使用中文 HTML 注释标记核心 UI 模块，仅在页面区块、复杂控件、弹窗、条件渲染、重复列表处添加，小段静态文本无需逐块注释
- `<style scoped>`：仅在非显而易见处注释，如覆盖第三方样式、层叠冲突、Three.js 画布定位约束

### 5.4 Three.js 专用注释规范

以下场景必须加专项注释：

- 对象创建：说明归属方与释放责任方
- `dispose()`：说明释放的资源范围，避免重复释放
- 渲染循环：说明帧率策略、暂停条件
- 材质与纹理：说明复用关系，避免同一纹理重复加载
- 坐标系与单位：自定义坐标转换、缩放比例必须标注
- 性能敏感点：实例化、合批、遮挡剔除等优化逻辑必须说明原因

### 5.5 库模块导出注释规范（`src/lib`）

- 库模块所有公共 API 必须用 JSDoc 格式编写，保证 IDE 提示与 `.d.ts` 生成可读性
- 导出的每个函数、类型、常量都包含完整 JSDoc
- 公共 API 变更时在 JSDoc 标注 `@deprecated` 或版本说明
- 内部实现文件无需 JSDoc 风格，但仍需满足三要素注释
- 库导出不得暴露 Three.js 内部对象实例，仅对外暴露受控接口

### 5.6 注释反例

以下为不合格注释，必须避免：

```ts
// 获取数据
// 工具函数
// 设置变量
// 创建 Mesh
// TODO
// 创建一个 Mesh（仅复述函数名，无职责、使用、边界说明）
```

合格注释必须明确回答：当前声明的归属方、调用场景、不实现的功能与失败处理逻辑。

---

## 6. 落地执行流程

按以下顺序执行，任何一批不得越序：

1. **盘点阶段**：读取现有目录、文件、函数、注释，列出所有不符合本规范的位置
2. **出清单阶段**：先输出完整整改清单（文件路径 + 问题类型 + 建议改法），**不直接改代码**
3. **确认阶段**：提交用户确认，可删减或调整优先级
4. **分批改阶段**：按目录或模块分批整改，一批完成并验证通过后再进入下一批
5. **验证阶段**：每批完成后运行验证命令（见「7. 验证标准」），确保应用行为完全不变
6. **收尾阶段**：输出变更摘要，标注剩余待处理项

特殊规则：**注释重构作为独立阶段**——先完成目录与命名整改，再根据用户指令启动注释重写；注释重写按目录分批，每批仅修改注释、不改动任何业务逻辑。

---

## 7. 验证标准

- 目录 / 文件移动、函数 / 类型重命名后，依次执行并通过后方可确认该批完成：
  - `npm run type-check`（需先新增该脚本）
  - `npm run build`
  - `npm run build:lib`（库构建）
- 注释重构后仅需 `npm run type-check` 通过，确保行为不变
- 自动生成文件（`dist-lib/`、`dist/`、`cli/`）禁止手动修改，必须通过构建命令刷新
- Three.js 相关改动完成后，必须通过 `npm run serve` 手动确认场景可正常渲染、控制台无资源泄漏警告

---

## 8. 禁止事项

- 禁止借规范整改之名修改任何业务逻辑
- 禁止为凑目录结构创建空目录或空文件
- 禁止手动修改自动生成的文件
- 禁止一次性重写整个仓库，必须严格分批执行
- 禁止在用户确认整改清单前直接进行大范围代码修改
- 禁止将 SPA 专属依赖带入库模块 `src/lib/` 输出
