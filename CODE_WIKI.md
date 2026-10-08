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
│   │ 3D 渲染层             │  侧栏信息/操作/统计面板   │  Provide    │   │
│   │ BlueprintEditor.vue   │  BuildingInfoPanel      │  rendererKey│   │
│   │  (Three.js Scene)     │  BuildingOverview        │  building.. │   │
│   │   ├ planet.ts         │  ReplaceModal           │  commandQue.│   │
│   │   ├ bvh/ (射线拾取)    │  IconPickerModal        │             │   │
│   │   ├ iconTexture.ts    │  BuildingIcon           │             │   │
│   │   ├ icons.ts          │  BlueprintIcon          │             │   │
│   │   ├ cargos.ts         │  ModalDSP               │             │   │
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
│   ├── iconTexture.ts                 # 图标图集（24×24 槽位，每槽 80px）
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
│   │   └── removeBuilding.ts          # 删除建筑命令（单删/同类删）
│   ├── bvh/
│   │   ├── bvh.ts                     # BVH 加速结构（射线拾取）
│   │   ├── helper.ts                  # 可视化辅助
│   │   └── index.ts
│   ├── components/                    # Vue UI 组件（见 §5.4）
│   │   ├── ShortcutHint.vue           # 左侧悬浮快捷键提示（随模式切换）
│   │   ├── ProductionStats.vue        # 生产统计面板
│   │   ├── DefaultInfo.vue            # 无专属面板建筑的兜底信息
│   │   └── _icon-select.scss          # ItemSelect/RecipeSelect 共享样式
│   ├── data/
│   │   ├── index.ts                   # 汇总导出
│   │   ├── types.ts                   # Item/Recipe/Tech/Signal/MIDI
│   │   ├── items.ts / itemsData.ts    # 物品表 + 分类判定
│   │   ├── recipes.ts / recipesData.ts # 配方表
│   │   ├── building.ts                # 建筑元数据（盒子尺寸/颜色/图标位）
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
├── tests/unit/blueprint/              # Jest 单元测试（10 个 *.spec.ts + fixtures/）
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
| `area.ts` | 编辑期区域坐标：`planetToLocal / localToPlanet`（**必须传入区域定位 `AreaGridOrigin` = `findPosForAreas(...).areas[areaIndex]`**，见 §6.19）、`ensureAreaFor`（放置时扩张根区域）与 `normalizeBlueprintAreas`（导出时把根区域收缩到实际建筑区间，环形经度取最小覆盖弧）。归一化时**必须保留 `v2ExtraPose`**（只随 `localOffset[1]` 平移尖端坐标）：它是分拣器的姿态角来源，丢一次就会让导出退化成 `[0,…,0]`，游戏里表现为"分拣器角度偏移"报错。 |
| `create.ts` | 新建蓝图与入库：`createEmptyBlueprint`（根区域 size 10×161 的临时画布）、`createBuilding`（最小合法 v2 记录，可选 `z` = 堆叠高度；可堆叠建筑按游戏写堆叠端口默认值 `out=14/15`、`in=15/14`，见 §6.14）、`CreateBuildingCommand`。 |
| `beltLine.ts` | 传送带铺线：`rasterizeLine`（latFirst / lonFirst / straight 三种走法）、`buildBeltLine`（逐格算 yaw，**拐角格 = 进入/离开方向的平分角**，即 45° 斜角，与游戏一致；起/止可绑定建筑口 `BeltPortEnd`，见 §6.20）、`CreateBeltLineCommand`（整条一次撤销；重叠格按"末格复用 / 线路中间截断 / 口格占用截断"处理，避免同格两条带；接到物流站口时同步该口 `dir`）。 |
| `sorter.ts` | 分拣器连接构造：`createSorterBetween`（建筑↔建筑 / 建筑↔皮带 / 皮带↔皮带 / 分流器），规则见 §6.12；导出 `splitterPortAt` / `findByIndex` 供分流器口功能复用。 |
| `splitterPorts.ts` | 分流器口角色与交互规则（§6.17）：`splitterPortKinds / splitterPortKind / hasPrioritizedOutput / splitterPortClickAction`。 |
| `setSplitterPort.ts` | `SetSplitterPriorityCommand`（优先输入/输出，取消时若无优先输出口则一并清空筛选）、`SetSplitterFilterCommand`（优先输出口的筛选物品），均为 `silent`。 |
| `setBeltParams.ts` | `SetBeltParamsCommand`：传送带图标/数量；`parameters` 为 null（游戏默认）时按需创建 `{iconId, count}`，见 §6.18。 |
| `setStationPort.ts` | `SetStationPortCommand`（物流站 12 个口的**方向** `dir` 与**携带物品序号** `storageIdx`，`silent`；改物品时同步口上那条带的显示图标）、`stationPortItemId / stationPortItemChoices`（0=无 / 1..N=物品栏 / 大塔第 N+1 项 = 空间翘曲器 1210），见 §6.20。 |

### 5.2 命令与状态层 `src/`

| 文件 | 职责 |
| --- | --- |
| `command.ts` | `Command` 接口、`CommandQueue`（容量 256，支持合并 merge）、`Updater` 与 `EventDispatcher`（增量刷新通道）。 |
| `define.ts` | `version`（来自 `git describe`，由 webpack DefinePlugin 注入）、`rendererKey/buildingInfoKey/commandQueueKey` 三个 `provide` Key。 |
| `i18n.ts` | `createI18n` + `useLang`（自动跟随浏览器语言）+ `itemName/recipeName` 名称查询。 |
| `utils.ts` | `attachRenderer/attachCamera`：把 Three 的 renderer/camera 与 Vue 容器尺寸/窗口 resize 绑定。 |
| `cli.ts` | Node CLI：从 stdin 读蓝图字符串，输出 JSON 结构（`yarn cli`）。 |

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
| `App.vue` | 根布局：3D 编辑区 + 可折叠侧栏（信息/操作两 Tab）+ 蓝图代码区（复制/粘贴/保存文件）+ 快捷键。 |
| `BlueprintEditor.vue` | 3D 渲染与交互，异步加载（`defineAsyncComponent` + `webpackChunkName: "renderer"`）。 |
| `BuildingInfoPanel.vue` | 选中建筑后展示：配方、分流器、物流塔、监测器、战场基站、储物仓、过滤器、模式等。 |
| `BuildingOverview.vue` | 未选中时按 itemId 聚合的建筑图标列表，右键一键剔除同类。 |
| `BuildingRecipe.vue` | 建筑当前配方的输入/输出图标展示。 |
| `BuildingIcon.vue` / `BlueprintIcon.vue` | 单个建筑图标 / 蓝图头部图标组合渲染。 |
| `StationInfo.vue` | 物流塔（普通/星际/大型采矿机）库存、槽位、参数面板；内部定义 `SetStationStorageItemCommand` / `SetStationParamCommand`（均为 `silent=true`）。**顶部"端口"区**按 12 个口列出方向（无/出塔/入塔）+ 携带物品（无 / 物品栏 1..N / 大塔第 N+1 项 = 空间翘曲器 1210），走 `SetStationPortCommand`（§6.20）。物流状态用 `role-supply` / `role-demand` / `role-none` 着色区分本地/星际供需；大型采矿机采集速度用 0%-300%、步长 10% 的滑块；不再显示「本地/星际」文字标签。 |
| `BattleBaseInfo.vue` | 战场分析基站（战斗机编队、自动重建等）。 |
| `MonitorInfo.vue` | 流速监测器参数面板。 |
| `StorageInfo.vue` | 储物仓（含过滤网格）。 |
| `DispenserInfo.vue` | 物流配送器参数。 |
| `SpitterInfo.vue` | 四向分流器面板：3D 模型 + 端口示意图 + **口交互**（左键设优先输入/输出、输出口再点设筛选、右键取消优先，见 §6.17）+ 筛选物品选择器。口角色直接由当前蓝图数据算（`splitterPortKinds`），不依赖解析时构建的 `BuildingInfo.adjacency`；优先级/筛选改动经 `Updater.updateStationInfo` bump 版本号重算。 |
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
| `buildingSlots.ts` | 建筑 slot 坐标表（下标 = 游戏 slot 编号）+ **面分组表**（每面恰好 3 个，见 §6.15）：`getBuildingSlots / hasSlots / faceSlotIndices / slotFaceOf / slotDisplayPos / findNearestSlot / findNearestFreeSlot`；常量 `FACE_TOL = 0.03`、`SLOT_MARKER_FACE_INSET = 0.18`。 |
| `beltPorts.ts` | **建筑传送带口表**（下标 = 游戏 slot，`{x, y, z, nx, ny}`；x 为赤道基准、`nx/ny` 为朝外法线）+ 查询：`getBeltPorts / beltPortAt / hasBeltPorts / portWorldOffset / portWorldNormal / nearestBeltPort / pickBeltPort`，见 §6.20。未标定建筑退回 `buildingSlots` 同名 slot（近似）。 |
| `stacking.ts` | 建筑堆叠与箱顶放置规则（见 §6.14）：`stackOffsetFor / stackBaseFor / stackedZ / linkStack / stackColumn / inheritLabSettings / stackPortDefaults / requiresBase / isStackLink`；常量 `STACK_TOP_SLOT = 15`、`STACK_BOTTOM_SLOT = 14`、`BOX_TOP_SLOT = 13`。 |
| `splitter.ts` | 四向分流器口几何（见 §6.17）：`splitterPorts(modelIndex)`（十字 4 口 / 一字 2 口）、`splitterPortPos(port)`、`SPLITTER_PORT_HALF = 0.5`。 |
| `buildingCategories.ts` | 底部建筑面板分类表 `buildingCategories`（1-9 类）+ `CategoryBuilding.variants`（放置时可循环切换的变形样式）+ `variantsOf(itemId)`。 |
| `icons.ts` | 图标 ID 体系（<1000 信号、<20000 物品、<40000 配方、<60000 科技）；`iconUrl / allIconIds`。 |
| `color.ts` | 颜色相关工具与地基颜色表。 |
| `midi.ts` | 流速监测器音色（MIDI）数据。 |
| `techIconsData.ts` / `signalIconsData.ts` | 从游戏 Asset 生成的科技/信号图标索引。 |
| `gen.sh` + `gen_*.py` | 从游戏导出的 `ItemProtoSet/RecipeProtoSet/...` JSON 生成对应 `*Data.ts`（含 `gen_color_palette.py`），并把贴图拷贝到 `assets/icons/`。 |

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
| `toStr(bp): string` | 入口：先调 `normalizeBlueprintAreas` 做导出归一化（编辑器新建蓝图才生效）→ 写头部 → `BufferWriter` 写 meta/areas/buildings → v2 写 patch + reformDataFlag + reformData + tailExtraBytes → `pako.gzip` → base64 → 拼 MD5 校验。 |
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
  - `onMounted`：实例化 `PlanetMapControls`，绑定 click（拾取建筑 emit `selectedBuildingIndex`）、contextmenu（剔除单建筑并 `queue.push(new RemoveBuildingCommand(...))`）、`requestAnimationFrame(animate)` 渲染循环，并把 `controls.updateTimeDelta / cargos.cargoMove` 推进。
  - `defineExpose({ selectBoxes, camera, cameraPosVersion, getModel })` 供父组件访问。

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

### 6.12 `blueprint/sorter.ts` 分拣器连接构造

`createSorterBetween(src, dst, itemId, modelIndex, buildings?, anchors?)`：在两端已有对象之间构造一根分拣器（尚未入库，由 `CreateBuildingCommand` 落地）。

**真实蓝图标定的连接规则**（标定样本：`tests/tools/分拣器.txt`（0.10.35，29 根）、`tests/tools/分拣器示例.txt`（0.10.35，长皮带线 + 12 种建筑 × 输入/输出两个方向、长度 1/2 共 23 根）、`starting_base_01029` / `sorter_belt_replay` 共 122 条皮带端样本）：

| 量 | 规则 |
| --- | --- |
| 主轴 | 由两端对象**整格差**的主分量决定（如制造台 (13,11) → 皮带 (11,12)：Δ=(-2,+1) → 沿 -x）；整格差为 45° 时主轴不唯一 → 拒绝 |
| 方向 | 输入（`inputObjIdx`，取料端，端点写在 `localOffset[0]`）与输出（`outputObjIdx`，放料端，端点写在 `localOffset[1]`）由调用方给的 src/dst 决定，两个方向规则完全对称 |
| 建筑端端点 | = 该建筑某个 **slot 的坐标**（`buildingSlots`，按建筑 yaw 旋转）。slot = 朝向对端的面上的候选里横向坐标离目标最近者；被占用时同面切换到最近空闲 slot |
| 面归属 | 有**面分组表**的建筑（储物仓 2101/2102、电弧熔炉 2302、制造台 2303 系列、矩阵研究站 2901/2902）直接按表取该面的 3 个 slot（见 §6.15）；其余建筑用几何极值法：slot 坐标投影到面法线后与该方向**极值**之差 ≤ `FACE_TOL = 0.03` 即属于该面（`faceSlotIndices`）。不用"主轴取大"：方建筑（电弧熔炉 3.2×3.2）与模型在选盒内偏移的建筑（火力发电厂）角 slot 横纵几乎相等，主轴分组会归错面——真实蓝图里从 -y 侧接入熔炉挂的是角 slot 8 而非中间 slot 7 |
| 皮带端端点 | = **轴线与皮带中心线的交点**（把对端端点投影到皮带中心线上）；轴线与皮带方向近似平行（<26°）时投影退化，取皮带格中心 |
| 皮带 `offset` | `floor(main × 21)`，`main` = 端点在皮带方向上相对皮带中心的投影（格），合法区间 −10..10（±半格）；≈0 的浮点噪声归零，被占用时平移到最近空闲分段中心 |
| `length` | `round(两端点距离)`，必须落在 1–3 |
| `yaw` | `yaw[0]` = 主轴整数角（0/90/180/270），`yaw[1]`/`tilt` = 0（游戏值带 ±0.9° 球面噪声） |
| slot 字段 | 分拣器自身 `inputToSlot=1 / outputFromSlot=0`；建筑端 slot 0–11 且 offset 0；皮带/分流器端 slot −1 |
| `v2ExtraPose` | `[pose0, tip.x, tip.y, tip.z, yaw0, tilt, yaw1]`，`pose0`（语义未公开，游戏自身在 −0.7..0.22 间跳变）按启发式写：输入端为建筑 → 0.20118，为皮带 → 0。**`pose[4]` 必须是分拣器朝向 `yaw[0]`**（真实蓝图里两者差 ≤0.2°），写成 0 会让游戏把分拣器摆成 0°（用户实测"分拣器角度偏移"报错）；导出链路（`normalizeBlueprintAreas` + `exportBuildingV2`）与导入自愈（角度差 >45° 判为早期版本坏数据，按 `yaw[0]/tilt` 修正）都围绕这条不变量 |

### 6.13 传送带与分拣器的游戏约定（传送带铺线 `beltLine.ts`）

标定样本：`tests/tools/游戏生成.txt`（游戏自己保存的传送带+分拣器）与 `工具生成.txt`（早期工具输出，暴露了 §6.12 的 pose 问题与下面的传送带问题）。工具输出必须满足：

| 约定 | 内容 |
| --- | --- |
| 传送带串联 | 只用 `outputObjIdx` 指向下游；`inputObjIdx` 恒 −1；`outputToSlot` = 有下游 1 / 末格 0；`inputToSlot` = 1；`inputFromSlot`/`outputFromSlot` = 0；`parameters` = null（游戏不存传送带参数） |
| 拐角 yaw | 拐角格 yaw = **进入方向与离开方向的平分角**（东进南出 135°、南进西出 225°），直格就是行进方向；只写离开方向会缺 45° 过渡（游戏样本实测 136.5 / 223.6） |
| 一格一带 | 同一格只能有一条传送带：重叠格若为已有线路**末格**则复用（并按实际上下游重算 yaw），若在**线路中间**则本次拖拽在冲突格前截断——否则会出现两个上游，游戏需分流器/集装机才支持 |
| 分拣器 | 见 §6.12；关键是 `pose[4] = yaw[0]`、`inputToSlot=1`/`outputFromSlot=0`、皮带端 slot −1 且带 offset、建筑端 slot ≥0 且 offset 0 |

**点击锚点**（`SorterAnchors`，`src`/`dst` 为连续网格坐标）：与游戏一致，光标落在哪一列/哪一行就决定挂哪个 slot。缺省时以"对端中心"为横向基准。按锚点无解时会**忽略锚点重试一次**（例如点源建筑正中、而目标皮带在相邻一行）。

**拒绝放置**（返回 `null`，编辑器预览显示红线）：两端同对象 / 45° 斜向 / 建筑 slot 面全占用 / 分流器口已被引用 / 皮带端落在皮带格之外 / 长度超出 1–3 / 建筑↔建筑两端 slot 横向偏差 > 0.35 格 / 端点重复（含反向）或与已有分拣器共线压叠。

**相关常量**：`BELT_SEGMENTS_PER_CELL = 21`、`ROOT_HAND_REST_OFFSET ≈ 0.20118`、`SLOT_LATERAL_TOLERANCE = 0.35`、`FACE_TOL = 0.03`、`FACE_CAP = 0.9`、`ENDPOINT_INSET = 0.2`（后两者用于无 slot 数据的建筑端）。`collectOccupiedSlots` 供 UI 给 slot 标记染色。

**slot 表**（`data/buildingSlots.ts`）：数组**下标即游戏 slot 编号**，未标定的 slot 用 `null` 占位（部分标定的建筑如原油精炼厂 2308 只有 −y 面 3 个 slot 有值，其余返回 null，调用方跳过）。标定工具 `tests/tools/deriveSlots.ts` 用 `slot_local = R_Z(+yaw)·(端点 − 中心)` 从真实蓝图反推并逐项比对现有表。要点：
- 表内 **x 为赤道基准值**：蓝图的经向格宽 ∝ cos(纬度)，从高纬度蓝图反推的 x 会偏大，本表统一换算到赤道（y 不受影响）。因此复现任意蓝图时端点会有 ≤2% 的经向差异（测试容差 0.02 格）。
- 火力发电厂 2204 早期的表整体转了 180°（从 yaw=90/270 蓝图反推时逆变换用反了），已用 0.10.35 样本修正；微型聚变发电站 2211 与它同款模型，直接别名复用。
- 同款模型别名：2304/2305/2318 → 2303（制造台各等级）、2315/2319 → 2302（熔炉）、2902 → 2901（研究站）、2211 → 2204。

**UI 接入**（`BlueprintEditor.vue`）：`anchorOffset(e)` 把屏幕位置转成连续网格坐标（命中建筑时用建筑表面命中点径向投影回球面），第一次点击记下 `sorterSourceAnchor`、悬停时记下 `sorterHoverAnchor`，预演与实际放置都把它们传给 `createSorterBetween`；slot 标记只渲染已标定（非 null）的 slot。

### 6.14 建筑堆叠与箱顶放置（`data/stacking.ts`）

标定样本：`tests/tools/特殊用法建筑.txt`（游戏手放，同一格逐层叠放；fixture 副本 `stacking_game_sample.txt`）、`tests/tools/分析仪上放置箱子.txt`（分析基站 → 箱子 → 箱子 → 配送器整条链；fixture 副本 `analyzer_box_game_sample.txt`）。游戏 wire 字段规律（逐字段核对样本得到）：

| 内容 | 规则 |
| --- | --- |
| 堆叠端口 | 底座顶面 = slot **15**，上层底面 = slot **14**。上层建筑写 `inputObjIdx = 底座index`、`inputFromSlot = 15`、`inputToSlot = 14`、`inputOffset = 0`；**底座侧不改**（`outputObjIdx` 仍 −1，`outputToSlot/outputFromSlot` 保持默认 14/15） |
| 端口默认值 | 可堆叠建筑（储物仓 2101/2102、储液罐 2106、研究站 2901/2902、四向分流器 2020）**即使没堆叠**也写 `out=-1/14/15/0`、`in=-1/15/14/0`；战场分析基站 3009 虽然也是底座，但它自己写 `out/in = -1/0/0/0`（`stackPortDefaults` 的 `stackPortItems` 单独列出）；熔炉/制造台等写 0 |
| 层高 | 每建筑固定的一层高度（实测 z 差），不是选择盒高度：四向分流器/储物仓·小 = 2，储物仓·大/储液罐/研究站 = 3，**战场分析基站 = 6**（箱子叠在"分析仪"上，样本 z=6） |
| 允许的组合 | 保守表 `stackCompat`：分流器 → 储物仓·小；储物仓·小/大 → 储物仓·小/大 + 物流配送器；储液罐 → 储液罐；研究站 → 研究站（Mk.I/Mk.II 交叉）；**战场分析基站 → 只允许大型储物仓 2102**（样本 `分析仪上放置箱子.txt`：台面 5.0×7.0、大箱子 6.2×4.2，长边对齐才放得上）。游戏不接受的组合宁可放不下去，也不要写进蓝图让游戏报错 |
| 朝向要求 | `stackYawFor(parent, childItemId)`：底座对上层朝向有要求时返回应使用的 yaw，否则 null（用用户当前朝向）。当前唯一一条：分析基站 (3009) 上的大型储物仓 (2102) 必须是 `底座yaw + 90°`（样本：底座 yaw=0、箱子 yaw=90）；放置与预览都会自动对齐 |
| 物流配送器 2107 | **只能放在箱子箱盖上方**：写 `inputFromSlot = 13`（箱盖接口）、`inputToSlot = 0`，落位高度 = 箱盖高度（储物仓·小 1.875、储物仓·大 2.9812433），与储物仓自身的堆叠层高不同 |
| 底座判定 | `stackBaseFor`：优先取光标所指建筑（BVH 拾取，与游戏"光标在建筑上就是往上叠"一致），否则取该格内**能承载该子建筑的最高**建筑；同格判定用 slot 环极值当落座半径 + 半格容差，避免仅靠中心整格判定而在点边缘时失效 |
| 放置联动 | 堆叠时 x/y **对齐底座中心**；研究站叠在研究站上时，上层直接沿用底座的**研究模式与配方**（`inheritLabSettings`，任意模式都继承） |
| 整列联动 | `stackColumn` 沿堆叠端口（`inputToSlot=14`）上下走，得到整列（不会把分拣器连接 `inputToSlot=1` 误当堆叠）。一列堆叠研究站在游戏里是**一台机器**：`SetLabResearchModeCommand` 改整列的模式**并把配方一起同步**（取被点击那层当时的配方），`SetBuildingRecipeCommand` 对研究站也作用于整列；撤销逐层恢复各自原值 |

### 6.15 slot 面分组：四边各三个（`data/buildingSlots.ts`）

游戏 0.10.35 实测（`tests/tools/特殊用法_生成.txt`：14 种建筑 × 全部 slot 的分拣器环）：
方建筑（电弧熔炉 3.2×3.2、储物仓 3.2×3.2）每个面的**角 slot 与相邻面的边界 slot 坐标逐位相同**（slot 2 与 3、5 与 6、8 与 9、11 与 0），游戏靠"分拣器**从哪个面离开**"区分这两个编号（北面出 → slot 2，东面出 → slot 3）。

- `slotFaceGroups`：逐建筑显式给出 `[+y(北), +x(东), -y(南), -x(西)]` 四个面的 slot 编号（每面 3 个）。**每个建筑自己的编号绕向不同**（矩阵研究站 2901 是反向绕的，东面是 9/10/11），不能按统一公式推导。
- `faceSlotIndices` 优先查该表，保证"每面 3 个、角 slot 归属唯一"；其余建筑退回几何极值法。
- 旧实现的 bug：几何极值法把角 slot 同时算进两个相邻面（每面 5 个候选），于是"该面被占用时切到同面下一个空闲 slot"会跳到相邻面的错误编号，实际只用到 8 个 slot（用户反馈"接口有 12 个、四边各三个，不是 8 个"）。复现工具 `tests/tools/replaySlots.ts`：修复前 8 处不一致（2302 的 6/3/11/9、2101 的 3/11/9/6 全部落到相邻面），修复后 3 份真实蓝图 243/259 条完全一致、0 不一致。
- `slotDisplayPos`（显示专用）：角 slot 与相邻面边界 slot 真实坐标重合，按真实坐标画标记会叠成一个点（看起来只有 8 个）。显示时沿**所属面**向面中心收缩 `SLOT_MARKER_FACE_INSET = 0.18`，于是 UI 上呈现"四边各三个"；连接用的端点仍是 `getBuildingSlots` 的真实坐标。

### 6.16 放置快捷键与分流器变形样式

| 键 | 行为 |
| --- | --- |
| `R` | 放置模式下：传送带 → 切换路径走法（latFirst / lonFirst / straight）；其余建筑 → 旋转 90° |
| `Tab` | **切换变形样式**（四向分流器 2020 的三种形态，模型 38/39/40）；放置模式下 `preventDefault()`，避免 Tab 把焦点移出 3D 画布 |
| `Shift` | 自由放置（不吸附整格） |
| `X` | 进入删除模式；`Esc` 分层取消；`1-9` 切分类；`F1-F12` 选建筑；`N` 重置镜头 |

- 变形样式的载体就是 `modelIndex`（`placementState.cycleBuildingVariant()` 改 `selectedModelIndex`），预览与放置自动跟随；面板入口见 `buildingCategories.ts` 的 `variants: [38, 39, 40]`。
- **鼠标静止时也要刷新预览**：`BlueprintEditor.vue` 中最后一次指针坐标存成 `shallowRef`（`lastPointer`），`watchEffect` 首次执行就不会因"还没动过鼠标"提前 return 而一个依赖都收集不到。用普通变量时表现为"按 R 没反应、动一下鼠标才转"。

### 6.17 分流器优先输入/输出与筛选（`blueprint/splitterPorts.ts` + `data/splitter.ts`）

口编号沿用 §6.12：0=+y、1=+x、2=−y、3=−x（十字形 38/40 四口全开，一字形 39 只有 0/2）。口在四边中点（`SPLITTER_PORT_HALF = 0.5`）；交互全部在**侧栏 SpitterInfo 面板**（3D 视图不占用左/右键）。

**角色判定**（`splitterPortKinds`，数据依据 `tests/unit/blueprint/fixtures/sample_throughput.txt`）：对端把货**送进**分流器 → 该口是**输入口**（可设"优先输入"）；分流器把货**送给**对端 → **输出口**（可设"优先输出"并可挂筛选）。传送带直连时分流器口写在传送带的 `outputToSlot`（送入）/`inputFromSlot`（取出）上（游戏实测）；分拣器直连时游戏写 slot=−1，只能按对端方向反推（复用 `sorter.ts` 的 `splitterPortAt`）。

**交互**（全部在侧栏 `SpitterInfo` 面板里，符合"点端口设置"）：面板上按口列出 端口号 / 输入口·输出口·未连接 / `设为优先`·`取消优先` 按钮，SVG 图里的四个口箭头同样可点：

| 操作 | 行为 |
| --- | --- |
| 左键点端口（未设优先） | 设优先输入/输出（`SetSplitterPriorityCommand`，`parameters.priority[port] = true`） |
| 左键再点（已优先的**输出口**） | 打开"筛选物品"选择器（`SetSplitterFilterCommand` 写建筑级 `filterId`）；输入口无操作 |
| 右键点已设优先的口 | 取消该口优先；若取消后**已无优先输出口**，`filterId` 一并清空（筛选必须有挂载的口），撤销时一起还原 |
| 面板"筛选"行 | 只要存在优先输出口就显示，`ItemSelect` 直接改 `filterId`（只作用于优先输出口） |

数据依据：样本里 `priority=[1,0,0,0] + filterId=6001` 的那个分流器，其 0 口上的传送带记录是 `inputFromSlot=0`（分流器从 0 口送出）→ 优先与筛选都挂在输出口上；`priority=[0,0,1,0] + filterId=0` 的那个是输入口优先，无筛选。

### 6.18 传送带的图标与数量（`blueprint/setBeltParams.ts`）

游戏里**没设过图标/数量的传送带没有 `parameters` 字段**（`defaultParamsFor(2001..2003)` 返回 null，工具新建的传送带同样如此），但用户必须能给这类传送带设图标和数字：

- 详情面板按 `parameters === null → {iconId: 0, count: 0}` 显示（`beltIconId` / `beltCount` computed），首次修改时由 `SetBeltParamsCommand` 按需创建参数对象，避免无谓地给每条带子写字段。
- 编码与游戏一致：`beltParamParser` 的 2 个 int（`iconId`, `count`）。真实蓝图中带参数的传送带样本：`dense_splitters_v1.txt`（8 条）、`facilities_with_foundation_320.txt` / `sample_outpost_ils.txt`（各 2 条）。

### 6.19 光标 ↔ 局部格换算必须用**当前区域定位**（`blueprint/area.ts`）

编辑模式放置建筑/铺地基/架分拣器时，屏幕光标要换算成区域局部格（`placementOffset` / `anchorOffset` → `planetToLocal`），再由 `calcBuildingTrans` 换回世界坐标渲染。这两步必须严格互逆：

| 方向 | 依据 |
| --- | --- |
| 局部格 → 世界 | `calcBuildingTrans(R, pos, b)`：`经度 = (pos.areas[areaIndex].longitude + localOffset.x) × 2π/(segment×5)`，`纬度 = (pos.areas[areaIndex].latitude + localOffset.y) × 2π/(200×5)`；`pos` 来自 `findPosForAreas(d.areas, 200)` |
| 世界 → 局部格 | `planetToLocal(latGrid, lonGrid, area)`，`area` 必须传**同一个** `pos.areas[areaIndex]`（放置只写根区域 `areaIndex=0`） |

换算里有两个容易写错的地方（旧实现都写死了）：

1. **原点纬度不是常数**。工具自建画布（`createEmptyBlueprint`，根区域 `size.y=161`）恰好是 `-80`，但导入蓝图的根区域原点由 `findPosForAreas` 决定（无子区域时为 `-floor(size.y/2)`，有子区域还受锚点约束）。写死 `-80` 会让**每一次放置/预览沿纬向平移 `80 - floor(size.y/2)` 格**：`size.y=6` 的真实蓝图偏 77 格（≈27.7° 纬度），既有建筑会被放到带到别处、甚至落到区域带外被 `ensureAreaFor` 拒绝。这就是"导入蓝图后进入编辑模式，绿盒与光标错开；不导入蓝图（自建画布）则完全对齐"的根因。
2. **经向尺度与回绕宽度**。全局光标经向格以 200 段（1000 格/圈）为基准，而区域局部格是"该区域自己的一圈 = `areaSegments×5` 格"；低段数（极区）区域一格更宽，须乘 `segment/200` 并按 `segment×5` 回绕。

回归测试：`tests/unit/blueprint/areaPlacement.spec.ts`（对全部 fixture 把建筑端点的世界格反算回局部格，要求等于该建筑自己的 `localOffset`；另有低段数区域尺度、原点偏移互逆、自建画布仍为 -80 三组用例）；诊断探针 `tests/tools/placementOffsetProbe.ts`（逐 fixture 打印区域定位与最大反算误差）。

> 注意 `beltLine.ts` 等模块仍以 `ROOT_GRID_SIZE = 1000` 作为经向画布宽度，这与"自建画布 = 200 段"一致；向非 200 段的导入区域铺带时的回绕宽度暂未按区域段数换算。

### 6.20 传送带 ↔ 建筑直连（串联）与建筑骑带（并联）、物流站端口（`data/beltPorts.ts` + `beltLine.ts` + `setStationPort.ts`）

标定样本（游戏 0.10.35 实测，已副本进 `tests/tools/`）：`传送带连接建筑_串联.txt`（241 个对象，8 处建筑带连接 + 3 个分流器）、`传送带连接建筑_并联.txt`（74 个对象，8 个建筑骑在带上）、`物流塔连接传送带.txt`（126 个对象，两个物流站各 12 口全接带）。三份样本都能字节级 round-trip。

#### 串联：传送带以建筑为终点

| 关系 | wire 字段（建筑自身 `out/in` 保持 `-1/0/0/0`，**不写反向引用**） |
| --- | --- |
| 带**送入**建筑（终点） | `带.outputObjIdx = 建筑index`、`带.outputToSlot = 建筑口`、`outputFromSlot=0`、`outputOffset=0`；带朝向 = 口法线**反向**（朝建筑） |
| 建筑**取出**到带（起点） | `带.inputObjIdx = 建筑index`、`带.inputFromSlot = 建筑口`、`带.inputToSlot=1`、`inputOffset=0`；带朝向 = 口法线（背离建筑） |
| 带端位置 | 口格的**记录位置写成口的精确坐标**（分数，如 `y=51.11`）：`口格身份 = round(口坐标)`，`口格外侧一格 = 口格 + 口法线`，其余格在整格上 |
| 高度 | 接到 `z≠0` 的口时整条带都在该层（分流器上下层口） |

- **口表**（`data/beltPorts.ts`）：`getBeltPorts(itemId, modelIndex)` → `下标即 slot` 的 `{x, y, z, nx, ny}`；`x` 已按赤道基准归一（同 `buildingSlots`），`nx/ny` 是朝外法线。已用带样本标定：四向分流器 2020（38/39/40 三形态，4 口分两层）、自动集装机 2040、物流运输站 2103、星际物流运输站 2104（12 口环：+y={0,1,2}、−x={3,4,5}、−y={6,7,8}、+x={9,10,11}）、储液罐 2106、射线接收站 2208、能量枢纽 2209、分馏塔 2314；其余建筑退回 `buildingSlots` 同名 slot（**近似**，待样本标定）。
- **生成**（`buildBeltLine(..., startPort, endPort)`）：起/止绑定口时按上表构造路径与连接字段；`CreateBeltLineCommand(belts, startPort, endPort)` 负责分配 index、串联内部格、并**同步物流站口方向**（出塔 `dir=1`、入塔 `dir=2`，撤销逐口还原）。口格已被占用 → 本次拖拽在口格前截断（游戏里一个口只能接一条带）。
- **编辑器交互**：`BlueprintEditor.portEndAt(e)` 用 BVH 命中建筑 + 命中点高度格（`(命中点半径 − R)/(4/3)`）在口表里选口（`pickBeltPort`：先按高度层、再按 xy 最近，`limit = 2.5` 格），铺带的 A/B 点落在口上就自动成"取出 / 送入"，预览与落位共用同一套 `buildBeltLine`。

#### 并联：建筑骑在传送带上

建筑与传送带**同格共存、不写任何连接字段**，带从建筑下直穿（样本：喷涂机 2313、流速器 2030、高斯机枪塔 3001、导弹防御炮 3005、聚爆加农炮 3003、磁化电浆炮 3004、地面电浆炮 3010、干扰塔 3006）。实现上无需特殊分支：只有**线路端点**才接建筑口，线路中间格（含建筑所在格）照常串联；`CreateBuildingCommand` 也不检查格上是否已有带。

#### 物流站端口（12 口）

`parameters.slots[i] = { dir, storageIdx }`：

| 字段 | 取值 |
| --- | --- |
| `dir` | `0=无 / 1=出塔(Output，带从站取出) / 2=入塔(Input，带送入站)`；没挂带的口为 0（样本 `sample_outpost_ils` #4/#5 对比） |
| `storageIdx` | `0=无`；`1..N` = `storage[i-1]` 携带的物品（小塔 2103 `N=4`、大塔 2104 `N=5`）；**大塔第 `N+1`（=6）项 = 空间翘曲器 1210**，它不是 `storage` 数组里的项（样本：storage 5 栏却写 `storageIdx=6`，且 `storage[4]` 是别的物品） |

- 面板：`StationInfo.vue` 顶部"端口"区，12 行 × （方向下拉 + 物品下拉），物品下拉的选项由 `stationPortItemChoices` 生成、显示文案用 `stationPortItemId` 解析成物品名；改动走 `SetStationPortCommand`（`silent`，只增 `stateVersion`），改物品时同步该口上那条带的显示图标（与 `SetStationStorageItemCommand` 的行为一致）。
- 删除传送带时（`RemoveBuildingsCommand`）会把因此空出来的口 `dir` 清成 0，撤销还原。
- 大塔（2104）的第 6 项固定为翘曲器，小塔（2103）没有第 6 项（解析器按 `maxItemKind=4` 读，见 §7.4）。

回归测试：`tests/unit/blueprint/beltPorts.spec.ts`（全部样本的带↔建筑连接都能用口表复现带端位置 ≤0.15 格与朝向；分流器分层；站口环绕向）、`beltBuilding.spec.ts`（取出/送入字段与带端坐标、高层口整条带同层、并联不写连接、站口 `dir` 同步与撤销、口占用截断）、`stationPort.spec.ts`（物品序号语义、`SetStationPortCommand` do/undo/导出、带图标同步、删带清空 `dir`）。标定工具：`tests/tools/genBeltPorts.ts`（生成口表）、`analyzeBeltBuilding.ts`（逐条列建筑↔带连接）、`scanStationSlots.ts`（站口 `storageIdx` 分布）、`byteRoundTrip.ts`（字节级 round-trip 检查）。

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
- 左键 → emit `update:selectedBuildingIndex`；右键（区分拖拽与点击）→ `queue.push(new RemoveBuildingCommand(index, ...))`。
- 编辑模式的**反向**换算（光标 → 放置格）：`placementOffset`（吸附整格，放置与绿盒预览共用）与 `anchorOffset`（不取整，分拣器 slot 锚点 / 地基格），两者都经 `planetToLocal(latGrid, lonGrid, editAreaOrigin())` 换算，其中 `editAreaOrigin()` 取当前 `b.value.pos.areas[0]`——与 `calcBuildingTrans` 同源，见 §6.19。

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
| `RemoveBuildingCommand` | 同上 | 单个建筑删除（预览模式 3D 右键 / 删除模式左键） |
| `RemoveBuildingsByItemCommand` | 同上 | 同 itemId 全部删除（列表右键） |
| `SetBuildingRecipeCommand` | `blueprint/setBuildingRecipe.ts` | 改配方；**研究站**改整列（一列 = 一台机器） |
| `SetLabResearchModeCommand` | 同上 | 改研究模式，作用于整列堆叠研究站并同步整列配方 |
| `SetBeltParamsCommand` | `blueprint/setBeltParams.ts` | 传送带图标/数量；`parameters` 为 null 时按需创建（§6.18） |
| `SetStationPortCommand` | `blueprint/setStationPort.ts` | 物流站 12 个口的方向（无/出塔/入塔）+ 携带物品序号（0=无 / 1..N=物品栏 / 大塔 N+1=空间翘曲器）；`silent`，改物品同步口上那条带的图标（§6.20） |
| `SetSplitterPriorityCommand` | `blueprint/setSplitterPort.ts` | 分流器口优先输入/输出；取消时若无优先输出口则清空筛选（§6.17） |
| `SetSplitterFilterCommand` | 同上 | 分流器优先输出口的筛选物品 |

### 9.3 快捷键

- `Ctrl+Z` 撤销，`Ctrl+Y` 或 `Ctrl+Shift+Z` 重做（`App.vue` 的 `hotkey`）。
- `O` / `0`：切换侧栏（非固定状态）。
- 编辑模式：`1-9` 切分类、`F1-F12` 选建筑、`R` 旋转 90°（传送带为切路径走法）、`Tab` 切换变形样式（四向分流器，见 §6.16）、`Shift` 自由放置、`X` 删除模式、`Esc` 分层取消、`N` 重置镜头、右键退出放置。
- 四向分流器的优先输入/输出与筛选：在侧栏 `SpitterInfo` 面板点端口设置（§6.17），3D 视图不占用左/右键。

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
| `foundation.spec.ts` | 地基（reformData）的解析与回写（含 `foundation_only_99`、`facilities_with_foundation_320` fixture）。 |
| `command.spec.ts` | CommandQueue 版本分流：silent 命令（Replace/SetAccelerator 等）只增 `stateVersion` 不增 `execVersion`，含 push 与 undo 路径。 |
| `setBuildingRecipe.spec.ts` | 单体配方/研究模式命令的 do/undo 与 silent 性质、merge 行为。 |
| `normalizeArea.spec.ts` | `normalizeBlueprintAreas`：远处成簇收缩、跨 0 经线取最小弧、北半球赤道居中、单建筑 1×1；校验入参不被修改。 |
| `areaPlacement.spec.ts` | 光标 ↔ 局部格换算（§6.19）：全部 fixture 的建筑端点世界格反算回局部格 = 该建筑自己的 `localOffset`（≥100 个端点）；导入蓝图原点非 -80（`sample_outpost_ils` 按 -80 会偏 77 格）；自建画布仍为 -80；低段数区域经向尺度与回绕宽度；`localToPlanet`/`planetToLocal` 互逆。 |
| `stats.spec.ts` | `calculateProductionStats`：分馏塔特例、普通配方建筑、增产剂各等级倍率与自身消耗、研究站科研模式。 |
| `sorter.spec.ts` | 分拣器连接：slot 表与同款模型复用、slot 占用切换、皮带 `offset = floor(main×21)` 编码、建筑↔皮带 / 建筑↔建筑端点、主轴与 45° 拒绝、分流器口唯一性、重复/重叠拒绝、点击锚点选 slot、方建筑角 slot 面归属、分拣器姿态字段启发式。 |
| `sorter_replay.spec.ts` | 真实蓝图全量复现：`sorter_belt_replay`（3 根皮带↔皮带）、`sorter_building_belt_replay`（29 根建筑/皮带混合，`tests/tools/分拣器.txt` 副本）、`sorter_multi_building_replay`（23 根、12 种建筑 × 输入/输出两个方向 + 长度 1/2，`tests/tools/分拣器示例.txt` 副本）逐字段比对。 |
| `beltGameConsistency.spec.ts` | 传送带约定：游戏样本 `belt_inserter_game_sample.txt` 的 `pose[4]≈yaw[0]`、串联/slot/parameters 约定、拐角平分角；工具侧拐角 yaw、多次拖拽重叠格复用与截断、撤销恢复。 |
| `createdExport.spec.ts` | 工具"新建蓝图→铺带→加分拣器→保存"链路：导出再解析后 `pose[4]` 仍等于 `yaw[0]`（四朝向）、`normalizeBlueprintAreas` 平移尖端但保留姿态角且不改入参、缺 pose 时兜底写 `yaw[0]`，以及早期坏文件（fixture `tool_export_pose_broken.txt`）导入自愈。 |
| `slotFace.spec.ts` | slot 面分组：12 slot 环建筑每面恰好 3 个且四面覆盖 0-11、角 slot 归属唯一（电弧熔炉 +x 面只有 3/4/5）、矩阵研究站反向绕向、`slotDisplayPos` 把重合角 slot 分开且 12 个显示点两两可分辨；并用 fixture `slot_face_game_sample.txt`（游戏 14 种建筑 × 全部 slot 的分拣器环）复现每根分拣器的建筑端 slot，与游戏写死的编号逐条一致（≥24 条）。 |
| `stacking.spec.ts` | 堆叠规则：用 fixture `stacking_game_sample.txt` 逐条校验 10 组堆叠样本的层高/z/端口字段（15/14、配送器 13）、未连接时的端口默认值、允许/禁止的组合表、`stackBaseFor` 底座判定（光标所指、同格最上层、物流配送器只在箱盖）、`stackColumn` 整列解析、研究模式+配方继承与整列联动（含撤销）、分流器 38/39/40 循环切换，以及"叠出来 → 导出 → 再解析"的端到端字段一致性；另用 `analyzer_box_game_sample.txt` 校验"战场分析基站 → 箱子(6) → 箱子(9) → 配送器(11.981)"整条链。 |
| `splitterPorts.spec.ts` | 分流器口几何（十字 4 口 / 一字 2 口、四边中点坐标）、口角色判定（样本 `sample_throughput.txt` 的 #47 输出口 + 筛选 6001、#30 输入口无筛选）、左键行为（未优先→设优先 / 优先输出→筛选 / 优先输入→无操作）、右键取消优先时"无优先输出口则清空筛选"与撤销还原、优先/筛选随蓝图导出再解析。 |
| `beltParams.spec.ts` | 传送带图标/数量：工具新建传送带 `parameters` 为 null，设置后按需创建 `{iconId, count}`、导出再解析保持、撤销恢复，以及真实蓝图里带参数传送带的编码形态。 |
| `beltPorts.spec.ts` | 建筑传送带口标定表（§6.20）：全部样本里每个"带↔建筑"连接都能用口表复现带端位置（≤0.15 格）与朝向（取出沿法线、送入沿法线反向）；分流器口分两层（接 z=1 的口时带端也在 z=1）；物流站 12 口环绕向与法线。 |
| `beltBuilding.spec.ts` | 传送带直连建筑（串联）与建筑骑带（并联）：取出/送入的连接字段与带端精确坐标、串联链路与末格终结、高层口整条带同层、导出再解析保持；带从建筑格中间穿过或建筑放在带格上都不写任何连接字段；站口 `dir` 随连接同步与撤销、口已被占用时截断。 |
| `stationPort.spec.ts` | 物流站端口物品序号语义（小塔 1..4 / 大塔 1..5 + 第 6 项空间翘曲器 1210，`sample_outpost_ils` #5 的 `storageIdx=6`）；`SetStationPortCommand` 的 do/undo、`silent`、导出再解析、改物品时同步口上那条带的图标、删带时口方向归零与撤销还原。 |

fixtures 位于 `tests/unit/blueprint/fixtures/`：除原有蓝图外新增 `starting_base_01029.txt`（0.10.29 老版本基地）、`foundation_only_99.txt`、`facilities_with_foundation_320.txt`、`sorter_belt_replay.txt`、`sorter_building_belt_replay.txt`、`sorter_multi_building_replay.txt`、`tool_export_pose_broken.txt`（早期工具导出的坏 pose）、`slot_face_game_sample.txt`（游戏 14 种建筑 × 全部 slot 的分拣器环）、`stacking_game_sample.txt`（游戏逐层堆叠样本）、`analyzer_box_game_sample.txt`（分析基站上叠箱子整条链）。调试/标定脚本位于 `tests/tools/`（`parseBlueprint.ts` 蓝图→JSON、`sorterReplay.ts` 分拣器连接复现比对、`dumpBuildings.ts` 紧凑建筑表、`dumpParams.ts` 参数级样本扫描（带参数的传送带 / 设了优先或筛选的分流器 / 研究站）、`deriveSlots.ts` slot 表反推/校验、`dumpSlotSamples.ts` 逐 slot 原始样本、`replaySlots.ts` slot 面归属复现比对、`placementOffsetProbe.ts` 光标→放置格偏移诊断（逐 fixture 打印区域定位与最大反算误差）、`genBeltPorts.ts` 建筑传送带口标定表生成（逐 (itemId, model, slot) 聚合口坐标与法线）、`analyzeBeltBuilding.ts` 逐条列出建筑↔传送带连接（送入/取出、slot、带端位置）、`scanStationSlots.ts` 物流站端口 `storageIdx` 分布扫描、`byteRoundTrip.ts` 解析→重出的字节级比对（判断字段是否被解析器丢掉）、`slotScaleProbe.ts` 分区尺度诊断、`fitBeltOffset.ts` 皮带 offset 分段数拟合、`compareBlueprints.ts` / `checkPoseConsistency.ts` / `reproToolExport.ts` 导出姿态回归），样本 `分拣器.txt` / `分拣器示例.txt` / `特殊用法建筑.txt` / `特殊用法_生成.txt` / `分析仪上放置箱子.txt` / `传送带连接建筑_串联.txt` / `传送带连接建筑_并联.txt` / `物流塔连接传送带.txt` 为游戏 0.10.35 实测蓝图（后三份对应 §6.20 的三类交互）。

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
| `AreaGridOrigin` | 区域定位 `{latitude, longitude, segment}` = `findPosForAreas(...).areas[i]`；`planetToLocal / localToPlanet` 的必传参数（§6.19）。原点纬度不是常数（自建画布才恰好 -80），经向还要按 `segment/200` 换算尺度。 |
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
| `createSorterBetween` | 分拣器连接构造（§6.12）：主轴取两端整格差的主分量，建筑端端点落 slot、皮带端落在轴线与皮带中心线交点，皮带 `offset = floor(main × 21)`，`length = round(端点距)`。 |
| `BELT_SEGMENTS_PER_CELL` | 21：皮带每格内部分段数（真实蓝图反推）；皮带端 offset 合法区间 −10..10（±半格）。 |
| `SorterAnchors` | 分拣器点击锚点：光标所在列/行决定挂哪个建筑 slot；按锚点无解时忽略锚点重试一次（退回对端中心基准）。 |
| `faceSlotIndices` | 建筑 slot 的**面归属**（§6.15）：有面分组表的建筑（储物仓/电弧熔炉/制造台/研究站）每面恰好 3 个、角 slot 归属唯一；其余建筑用几何极值法（投影到面法线后接近该方向极值 ≤ `FACE_TOL = 0.03`）。`SlotTable` 的数组下标 = slot 编号，未标定 slot 为 `null`。 |
| `slotFaceGroups` / `slotDisplayPos` | 逐建筑的面分组表（`[+y, +x, -y, -x]` 各 3 个 slot，绕向因建筑而异）；显示专用坐标 `slotDisplayPos` 把真实坐标重合的角 slot 沿所属面内缩 `SLOT_MARKER_FACE_INSET = 0.18`，让 UI 呈现"四边各三个"。 |
| `stackOffsetFor` / `stackBaseFor` | 堆叠规则（§6.14）：底座 itemId + 上层 itemId → 一层高度（不允许返回 `null`）；`stackBaseFor` 按"光标所指建筑优先、其次同格能承载的最高建筑"求底座。 |
| `STACK_TOP_SLOT` / `STACK_BOTTOM_SLOT` / `BOX_TOP_SLOT` | 15 / 14 / 13：底座顶面端口、上层底面端口、储物仓箱盖接口（物流配送器专用）。 |
| `stackYawFor` | 堆叠时的朝向要求（§6.14）：分析基站上的大型储物仓必须是 `底座yaw + 90°`；其余返回 null（用用户当前朝向）。 |
| `linkStack` / `stackColumn` / `inheritLabSettings` | 写堆叠连接字段；自下而上取整列（只跟 `inputToSlot=14` 的堆叠端口，不跟分拣器连接）；堆叠时研究站沿用底座的研究模式与配方。 |
| `SetBuildingRecipeCommand` / `SetLabResearchModeCommand` | 改配方 / 改研究模式（均 `silent`）：对研究站作用于**整列**堆叠，模式改动同时把配方同步到整列，撤销逐层恢复各自原值。 |
| `splitterPorts` / `splitterPortPos` | 分流器可用口（十字 4 / 一字 2）与口在建筑局部系的坐标（四边中点，§6.17）。 |
| `splitterPortKinds` / `splitterPortClickAction` | 口角色（输入=对端送入、输出=分流器送出）与左键行为（设优先 / 开筛选 / 无操作）；右键取消优先，无优先输出口时筛选一并清空。UI 见侧栏 `SpitterInfo` 面板（§6.17）。 |
| `variantsOf` / `cycleBuildingVariant` | 建筑放置时可循环切换的变形样式（模型序号列表，如四向分流器 38/39/40）；放置模式下按 `Tab` 切换。 |
| `SetBeltParamsCommand` | 传送带图标/数量命令：`parameters` 为 null（游戏默认）时按需创建 `{iconId, count}`（§6.18）。 |
| `beltPorts` / `BeltPort` | 建筑传送带口表（§6.20）：`下标 = 游戏 slot`，`{x(赤道基准), y, z, nx, ny(朝外法线)}`；已标定分流器 2020（三形态、分两层 z）、集装机 2040、物流站 2103/2104（12 口环）、储液罐 2106、射线接收站 2208、能量枢纽 2209、分馏塔 2314，其余退回 `buildingSlots`（近似）。 |
| `BeltPortEnd` | 铺带端点绑定的建筑口 `{building, slot, point(可为分数、含 z), nx, ny}`；起点 = 取出、终点 = 送入，`buildBeltLine(..., startPort, endPort)` 据此写连接字段并把口格记录位置写成口的精确坐标。 |
| `SetStationPortCommand` | 物流站端口命令（§6.20）：`slots[i] = {dir(0 无/1 出塔/2 入塔), storageIdx}`；`storageIdx` 0=无、1..N=物品栏、大塔（2104）N+1=空间翘曲器 1210；`silent`，改物品时同步口上那条带的图标；删带时由 `RemoveBuildingsCommand` 把口方向清 0。 |

---

> 本 Wiki 基于当前仓库代码静态生成，若 `src/blueprint/parser.ts`、`data/` 或 `components/BlueprintEditor.vue` 发生结构性变更，请同步更新对应章节。
