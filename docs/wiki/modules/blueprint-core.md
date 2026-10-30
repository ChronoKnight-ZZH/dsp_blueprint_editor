# 模块：blueprint-core —— 蓝图解析核心

## 职责概述

负责二进制蓝图的**读/写/校验**与**星球坐标几何**两大块：
- **编解码**：把游戏的 `BLUEPRINT:` 字符串头部 + gzip(DataView) body 还原成 TypeScript 结构体（`BlueprintData`），以及反向导出。
- **星球几何**：把蓝图里的"区域局部格 (x, y) + 区域元数据 (areaSegments / tropicAnchor / anchorLocalOffset)"转换成星球表面的经纬度和三维 Matrix4 变换矩阵。
- **归一化**：导出时自动把编辑器画布（一条纬度带一个区域）收缩到紧贴实际建筑边界的区域（`normalizeBlueprintAreas`），与游戏原生蓝图一致。
- **全球画布**：编辑器坐标空间覆盖整颗星球 —— 一条纬度带一个区域（`globe.ts`），任意纬度都能放置建筑，导出时再按带拆/合区域。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/blueprint/parser.ts` | 编解码主文件（1584 行），含 header / meta / areas / buildings / parameters / v2 tail 的完整读写 |
| `src/blueprint/md5.ts` | 纯 JS MD5（235 行），蓝图尾部 32 位 hex 校验和 |
| `src/blueprint/planet.ts` | 星球几何（segmentArr / findPosForAreas / calcBuildingTrans），247 行 |
| `src/blueprint/globe.ts` | **全球画布**：纬度带表 → 区域按需生成 / 放置目标 / 展开与收缩的基础换算 |
| `src/blueprint/area.ts` | 区域局部格 ↔ 星球全局格换算（再导出 globe）+ 导出前区域归一化 |

## 公开接口

### parser.ts（参见：src/blueprint/parser.ts）

**顶层函数**

- `fromStr(strData: string): BlueprintData`（行 1412-1490）：解析游戏字符串蓝图。校验头部 `BLUEPRINT:` 前缀、base64 解码、gunzip 解压、MD5 校验和比对、按 `meta.version` 分流 v1 / v2 body。
- `toStr(bp: BlueprintData): string`（行 1516-1584）：导出为游戏字符串。先 `normalizeBlueprintAreas` 归一化根区域，再写 gzip 压缩 + base64，最后拼接 MD5 hex 校验和。
- `encodedSize(bp: BlueprintData): number`（行 1492-1514）：预计算 body 字节数，供 `BufferWriter` 分配准确 `Uint8Array`。
- `parserFor(itemId: number)`（行 1028-1032）：查表返回该建筑对应的 `ParamParser`；未注册返回 `unknownParamParser`。
- `angleDiffDeg(a, b)`（行 1080-1082）：两角度最小夹角（度数），v2 分拣器坏数据自愈使用。

**常量 / 注册表**（行 1074-1026）

- `V2_RECORD_MARKER = -102`：v2 建筑记录起始标记（导出版本）。
- `V2_RECORD_MARKER_MIN = -100`：导入接受的下限（兼容 0.10.33 的 -101 与 0.10.34 的 -102）。
- `V2_BELT_ITEM_IDS = Set(2001,2002,2003)`：传送带，记录里多写一个 `tilt` 字段。
- `parameterParsers = Map<itemId, ParamParser>`（行 998-1022）：itemId → ParamParser 注册表；循环 `allAssemblers` 为所有制造台/熔炉等默认挂 `assembleParamParser`（行 1023-1026）。

**V1 / V2 分流的关键辅助函数**

- `isV2RecordMarkerAt(bytes, off)`（行 1084-1095）：通过 8 字节小端 int32 快速定位下一条 v2 建筑记录的边界（容错：中间可能有未知扩展间隙）。
- `importBuildingV2(r, bytes, last)`（行 1097-1191）：v2 建筑 body 解析，分拣器额外读 7 个 float 第二姿态 `v2ExtraPose`（含尖端 tip / 基准朝向 / tip yaw）。
- `exportBuildingV2(w, b)`（行 1257-1324）：v2 导出，强制写 `V2_RECORD_MARKER` 起始标记。
- `importTailV2(r, bodyEnd)`（行 1395-1407）：body 尾部 `patch(int32)` + `reformDataFlag(u8)` + `importReformData`（地基 rects + custom colors）。
- `importReformData(r)`（行 1336-1371）：地基数据解析；9 字节/rect（reserved + 2×int16 + 2×uint8 + 1×data + areaIndex）。

**各建筑 ParamParser**（行 394-977）

| 函数 / 对象 | 适用 itemId | encodedSize（Int32 槽数） | 备注 |
| --- | --- | --- | --- |
| `stationParamsParser(desc)` | 2103 / 2104 | 2048 | 物流站：storage(6 stride, 最多 5 个) + slots(4 stride, 12 个) + workEnergy 等基础字段 |
| `advancedMiningMachineParamParser()` | 2316 | 2048 | 继承 station + `miningSpeed` 字段（index 9） |
| `splitterParamParser` | 2020 | v2→6 / v1→4 | 四向分流器：4 优先级布尔 + v2 额外 2 int 未知字段 |
| `labParamParser` | 2901 / 2902 | 2 | 研究站：`researchMode` + `acceleratorMode` |
| `assembleParamParser` | 所有制造台等（循环 allAssemblers） | 1 | 仅 `acceleratorMode` |
| `beltParamParser` | 2001 / 2002 / 2003 | 2 | 传送带：`iconId` + `count` |
| `inserterParamParser` | 2011-2014 | 1 | 分拣器：`length` |
| `storageParamParser(size)` | 2101(30) / 2102(60) | ≥110 | 储物仓 / 储液罐：`automationLimit` + `type` + `grids[]` |
| `tankParamParser` | 2106 | 2 | 储液罐：`output` + `input` |
| `MonitorParamParser` | 2030 | 128 | 流速监测器：21 个字段（targetBeltId / offset / passColorId / 音量 / 落色半径 …） |
| `battleBaseParamParser()` | 3009 | 110 | 战场基站：继承 storage + 7 个战斗字段 + 12 个 fighters |
| `dispenserParamParser` | 2107 | 128 | 物流配送器：4 个字段 |
| `ejectorParamParser` | 2311 | 2 | 电磁轨道弹射器 |
| `unknownParamParser` | 未注册 itemId | `parameters.length` | 字节级原样保留 |

**BufferIO 类**（行 107-244）

- `BufferReader extends BufferIO`：提供 `getUint8/getInt8/getInt16/getInt32/getUint32/getFloat32/getString`（.NET 风格 7-bit 长度前缀 UTF-8）。
- `BufferWriter extends BufferIO`：对应的 set 族 + `setString`。

**类型接口**（行 6-105）

- `BlueprintArea`（行 6-19）：区域元数据——`index / parentIndex / tropicAnchor / areaSegments / anchorLocalOffset / size`。
- `BlueprintBuilding`（行 26-51）：含 `index / areaIndex / localOffset[2]（起/止点 xyz） / yaw[2] / tilt / itemId / modelIndex / outputObjIdx / inputObjIdx / outputToSlot / inputFromSlot / outputFromSlot / inputToSlot / outputOffset / inputOffset / recipeId / filterId / parameters / v2ExtraPose? / content? / extraBytes?`。
- `BlueprintReformRect`（行 54-66）：地基矩形区域，9 字节/rect。
- `BlueprintData`（行 77-105）：整份蓝图——`header / version / cursorOffset / dragBoxSize / primaryAreaIdx / areas / buildings / patch? / reformData? / tailExtraBytes?`。

### md5.ts（参见：src/blueprint/md5.ts）

- `digest(data: ArrayBuffer): ArrayBuffer`（行 202-235）：纯 JS MD5 实现，返回 16 字节 ArrayBuffer。蓝图尾部使用 `hex(digest(...))` 转成 32 位大写 hex 字符串。内部包含标准的 `K` 表（64 个常量，行 1-66）、`S` 旋转表（行 68-133）、`INIT_MD5F` 初始 4 个 int32（行 135-154）、`updateBlock(s, buf)` 64 轮 round（行 162-198）。

### planet.ts（参见：src/blueprint/planet.ts）

- `calcLatitudeSeg(seg, maxSegment=200)`（行 29-33）：经向段 → 纬向格子数（`ceil(acos(seg/max) / (2π/max))`）。
- `hasPlanetBand(segment)` / `planetBandGridRange(segment, maxSegment=200)`：某经向段数对应的**原始纬度带**（绝对纬向格口径，`纬度段数 × 5`）。赤道带 200 段 → `{lo:-80, hi:80, center:0}`（161 格），160 段 → `{lo:80, hi:130, center:105}`；区域的 `areaSegments` 决定它落在哪条带。
- `PLANET_SEGMENTS`：本星球全部合法 `areaSegments`（200/160/120/100/80/60/40/32/20/16/8/4，从赤道到极区）。
- `planetBands(maxSegment=200): PlanetBand[]`：**全球纬度带表**（南北对称）。`PlanetBand = { segment, hemisphere(0=赤道带/1 北/-1 南), rowLo, rowHi }`。赤道带取 `[-80, 80]`（161 行，正是游戏整赤道带蓝图 `size.y`），其余每条带取 `[lo+1, hi]` 去掉与相邻带共享的边界行 → 北半球 81..250、南半球 -250..-81 **逐行无重叠**，任意一行唯一属于一条带。
- `bandOfRow(row)` / `bandBySegment(segment, hemisphere)` / `bandSpan(band)` / `planetRowLimit()`：行 → 带、段数+半球 → 带、整带高度、星球行上限（250）。
- `gridAreas(segment=200)`（行 49-62，generator）：遍历星球所有分区（含赤道穿越分区，latitudeSeg 取负）。
- `findPosForAreas(areas, segment=200): PositionedBlueprint`（行 95-211）：根据区域树（parentIndex 邻接表）求各区域的经纬度。先求经度（LCM 约束 tropicAnchor/anchorLocalOffset），再求根纬度（按最小经向段 → 高 / 低 热带 + 半球判定），最后自上而下推子区域 `latitude = parent.latitude + child.anchorLocalOffset.y`。
- `calcBuildingTrans(R, pos, building)`（行 218-247）：建筑 → 两个 Matrix4（起点、终点）。经向格宽 ∝ cos(纬度)；`HEIGHT_GRID_SIZE = 4/3`（分流器上下层口差 1 格 ≈ 1.33 单位）。
- 常量：`segmentArr`（行 4-19）：14 段星球分区表——从 `[0,1]`（极区，极短纬度）到 `[Infinity,Infinity]`（根分区），每段的经向段数决定网格宽度。
- 常量：`GRID_PER_SEGMENT = 5`（行 27）：每段 5 格，全根圈 200×5=1000 格。

### area.ts（参见：src/blueprint/area.ts）

- 坐标换算（`planetToLocal` / `localToPlanet` / `AreaGridOrigin`）已迁到 `globe.ts`，`area.ts` 只做再导出以保持既有 import 路径。换算必须传入 `AreaGridOrigin`（含 `latitude / longitude / segment`）：原点纬度不是固定 -80，经向还要按 `segment/200` 缩放并用 `segment×5` 回绕。
- `normalizeBlueprintAreas(bp)`：**导出前自动调用**（`parser.toStr`），把编辑画布收缩回游戏惯例的紧凑区域，详见下方"全球画布与区域模型"。

### globe.ts（参见：src/blueprint/globe.ts，全球画布）

- `canvasOrigin(band)` / `canvasTargetAt(bp, pos, row, lonGrid)`：行星行 + 全局经向格 → **放置目标**（纬度带 + 该带区域 + 区域局部格）。区域还没建时返回规范布局的虚拟原点（`areaIndex=-1`），所以绿盒预览与落位不会错开。
- `ensureCanvasArea(bp, band)`：按需补出某条带的区域（已有同段数同半球区域则复用/平移到规范行，否则以"同半球段数更大的最近带"或赤道带为父新建），整带高度 = `bandSpan(band)`。
- `moveArea(bp, pos, areaIndex, newLat)`：平移区域纬度，同时把该区域建筑与直接子区域锚点反向补偿，**绝对位置不变**。
- `expandToGlobalCanvas(bp)`：进编辑器时把任意蓝图展开成全球画布（赤道带为根 + 每条用到的带一个区域）。建筑/地基的绝对纬度与经线一格不动，只改写局部坐标与 `areaIndex`；置 `bp.canvasExpanded = true`。
- `mapBuildingPoints(b, areaIndex, mapPoint)`：逐点重写建筑局部格并同步重建分拣器尖端姿态（`v2ExtraPose`）。**`mapPoint` 必须返回带 `z` 的点**（见下方"换区域时只能改经纬格"）；`area.ts` 的收缩与 `globe.ts` 的展开共用它，避免两处各写一遍再各漏一次。
- `collectCanvasContent(bp, pos)` / `bandBBox` / `bandColumnRanges` / `splitRectToBands`：把建筑端点与地基矩形换算成"绝对行 + 带内列"并按带聚合（跨带/跨经线的地基矩形会被拆块）。

## 全球画布与区域模型（一条纬度带 = 一个区域）

### 结论：一个 blueprint area 不能跨纬度带

- 区域的经向分辨率只由 `areaSegments` 描述，而 `segmentArr` 把整颗星球按段数切成
  200/160/120/…/4 段的若干**纬度带**（`gridAreas` 画的就是这些带）。同一个区域里不可能
  一半用 200 段、一半用 160 段的网格，所以**一个区域只能落在一条带里**。
- `findPosForAreas` 进一步把这个模型写死：子区域 `areaSegments` 必须**严格小于**父区域
  （相等直接抛 `Area N has the same segments as its parent`），纬度靠
  `latitude = parent.latitude + anchorLocalOffset.y` 递推，经度靠
  `anchor = parent.longitude + tropicAnchor` 与 `anchorLocalOffset.x` 对齐（要求
  `anchor % gridSize[child] === 0`）。
- 游戏自己导出的跨带蓝图正是这么做的：赤道带 `size.y=161` 的根区域 + 每个用到的带一个子区域，
  `anchorLocalOffset.y` 取 `81−(−80)=161`、`−130−(−80)=−50` 这类的带间行差。

因此「全球任意位置放置」= 蓝图里**一条带一个区域**；不能靠把某个区域 `size.y` 撑大解决
（撑大只会让原点纬度沿带内漂移，仍然出不了那条带）。

### 画布布局（`globe.ts`）

- **根区域恒为赤道带**（`areaSegments=200`、`size.y=161`）：`findPosForAreas` 在"居中"与
  "贴边"两种推法下都解出纬度 `-80`，位置稳定，适合当全星球的锚点。
- 其余每条用到的带一个区域：`areaSegments` = 该带段数，`size.y` = 整带高度
  （`bandSpan`，赤道带 161 / 160 段带 50 / 120 段带 25 / …），于是带内任意一行都能放建筑，
  不必再挪区域。
- 所有区域**原点经度恒为 0**（`tropicAnchor=0`、`anchorLocalOffset.x=0`）：每条带的第 0 列
  落在同一条经线上，局部格 x 就是该带经向列（`0..5×段数`），`findPosForAreas` 解出的经度也恒为 0。
- 子区域挂到"同半球里段数更大的最近一条带"（没有就挂根区域），
  `anchorLocalOffset.y = 本带首行 − 父区域纬度`。
- 规范化行的划分保证**行不重叠**：赤道带 `[-80,80]`，北 160 段带 `[81,130]`，南 160 段带
  `[-130,-81]`，一直铺到 ±250，`bandOfRow(row)` 因此能唯一确定目标带。

### 放置判据 / 绿盒 / 地基 / 传送带

- 放置判据：光标命中星球 → 绝对纬度行 `row`（吸附时取 `floor`）→ `bandOfRow(row)` 得到带 →
  `canvasTargetAt` 得到该带区域的局部格 `(x, y)`（区域还没建就用规范布局的虚拟原点）。
  合法条件只有"`row` 在星球行范围内"，不再有 ±80 行的限制。
- 绿盒预览：用同一个 `canvasTargetAt` 得到的区域原点做 `calcBuildingTrans`（`syntheticPos`），
  区域还没建也能正确显示，落位后与真实区域完全一致。
- 地基：`PaintReformCellCommand(areaIndex, x, y, slot)`，矩形带 `areaIndex`；渲染层
  `buildReforms` 本来就按 `pos.areas[cell.areaIndex]` 取定位，天然支持多区域。
- 传送带：A 点按下时确定整条带所属区域（口 → 该建筑的区域；空格 → 该纬度带的区域），
  路径按该区域格数（`areaGridSize(segment)`，赤道 1000 / 160 段带 800 …）回绕，越出带边界的部分
  在边界处截断（一个建筑只有一个 `areaIndex`，一条带不能跨带）。
- 分拣器：两端必须落在同一区域（否则忽略），命令把 `areaIndex` 写进建筑。

### 导出（`normalizeBlueprintAreas`）

- **只用了一条带** → 导出**单个区域**：紧凑边界框（x 用环形最小覆盖弧 + 左右各 1 格，
  y 在"居中"约束下取能覆盖内容的最小偶数/奇数高度）。这种蓝图在游戏里可以整带移动。
- **跨多条带** → 赤道带为根（整带高度，纬度恒 -80）+ 每条带一个区域（链式锚点）：
  - 内容跨南北半球（或有赤道带内容）→ 必须有赤道带根区域（即使没有建筑），否则南北同段数的
    两个区域互相无法挂载；
  - 内容只在单侧 → 根 = 该侧段数最大的带，纬度按 `rawHi − size.y + 1`（北）或 `−rawHi`（南）
    贴边定位，尺寸延伸到带边。
  多带蓝图的绝对纬度由区域元数据唯一确定（每条带只能占自己的行），所以它在游戏里只能贴在
  导出时的纬度上 —— 这正是"全球任意位置放置"的语义。
- 纯导入、没进过编辑器的蓝图不做任何改动（`dragBoxSize != 0` 且没有 `canvasExpanded`），
  保持字节级 round-trip；进过编辑器（或新建画布有建筑）则收缩。

### 换区域时只能改经纬格：`z`（高度格）必须原样保留

建筑端点 `localOffset[i] = {x, y, z}` 里，`x / y` 是**区域局部**的经纬格（换区域要重算），
`z` 是**高度格**（堆叠层、分拣器尖端高度，`HEIGHT_GRID_SIZE = 4/3` 单位/格），跟区域无关。
所以任何"换区域"的换算（`expandToGlobalCanvas` 展开、`normalizeBlueprintAreas` 收缩、
`moveArea` 平移）都必须是"经纬格重算 + `z` 原样搬运"。

丢 `z` 的后果不是报错而是**整层静默消失**：`calcBuildingTrans` 里
`height = R + localOffset[i].z * HEIGHT_GRID_SIZE` 得到 `R + undefined = NaN`，两个端点的
矩阵全变 NaN，three.js 画不出来；BVH 会把这种盒当无效盒跳过（拾取也一起失效）；更糟的是
`toStr` 会把 NaN 写回蓝图，于是**退出编辑模式也恢复不了**。

配套防线（`editor/scene.ts`）：

- `buildSceneData` 逐建筑兜底：区域下标越界 / 坐标非有限 → 只让**这个建筑**退化（零尺寸矩阵），
  其余照常渲染；只有 `z` 非有限时按地面高度重算（`repairedBuildings` 记录），宁可矮一点也不消失。
- 场景重建是"先构建、后替换"（`rebuildScene`）：构建抛错时旧模型继续留在场景里，
  而不是"旧模型已移除、新模型没加入"的空场景。
- 未知 `modelIndex`（游戏新版本 / mod）不再用 `!` 断言：选择盒退化为建筑自身盒、颜色用中性灰，
  避免一个未知建筑把整次重建打挂。

### 已知限制

- 每个区域的 `size.x` 从第 0 列起增长，内容贴近 0 经线（列号很大）时导出区域会偏宽
  （单带蓝图会按环形最小弧重排，多带蓝图不做旋转）。
- 一条传送带/分拣器不能跨纬度带（格式上一个建筑只有一个 `areaIndex`）。
- 内容正好落在带边界行时按 `bandOfRow`（高纬那条带）归属；若原区域用的是另一条带的网格，
  局部 x 会是分数（游戏可能拒绝该建筑）。
- 极点附近（`segment=4` 带）网格极窄，`calcBuildingTrans` 的 `cos(纬度)` 会让模型明显收缩，
  这是既有渲染行为。
## 内部关键逻辑

### 蓝图字符串格式

```
BLUEPRINT:{headerV1,layout,icons[5],0,timeMs,gameVersion,shortDesc[,author,blueprintVersion,properties],desc}"{base64(gzip(body))}"{MD5 hex}
```
- `START = "BLUEPRINT:"`（parser.ts 行 1409）
- headerFormatV2：`cells[0] === "1"` → 15 字段（含 author/blueprintVersion/properties），否则 12 字段（行 1418）。
- MD5 对 `"BLUEPRINT:...desc}"` 部分做 digest（不含 base64 body 与末尾 hex）。

### Body 二进制布局（v2）

```
version int32
cursorOffset int32×2
cursorTargetArea int32
dragBoxSize int32×2
primaryAreaIdx int32
numAreas uint8
  for area: 14 bytes (index:int8, parent:int8, tropicAnchor:int16, areaSegments:int16, anchorLocalOffset:int16×2, size:int16×2)
numBuildings int32
  for building: 每条以 V2_RECORD_MARKER(-102) 开头，后接 index / itemId / modelIndex / areaIndex / xyz / yaw / [tilt] / [v2ExtraPose 7 float] ... 到 content 段
patch int32
reformDataFlag uint8
  if flag: importReformData()
tailExtraBytes (0.10.33 预留 5 字节等未知尾巴)
```

### V2_RECORD_GAP_LIMIT = 64

v2 body 每条建筑记录"已知字段结束"到"下一记录起始标记"之间允许存在不超过 64 字节的未知扩展间隙（`extraBytes`），用于兼容未来版本。

## 依赖的其他模块

| 依赖 | 用途 |
| --- | --- |
| `@/data/items` 的 `allAssemblers` | 为制造台 / 熔炉 / 对撞机 / 研究站等循环注册 ParamParser（parser.ts 行 1023-1026） |
| `@/blueprint/area` 的 `normalizeBlueprintAreas` | 导出前自动归一化（parser.ts 行 1518 调用） |
| `pako` | gzip / gunzip（parser.ts 行 2） |
| `three` 的 `Euler / Matrix4` | 星球坐标 → 世界 Matrix4 变换（planet.ts 行 1） |
