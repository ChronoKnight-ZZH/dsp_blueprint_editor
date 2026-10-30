# 模块 7：照片转蓝图（image-to-blueprint）

## 职责

本模块提供 **"照片 → 地基蓝图"** 一键转换能力。用户选择一张本地图片（Blob 或 URL），模块把它缩放到 160 行固定高度、旋转 180°、中位切分量化到 ≤16 个自定义颜色槽、run-length + 纵向合并成地基矩形数组，最终产出一个完整的 BlueprintData（含 BlueprintReformData）。

核心管线：

```
loadPhotoImage → 160×cols Canvas(180°旋转)
    → getImageData (RGBA8)
    → buildBlueprintFromPixels
        → medianCutQuantize 自定义色槽
        → nearestIndex 匹配 16内置+N自定义 调色板
        → buildRectsFromSlots 生成 rects[]
        → 组装 BlueprintData + customReformColors + mask
```

---

## 关键文件

| 文件 | 用途 |
|---|---|
| `src/blueprint/reformImage.ts` | 全部逻辑；纯函数可在 Node 测试环境运行 |

---

## 公开接口

### 常量

| 名称 | 文件:行号 | 值 | 说明 |
|---|---|---|---|
| `PHOTO_ROWS` | reformImage.ts:31 | 160 | 输出蓝图固定行数（赤道带正向对齐上限 161 内选取） |
| `PHOTO_MAX_WIDTH` | reformImage.ts:29 | 1000 | 输出列数上限（原赤道整圈 200 段 × 5 格/段）；超宽时取水平中央条带 |

### 核心函数

| 函数 | 文件:行号 | 说明 |
|---|---|---|
| `photoToBlueprint(source)` | reformImage.ts:312 | **一键入口**：loadPhotoImage → getImageData → buildBlueprintFromPixels |
| `loadPhotoImage(source)` | reformImage.ts:266 | 加载图片到 160 行画布；scale=PHOTO_ROWS/h、cols=min(1000, round(w×scale))；translate+scale(-1,-1) 实现 180° 旋转 |
| `buildBlueprintFromPixels(pixels, width, height)` | reformImage.ts:219 | RGBA8 → 调色板匹配 → rects → 完整 BlueprintData |
| `medianCutQuantize(unique, freqs, target)` | reformImage.ts:62 | 中位切分量化：按频率加权，每次切通道范围最大的 box，每盒取加权平均色 |
| `buildRectsFromSlots(slotsPerCell, width, height)` | reformImage.ts:159 | 每格槽位索引 → BlueprintReformRect[]；行内 run-length + 纵向同 x/w/slot 合并；w/h 上限 255（游戏 u8） |

---

## 内部关键逻辑

### 颜色槽分配策略（buildBlueprintFromPixels :234-239）

蓝图地基每格颜色只能存 5-bit 索引（0..31）。16 个槽是**游戏内置固定色板**（0..15，DEFAULT_REFORM_COLORS），16 个槽是**自定义 RGBA 色**（16..31）。

模块的分配策略：
1. **自定义槽**：对图片唯一颜色做 `medianCutQuantize(unique, freqs, CUSTOM_COLOR_SLOTS=16)`，得到最多 16 个代表色，**全部写入槽 16..31**
2. **匹配**：对每个像素，在 `palette = [...BUILTIN_RGB, ...customColors]`（最多 32 色）里找欧氏距离最近的颜色，返回 0..31 索引

这样做的好处：游戏内置色板是为了"游戏 UI 上也能直接用"，中位切分代表色写进自定义槽后，蓝图本身是自包含的——即使游戏在该版本色板不同，蓝图携带的 customReformColors 仍能精确复现原图色调。

### medianCutQuantize（:62-152）

经典中位切分算法，本实现细节：
- **加权中位数**（而非简单中位数）：`splitAt` 由频率累计过半决定（`half = total/2`，`acc += weights[order[j]]` 直到 acc ≥ half）。这让高频色被分到自身盒子的概率更高。
- **通道选择**：每次切分选通道值范围最大的 box（遍历所有 box × 所有 3 通道，取 range 最大者）。
- **终止条件**：boxes.length === target 或无可切分（bestIdx === -1）。
- **输出**：每盒取加权平均色 `(Σ color[i] × weight[i]) / Σ weight`。

### buildRectsFromSlots（:159-213）

`slotsPerCell` 是一维 `Uint8Array`（行优先）。两阶段合并：

1. **行内 run-length**：从左到右，同色连续格合并。`w < 255` 截断（游戏格式 w 为 u8）。
2. **纵向合并**：用 `open: Map<"x|w|slot", rectIndex>` 维护当前开放矩形。下一行同 `(x, w, slot)` 命中时：
   - 若 `r.y + r.h === y && r.h < 255`（上一行是紧接的同色矩形，且 h 未达上限）→ `r.h++`
   - 否则：当前 rect 已完整，push 新的 1×1 rect 并 reset open

`w/h` 上限 255 的截断逻辑在行内 while 循环和纵向 h++ 时各检查一次。

### loadPhotoImage（:266-309）

图片加载→Canvas→处理管线：

```typescript
scale = PHOTO_ROWS / Math.max(1, img.naturalHeight)   // 锁定 160 行
cols  = Math.min(PHOTO_MAX_WIDTH, Math.round(img.naturalWidth * scale))
srcW  = cols / scale                                  // 原图被采样的宽度
srcX  = Math.max(0, (img.naturalWidth - srcW) / 2)   // 水平中央条带起点
```

180° 旋转实现（:292-293）：
```typescript
ctx.translate(canvas.width, canvas.height);  // 平移到右下角
ctx.scale(-1, -1);                           // 镜像变换
```
这等效于"上下翻转 + 左右翻转" = 180° 旋转。为什么需要旋转？因为星球坐标的 y=0（最北）对齐图片的最后一行——如果不旋转，图片顶部会被放到星球最南。

### buildBlueprintFromPixels（:219-263）

组装 BlueprintData 的步骤：
1. `createEmptyBlueprint()` 创建基础蓝图（header / areas / dragBoxSize / cursorOffset 已初始化为默认值）
2. `bp.areas[0].size = { x: width, y: height }` —— 把赤道带尺寸设为图片尺寸
3. `bp.cursorOffset = { x: floor(width/2), y: floor(height/2) }` —— 光标居中
4. `bp.dragBoxSize = { x: width, y: height }` —— 拖拽框覆盖整张图
5. **customReformColors 编码**：每个代表色 → `((c[0]<<24) | (c[1]<<16) | (c[2]<<8) | 0xff) >>> 0`。高位 R，低位 alpha，右移 8 位取 RGB 用于渲染层。
6. **customReformColorMask**：对每个使用到的自定义槽位（从 CUSTOM_COLOR_SLOT_BASE 起）置位：`mask |= 1 << (CUSTOM_COLOR_SLOT_BASE + k)`。
7. `while (rd.customReformColors.length < CUSTOM_COLOR_SLOTS) push(0)` —— 补足 16 项，与游戏导出惯例一致。

### 为什么用自定义色槽而非调色板匹配

如果只用游戏内置 16 色直接匹配，常见的"照片→地基"会出现严重的色调偏差（游戏内置色板是混凝土灰/黑/红/蓝等 16 种，与风景照完全对不上）。中位切分到自定义色槽，虽然每张图最多 16 种代表色，但它们是该图自身的主色——在游戏渲染层（reform.ts）里，地基会按这些精确的自定义色显示出来。

---

## 依赖的其他模块

| 依赖 | 用途 |
|---|---|
| `@/blueprint/parser` | BlueprintData / BlueprintReformRect |
| `@/blueprint/create` | createEmptyBlueprint |
| `@/blueprint/reformEdit` | ensureReformData / DEFAULT_REFORM_COLORS / REFORM_TYPE_GRID / CUSTOM_COLOR_SLOT_BASE / CUSTOM_COLOR_SLOTS / rgbOfHex |

### 反向依赖

| 使用者 | 用途 |
|---|---|
| `src/components/BuildingPalette.vue`（地基分类） | emit('import-photo') 触发 photoToBlueprint，把结果导入编辑器 |
| 蓝图导出/加载流程 | buildBlueprintFromPixels 产出的蓝图格式与 parser.ts 解析的格式完全一致，可直接走统一的 blueprint 序列化流程 |

### 零 Node 依赖

核心算法（medianCutQuantize / buildRectsFromSlots / buildBlueprintFromPixels）不依赖 DOM API，可在 Node.js 单元测试环境运行（测试文件可直接 import 并调用）。只有 `loadPhotoImage` 依赖 `HTMLCanvasElement`、`Image`、`URL.createObjectURL`。
