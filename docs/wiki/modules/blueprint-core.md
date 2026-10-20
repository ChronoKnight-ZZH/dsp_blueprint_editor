# 模块：blueprint-core —— 蓝图解析核心

## 职责概述

负责二进制蓝图的**读/写/校验**与**星球坐标几何**两大块：
- **编解码**：把游戏的 `BLUEPRINT:` 字符串头部 + gzip(DataView) body 还原成 TypeScript 结构体（`BlueprintData`），以及反向导出。
- **星球几何**：把蓝图里的"区域局部格 (x, y) + 区域元数据 (areaSegments / tropicAnchor / anchorLocalOffset)"转换成星球表面的经纬度和三维 Matrix4 变换矩阵。
- **归一化**：导出时自动把编辑器画布的"松散根区域"收缩到紧贴实际建筑边界（`normalizeBlueprintAreas`），与游戏原生蓝图一致。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/blueprint/parser.ts` | 编解码主文件（1584 行），含 header / meta / areas / buildings / parameters / v2 tail 的完整读写 |
| `src/blueprint/md5.ts` | 纯 JS MD5（235 行），蓝图尾部 32 位 hex 校验和 |
| `src/blueprint/planet.ts` | 星球几何（segmentArr / findPosForAreas / calcBuildingTrans），247 行 |
| `src/blueprint/area.ts` | 区域局部格 ↔ 星球全局格换算 & 导出时根区域归一化，182 行 |

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
- `gridAreas(segment=200)`（行 49-62，generator）：遍历星球所有分区（含赤道穿越分区，latitudeSeg 取负）。
- `findPosForAreas(areas, segment=200): PositionedBlueprint`（行 95-211）：根据区域树（parentIndex 邻接表）求各区域的经纬度。先求经度（LCM 约束 tropicAnchor/anchorLocalOffset），再求根纬度（按最小经向段 → 高 / 低 热带 + 半球判定），最后自上而下推子区域 `latitude = parent.latitude + child.anchorLocalOffset.y`。
- `calcBuildingTrans(R, pos, building)`（行 218-247）：建筑 → 两个 Matrix4（起点、终点）。经向格宽 ∝ cos(纬度)；`HEIGHT_GRID_SIZE = 4/3`（分流器上下层口差 1 格 ≈ 1.33 单位）。
- 常量：`segmentArr`（行 4-19）：14 段星球分区表——从 `[0,1]`（极区，极短纬度）到 `[Infinity,Infinity]`（根分区），每段的经向段数决定网格宽度。
- 常量：`GRID_PER_SEGMENT = 5`（行 27）：每段 5 格，全根圈 200×5=1000 格。

### area.ts（参见：src/blueprint/area.ts）

- `planetToLocal(latGrid, lonGrid, area: AreaGridOrigin)`（行 37-48）：星球全局格（纬向全星球 1000 格 / 经向赤道 1000 格） → 区域局部格 x / y。必须传入 `AreaGridOrigin`（含 `latitude / longitude / segment`），根区域原点纬度不是固定 -80（工具自建画布恰好 -80，导入蓝图由 `findPosForAreas` 算出）。
- `localToPlanet(offset, area)`（行 53-64）：`planetToLocal` 逆变换。
- `ensureAreaFor(bp, offset)`（行 70-80）：放置时确保根区域 size.x 覆盖 offset（超出则自动扩张），返回 areaIndex（始终 0）；纬向 / 赤道带外返回 -1。
- `normalizeBlueprintAreas(bp)`（行 95-182）：**导出前自动调用**。仅在"单根区域 + 非游戏画布（dragBoxSize 为 0）+ 无 reformData"时生效。根区域收缩为覆盖所有建筑的最小环形弧（x：最大间隙的补集 + 左右各留一格边距）与最小高度带（y：`2*needLo` / `2*needHi-1` 取大），所有建筑坐标平移到新原点。**关键**：分拣器的 `v2ExtraPose` 除尖端坐标外还带姿态角（`pose[4] = yaw[0]、pose[5] = tilt`），不能丢弃。

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
