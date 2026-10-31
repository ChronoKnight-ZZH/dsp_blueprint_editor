# DSP Blueprint Editor

戴森球计划蓝图编辑器 & 3D 预览库

本仓库的对外能力分三层：完整编辑器（Vue 应用，见 `src/components/BlueprintEditor.vue` 与 `npm run serve`）、
纯 3D 预览器 `BlueprintViewer`、蓝图解析 `parseBlueprint`。

| 导出 | 说明 | 需要 Vue？ |
|------|------|-----------|
| `BlueprintViewer` | **纯 3D 预览器**（仅 Three.js 球体渲染，无 UI） | 否 |
| `parseBlueprint` | **蓝图解析**（字符串 → 数据对象） | 否 |
| `serializeBlueprint` | **蓝图序列化**（数据对象 → 字符串，`parseBlueprint` 的逆运算） | 否 |
| `configureAssetBaseUrl` | **资产根地址**（库构建下决定 `assets/` 位置） | 否 |
| `describeBuild` | ✗ **不在发布面**（诊断能力，仍可从源码 `@/lib/core/describeBuild` 引用） | 否 |
| `createBlueprintApp` | ✗ **本仓库不提供**：编辑器是独立应用（`src/App.vue`），不是可嵌入的库工厂 | — |

> `BlueprintViewer` 与编辑器共用 `src/lib/core/` 渲染内核，但**不依赖 Vue**；
> 需要在已有页面里嵌入 3D 预览并用代码控制加载/选中/镜头，请直接使用它。

---

## 引入

### 方式 A：源码引用（本仓库内部 / 编辑器）

webpack 别名 `@` 指向 `src`，直接用即可：

```javascript
import { BlueprintViewer, parseBlueprint } from '@/lib';
```

### 方式 B：构建产物（宿主工程 / 纯静态页面）

```bash
yarn build:lib     # → dist-lib/（UMD + ESM + index.d.ts + 外置 assets/ + host-test.html）
```

产物说明见 `dist-lib/README.md`。两种宿主都支持，**库本身不含任何 UI/按钮**：

```html
<!-- 纯静态 script 标签：全局名 DSPBlueprintEditor -->
<div id="viewer" style="height:480px"></div>
<script src="./dist-lib/dsp-blueprint-editor.umd.js"></script>
<script>
    const viewer = new DSPBlueprintEditor.BlueprintViewer({ container: '#viewer' });
    viewer.loadBlueprint(blueprintText);
</script>
```

```javascript
// 工程内 import：ESM，three 作 external
import { BlueprintViewer, configureAssetBaseUrl } from './dist-lib/dsp-blueprint-editor.esm.js';
configureAssetBaseUrl('https://cdn.example.com/dsp/');   // ESM 场景请显式指定资产根
```

资产（模型 / 贴图 / 图标）外置在 `dist-lib/assets/`：UMD 场景默认按加载脚本的
`<script src>` 同级目录自动定位，搬到任意路径都不用改代码；其余场景用
`configureAssetBaseUrl(base)` 指定（传含 `assets/` 的目录，或 `.../assets` 本身）。

`three` 是唯一必需的运行时依赖（ESM 形态需要宿主自带，UMD 形态已内联）：

```bash
yarn add three
```

---

## 快速开始

### 1. 纯 3D 预览器（BlueprintViewer）

仅渲染 Three.js 3D 球体，不包含任何 UI。适合嵌入已有页面，通过代码完全控制。

```javascript
import { BlueprintViewer } from '@/lib';

// 创建实例
const viewer = new BlueprintViewer({
    container: '#canvas',     // CSS 选择器或 HTMLElement
    theme: 'dark',            // 'dark' | 'light' | 'auto'
    keepCamera: true,         // 换蓝图是否保留当前镜头（default true）
}, {
    onBuildingSelect: (pick) => pick && console.log('选中建筑:', pick.index, pick.id),
    onCameraChange: () => console.log('相机变化'),
    onError: (e) => console.warn(e.code, e.message),
});

// 加载蓝图（可多次调用来切换蓝图）
viewer.loadBlueprint('BLUEPRINT:xxx');

// 选中建筑 + 镜头居中对齐（一条调用同时完成）
viewer.focusBuilding(3);

// 只选中、不动镜头
viewer.selectBuilding(3);
console.log(viewer.getSelectedIndex());     // 3
console.log(viewer.getBuildingInfo(3));     // { ok: true, value: { index, id, matrix } }

// 随时更换蓝图
viewer.loadBlueprint('BLUEPRINT:yyy');

// 重置视角 / 导出图片 / 销毁
viewer.resetCamera();
const dataUrl = viewer.toDataURL();
viewer.dispose();
```

### 2. 蓝图解析（parseBlueprint）

```javascript
import { parseBlueprint, serializeBlueprint } from '@/lib';

const data = parseBlueprint('BLUEPRINT:xxx');
console.log(data.header);      // { shortDesc, gameVersion, icons, ... }
console.log(data.buildings);   // 建筑数组
console.log(data.areas);       // 区域数组

// 逆运算：数据对象 → 蓝图字符串（解析失败会抛异常，与 loadBlueprint 的返回式错误不同）
const text = serializeBlueprint(data);
```

### 3. 完整编辑器

编辑器是独立应用（`src/App.vue` + `src/components/BlueprintEditor.vue`），不是库导出：

```bash
yarn serve     # http://localhost:8080/dsp_blueprint_editor/
yarn build     # 产物在 dist/
```

---

## API 参考

### BlueprintViewer

```typescript
new BlueprintViewer(options: ViewerOptions, callbacks?: ViewerCallbacks)
```

**构造参数 ViewerOptions：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `container` | `HTMLElement \| string` | - | 容器元素或 CSS 选择器；找不到返回 `no-container` |
| `theme` | `'dark' \| 'light' \| 'auto'` | `'dark'` | 3D 主题（背景/星球/网格/角标文字） |
| `width` | `number` | 容器宽度 | 显式渲染宽度；给出后容器 resize 不再覆盖 |
| `height` | `number` | 容器高度 | 显式渲染高度 |
| `keepCamera` | `boolean` | `true` | 加载成功后是否保留当前镜头（`false` → 回到默认视角） |
| `initialSettings` | `Partial<ViewerRenderSettings>` | - | 渲染设置（见下三个平铺字段） |
| `showRealModels` | `boolean` | `true` | 是否用真实 GLB 模型（否则用元数据回退盒） |
| `texturesEnabled` | `boolean` | `true` | 是否贴图（原地重挂，不重建） |
| `maxInstancesPerModel` | `number` | `Infinity` | 单个模型最多实例化几栋（超出走回退盒） |
| `autoResize` | `boolean` | `true` | 用 ResizeObserver 跟随容器尺寸 |
| `pixelRatio` | `number` | `min(devicePixelRatio, 2)` | 渲染像素比 |
| `keyboardTarget` | `HTMLElement \| null` | 容器 | 键盘（WASD 旋转）事件目标 |
| `settingsPort` | `SettingsPort` | 进程内存 | 与编辑器共用同一份设置时注入 `{ read, write }` |

**回调 ViewerCallbacks：**

| 回调 | 类型 | 说明 |
|------|------|------|
| `onBuildingSelect` | `(pick: { index; id } \| null) => void` | 点击拾取命中；`index` 是数组下标，`id` 是建筑ID；点空为 `null` |
| `onBuildingRemove` | `(index: number) => void` | 移除请求（仅内核开启 `contextRemove` 时；Viewer 默认不开） |
| `onCameraChange` | `() => void` | 相机变化；仅在真的变化的帧触发，同帧最多一次 |
| `onRebuild` | `(info: RebuildInfo) => void` | 场景重建完成（含模型懒加载触发的重建） |
| `onError` | `(error: ViewerError) => void` | 统一错误通道；按 `code+message` 去重 |

**实例方法（对齐 v1 的 18 条）：**

| 方法 | 返回 | 说明 |
|------|------|------|
| `loadBlueprint(str)` | `BlueprintLoadOutcome` | 加载蓝图字符串，可多次调用切换蓝图 |
| `loadBlueprintData(data)` | `BlueprintLoadOutcome` | 加载蓝图数据对象（总是重建） |
| `getBlueprintData()` | `BlueprintData \| null` | 获取当前蓝图数据（最近一次**成功**加载的） |
| `setTheme(theme)` | `void` | 设置主题 |
| `setCustomTheme(colors)` | `void` | 在当前主题上覆盖颜色 |
| `getTheme()` | `ThemeColors \| null` | 获取当前主题颜色 |
| `selectBuilding(index \| null)` | `BuildingLocateResult` | 选中建筑（只高亮，不动镜头）；`null` 取消 |
| `getSelectedIndex()` | `number \| null` | 获取选中索引（数组下标） |
| `getBuildingInfo(index)` | `ViewerQueryResult<{ index; id; matrix }>` | 获取建筑信息（世界矩阵） |
| `getCamera()` | `PerspectiveCamera \| null` | 获取相机对象 |
| `getCameraVersion()` | `number` | 相机版本号（视角变过才自增） |
| `resetCamera()` | `void` | 重置相机到默认全局视角 |
| `setSize(w, h)` | `void` | 显式设置渲染尺寸（此后忽略容器 resize） |
| `toDataURL()` | `string \| null` | 导出为 base64 PNG |
| `toBlob()` | `Promise<Blob \| null>` | 导出为 Blob |
| `getCanvas()` | `HTMLCanvasElement \| null` | 获取 canvas 元素 |
| `setCallbacks(cbs, opts?)` | `void` | 更新回调（默认**整体替换**；`{ merge: true }` 合并） |
| `dispose()` | `void` | 销毁实例，释放资源（幂等） |

**实例方法（本仓库扩展）：**

| 方法 | 返回 | 说明 |
|------|------|------|
| `focusBuilding(index \| null, opts?)` | `BuildingLocateResult` | **镜头居中对齐**到该建筑（不锁镜头）；`null` 等价 `resetCamera()` |
| `resetSize()` | `void` | 取消显式尺寸，恢复跟随容器 |
| `loadBlueprintJSON(text)` | `BlueprintLoadOutcome` | 从 JSON 文本导入（`Date` / `Uint8Array` 无损还原） |
| `exportBlueprintJSON()` | `string \| null` | 导出为可读 JSON 文本 |
| `setRenderSettings(patch)` | `void` | 更新渲染设置（`showRealModels` / `maxInstancesPerModel` 触发重建） |

#### 加载蓝图

```javascript
const out = viewer.loadBlueprint('BLUEPRINT:xxx');
if (out.ok) {
    console.log(out.value.buildingCount);
    console.log(out.value.unknownModelIndexes);   // 缺 buildingMeta 的 modelIndex
} else {
    console.warn(out.error.code, out.error.phase, out.error.message);
}
```

- 失败时**不抛异常**，且场景 / 相机 / `getBlueprintData()` 保持上一次成功状态；
- 加载成功后默认**不动相机**（`keepCamera: true`）；要自动回默认视角传 `keepCamera: false`；
- 换蓝图会清空选中态（`getSelectedIndex()` 回到 `null`）。

#### 选中建筑 / 镜头居中

```javascript
viewer.selectBuilding(3);          // 只选中：高亮盒出现，镜头不动
viewer.selectBuilding(null);       // 取消选中

viewer.focusBuilding(3);                       // 选中 + 镜头居中对齐（默认 select: true）
viewer.focusBuilding(3, { select: false });    // 只动镜头，不改选中态
viewer.focusBuilding(3, { distance: 60 });     // 指定相机到建筑中心的距离
viewer.focusBuilding(null);                    // 等价 resetCamera()
```

- 聚焦**不锁镜头**：相机目标点始终在球心，聚焦后滚轮缩放、拖拽旋转、平移都照常；
- 默认距离 `0.5R ≈ 100.1`（≈ 离地高度）；小于 `0.04R ≈ 8` 会被抬到贴地最近处；
- 未知 `modelIndex` 的建筑返回 `not-renderable`，画面不动。

#### 获取建筑信息

```javascript
const info = viewer.getBuildingInfo(3);
if (info.ok) {
    const { index, id, matrix } = info.value;
    console.log(index, id, matrix.elements.slice(12, 15));   // 世界坐标
}
```

#### 主题

```javascript
viewer.setTheme('light');                     // 'dark' | 'light' | 'auto'
viewer.setCustomTheme({ grid: 0x3fb950 });    // 只覆盖指定项
console.log(viewer.getTheme());
```

- 立即生效：场景背景、星球色、网格色；
- 角标文字颜色在下一次重建（换蓝图）时刷新——文字烘在纹理里，v1 同样如此。

#### 尺寸与导出

```javascript
viewer.setSize(400, 300);      // 固定尺寸；之后容器 resize 不再覆盖
viewer.resetSize();            // 恢复跟随容器

const png = viewer.toDataURL();          // data:image/png;base64,...
const blob = await viewer.toBlob();      // Blob
```

- 导出内部会先渲染一帧，可直接在 rAF 之外调用（`WebGLRenderer` 默认 `preserveDrawingBuffer: false`）。

#### 销毁

```javascript
viewer.dispose();
// 释放：rAF、定时器、事件监听、ResizeObserver、控件、场景几何/材质、图标图集、
//       选中盒、星球、renderer，并移除 canvas
viewer.loadBlueprint('BLUEPRINT:xxx');   // → { ok: false, error: { code: 'already-disposed' } }
```

### parseBlueprint / serializeBlueprint

```typescript
function parseBlueprint(str: string): BlueprintData      // 解析失败抛异常
function serializeBlueprint(data: BlueprintData): string
```

### describeBuild

```typescript
function describeBuild(input: DescribeBuildInput): BuildDescription
```

产出每个 `modelIndex` 的 `{ total, glb, fallback, hidden }`、选择盒矩阵快照等，用于渲染问题定位与回归对比。

---

## 返回约定与错误码

**所有加载/查询方法不抛异常**，统一按 `ok` 收窄：

```typescript
type BlueprintLoadOutcome = { ok: true; value: BlueprintLoadResult } | { ok: false; error: ViewerError };
type ViewerQueryResult<T>  = { ok: true; value: T }                | { ok: false; error: ViewerError };
type BuildingLocateResult  = { ok: true; index: number }           | { ok: false; error: ViewerError };
```

| `error.phase` | `error.code` | 含义 |
|---------------|--------------|------|
| `parse` | `invalid-start` / `header-too-short` / `checksum-missing` / `checksum-mismatch` / `buffer-overflow` / `parse-failed` | 蓝图字符串解析失败 |
| `parse` | `json-syntax` / `json-shape` | `loadBlueprintJSON` 的语法 / 结构错误 |
| `position` | `no-root-area` / `no-longitude` / `inconsistent-area` | 蓝图数据不自洽（用户可修） |
| `build` | `build-failed` | 渲染构建内部失败（保留旧场景） |
| `lifecycle` | `no-container` / `no-webgl` / `already-disposed` | 初始化 / 生命周期 |
| `lifecycle` | `not-loaded` / `building-not-found` / `not-renderable` | 查询类失败（未加载 / 找不到 / 无可用矩阵） |

---

## 类型定义

```typescript
interface ViewerOptions {
    container: HTMLElement | string;
    theme?: 'dark' | 'light' | 'auto';
    width?: number;
    height?: number;
    keepCamera?: boolean;
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    autoResize?: boolean;
    pixelRatio?: number;
    keyboardTarget?: HTMLElement | null;
    settingsPort?: SettingsPort;
}

interface ViewerCallbacks {
    onBuildingSelect?: (pick: BuildingPickPayload | null) => void;
    onBuildingRemove?: (index: number) => void;
    onCameraChange?: () => void;
    onRebuild?: (info: RebuildInfo) => void;
    onError?: (error: ViewerError) => void;
}

interface BuildingPickPayload { index: number; id: number }

interface BuildingInfoPayload { index: number; id: number; matrix: Matrix4 }

interface FocusOptions {
    distance?: number;      // 相机到建筑中心的距离，default PLANET_RADIUS * 0.5
    select?: boolean;       // 是否同时选中，default true
}

interface ThemeColors {
    sceneBackground: number;
    planet: number;
    grid: number;
    textFill: string;
    textStroke: string;
}

interface RebuildInfo {
    reason: 'load' | 'settings' | 'data' | 'models';
    buildingCount: number;
    unknownModelIndexes: number[];
    durationMs: number;
}

interface ViewerRenderSettings {
    showRealModels: boolean;
    texturesEnabled: boolean;
    maxInstancesPerModel: number;
}

interface SettingsPort {
    read(): ViewerRenderSettings;
    write(patch: Partial<ViewerRenderSettings>): void;
}
```

---

## 依赖

- `three` ^0.160（运行必需）
- `vue` ^3.2 + `vue-i18n` ^9（仅编辑器应用需要；`BlueprintViewer` 与解析器不依赖 Vue）
