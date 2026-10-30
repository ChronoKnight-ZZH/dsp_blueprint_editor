# 模块 8：UI 组件层（ui-components）

## 职责

本模块是编辑器的**视图层**，基于 Vue 3 `<script setup>` 组合式 API，负责蓝图 3D 场景渲染（BlueprintEditor.vue）以及蓝图编辑过程中所需的所有面板、弹窗、菜单。组件通过 `inject(commandQueueKey)` 拿到共享的命令队列，触发命令后由队列执行并派发 Updater 回调，再由 BlueprintEditor 里的 `registerUpdater`（:518）驱动 3D 层局部刷新。

组件间通信模式：
- Vue 响应式 props / emits（父子面板）
- inject / provide（跨层级共享 commandQueue、placementState）
- Updater.dispatch → BlueprintEditor.registerUpdater 回调（3D 层局部更新）

---

## 关键文件

| 文件 | 用途 |
|---|---|
| `src/components/BlueprintEditor.vue` | 3D 场景根组件：WebGLRenderer + Three.js 星球 + 建筑 InstancedMesh + 地基 + 拾取/放置/连接逻辑 |
| `src/components/BuildingInfoPanel.vue` | 选中建筑详情面板（配方/分拣器/物流站/监测器/信标/传送带参数） |
| `src/components/StationInfo.vue` | 物流站 12 个端口 + storage + 参数的独立子面板 |
| `src/components/SpitterInfo.vue` | 四向分流器 3D 模型 + 口示意图 + 口交互（左键设优先/筛选、右键取消） |
| `src/components/ReplaceModal.vue` | 批量替换 Modal：6 个范围 Tab（recipe / filter / station / beltIcon / blueprintIcon / buildingLevel）+ 升降级源/目标图标网格 |
| `src/components/ProductionStats.vue` | 生产统计面板：增产剂等级选择 + 加速模式开关 + 物品产出/消耗排序表 |
| `src/components/BuildingPalette.vue` | 左侧建筑分类面板 + 地基模式 + 导入图片 + 自定义色槽 RGBA 入口 |
| `src/components/ReformColorDialog.vue` | 自定义色槽编辑弹窗：16 内置色 + 16 自定义色槽，支持 RGBA 数值修改 |
| `src/components/TutorialModal.vue` | 使用教程 Modal：加载 docs/功能说明.md + marked 渲染 + DOMPurify 消毒，含可拖拽缩放和章节导航 |

### 次要组件（参考用）

| 文件 | 用途 |
|---|---|
| `RecipeSelect.vue` | 配方下拉（RecipeSelect + BuildingRecipe 预览） |
| `ItemSelect.vue` | 物品/建筑通用下拉选择器 |
| `BuildingIcon.vue` | 物品图标渲染 |
| `BuildingRecipe.vue` | 配方详情展示（输入→输出） |
| `StorageInfo.vue` | 储液罐 storage 参数 |
| `MonitorInfo.vue` | 监测器参数 |
| `BattleBaseInfo.vue` | 战斗基地参数 |
| `DefaultInfo.vue` | 默认建筑信息面板 |
| `BuildingOverview.vue` | 蓝图整体统计（建筑数量汇总） |
| `BuildingIcon.vue` | 物品图标（img / svg） |
| `BlueprintIcon.vue` | 蓝图头图标选择 |
| `ModalDSP.vue` | Modal 基类 |
| `ColorPreview.vue` | 颜色预览小色块 |
| `IconPickerModal.vue` | 图标选择弹窗 |
| `WorkEnergyParam.vue` | 功/能量参数滑块 |
| `SwitchDSP.vue` | DSP 风格 switch 开关 |
| `ParamSlider.vue` | 参数滑块（有 steps / format） |
| `ShortcutHint.vue` | 快捷键提示 |
| `DispenserInfo.vue` | 分配器（喷射塔）参数 |
| `HoloBeaconInfo.vue` | 全息信标（2401）文本内容 |

---

## 公开接口

### BlueprintEditor.vue（3D 场景根）

| 位置 | 说明 |
|---|---|
| `<template>` :1 | `<div class="editor-root" ref="root" tabindex="-1">` —— 唯一根节点（WebGL canvas 挂在此下） |
| 引入 Three.js（:6-31） | Group / InstancedMesh / WebGLRenderer / DirectionalLight / Ray / BVH（自定义 import） |
| AllBuildings extends Object3D（:93） | 建筑层容器：3D 模型实例（mesh）+ 图标层（Icons）+ 货物层（Cargos[]）+ 下标语层（IconSubscript） |
| `buildBVH(transforms, buildings)` :499 | 为 BVH 射线拾取构造包围盒矩阵；分拣器用 `inserterTrans` 计算真实长度 |
| `registerUpdater(updater, buildings, pos)` :518 | **Updater 回调注册**：clearAll 清空旧回调 → 注册 updateBuildingIcon / updateBeltIcon / updateBeltIconSubscript / updateSorterIcon 四个通道 |
| `planetToLocal` :623 | 导入自 `@/blueprint/area`，经纬度网格坐标 → 本地整数格坐标 |
| `bvh.raycast(ray)` :1248 / :1282 / :1357 | 三处拾取入口：点击选中、拖拽预览、地基铺设 |
| `calcBuildingTrans(R, pos, b)` :549 / :593 | 建筑 itemId → 星球表面世界坐标矩阵 |
| 放置预览 | 鼠标移动时在星球表面投射射线，按最近网格点构造 preview Building（createBuilding） |

### BuildingInfoPanel.vue（选中建筑详情）

| 位置 | 说明 |
|---|---|
| `<template>` :1-143 | 条件渲染：按 itemId 类型组合 StationInfo / SpitterInfo / MonitorInfo / BattleBaseInfo / StorageInfo / DispenserInfo / HoloBeaconInfo / DefaultInfo / Tank / Inserter / Lab / Belt / RayReciver / ArtificialStar / EnergyExchanger / Ejector 等子面板 |
| RecipeSelect :5-16 | 配方下拉（isLab 时额外弹研究模式 Modal :127） |
| SplitterInfo :18 | 分流器子面板 |
| StationInfo :19 | 物流站子面板 |
| isInserter → filter-row :24 | 分拣器过滤器 ItemSelect |
| isBeltBuilding → belt-edit :90 | 传送带 iconId / count 编辑 |
| LabModeText :45 | 研究站当前研究模式（None/Compose/Research） |
| accModeText :47 | 增产剂效果（加速器模式） |
| 命令导入 :189-194 | SetBuildingRecipeCommand / SetLabResearchModeCommand / SetBeltParamsCommand / SetSorterFilterCommand |

### StationInfo.vue（物流站 12 口）

| 位置 | 说明 |
|---|---|
| portList :5-36 | 12 个端口（slot 0..11）循环渲染；**方向 dir 为只读徽标**（role-readonly），物品 storageIdx 为 `<select>` 下拉 |
| 只读方向徽标 :8-14 | 注释说明：dir 由 CreateBeltLineCommand.syncStationPorts 自动维护，不提供手动修改 |
| storageList :39 | 物品栏 ItemSelect + ParamSlider（货物上限 max） |
| roles :64 | 本地/星际物流角色下拉（Supply / None / Demand 等） |
| SetStationPortCommand | 修改口物品时推入，silent=true，同步相邻传送带图标 |

### SpitterInfo.vue（分流器口交互）

| 位置 | 说明 |
|---|---|
| SVG 口示意图 :3-64 | viewBox="-125 -125 250 250"；每个口一个 `<path>` 箭头，transform=rotate(yaw)，输入口额外 rotate(180) |
| 口优先级 :17 | `opacity="params.priority[i] ? 1 : 0.5"` —— 半透明表示非优先 |
| 口交互 :18-19 | `@click.left.prevent.stop="onPortLeft(i)"`（左键设优先/二次点选筛选） / `@contextmenu.prevent.stop="onPortRight(i)"`（右键取消优先） |
| 筛选图标 :39-46 | 优先输出口上显示 filterIcon（ItemSelect ref 隐藏，由端口左键二次点击触发） |
| 3D 模型 :65 | `<div class="model" ref="glRoot">` —— 分流器 3D 预览 |
| SetSplitterPriorityCommand / SetSplitterFilterCommand | 口交互触发，silent=true |

### ReplaceModal.vue（批量替换）

| 位置 | 说明 |
|---|---|
| 6 个互斥范围 checkbox :7-55 | recipe / filter / station / beltIcon / blueprintIcon / buildingLevel —— 互斥 scope 对象 |
| buildingLevel 启用后 :57-80 | 显示**源建筑图标网格**（sourceOptions = upgradeableItems）+ **目标建筑图标网格**（targetOptions = reachableTargets(sourceItemId)） |
| ReplaceCommand | recipe/filter/station/beltIcon/blueprintIcon 范围推入 ReplaceCommand |
| UpgradeCommand | buildingLevel 范围推入 UpgradeCommand |

### ProductionStats.vue（生产统计）

| 位置 | 说明 |
|---|---|
| 增产剂等级 :4-30 | 四档 button（None / MkI / MkII / MkIII），selected 高亮 |
| 总电力 :32-35 | stats.totalPower kW |
| 排序表 :36-80+ | 产出/消耗/净产出三列可点击排序，调用 calculateProductionStats 刷新 |
| 加速模式开关 | （在 ProductionStats 外层或 Panel 内）控制 StatsOptions.useAccelerator |

### BuildingPalette.vue（左侧分类面板）

| 位置 | 说明 |
|---|---|
| buildingCategories :37-48 | 分类按钮组（0-地基 / 1-制造 / 2-分拣器 ...），点击切换 placement.categoryIndex |
| currentBuildings :4-15 | 当前分类下的建筑按钮；F1~F7 快捷键绑定 |
| 地基分类额外按钮 :16-35 | emit('import-photo') 触发 photoToBlueprint；emit('open-rgba') 打开 ReformColorDialog |
| disabled | 不支持的建筑置灰 |
| 导入 @/data/buildingCategories :56-59 | buildingCategories / CategoryBuilding |

### ReformColorDialog.vue（自定义色槽）

| 位置 | 说明 |
|---|---|
| 内置色块 :29-43 | 0-15 内置色 swatch，点击设置 placement.reformColorSlot |
| 自定义色块 :46-60 | 16-31 自定义色槽 swatch；used 样式区分是否已被 setCustomSlotColor 置位 |
| RGBA 编辑 | 自定义槽可展开 RGBA 数值修改（SetReformCustomColorCommand） |
| 当前颜色 :17-27 | 显示 placement.reformColorSlot 的当前值与 hex 字符串 |
| Teleport to="body" :2 | 全局弹窗，不跟随组件位置 |

### TutorialModal.vue（使用教程）

| 位置 | 说明 |
|---|---|
| 可拖拽缩放 dialog :3-56 | 8 方向 resize-handle + pointerdown 事件驱动；header 可拖拽移动 |
| markdown-body :48-52 | `v-html="html"` —— marked 渲染 + DOMPurify 消毒后注入 |
| toc :33-47 | 自动生成目录，按标题层级（h1/h2）折叠；点击跳转 |
| docs/功能说明.md | 教程 Markdown 源文件，编译时 Vite 加载 |
| marked + DOMPurify | npm 依赖，前端运行时渲染 |

---

## 内部关键逻辑

### BlueprintEditor.vue 全流程

```
onMounted
  → createScene (WebGLRenderer + PerspectiveCamera + 星球 + 经纬网格)
  → buildBVH(transforms, buildings) —— 射线拾取加速
  → registerUpdater(commandQueue.updater, allBuildings, posBP) —— 局部刷新回调
  → PlanetMapControls 挂载控制器

鼠标交互:
  raycast(bvh, camera.getWorldDirection(ray)) → 选中建筑 index
  planetToLocal → 网格坐标
  createBuilding → 放置预览 Building
  → 推入 CreateBuildingCommand / CreateBeltLineCommand / createSorterBetween / PaintReformCellCommand

拖拽预览:
  bvh.raycast → 起点
  mousemove → planetToLocal → 终点
  buildBeltLine → buildSorter → PaintReformCell → 预览数组
  松开 → queue.push(command)

Updater 回调:
  updateBuildingIcon → icons.updateIconId(b, iconId) —— 3D 层图标 UV 原地替换
  updateBeltIcon     → icons.updateIconId(b, iconId) 或 icons.addIcon(b, iconId, pos, scale, true)
  updateBeltIconSubscript → subscriptMesh.setText() —— 下标语（count 变化）
  updateSorterIcon   → 同上分流器 filterId 图标
```

关键设计：**silent Command 只派发 Updater 回调，不重建场景**（`data.areas[0].size.x` 不变，不触发 watchEffect 全量重建）。Updater 回调内部直接操作 Three.js 的 attribute（`icons.updateIconId` 改 UV、`subscriptMesh.setText` 改字符池），实现真正的局部刷新。

### BuildingInfoPanel 命令派发

BuildingInfoPanel 不持有 Command 实例，而是在子事件中**即时 new Command 并 push 到 queue**。例如修改配方：

```ts
// BuildingInfoPanel.vue :?
const onRecipeSelected = (recipeId: number | null) => {
    queue.push(new SetBuildingRecipeCommand(building, recipeId ?? 0));
};
```

SetBuildingRecipeCommand.merge 会把连续改写合并（`this.newRecipeId = c.newRecipeId`），因此用户快速切换配方时撤销栈只保留最终配方。

### SpitterInfo 端口状态恢复

点击分流器口时：
1. 左键第一次点击 → SetSplitterPriorityCommand(port, true) —— 设优先
2. 左键第二次点击 → 打开隐藏的 ItemSelect 弹窗，选择后 → SetSplitterFilterCommand(building, filterId)
3. 右键 → SetSplitterPriorityCommand(port, false) —— 取消优先；若取消后分流器无任何优先输出口，Command 内部自动清空 filterId（游戏语义）

撤销时 SetSplitterPriorityCommand.undo 还原 priority 数组，若之前自动清了 filterId 也一并还原。

### ProductionStats 加速模式

加速模式是**面板状态**而非蓝图数据。面板 `watch` 蓝图数据变化 → 重新调用 `calculateProductionStats(bp, options)`。StatOptions 含两个字段：
- `useAccelerator`：总开关（关闭则按无加速计算）
- `acceleratorItem`：MkI / MkII / MkIII 三档，决定 bonus.accelerate / bonus.extraOutput / bonus.power / bonus.sprayCapacity

---

## 依赖的其他模块

### BlueprintEditor.vue

| 依赖 | 用途 |
|---|---|
| `@/blueprint/planet` | findPosForAreas / gridAreas / calcBuildingTrans / HEIGHT_GRID_SIZE —— 星球坐标变换 |
| `@/blueprint/area` | planetToLocal / ROOT_GRID_SIZE —— 网格坐标归一化 |
| `@/blueprint/reform` | buildReforms —— 地基层构建 |
| `@/blueprint/create` | createBuilding / CreateBuildingCommand |
| `@/blueprint/beltLine` | buildBeltLine / CreateBeltLineCommand / BeltPathMode / BeltPortEnd |
| `@/blueprint/sorter` | createSorterBetween / collectOccupiedSlots |
| `@/blueprint/reformEdit` | PaintReformCellCommand / reformColorHex |
| `@/blueprint/removeBuilding` | RemoveBuildingCommand |
| `@/blueprint/parser` | BlueprintBuilding / BeltParameters / LabParamerters / ResearchMode |
| `@/data/beltPorts` | getBeltPorts / hasBeltPorts / pickBeltPort / portWorldNormal / portWorldOffset |
| `@/data/building` | buildingMeta / noIconBuildings |
| `@/data/buildingSlots` | getBuildingSlots / slotDisplayPos |
| `@/data/icons` | itemIconId / recipeIconId |
| `@/data/items` | isBelt / isInserter / isLab |
| `@/command` | Updater |
| `@/editor/placementState` | usePlacement / resetToIdle —— 放置状态机 |
| `@/bvh` | BVH —— 射线拾取加速结构 |
| `@/icons` | IconGeometry / Icons —— 图标层 |
| `@/iconTexture` | IconTexture —— 图标图集 |
| `@/iconSubscript` | IconSubscript —— 皮带 count 下标语 |
| `@/cargos` | Cargos / CargoGeometry / makeCargoGeometry —— 货物 3D 渲染 |

### BuildingInfoPanel.vue

| 依赖 | 用途 |
|---|---|
| `@/blueprint/parser` | 各种 Parameters 类型 / AcceleratorMode / ResearchMode / EnergyExchangerMode |
| `@/blueprint/setBuildingRecipe` | SetBuildingRecipeCommand / SetLabResearchModeCommand |
| `@/blueprint/setBeltParams` | SetBeltParamsCommand |
| `@/blueprint/setSorterFilter` | SetSorterFilterCommand |
| `@/data` | recipesMap |
| StationInfo / SpitterInfo / MonitorInfo / BattleBaseInfo / StorageInfo / BuildingRecipe / RecipeSelect / ItemSelect | 子面板 |

### BuildingPalette.vue

| 依赖 | 用途 |
|---|---|
| `@/data/buildingCategories` | buildingCategories / CategoryBuilding —— 建筑分类数据 |
| `@/editor/placementState` | usePlacement —— 当前分类 / 选中建筑 / 地基模式状态 |
| emit('import-photo') | → photoToBlueprint |
| emit('open-rgba') | → SetReformCustomColorCommand |

### 反依赖（谁依赖本模块）

UI 组件作为视图层，没有其他业务模块依赖它们；它们消费前面所有业务模块的公开接口。
