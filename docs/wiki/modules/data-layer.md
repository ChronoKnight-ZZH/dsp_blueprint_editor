# 模块：data-layer —— 数据资源层

## 职责概述

存放游戏物品、建筑、配方、slot、传送带口、电力、加速剂、堆叠规则、图标 ID 编码、颜色调色板等**纯静态数据**。全部模块都是 `const` / `export`，**无状态、无副作用**（`items.ts / recipes.ts / icons.ts` 里有一次性循环把数组转 Map/Set，属于模块初始化）。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/data/items.ts` | itemsMap + isBelt/isInserter/... 分类 + allAssemblers 集合，92 行 |
| `src/data/recipes.ts` | recipesMap（10 行） |
| `src/data/building.ts` | buildingMeta（颜色/选择盒/icon 偏移）+ noIconBuildings + stationSlotTrans，155 行 |
| `src/data/buildingSlots.ts` | 12 种建筑 slot 坐标表 + 面分组表 + FACE_TOL + SLOT_MARKER_FACE_INSET + slotDisplayPos，459 行 |
| `src/data/buildingPowerData.ts` | BuildingPowerData 接口 + buildingPowerData 数组 + buildingPowerMap，228 行 |
| `src/data/acceleratorData.ts` | AcceleratorItem 枚举 + AcceleratorBonus 接口 + acceleratorBonuses 表，45 行 |
| `src/data/stacking.ts` | STACK_TOP_SLOT / STACK_BOTTOM_SLOT / BOX_TOP_SLOT + stackHeight / stackCompat + stackBaseFor / stackColumn / stackPortDefaults 等堆叠规则，335 行 |
| `src/data/beltPorts.ts` | 8 种已标定的传送带口表 + getBeltPorts / beltPortAt / nearestBeltPort / pickBeltPort，323 行 |
| `src/data/icons.ts` | 图标 ID 区间划分（<1000 信号、<20000 物品、<40000 配方、<60000 科技），69 行 |
| `src/data/color.ts` | 256 色调色板字符串数组（258 行） |

## 公开接口

### items.ts（参见：src/data/items.ts）

- `itemsMap: Map<number, Item>`（行 4-8）：`import { items } from "./itemsData"` → 按 `item.id` 建索引。`Item` 类型在 `src/data/types.ts` 定义（含 `id / name / icon / category` 等字段）。
- **分类判定函数**（行 10-76）：全部 `id → boolean`，实现都是简单 `id 范围判断` 或 `=== / Set.contains`：
  - `isBelt(id)`：2001 ≤ id ≤ 2003（低速/高速/极速传送带）
  - `isInserter(id)`：2011 ≤ id ≤ 2014（低速/高速/极速集装/极速分拣器）
  - `isStation(id)`：2103 / 2104 / 2316（物流运输站 / 星际物流运输站 / 大型采矿机——采矿机继承 StationParameters）
  - `isSplitter(id)`：2020（四向分流器）
  - `isLab(id)`：2901 / 2902（矩阵研究站 Mk.I / Mk.II）
  - `isStorage(id)`：2101 / 2102 / 3009（储物仓·小 / 储物仓·大 / 战场分析基站）
  - `isTank(id)`：2106（储液罐）
  - `isEjector(id)`：2311（电磁轨道弹射器）
  - `isRayReciver(id)`：2208（射线接收站）
  - `isArtificialStar(id)`：2210（人造恒星）
  - `isEnergyExchanger(id)`：2209（能量枢纽）
  - `isAdvancedMiningMachine(id)`：2316
  - `isMonitor(id)`：2030（流速监测器）
  - `isBattleBase(id)`：3009
  - `isDispenser(id)`：2107（物流配送器）
  - `isHoloBeacon(id)`：2401（全息信标）
- `allAssemblers: Set<number>`（行 78-92）：{2303, 2304, 2305, 2318, 2302, 2315, 2319, 2308, 2309, 2317, 2310, 2901, 2902} —— 用于：
  1. `parser.ts` 行 1023-1026 循环注册 ParamParser（`assembleParamParser`）。
  2. `defaultParams.ts` 行 139 兜底 defaultParamsFor（`AcceleratorMode.ExtraOutput`）。

### recipes.ts（参见：src/data/recipes.ts）

- `recipesMap: Map<number, Recipe>`（行 4-8）：`import { recipes } from "./recipesData"` → 按 `recipe.id` 建索引。`Recipe` 类型在 `types.ts`（含 `id / name / from[] / to[] / time / icon?`）。

### building.ts（参见：src/data/building.ts）

**BuildingMeta 接口**（行 3-8）

```typescript
interface BuildingMeta {
    color: Color;           // 模型颜色
    unitBoxTrans: Matrix4;  // 渲染用选择盒（× 0.9 / 0.999 缩放，避免重叠闪烁）
    selectUnitBoxTrans: Matrix4;  // 拾取用选择盒（精确尺寸）
    iconTrans: Matrix4;     // 图标层偏移（旋转 X 90° + 根据 box 高度定 iconHeight）
}
```

**buildingMeta 构建**（行 100-126）

- 从 `buildingMetaRaw: [modelIndex, {color, box:[x,y,z], offset:[x,y,z]}][]` 循环构建。每个模型的 box 尺寸（选择盒）按 `modelIndex` 而非 `itemId`（同款不同 itemId 共用模型——制造台 Mk.I/Mk.II/Mk.III/Mk.IV 都是 4.2×4.6×4.2）。
- 变换链：`makeTranslation(offset)` + `makeRotationX(π/2)`（因为游戏模型是 y-up，three 是 y-up 但选择盒要"竖立"）+ `makeScale(box*f)`。
- `iconHeight`：`box[1] < 4.0 ? box[1]/2 : box[1]-2`（行 113）——矮建筑 icon 居中，高建筑 icon 贴顶上 2 单位处。
- **无 `color` 的模型**（采矿机、大型采矿机、原油萃取站、射线接收站、垂直发射井、人造恒星、能量枢纽、人造恒星等）→ 用默认 0xdddddd（行 120）。

**noIconBuildings**（行 128-135）：`Set([2020, 2040, 2030, 2313, 2201, 2202])` —— 四向分流器 / 自动集装机 / 流速监测器 / 喷涂机 / 电力感应塔 / 无线输电塔（**这些建筑不传图标**；`IconGeometry.hasIcon(b)` 守卫跳过，BlueprintEditor.vue buildBuildings 直接渲染几何盒）。

**stationSlotTrans**（行 137-155）：12 个物流站 slot 的 Matrix4（纯 translation），`o1=1.256 / o2=2.7`，12 口环绕环（四角 + 四边中点）。用于**物流站（2103/2104）** 的 slot 坐标——这俩不在 buildingSlots.ts 里，单独给出。

### buildingSlots.ts（参见：src/data/buildingSlots.ts）

**SlotTable 约定**（行 3-24）：数组下标 = 游戏 slot 编号；`null = 该 slot 尚未标定`。x 为**赤道基准**（cos(纬度) 归一化），y、z 为原始格。

**已标定的 slot 表**（行 26-231）：
- `storage2101 / storage2102`：储物仓（小 3.2×3.2 / 大 6.2×4.2），12 slot 环。
- `powerPlant2204`：火力发电厂，5 slot。
- `artificialStar2210`：人造恒星，4 slot。
- `smelter2302`：电弧熔炉（3.2×3.2），**角 slot 坐标与相邻面边界 slot 逐位相同**（游戏数据就是这样）。
- `assembler2303`：制造台 Mk.I（4.2×4.2），12 slot 环，**角 slot 坐标本身不重合**。
- `refinery2308`：原油精炼厂，只标定了 -y 面的 6/7/8（其余 null）。
- `chemicalPlant2309`：化工厂（9.2×6.3），8 slot。
- `collider2310`：微型粒子对撞机（11.2×13.0），9 slot。
- `oilExtractor2311`：原油萃取站（7.0×5.0），4 slot。
- `silo2312`：垂直发射井（15.0×19.0），3 slot。
- `lab2901`：矩阵研究站（6.1×3.1），12 slot。
- `battleBase3009`：战场分析基站（5.0×7.0），9 slot。

**slotAliases**（行 202-210）：同款模型复用 slot 表——2211(微型聚变发电站)=2204，2304/2305/2318=2303，2315/2319=2302，2902=2901。

**面分组表 slotFaceGroups**（行 271-308）：**每个面恰好 3 个 slot**（两端角 + 中间）。显式给定而不是靠几何极值——因为"角 slot 坐标与相邻面边界 slot 逐位相同"，几何法会把它归错面。数组顺序 `[+y(北), +x(东), -y(南), -x(西)]`；**矩阵研究站 2901 的编号绕向与储物仓相反**（东面是 9/10/11 而不是 3/4/5），所以每建筑单独给。

**面归属容差**

- `FACE_TOL = 0.03`（行 256）：slot 投影到面法线后与该方向极值之差 ≤ 0.03 即视为属于该面。0.03 刚好让 3.2×3.2 建筑的角 slot 同时属于两个相邻面，但不会把制造台 slot 3（距 +y 极值 0.079）误并入邻面。
- `SLOT_MARKER_FACE_INSET = 0.18`（行 380）：角 slot 与相邻面边界 slot 坐标相同 → UI 上显示时**沿所属面方向向面中心收缩 0.18 格**，让四边各三个标记"展开"，不重叠。**仅影响视觉**，连接用的端点坐标仍取原值。

**核心函数**

- `getBuildingSlots(itemId): SlotTable`（行 238-241）：alias 查找 + slotTable。
- `slotFaceGroupsOf(itemId)`（行 314-319）：显式面分组表；无表返回 null。
- `slotFaceOf(itemId, slot): number`（行 328-335）：slot → 所属面索引 0..3；无分组表 / slot 未标定 → -1。
- `faceSlotIndices(itemId, dir): number[]`（行 350-372）：属于方向 dir 所在面的 slot 编号列表（升序）。有显式分组表直接按表返回；其余用几何极值法。
- `slotDisplayPos(itemId, slot, inset=0.18)`（行 388-401）：显示用 slot 标记坐标（沿面方向收缩）。
- `findNearestSlot(itemId, localX, localY)`（行 407-425）：找最近 slot 编号（点击判断）。
- `findNearestFreeSlot(itemId, localX, localY, occupied)`（行 434-459）：同面内找最近空闲 slot（分拣器放置时避免占用）。

### buildingPowerData.ts（参见：src/data/buildingPowerData.ts）

**BuildingPowerData 接口**（行 3-14）

```typescript
interface BuildingPowerData {
    itemId: number;
    name?: string;
    basePower: number;     // kW
    speedMultiplier: number;  // 相对 Mk.I 的速度倍率
    canAccelerate: boolean;   // 是否允许生产加速/额外产出
}
```

**buildingPowerData 数组**（行 16-223）

分类覆盖（Mk.IV/Mk.III 倍率/功耗精确到官方数值）：

| 建筑类型 | itemId | basePower (kW) | speedMultiplier | canAccelerate |
| --- | --- | --- | --- | --- |
| 制造台 Mk.I/II/III/IV | 2303/2304/2305/2318 | 270/540/1080/2700 | 0.75/1.0/1.5/3.0 | ✓ |
| 电弧熔炉 / 位面 / Mk.III | 2302/2315/2319 | 360/1440/2880 | 1.0/2.0/3.0 | ✓ |
| 化工厂 / Mk.II | 2309/2317 | 720/2160 | 1.0/2.0 | ✓ |
| 矩阵研究站 / Mk.II | 2901/2902 | 480/1920 | 1.0/3.0 | ✓ |
| 原油精炼厂 | 2308 | 960 | 1.0 | ✓ |
| 微型粒子对撞机 | 2310 | 12000 | 1.0 | ✓ |
| 分馏塔 | 2314 | 3960 | 1.0 | ✓ |
| 抽水站 / 原油萃取站 / 大型采矿机 | 2306/2307/2316 | 0 | 1.0 | ✗ |
| 电磁轨道弹射器 | 2311 | 1800 | 1.0 | ✗ |
| 垂直发射井 | 2312 | 18000 | 1.0 | ✗ |
| 物流运输站 / 星际运输站 | 2103/2104 | 0 | 1.0 | ✗ |
| 分拣器低速/高速/极速 | 2011/2012/2013 | 18/36/72 | 1.0 | ✗ |
| 自动集装机 / 流速器 / 喷涂机 | 2040/2030/2313 | 144/36/90 | 1.0 | ✗ |

**buildingPowerMap**（行 226-228）：`Map<number, BuildingPowerData>`，按 `itemId` 建索引供快速查询。

### acceleratorData.ts（参见：src/data/acceleratorData.ts）

**AcceleratorItem 枚举**（行 2-7）：`None=0 / MkI=1 / MkII=2 / MkIII=3`。

**AcceleratorBonus 接口**（行 9-18）

```typescript
interface AcceleratorBonus {
    extraOutput: number;    // 额外产出模式加成（小数，0.125 = +12.5%）
    accelerate: number;     // 加速生产模式加成
    power: number;          // 电量消耗加成
    sprayCapacity: number;  // 每瓶增产剂可喷涂物品数量
}
```

**acceleratorBonuses 表**（行 20-44）

| 等级 | extraOutput | accelerate | power | sprayCapacity |
| --- | --- | --- | --- | --- |
| None | 0 | 0 | 0 | 0 |
| MkI | 0.125 (+12.5%) | 0.25 (+25%) | 0.30 (+30%) | 12 |
| MkII | 0.20 (+20%) | 0.50 (+50%) | 0.70 (+70%) | 24 |
| MkIII | 0.25 (+25%) | 1.00 (+100%) | 1.50 (+150%) | 75 |

### stacking.ts（参见：src/data/stacking.ts）

**堆叠端口常量**（行 25-30）

- `STACK_TOP_SLOT = 15`：底座顶面（上层底面写 `inputFromSlot = 15`）。
- `STACK_BOTTOM_SLOT = 14`：上层底面（写 `inputToSlot = 14`）。
- `BOX_TOP_SLOT = 13`：储物仓箱盖接口（仅物流配送器 2107 用）。

**stackHeight Map**（行 33-43）：底座 itemId → 每层高度（格）。
- 2020/2040/2313 = 2 格（四向分流器 / 自动集装机 / 喷涂机）
- 2101 = 2 格（储物仓·小）
- 2102/2106/2901/2902 = 3 格（储物仓·大 / 储液罐 / 矩阵研究站）
- 3009 = 6 格（战场分析基站——分析仪台面是长方形，叠在它上面的大型储物仓整层高度 6）

**stackCompat Map**（行 53-65）：**允许的底座→上层组合**（保守表，宁让用户放不下去也不写进蓝图让游戏报错）：
- 2020 → 2101, 2020（分流器上可叠储物仓·小或同分流器自叠）
- 2040 → 2040（集装机自叠）
- 2313 → 2313（喷涂机自叠）
- 2101 / 2102 → 2101, 2102, 2107（箱子互叠 + 可叠物流配送器）
- 2106 → 2106（储液罐自叠）
- 2901 / 2902 → 2901, 2902（研究站互叠，含 Mk.I/Mk.II 交叉）
- **3009 → 2102**（战场分析基站台面是长方形 5.0×7.0，只有大型储物仓 2102 长边转 90° 才能对上）

**onTopOf Map**（行 79-87）：**只能放在底座顶面上**的建筑 → 底座 → 落位高度。只有 2107（物流配送器）：放 2101（箱盖高度 1.875）或 2102（2.9812432788）。

**核心函数**

- `stackOffsetFor(parent, child): number | null`（行 93-102）：child 放 parent 上的 z 偏移；`null = 不允许`。
- `stackBaseFor(buildings, picked, x, y, childItemId)`（行 273-294）：放置时求"堆叠底座"——鼠标所指优先（与游戏一致：光标在建筑上就是往上叠），否则同格内选能承载 childItemId 的**最高**建筑（堆叠列叠到顶）。
- `stackColumn(buildings, building)`（行 300-335）：**自下而上**收集一串堆叠建筑（只跟随 `isStackLink = child.inputObjIdx >= 0 && child.inputToSlot === 14`，不把分拣器连接误当成堆叠）。
- `stackPortDefaults(itemId)`（行 144-159）：未连接时可堆叠建筑的端口默认值（`out=-1/14/15/0 / in=-1/15/14/0`）。**即使不堆叠也必须写**——游戏会把 0 误认为分拣器 slot 0 产生错误连接（create.ts 在 `createBuilding` 里调用）。
- `stackedZ(parent, childItemId)`（行 170-179）：堆叠落位高度 = `parent.z + stackOffsetFor(parent, child)`。
- `stackYawFor(parent, childItemId)`（行 131-138）：长方形底座上长方形上层建筑的朝向要求——**只有 3009+2102 一条**：上层大箱子 yaw = 底座 yaw + 90°。
- `inheritLabSettings(child, parent)`（行 185-195）：研究站堆叠时，子建筑自动继承底座的 `researchMode` 和 `recipeId`（游戏里一列研究站共享设置）。
- `linkStack(child, parent)`（行 198-211）：写入堆叠连接字段。配送器特殊：`inputFromSlot = 13 / inputToSlot = 0`（箱盖接口）；其余：`inputFromSlot = 15 / inputToSlot = 14`。

### beltPorts.ts（参见：src/data/beltPorts.ts）

**BeltPort 接口**（行 30-41）

```typescript
interface BeltPort {
    x: number;     // 口的局部 x（赤道基准）
    y: number;     // 口的局部 y
    z: number;     // 口的高度格（0=地面层）
    nx: number;    // 朝外法线 x（-1/0/1）
    ny: number;    // 朝外法线 y（-1/0/1）
}
```

**已标定的传送带口表**（行 63-158）

| itemId | model | slot 数 | 备注 |
| --- | --- | --- | --- |
| 2020（四向分流器） | 38 十字 / 39 一字 / 40 十字加强 | 各 4 口 | **两层高度**：38 是 0/2 在 z=0、1/3 在 z=1；39 是 0/2 在 z=0、1/3 在 z=1（同面两口一上一下）；40 是 1/3 在 z=0、0/2 在 z=1 |
| 2040（自动集装机） | 257 | 2 口 | 一条输入、一条输出，同格两侧 |
| 2103（物流运输站） | 49 | 12 口 | 12 口环绕环（±y 面各 3 口、±x 面各 3 口） |
| 2104（星际物流运输站） | 50 | 12 口 | 绕向同 2103 但半径略大 |
| 2106（储液罐） | 121 | 4 口 | 四面各一口 |
| 2208（射线接收站） | 73 | 2 口 | 南北各一口 |
| 2209（能量枢纽） | 45 | 4 口 | 四面各一口 |
| 2314（分馏塔） | 119 | 2 口 | 东西各一口 |

**portTables 结构**（行 149-158）：`Record<itemId, Record<modelIndex, BeltPortTable>>` —— 按模型分开（四向分流器三个模型有不同口布局和不同高度层）。

**核心函数**

- `getBeltPorts(itemId, modelIndex?)`（行 188-215）：优先查表 → 查不到退回 `buildingSlots` 同名 slot（法线用面分组）。`fallbackCache` 缓存 fallback 结果。
- `beltPortAt(itemId, modelIndex, slot)`（行 218-225）：取某个 slot 的口；未标定返回 null。
- `nearestBeltPort(itemId, modelIndex, lx, ly, limit)`（行 268-288）：找最近口（点建筑即接最近的口）。
- `pickBeltPort(itemId, modelIndex, lx, ly, lz=0, limit=2.5)`（行 296-323）：**高度层感知**的选口——先按 `|z - lz| ≤ 0.75` 筛同层口，无同层退回全部，再按 xy 距离最近。**用于区分分流器 38 的 z=0 地面口和 z=1 上层口**。

### icons.ts（参见：src/data/icons.ts）

**图标 ID 区间划分**（行 28-50）——**关键约定**（IconTexture、BlueprintEditor.vue、icons 工具链都依赖它）：

| 区间 | 类型 | ID 编码规则 | 来源 |
| --- | --- | --- | --- |
| `< 1000` | 信号图标 | 直接 signalId | `signalIconUrl(signalId)` → `signal-${signalId}.png` |
| `1000 ≤ id < 20000` | 物品图标 | 直接 itemId | `iconUrl(id)` → `item_recipe/{itemsMap.get(id).icon}.png` |
| `20000 ≤ id < 40000` | 配方图标 | recipeId + 20000（仅配方有独立 icon） | `iconUrl(id)` → `item_recipe/{recipesMap.get(id-20000).icon}.png` |
| `40000 ≤ id < 60000` | 科技图标 | techId + 40000 | `iconUrl(id)` → `tech/{techId}.png` |

**辅助函数**

- `itemIconId(itemId)`（行 31-33）：直接返回 itemId（区间 1000-20000）。
- `recipeIconId(recipeId)`（行 34-38）：若配方有独立 icon → `recipeId + 20000`；否则退回 `itemIconId(r.to[0].item.id)`（产品物品图标）。
- `techIconId(techId)`（行 39-41）：`techId + 40000`。
- `iconUrl(iconId)`（行 43-50）：按上述区间 switch → `import(/* webpackMode: "eager" */ ...)` 动态加载 png。
- `allIconIds()` generator（行 52-66）：遍历 itemsMap.values() + recipesMap.values()（仅带独立 icon）+ signal + tech → yield 所有合法 slot id，供 IconTexture 构造时分配槽位。

**关键约束**：区间严格不重叠（1000 一跳），所以 if/else 用 `id < 1000 / id < 20000 / id < 40000 / id < 60000` 顺序判定即可。

### color.ts（参见：src/data/color.ts）

- `colorPalette256: readonly string[]`（行 1-258）：256 色调色板（`#RRGGBBAA` 格式），索引 0 = 全透明，1 = 黑，2 = 白，3-258 为游戏内完整颜色表。`MonitorParameters.passColorId / failColorId`、分拣器 `filterId` 都用此索引。

## 内部关键逻辑

### 数据查找模式

- **itemId 查表**：`Map<itemId, 数据>`（itemsMap / recipesMap / buildingPowerMap / portTables / slotTable）。
- **modelIndex 查表**：某些数据（buildingMeta、portTables）按 modelIndex 存（同款不同 itemId 共用同一选择盒 / 口布局）。
- **itemId → modelIndex → 查**：beltPorts 的 portTables 结构；buildingMeta 也是（key 是 modelIndex，但调用时传 `b.modelIndex`）。
- **alias 表**：`slotAliases` 让不同 itemId 复用 slot 表（避免重复标定）。

### fallback 模式

- `beltPorts.getBeltPorts`：已标定 → 精确表；未标定但有 buildingSlots → 近似（法线用面分组）；都没有 → 空表。
- `parserFor`：已注册 itemId → 精确 ParamParser；未注册 → `unknownParamParser`（字节级原样保留）。
- `defaultParamsFor`：已覆盖 switch → 精确模板；`allAssemblers.has(itemId)` → `assembleParamParser(ExtraOutput)`；都没有 → null。

### x 赤道基准

- buildingSlots / beltPorts / buildingMeta.iconTrans 的 x 坐标都是**赤道基准**（cos(0) 归一化）。经向格宽 ∝ cos(纬度)，所以在 `cos(lat)` 归一化后 x 才能直接与 `buildingMeta.box[0] / slotFaceGroups` 的轴对齐。
- 实际世界坐标转换：`portWorldOffset(port, yawDeg, cosLat)`（beltPorts 行 237-251）：`u = port.x / cosLat`，然后 R(-yaw) 旋转。

## 依赖的其他模块

| 依赖 | 用途 |
| --- | --- |
| `./itemsData` / `./recipesData` / `./signalIconsData` / `./techIconsData` / `./types` | 数据源与 Item / Recipe 类型（本地内部依赖） |
| `@/blueprint/parser` 的 `AllParameters / AllAssemblers 引用（通过 items.allAssemblers 的反向依赖）` | defaultParamsFor / parser 参数类型 |
| `three.Color / Matrix4` | buildingMeta 构建 |
