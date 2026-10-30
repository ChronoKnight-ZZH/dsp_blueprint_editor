# 模块 6：地基系统（reform-system）

## 职责

本模块负责蓝图地基（地形改造 / PlatformSystem）的**渲染构建**与**逐格编辑**，两块职责分属两个文件：

- `reform.ts`：把蓝图的 `BlueprintReformData.rects[]` 展开成逐格数据，用 Three.js 的 InstancedMesh 批量渲染地基格，支持纯色底层 + 装饰金属板覆盖层（工字铺 / 直铺两种纹理）。
- `reformEdit.ts`：地基数据的**就地修改**工具函数与撤销命令。核心语义是"后出现者覆盖"——同一格被多个矩形覆盖时，取最后一个矩形的 type / color。基于这个语义，铺/涂一格只需在 rects 尾部追加一个 1×1 矩形，撤销时弹出。

---

## 关键文件

| 文件 | 用途 |
|---|---|
| `src/blueprint/reform.ts` | 渲染层：expandReformCells / resolveReformColors / buildReforms / Reforms(Group) |
| `src/blueprint/reformEdit.ts` | 编辑层：ensureReformData / cellColorIndex / cellReformType / reformColorHex / pushCellRect / customSlotColor / setCustomSlotColor / PaintReformCellCommand / SetReformCustomColorCommand |

---

## 公开接口

### 常量（两个文件同名同步）

| 名称 | 文件:行号 | 值 | 说明 |
|---|---|---|---|
| `REFORM_TYPE_NONE` | reform.ts:17 | 0 | 无地基，不渲染 |
| `REFORM_TYPE_IBEAM` | reform.ts:19 | 1 | 工字铺（错缝铺设的金属板） |
| `REFORM_TYPE_GRID` | reform.ts:21 / reformEdit.ts:18 | 2 | 直铺（对齐铺设的金属板，编辑新铺格默认） |
| `REFORM_TYPE_PLAIN` | reform.ts:23 | 7 | 无装饰地基（纯色） |
| `DEFAULT_REFORM_COLORS` | reform.ts:35 / reformEdit.ts:25 | 16 个 hex | 游戏内置色板（0..15） |
| `CUSTOM_COLOR_SLOT_BASE` | reformEdit.ts:20 | 16 | 自定义色槽起始索引 |
| `CUSTOM_COLOR_SLOTS` | reformEdit.ts:22 | 16 | 自定义色槽总数（槽 16..31） |

### 工具函数（reformEdit.ts）

| 函数 | 文件:行号 | 说明 |
|---|---|---|
| `ensureReformData(data)` | reformEdit.ts:67 | 蓝图无地基数据时初始化 `{reserved:0, rects:[], customReformColorMask:0, customReformColors:[]}` |
| `cellColorIndex(data, areaIndex, x, y)` | reformEdit.ts:80 | 遍历 rects，返回最后一个覆盖格 (x,y) 的 color 索引；无返回 null |
| `cellReformType(data, areaIndex, x, y)` | reformEdit.ts:104 | 同上，返回 type |
| `reformColorHex(reformData, slot)` | reformEdit.ts:50 | 槽位索引 → 实际 RGB hex；自定义槽未标定时默认白色 |
| `rgbOfHex(hex)` | reformEdit.ts:45 | hex → [R,G,B] 三元组 |
| `pushCellRect(reformData, areaIndex, x, y, colorIndex, type)` | reformEdit.ts:128 | 追加一个 1×1 BlueprintReformRect 到 rects 尾部 |
| `customSlotColor(reformData, slot)` | reformEdit.ts:151 | 读取槽 16..31 的 0xRRGGBBAA；mask 未置位或越界返回 null |
| `setCustomSlotColor(reformData, slot, rgba)` | reformEdit.ts:162 | 写入自定义槽 RGBA 并置位对应 mask 位（`|= 1 << slot`） |

### Command 类

| 类 | 文件:行号 | silent | 说明 |
|---|---|---|---|
| `PaintReformCellCommand` | reformEdit.ts:177 | n/a（只改数据，UI 重建场景） | 铺/涂一格。do：append 1×1 rect；undo：splice(lastIndexOf) |
| `SetReformCustomColorCommand` | reformEdit.ts:219 | n/a | 设置自定义色槽。do 快照旧值 + mask 位；undo 恢复（恢复 customReformColors 数组长度 + mask 位） |

### 渲染函数（reform.ts）

| 类/函数 | 文件:行号 | 说明 |
|---|---|---|
| `Reforms extends Group` | reform.ts:211 | 地基图层容器（纯类型标记，实际场景重建时从父 Group 移除再重建） |
| `buildReforms(R, pos, reformData)` | reform.ts:245 | 核心入口：expandReformCells → resolveReformColors → 每个 cell 一个 InstancedMesh 实例，贴在星球经纬网格表面 |

---

## 内部关键逻辑

### expandReformCells（reform.ts:67）

把 `rects[]` 展开为扁平的逐格列表 `ReformCell[]`。去重键 = `areaIndex × 0x100000000 + ((gx & 0xffff) << 16) + (gy & 0xffff)`（double 安全整数）。遍历 rects 时 `cells.set(key, ...)`，天然实现"后出现者覆盖"。type=0 跳过。

### resolveReformColors（reform.ts:102）

解析 32 个地基颜色槽：
- 槽 0..15 → `DEFAULT_REFORM_COLORS[i]`
- 槽 16..31 → 先查 `customReformColorMask` 对应位是否置位（`(mask >>> i) & 1`），置位则从 `customReformColors[i - 16]` 取 `0xRRGGBBAA`，右移 8 位取 RGB（`(v >>> 8) & 0xffffff`）
- 未置位的自定义槽 → 默认白色

返回 `Color[]` 数组（Three.js Color 对象）。

### buildReforms（reform.ts:245）

逐 cell 构建 InstancedMatrix：
1. 经纬度 → Euler(-latitude, longitude, 0, "YXZ") → 绕轴旋转矩阵
2. `makeTranslation(0, 0, R + REFORM_LIFT)` → 抬升到地表（REFORM_LIFT=0.015，介于地表与经纬网格线之间）
3. `makeScale(R × longitudeGridSize × cos(latitude) × TILE_SCALE, R × latitudeGridSize × TILE_SCALE, 1)` —— 高纬经度方向按 cos(latitude) 收缩，TILE_SCALE=0.985 内缩避免相邻格共边闪烁

三种网格层：
- baseMesh（纯色底层，全 cells）
- ibeamMesh（工字铺装饰层，仅 IBEAM 类型）
- gridMesh（直铺装饰层，仅 GRID 类型）

关闭 frustumCulled（包围球跨整个星球，近景浏览时不被视锥剔除）。

### 纹理生成（reform.ts:124-205）

`createPlateTexture(pattern)` 在离屏 Canvas(128×128) 上绘制：
- 金属板纹理（`drawMetalPlate`）：白底梯度 + 左上高光右下阴影 + 四角铆钉
- 工字铺纹理（`drawIBeamPattern`）：4 行×2 列跑砖排列（行偏移 brickW/2），可无缝拼接
- 直铺纹理（`drawGridPattern`）：2×2 对齐金属板

材质 metalness=0.2 / roughness=0.5（低 metalness 避免场景无环境贴图时金属反射压低漫反射使地基发暗）。

### PaintReformCellCommand（reformEdit.ts:177）

构造函数接收 `(areaIndex, x, y, colorIndex)`。do 时：
1. ensureReformData 确保 rects 存在
2. cellReformType 查该格当前装饰类型 —— **若已有地基则维持原 type，新铺格用 REFORM_TYPE_GRID=2**
3. pushCellRect 追加 1×1 矩形

undo 时通过 `lastIndexOf(this.rect)` 定位并 splice 移除。选 lastIndexOf 而非数组索引，是为了支持同格被多次覆盖的场景（多次涂抹同格时，每次 undo 只移除最顶层那层）。

### SetReformCustomColorCommand（reformEdit.ts:219）

撤销逻辑比看起来复杂：
- prev 可能为 null（之前未使用该槽）→ undo 时需 splice 从 `customReformColors` 数组中移除该项
- mask 位可能之前未置位 → undo 时需清除 `(mask & ~(1 << slot)) >>> 0`
- 恢复时 customReformColors 数组长度可能变短（prev=null → splice），所以不能假设数组长度不变

---

## 依赖的其他模块

| 依赖 | 用途 |
|---|---|
| `@/blueprint/parser` | BlueprintReformData / BlueprintReformRect |
| `@/blueprint/planet` | PositionedBlueprint（buildReforms 的 posBP 入参） |
| `@/command` | Command 接口（PaintReformCellCommand / SetReformCustomColorCommand） |
| `three` | Color / Group / InstancedMesh / PlaneGeometry / MeshLambertMaterial / MeshStandardMaterial / Matrix4 / Euler / SRGBColorSpace / CanvasTexture |
| `@/components/BlueprintEditor.vue` | 调用 buildReforms，场景重建时从父 Group 移除旧 Reforms 实例 |

### 反向依赖（谁依赖本模块）

| 使用者 | 用途 |
|---|---|
| `src/blueprint/reformImage.ts`（模块 7） | 从 reformEdit.ts 导入 ensureReformData / DEFAULT_REFORM_COLORS / REFORM_TYPE_GRID / CUSTOM_COLOR_SLOT_BASE / CUSTOM_COLOR_SLOTS / rgbOfHex |
| `src/components/ReformColorDialog.vue` | 渲染自定义色槽面板，点击色槽触发 SetReformCustomColorCommand |
| `src/components/BlueprintEditor.vue`（:643） | 导入 PaintReformCellCommand / reformColorHex，处理铺地基交互 |
| `src/data/builderInfo.ts` | 可能引用地基类型做分类 |
