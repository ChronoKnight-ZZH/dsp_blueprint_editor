# 模块 5：建筑批量操作（building-operations）

## 职责

本模块负责蓝图内建筑的批量修改与连接构造，涵盖五大类操作：

1. **批量替换**：按 5 个维度（recipe / filter / station storage / belt icon / blueprint icon）统一替换目标物品或配方。
2. **建筑升降级**：在预定义的有向边（低级→高级）图上，把指定 itemId 批量改写到目标等级。
3. **加速器模式批量设置**：一键切换全蓝图或指定集合内带加速器字段的建筑的 Accelerate / ExtraOutput 模式。
4. **建筑参数精细编辑**：配方、传送带图标/数量、分拣器/分流器端口、物流站端口、全息信标文本等，每个字段独立一条 Command，支持撤销与连续合并。
5. **连接构造**：在真实蓝图标定的规则下生成分拣器（inserter）与传送带（beltLine）两类连接记录。
6. **生产统计**：按满速理论值汇总蓝图的物品产出/消耗及总功耗，支持分馏塔特殊计算、研究矩阵消耗、增产剂消耗估算。

---

## 关键文件

| 文件 | 用途 |
|---|---|
| `src/blueprint/replace.ts` | ReplaceCommand（5 个维度的批量替换） |
| `src/blueprint/upgrade.ts` | upgradeEdges / UpgradeCommand / reachableTargets |
| `src/blueprint/setAccelerator.ts` | SetAcceleratorCommand（加速/额外产出模式一键切换） |
| `src/blueprint/setBuildingRecipe.ts` | SetBuildingRecipeCommand / SetLabResearchModeCommand（整列研究站联动） |
| `src/blueprint/setBeltParams.ts` | SetBeltParamsCommand（传送带 iconId / count） |
| `src/blueprint/setStationPort.ts` | SetStationPortCommand + stationPortItemId（12 口方向/物品，大塔 N+1=空间翘曲器） |
| `src/blueprint/setSplitterPort.ts` | SetSplitterPriorityCommand / SetSplitterFilterCommand |
| `src/blueprint/setSorterFilter.ts` | SetSorterFilterCommand（分拣器过滤器） |
| `src/blueprint/setBeaconContent.ts` | SetBeaconContentCommand（全息信标文本） |
| `src/blueprint/sorter.ts` | createSorterBetween（主轴/面分组/slot 占用/皮带 offset） |
| `src/blueprint/beltLine.ts` | rasterizeLine / buildBeltLine / CreateBeltLineCommand |
| `src/blueprint/stats.ts` | calculateProductionStats（满速理论统计） |

---

## 公开接口

### Command 类（全部实现 `Command` 接口，来自 `@/command`）

| 类 | 文件:行号 | silent | 连续合并 | 说明 |
|---|---|---|---|---|
| `ReplaceCommand` | replace.ts:24 | ✅ | ❌ | 5 维度批量替换；do 用 `replaceRecipeId`，undo 用 `searchRecipeId` |
| `UpgradeCommand` | upgrade.ts:98 | 由 dispatchIconUpdate 决定 | ❌ | itemId + modelIndex 批量改写 |
| `SetAcceleratorCommand` | setAccelerator.ts:47 | ✅ | ❌ | 统一设 targetMode，undo 逐建筑恢复 originalModes[] |
| `SetBuildingRecipeCommand` | setBuildingRecipe.ts:36 | ✅ | ✅（同建筑） | 研究站自动扩展为整列 |
| `SetLabResearchModeCommand` | setBuildingRecipe.ts:99 | ✅ | ✅（同建筑） | 模式+配方整列联动 |
| `SetBeltParamsCommand` | setBeltParams.ts:11 | ❌ | ✅（同建筑同字段） | iconId / count 两字段 |
| `SetStationPortCommand` | setStationPort.ts:27 | ✅ | ❌ | 单口 dir + storageIdx，自动同步相邻带的图标 |
| `SetSplitterPriorityCommand` | setSplitterPort.ts:14 | ✅ | ❌ | 取消优先后若无优先输出口，自动清空 filterId |
| `SetSplitterFilterCommand` | setSplitterPort.ts:65 | ✅ | ✅（同建筑） | 分流器筛选 |
| `SetSorterFilterCommand` | setSorterFilter.ts:9 | ❌ | ✅（同建筑） | 分拣器筛选 |
| `SetBeaconContentCommand` | setBeaconContent.ts:10 | ✅ | ✅（同建筑） | 全息信标 content 文本 |
| `CreateBeltLineCommand` | beltLine.ts:359 | 否 | ❌ | 批量铺设传送带，处理复用/截断/口方向同步 |

### 工具函数

| 函数 | 文件:行号 | 说明 |
|---|---|---|
| `reachableTargets(fromId)` | upgrade.ts:80 | 在 upgradeEdges 图上 BFS，返回 fromId 可升降到达的所有 itemId |
| `stationPortItemId(storage, storageIdx, interstellar)` | setStationPort.ts:109 | 端口物品序号→实际 itemId；大塔额外处理 N+1=空间翘曲器(1210) |
| `stationPortItemChoices(storage, interstellar)` | setStationPort.ts:122 | 端口可选序号列表 [0, 1..N, 大塔 N+1] |
| `createSorterBetween(src, dst, ...)` | sorter.ts:381 | 在 src / dst 间构造一条分拣器 BlueprintBuilding |
| `beltOffsetFromMain(main)` | sorter.ts:128 | main→皮带端 offset（`floor(main × 21)`，限 ±10） |
| `splitterPortAt(sp, partner, fallback)` | sorter.ts:195 | 分拣器落在分流器哪个口；十字/一字形分流器口编号规则 |
| `collectOccupiedSlots(buildings, targetIndex)` | sorter.ts:153 | 目标建筑上已被占用的 slot 集合 |
| `rasterizeLine(x0,y0,x1,y1,mode)` | beltLine.ts:114 | 整数网格路径栅格化；支持 latFirst / lonFirst / straight(Bresenham) |
| `buildBeltLine(itemId,modelIndex,p0,p1,fallbackYaw,...)` | beltLine.ts:289 | 构造一段 BlueprintBuilding[] 传送带，拐角平分角=45°，起/止绑定建筑口 |
| `calculateProductionStats(bp, options)` | stats.ts:57 | 满速理论产出/消耗/功耗，含增产剂、分馏塔、研究模式 |

### 常量/数据

| 名称 | 文件:行号 | 说明 |
|---|---|---|
| `upgradeEdges: [number, number][]` | upgrade.ts:10 | 低级→高级有向边；MK1→MK2→MK3 传送带/分拣器/制造台/熔炉/研究站/化工厂 |
| `upgradeableItems: number[]` | upgrade.ts:66 | 所有参与升降级的建筑 itemId（去重排序） |
| `BELT_SEGMENTS_PER_CELL = 21` | sorter.ts:55 | 皮带每格内部分段数 |
| `SPACE_WARPER_ITEM_ID = 1210` | setStationPort.ts:103 | 大塔额外物品 |

---

## 内部关键逻辑

### ReplaceCommand（replace.ts:24）

构造函数（:37-73）先按 5 个 scope 字段遍历蓝图，把命中的建筑/口/图标位置分别缓存到：
- `recipeBuildings[]`：`b.recipeId === searchRecipe`
- `filterBuildings[]`：`b.filterId === searchItem`（searchItem = searchRecipe.to[0].item.id）
- `stationStorage[]`：物流站 `storage[i].itemId === searchItem`
- `beltBuildings[]`：传送带 `parameters.iconId === searchIcon`
- `blueprintIconIndex[]`：蓝图头 `icons[i] === searchIcon`

`do`（:98）调用 `replace(replaceRecipeId)`，`undo`（:101）调用 `replace(searchRecipeId)` —— 同一条 `replace()` 内部派发对应的 Updater（updateBuildingIcon / updateSorterIcon / updateBeltIcon / updateStationInfo），对应图标 UV 原地刷新。

### UpgradeCommand（upgrade.ts:98）

构造时收集 `itemId === fromItemId` 的全部建筑，同时取目标物品的 `models[0]` 作为新 `modelIndex`。`do`/`undo` 只改 `b.itemId` 和 `b.modelIndex`，**不重建 parameters**（各等级建筑 parameters 格式相同）。

关键是 `dispatchIconUpdate`（:144）按建筑类型分发到不同刷新通道：
- 传送带（`isBelt`）→ `updater.updateBeltIcon`
- 分拣器（`isInserter`）→ `updater.updateSorterIcon`
- 其它 → `updater.updateBuildingIcon`

原因：传送带/分拣器的 iconId / filterId 只有 >0 时才在 IconGeometry 里注册槽位，统一走 updateBuildingIcon 会抛 "No icon to update"。

### reachableTargets（upgrade.ts:80）

预计算邻接表 `upAdj`（低级→高级）和 `downAdj`（高级→低级）。`reachN(adj, start, n)` 做 n 步 BFS 取前沿集合。`reachableTargets` 合并 1..maxSteps（= upgradeableItems.length，覆盖最长链 4 级分拣器）的 upAdj/downAdj 前沿，实现"从任意等级跳到任一可达等级"。

### SetAcceleratorCommand（setAccelerator.ts:47）

构造函数遍历 `bp.buildings`，支持三层过滤：`buildingIndexes` Set、`labOnly`（仅 2901/2902）、以及 `parameters` 必须包含 `acceleratorMode` 字段。对命中建筑，**快照原始模式到 `originalModes[]`**。

- `do`：`buildings.map(() => targetMode)` —— 统一写入
- `undo`：逐个写回 `originalModes[i]` —— 精确恢复混合模式场景

silent=true，只派发 `updateBuildingIcon`（制造台图标会随加速器模式变化）。

### SetBuildingRecipeCommand / SetLabResearchModeCommand（setBuildingRecipe.ts:36 / :99）

关键是 `labColumn(data, building)`（:16-24）：通过 `stackColumn`（来自 `@/data/stacking`）找到同一格沿堆叠端口 inputToSlot=14 相连的整列研究站。构造时不解析整列，首次 `do` 时懒解析并快照原始 recipeId / 模式，保证 redo/undo 作用对象固定。

SetBuildingRecipeCommand 的 `merge` 只合并"同一建筑的连续改写"：`this.newRecipeId = c.newRecipeId`。

### SetStationPortCommand（setStationPort.ts:27）

12 口配置：`parameters.slots[i] = { dir, storageIdx }`。构造函数快照 prevDir / prevIdx；`do` / `undo` 里若 storageIdx 改变，自动调用 `syncBeltIcon`（:59）——把相邻传送带的 `parameters.iconId` 同步为该口新携带的物品图标。

大塔（2104）storage.length = 5，额外的 storageIdx=6 映射到 SPACE_WARPER_ITEM_ID=1210（见 `stationPortItemId` :109-119）。

### SetSplitterPriorityCommand（setSplitterPort.ts:14）

分流器的 priority 是一个布尔数组。关键交互：当取消某口优先，且**整个分流器已没有任何优先输出口**时（用 `hasPrioritizedOutput`），自动清空 filterId（游戏一致：筛选必须挂在优先输出口）。撤销时还原 filterId。

### createSorterBetween（sorter.ts:381）

这是本文件最复杂的函数。真实蓝图标定的规则：

1. **主轴**：两端中心整格差的主分量（Δx/Δy 最大者），45° 斜向拒绝。
2. **建筑端 slot**：朝向对端的面上，横向坐标最近的空闲 slot（`chooseSlot`）。
3. **皮带端**：端点 = `projectOnBelt`（轴线与皮带中心线交点），offset = `floor(main × 21)`，限 ±10；若被占用平移到最近空闲分段中心。
4. **分流器口**：按 partner 相对分流器方向反推口编号（`splitterPortAt`），十字形四口、一字形只开口 0/2 两端。
5. **校验**：长度 1-3 格；两端 slot 横向偏差 ≤ 0.35（不架斜向）；口未被占用；端点身份唯一；与已有分拣器不共线压叠。

pose[4] = yaw0，pose[0] = 输入端为建筑时 ≈ 0.20118（游戏未公开语义，原样复现）。

### rasterizeLine / buildBeltLine / CreateBeltLineCommand（beltLine.ts）

**rasterizeLine**（:114）：整数网格上的路径栅格化。三种模式：
- latFirst（默认）：先走 x，再走 y
- lonFirst：先走 y，再走 x  
- straight：Bresenham 直线

x 方向为环形坐标，`shortArcDelta` 自动取最短弧（跨越 0 经线）。

**buildBeltLine**（:289）：每格 yaw = `cellYaw`（:162-178）——**进入方向与离开方向的平分角**。拐角 90° 差 → 45° 斜角，直格 → 行进方向。起/止端若绑定建筑口，口格的记录位置写成口的精确坐标，连接字段（inputObjIdx / outputObjIdx / slot / offset）在构造时就写好。

**CreateBeltLineCommand**（:359）：执行时处理三种情况：
- 同口/同格**已有带** → 截断本次拖拽（游戏：一个口只能接一条）
- 某格**在已有线路中间**（已有下游）→ 截断（游戏不支持双上游）
- 某格**是已有线路末格** → 复用，按新上下游重算 yaw

撤销时弹出新增格、恢复复用格原 yaw、恢复物流站口 dir。

### calculateProductionStats（stats.ts:57）

遍历每个建筑，按 `buildingPowerMap` 查功耗与 speedMultiplier，应用加速倍率（1 + bonus.accelerate / extraOutput / power）。三类建筑特殊处理：

1. **分馏塔**（itemId=2314，:95-102）：无 recipe，固定处理 72×speedMultiplier×(1+accelerate) 氢→重氢。
2. **研究站 ResearchMode**（:117-120）：消耗配方产物（矩阵）而非原料；**消耗速率不受增产剂加速影响**（speedMult 不乘 bonus）。
3. **增产剂本身消耗**（:159-169）：`proliferatorBase / bonus.sprayCapacity`，其中 proliferatorBase 累加的是**被加速建筑的原料总流量 + 分馏塔流量**。

---

## 依赖的其他模块

| 依赖 | 用途 |
|---|---|
| `@/blueprint/parser` | BlueprintBuilding / BlueprintData / AssembleParamerters / LabParamerters / BeltParameters / SplitterParameters / StationParameters / AcceleratorMode / ResearchMode / IODir |
| `@/command` | Command 接口、Updater（updateBuildingIcon / updateBeltIcon / updateSorterIcon / updateStationInfo / updateBeltIconSubscript） |
| `@/data/items` | isBelt / isStation / isInserter / isSplitter / isLab / isInterstellarStation / itemsMap |
| `@/data/recipes` | recipesMap |
| `@/data/icons` | itemIconId / recipeIconId |
| `@/data/building` | buildingBoxes / buildingMeta |
| `@/data/buildingSlots` | getBuildingSlots / faceSlotIndices / slotDisplayPos |
| `@/data/stacking` | stackColumn（研究站整列解析） |
| `@/data/acceleratorData` | acceleratorBonuses |
| `@/data/buildingPowerData` | buildingPowerMap |
| `@/blueprint/create` | createBuilding |
| `@/blueprint/globe` | `ensureCanvasArea` / `materializeCanvasTarget` / `ROOT_GRID_SIZE`（放置时按纬度带补区域） |
| `@/blueprint/splitterPorts` | hasPrioritizedOutput |
| `@/blueprint/beltLine`（内部循环） | beltOffsetFromMain 被 sorter.ts 调用 |
