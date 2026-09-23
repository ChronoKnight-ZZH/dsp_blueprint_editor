# Code Wiki · dsp_blueprint_editor

> 戴森球计划（Dyson Sphere Program, DSP）蓝图编辑器
> 一个基于 Vue 3 + Three.js 的纯前端单页应用，用于在 3D 星球网格上可视化、编辑、批量替换、撤销/重做戴森球计划蓝图，并能以字节级 round-trip 兼容游戏的 v1/v2 蓝图格式。

---

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

---

## 1. 项目概览

| 项目 | 说明 |
| --- | --- |
| 名称 | `dsp_blueprint_editor` |
| 私有 | 是（私有仓库，不发布到 npm） |
| 版本 | 0.1.0 |
| 类型 | 单页 Web 应用（PWA） |
| 入口 | `src/main.ts` → `App.vue` |
| 渲染 | Three.js WebGL（3D 星球网格 + 实例化建筑/图标） |
| 状态 | Vue 3 Composition API + `provide/inject` |
| 兼容 | 戴森球计划蓝图 v1（旧版）与 v2（0.10.30+ 直至 0.10.34+）字节级 round-trip |

**核心能力**：

- 粘贴 / 选择文件 / 拖入 蓝图字符串，解析为结构化对象并渲染到 3D 星球。
- 信息面板编辑蓝图头部（图标、作者、版本、属性、介绍）。
- 在 3D 场景中点选建筑查看详情，右键剔除单个或同类建筑。
- 批量替换配方 / 过滤器 / 物流塔栏位 / 传送带图标 / 蓝图图标。
- 批量建筑升降级（传送带/分拣器/制造台/熔炉/研究站/化工厂，支持跳级与降级）。
- 批量替换配方时顺带翻转"生产加速 / 额外产出"模式（仅作用于被替换到的建筑）。
- 完整的撤销/重做（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）。
- 复制 / 保存为 .txt 文件，输出与游戏格式字节级一致；支持拖拽 .txt 文件直接打开。
- 中英双语 UI 与物品/配方名称。
- 新建空白蓝图，在 3D 星球上放置建筑（1-9 选分类 / F1-F12 选建筑 / 左键放置 / R 旋转 / Shift 自由放置），删除模式（X + 左键）。

---

## 2. 技术栈与依赖

### 运行时依赖

| 包 | 用途 |
| --- | --- |
| `vue` ^3.2.13 | 响应式 UI 框架 |
| `three` ^0.160.0 | 3D 渲染（通过 `three/src/Three.js` 别名引用） |
| `pako` ^2.0.4 | gzip 解压/压缩蓝图二进制体 |
| `vue-i18n` ^9.1.0 | 国际化 |
| `core-js` ^3.25.5 | ES polyfill |

### 开发依赖（关键）

| 包 | 用途 |
| --- | --- |
| `@vue/cli-service` ~5.0.1 | 构建/开发服务器/打包 |
| `typescript` ^5.1.3 | 类型系统 |
| `ts-node` ^10.5.0 | 运行 `src/cli.ts` 解析蓝图 |
| `jest` ^29 + `ts-jest` + `@vue/vue3-jest` | 单元测试 |
| `eslint` + `eslint-plugin-vue` + `@vue/eslint-config-typescript` | 代码检查 |
| `sass` / `sass-loader` | SCSS 样式 |
| `vue-cli-plugin-pwa` / `@vue/cli-plugin-pwa` | PWA service worker |
| `vue-cli-plugin-i18n` / `@intlify/vue-i18n-loader` | i18n 报告与编译 |
| `@types/three`, `@types/pako`, `@types/node`, `@types/jest` | 类型声明 |

---

## 3. 整体架构

```
┌────────────────────────────────────────────────────────────────────┐
│                          main.ts (createApp)                       │
│                              │                                      │
│                          App.vue (根)                               │
│   ┌──────────────────────┬────┴───────────────────┬────────────┐   │
│   │ 3D 渲染层             │  侧栏信息/操作面板       │  Provide    │   │
│   │ BlueprintEditor.vue   │  BuildingInfoPanel      │  rendererKey│   │
│   │  (Three.js Scene)     │  BuildingOverview        │  building.. │   │
│   │   ├ planet.ts         │  ReplaceModal           │  commandQue.│   │
│   │   ├ bvh/ (射线拾取)    │  IconPickerModal        │             │   │
│   │   ├ iconTexture.ts    │  BuildingIcon           │             │   │
│   │   ├ icons.ts          │  BlueprintIcon          │             │   │
│   │   ├ cargos.ts         │  ModalDSP               │             │   │
│   │   ├ area.ts (坐标转换) │  BuildingPalette        │             │   │
│   │   ├ create.ts (放置)  │  (底部建筑面板)          │             │   │
│   │   └ data/building.ts  │                         │             │   │
│   │  editor/placementState│                         │             │   │
│   └──────────┬────────────┴───────────┬─────────────┴────────────┘   │
│              │  编辑操作                  ▲                            │
│              ▼                            │                            │
│   ┌──────────────────────────────────────┴────────────────────┐      │
│   │              CommandQueue (撤销/重做)                       │      │
│   │   Command: ReplaceCommand / RemoveBuilding(s)Command        │      │
│   │   Updater (EventDispatcher) → 触发 3D 增量更新              │      │
│   └──────────────────────┬─────────────────────────────────────┘      │
│                          │                                            │
│                          ▼                                            │
│   ┌────────────────────────────────────────────────────────────┐      │
│   │         BlueprintData (parser.ts)                          │      │
│   │   fromStr() ← BLUEPRINT:base64(gzip(body))+md5             │      │
│   │   toStr()   → 字节级 round-trip                            │      │
│   │   v1 / v2(0.10.30+ ~ 0.10.34+) 双格式解析                 │      │
│   └────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼  依赖
   ┌──────────────────────────────────────────────────────────────┐
   │  data/  items / recipes / building / icons / midi / color    │
   │  locales/ zh.json / en.json                                  │
   │  assets/icons/ item_recipe · signal · tech                    │
   └──────────────────────────────────────────────────────────────┘
```

**关键架构特点**

1. **解析与渲染解耦**：`parser.ts` 是纯逻辑层，无 Three.js 依赖，便于 Node CLI 与单元测试。
2. **响应式驱动渲染**：`BlueprintEditor.vue` 用 `computed` 监听 `commandQueue.execVersion`，命令执行后整场景重建。
3. **增量更新通道**：`Updater`（基于 `EventDispatcher`）允许命令只触发"建筑图标/分拣器图标/传送带图标/物流塔信息"等局部刷新，避免重建整场景。
4. **字节级 round-trip**：v2 body 对未知扩展字段（`v2ExtraPose`、`extraBytes`、`tailExtraBytes`、`content`）以"原样保留 + 重新写出"方式实现，确保再导出的二进制与原蓝图逐字节一致。
5. **PWA + 离线**：`vue.config.js` 配置 service worker，`swStatus.vue` 处理更新提示。

---

## 4. 目录结构

```
/workspace
├── .github/workflows/gh-pages.yml     # GitHub Pages 部署
├── public/img/icons/                  # PWA 图标
├── src/
│   ├── App.vue                        # 根组件：布局 + 侧栏 + 蓝图代码区
│   ├── main.ts                        # createApp 入口
│   ├── define.ts                      # 全局 Symbol Key + VERSION
│   ├── i18n.ts                        # vue-i18n 实例 + useLang + 名称查询
│   ├── command.ts                     # CommandQueue / Command / Updater
│   ├── utils.ts                       # attachRenderer/attachCamera 等小工具
│   ├── cli.ts                         # Node 端蓝图字符串 → JSON CLI
│   ├── PlanetMapControls.ts           # 类 OrbitControls 的星球相机控制
│   ├── SphereGridGeometry.ts          # 球面经纬网格几何体
│   ├── iconTexture.ts                 # 图标图集（24x80 纹理）
│   ├── icons.ts                       # 建筑图标 InstancedMesh + Shader
│   ├── iconSubscript.ts               # 传送带数字下标渲染
│   ├── cargos.ts                      # 传送带/分拣器上的货物动画
│   ├── swStatus.vue                   # Service Worker 升级提示
│   ├── shims-vue.d.ts                 # .vue 类型声明
│   ├── blueprint/
│   │   ├── parser.ts                  # 蓝图字符串 ↔ BlueprintData（核心）
│   │   ├── md5.ts                     # 纯 JS MD5（用于蓝图尾部校验）
│   │   ├── planet.ts                  # 星球网格分区 + 建筑坐标变换
│   │   ├── buildingInfo.ts            # 建筑邻接关系（output/input 链路）
│   │   ├── reform.ts                  # 地基（reformData）3D 渲染层
│   │   ├── replace.ts                 # 批量替换命令
│   │   ├── removeBuilding.ts          # 删除建筑命令（单删/同类删）
│   │   ├── upgrade.ts                 # 建筑升降级命令
│   │   ├── setAccelerator.ts          # 加速模式设置命令
│   │   ├── setBeaconContent.ts        # 全息信标文本修改命令（silent）
│   │   ├── area.ts                    # 网格↔本地坐标转换 + 区域扩展
│   │   └── create.ts                  # 空蓝图创建 + 建筑放置命令
│   ├── editor/
│   │   └── placementState.ts          # 放置状态机（idle/placing/deleting）
│   ├── bvh/
│   │   ├── bvh.ts                     # BVH 加速结构（射线拾取）
│   │   ├── helper.ts                  # 可视化辅助
│   │   └── index.ts
│   ├── components/                    # Vue UI 组件（见 §5.4）
│   ├── data/
│   │   ├── index.ts                   # 汇总导出
│   │   ├── types.ts                   # Item/Recipe/Tech/Signal/MIDI
│   │   ├── items.ts / itemsData.ts    # 物品表 + 分类判定
│   │   ├── recipes.ts / recipesData.ts # 配方表
│   │   ├── building.ts                # 建筑元数据（盒子尺寸/颜色/图标位）
│   │   ├── buildingCategories.ts      # 9 类建筑面板映射（itemId/modelIndex/nameKey）
│   │   ├── icons.ts                   # 图标 ID 体系与 URL
│   │   ├── color.ts                   # 颜色相关
│   │   ├── midi.ts                    # MIDI 信号
│   │   ├── techIconsData.ts           # 科技图标索引
│   │   ├── signalIconsData.ts         # 信号图标索引
│   │   ├── gen.sh / gen_*.py          # 从游戏 Asset 数据生成 ts 数据
│   │   └── ...
│   └── locales/
│       ├── zh.json
│       └── en.json
├── tests/unit/blueprint/              # Jest 单元测试
├── package.json
├── vue.config.js
├── tsconfig.json
├── jest.config.js
├── babel.config.js
└── .eslintrc.js
```

---

## 5. 主要模块职责

### 5.1 蓝图核心模块 `src/blueprint/`

| 文件 | 职责 |
| --- | --- |
| `parser.ts` | 蓝图字符串 `BLUEPRINT:...` 的解析与回写；v1 / v2 双格式；MD5 校验；所有建筑参数的 `ParamParser`。 |
| `md5.ts` | 纯 TypeScript 实现的 MD5，用于蓝图尾部的 32 位 hex 校验和。 |
| `planet.ts` | 把蓝图分区（`BlueprintArea`）摆放回 200 段标准星球的经纬度，输出每个建筑在 3D 球面的变换矩阵。 |
| `buildingInfo.ts` | 根据建筑的 `outputObjIdx/inputObjIdx` 等字段构建建筑邻接表，供信息面板展示上下游链路。 |
| `replace.ts` | `ReplaceCommand`：按配方/过滤器/物流塔栏位/传送带图标/蓝图图标 5 个维度批量替换。 |
| `upgrade.ts` | `UpgradeCommand`：建筑升降级；`upgradeEdges` 升降级有向图、`reachableTargets` 路径计算、`upgradeableItems` 候选集合。 |
| `setAccelerator.ts` | `SetAcceleratorCommand`：批量设置"生产加速 / 额外产出"模式，支持按建筑子集与研究站过滤。 |
| `setBeaconContent.ts` | `SetBeaconContentCommand`：修改全息信标（itemId=2401）`content` 文本字段，`silent=true` 不触发 3D 重建；`merge` 合并对同一建筑的连续编辑。 |
| `reform.ts` | 地基（reformData）3D 渲染层：`Reforms extends Group` + `buildReforms`，把 `BlueprintReformData` 渲染为工字铺（IBEAM）/ 直铺（PLAIN）/ 网格（GRID）+ 自定义颜色（共享 CanvasTexture 与 InstancedMesh）。 |
| `removeBuilding.ts` | `RemoveBuildingsCommand` / `RemoveBuildingCommand` / `RemoveBuildingsByItemCommand`：删除建筑并维护 index 与交叉引用。 |
| `area.ts` | 网格坐标 ↔ 本地偏移转换（`planetToLocal` / `localToPlanet`）与区域扩展（`ensureAreaFor`）。根区域常量：`ROOT_GRID_SIZE=1000`、`ROOT_LATITUDE=-80`。 |
| `create.ts` | `createEmptyBlueprint()`：创建含根区域（赤道带 size.y=161）的空 v2 蓝图；`createBuilding()`：构造最小合法建筑记录；`CreateBuildingCommand`：放置建筑命令，自动扩展根区域 `size.x`。 |

### 5.2 命令与状态层 `src/`

| 文件 | 职责 |
| --- | --- |
| `command.ts` | `Command` 接口、`CommandQueue`（容量 256，支持合并 merge）、`Updater` 与 `EventDispatcher`（增量刷新通道）。 |
| `define.ts` | `version`（来自 `git describe`，由 webpack DefinePlugin 注入）、`rendererKey/buildingInfoKey/commandQueueKey` 三个 `provide` Key。 |
| `i18n.ts` | `createI18n` + `useLang`（自动跟随浏览器语言）+ `itemName/recipeName` 名称查询。 |
| `utils.ts` | `attachRenderer/attachCamera`：把 Three 的 renderer/camera 与 Vue 容器尺寸/窗口 resize 绑定。 |
| `cli.ts` | Node CLI：从 stdin 读蓝图字符串，输出 JSON 结构（`yarn cli`）。 |

### 5.2.1 编辑器状态层 `src/editor/`

| 文件 | 职责 |
| --- | --- |
| `placementState.ts` | 响应式放置状态机单例（`reactive<PlacementState>`）：`mode`（idle/placing/deleting）、`categoryIndex`（1-9）、`selectedItemId` / `selectedModelIndex`、`yaw`（0/90/180/270）、`freePlacement`（Shift 按住）。导出 `usePlacement()` 返回单例，以及 `resetToIdle()` / `selectBuilding()` / `enterDeleteMode()` / `rotateBuilding()` 状态转移函数。 |

### 5.3 3D 渲染层 `src/`

| 文件 | 职责 |
| --- | --- |
| `components/BlueprintEditor.vue` | 编辑器主体：场景装配、相机/控件、BVH 拾取、点击/右键交互、建筑放置/删除（放置模式 / 删除模式 / 选择）、命令后重建场景、`defineExpose` 暴露相机/选择盒/`resetCamera`。 |
| `PlanetMapControls.ts` | 类 `OrbitControls` 但绕星球旋转、dolly、平移，支持鼠标与触摸。 |
| `SphereGridGeometry.ts` | 经/纬度网格 `LineSegments` 几何，用于绘制星球网格。 |
| `bvh/bvh.ts` | 自实现 BVH：对所有建筑选择盒建立层次包围盒，`raycast(ray)` 返回命中建筑 index。 |
| `iconTexture.ts` | 24×24 图标图集纹理，按 `allIconIds()` 预分配槽位，`requestIcon` 懒加载并 `copyTextureToTexture` 上传。 |
| `icons.ts` | 建筑图标的 `InstancedBufferGeometry` + 自定义 `ShaderMaterial`，按 iconId 计算 UV。 |
| `iconSubscript.ts` | 传送带货物计数（如 `12k`）下标渲染。 |
| `cargos.ts` | 传送带/分拣器上滑动的货物 `InstancedMesh`，通过自定义 shader 的 `cargoMove` uniform 实现沿 z 轴移动动画。 |
| `data/building.ts` | 每种建筑模型的 `color/unitBoxTrans/selectUnitBoxTrans/iconTrans`，以及"无图标建筑"集合、物流塔槽位变换。 |

### 5.4 UI 组件层 `src/components/`

| 组件 | 职责 |
| --- | --- |
| `App.vue` | 根布局：3D 编辑区 + 可折叠侧栏（信息/操作两 Tab）+ 蓝图代码区（复制/粘贴/保存文件/新建蓝图）+ 底部建筑面板 + 快捷键（1-9 分类 / F1-F12 选建筑 / X 删除 / R 旋转 / Esc 退出 / Shift 自由放置 / O 侧栏）。 |
| `BlueprintEditor.vue` | 3D 渲染与交互，异步加载（`defineAsyncComponent` + `webpackChunkName: "renderer"`）。 |
| `BuildingPalette.vue` | 底部建筑选择面板：9 个分类标签（1-9）+ 当前分类的建筑图标列表（F1-F12）。点击分类切换、点击建筑进入放置模式、再次点击退出；`disabled` 建筑灰显不可选（传送带/分拣器测试阶段暂不支持）。`position: absolute; bottom: 0; z-index: 10`。 |
| `BuildingInfoPanel.vue` | 选中建筑后展示：配方、分流器、物流塔、监测器、战场基站、储物仓、过滤器、模式等。 |
| `BuildingOverview.vue` | 未选中时按 itemId 聚合的建筑图标列表，右键一键剔除同类。 |
| `BuildingRecipe.vue` | 建筑当前配方的输入/输出图标展示。 |
| `BuildingIcon.vue` / `BlueprintIcon.vue` | 单个建筑图标 / 蓝图头部图标组合渲染。 |
| `StationInfo.vue` | 物流塔（普通/星际/大型采矿机）库存、槽位、参数面板；内部定义 `SetStationStorageItemCommand` / `SetStationParamCommand`（均为 `silent=true`）。物流状态用 `role-supply` / `role-demand` / `role-none` 着色区分本地/星际供需；大型采矿机采集速度用 0%-300%、步长 10% 的滑块；不再显示「本地/星际」文字标签。 |
| `BattleBaseInfo.vue` | 战场分析基站（战斗机编队、自动重建等）。 |
| `MonitorInfo.vue` | 流速监测器参数面板。 |
| `StorageInfo.vue` | 储物仓（含过滤网格）。 |
| `DispenserInfo.vue` | 物流配送器参数。 |
| `SpitterInfo.vue` | 四向分流器（优先级 + v2 extra）。 |
| `HoloBeaconInfo.vue` | 全息信标（itemId=2401）自定义文本编辑面板：`textarea` + dirty 状态检测，失焦或 `Ctrl+Enter` 时 `commit()` 推送 `SetBeaconContentCommand`（连续快速编辑会被 `merge` 合并，避免撤销栈爆炸）。 |
| `WorkEnergyParam.vue` | 工作能耗通用参数输入。 |
| `ParamSlider.vue` | 通用滑块控件：接收 `label / value / steps / format / disabled`，拖动时只更新本地预览索引，松手时通过 `change` 事件提交最终值（便于命令合并）。 |
| `ItemSelect.vue` / `RecipeSelect.vue` / `IconPickerModal.vue` | 物品/配方/图标的搜索选择模态框。 |
| `ReplaceModal.vue` | 批量替换弹窗：6 个互斥范围 Tab（配方/分拣器筛选/物流塔栏位/传送带图标/蓝图图标/升降建筑等级）；切换到"升降建筑等级"显示源/目标建筑图标网格；勾选"配方"时附加速模式单选组（不改变/额外产出/生产加速），执行后顺带推送 `SetAcceleratorCommand`。 |
| `ModalDSP.vue` / `SwitchDSP.vue` / `ColorPreview.vue` | 通用模态框/开关/颜色预览基础控件。 |

### 5.5 数据与资源模块 `src/data/`

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `Item / ItemStack / Recipe / Tech / Signal / MIDI` 类型定义。 |
| `items.ts` | 由 `itemsData.ts` 构建 `itemsMap`；提供 `isBelt/isInserter/isStation/...` 等 itemId 分类判定；`allAssemblers` 集合（用于 `parser.ts` 注册参数解析器）。 |
| `recipes.ts` | 由 `recipesData.ts` 构建 `recipesMap`。 |
| `building.ts` | `buildingMeta` 表：每种模型 ID 的颜色、单位盒/选择盒变换、图标位置；`noIconBuildings`、`stationSlotTrans`。 |
| `buildingCategories.ts` | 9 类建筑面板映射表 `buildingCategories`：每类含 `key`（1-9）、`nameKey`（i18n key）、`buildings[]`（itemId/modelIndex/nameKey/可选 disabled）。传送带（2001-2003）与分拣器（2011-2014）标记 `disabled: true`（测试阶段暂不支持放置）。 |
| `icons.ts` | 图标 ID 体系（<1000 信号、<20000 物品、<40000 配方、<60000 科技）；`iconUrl / allIconIds`。 |
| `color.ts` | 颜色相关工具与地基颜色表。 |
| `midi.ts` | 流速监测器音色（MIDI）数据。 |
| `techIconsData.ts` / `signalIconsData.ts` | 从游戏 Asset 生成的科技/信号图标索引。 |
| `gen.sh` + `gen_*.py` | 从游戏导出的 `ItemProtoSet/RecipeProtoSet/...` JSON 生成对应 `*Data.ts`，并把贴图拷贝到 `assets/icons/`。 |

### 5.6 国际化 `src/locales/`

- `zh.json` / `en.json`：UI 文本、物品名、配方名。
- 组件内 `<i18n>` 块（如 `App.vue`）补充局部文案。
- `i18n:report` 脚本可生成未翻译条目报告。

---

## 6. 关键类与函数说明

### 6.1 `blueprint/parser.ts`

#### 类型（导出）

- `BlueprintArea` / `BlueprintBuilding` / `BlueprintReformRect` / `BlueprintReformData` / `BlueprintData`：蓝图数据结构。
- `AllParameters`：所有建筑参数联合类型。
- 参数接口：`StationParameters / AdvancedMiningMachineParameters / SplitterParameters / AssembleParamerters / LabParamerters / BeltParameters / InserterParameters / TankParameters / StorageParameters / EjectorParameters / PowerGeneratorParameters / ArtifacialStarParameters / EnergyExchangerParameters / MonitorParameters / BattleBaseParameters / DispenserParameters`。
- 枚举：`IODir / LogisticRole / AcceleratorMode / ResearchMode / StorageType / BattleBaseDroneConstructPriority / EnergyExchangerMode / SpawnItemOperator / DispenserPlayerMode / DispenserStorageMode`。

#### 类

- `BufferIO`（abstract）：维护 `pos`，提供 `getView(length)` 子视图（带越界检查）。
- `BufferReader extends BufferIO`：`getUint8/getInt8/getInt16/getInt32/getUint32/getFloat32/getBytes/getString`，`getString` 实现 .NET BinaryWriter 的 7-bit encoded int 长度前缀字符串。
- `BufferWriter extends BufferIO`：上述各类型的 setter，`setString` 同样实现 7-bit 编码。

#### 核心函数

| 函数 | 作用 |
| --- | --- |
| `fromStr(strData): BlueprintData` | 入口：校验 `BLUEPRINT:` 前缀 → 解析头部 cells → MD5 校验尾部 → base64 解码 → `pako.ungzip` → `BufferReader` 读 meta/areas/buildings（v2 走 `importBuildingV2`，v1 走 `importBuilding`）→ 读 `importTailV2` 的 patch/reformData。 |
| `toStr(bp): string` | 入口：写头部 → `BufferWriter` 写 meta/areas/buildings → v2 写 patch + reformDataFlag + reformData + tailExtraBytes → `pako.gzip` → base64 → 拼 MD5 校验。 |
| `encodedSize(bp)` | 预计算二进制体字节数，分配 `Uint8Array`。 |
| `importArea / exportArea` | 14 字节分区的读写。 |
| `importBuilding / exportBuilding` | v1 61 字节固定布局建筑记录的读写。 |
| `importBuildingV2 / exportBuildingV2 / v2BuildingSize / v2ContentSize` | v2 (-102/-101) 记录的读写：marker + index + itemId + model + area + 偏移/yaw/tilt（传送带与分拣器有 tilt，分拣器额外 7 个 float pose）+ 参数段 + content（信标文本，7-bit 前缀字符串）+ `extraBytes`（未知间隙原样保留）。 |
| `isV2RecordMarkerAt(bytes, off)` | 在字节流中识别 v2 记录起始标记（int32 ≤ -100，且后续 index 非负）。 |
| `importReformData / exportReformData / reformDataSize / hasReformData` | 地基矩形列表（每 9 字节，data 高 3 位为类型、低 5 位为颜色）+ 自定义颜色表。 |
| `importTailV2` | 解析建筑数组之后的 patch(int32) + reformDataFlag(u8) + reformData + 0.10.33 预留尾部字节。 |
| `parserFor(itemId)` | 根据 itemId 返回对应 `ParamParser`，未注册的退回 `unknownParamParser`（原始 int32 数组原样保留）。 |
| `stationParamsParser(desc)` / `advancedMiningMachineParamParser` / `splitterParamParser` / `labParamParser` / `assembleParamParser` / `beltParamParser` / `inserterParamParser` / `tankParamParser` / `storageParamParser(size)` / `battleBaseParamParser` / `ejectorParamParser` / `powerGeneratorParamParser` / `artifacialStarParamParser` / `energyExchangerParamParser` / `MonitorParamParser` / `dispenserParamParser` / `unknownParamParser` | 各类建筑参数的 `encodedSize/encode/decode` 三件套。 |
| `getParam / setParam` | 在 `DataView` 上按 `Int32` 槽位读写，`getParam` 支持数据段过短时返回默认值。 |

#### 关键常量

- `V2_RECORD_MARKER = -102`（导出标记，0.10.34+）
- `V2_RECORD_MARKER_MIN = -100`（导入接受下限，兼容 -101 与 -102）
- `V2_BELT_ITEM_IDS = {2001,2002,2003}`、`V2_INSERTER_ITEM_IDS = {2011..2014}`
- `V2_RECORD_GAP_LIMIT = 64`：未知尾部扩展最大搜索字节数
- `REFORM_COUNT_LIMIT = 2930400`：地基矩形数量上限
- `parameterParsers`：itemId → `ParamParser` 注册表，包含物流塔/星际站/分流器/研究站/传送带/分拣器/储物仓/储液罐/弹射器/射线接收/人造恒星/能量枢纽/监测器/战场基站/配送器，并按 `allAssemblers` 为所有制造台/熔炉等注册 `assembleParamParser`。

### 6.2 `command.ts`

- `EventDispatcher<TArgs>`：`on / onMounted / dispatch`，基于 `Set`；额外 `clear()` 清空回调，防止 `registerUpdater` 在场景重建时重复注册或持有已销毁的 `AllBuildings` 引用。
- `Updater`：聚合 5 个 dispatcher：`updateBuildingIcon / updateBeltIcon / updateBeltIconSubscript / updateSorterIcon / updateStationInfo`；`clearAll()` 一键清空全部回调（重建前调用）。
- `Command` 接口：`do(data, updater) / undo(data, updater) / merge(c): boolean`，另含 `readonly silent?: boolean`。
  - `silent = true`：只改图标/颜色/文字/纯数据，不改变几何/拓扑 → 仅触发 `stateVersion++`，不触发 `execVersion++`，3D 层不重建。
  - `silent = false`（默认或省略）：改变了几何/拓扑（模型/尺寸/位置/连接关系/数组增删）→ 同时触发 `stateVersion++` 与 `execVersion++`，`BlueprintEditor` 重建整场景。
- `CommandQueue`：
  - 容量 `_maxSize = 256`，`trim()` 从队首丢弃；
  - `push(c)`：丢弃当前位置之后的命令 → `c.do` → 尝试与上一条 `merge`（命中则直接返回，不再入栈也不再自增版本号）→ 入栈 → `currentPosition++` → 自增 `stateVersion`；若 `!c.silent` 再自增 `execVersion`；
  - `undo/redo`：移动 `currentPosition`，执行对应 `do/undo`，自增 `stateVersion`；若命令非 `silent` 再自增 `execVersion`（保证 silent 命令的撤销也不会错误地触发整场景重建，同时仍能让 `codeExpired` 过期）；
  - `stateVersion`：每次命令（无论 silent 与否）都递增，`App.vue` 用 `watchEffect` 监听它把 `codeExpired` 置 `true`（蓝图字符串需重新生成）。
  - `execVersion`：仅非 silent 命令递增，`BlueprintEditor` 的 `computed(b)` 依赖它触发整场景重建。

### 6.3 `blueprint/replace.ts` `ReplaceCommand`

- 构造时按 5 个 scope 收集：`recipeBuildings / filterBuildings / stationStorage / beltBuildings / blueprintIconIndex`。
- `replace(recipeId, data, updater)`：将上述集合的 recipeId/filterId/storage[].itemId/belt iconId/header.icons[i] 全部替换并通过 `Updater` 触发增量刷新。
- `do` 用 `replaceRecipeId`，`undo` 用 `searchRecipeId`，`merge` 永远 false。

### 6.4 `blueprint/removeBuilding.ts` `RemoveBuildingsCommand`

- 构造时去重排序得到 `removed` 与 `removeSet`。
- `do`：构建 `newIndexOf`（旧→新映射）→ 记录幸存建筑指向被删建筑的连接（`dangling`）→ 倒序 `splice` 删除 → 重排 index 与 `outputObjIdx/inputObjIdx` 引用。
- `undo`：原样插回建筑对象（参数/扩展字节日级不变）→ 恢复 index → 用 `oldIndexOfNew` 把幸存者的引用映射回旧 index → 恢复 `dangling` 连接。
- `RemoveBuildingCommand`（单删）与 `RemoveBuildingsByItemCommand`（同类删）是其子类。

### 6.5 `blueprint/buildingInfo.ts` `BuildingInfo`

- 构造时遍历建筑，根据 `outputObjIdx/inputObjIdx/outputFromSlot/outputToSlot/inputFromSlot/inputToSlot` 填充 `adjacency[i][slot]` 邻接表。

### 6.6 `blueprint/planet.ts`

- `segmentArr` + `segmentMap`：星球纬度带与 segment 数的映射（200 段标准星球）。
- `calcLatitudeSeg / planetAreaByIndex / planetAreaByLongitudeSegment / gridAreas`：计算每个带的经纬度段数。
- `findPosForAreas(areas, segment=200): PositionedBlueprint`：把蓝图的多个 `BlueprintArea` 摆回标准星球，核心是：
  1. 以 `parentIndex` 构建邻接表，找根 area；
  2. 用 `lcm` 计算 `longitudeBase/period`，暴力搜索满足所有 area 锚点约束的 `longitude`；
  3. 由根 area 的子 area `anchorLocalOffset.y` 推断南北半球与纬度，递归填子 area 纬度。
- `calcBuildingTrans(R, pos, building): Matrix4[]`：把建筑的 `localOffset` 转为两个端点（起/止）的 4x4 世界变换矩阵（含 yaw/tilt），用于 3D 渲染与 BVH。

### 6.7 `components/BlueprintEditor.vue`

- 顶层函数：`buildPlanetGrid / inserterTrans / buildingIconId / buildingIconPos / beltIconPos / sorterIconPos / buildBuildings / buildBVH / registerUpdater`。
- `AllBuildings extends Object3D`：聚合 meshes + iconsMesh + iconTexture + cargos + modelRef。
- `<script setup>`：
  - 创建 `Scene / Camera / Renderer`，挂载星球球与经纬网格；
  - `b = computed(...)`：监听 `commandQueue.execVersion`，调用 `findPosForAreas` + `calcBuildingTrans` + `buildBuildings` + `buildBVH` + `registerUpdater`；
  - `watchEffect` 把 `b.value.buildings` 加入/移出场景并 `dispose`；
  - 选择盒 `watchEffect`：根据 `props.selectedBuildingIndex` 把 BVH 的对应盒矩阵复制到 `selectBox`；
  - `onMounted`：实例化 `PlanetMapControls`，绑定交互事件（`mousedown` 记录按下位置 + `click` 判断拖拽阈值后分发到放置/删除/拾取 + `contextmenu` 退出放置/删除模式）、`requestAnimationFrame(animate)` 渲染循环，并把 `controls.updateTimeDelta / cargos.cargoMove` 推进。事件监听注册在 `rootEl`（`.editor-root` 父 div）上而非 canvas，事件从 canvas 冒泡而来，避免 `PlanetMapControls.setPointerCapture` 干扰鼠标事件传递。
  - **放置模式**（`placement.mode === 'placing'`）：`screenToPlanet(e)` 射线打到星球球面 → 转换为网格坐标 `latGrid/lonGrid` → `planetToLocal()` 映射为根区域本地偏移 → 非 `freePlacement` 时取 `floor` 网格对齐 → `createBuilding()` 构造建筑 → `queue.push(new CreateBuildingCommand(building))`；越界（赤道带外）静默忽略。
  - **删除模式**（`placement.mode === 'deleting'`）：`pickBuilding(e)` 命中建筑 → `queue.push(new RemoveBuildingCommand(index, ...))` → emit `selectedBuildingIndex = null`。
  - **拖拽判定**：`mousedown` 记录 `downPos`，`click` 时计算位移，超过 4px 阈值视为拖拽（相机旋转）不触发放置/删除/拾取。
  - `resetCamera()`：调用 `controls?.reset(2 * R)` 把相机重置到星球正上方默认距离（`target=(0,0,0)`、`spherical=(2R, π/2, 0)`），同时清空 `sphericalDelta / panOffset / scale`。
  - `defineExpose({ selectBoxes, camera, cameraPosVersion, getModel, resetCamera })` 供父组件访问。`App.vue` 的 `parseBp` 在检测到蓝图内容变化（建筑数量或尾部 MD5 后 33 位变化）时调用 `renderer.value?.resetCamera()` 重置视角，覆盖 clear / 粘贴 / 选择文件 / 输入框覆盖 四条替换路径；同一蓝图重复粘贴（MD5/建筑数不变）不会触发重置。

### 6.8 `iconTexture.ts` `IconTexture`

- 24×24 槽位的图集纹理，0 号槽位为空图标。
- 构造时按 `allIconIds()` 顺序预分配槽位 index。
- `requestIcon(iconId)`：返回槽位 index，若未加载则异步 `iconUrl(iconId)` → `TextureLoader.loadAsync` → `renderer.copyTextureToTexture` 把子图拷到图集对应位置。

### 6.9 `bvh/bvh.ts` `BVH`

- 输入：建筑选择盒 `Matrix4[]`。
- 构建层次包围盒（按最长轴递归 partition），节点持有 `idx: Int32Array` 与 `bounding: Box3`。
- `raycast(ray)`：递归遍历，把命中三角形的 `{index, distanceSquared}` 升序返回，用于点击拾取。
- `boxes`：暴露每个建筑的选择盒矩阵，供高亮与拾取。

### 6.10 `blueprint/upgrade.ts` 建筑升降级

#### 常量与导出

- `upgradeEdges: [number, number][]`：低级 → 高级的有向边集合，覆盖传送带（2001→2002→2003）、分拣器（2011→2012→2013→2014）、制造台（2303→2304→2305→2318）、熔炉（2302→2315→2319）、研究站（2901→2902）、化工厂（2309→2317）。注：源码注释明确修正了原 `2302→2319` 的笔误，按"位面 → 负熵"的真实意图拆为 `2302→2315` 与 `2315→2319`。
- `upAdj` / `downAdj`：模块内部由 `upgradeEdges` 构建的升级/降级邻接表（`Record<number, number[]>`）。
- `upgradeableItems: number[]`：所有参与升降级的 itemId 去重升序集合，供 UI 渲染候选图标网格。

#### 函数

| 函数 | 作用 |
| --- | --- |
| `reachN(adj, start, n)` | 从 `start` 出发走恰好 `n` 步能到达的节点前沿（不含自身），用迭代 BFS 推进；用于可达性查询。 |
| `reachableTargets(fromId)` | 返回 `fromId` 在升降级图上能到达的全部目标 itemId（升级 + 降级，含跳级），合并 1..maxSteps 步的 `reachN` 前沿；不可升降级 itemId 返回 `[]`。 |

#### `UpgradeCommand implements Command`

- 构造 `(bp, fromItemId, toItemId)`：校验 `toItemId` 在 `itemsMap` 中且 `models.length > 0`，缓存 `toModelIndex = toItem.models[0]`；遍历 `bp.buildings` 收集所有 `itemId === fromItemId` 的建筑到 `upgraded` 数组，并快照其 `oldItemId / oldModelIndex`。
- `do(_data, updater)`：把每个目标建筑的 `itemId` 与 `modelIndex` 改写为 `toItemId / toModelIndex`，按类型派发图标刷新。
- `undo(_data, updater)`：逐建筑恢复 `oldItemId / oldModelIndex`，对称派发图标刷新。
- `merge()` 恒返回 `false`。
- **图标刷新分流** `dispatchIconUpdate(b, updater)`：传送带走 `updateBeltIcon`、分拣器走 `updateSorterIcon`、其它走 `updateBuildingIcon`。原因：传送带/分拣器的图标槽位仅在 `iconId>0 / filterId>0` 时注册到 `IconGeometry.indexMap`，统一走 `updateBuildingIcon` 会因找不到槽位而抛 `'No icon to update'`。
- **不变性约束**：仅适用于参数格式在各等级间一致的建筑（传送带/分拣器/制造台/熔炉/研究站/化工厂），`parameters` 原样保留无需改动。

### 6.11 `blueprint/setAccelerator.ts` 加速模式设置

#### 类型

- `SetAcceleratorParams`：`{ mode: AcceleratorMode; buildingIndexes?: number[]; labOnly?: boolean }`。
  - `mode`：目标模式（`Accelerate` 生产加速 / `ExtraOutput` 额外产出）。
  - `buildingIndexes`：可选，只作用于这些建筑；省略则对全蓝图生效。
  - `labOnly`：可选，仅作用于研究站（itemId 2901 / 2902）。

#### `SetAcceleratorCommand implements Command`

- 构造 `(bp, params)`：缓存 `targetMode`；遍历 `bp.buildings`，按 `buildingIndexes` 集合与 `labOnly` 过滤，只收集 `parameters` 含 `acceleratorMode` 字段（即 `AssembleParamerters` / `LabParamerters`）的建筑，对每个命中建筑快照其原始 `acceleratorMode` 到 `originalModes`。
- `apply(modes, updater)`：内部工具——把 `buildings[i].parameters.acceleratorMode` 写入对应模式，并 `updateBuildingIcon.dispatch(b)` 派发增量刷新。
- `do(_data, updater)`：用 `targetMode` 数组调用 `apply`，统一设为目标模式。
- `undo(_data, updater)`：用 `originalModes` 数组调用 `apply`，逐建筑精确恢复——混合模式场景下撤销也不会错乱。
- `merge()` 恒返回 `false`。
- **典型用法**：`ReplaceModal.vue` 在勾选"配方"范围并选了具体加速模式时，先 `push(new ReplaceCommand(...))`，再读取 `replaceCmd.recipeBuildings.map(b => b.index)` 作为 `buildingIndexes` 推送 `SetAcceleratorCommand`，从而只对刚被替换配方的建筑翻转加速模式，避免影响其它建筑。

### 6.12 `blueprint/setBeaconContent.ts` 全息信标文本编辑

#### `SetBeaconContentCommand implements Command`

- `readonly silent = true`：纯文本修改，不改变几何/拓扑/3D 模型，撤销/重做只走 `stateVersion` 通道，不触发整场景重建。
- 构造 `(building: BlueprintBuilding, newContent: string)`：缓存 `oldContent = building.content` 与 `newContent`。空字符串视为 `undefined`（即"无信标文本"），避免 v2 导出时写出 0 长度 `content` 段。
- `do`：写入 `newContent`（空→`undefined`）；`undo`：恢复 `oldContent`（空→`undefined`）。
- `merge(c)`：若 `c` 也是 `SetBeaconContentCommand` 且 `c.building === this.building`，则用 `c.newContent` 覆盖当前 `newContent` 并返回 `true`——把对同一信标的连续键入合并为一次撤销步，避免撤销栈爆炸。
- **典型用法**：`HoloBeaconInfo.vue` 用 `textarea` + dirty 检测，失焦或 `Ctrl+Enter` 时 `commit()` 推送本命令；用户连续打字不会每次按键都入栈。

### 6.13 物流塔参数 / 库存命令（`components/StationInfo.vue`）

物流塔的标量参数与库存槽位修改走两条 `silent` 命令，避免每次微调都重建 3D 场景：

- **`SetStationParamCommand implements Command`**（`silent = true`）：修改 `StationParameters` 中的标量字段（运输力 / 运输距离 / 优先级 / 任务模式 / 充能速率等）。
  - 构造时快照 `oldValue`，`do` 写入 `newValue`，`undo` 还原 `oldValue`。
  - `merge`：连续修改**同一建筑同一字段**的命令合并为最新值（用 `building + field` 作为合并键），便于滑块连续拖动只产生一次撤销步。
  - 命中后通过 `updateStationInfo.dispatch(b)` 让 `StationInfo.vue` 的 `stateVersion` computed 局部刷新，不重建几何/BVH/场景。
- **`SetStationStorageItemCommand implements Command`**（`silent = true`）：修改物流塔单个库存槽位的 `itemId / count / localDemand / remoteDemand / localSupply / remoteSupply` 等字段。
  - 同样支持按 `(building, slot, field)` 合并连续编辑。
- **设计约束**：`StationInfo.vue` 用 `computed` 监听 `commandQueue.stateVersion`（而非 `execVersion`）刷新面板；`BlueprintEditor.vue` 的 `registerUpdater` 中注册 `updateStationInfo` 回调，只更新 UV/颜色/下标，不触碰几何体与 BVH。

### 6.14 `blueprint/area.ts` 坐标转换与区域扩展

#### 常量

- `ROOT_SEGMENT = 200`：标准星球段数。
- `GRID_PER_SEGMENT = 5`：每段 5 个网格 → `ROOT_GRID_SIZE = 1000`（整圈网格列数）。
- `ROOT_LATITUDE = -80`：根区域起始纬度（由 `size.y=161` 经 `findPosForAreas` 反推）。

#### 函数

| 函数 | 作用 |
| --- | --- |
| `planetToLocal(latGrid, lonGrid)` | 把星球网格坐标转为根区域本地偏移：经度 `x = lonGrid % 1000`（wrap 到 [0,1000)），纬度 `y = latGrid - (-80)`。 |
| `localToPlanet(offset)` | 逆变换：`lat = offset.y + (-80)`、`lon = offset.x`。 |
| `ensureAreaFor(bp, offset)` | 确保根区域覆盖给定偏移：若 `offset.y` 超出 `[0, size.y)` 返回 -1（赤道带外）；若 `offset.x >= size.x` 则扩展 `size.x = floor(offset.x) + 1`；返回区域索引 0。 |

### 6.15 `blueprint/create.ts` 空蓝图与建筑放置

#### 函数

- `createEmptyBlueprint(): BlueprintData`：创建 v2 空蓝图，含单个根区域（`parentIndex=-1, tropicAnchor=0, areaSegments=200, size={x:10, y:161}`），`gameVersion='0.10.34.28529'`，`shortDesc='新蓝图'`。
- `createBuilding(itemId, modelIndex, offset, yaw): BlueprintBuilding`：构造最小合法 v2 建筑记录，`localOffset` 两端点相同，所有连接字段为 -1（无链接），`parameters: null`（游戏填默认值）。

#### `CreateBuildingCommand implements Command`

- 非 `silent` 命令（改变拓扑）→ 触发 `execVersion++` 整场景重建。
- 构造 `(building: BlueprintBuilding)`：缓存 `building` 引用。
- `do(data)`：快照 `prevSizeX = root.size.x` → `ensureAreaFor(data, building.localOffset[0])` 确保区域覆盖 → 若返回 -1 抛 `'Placement outside equator band'`（由调用方 try-catch 静默忽略）→ 设置 `building.areaIndex` 与 `building.index` → `data.buildings.push(building)`。
- `undo(data)`：`data.buildings.pop()` → 恢复 `root.size.x = prevSizeX`。
- `merge()` 恒返回 `false`。

### 6.16 `editor/placementState.ts` 放置状态机

- **单例模式**：模块级 `reactive<PlacementState>` 对象，`usePlacement()` 返回同一实例，所有组件共享。
- **状态字段**：`mode`（`'idle' | 'placing' | 'deleting'`）、`categoryIndex`（1-9）、`selectedItemId` / `selectedModelIndex`（`null` 表示未选）、`yaw`（0/90/180/270 度）、`freePlacement`（Shift 按住时 `true`，允许非网格对齐的自由放置）。
- **状态转移函数**：
  - `resetToIdle()`：清空 mode / selectedItemId / selectedModelIndex。
  - `selectBuilding(itemId, modelIndex)`：设置 mode='placing' 并记录 itemId / modelIndex / yaw=0。
  - `enterDeleteMode()`：设置 mode='deleting' 并清空选择。
  - `rotateBuilding()`：yaw += 90 mod 360。

### 6.17 `data/buildingCategories.ts` 建筑分类映射

- `buildingCategories: CategoryEntry[]`：9 个分类，每类含 `key`（1-9）、`nameKey`（i18n key）、`buildings[]`。
- 每个建筑条目 `CategoryBuilding`：`itemId` / `modelIndex` / `nameKey`（i18n key）/ 可选 `disabled`（`true` = 灰显不可选）。
- 分类内容：1=电力类、2=矿产类、3=物流类、4=仓储类、5=生产类、6=物流塔类、7=防御类、8=戴森球类、9=地基与信标。
- 传送带（2001-2003）与分拣器（2011-2014）标记 `disabled: true`，测试阶段暂不支持放置（需要连接关系/路径逻辑）。
- `App.vue` 的 `hotkey` 按 `Digit1-Digit9` 切换 `categoryIndex`，按 `F1-F12` 从当前分类选取建筑调用 `selectBuilding()`。

### 6.18 `components/BuildingPalette.vue` 底部建筑面板

- **布局**：`position: absolute; bottom: 0; left: 0; right: 0; z-index: 10`，半透明黑色背景（`#000000c0`）。
- **上半部分** `palette-buildings`：当前分类的建筑图标列表（`BuildingIcon` 组件），水平排列可横向滚动，每个图标下标 F1-F12 序号。
- **下半部分** `palette-categories`：9 个分类标签按钮，显示分类编号与名称。
- **交互**：
  - 点击分类标签 → `placement.categoryIndex = cat.key`。
  - 点击建筑图标 → `disabled` 则忽略；已选中则退出到 idle；否则 `selectBuilding(itemId, modelIndex)`。
  - 选中建筑有蓝色边框高亮（`.selected`），`disabled` 建筑 35% 透明度 + `cursor: not-allowed`。
- **显示条件**：`App.vue` 中 `<BuildingPalette v-if="data" />`，仅在有蓝图数据时渲染。

---

## 7. 蓝图二进制格式与参数编解码

### 7.1 字符串整体结构

```
BLUEPRINT:<headerFormatV2>,<layout>,<icon1..5>,0,<time>,<gameVersion>,<shortDesc>[,<author>,<bpVersion>,<properties>],<desc>"<base64(gzip(body))>"<md5>
```

- 头部用 `,` 分隔，`encodeURIComponent` 编码短描述/作者/版本/属性/介绍。
- `headerFormatV2 = 1` 表示 15 字段新版（含 author/blueprintVersion/properties），`0` 表示 12 字段旧版。
- 时间 `time` 是从公元 1 年起的毫秒数 × 10000（高精度 tick）。
- 尾部 32 位 hex 是 `BLUEPRINT:...up to "`（不含 md5）的 MD5。

### 7.2 body 结构

```
meta: version(int32) cursorOffset{x,y}(int32 x2) cursorTargetArea(int32) dragBoxSize{x,y}(int32 x2) primaryAreaIdx(int32)   = 28 字节
numAreas(uint8)
areas: 14 字节 × numAreas
numBuildings(int32)
buildings: v1=固定61字节/个；v2=变长（见 §7.3）
[v2 only] patch(int32) + reformDataFlag(uint8) + reformData? + tailExtraBytes?
```

### 7.3 v2 建筑记录（-102/-101 标记）

```
marker(int32, ≤ -100)   index(int32)   itemId(int16)   modelIndex(int16)   areaIndex(int8)
p0(xyz float32×3)   yaw0(float32)
[ tilt(float32)              仅传送带/分拣器 ]
[ 7×float32 v2ExtraPose       仅分拣器：第二端姿态原样保留 ]
outputObjIdx(int32) inputObjIdx(int32)
outputToSlot/inputFromSlot/outputFromSlot/inputToSlot/outputOffset/inputOffset (int8×6)
recipeId(int16) filterId(int16)
paramLen(int16) + paramData(int32 × paramLen)
contentLength(int32) + [7-bit str]    # 仅 -102 记录，信标文本
[extraBytes]                          # 与下一记录之间的未知扩展，原样保留
```

### 7.4 参数编码

- 每种 itemId 对应一个 `ParamParser`，提供 `encodedSize / encode / decode`。
- 物流站参数固定 2048 字节（320 起 + storage + slots + 12 槽位），分星际/普通/大型采矿机三种 `desc`。
- 分流器 v2 多 2 个 int32 `extra`；研究站 2 字节（researchMode/acceleratorMode）；传送带 2 字节（iconId/count）；分拣器 1 字节（length）；储液罐 2 字节（input/output）；储物仓变长（10 + size，最小 110）；战场基站继承储物仓（size=60）+ 12 战斗机槽位。
- 未注册 itemId 使用 `unknownParamParser` 把整段 int32 原样保留，保证不丢数据。

### 7.5 地基数据（reformData）

```
reserved(uint8)  rectLen(int32)  rects[rectLen]:
    reserved(uint8) x(int16) y(int16) w(uint8) h(uint8) data(uint8: type<<5 | color) areaIndex(uint8)
customReformColorMask(uint32)  colorLen(int32)  customReformColors[colorLen](uint32)
```

---

## 8. 3D 渲染与交互

### 8.1 场景装配

1. `Scene` + `AmbientLight` + `DirectionalLight`（每帧跟随相机位置）。
2. 星球：`SphereGeometry(R, 200, 100)` + `MeshStandardMaterial`。
3. 经纬网格：`buildPlanetGrid` 用 `SphereLatitudeGridGeometry` 与按纬度带切分的 `SphereLongitudeGridGeometry` 生成 `LineSegments`。

### 8.2 建筑实例化

`buildBuildings(transforms, buildings, renderer)`：

- 把建筑分成 belts / inserters / boxes 三类，分别用 `InstancedMesh` 渲染（CylinderGeometry/BoxGeometry + `MeshLambertMaterial`），`setColorAt` 染色取自 `buildingMeta`。
- 传送带与分拣器还会生成 `Cargos`（滑动货物）InstancedMesh，shader 在 `onBeforeCompile` 注入 `cargoMove` uniform 实现沿 z 移动。
- 图标：`IconTexture` + `IconGeometry`，按 `buildingIconId/beltIconId/sorterIconId` 计算位置与缩放，传送带 count 还会生成 `IconSubscript` 文字。
- 返回 `AllBuildings`，持有 `modelRef[index] = { mesh, instance }`，供 `getModel` 查询。

### 8.3 拾取与选择

- `buildBVH(transforms, buildings)` 为每个建筑算出选择盒（分拣器是沿 z 缩放的 Box，其它取 `selectUnitBoxTrans`），构造 `BVH`。
- `pickBuilding(e)`：把鼠标 NDC 反投影成 `Ray`，先与星球球求交，若星球比建筑更近则视为命中星球（清空 intersects），否则取 BVH 命中第一项。
- `screenToPlanet(e)`：射线与星球球求交，返回 3D 命中点（用于建筑放置）。
- **左键点击**（拖拽阈值 4px 内）按 `placement.mode` 分发：
  - `idle`：emit `update:selectedBuildingIndex`（拾取建筑）。
  - `placing`：`screenToPlanet` → 网格坐标 → `planetToLocal` → `createBuilding` → `queue.push(new CreateBuildingCommand(...))`。
  - `deleting`：`pickBuilding` 命中 → `queue.push(new RemoveBuildingCommand(index, ...))` → emit `null`。
- **右键**（`contextmenu`，区分拖拽与点击）：若 `mode !== 'idle'` 则 `resetToIdle()` 退出放置/删除模式。

### 8.4 命令后重建

- `b = computed(...)` 依赖 `commandQueue.execVersion`：非 `silent` 命令的 `push/undo/redo` 才会让 `execVersion++`，触发整场景重建（`watchEffect` 移除旧 `AllBuildings` 并 `dispose`，重建前调用 `updater.clearAll()` 清空回调以防陈旧引用）。`silent` 命令只让 `stateVersion++`，不进入这条重建路径。
- `App.vue` 另用 `watchEffect` 监听 `commandQueue.stateVersion`，无论是 silent 还是非 silent 命令都把 `codeExpired` 置 `true`，触发蓝图字符串重新生成。
- `Updater` 的 5 个 dispatcher 在 `registerUpdater` 中注册局部回调，允许 silent 命令在不重建场景的情况下刷新图标/物流塔面板（`SetBeaconContentCommand` / `SetStationParamCommand` / `SetStationStorageItemCommand` 常用）。回调内部只更新 UV / 颜色 / 下标，不触碰几何体与 BVH。

### 8.5 相机控件

- `PlanetMapControls extends EventDispatcher`：旋转、dolly（缩放）、平移，支持鼠标 + 触摸 + 键盘。
- `targetRadius`：旋转中心是星球表面点，dolly 限制 `[R*1.04, R*4]`。
- `updateTimeDelta(dt)`：阻尼惯性。
- `reset(distance)`：把 `target` 置 `(0,0,0)`、`spherical` 置 `(distance, π/2, 0)`、清空 `sphericalDelta / panOffset / scale` 并 `update()`，用于蓝图替换时重置视角；由 `BlueprintEditor.resetCamera()` 调用 `controls.reset(2 * R)`。

---

## 9. 命令系统与撤销/重做

### 9.1 流程

```
用户操作（点右键 / 批量替换 / 列表右键删同类）
   │
   ▼
CommandQueue.push(new XxxCommand(...))
   │ 1) 丢弃 currentPosition 之后的命令
   │ 2) command.do(data, updater)        ← 修改 BlueprintData + 派发 Updater 事件
   │ 3) 尝试与上一条 merge (合并连续同类命令)
   │ 4) 入栈 + currentPosition++ + execVersion++
   ▼
BlueprintEditor 的 computed(b) 重建或增量更新 3D 场景
App.vue 的 watchEffect 把 codeExpired 置 true（蓝图字符串需重生成）
```

### 9.2 实现的命令

| 命令 | 文件 | 作用 |
| --- | --- | --- |
| `ReplaceCommand` | `blueprint/replace.ts` | 5 维批量替换配方/过滤器/物流塔/传送带图标/蓝图图标 |
| `UpgradeCommand` | `blueprint/upgrade.ts` | 建筑升降级：把所有 `itemId === fromItemId` 的建筑改写为 `toItemId` 并同步 `modelIndex`，按类型分流图标刷新通道 |
| `SetAcceleratorCommand` | `blueprint/setAccelerator.ts` | 批量设置"生产加速 / 额外产出"模式；支持按 `buildingIndexes` 子集与 `labOnly` 过滤，撤销时逐建筑恢复原始模式 |
| `RemoveBuildingsCommand` | `blueprint/removeBuilding.ts` | 批量删除建筑，维护 index 与交叉引用 |
| `RemoveBuildingCommand` | 同上 | 单个建筑删除（3D 右键） |
| `RemoveBuildingsByItemCommand` | 同上 | 同 itemId 全部删除（列表右键） |
| `SetBeaconContentCommand` | `blueprint/setBeaconContent.ts` | 修改全息信标（itemId=2401）`content` 文本；`silent=true`，合并同一建筑的连续编辑 |
| `SetStationParamCommand` | `components/StationInfo.vue` | 修改物流塔标量参数（运输力/距离/优先级/任务模式等）；`silent=true`，按 `(building, field)` 合并连续编辑 |
| `SetStationStorageItemCommand` | `components/StationInfo.vue` | 修改物流塔单个库存槽位（itemId/count/供需等）；`silent=true`，按 `(building, slot, field)` 合并连续编辑 |
| `CreateBuildingCommand` | `blueprint/create.ts` | 在星球上放置单个建筑；非 `silent`（触发整场景重建）；`ensureAreaFor` 自动扩展根区域 `size.x`；赤道带外静默忽略 |

### 9.3 快捷键

- `Ctrl+Z` 撤销，`Ctrl+Y` 或 `Ctrl+Shift+Z` 重做（`App.vue` 的 `hotkey`）。
- `1`-`9`：切换建筑分类（`placement.categoryIndex`）。
- `F1`-`F12`：从当前分类选中建筑，进入放置模式（`selectBuilding`）；`disabled` 建筑不可选。
- `X`：进入删除模式（`enterDeleteMode`），左键点击建筑删除。
- `R`：旋转 90°（仅在放置模式，`rotateBuilding`）。
- `Esc`：退出放置/删除模式回到 idle（`resetToIdle`）。
- `Shift`（按住）：自由放置模式（`freePlacement = true`），不网格对齐。
- `O` / `0`：切换侧栏（非固定状态，放置模式下不触发）。
- 在 `INPUT` / `TEXTAREA` / `SELECT` 中打字时不触发快捷键。

---

## 10. 数据与资源模块

### 10.1 图标 ID 体系（`data/icons.ts`）

| 区间 | 含义 | URL 模板 |
| --- | --- | --- |
| `< 1000` | 信号 | `assets/icons/signal/signal-{id}.png` |
| `< 20000` | 物品 | `assets/icons/item_recipe/{item.icon}.png` |
| `< 40000` | 配方（`recipeId + 20000`） | `assets/icons/item_recipe/{recipe.icon}.png` |
| `< 60000` | 科技（`techId + 40000`） | `assets/icons/tech/{techId}.png` |

`recipeIconId(recipeId)`：若配方有独立图标返回 `recipeId + 20000`，否则退化到产物的 `itemIconId`。

### 10.2 建筑元数据（`data/building.ts`）

- `buildingMetaRaw`：手工维护的 `[modelIndex, {color, box:[w,h,d], offset:[x,y,z]}]` 表。
- 派生 `unitBoxTrans`（渲染盒，缩放 0.9/0.999/0.9）、`selectUnitBoxTrans`（拾取盒，原尺寸）、`iconTrans`（图标位置：高度 `<4` 取一半，否则 `box[1]-2`）。
- `noIconBuildings`：分流器/集装机/监测器/喷涂机/电力感应塔/无线输电塔不显示图标。
- `stationSlotTrans`：物流塔 12 个槽位的局部平移。

### 10.3 数据生成管线（`data/gen.sh`）

```
# 输入：AssetStudio 导出的 MonoBehaviour JSON 与 Texture2D png
python3 gen_items.py        < ItemProtoSet.json   > itemsData.ts
python3 gen_midi.py         < MIDIProtoSet.json   > midi.ts
python3 gen_recipes.py      < RecipeProtoSet.json > recipesData.ts
python3 gen_signal_icons.py < SignalProtoSet.json > signalIconsData.ts
python3 gen_tech_icons.py   < TechProtoSet.json   > techIconsData.ts
# 复制贴图到 assets/icons/{tech,signal,item_recipe}/
python3 i18n.py ... -o ../locales     # 生成 zh/en locale
```

### 10.4 物品分类判定（`data/items.ts`）

`isBelt(2001..2003) / isInserter(2011..2014) / isStation(2103,2104,2316) / isInterstellarStation(2104) / isSplitter(2020) / isLab(2901,2902) / isStorage(2101,2102,3009) / isTank(2106) / isEjector(2311) / isRayReciver(2208) / isArtificialStar(2210) / isEnergyExchanger(2209) / isAdvancedMiningMachine(2316) / isMonitor(2030) / isBattleBase(3009) / isDispenser(2107)`。

`allAssemblers`：所有制造台/熔炉/精炼厂/化工厂/对撞机/研究站集合，在 `parser.ts` 中为它们注册 `assembleParamParser`。

---

## 11. 国际化

- `i18n.ts` 创建 `vue-i18n` 实例，`useLang()` 返回 `'auto' | 'en' | 'zh'` 的 ref，`auto` 时跟随 `navigator.language`，并通过 `watchEffect` 写回 `i18n.global.locale`。
- `itemName(id) / recipeName(id)`：从 `itemsMap/recipesMap` 取出名称 key，再用 `i18n.global.t` 翻译。
- `vue.config.js` 的 `pluginOptions.i18n` 配置 `localeDir: 'locales'`、`compositionOnly: true`、`fullInstall: true`。
- 组件内可用 `<i18n>{ zh: {...}, en: {...} }</i18n>` 块声明局部文案（见 `App.vue`）。

---

## 12. 测试体系

### 12.1 配置

- `jest.config.js`：`babel-jest` 处理 js，`ts-jest` 处理 ts（带 `babelConfig: true`），`@vue/vue3-jest` 处理 vue；`moduleNameMapper '^@/(.*)$' → '<rootDir>/src/$1'`。
- 测试位于 `tests/unit/blueprint/`，fixtures 在 `tests/unit/blueprint/fixtures/`。

### 12.2 测试用例

| 文件 | 覆盖 |
| --- | --- |
| `parser.spec.ts` | v1 round-trip；v2 三份 fixture（`same_buildings_v2 / sample_outpost_ils / sample_throughput`）的**字节级** round-trip（`extractBody` + `headerCells` 对比，时间字段允许 1ms 误差）。 |
| `md5.spec.ts` | MD5 实现的正确性。 |
| `planet.spec.ts` | `findPosForAreas` 与 `calcBuildingTrans` 的位置计算。 |
| `removeBuilding.spec.ts` | 删除建筑后 index/交叉引用的正确性 + 撤销恢复。 |
| `dense_splitters.spec.ts` | 密集分流器的 v2 解析。 |
| `foundation.spec.ts` | 地基（reformData）的解析与回写。 |

### 12.3 运行

```bash
yarn test:unit            # 跑全部 *.spec.ts
yarn test:unit -- --watch # 监视模式
```

---

## 13. 运行与构建方式

### 13.1 安装

```bash
yarn install   # 或 npm install
```

### 13.2 常用脚本（`package.json` scripts）

| 命令 | 作用 |
| --- | --- |
| `yarn serve` | `vue-cli-service serve`：开发服务器 + HMR。 |
| `yarn build` | `vue-cli-service build`：生产构建到 `dist/`。 |
| `yarn lint` | `vue-cli-service lint`：ESLint 自动修复。 |
| `yarn test:unit` | `jest`：跑单元测试。 |
| `yarn build-cli` | `tsc --module commonjs --outDir cli`：把 `src/cli.ts` 等编译成 CommonJS 到 `cli/`。 |
| `yarn cli` | `ts-node src/cli.ts`：从 stdin 读蓝图字符串，stdout 输出 JSON 结构。 |
| `yarn i18n:report` | 生成 i18n 翻译覆盖报告。 |

### 13.3 CLI 用法

```bash
echo 'BLUEPRINT:0,10,...' | yarn cli   # 输出结构化 JSON
# 或
cat blueprint.txt | yarn cli > bp.json
```

### 13.4 关键配置

- `vue.config.js`：
  - `publicPath: '/dsp_blueprint_editor/'`：GitHub Pages 子路径部署。
  - 自定义 webpack 规则：`/assets/` 走 `asset`，`assets/icons/(item_recipe|signal|tech)/` 走 `asset/resource`（保留文件名，便于运行时按名加载）。
  - `resolve.alias.three$ = 'three/src/Three.js'`：直接引用源码版以便 tree-shake 与调试。
  - `DefinePlugin` 注入 `VERSION = git describe --tags --always --dirty`。
  - `pwa` 配置：名称"戴森球计划蓝图预览"，主题色 `#000000`，PWA 图标来自 `public/img/icons/`。
- `tsconfig.json`：`target/module: esnext`，`strict: true`，`paths '@/*': ['src/*']`，`types: ['webpack-env','jest']`。
- `.browserslistrc`：浏览器兼容范围。
- `babel.config.js`：Vue CLI babel 预设。

### 13.5 本地开发流程

1. `yarn install`
2. `yarn serve` → 浏览器打开提示的本地地址。
3. 把游戏内复制的蓝图字符串粘贴到右侧"蓝图代码"文本框，或用"选择文件"加载 .txt。
4. 在 3D 视图中点选/右键建筑，或在"操作"Tab 进行批量替换/撤销/重做。
5. 修改后点击"复制"或"保存文件"得到新蓝图字符串，粘贴回游戏。

---

## 14. CI/CD 与部署

### 14.1 GitHub Pages（`.github/workflows/gh-pages.yml`）

- 触发：`push` 到 `main` 分支。
- 步骤：
  1. `actions/checkout@v4`（`fetch-depth: 0` 以便 `git describe` 能拿到 tag）。
  2. `actions/setup-node@v4`，Node 18，`cache: yarn`。
  3. `yarn install` + `yarn build`。
  4. `actions/upload-pages-artifact@v3` 上传 `dist/`。
  5. `actions/deploy-pages@v4` 部署到 GitHub Pages，环境 `github-pages`，需要 `pages: write` 与 `id-token: write` 权限。
- 部署 URL 形如 `https://<user>.github.io/dsp_blueprint_editor/`（与 `publicPath` 对应）。

### 14.2 版本号

- 构建时通过 `git describe --tags --always --dirty` 注入 `VERSION` 全局常量，`App.vue` 在页脚显示。

---

## 15. 附：关键概念速查表

| 概念 | 说明 |
| --- | --- |
| `BlueprintData` | 解析后的蓝图根对象，含 `header / version / areas / buildings / patch? / reformData? / tailExtraBytes?`。 |
| `version` | body 版本：1=旧版 61 字节固定布局；2=0.10.30+ 变长记录（含 marker/content/extraBytes/reformData）。 |
| `headerFormatV2` | 头部是否含 author/blueprintVersion/properties（由头部首字段 `1`/`0` 决定，与 body `version` 解耦）。 |
| `V2_RECORD_MARKER` | `-102`（导出，0.10.34+），导入接受 `≤ -100`（兼容 `-101`）。 |
| `v2ExtraPose` | 分拣器第二端的 7 个 float，原样保留。 |
| `extraBytes` | 单条建筑记录与下一记录之间的未知扩展字节，原样保留以保证 round-trip。 |
| `tailExtraBytes` | v2 body 尾部 reformData 之后的预留字节（0.10.33 实测 5 字节），原样保留。 |
| `content` | -102 记录里的信标等自定义文本，7-bit 前缀 UTF-8 字符串。 |
| `reformData` | 星球地基（地形改造）矩形列表 + 自定义颜色表。 |
| `parameterParsers` | itemId → ParamParser 注册表，覆盖所有已知建筑，未知用 `unknownParamParser`。 |
| `Updater` | 5 个 `EventDispatcher` + `clearAll()`，命令修改数据后用来通知 3D 层做**增量**刷新（避免整场景重建）。 |
| `silent` | `Command` 接口标志位：`true`=纯数据变更（图标/颜色/文字），仅 `stateVersion++`；`false`=几何/拓扑变更，同时 `execVersion++` 触发重建。 |
| `stateVersion` | `CommandQueue` 状态版本号 ref，每次命令（无论 silent）都递增；`App.vue` 监听它把 `codeExpired` 置 `true`。 |
| `execVersion` | `CommandQueue` 执行版本号 ref，仅非 silent 命令递增；`BlueprintEditor` 的 `computed(b)` 依赖它触发整场景重建。 |
| `resetCamera` | `BlueprintEditor` 通过 `defineExpose` 暴露的方法，内部调用 `controls.reset(2 * R)`；`App.vue.parseBp` 在蓝图替换（建筑数或尾部 MD5 后 33 位变化）时调用以重置视角。 |
| `BVH` | 自实现层次包围盒，加速鼠标射线与建筑选择盒求交。 |
| `IconTexture` | 24×24 图标图集，懒加载并 `copyTextureToTexture` 上传。 |
| `buildingMeta` | 每个模型 ID 的颜色/单位盒/选择盒/图标位置变换。 |
| `findPosForAreas` | 把蓝图多个分区摆回 200 段标准星球的经纬度。 |
| `calcBuildingTrans` | 把建筑 `localOffset` 转为 3D 世界变换矩阵（两个端点）。 |
| `CommandQueue` | 容量 256 的撤销栈，支持 `merge` 合并连续命令。 |
| `noIconBuildings` | 分流器/集装机/监测器/喷涂机/电力感应塔/无线输电塔不渲染图标。 |
| `VERSION` | 来自 `git describe`，由 webpack DefinePlugin 注入。 |
| `publicPath` | `/dsp_blueprint_editor/`，与 GitHub Pages 子路径一致。 |
| `upgradeEdges` | 建筑升降级有向边集合（低级→高级），覆盖传送带/分拣器/制造台/熔炉/研究站/化工厂；`upAdj`/`downAdj` 是其正反向邻接表。 |
| `reachableTargets(fromId)` | 在升降级图上从 `fromId` 能到达的全部目标 itemId（升级+降级+跳级），用于 `ReplaceModal` 渲染目标建筑候选。 |
| `UpgradeCommand` | 建筑升降级命令：改写 itemId/modelIndex，按类型分流到 `updateBeltIcon`/`updateSorterIcon`/`updateBuildingIcon` 三个图标刷新通道。 |
| `SetAcceleratorCommand` | 批量设置加速模式命令：作用于含 `acceleratorMode` 字段的建筑（制造台/熔炉/精炼厂/化工厂/对撞机/研究站）；`ReplaceModal` 在替换配方后用它顺带翻转模式。 |
| `AcceleratorMode` | 加速模式枚举：`Accelerate`=生产加速、`ExtraOutput`=额外产出；由 `assembleParamParser`/`labParamParser` 编解码。 |
| `dispatchIconUpdate` | `UpgradeCommand` 内部的图标刷新分流函数，避免传送带/分拣器走错通道抛 `'No icon to update'`。 |
| `reform.ts` | 地基 3D 渲染层：`Reforms extends Group` + `buildReforms`，把 `BlueprintReformData` 渲染为工字铺/直铺/网格 + 自定义颜色（共享 `CanvasTexture` + `InstancedMesh`）。 |
| `SetBeaconContentCommand` | 修改全息信标（itemId=2401）`content` 文本的 silent 命令；`merge` 合并对同一建筑的连续编辑。 |
| `SetStationParamCommand` / `SetStationStorageItemCommand` | 物流塔标量参数 / 库存槽位的 silent 命令，分别按 `(building, field)` 与 `(building, slot, field)` 合并连续编辑。 |
| `HoloBeaconInfo.vue` | 全息信标文本编辑面板：`textarea` + dirty 检测，失焦或 `Ctrl+Enter` 时推送 `SetBeaconContentCommand`。 |
| `ParamSlider.vue` | 通用滑块控件：拖动时只更新本地预览，松手时通过 `change` 提交最终值，便于命令合并。 |
| `area.ts` | 网格↔本地坐标转换（`planetToLocal`/`localToPlanet`）与区域扩展（`ensureAreaFor`）；根区域常量 `ROOT_GRID_SIZE=1000`、`ROOT_LATITUDE=-80`。 |
| `create.ts` | 空蓝图创建（`createEmptyBlueprint`）、建筑构造（`createBuilding`）、放置命令（`CreateBuildingCommand`，非 silent，自动扩展 `size.x`）。 |
| `placementState.ts` | 放置状态机单例（`usePlacement()`）：`mode`（idle/placing/deleting）、`categoryIndex`（1-9）、`selectedItemId/selectedModelIndex`、`yaw`、`freePlacement`（Shift）。 |
| `buildingCategories.ts` | 9 类建筑面板映射表：每类含 `buildings[]`（itemId/modelIndex/nameKey/disabled）；传送带与分拣器标记 `disabled`。 |
| `BuildingPalette.vue` | 底部建筑选择面板：分类标签（1-9）+ 建筑图标（F1-F12）；点击选中进入放置模式，再点退出。 |
| `CreateBuildingCommand` | 放置建筑命令（非 silent）：`do` 调用 `ensureAreaFor` 确保区域覆盖并 `push` 建筑；`undo` `pop` 建筑并恢复 `size.x`；赤道带外抛异常由调用方静默忽略。 |
| `placement.mode` | 放置模式状态：`idle`（拾取建筑）、`placing`（左键放置建筑）、`deleting`（左键删除建筑）。右键/Esc 退出到 idle。 |
| `freePlacement` | Shift 按住时 `true`，建筑放置不做 `floor` 网格对齐，允许任意位置。 |
| 拖拽阈值 | 4px：`mousedown` 记录位置，`click` 时位移超过 4px 视为相机拖拽，不触发放置/删除/拾取。事件监听在 `rootEl` 上（非 canvas），避免 `setPointerCapture` 干扰。 |

---

> 本 Wiki 基于当前仓库代码静态生成，若 `src/blueprint/parser.ts`、`src/blueprint/reform.ts`、`src/blueprint/area.ts`、`src/blueprint/create.ts`、`src/command.ts`、`src/editor/placementState.ts`、`data/` 或 `components/BlueprintEditor.vue` 发生结构性变更，请同步更新对应章节。
