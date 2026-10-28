# 模块：command-system —— 命令系统

## 职责概述

提供**可撤销 / 可重做**的命令队列，以及跨组件的**增量刷新事件通道**。职责分层：
- `command.ts`：核心框架——`Command` 接口、`CommandQueue`（容量 256）、`EventDispatcher<T>`、`Updater`（5 个 dispatcher）、`stateVersion` / `execVersion` 双版本号分流。
- `src/blueprint/create.ts`：放置建筑的命令（`CreateBuildingCommand`）和空画布初始化。
- `src/blueprint/removeBuilding.ts`：删除命令族（单个 / 批量 / 同类，含 index 重排、dangling 连接维护、端口方向清理）。
- `src/blueprint/defaultParams.ts`：为新放置建筑生成最小合法参数模板（switch 覆盖 20 余种建筑，`allAssemblers` 集合兜底）。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/command.ts` | 核心框架（144 行），含 Command / CommandQueue / Updater / EventDispatcher |
| `src/blueprint/create.ts` | 放置建筑（123 行），含 `createEmptyBlueprint` / `createBuilding` / `CreateBuildingCommand` |
| `src/blueprint/removeBuilding.ts` | 删除建筑（171 行），含 `RemoveBuildingsCommand` / `RemoveBuildingCommand` / `RemoveBuildingsByItemCommand` |
| `src/blueprint/defaultParams.ts` | 默认参数生成（231 行），含 `defaultParamsFor(itemId, modelIndex)` |

## 公开接口

### command.ts（参见：src/command.ts）

**`EventDispatcher<TArgs>`**（行 5-23）

轻量事件分发器：
- `on(callback)`：注册回调。
- `onMounted(callback)`：Vue 组件挂载时注册、卸载时自动清除（内部调用 `vue.onMounted / onUnmounted`）。
- `dispatch(...args)`：遍历 Set 中所有回调调用。
- `clear()`：清空全部回调——防止场景重建时 registerUpdater 重复注册导致陈旧回调引用已销毁的 AllBuildings 对象。

**`Updater`**（行 25-46）

5 个 `EventDispatcher`：
1. `updateBuildingIcon`：建筑图标变（recipe / researchMode 改变）→ 触发重算 `buildingIconId` 并 updateIconId（BlueprintEditor.vue registerUpdater 行 526-534）。
2. `updateBeltIcon`：传送带 `BeltParameters.iconId` 变 → updateIconId（行 536-553）。
3. `updateBeltIconSubscript`：传送带 `count` 变 → 重算下标文本（行 555-578；**长度不变才刷新**，避免覆盖后续 belt 字符位置）。
4. `updateSorterIcon`：四向分流器 `filterId` 变 → updateIconId（行 580-597）。
5. `updateStationInfo`：物流站库存 / 筛选物品改动 → StationInfo 面板局部刷新（响应 `props.building` 是原始对象直接改字段不会触发 Vue 响应式 bump）。

**`Command` 接口**（行 48-58）

```typescript
export interface Command {
    do(data: BlueprintData, updater: Updater): void;
    undo(data: BlueprintData, updater: Updater): void;
    merge(c: Command): boolean;
    readonly silent?: boolean;  // true = 只改图标/颜色/文字/纯数据，不改变几何/拓扑
}
```

**`CommandQueue`**（行 60-143）

- **容量**：`_maxSize = 256`（行 61），`trim()` 超出时从队尾剔除最旧命令，`currentPosition` 相应左移。
- **双版本号分流**（核心语义，见下）：
  - `stateVersion = ref(0)`：每次命令（无论 silent 与否）都递增。通知 App.vue 蓝图字符串需要重新生成（codeExpired）。
  - `execVersion = ref(0)`：**仅非 silent 命令**递增。通知 BlueprintEditor 整体重建 3D 场景（几何/拓扑变更）。
- **`push(c)`**（行 102-115）：
  1. `commands.splice(currentPosition)`：丢弃 redo 栈（重做历史清除）。
  2. `c.do(data, updater)`：执行命令。
  3. `merge(c)`：尝试合并到上一条命令（典型场景：拖拽连续放置建筑）。
  4. 合并成功则直接 return（不进栈）；否则 `commands.push(c)` 并 `currentPosition++`。
  5. `trim()` + `stateVersion++`。
  6. `!c.silent` 时 `execVersion++`。
- **`undo()` / `redo()`**（行 122-143）：调用 `cmd.undo` / `cmd.do`，同时 bump 两个版本号（undo 也 bump execVersion——因为把"几何操作"撤销回去，重建场景是合理的）。
- **快照语义**：不做整份 BlueprintData 的深拷贝。`Command.do` 里**直接修改 data 数组 / 对象字段**，`Command.undo` 时**反向修改回去**，每个 Command 对象保存自己的"前后态"差异。

**版本号分流的真实场景**

| 操作 | silent | stateVersion | execVersion | 效果 |
| --- | --- | --- | --- | --- |
| 放置 / 剔除 / 撤销 / 重做 | false | +1 | +1 | 场景重建 + 蓝图代码重新生成 |
| 改配方（研究站） | true | +1 | 不变 | 仅图标颜色更新（Updater.dispatch）+ 蓝图代码重新生成 |
| 改传送带 count | true | +1 | 不变 | 仅 beltIconSubscript 文本刷新 |
| 改四向分流器 filterId | true | +1 | 不变 | 仅 sorterIcon 刷新 |

### create.ts（参见：src/blueprint/create.ts）

**`createEmptyBlueprint()`**（行 12-44）

- 返回单根区域蓝图：`version: 2`，`areas: [{ index:0, parentIndex:-1, areaSegments:200, anchorLocalOffset:{0,0}, size:{10,161} }]`，`buildings: []`，`dragBoxSize:{0,0}`（**关键**：dragBoxSize 为 0 才会触发 `normalizeBlueprintAreas` 导出归一化），`patch: 1`，`reformData: null`。
- 根区域纬向高度 161（赤道全带高度），初始宽 10。

**`createBuilding(itemId, modelIndex, offset, yaw, z=0)`**（行 52-93）

构造单建筑最小合法 v2 记录：
- `index / areaIndex` 先写 0（由 `CreateBuildingCommand.do` 再赋值）。
- `localOffset: [{x,y,z},{x,y,z}]`（起 / 止点同格同高，分拣器的尖端由分拣器模块再推）。
- `yaw: [yaw, yaw]`，`tilt: 0`。
- 所有连接字段 `-1`（无连接），slot 默认 0。
- `recipeId / filterId / parameters = defaultParamsFor(itemId, modelIndex)`（**关键**：不传 parameters 会让游戏填默认，但部分建筑（储物仓 / 研究站）传 null 游戏无法识别，必须显式给合法模板）。
- `stackPortDefaults(itemId)`：可堆叠建筑即使没堆叠也必须写 `out=-1/14/15/0 / in=-1/15/14/0`，否则游戏会把这些字段当成分拣器 slot 0 产生错误连接（create.ts 行 82-91 注释）。

**`CreateBuildingCommand implements Command`**（行 100-123）

- `do`：写入 `areaIndex`（构造参数，编辑器按建筑所在纬度带选出；缺省 0 = 根区域）、`index=data.buildings.length`，把建筑落进该区域并扩宽 `size.x`；区域不存在或纬向越出该区域时抛错。
- 建区域（按需补出某条纬度带的区域）由编辑器在构造命令**之前**调用 `ensureCanvasArea` 完成（`BlueprintEditor.materializeTarget`），属于画布状态，不随单次放置回滚。
- `undo`：`buildings.pop()` + 还原该区域的 `size.x / size.y`。
- `merge`：永远 false（放置不同 itemId / 不同 yaw 的建筑不可合并；连续同 item 拖拽放置是未来可能扩展）。
- **非 silent**（默认 false）→ 触发 execVersion bump → 场景重建。

### removeBuilding.ts（参见：src/blueprint/removeBuilding.ts）

核心挑战：**数组 index 即建筑在数据里的身份标识**。删除一批建筑后，剩余建筑的 index、以及所有 `outputObjIdx / inputObjIdx` 交叉引用都需要同步重排。

**`RemoveBuildingsCommand implements Command`**（行 43-153）

- **构造函数**：接收一批 indices → `new Set(unique)`（去重升序）→ `removed: RemovedRecord[]`（保存在数组中的**原始位置** + building 对象本身，供 undo 时原样插回）。
- **do()**（行 85-115）四步：
  1. `clearPortDirs`（行 63-83）：如果被删的是传送带，把连接到的物流站（surviving）端口方向 `s.dir` 清空为 `IODir.None`（`slot 保持 storageIdx 不变`，只清 dir；撤销时还原）。
  2. 构建 `newIndexOf: Int32Array(n)`：遍历 0..n-1，被删 → -1，幸存 → `cursor++` 累计新 index。
  3. 记录 `dangling: DanglingRecord[]`：幸存建筑引用了被删建筑的 outputObjIdx / inputObjIdx → 断开（撤销时恢复原始 target index）。
  4. **倒序 splice 删除**（行 105-106）：从 `n-1 downto 0`，`removeSet.has(i)` 时 `splice(i, 1)`，避免数组收缩影响后续迭代。
  5. 重排幸存建筑的 `index` 和 `LINK_FIELDS`（行 108-114）：`b.index = newIndexOf[b.index]`，`b[field] = newIndexOf[ref]`（-1 表示未连接）。
- **undo()**（行 117-148）四步：
  1. 还原 `portDirs`（行 118-123）。
  2. **正序 splice 插回**：`removed` 按原始 index 顺序 `splice(r.index, 0, r.building)`（行 124-125）。
  3. 所有建筑按当前位置重新赋 index（行 126）。
  4. 恢复 dangling 连接（`b[field] = dangling.target` 原值）+ 其他连接按 `oldIndexOfNew` 映射（行 129-147）。
- **merge()**：永远 false。

**两个便捷子类**

- `RemoveBuildingCommand extends RemoveBuildingsCommand`（行 156-160）：构造单个 index。
- `RemoveBuildingsByItemCommand extends RemoveBuildingsCommand`（行 163-170）：构造同 itemId 的全部 indices（列表图标右键"删除同类"）。

### defaultParams.ts —— defaultParamsFor(itemId, modelIndex)（参见：src/blueprint/defaultParams.ts）

返回 itemId → **最小合法 AllParameters 模板**；未注册返回 null（让 parser 的 `unknownParamParser` 兜底）。switch 覆盖范围：

| itemId | 返回类型 | 备注 |
| --- | --- | --- |
| 2103 | `StationParameters` | 物流运输站：4 种物品、12 槽、默认 workEnergyPerTick=200000 |
| 2104 | `StationParameters` | 星际物流运输站：5 种物品、12 槽、1000000 |
| 2316 | `AdvancedMiningMachineParameters` | 大型采矿机：1 种物品、默认采矿机的初始配置 + `miningSpeed=10000` |
| 2020 | `SplitterParameters` | 四向分流器：4 个优先级全 false + extra=[0,0]（v2 槽） |
| 2901 / 2902 | `LabParamerters` | 研究站：`researchMode: None, acceleratorMode: ExtraOutput` |
| 2001 / 2002 / 2003 | **null** | 传送带：新放置无参数，由 setBeltParams 按需初始化 |
| 2011-2014 | `InserterParameters` | 分拣器：`length: 1` |
| 2101 / 2102 | `StorageParameters` | 储物仓：`automationLimit: 0, type: DEFAULT, grids: []` |
| 2106 | `TankParameters` | 储液罐：`{ output: true, input: true }` |
| 2311 | `EjectorParameters` | 电磁轨道弹射器：`{ orbitId: 0, boost: false }` |
| 2208 | `PowerGeneratorParameters` | 射线接收站 / 人造恒星（同类型） |
| 2210 | `ArtifacialStarParameters` | `{ boost: false }` |
| 2209 | `EnergyExchangerParameters` | `{ mode: 0 }` |
| 2030 | `MonitorParameters` | 流速监测器：默认 targetCargoAmount=0、periodTicksCount=360、passColorId=113、failColorId=13、passOperator=5、音量 80、落色半径 [24,72] 等 |
| 3009 | `BattleBaseParameters` | 战场分析基站：继承 storage + automationLimit=10 + workEnergyPerTick=40000 + 默认 12 个 fighters(itemId=5101) |
| 2107 | `DispenserParameters` | 物流配送器：playerMode=2 / storageMode=0 / workEnergyPerTick=30000 / courierAutoReplenish=false |
| 2213 | `UnknownParamerters` | 地热发电站：单参数槽 `Int32Array([0])` |
| 2312 | `UnknownParamerters` | 垂直发射井：单参数槽 `Int32Array([0])` |
| 2401 | `UnknownParamerters` | 全息信标：2048 槽，前 5 个固定初值 [83,1250,150,2,2] |
| 3001 / 3002 / 3006 | `UnknownParamerters` | 防御塔（128 槽）：turretParams(15) / turretParams(11) / turretParams(192) / turretParams(207)，priority 写 index 2 |
| `allAssemblers.has(itemId)` | `AssembleParamerters` | **兜底**：制造台 Mk.I-IV / 熔炉 Mk.II-III / 化工厂 Mk.II / 对撞机 / 分馏塔 等 |

## 内部关键逻辑

### LinkField 索引重排（removeBuilding.ts）

- `LINK_FIELDS = ["outputObjIdx", "inputObjIdx"]`（行 11）：两处都要处理。
- 删除后 `newIndexOf[deleted] = -1` → 幸存建筑若有 ref = -1 保持不变（未连接）；ref 指向幸存 → 前移；ref 指向被删 → **断开置 -1** 并记录 `dangling`。
- 撤销时 `oldIndexOfNew` 把新 index 映射回原始位置，dangling 直接恢复原始 target，未 dangling 的幸存连接按映射表前移。

### portDirs 清理（removeBuilding.ts）

游戏里"传送带挂在物流站口上"是双向的：传送带写 `outputObjIdx=站index, outputToSlot=slot`，**站**的 `StationParameters.slots[slot].dir = IODir.Input(2)` 指示"这口正在接一条传送带"。传送带被删后，站的这个 dir 必须清为 `IODir.None(0)` 否则游戏读蓝图会报错或显示异常。`portDirs` 在 clearPortDirs 时快照，undo 时恢复。

### Command.merge 的意义

未来拖拽连续放置同类型建筑时可以把多个 `CreateBuildingCommand` merge 成一个（执行一次 do、撤销一次 undo 就把这一串全删）。当前所有 Command 的 merge() 都返回 false——框架已就绪但功能未激活。

## 依赖的其他模块

| 依赖 | 用途 |
| --- | --- |
| `vue` 的 `ref / onMounted / onUnmounted` | CommandQueue 的 `stateVersion / execVersion` 是 Vue 响应式；EventDispatcher 的 `onMounted` 绑定生命周期 |
| `@/blueprint/parser` 的 `BlueprintBuilding / BlueprintData / LogisticRole / StationParameters / IODir` | 默认参数模板里的枚举、类型 |
| `@/blueprint/globe` 的 `ensureCanvasArea` | 放置前按需补出目标纬度带的区域（见 blueprint-core.md 的"全球画布"） |
| `@/blueprint/defaultParams` 的 `stackPortDefaults` | 可堆叠建筑端口默认值（create.ts 行 85） |
| `@/blueprint/parser` 的 `allAssemblers` | defaultParamsFor 兜底逻辑（行 139） |
| `@/data/items` 的 `isBelt` | 删除传送带时触发 portDirs 清理（removeBuilding.ts 行 67） |
