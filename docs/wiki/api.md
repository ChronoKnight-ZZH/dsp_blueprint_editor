# API 参考 — CLI 与 Node 模块

本项目无 HTTP API，对外暴露的接口分两类：**CLI 命令**和**可在 Node.js 中导入的 TypeScript 模块**。

---

## 1. CLI 命令

所有命令定义在 `package.json` scripts 中（参见：`package.json:5-15`）。

### yarn serve

```bash
yarn serve
```

启动 `vue-cli-service serve`，开发服务器 + HMR。默认可访问 `http://localhost:8080/dsp_blueprint_editor/`（`publicPath` 配置）。

### yarn build

```bash
yarn build
```

生产构建到 `dist/`，Webpack 5 打包，定义 `VERSION = git describe`。

### yarn cli（蓝图解析 CLI）

```bash
echo 'BLUEPRINT:0,...' | yarn cli
# 或
cat blueprint.txt | yarn cli > bp.json
```

从 stdin 读蓝图字符串，stdout 输出结构化 JSON。底层入口 `src/cli.ts`，运行时通过 `ts-node -r tsconfig-paths/register` + CommonJS 编译模式，支持 `@/` 路径别名（参见：`package.json:11`）。

### yarn test:unit

```bash
yarn test:unit         # 跑全部 *.spec.ts
yarn test:unit -- --watch  # 监视模式
```

Jest 配置见 `jest.config.js`，测试位于 `tests/unit/blueprint/`。

### yarn build-cli

```bash
yarn build-cli
```

`tsc --module commonjs --outDir cli`：把 `src/cli.ts` 等编译成 CommonJS 到 `cli/` 目录。

### yarn format

```bash
yarn format
```

`prettier --write`：格式化 src 下所有 js/ts/vue/json/css/scss/md 文件。

---

## 2. Node.js 模块 API

以下模块可在 Node.js 中直接 import（纯逻辑层，无 Three.js/Vue 依赖）。

### parser.ts — 蓝图字符串 ↔ 数据结构

```typescript
import { fromStr, toStr, BlueprintData, BlueprintBuilding } from '@/blueprint/parser';

// 解析
const bp: BlueprintData = fromStr(blueprintString);

// 导出
const output: string = toStr(bp);
```

**关键类型**（参见：`src/blueprint/parser.ts`）：

| 类型 | 说明 |
| --- | --- |
| `BlueprintData` | 蓝图根对象：`header / version(1\|2) / areas / buildings / patch? / reformData? / tailExtraBytes?` |
| `BlueprintBuilding` | 建筑记录：`index / itemId / modelIndex / localOffset / yaw / v2ExtraPose? / parameters?` |
| `BlueprintArea` | 分区：`parentIndex / anchorLocalOffset / size` |
| `BlueprintReformData` | 地基数据：`rects[] / customReformColors / customReformColorMask` |
| `AllParameters` | 所有建筑参数联合类型（StationParameters / SplitterParameters / AssembleParamerters / ...） |

**函数**：

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `fromStr` | `(str: string) => BlueprintData` | 校验前缀 + 解析 header + MD5 校验 + base64 + gzip 解压 + BufferReader 读 meta/areas/buildings/tail |
| `toStr` | `(bp: BlueprintData) => string` | 写 header + BufferWriter 写 meta/areas/buildings/tail + gzip + base64 + MD5 拼接 |
| `encodedSize` | `(bp: BlueprintData) => number` | 预计算二进制体字节数 |
| `isV2RecordMarkerAt` | `(bytes: Int8Array, offset: number) => boolean` | 识别 v2 记录起始标记（int32 ≤ -100） |
| `parserFor` | `(itemId: number) => ParamParser` | 按 itemId 返回对应参数解析器，未注册退回 `unknownParamParser` |
| `getParam / setParam` | `(view: DataView, slot: int) => int` | 在 DataView 上按 Int32 槽位读写 |

### planet.ts — 区域定位与建筑变换

```typescript
import { findPosForAreas, calcBuildingTrans } from '@/blueprint/planet';

// 把蓝图多个分区摆回 200 段标准星球
const positioned = findPosForAreas(bp.areas, 200);

// 把建筑 localOffset 转为 4×4 世界变换矩阵（两个端点）
const transforms: Matrix4[] = calcBuildingTrans(R, positioned, building);
```

### create.ts — 新建蓝图和建筑

```typescript
import { createEmptyBlueprint } from '@/blueprint/create';

const bp = createEmptyBlueprint();
// root area: size 10×161, latitude -80 (赤道带)
```

### removeBuilding.ts — 删除建筑

```typescript
import { RemoveBuildingsCommand, RemoveBuildingCommand, RemoveBuildingsByItemCommand } from '@/blueprint/removeBuilding';

// 批量删除（传建筑 index 数组）
const cmd = new RemoveBuildingsCommand(bp, [3, 5, 7]);
cmd.do(bp, updater);
cmd.undo(bp, updater);

// 同类全部删除
const cmd2 = new RemoveBuildingsByItemCommand(bp, 2303); // 所有制造台 Mk.I
```

### replace.ts — 批量替换

```typescript
import { ReplaceCommand } from '@/blueprint/replace';

const cmd = new ReplaceCommand(bp, {
    recipe: { fromId: 1001, toId: 1002 },
    // filter, stationStorage, beltIcon, blueprintIcon 等维度
});
cmd.do(bp, updater);
```

### reformImage.ts — 照片转蓝图

```typescript
import { photoToBlueprint, buildBlueprintFromPixels } from '@/blueprint/reformImage';

// 浏览器端：从 Blob/URL 一键生成
const bp = await photoToBlueprint(imageBlob);

// Node.js 端：直接传 RGBA 像素
const pixels = fs.readFileSync('pixels.rgba'); // Uint8ClampedArray
const bp2 = buildBlueprintFromPixels(pixels, width, height);
```

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `photoToBlueprint` | `(source: Blob \| string) => Promise<BlueprintData>` | 一键入口：加载图片 → 缩放 → 180° 旋转 → 量化 → 生成蓝图 |
| `loadPhotoImage` | `(source) => Promise<HTMLCanvasElement>` | 图片加载 + 变换 |
| `buildBlueprintFromPixels` | `(pixels, w, h) => BlueprintData` | 像素数据 → 蓝图，纯函数 |
| `medianCutQuantize` | `(unique, freqs, target) => RGB[]` | 中位切分颜色量化 |
| `buildRectsFromSlots` | `(slotsPerCell, w, h) => BlueprintReformRect[]` | 槽位数组 → 地基矩形列表 |

### defaultParams.ts — 默认参数模板

```typescript
import { defaultParamsFor } from '@/blueprint/defaultParams';

const params = defaultParamsFor(2103, 0); // 物流运输站 2103 的默认 parameters
// → StationParameters: storage=[{itemId:0, max:0, Supply}], slots=[{dir:0,storageIdx:0}]×12
```

### stats.ts — 生产统计

```typescript
import { calculateProductionStats, AcceleratorItem } from '@/blueprint/stats';

const stats = calculateProductionStats(bp, {
    useAccelerator: true,
    acceleratorItem: AcceleratorItem.MkII,
});

// stats.items: ItemStats[]  每分钟产出/消耗/净值
// stats.totalPower: number   总功耗 kW
```

---

## 3. 命令系统通用 API

所有命令实现同一个 `Command` 接口（参见：`src/command.ts`）：

```typescript
interface Command {
    do(data: BlueprintData, updater: Updater): void;
    undo(data: BlueprintData, updater: Updater): void;
    merge(other: Command): boolean;
    readonly silent?: boolean;
}
```

**silent 标志位语义**：

| 值 | 递增 | 效果 |
| --- | --- | --- |
| `true`（或省略 false） | 仅 `stateVersion++` | 图标/颜色/文字 → 不重建场景 |
| `false` | `stateVersion++` + `execVersion++` | 几何/拓扑 → 重建场景 |

Updater 事件通道（参见：`src/command.ts:347-348`）：

```typescript
updater.updateBuildingIcon.dispatch(b);   // 建筑图标
updater.updateBeltIcon.dispatch(b);       // 传送带图标
updater.updateBeltIconSubscript.dispatch(b); // 传送带计数下标
updater.updateSorterIcon.dispatch(b);     // 分流器图标
updater.updateStationInfo.dispatch(b);    // 物流塔面板数据
```

---

## 4. Node CLI 用法

可以用 `ts-node` 直接运行逻辑层（绕开 Vue CLI）：

```bash
# 方式 A: 使用 yarn cli（已配置好 tsconfig-paths）
echo 'BLUEPRINT:...' | yarn cli

# 方式 B: 手动 ts-node
echo 'BLUEPRINT:...' | npx ts-node -r tsconfig-paths/register -O "{\"module\":\"commonjs\"}" src/cli.ts

# 方式 C: 编译后运行
yarn build-cli
echo 'BLUEPRINT:...' | node cli/cli.js
```

CLI 源码 `src/cli.ts`：从 stdin 读蓝图字符串 → `parser.fromStr()` → JSON 序列化输出到 stdout。

---

## 5. 依赖关系与导入限制

```
可在 Node 中 import（纯逻辑层，无 Vue/Three 依赖）:
  src/blueprint/*.ts     ✓
  src/data/*.ts          ✓ (acceleratorData.ts / buildingPowerData.ts / ...)
  src/command.ts         ✓ (Command 接口 + CommandQueue + Updater)
  src/utils.ts           ✓ (纯工具函数)

只在浏览器中可用：
  src/components/*.vue   ✗ (Vue SFC)
  src/iconTexture.ts     ✗ (Three.js TextureLoader)
  src/icons.ts           ✗ (InstancedBufferGeometry)
  src/cargos.ts          ✗ (InstancedMesh + Shader)
  src/PlanetMapControls  ✗ (Three.js EventDispatcher)
  src/SphereGridGeometry ✗ (Three.js SphereGeometry / LineSegments)
  src/editor/*.ts        ✗ (HTMLCanvasElement)
```
