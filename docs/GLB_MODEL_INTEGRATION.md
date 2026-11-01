# 建筑模型：外部 GLB 优先 + 元数据表回退

> 实现报告（可复核）。目标：`src/data/building.ts` 的模型元数据表升级为「优先加载外部 GLB 模型，失败回退元数据表」，且
> **元数据表完整保留**、任何失败都静默回退、按需懒加载。

---

## 0. TL;DR

| 项 | 结果 |
| --- | --- |
| 元数据表 | **完全保留**，只**新增**两个派生只读字段 `boxSize` / `boxCenter`（供 GLB 对齐），表内 62 行数值一字未改 |
| 外部模型 | 目录 `src/assets/icons/models/` 下 78 个 `.glb`；**62 个建筑全部**通过「modelIndex → Item.models → Item.icon → 文件名」链路匹配到模型 |
| 未匹配建筑 | **0 个**。早期版本还缺 5 个（制造台 Mk.II/III/IV、电力感应塔、火力发电厂），对应的 `assembler-2/3/4`、`tesla-coil`、`fuel-plant` 已补进目录并自动生效 |
| 加载方式 | 同步 `require.context` 索引（只内联 URL 字符串）+ 命令式 `fetch` + 缓存 + 并发去重 + 8s 超时 + 错误吞掉 + 失败负缓存；**不做任何预加载** |
| 渲染接入 | 已加载 GLB 的建筑走实例化渲染，其余建筑走原元数据盒；GLB 到达后**节流重建一次**场景 |
| 新增文件 | 4 个（`src/models/*`） |
| 修改文件 | 3 个（`src/data/building.ts`、`src/components/BlueprintEditor.vue`、`vue.config.js`）+ 文档 |
| 构建验证 | ✅ 已执行：`vue-cli-service build` **0 error**；`jest tests/unit/models` **7/7 通过**。构建过程中查出并修复了 2 个致命 bug（见 §12.2） |

---

## 1. 三个会改变实现方式的前置发现

### 1.1 这个项目是 **Vue CLI 5 / webpack 5**，不是 Vite

证据：

- `package.json` 的脚本是 `vue-cli-service serve|build`；
- 仓库根目录有 `vue.config.js`，**没有** `vite.config.*`；
- `tsconfig.json` 的 `types` 里是 `webpack-env`、`jest`。

所以任务书里提到的 `import.meta.glob` / `?url` **在这个工程里不可用**（`import.meta` 在 webpack 5 的 CJS 产物里也没有 `glob`）。等价的、且能满足同样三条硬约束的实现：

| 需求 | Vite 写法 | 本实现（webpack 5） |
| --- | --- | --- |
| 目录内资源按名解析 | `import.meta.glob('./*.glb')` | `require.context('../assets/icons/models', false, /\.glb$/i)` |
| 拿到最终 URL | `?url` | `type: 'asset/resource'` 规则；模块导出是**字符串 URL**（不是 `{ default }`） |
| 不预加载 | `glob` 默认懒加载 | context 只内联 URL 字符串（60 个共约 2 KB）；`.glb` 本身是独立资源文件，只在建筑出现时 `fetch` |
| 文件不存在时回退 | 运行时 try/catch | `ctx.keys()` 是编译期静态文件名列表，先查再取，缺失直接返回 `null` |

> `require.context` 的三个参数（目录、递归标记、过滤正则）**必须是字面量**，否则 webpack 无法静态解析。这一点在 `src/models/glbAssets.ts` 文件头与调用处都写了注释。

### 1.2 命名真相：GLB 文件名 = `itemsData.ts` 的 `icon` 字段

`src/data/itemsData.ts` 里每个建筑条目都长这样：

```ts
{ id: 2202, models: [71], grid: [2, 1, 2], name: '无线输电塔', icon: 'charging-pole' },
```

`models` 是 modelIndex 列表，`icon` 就是 GLB 文件名（`charging-pole.glb`）。**这是权威命名表**，因此解析链是：

```
modelIndex → Item.models 中的下标 → Item.icon → 别名/变形表 → 磁盘上的 .glb
```

好处：

- 不需要凭中文名猜英文名（例如「无线输电塔」并不叫 `wireless-power-tower`，而是 `charging-pole`）；
- 「四向分流器」天然表达为 `models: [38, 39, 40]`，下标正好是三种变形模式，对应 `splitter-1/2/3`；
- 别名表只需处理**极少数** icon 与文件名不一致的情况（§9）。

### 1.3 坐标 / 缩放约定（推导过程）

`buildBVH` / `buildBuildings` 都使用 `buildingMeta.unitBoxTrans` 与 `calcBuildingTrans` 组合：

```text
buildingMeta.unitBoxTrans = Rx(90°) · T(offset.x, offset.y, -offset.z) · S(box.w, box.h, box.d)
calcBuildingTrans(...)    = R(经纬/yaw) · T(0, 0, R + localOffset.z·4/3)
```

`calcBuildingTrans` 把 **+z 当作星球法线（向上）**，所以 `unitBoxTrans` 处在「x/y 水平、+z 向上」的**建筑局部空间**：

| 语义 | 由哪个字段决定 | 结论 |
| --- | --- | --- |
| 水平 x 尺寸 | `box[0]` | 不变 |
| **高度** | `box[1]`（Rx90 把局部 y 映射到世界 z） | `box[1]` 是高度 |
| 水平 y 尺寸 | `box[2]` | Rx90 把局部 z 映射到 −y |
| 中心 | `offset` 经 `Rx90` 后 = `(offset[0], offset[2], offset[1])` | 高度位移是 `offset[1]` |

抽样核对：制造台 `box [4.2,4.6,4.2] / offset [0,2.3,0]` → 高度 4.6、中心高 2.3 ✔；火力发电厂 `[4.8,4.2,9.0] / [-0.4,2.1,0.45]` → 高 4.2、占地 4.8×9.0 ✔；传送带 `[0.64,0.12,0.64] / [0,0.05,0]` → 高 0.12 贴地 ✔。

因此：

1. `BuildingMeta` 新增（**派生**，不改表行）：
   ```ts
   boxSize:   [box[0], box[2], box[1]]        // [x 宽, y 深, 高度]，z 向上
   boxCenter: [offset[0], offset[2], offset[1]] // 同上
   ```
2. GLB 放置矩阵（`buildModelPlacement`）：
   - 朝向：默认 glTF 标准 **y-up** → `Rx(+90°)`（`+y → +z`）；
   - 缩放：按元数据高度等比缩放 `s = 高度 / 模型原始高度`（默认 `align: 'height'`，clamp 到 `[1/3, 3]`）；
   - 旋转：`Roll(绕 Y) → Pitch(绕 X) → Yaw(绕 Z)`，角度来自变换表；
   - 平移：把模型包围盒中心送到 `boxCenter + 格单位偏移`，即 `M = T(target + offset − c) · R · S(s) · O`；
   - 逐模型配置统一在 [`src/data/modelTransform.ts`](../src/data/modelTransform.ts)（见 §2.1）。

> 这些默认值假设 GLB 是「1 单位 ≈ 1 格、y-up」的常规导出；若某个模型方向不对，改变换表里对应那一行即可，**不用动渲染代码**。**因为本次没有运行环境做视觉校验，朝向仍需人工确认（§13）。**

### 2.1 逐模型变换表：`src/data/modelTransform.ts`

**这张表只作用于「真实加载成功的 GLB 模型」**：`buildModelPlacement` 仅在 `glb !== null` 时调用，所以表里的数值不会、也无法改动 `building.ts` 的元数据，以及它渲染出的彩色方块。GLB 缺失/加载失败时，回退渲染与未接入本表时完全一致（`tests/unit/models/placement.spec.ts` 里有断言守着这一点）。

与 `buildingMeta` 同键（modelIndex）的 62 行表，每行 6 个数值 + 3 个可选高级字段：

| 字段 | 含义 | 单位 |
| --- | --- | --- |
| `x` / `y` / `z` | 左右 / 前后 / 上下偏移 | **格** |
| `pitch` | 俯仰，绕 X 轴 | 度 |
| `yaw` | 水平旋转，绕 Z 轴（竖直轴） | 度 |
| `roll` | 侧倾，绕 Y 轴 | 度 |
| `upAxis` / `align` / `scale` | 可选高级项，默认 `'y'` / `'height'` / 不填 | — |

- **格换算**：`x、y × 1.2579`（水平格 = `2π/200/5 × R(200.2)`），`z × 4/3`（`HEIGHT_GRID_SIZE`）。
- **应用顺序**：缩放 → 旋转 → 平移；偏移乘在最后一步的平移量上，**不受旋转影响**（`z: -10` 永远往下 10 格）。
- 未登记或全 0 的行不产生任何效果，行为与未接入本表时一致。

当前非 0 的只有 4 行：

| modelIndex | 建筑 | 取值 |
| --- | --- | --- |
| 69 | 微型粒子对撞机 | `yaw: 180` |
| 63 | 原油精炼厂 | `yaw: 90` |
| 453 | 战场分析基站 | `yaw: 90` |
| 68 | 卫星配电站 | `z: -10`（≈ 下沉 13.33 世界单位） |

---

## 2. 改动文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/models/glbAssets.ts` | 新增 | GLB 资源注册表：同步 `require.context` 索引、文件名索引、**别名/变形表**、`modelUrl()` |
| `src/models/glbLoader.ts` | 新增 | 加载器：懒加载、缓存、并发去重、超时、错误吞掉、失败负缓存、释放 |
| `src/models/buildingModel.ts` | 新增 | Model resolver：GLB 优先 + 元数据回退、放置矩阵、按需请求、变更订阅、**映射报告** |
| `src/models/glbInstances.ts` | 新增 | 把已加载 GLB 按建筑做 `InstancedMesh`（子网格级复用几何/材质） |
| `src/data/building.ts` | 修改 | 表**不变**；`BuildingMeta` 仅新增派生字段 `boxSize` / `boxCenter` |
| `src/components/BlueprintEditor.vue` | 修改 | `buildBoxes` 拆分「GLB 组 / 元数据盒回退组」；模型到达后节流重建；`modelRef` 类型放宽；`dispose` 保护共享几何 |
| `vue.config.js` | 修改 | 新增 `.glb → asset/resource` 规则（排在 `/\/assets\//` 之后），输出 `models/[name].[contenthash:8][ext]` |
| `tests/unit/models/modelMapping.spec.ts` | 新增 | 别名/LOD/变形候选顺序的单测；并断言「没有 `require.context` 时全部解析为 null（静默回退、不抛错）」 |
| `docs/GLB_MODEL_INTEGRATION.md` | 新增 | 本报告 |
| `CODE_WIKI.md` | 修改 | 同步模块职责与渲染说明 |

---

## 3. 数据流

```
BlueprintEditor.buildBuildings()
   └── boxes = 非传送带/非分拣器建筑
        └── for each b: resolveBuildingModel(b.modelIndex)      ← 同步、缓存、绝不抛错
             ├── meta       = buildingMeta.get(modelIndex)      ← 回退基准（永远保留）
             ├── glbName    = buildingModelName(modelIndex)     ← modelIndex→Item.icon→别名→磁盘
             ├── glb        = getLoadedGlbModel(glbName)        ← 同步命中缓存才用
             ├── placement  = buildPlacement(glb, meta)         ← y-up→z-up + 高度等比 + 居中
             └── source     = 'glb' | 'meta' | 'unknown'
        ├── glb != null  → GlbModelInstances（每个子网格一个 InstancedMesh）
        └── 否则         → 原元数据盒 InstancedMesh（行为与改动前一致）
                          + requestBuildingModel(modelIndex)   ← 触发按需懒加载（去重）
                                └── 成功 → onBuildingModelsChanged → 节流 150ms → 重建场景
```

---

## 4. 资源解析：`src/models/glbAssets.ts`

```ts
const glbContext = require.context('../assets/icons/models', false, /\.glb$/i); // 同步 context
export const availableModelNames: ReadonlySet<string> = new Set(keys 归一化后);
export function resolveModelName(icon, variantIndex): string | null;  // 别名 → 磁盘存在性
export function modelUrl(name): Promise<string | null>;               // 解析 + 缓存 + 失败返回 null
```

要点：

- **不预加载**：进产物的只有 URL 字符串（60 个约 2 KB），`.glb` 文件本身是独立资源，只有 `fetch(url)` 被调用时才真正下载；`modelUrl` 对同名只解析一次（Promise 缓存）。
- **模块导出形态**：`asset/resource` 生成 `module.exports = __webpack_public_path__ + "models/x.glb"`，也就是**字符串**。取值用 `pickModelUrl()`，同时兼容 `{ default }` 形态（换成别的打包器时不会突然失效）。
- **文件不存在 ≠ 报错**：`availableModelNames` 来自 `ctx.keys()`（编译期静态信息，零请求）。`resolveModelName` 先查它，缺失就返回 `null` → 上游静默回退元数据表。
- **打包环境不支持 `require.context` 时**（未来换成别的打包器）：`createGlbContext()` 捕获异常返回 `null`，整个模块退化成「集合为空」→ 所有建筑走元数据表，不崩。

---

## 5. 加载器：`src/models/glbLoader.ts`

契约：**永不 reject**。

| 场景 | 行为 |
| --- | --- |
| 正常 | 缓存进 `loaded`，回调 `onGlbModelLoaded`，返回 `{ name, url, scene, bbox }` |
| 文件不存在 | `modelUrl` 返回 `null` → 记入 `failed` 负缓存，返回 `null` |
| HTTP 非 2xx | catch → `failed`，`console.warn`，返回 `null` |
| 解析失败 / 空场景 / 空包围盒 | 同上 |
| 超时（默认 8s，含资源解析 + fetch + parse） | `Promise.race` 超时 + `AbortController.abort()`，返回 `null` |
| 并发请求同一模型 | 复用 `pending` 里的同一个 Promise（**去重**） |
| 并发请求很多模型 | 信号量闸门，最多 3 个同时在途 |
| 失败后再次请求 | 负缓存直接返回 `null`（避免对坏文件反复请求）；需要重试用 `resetGlbFailure(name?)` |
| 释放 | `releaseGlbModel` / `releaseAllGlbModels`：释放几何、材质及其上所有贴图 |

另外：**GLTFLoader 自身也是懒加载的**（`import(/* webpackChunkName: "gltf-loader" */ 'three/examples/jsm/loaders/GLTFLoader.js')`），首屏不会为解析器付费；BlueprintEditor 本身也已经是异步 chunk（`webpackChunkName: "renderer"`）。

---

## 6. Resolver：`src/models/buildingModel.ts`

| 导出 | 作用 |
| --- | --- |
| `resolveBuildingModel(modelIndex)` | 返回 `{ glbName, glb, meta, placement, source }`，按 modelIndex 缓存 |
| `requestBuildingModel(modelIndex)` | 幂等的按需加载（有外部模型且未加载时才请求） |
| `onBuildingModelsChanged(cb)` | 模型到达 → 清缓存 + 通知渲染层重建 |
| `buildModelPlacement(glb, meta, modelIndex)` | 计算「模型空间 → 建筑局部空间」的放置矩阵（缩放 → 旋转 → 平移 + 偏移） |
| `getModelMappingReport()` | 运行时权威映射报告（本报告 §8–§10 就是它的静态快照） |
| `glbFailedModels()` | 加载失败的模型名（来自加载器） |

解析全过程包在 `try/catch` 里：任何异常都退化成 `glb = null`，`meta` 照常可用。

---

## 7. 渲染接入

### 7.1 `GlbModelInstances`（`src/models/glbInstances.ts`）

- 遍历 GLB 原型场景的每个子网格，**一个子网格一个 `InstancedMesh`**，几何/材质直接复用缓存对象（贴图、多材质原样保留，显存只有一份）；
- 实例矩阵 = `建筑世界矩阵 × placement × 子网格模型内局部矩阵`；
- 蒙皮网格跳过；`frustumCulled = false`（实例散布在球面，几何自身包围球不适用）；
- 所有 `InstancedMesh` 打 `userData.sharedResource = true`。

### 7.2 `BlueprintEditor.vue`

1. `buildBoxes` 分两步：先全部 `resolveBuildingModel`，再按「有已加载 GLB 且有 meta」分组；
   无 GLB 但**有**外部模型的建筑调用 `requestBuildingModel` 触发懒加载。
2. 单模型实例数上限 `MAX_GLB_INSTANCES_PER_MODEL = 1024`，超过则整组回退元数据盒（防高模×上千实例掉帧）。
3. GLB 组实例化失败（抛错或子网格为 0）→ **整组退回元数据盒**，其他建筑不受影响。
4. 元数据盒回退路径与改动前**逐行一致**（`transforms × unitBoxTrans` + `setColorAt(meta.color)`），未知建筑仍用退化矩阵占位（不可见、不报错）。
5. `modelRef` 语义保持：原来是「元数据盒的实例矩阵」，`SpitterInfo` 用它把建筑中心投影到屏幕。GLB 建筑改成 `{ matrix }` 形态，矩阵 = `建筑世界矩阵 × T(元数据盒中心)`，**投影点与改动前完全一致**。
6. 模型到达 → `onBuildingModelsChanged` → **150ms 节流** → `modelVersion++` → `b` computed 重建一次场景（避免 N 个模型各触发一次重建）。
7. `AllBuildings.dispose` 跳过 `userData.sharedResource` 的几何，避免把跨场景复用的 GLB 缓存几何释放掉。
8. 传送带 / 分拣器**仍走程序化几何**（圆柱 + 连杆 + 由 `Cargos` 驱动的货物动画）：它们的 GLB 已在表内可解析（`resolveBuildingModel` 能正常返回），但把带模型对齐到逐段朝向需要额外的轴向标定，属于本次范围之外，未改动。

---

## 8. 完整映射表（62 个 modelIndex）

图例：`✔` 命中 GLB；`✗` 未匹配 → 回退元数据表。
（`icon` 是 `itemsData.ts` 的字段，也就是 GLB 文件名基线；`glb` 是别名/变形解析后的实际文件。）

### 8.1 传送带 / 分拣器 / 分流 / 辅助 (`✱` 传送带与分拣器不参与 GLB 渲染，但解析链可用)

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 35 | 2001 | 低速传送带 | belt-1 | `belt-1.glb` ✔ |
| 36 | 2002 | 高速传送带 | belt-2 | `belt-2.glb` ✔ |
| 37 | 2003 | 极速传送带 | belt-3 | `belt-3.glb` ✔ |
| 41 | 2011 | 低速分拣器 | inserter-1 | `inserter-1.glb` ✔ |
| 42 | 2012 | 高速分拣器 | inserter-2 | `inserter-2.glb` ✔ |
| 43 | 2013 | 极速分拣器 | inserter-3 | `inserter-3.glb` ✔ |
| 483 | 2014 | 集装分拣器 | inserter-4 | `inserter-4.glb` ✔ |
| 38 | 2020 | 四向分流器 a | splitter-4dir (v0) | `splitter-1.glb` ✔ |
| 39 | 2020 | 四向分流器 b | splitter-4dir (v1) | `splitter-2.glb` ✔ |
| 40 | 2020 | 四向分流器 c | splitter-4dir (v2) | `splitter-3.glb` ✔ |
| 257 | 2040 | 自动集装机 | piler | `piler.glb` ✔ |
| 208 | 2030 | 流速器（监测器） | monitor | `monitor.glb` ✔ |
| 120 | 2313 | 喷涂机 | spray-coater | `spray-coater.glb` ✔ |
| 371 | 2107 | 物流配送器 | delivery-machine | `delivery-machine.glb` ✔ |

### 8.2 物流 / 仓储

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 51 | 2101 | 小型储物仓 | storage-1 | `storage-1.glb` ✔ |
| 52 | 2102 | 大型储物仓 | storage-2 | `storage-2.glb` ✔ |
| 121 | 2106 | 储液罐 | storage-tank | `storage-tank.glb` ✔ |
| 49 | 2103 | 物流运输站 | logistic-station | `logistic-station.glb` ✔ |
| 50 | 2104 | 星际物流运输站 | interstellar-logistic-station | `interstellar-logistic-station.glb` ✔ |

### 8.3 生产 / 冶炼 / 化工

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 65 | 2303 | 制造台 Mk.I | assembler-1 | `assembler-1.glb` ✔（别名 + 回退 `assembler`） |
| 66 | 2304 | 制造台 Mk.II | assembler-2 | ✗ 无文件 |
| 67 | 2305 | 制造台 Mk.III | assembler-3 | ✗ 无文件 |
| 456 | 2318 | 制造台 Mk.IV | assembler-4 | ✗ 无文件 |
| 62 | 2302 | 电弧熔炉 | smelter | `smelter.glb` ✔ |
| 194 | 2315 | 位面熔炉 | smelter-2 | `smelter-2.glb` ✔ |
| 457 | 2319 | 熔炉 Mk.III | smelter-3 | `smelter-3.glb` ✔ |
| 64 | 2309 | 化工厂 | chemical-plant | `chemical-plant.glb` ✔ |
| 376 | 2317 | 化工厂 Mk.II | chemical-plant-2 | `chemical-plant-2.glb` ✔ |
| 63 | 2308 | 原油精炼厂 | oil-refinery | `oil-refinery.glb` ✔ |
| 119 | 2314 | 分馏塔 | fractionator | `fractionator.glb` ✔ |
| 69 | 2310 | 微型粒子对撞机 | hadron-collider | `hadron-collider.glb` ✔ |
| 70 | 2901 | 矩阵研究站 | lab | `lab.glb` ✔ |
| 455 | 2902 | 矩阵研究站 Mk.II | lab-2 | `lab-2.glb` ✔ |

### 8.4 采矿 / 电力

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 57 | 2301 | 采矿机 | mining-drill | `mining-drill.glb` ✔ |
| 256 | 2316 | 大型采矿机 | mining-drill-mk2 | `mining-drill-mk2.glb` ✔ |
| 61 | 2307 | 原油萃取站 | oil-extractor | `oil-extractor.glb` ✔ |
| 60 | 2306 | 抽水站 | water-pump | `water-pump.glb` ✔ |
| 55 | 2205 | 太阳能板 | solar-panel | `solar-panel.glb` ✔ |
| 46 | 2206 / 2207 | 蓄电器 / 蓄电器（满） | accumulator / accumulator-full | `accumulator.glb` ✔（别名） |
| 44 | 2201 | 电力感应塔 | tesla-coil | ✗ 无文件 |
| 71 | 2202 | 无线输电塔 | charging-pole | `charging-pole.glb` ✔ |
| 68 | 2212 | 卫星配电站 | orbital-substation | `orbital-substation.glb` ✔ |
| 53 | 2203 | 风力涡轮机 | wind-turbine | `wind-turbine.glb` ✔ |
| 54 | 2204 | 火力发电厂 | fuel-plant | ✗ 无文件 |
| 118 | 2211 | 微型聚变发电站 | fusion-power-station | `fusion-power-station.glb` ✔ |
| 255 | 2213 | 地热发电站 | geothermal-power-station | `geothermal-power-station.glb` ✔ |
| 45 | 2209 | 能量枢纽 | energy-exchanger | `energy-exchanger.glb` ✔ |
| 56 | 2210 | 人造恒星 | fusion-reactor | `fusion-reactor.glb` ✔ |

### 8.5 戴森球 / 发射

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 72 | 2311 | 电磁轨道弹射器 | em-rail-ejector | `em-rail-ejector.glb` ✔ |
| 73 | 2208 | 射线接收站 | ray-receiver | `ray-receiver.glb` ✔ |
| 74 | 2312 | 垂直发射井 | vertical-launching-silo | `vertical-launching-silo.glb` ✔ |

### 8.6 战斗 / 防御 / 其它

| modelIndex | itemId | 名称 | icon | glb |
| --- | --- | --- | --- | --- |
| 374 | 3001 | 高斯机枪塔 | turret-gauss | `turret-gauss.glb` ✔ |
| 373 | 3002 | 高频激光塔 | turret-laser | `turret-laser.glb` ✔ |
| 375 | 3003 | 聚爆加农炮 | turret-cannon | `turret-cannon.glb` ✔ |
| 408 | 3004 | 磁化电浆炮 | turret-plasma | `turret-plasma.glb` ✔ |
| 407 | 3005 | 导弹防御塔 | turret-missile | `turret-missile.glb` ✔ |
| 422 | 3006 | 干扰塔 | turret-disturb | `turret-disturb.glb` ✔ |
| 403 | 3007 | 信标 | turret-signal | `turret-signal.glb` ✔ |
| 402 | 3008 | 护盾发生器 | turret-shield | `turret-shield.glb` ✔ |
| 453 | 3009 | 战场分析基站 | battle-base | `battle-base.glb` ✔ |
| 482 | 3010 | 地面电浆炮 | turret-plasma-ground | `turret-plasma-ground.glb` ✔ |
| 664 | 2401 | 全息信标 | lighthouse | `lighthouse.glb` ✔ |

**统计**：62 个 modelIndex，命中 62、未匹配 0（早期版本为 57/5）。

---

## 9. 显式别名 / 变形表

| `Item.icon` | 首选文件 | 备选 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `splitter-4dir` | `splitter-1` | — | **变形 variants** | 四向分流器三变形：`Item.models=[38,39,40]` 的下标 0/1/2 → `splitter-1/2/3`；与 `buildingMeta` 的「四向分流器 a/b/c」一一对应 |
| `assembler-1` | `assembler-1` | `assembler` | 别名 | 制造台 Mk.I 的实际导出名与 icon 同名；`assembler.glb` 与其逐字节相同，仅作回退。旧文档中的 `assembler-mk-1-lod1_0/lod2_0` 文件不存在 |
| `accumulator-full` | `accumulator` | — | 别名 | 蓄电器（满）复用蓄电器模型 |
| `mining-drill` | `mining-drill` | — | 显式登记 | 采矿机独立模型，不与大型采矿机合并 |
| `mining-drill-mk2` | `mining-drill-mk2` | — | 显式登记 | 「大型采矿机」的导出名就是 `mk2`，与 `mining-drill` 是两个不同文件 |

> 未在表内登记、且 icon 名与文件名不一致的，一律按「未匹配 → 回退」处理，**不做模糊/前缀匹配**，避免把 A 建筑的模型错挂到 B 建筑上。

---

## 10. 未匹配清单

### 10.1 有元数据、但没有 GLB → 回退元数据表（当前为 0 个）

> ✅ 已全部补齐：`assembler-2/3/4`、`tesla-coil`、`fuel-plant` 都已放进 `src/assets/icons/models/`，62 个建筑全部命中。

下表是补齐前的记录，保留作对照：

| modelIndex | 名称 | 期望文件名（icon） |
| --- | --- | --- |
| 66 | 制造台 Mk.II | `assembler-2.glb` |
| 67 | 制造台 Mk.III | `assembler-3.glb` |
| 456 | 制造台 Mk.IV | `assembler-4.glb` |
| 44 | 电力感应塔 | `tesla-coil.glb` |
| 54 | 火力发电厂 | `fuel-plant.glb` |

模型按上述文件名放进 `src/assets/icons/models/` 后，**无需改代码**即可自动生效（`ctx.keys()` 会看到它们）。

### 10.2 有 GLB、但元数据表里没有 → 目前不渲染（1 个）

| modelIndex | 名称 | 文件 | 原因 |
| --- | --- | --- | --- |
| 117 | 轨道采集器（item 2105） | `orbital-collector.glb` | `building.ts` 没有 117 条目：缺盒尺寸/中心 → 无法定位、无法拾取、无法放图标 |

> 说明：`resolveBuildingModel(117)` 会返回 `glbName='orbital-collector'`、`source='unknown'`，渲染层因 `meta === undefined` 跳过（与改动前一样跳过）。若需要渲染它，先在 `building.ts` 补一条元数据。

### 10.3 磁盘上有、但没有任何模型引用（1 个）

| 文件 | 说明 |
| --- | --- |
| `logistic-vessel.glb` | 物流运输机是**飞行器**，不是建筑，`itemsData` 里没有对应建筑模型号 |

（`assembler.glb` 与 `assembler-1.glb` 逐字节相同，作为 `assembler-1` 的回退备选，已登记。）

---

## 11. 可调参数

| 位置 | 名称 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BlueprintEditor.vue` | `GLB_MODELS_ENABLED` | `true` | 总开关；`false` 时完全回到元数据表（回归/排查用） |
| `BlueprintEditor.vue` | `MAX_GLB_INSTANCES_PER_MODEL` | `1024` | 单模型实例上限，超出整组回退元数据盒 |
| `glbLoader.ts` | `DEFAULT_TIMEOUT_MS` | `8000` | 单模型加载超时（资源解析 + fetch + parse） |
| `glbLoader.ts` | `MAX_CONCURRENT_LOADS` | `3` | 同时在途的模型数 |
| `src/data/modelTransform.ts` | `modelTransform` | 62 行全 0 | 逐模型偏移/旋转（视觉标定入口，见 §2.1） |
| `buildingModel.ts` | `GRID_HORIZONTAL` / `GRID_VERTICAL` | `1.2579` / `4/3` | 变换表里「格」→ 世界单位的换算系数 |
| `vue.config.js` | `.glb` 规则 | `asset/resource` → `models/[name].[contenthash:8][ext]` | 输出独立文件，URL 由 webpack 生成，`publicPath` 自动生效 |

---

## 12. 验证

### 12.1 已做的静态核对

- 表完整性：`buildingMetaRaw` 62 行**未改动**；`buildingMeta` 仍导出同样的 `Map<number, BuildingMeta>`，6 处旧调用点（`unitBoxTrans` / `selectUnitBoxTrans` / `iconTrans` / `color`）语义不变。
- 回退路径：`buildBoxes` 的回退分支与改动前逐行等价（含「未知建筑跳过」→ 现在是退化矩阵占位，效果同样是不可见、不抛错）。
- 兜底层级：`resolveBuildingModel` try/catch → `buildBoxes` try/catch → 组级回退 → 加载器永不 reject → `require.context` 缺失时集合为空。任一层失败都只回退，不会白屏。
- 首屏：GLB 模型文件完全不进首屏（产物里只有 URL 字符串）；GLTFLoader 在异步 chunk 里，模块初始化只调用 `ctx.keys()`（编译期信息，零请求）。
- 引用一致性：`resolveBuildingModel` / `requestBuildingModel` / `onBuildingModelsChanged` / `GlbModelInstances` / `LoadedGlbModel` / `ResolvedBuildingModel` 的导入与用法、`BuildingMeta` 新字段的使用点均已逐一对照。

### 12.2 ✅ 已执行构建验证，并修复了 2 个致命 bug

初版实现没有跑过构建（会话 shell 的沙箱初始化失败）。后续在具备完整权限的环境里补跑 `vue-cli-service build`，**构建通过但功能是死的**：从产物反查发现两处只有运行期才会暴露的缺陷，均已修复。

#### bug 1：`typeof require.context` 守卫把整个功能判死

```ts
// 修复前
if (typeof require === 'undefined' || typeof require.context !== 'function')
    return null;
```

webpack 会把 `require.context` 这个**属性访问**编译成「某个空模块的 `.context`」，它恒为 `undefined`。编译产物实测为：

```js
function ge(){try{return "function"!==typeof n(46065).context?null:n(30153)}catch(t){...}}
```

于是 `createGlbContext()` 永远返回 `null` → `availableModelNames` 为空 → **所有建筑静默回退，GLB 一个都不会加载**。

修复：取到 `require.context(...)` 的**调用结果**再判断类型，不要探测 `require.context` 本身。

```ts
const context = require.context('../assets/icons/models', false, /\.glb$/i);
return typeof context === 'function' ? context as GlbRequireContext : null;
```

#### bug 2：`asset/resource` 导出的是字符串，不是 `{ default }`

```ts
const mod = await glbContext(`./${name}.glb`);
const url = typeof mod.default === 'string' ? mod.default : null;   // 恒为 null
```

实测产物：`49921:function(t,e,n){t.exports=n.p+"models/splitter-1.cf8a0c11.glb"}` —— 模块导出就是 URL 字符串本身。即使修好 bug 1，这里仍会全部返回 `null`。

修复：新增 `pickModelUrl()`，字符串与 `{ default }` 两种形态都兼容。

#### 另外两处修正

- **缩放兜底**：`buildingMeta` 的 `box` 高度是近似值（部分只是占位盒）。实测多数模型与元数据盒高度接近 1:1（制造台 4.65/4.6、熔炉 3.98/3.8、射线接收站 10.4/10.0），但个别条目偏差很大（地热发电站模型 61.6 vs 元数据 10、信标 12.9 vs 3），按高度等比缩放会把它们压成一个点。因此自动缩放系数加了 `[1/3, 3]` 的收紧区间，超出部分在 `src/data/modelTransform.ts` 里用 `scale` 逐条修正。
- 文档中「异步 context，每模型独立 chunk」的说法是错的：默认（同步）context 会把 **URL 字符串**内联进产物（60 个约 2 KB），`.glb` 文件本身仍是独立资源、按需 `fetch`。不预加载的结论不变。

### 12.3 已执行的验证与结果

```bash
npx vue-cli-service build          # ✅ 0 error（17 条 no-console warning，全部来自本次新增的降级日志）
npx jest tests/unit/models         # ✅ 19/19 通过
```

| 检查项 | 结果 |
| --- | --- |
| TypeScript / webpack 编译 | ✅ 通过，且 `Critical dependency` 警告在修复后消失 |
| 产物 `dist/models/*.glb` | ✅ 全部生成，文件名带 contenthash |
| `gltf-loader` 独立 chunk | ✅ 存在（`js/gltf-loader.*.js`，80 KB） |
| 首屏是否含 GLB 模型数据 | ✅ 不含，只含 URL 字符串 |
| `require.context` 编译产物 | ✅ `const t = n(30153); return "function" === typeof t ? t : null` |
| 映射核对（脚本跑真实数据） | ✅ 62 条元数据 **全部命中真实模型**（未匹配 0）；四向分流器 38/39/40 → `splitter-1/2/3` |
| GLB 合法性 | ✅ 60 个全部是自包含的标准 glTF 2.0：无 `extensionsRequired`、无 Draco、无外部贴图/buffer 引用 |
| 单测 | ✅ 19 个（别名、LOD、变形、无 `require.context` 时静默回退、变换表 62 行、放置矩阵与格换算） |

映射与 GLB 结构可以用仓库里的两个脚本随时复核（不进产物、纯只读）：

```bash
npx ts-node -O '{"module":"commonjs","types":["node"]}' scripts/verify-glb-mapping.ts
npx ts-node -O '{"module":"commonjs","types":["node"]}' scripts/check-glb-extensions.ts
npx ts-node -O '{"module":"commonjs","types":["node"]}' scripts/inspect-glb.ts   # 量包围盒，看 y-up 与尺寸
```

### 12.4 仍然只能人眼确认的部分

无头环境跑不出真实渲染，因此**朝向、贴地高度、相互比例**这三项仍需在浏览器里过一遍 §13 的清单。这三项都只需改 `src/data/modelTransform.ts` 里对应那一行（`yaw` / `z` / `scale` / `align`），不用动渲染代码。

`tests/unit/models/placement.spec.ts` 已经用矩阵断言锁住了这几件事，改表后跑一次即可：Yaw=90 把模型 +X 转到 +Y、Yaw=180 翻到 -X、`z: -10` 正好下移 `10 × 4/3` 世界单位、以及 62 个建筑的放置矩阵全部有限。

### 12.4 调试/复核用的运行时接口

```ts
import { getModelMappingReport } from '@/models/buildingModel';
console.log(getModelMappingReport());
// → { availableFiles, mapped, unmappedBuildings, missingMetaModels, unusedFiles, failedModels }
```

---

## 13. 人工视觉验收清单（必须做）

因为无法在此环境跑真实渲染，以下各项请在浏览器里逐条确认（有问题基本只需改 `src/data/modelTransform.ts` 对应那一行）：

- [ ] 制造台（65）、熔炉（62）、物流塔（49/50）、研究站（70）是否**立在球面上**而不是陷进地面/悬空？（若陷入→ 调该行 `z`，单位是格）
- [ ] 模型朝向是否与配方/传送带口方向一致？（不对 → 调 `yaw: ±90` 或 `±180`）
- [ ] 模型大小是否与相邻建筑比例协调？（异常 → 该行加 `scale` 或 `align: 'none'`）
- [ ] 原油精炼厂（63）、战场分析基站（453）转 `yaw: 90` 后朝向是否正确？
- [ ] 微型粒子对撞机（69）`yaw: 180` 后是否与原模型左右对调？
- [ ] 卫星配电站（68）`z: -10` 后是否如预期沉入地面以下（该值会整栋埋掉，属确认项）？
- [ ] 四向分流器三种变形（38/39/40）是否分别是 1/2/3 条分流的形状？
- [ ] 传送带/分拣器/防御塔等其余建筑是否都换成了真实模型（不应再有彩色方块回退）？
- [ ] 大量建筑（>1024 同类）时是否自动回退方块且不掉帧？
- [ ] 断网（DevTools → Network offline）后打开蓝图：不应报错、不应白屏，全部显示方块。
- [ ] 选中/右键剔除是否仍准确（拾取盒未改动，应完全一致）。
- [ ] 分流器面板（`SpitterInfo`）的 4 个圆点方向是否正常（依赖 `modelRef` 投影点）。

---

## 14. 本次刻意未做（避免超范围）

1. **传送带 / 分拣器不走 GLB**：需要逐段轴向标定，且程序化几何还要承载 `Cargos` 货物动画，改动面大、回归风险高。
2. **不做模型合并（合并几何/烘焙顶点色）**：会丢贴图与多材质；当前「每子网格一个 InstancedMesh」已经把几何/材质复用做到一份。
3. **不做 UI 开关**：`GLB_MODELS_ENABLED` 常量已留好；如需暴露给用户，加个设置项即可。
4. **不给 model 117 补元数据**：属于数据决策（盒尺寸/中心需要实测），留给你确认。
