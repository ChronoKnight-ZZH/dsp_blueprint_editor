# DSP Blueprint Editor · lib 库文档

戴森球计划蓝图编辑器 & 3D 预览库。本文档面向**库的使用者**（Web 页面、Wails 桌面端、MES 端），
完整覆盖当前版本的发布面与新增能力。

本仓库的对外能力分三层：完整编辑器（Vue 应用，见 `src/components/BlueprintEditor.vue` 与 `npm run serve`）、
纯 3D 预览器 `BlueprintViewer`、蓝图解析 `parseBlueprint`。

| 导出                      | 说明                                                    | 需要 Vue？ |
| ----------------------- | ----------------------------------------------------- | ------- |
| `BlueprintViewer`       | **纯 3D 预览器**（仅 Three.js 球体渲染，无 UI）                    | 否       |
| `parseBlueprint`        | **蓝图解析**（字符串 → 数据对象）                                  | 否       |
| `serializeBlueprint`    | **蓝图序列化**（数据对象 → 字符串，`parseBlueprint` 的逆运算）           | 否       |
| `configureAssetBaseUrl` | **资产根地址**（库构建下决定 `models/`、`img/` 的位置）                | 否       |
| `setModelCacheEnabled`  | **模型本地缓存开关**（库构建默认关闭；`true` 开启离线缓存，`null` 恢复构建配置）     | 否       |
| `isModelCacheEnabled`   | 查询当前持久化开关是否打开                                         | 否       |
| `calculateStatsList`    | **统计列表**（蓝图字符串/`BlueprintData` + 增产剂等级 → 耗电/需求/输出）    | 否       |
| `describeBuild`         | ✗ **不在发布面**（诊断能力，仍可从源码 `@/lib/core/describeBuild` 引用） | 否       |
| `createBlueprintApp`    | ✗ **本仓库不提供**：编辑器是独立应用（`src/App.vue`），不是可嵌入的库工厂        | —       |

> `BlueprintViewer` 与编辑器共用 `src/lib/core/` 渲染内核，但**不依赖 Vue**；
> 需要在已有页面里嵌入 3D 预览并用代码控制加载/选中/镜头，请直接使用它。

***

## 目录

- [1. 能力总览](#1-能力总览)
  - [1.1 三层能力](#11-三层能力)
  - [1.2 导出面](#12-导出面)
  - [1.3 功能索引](#13-功能索引)
- [2. 引入与资产](#2-引入与资产)
  - [2.1 源码引用](#21-源码引用)
  - [2.2 构建产物](#22-构建产物)
  - [2.3 资产根与部署](#23-资产根与部署)
  - [2.4 依赖](#24-依赖)
- [3. 快速开始](#3-快速开始)
- [4. 功能模块详解](#4-功能模块详解)
  - [4.1 蓝图渲染（BlueprintViewer）](#41-蓝图渲染blueprintviewer)
  - [4.2 增量预览（preview-delta）](#42-增量预览preview-delta)
  - [4.3 选中、多选与镜头聚焦](#43-选中多选与镜头聚焦)
  - [4.4 蓝图 JSON 导入导出](#44-蓝图-json-导入导出)
  - [4.5 主题与视觉](#45-主题与视觉)
  - [4.6 资产、模型与渲染设置](#46-资产模型与渲染设置)
  - [4.7 蓝图解析与序列化](#47-蓝图解析与序列化)
- [4.8 诊断能力（非发布面）](#48-诊断能力非发布面)
  - [4.9 统计列表（calculateStatsList）](#49-统计列表calculatestatslist)
- [5. API 参考](#5-api-参考)
  - [5.1 构造函数](#51-构造函数)
  - [5.2 实例方法总表](#52-实例方法总表)
  - [5.3 回调](#53-回调)
  - [5.4 返回值与错误码](#54-返回值与错误码)
  - [5.5 导出函数](#55-导出函数)
- [6. 类型定义](#6-类型定义)
- [7. 输入输出格式规范](#7-输入输出格式规范)
- [8. 注意事项与最佳实践](#8-注意事项与最佳实践)
- [9. 自检与验证](#9-自检与验证)
- [10. 与既有功能的关系](#10-与既有功能的关系)

***

## 1. 能力总览

### 1.1 三层能力

本仓库对外能力分三层：

| 层级       | 入口                                                   | 说明                                  | 需要 Vue？ |
| -------- | ---------------------------------------------------- | ----------------------------------- | ------- |
| 完整编辑器    | `src/App.vue` + `src/components/BlueprintEditor.vue` | Vue 应用，含全部 UI 与编辑能力，`yarn serve` 启动 | 是       |
| 纯 3D 预览器 | `BlueprintViewer`                                    | 无头渲染器，仅 Three.js 球体渲染，不含任何 UI       | 否       |
| 蓝图数据层    | `parseBlueprint` / `serializeBlueprint`              | 蓝图字符串 ↔ 数据对象；不依赖渲染栈                 | 否       |

`BlueprintViewer` 与编辑器共用 `src/lib/core/` 渲染内核，但**不依赖 Vue**。
需要在已有页面里嵌入 3D 预览并用代码控制加载、选中、镜头、增量生成时，直接使用它。

### 1.2 导出面

运行时导出**刻意收窄**为 7 个，避免把编辑器 UI 或内部实现耦进宿主：

| 导出                      | 类型       | 说明                                                       | 本次迭代                       |
| ----------------------- | -------- | -------------------------------------------------------- | -------------------------- |
| `BlueprintViewer`       | class    | 无头 3D 预览器；加载 / 选中 / 多选 / 聚焦 / 主题 / 截图 / 增量预览 / 销毁        | 增强（多选、增量预览、JSON、editor 主题） |
| `parseBlueprint`        | function | 蓝图字符串 → `BlueprintData`；失败**抛异常**                        | 既有                         |
| `serializeBlueprint`    | function | `BlueprintData` → 蓝图字符串；`parseBlueprint` 的逆运算            | 既有                         |
| `configureAssetBaseUrl` | function | 指定 `models/`、`basis/`、`img/` 的根目录                        | 既有（资产探测增强）                 |
| `setModelCacheEnabled`  | function | 模型本地缓存（持久化）开关：库构建默认关闭，`true` 开启、`null` 恢复构建配置            | 新增                         |
| `isModelCacheEnabled`   | function | 查询持久化开关是否打开（不含「浏览器是否支持」）                                 | 新增                         |
| `calculateStatsList`    | function | 蓝图统计列表：总耗电 / 需求 / 输出；复用编辑器网页端 `calculateProductionStats` | 本次新增                       |

此外，`src/lib/index.ts` 还导出了**纯类型**（`ViewerOptions`、`ViewerCallbacks`、
`PreviewDeltaEvent`、`PreviewStats` 等），供 TypeScript 宿主直接引用；它们没有运行时开销。

以下能力存在但**不在发布面**，只能从源码路径引用：

| 能力                                        | 源码路径                        | 说明                                                                      |
| ----------------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `describeBuild`                           | `@/lib/core/describeBuild`  | 构建结果快照，用于渲染问题定位与回归对比                                                    |
| `blueprintJSON` 工具                        | `@/lib/blueprintJSON`       | `parseBlueprintJSON` / `stringifyBlueprintJSON` / `formatBlueprintJSON` |
| `currentAssetBaseUrl` / `resolveAssetUrl` | `@/lib/assets/assetBaseUrl` | 资产地址解析细节                                                                |
| `PreviewLayer` / `PreviewProjector`       | `@/lib/preview/*`           | 增量预览内部实现（不保证跨版本稳定）                                                      |
| `createBlueprintApp`                      | —                           | **本仓库不提供**：编辑器是独立应用，不是可嵌入的库工厂                                           |

### 1.3 功能索引

| 功能      | 入口                                                                  | 典型场景                                |
| ------- | ------------------------------------------------------------------- | ----------------------------------- |
| 加载蓝图字符串 | `viewer.loadBlueprint(str)`                                         | 用户粘贴、文件读取、后端返回正式蓝图                  |
| 加载已解析数据 | `viewer.loadBlueprintData(data)`                                    | 宿主已自行解析或需要注入构造的数据                   |
| 加载 JSON | `viewer.loadBlueprintJSON(text)`                                    | 网页端只能拿到 JSON 文本、跨进程传输               |
| 导出 JSON | `viewer.exportBlueprintJSON()`                                      | 保存工程、调试、传给后端                        |
| 选中单栋    | `viewer.selectBuilding(i)`                                          | 点击列表 / 搜索定位                         |
| 选中多栋    | `viewer.selectedBuildings(list)`                                    | 批量高亮、框选结果回显                         |
| 镜头对准    | `viewer.focusBuilding(i, opts)`                                     | 列表点击后居中查看，不锁镜头                      |
| 增量生成预览  | `viewer.beginPreview()` / `applyPreviewDelta()` / `commitPreview()` | 后端流式推送生成过程                          |
| 预览运行时开关 | `previewAnimation: 'auto' \| 'on' \| 'off'`                         | 外部端 / MES 端低端机降级                    |
| 主题      | `setTheme` / `setCustomTheme` / `getTheme`                          | 深浅色、复刻编辑器观感                         |
| 尺寸      | `setSize` / `resetSize`                                             | 固定画布尺寸、嵌入布局                         |
| 截图      | `toDataURL` / `toBlob`                                              | 分享、报告、导出图片                          |
| 资产地址    | `configureAssetBaseUrl`                                             | CDN、子路径、离线包                         |
| 本地持久化   | `setModelCacheEnabled(true)`                                        | 宿主开启「看过的模型断网也能显示」（库默认关闭）            |
| 统计列表    | `calculateStatsList(input, acceleratorItem?)`                       | 外部端 / MES 端算总耗电、某材料需求/输出（与网页端统计同口径） |
| 诊断      | `previewStats` / `describeBuild`                                    | 验收、性能排查、回归                          |

***

## 2. 引入与资产

### 2.1 源码引用（本仓库内部 / 编辑器）

webpack 别名 `@` 指向 `src`，直接用即可：

```javascript
import { BlueprintViewer, parseBlueprint } from '@/lib';
```

### 2.2 构建产物（宿主工程 / 纯静态页面）

```bash
yarn build:lib     # → dist-lib/
```

产物包含：

| 文件 / 目录                                      | 说明                                       |
| -------------------------------------------- | ---------------------------------------- |
| `dsp-blueprint-editor.esm.js`                | ESM，three 已内联                            |
| `dsp-blueprint-editor.esm.d.ts`              | 与 ESM 产物同名的类型声明                          |
| `dsp-blueprint-editor.umd.js`                | UMD，three 已内联，全局名 `DSPBlueprintEditor`   |
| `index.d.ts`                                 | 公共类型声明（内容同 ESM 版，供 `package.json#types`） |
| `host-test.html`                             | UMD 宿主验证页（零 404 自检）                      |
| `esm-test.html`                              | ESM 宿主验证页（验证 `import.meta.url` 资产探测）     |
| `preview-test.html`                          | 增量预览效果与验收页                               |
| `preview-fixture.json`                       | 增量预览回放样本（252 条事件 / 7,186 个操作）            |
| `models/<name>.glb`                          | 建筑模型；法线 / 自发光 / spec 已内嵌 KTX2            |
| `basis/`                                     | KTX2 解码必需的 Basis Universal 转码器           |
| `img/item_recipe/`、`img/tech/`、`img/signal/` | 物品 / 配方 / 科技 / 信号图标                      |
| `fixtures/sample_blueprint.txt`              | 验证页样本，可删                                 |

UMD（纯静态 `<script>`）：

```html
<div id="viewer" style="height:480px"></div>
<script src="./dist-lib/dsp-blueprint-editor.umd.js"></script>
<script>
    const viewer = new DSPBlueprintEditor.BlueprintViewer({ container: '#viewer' });
    viewer.loadBlueprint(blueprintText);
</script>
```

ESM（工程内 `import`）：

```javascript
import { BlueprintViewer, configureAssetBaseUrl } from './dist-lib/dsp-blueprint-editor.esm.js';

const viewer = new BlueprintViewer({ container: '#viewer' });
```

> 必须通过 **http(s)** 打开页面（`file://` 会被浏览器 CORS 拦住，模型与图标无法加载）。

### 2.3 资产根与部署

资产（模型 / 图标 / Basis 转码器）外置在产物根目录。`configureAssetBaseUrl(base)` 用于显式指定
「包含 `models/`、`basis/`、`img/` 的那一级目录」：

```javascript
import { configureAssetBaseUrl } from '@/lib';

configureAssetBaseUrl('https://cdn.example.com/dsp/');
// 传 null / undefined / '' 清除配置，恢复自动探测
configureAssetBaseUrl(null);
```

> 编辑器构建（`src/` 直接跑 Vue 应用）下该调用是**空实现**：资产 URL 由 webpack `publicPath`
> 生成；库构建（UMD / ESM）下才真正生效。

自动探测优先级（从高到低）：

1. `configureAssetBaseUrl` 的显式值；
2. **ESM**：`import.meta.url`（产物 chunk 自身 URL）所在目录；
3. **UMD**：加载本库的 `<script src>` 所在目录；
4. `document.baseURI`；
5. 都探测不到时：相对当前页面（空串）。

因此把 `dist-lib/` 整个目录搬到任意路径，只要 `models/`、`basis/`、`img/` 保持相对位置，就无需改代码。
打包后 `import.meta.url` 指向**宿主 chunk**（如 `/assets/index-xxx.js`），生产环境要么把资产放到
该 chunk 同级，要么用 `configureAssetBaseUrl` 指向 public 下的资产副本。

**模型本地缓存**：GLB 会写入浏览器 Cache Storage（`dsp-models-v1`），命中后直接读缓存。
缓存不可用（老浏览器 / 非安全上下文 / 隐私模式）**或持久化开关关闭**时自动退化为普通网络请求，
不会报错。缓存键是模型最终 URL，因此内容变化（contenthash 变化）会自动失效。

### 2.4 依赖

- `three` ^0.160：**已内联进库产物**，宿主无需安装（TypeScript 宿主仍需 `@types/three` 解析 `Matrix4` / `PerspectiveCamera`）。
- `pako`：蓝图解压，已内联。
- `vue` ^3.2 + `vue-i18n` ^9：仅编辑器应用需要；`BlueprintViewer` 与解析器不依赖 Vue。
- KTX2/Basis：运行时需要产物中的 `basis/` 目录；缺失时带 KTX2 贴图的模型会退化为**无贴图**（保留几何），不会中断渲染。

模型本地缓存（Cache Storage）在**库构建里默认关闭**：库是嵌在宿主页面里的无头渲染器，
存储属于宿主，不替宿主预写最多 \~128 MB 的模型。需要「看过的模型断网也能显示」时，
创建 Viewer 前调用一次 `setModelCacheEnabled(true)`（见「API 参考 › setModelCacheEnabled / isModelCacheEnabled」）。
关闭时缓存操作全部是**空操作**：读未命中、写失败、清单为空、清空 0，不占宿主配额、
不弹持久化授权，`loadBlueprint` 等 API 行为完全不变（只是每次走网络）。

***

## 3. 快速开始

### 3.1 最小 3D 预览

```javascript
import { BlueprintViewer } from '@/lib';

const viewer = new BlueprintViewer({
    container: '#canvas',     // CSS 选择器或 HTMLElement
    theme: 'editor',          // 'editor' | 'dark' | 'light' | 'auto'
    keepCamera: true,         // 换蓝图是否保留当前镜头（default true）
}, {
    onBuildingSelect: (pick) => pick && console.log('选中建筑:', pick.index, pick.id),
    onCameraChange: () => console.log('相机变化'),
    onError: (e) => console.warn(e.phase, e.code, e.message),
});

const out = viewer.loadBlueprint('BLUEPRINT:xxx');
if (!out.ok) console.warn(out.error.code, out.error.message);

viewer.focusBuilding(3);              // 选中 + 镜头居中对齐（一条调用）
console.log(viewer.getSelectedIndex());  // 3
console.log(viewer.getBuildingInfo(3));  // { ok: true, value: { index, id, matrix } }

viewer.resetCamera();
const png = viewer.toDataURL();
viewer.dispose();
```

### 3.2 增量预览

```javascript
const viewer = new BlueprintViewer({
    container: '#canvas',
    previewAnimation: 'auto',   // 'auto'（默认）| 'on' | 'off'
});

// 1) 先开始预览，再提交生成请求（顺序不能反）
viewer.beginPreview({ projector: 'sphere', settleMs: 100, enterDelayMs: 120 });

// 2) 在 onProgress 回调里同步转发每一条差量
//    generateFactory / request 为宿主自有函数，这里只演示调用顺序
const result = await generateFactory(request, (event) => {
    if (event.kind === 'preview-delta') viewer.applyPreviewDelta(event);
});

// 3) 诊断要在 commit 之前采集：commit 成功后预览层已被丢弃
const stats = viewer.previewStats();
console.log(stats);

// 4) 成功：正式蓝图串收尾（内部"先建后换"，不会闪白）
const committed = viewer.commitPreview(result.blueprint);

// 失败 / 中止：viewer.discardPreview();
```

> `previewStats()` 只在预览期间有值；`commitPreview` / `discardPreview` 之后再调用返回 `null`。

### 3.3 解析 / JSON

```javascript
import { parseBlueprint, serializeBlueprint } from '@/lib';

const data = parseBlueprint('BLUEPRINT:xxx');   // 失败抛异常
console.log(data.header, data.areas, data.buildings);

const text = serializeBlueprint(data);          // 逆运算

// 浏览器里已有 viewer 时，也可以走 JSON 入口
const outcome = viewer.loadBlueprintJSON(jsonText);
const exported = viewer.exportBlueprintJSON();  // 2 空格缩进的可读 JSON
```

### 3.4 完整编辑器

编辑器是独立应用（`src/App.vue` + `src/components/BlueprintEditor.vue`），不是库导出：

```bash
yarn serve     # http://localhost:8080/dsp_blueprint_editor/
yarn build     # 产物在 dist/
```

***

## 4. 功能模块详解

### 4.1 蓝图渲染（BlueprintViewer）

**核心能力**

- 把蓝图字符串 / `BlueprintData` / JSON 文本渲染成 Three.js 球面场景；
- 真实 GLB 模型、KTX2 贴图、程序化传送带与分拣器、元数据回退盒；
- 点击拾取、单选 / 多选高亮、镜头居中对齐；
- 主题、显式尺寸、截图、销毁；
- 增量预览的宿主门面（见 4.2）。

**适用场景**

- 在已有页面嵌入只读 3D 预览；
- 列表 / 搜索联动：点击列表项调用 `focusBuilding`；
- 生成过程可视化：把后端 `preview-delta` 原样转发；
- 截图分享 / 报告导出。

**设计意图**

- **无头**：库内不写任何 UI、不打印业务日志；所有交互由宿主决定；
- **不抛异常**：加载 / 查询统一返回 `{ ok, value } | { ok, error }`，失败保留上一次成功状态；
- **与编辑器共用内核**：同一套定位、构建、BVH、主题数学，避免「预览和编辑器不一致」。

**交互约定**

- 左键拖拽平移，右键拖拽旋转，滚轮缩放；
- 触屏单指平移，双指开合缩放 + 拖动旋转；
- 键盘 `W/A/S/D` 平移，`N` 重置视角；
- 点击建筑触发 `onBuildingSelect`，点空返回 `null`；
- 移除回调 `onBuildingRemove` 仅在内部 `contextRemove` 开启时触发，**Viewer 默认不开**。

### 4.2 增量预览（preview-delta）

**核心能力**

后端生成蓝图时会持续推送「增加 / 替换 / 删除」的差量对象。预览层把事件**同步摄入**，
每帧向目标位置收敛，并在正式蓝图返回后用 `commitPreview` 无缝替换。

- **逻辑立即生效**：`applyPreviewDelta` 在回调内同步更新内存状态，不排队、不等待；
- **视觉持续收敛**：位置 / 朝向 / 透明度按指数曲线跟随，避免逐条动画拖慢总时长；
- **独立临时层**：预览对象与正式场景互不影响，`commitPreview` 前不会破坏已有蓝图；
- **健壮性内建**：序号去重、未知 remove 忽略、未知 replace 按 add、抖动抑制、异常吞掉；
- **运行时开关**：`previewAnimation` 可在不改代码、不重新出包的情况下切换。

**适用场景**

- 后端流式生成工厂，前端需要「边生成边长出来」；
- 外部端（Wails 桌面）与 MES 端共用同一份产物，但设备能力不同；
- 生成失败 / 中止时快速回到上一次成功画面；
- 低端机 / 无障碍偏好下关闭动画，只保留最终结果。

**设计意图**

| 决策         | 原因                                                            |
| ---------- | ------------------------------------------------------------- |
| 不逐条播放动画队列  | 实测 250 条事件约 5 秒到齐（≈50 条/秒，20ms 一条），逐条播放会把总时长拖到分钟级             |
| 摄入与呈现分离    | 摄入只改 SoA 内存（目标 ≤2ms/事件）；呈现每帧一次，只写脏槽并局部上传 GPU                  |
| 池化 + SoA   | 实测峰值 32,581 个对象，逐对象 JS 对象会造成 GC 抖动；池化 + `Float32Array` 保持稳定帧率 |
| 抖动抑制       | 实测 77%\~92% 的临时 `add` 最终会被撤销；延迟淡入可避免画面闪烁                      |
| 抖动透明度而非混合  | 3 万级半透明实例的排序与过绘制会压垮填充率；抖动保持在不透明通道                             |
| 坐标语义切换硬重投影 | 这是语义跳变而非运动，插值会让全场"蠕动"                                         |

#### 完整示例：用产物自带 fixture 回放（可直接运行）

在仓库根目录起静态服务（如 `npx serve .`），新建页面：

```html
<div id="viewer" style="width:100%;height:480px"></div>
<script type="module">
    import { BlueprintViewer } from './dist-lib/dsp-blueprint-editor.esm.js';

    const viewer = new BlueprintViewer({
        container: '#viewer',
        theme: 'editor',
        previewAnimation: 'on',
    });

    const fixture = await (await fetch('./dist-lib/preview-fixture.json')).json();

    viewer.beginPreview({ projector: 'sphere' });
    for (const event of fixture.events) {
        viewer.applyPreviewDelta(event);
        await new Promise((r) => setTimeout(r, 20));   // 模拟后端 20ms/条
    }

    await new Promise((r) => setTimeout(r, 400));      // 等视觉收敛
    console.table(viewer.previewStats());
</script>
```

#### 完整示例：接入后端生成流程

```javascript
import { BlueprintViewer } from '@/lib';

const viewer = new BlueprintViewer({
    container: '#viewer',
    previewAnimation: 'auto',
});

async function generateWithPreview(request) {
    // 1) 先开预览层；顺序反了会漏掉开头的差量
    viewer.beginPreview({
        projector: 'sphere',   // 'sphere' | 'plane'
        settleMs: 100,         // 收敛时间常数 τ（ms）
        enterDelayMs: 120,     // 新对象延迟淡入（ms）；0 = 关闭延迟淡入
        minLifeMs: 120,        // 存活短于该值即撤销的对象不出场（ms）
    });

    try {
        const result = await generateFactory(request, (event) => {
            // 2) 同步转发，绝不能 await / 攒队列 / 延迟执行
            if (event.kind === 'preview-delta') viewer.applyPreviewDelta(event);
        });

        // 3) 用正式蓝图串收尾；内部先构建正式场景，成功后再丢弃预览层
        return viewer.commitPreview(result.blueprint);
    } catch (error) {
        // 4) 失败 / 中止：丢弃预览层，保留上一次成功画面
        viewer.discardPreview();
        throw error;
    }
}
```

#### `beginPreview` 参数

| 参数             | 类型                    | 默认值        | 取值范围          | 说明                                                                          |
| -------------- | --------------------- | ---------- | ------------- | --------------------------------------------------------------------------- |
| `projector`    | `'sphere' \| 'plane'` | `'sphere'` | 枚举            | `layout-grid-v1` 阶段的投影方式。`sphere` 按 bbox 自动居中/缩放后投到球面；`plane` 贴在锚点切平面，永不穿极点 |
| `settleMs`     | `number`              | `100`      | `>= 16`（内部钳制） | 收敛时间常数 τ（毫秒）。越大越平滑、越慢                                                       |
| `enterDelayMs` | `number`              | `120`      | `>= 0`        | 新对象延迟多久才淡入；`0` = 关闭延迟                                                       |
| `minLifeMs`    | `number`              | `120`      | `>= 0`        | 存活短于该值即被撤销的对象不出场；`0` = 关闭                                                   |

切到 `blueprint-area-local-v1` 后，两种 projector 都会转为真实 Area 球面投影，
与正式场景的 `calcBuildingTrans` 完全一致。

#### 预览事件输入格式

```json
{
  "kind": "preview-delta",
  "protocolVersion": 2,
  "taskId": "044ac41b-a467-4553-84d7-00f0f65997ab",
  "sequence": 12,
  "stage": "assembly",
  "message": "正在更新生成预览",
  "coordinateSystem": "layout-grid-v1",
  "operations": [
    {
      "type": "add",
      "objectId": "building-1",
      "building": {
        "itemId": 2001,
        "modelIndex": 35,
        "areaIndex": 0,
        "localOffset": { "x": 0, "y": 0, "z": 0 },
        "yaw": 0,
        "outputObjectId": "building-2"
      }
    },
    {
      "type": "replace",
      "objectId": "building-1",
      "building": { "itemId": 2001, "modelIndex": 35, "localOffset": { "x": 1, "y": 0, "z": 0 }, "yaw": 0 }
    },
    { "type": "remove", "objectId": "building-3" }
  ],
  "areas": [
    {
      "index": 0,
      "parentIndex": -1,
      "tropicAnchor": 0,
      "areaSegments": 200,
      "anchorLocalOffset": { "x": 0, "y": 0 },
      "size": { "x": 27, "y": 22 }
    }
  ],
  "primaryAreaIndex": 0
}
```

字段约定：

| 字段                 | 类型                   | 必填 | 说明                                                              |
| ------------------ | -------------------- | -- | --------------------------------------------------------------- |
| `kind`             | `string`             | 否  | 省略或 `'preview-delta'` 才参与几何；其他值（如 `'phase'`）整条忽略                |
| `sequence`         | `number`             | 否  | 单调序号；**只接受比上次更大的值**。跳号是常态，不视为丢包；重复/更旧的整条忽略                      |
| `coordinateSystem` | `string`             | 否  | `'layout-grid-v1'` / `'blueprint-area-local-v1'`；未知值按 layout 处理 |
| `operations`       | `PreviewOperation[]` | 是  | 为空则整条忽略                                                         |
| `areas`            | `PreviewAreaLike[]`  | 否  | area-local 阶段用于真实 Area 定位；支持扁平与嵌套两种形态                           |
| `primaryAreaIndex` | `number`             | 否  | 主区域下标；当前层不读取                                                    |
| `previewBatch`     | `unknown`            | 否  | 旧接口兼容字段；当前层不读取                                                  |

`PreviewOperation`：

| `type`      | 必填字段                  | 说明                    |
| ----------- | --------------------- | --------------------- |
| `'add'`     | `objectId`、`building` | 新增对象；已存在时按 replace 更新 |
| `'replace'` | `objectId`、`building` | 更新对象；不存在时按 add 处理     |
| `'remove'`  | `objectId`            | 删除对象；不存在时静默忽略         |

`building` 字段：

| 字段                                                                     | 类型               | 必填    | 默认 / 说明                   |
| ---------------------------------------------------------------------- | ---------------- | ----- | ------------------------- |
| `itemId`                                                               | `number`         | 是     | 决定传送带 / 分拣器等程序化几何         |
| `modelIndex`                                                           | `number`         | 是     | 决定 GLB / 回退盒              |
| `localOffset`                                                          | `{ x, y, z }`    | 是     | 格坐标                       |
| `yaw`                                                                  | `number`         | 是（TS） | 角度制；JS 侧缺失时运行时按 `0` 处理    |
| `areaIndex`                                                            | `number`         | 否     | 默认 `0`                    |
| `localOffset2`                                                         | `{ x, y, z }`    | 否     | 分拣器第二端；默认等于 `localOffset` |
| `yaw2`                                                                 | `number`         | 否     | 默认等于 `yaw`                |
| `outputObjectId`                                                       | `string \| null` | 否     | 传送带连线目标；缺失则不画连线           |
| `inputObjectId` / `inputFromSlot` / `outputToSlot` / `productionIndex` | —                | 否     | 类型兼容保留，当前预览层不读取           |
| `isTemporary`                                                          | `boolean`        | 否     | 协议兼容字段，当前预览层不读取           |
| `tilt` / `pitch`                                                       | `number`         | 否     | 实测恒为 0，当前按 0 处理           |

> **重要**：预览对象不属于正式场景的 BVH，**不可点击拾取、不可选中**。
> 选中 / 聚焦 / `getBuildingInfo` 只作用于已 `commitPreview` 或 `loadBlueprint` 的正式场景。

#### 健壮性规则

| 情况                        | 行为                              |
| ------------------------- | ------------------------------- |
| 序号重复 / 更旧                 | 整条忽略，`droppedEvents++`          |
| 序号跳号                      | 正常接受（跳号是常态，最多实测连跳 18）           |
| `remove` 不存在的对象           | 静默忽略，`unknownRemoves++`         |
| `replace` 不存在的对象          | 按 `add` 处理，`unknownReplaces++`  |
| 坏操作（缺 `localOffset` 等）    | 跳过该操作，绝不抛错                      |
| 对象在 `minLifeMs` 内被撤销且从未露面 | 直接回收，`filteredByThrash++`       |
| 坐标系语义变化                   | 硬重投影（不插值），`version++`           |
| `areas` 解析失败              | 保留上一次投影，预览不中断                   |
| 池容量到顶                     | 该次操作跳过（回调内不做 GPU 分配），不阻塞后续事件    |
| 渲染异常                      | 预览层内部吞掉并 `console.warn`，不影响生成流程 |

#### 运行期统计（`previewStats()`）

未开始预览时返回 `null`。字段如下：

| 字段                 | 类型               | 说明                        | 验收参考          |
| ------------------ | ---------------- | ------------------------- | ------------- |
| `events`           | `number`         | 已应用的事件数                   | —             |
| `operations`       | `number`         | 已计入的操作条数（仅统计至少应用了一条操作的事件） | —             |
| `droppedEvents`    | `number`         | 因序号过期被整条丢弃的事件数            | 有序投递时应为 0     |
| `unknownRemoves`   | `number`         | 删除不存在对象的次数                | 中途订阅时出现属正常    |
| `unknownReplaces`  | `number`         | 替换不存在对象的次数                | 应被当作 add，不丢对象 |
| `alive`            | `number`         | 当前逻辑存活对象数                 | 流结束后应等于数据净增量  |
| `fading`           | `number`         | 已不属逻辑对象但仍占槽的数量            | 收敛后应回落        |
| `peakAlive`        | `number`         | 存活峰值                      | 用于容量预估        |
| `moving`           | `number`         | 仍在运动的槽数                   | 事件停止后应回落到 0   |
| `slots`            | `number`         | 各池已分配槽位总数（高水位）            | 用于显存预估        |
| `filteredByThrash` | `number`         | 被抖动抑制吞掉的可见槽数              | 用于判断抑制是否过度    |
| `coordinateSystem` | `string \| null` | 当前坐标语义                    | 应只切一次         |
| `lastIngestMs`     | `number`         | 最近一次摄入耗时（毫秒）              | 应 ≤ 50ms      |
| `maxIngestMs`      | `number`         | 最大摄入耗时（毫秒）                | 应 ≤ 50ms      |
| `disposed`         | `boolean`        | 预览层是否已释放                  | 丢弃后为 `true`   |

#### 预览注意事项

1. **先** **`beginPreview`，再提交生成请求**；否则开头的差量会丢失。
2. **不要自己做队列播放 / 延迟执行**。在 `onProgress` 里同步调用 `applyPreviewDelta`，
   让逻辑立即生效、视觉每帧收敛。
3. `beginPreview` 会**自动丢弃上一次预览**，可安全地重复调用。
4. `commitPreview(blueprint)` 只接受**蓝图字符串**；若解析失败，会丢弃预览并返回错误，
   正式场景保持上一次成功状态。
5. **不支持回退 / 拖动进度条**。要回看较早状态，只能 `discardPreview()` → `beginPreview()` → 从 0 重放。
6. 预览期间切换 `previewAnimation` 走 `setRenderSettings({ previewAnimation })`，立即生效。
7. 单实例语义：预览层的模型 / 材质缓存与正式场景共享模块级缓存，同一页面只建一个 Viewer 最稳。
8. 长会话频繁生成时，生成结束务必 `commitPreview` 或 `discardPreview`，避免预览层常驻占用显存。

### 4.3 选中、多选与镜头聚焦

**核心能力**

| 能力 | 方法                                            | 说明                     |
| -- | --------------------------------------------- | ---------------------- |
| 单选 | `selectBuilding(index \| null)`               | 只高亮，不动镜头；`null` 取消     |
| 多选 | `selectedBuildings(indexes \| null)`          | **本次新增**；批量高亮，先整体校验再提交 |
| 聚焦 | `focusBuilding(index \| null, opts?)`         | 镜头居中对齐，不锁镜头            |
| 查询 | `getSelectedIndex()` / `getSelectedIndexes()` | 当前单选 / 多选结果            |
| 信息 | `getBuildingInfo(index)`                      | 世界矩阵                   |

**适用场景**

- 左侧建筑列表多选后，在地图上批量高亮；
- 搜索 / 筛选命中多栋建筑，一次性回显；
- 报告或工单里需要「选中并居中」某栋建筑；
- 框选结果与地图选中态双向同步。

**设计意图**

- 多选是单选的自然扩展：单选只是「只含一个元素的多选」，两者共用同一套选择盒池；
- **先整体校验再提交**：批量操作要么全成功，要么完全不改动原选中，避免出现「选中了一半」；
- **选中与聚焦解耦**：`selectBuilding` 不动镜头，`focusBuilding` 才动镜头，宿主可按需组合；
- 聚焦不锁镜头：只是把相机搬到合适位置，之后仍可自由缩放 / 旋转 / 平移。

```javascript
// 单选
viewer.selectBuilding(3);
viewer.selectBuilding(null);                 // 取消，返回 { ok: true, index: -1 }

// 多选（去重、保持传入顺序）
const multi = viewer.selectedBuildings([0, 2, 2]);
if (multi.ok) console.log(multi.indexes);    // [0, 2]

// 任一建筑不存在 → 整次失败，原选中不变
const bad = viewer.selectedBuildings([0, 99]);
if (!bad.ok) console.warn(bad.error.code);   // 'building-not-found'

// 清除多选
viewer.selectedBuildings(null);

// 聚焦（默认同时选中）
viewer.focusBuilding(3);
viewer.focusBuilding(3, { select: false, distance: 60 });
viewer.focusBuilding(null);                  // 等价 resetCamera()

// 数据源
console.log(viewer.getSelectedIndex());      // 多选时返回第一项
console.log(viewer.getSelectedIndexes());    // 全部选中下标
console.log(viewer.getBuildingInfo(3));      // { ok: true, value: { index, id, matrix } }
```

`FocusOptions`：

| 参数         | 类型        | 默认值                           | 说明                                                |
| ---------- | --------- | ----------------------------- | ------------------------------------------------- |
| `distance` | `number`  | `PLANET_RADIUS * 0.5 ≈ 100.1` | 相机到**建筑中心**的距离（≈ 离地高度）。小于 `0.04R ≈ 8` 会被控件抬到贴地最近处 |
| `select`   | `boolean` | `true`                        | 是否同时选中该建筑                                         |

要点：

- `index` 是 `BlueprintData.buildings` 的**数组下标**；越界时会按 `BlueprintBuilding.index` 兜底查一次；
- 选中 / 聚焦只影响视觉，**不触发** `onBuildingSelect`（避免宿主回环）；
- 聚焦**不锁镜头**：目标点始终在球心，聚焦后滚轮缩放、拖拽旋转、平移都照常；
- 未知 `modelIndex` 的建筑没有可用矩阵，`focusBuilding` 返回 `not-renderable`，画面不动；
- 换蓝图会清空选中态（`getSelectedIndex()` 回到 `null`，`getSelectedIndexes()` 回到 `[]`）。

### 4.4 蓝图 JSON 导入导出

**核心能力**

- `loadBlueprintJSON(text)`：从 JSON 文本导入，先 `JSON.parse` 再还原 `Date` / `Uint8Array`；
- `exportBlueprintJSON()`：把当前（最近一次成功加载的）数据导出为 2 空格缩进的可读 JSON。

**适用场景**

- 浏览器 / 桌面端之间只能传文本，且不想处理二进制蓝图格式；
- 需要把蓝图数据存进工程文件、数据库或日志，便于人读与 diff；
- 调试时快速查看 `header` / `buildings` 结构；
- 后端只提供 JSON，而前端仍需复用 Viewer 的同一套加载链路。

**设计意图**

- 不改变既有数据链路：JSON 只是在 `loadBlueprintData` 之前多一步类型还原；
- 显式处理两种不能直接 `JSON.stringify` 往返的类型（`Date`、`Uint8Array`），避免宿主踩坑；
- 导出格式稳定、可读，便于版本管理与问题排查；
- 错误分类沿用 `parse` 阶段，宿主处理方式与蓝图字符串一致。

```javascript
const outcome = viewer.loadBlueprintJSON(jsonText);
if (!outcome.ok) {
    // json-syntax：JSON 语法错误；json-shape：缺 header/areas/buildings 或字段类型错误
    console.warn(outcome.error.code, outcome.error.message);
}

const text = viewer.exportBlueprintJSON();   // 未加载时返回 null
```

#### 为什么不能直接 `JSON.stringify` 往返

| 字段                       | 序列化后的形状           | 直接 parse 回来                                              | 处理方式                |
| ------------------------ | ----------------- | -------------------------------------------------------- | ------------------- |
| `header.time`            | ISO 字符串           | `string`，`serializeBlueprint` 调 `getTime()` 会抛 TypeError | 导入时还原为 `Date`       |
| `buildings[].extraBytes` | `{"0":1,"1":2,…}` | 普通对象，取 `.length` 得到 `undefined`                          | 导入时还原为 `Uint8Array` |

#### 输入输出规范

- 根节点必须是对象，且包含 `header`（对象）、`areas`（数组）、`buildings`（数组）；
- `header.time` 接受 ISO 字符串或时间戳；非法时返回 `json-shape`；
- `extraBytes` 接受 `Uint8Array` 或 `{"0":…}` 对象；键不是非负整数时返回 `json-shape`；
- 由 `exportBlueprintJSON()` 产出的文本可被 `loadBlueprintJSON` 按上述约定还原；
  手工改写过 `header.time` 或 `extraBytes` 的文本需要自行保证字段形状。

> JSON 文本 ≠ 蓝图字符串。需要可分享 / 可导入游戏的蓝图串时，
> 用 `serializeBlueprint(viewer.getBlueprintData())`。

### 4.5 主题与视觉

**核心能力**

- 内置 `editor` / `dark` / `light` 三套主题，`auto` 跟随系统深浅色；
- `editor` 为**新默认**，复刻编辑器观感（含天光/星空）；
- 支持只覆盖部分颜色的自定义主题；
- 切主题即时生效，无需重建蓝图。

**适用场景**

- 预览器嵌入浅色业务系统时切 `light`；
- 桌面端跟随系统 `prefers-color-scheme`；
- 需要和编辑器截图保持一致的验收 / 分享场景；
- 品牌配色定制（只改网格 / 星球 / 背景）。

**设计意图**

- 主题只改颜色与天光开关，不触碰几何与 BVH，切换成本接近零；
- `editor` 与编辑器同一套视觉常量，避免「编辑器里好看、预览器里发灰」；
- 自定义主题是**合并**而非替换，宿主只需给出差异项。

```javascript
viewer.setTheme('light');                     // 'editor' | 'dark' | 'light' | 'auto'
viewer.setCustomTheme({ grid: 0x3fb950 });    // 只覆盖指定项
console.log(viewer.getTheme());
```

| 主题           | 场景背景       | 星球         | 网格         | 角标文字   | 备注                                            |
| ------------ | ---------- | ---------- | ---------- | ------ | --------------------------------------------- |
| `editor`（默认） | `0x000000` | `0xb0b0b0` | `0xf0f0f0` | 白字深灰描边 | 复刻编辑器观感，含天光/星空                                |
| `dark`       | `0x0d1117` | `0x1c2128` | `0x6e7681` | 白字深灰描边 | 对齐 v1 纯色板                                     |
| `light`      | `0xd8dee4` | `0xc8d0d8` | `0xffffff` | 深字白描边  | 对齐 v1 纯色板                                     |
| `auto`       | 跟随系统       | 跟随系统       | 跟随系统       | 跟随系统   | `prefers-color-scheme` 在 `dark` / `light` 间切换 |

要点：

- 立即生效：场景背景、星球色、网格色；
- 角标文字颜色在下一次重建（换蓝图 / 改重建类设置）时刷新——文字烘在纹理里；
- 天光/星空只属于 `editor` 主题；切到 `dark` / `light` 会隐藏；
- `getTheme()` 返回副本；初始化失败或已销毁时返回 `null`。

### 4.6 资产、模型与渲染设置

**核心能力**

- 外置 GLB 模型 + KTX2/Basis 贴图，按资产根解析 URL；
- `showRealModels` / `maxInstancesPerModel` / `texturesEnabled` 三个渲染开关；
- 未知 `modelIndex` 自动隐藏占位并上报；
- 模型本地缓存、缺失兜底，渲染不中断。

**适用场景**

- 宿主把 `dist-lib/` 部署到 CDN 或子路径；
- 低端设备关闭真实模型 / 限制实例数；
- 设置面板实时切换贴图；
- 新版本蓝图出现未知建筑时的兼容降级。

**设计意图**

- 模型与库产物解耦：库只负责拼 URL，宿主可自由搬运资产；
- 构建期决策（`showRealModels` / 上限）走重建，表现期决策（贴图）走原地重挂，各走最短路径；
- 未知模型不阻断整张蓝图，先隐藏占位保证可用性，再通过 `unknownModelIndexes` 暴露问题。

```javascript
const viewer = new BlueprintViewer({
    container: '#canvas',
    showRealModels: true,          // 是否使用真实 GLB（否则用元数据回退盒）
    texturesEnabled: true,         // 是否贴图（原地重挂，不重建）
    maxInstancesPerModel: Infinity, // 单模型最多实例化几栋（超出走回退盒）
    initialSettings: {             // 与上面平铺字段等价；同时给出时平铺字段优先
        previewAnimation: 'auto',
    },
});

// 运行期更新
viewer.setRenderSettings({ showRealModels: false });   // 触发重建
viewer.setRenderSettings({ texturesEnabled: false });  // 原地重挂，不重建
viewer.setRenderSettings({ previewAnimation: 'off' }); // 只改预览插值开关
```

生效路径：

| 设置                     | 是否重建 | 说明                  |
| ---------------------- | ---- | ------------------- |
| `showRealModels`       | 是    | 分组决策在构建期            |
| `maxInstancesPerModel` | 是    | 同上；`Infinity` 表示不限制 |
| `texturesEnabled`      | 否    | 共享材质原地重挂            |
| `previewAnimation`     | 否    | 只改预览层的插值布尔          |

渲染细节：

- 外部 GLB 模型优先；缺失时按 `buildingMeta` 生成回退盒；
- 传送带 / 分拣器走程序化几何，不走 GLB；
- 没有 `buildingMeta` 的未知 `modelIndex` 按隐藏占位处理，不参与拾取，并在加载结果的
  `unknownModelIndexes` 中返回；
- 星球网格按相机距离切换 LOD（仅视觉，不影响命中）；
- 材质贴图缺失时有兜底，不会中断渲染。

### 4.7 蓝图解析与序列化

```typescript
function parseBlueprint(str: string): BlueprintData      // 解析失败抛异常
function serializeBlueprint(data: BlueprintData): string
```

```javascript
import { parseBlueprint, serializeBlueprint } from '@/lib';

const data = parseBlueprint('BLUEPRINT:xxx');
const text = serializeBlueprint(data);
```

要点：

- `parseBlueprint` **不做 trim**，要求字符串严格以 `BLUEPRINT:` 开头；
- `viewer.loadBlueprint` 会先 `trim` 再解析，更适合直接接收用户粘贴内容；
- 与 `viewer.loadBlueprint` 的错误风格不同：解析函数**抛异常**，Viewer 方法返回式报错；
- 解析结果可直接传给 `viewer.loadBlueprintData`；
- `BlueprintData` 的 `header.time` 是 `Date`，`buildings[].extraBytes` 是 `Uint8Array`，
  跨进程传输时请使用 Viewer 的 JSON 入口或自行做类型还原。

### 4.8 诊断能力（非发布面）

```typescript
import { describeBuild } from '@/lib/core/describeBuild';

function describeBuild(input: DescribeBuildInput): BuildDescription;
```

产出每个 `modelIndex` 的 `{ total, glb, fallback, hidden }`、选择盒矩阵快照等，
用于：

1. 「行为不变」的自动化基线（jest 快照）；
2. 线上问题定位（对比 `perModelIndex` 与 `selectBoxes`）；
3. Viewer / Editor 一致性校验（同一蓝图两边产出的 `describeBuild` 应相等）。

`describeBuild` **不在发布面**，宿主若需要请直接以源码路径打包，或自行构建快照接口。

### 4.9 统计列表（calculateStatsList）

**核心能力**

- 输入蓝图字符串（内部 `parseBlueprint`）或 `BlueprintData`，加上增产剂等级，返回总耗电、需求、输出；
- 算法**完全复用编辑器网页端**的 `calculateProductionStats`（源码 `@/blueprint/stats`），不改其一行；
- 只做「入参校验 + 结构转换 + 补物品名」，因此数值与网页端「统计」Tab 逐项一致；
- 不依赖 Three.js / Vue / DOM，可在 Node、Worker、Wails 后端直接调用。

**适用场景**

- 外部端 / MES 端需要在**不渲染 3D** 的情况下算蓝图耗电与物料平衡；
- 生成流程收尾后，把统计结果一并返回给上层展示；
- 批量蓝图离线核算（遍历多份 `.txt`）。

**签名**

```typescript
function calculateStatsList(
    input: string | BlueprintData,
    acceleratorItem?: 0 | 1 | 2 | 3,   // 省略等价 0
): StatsListResult;

type StatsListResult =
    | { ok: true; value: StatsListValue }
    | { ok: false; error: StatsListError };
```

**增产剂等级**

| 值      | 含义 | 对应源码枚举                |
| ------ | -- | --------------------- |
| 0（省略时） | 无  | AcceleratorItem.None  |
| 1      | 一级 | AcceleratorItem.MkI   |
| 2      | 二级 | AcceleratorItem.MkII  |
| 3      | 三级 | AcceleratorItem.MkIII |

数值与 `AcceleratorItem` 一一对应；内部自动推出 `useAccelerator = acceleratorItem !== 0`，与网页端 `!== None` 等价。

**出参**

```typescript
interface StatsListValue {
    totalPower: number;          // 总功耗，kW（同 ProductionStats.totalPower）
    demand: StatsListItem[];     // 需求（= ItemStats.consumed），按 count 降序
    output: StatsListItem[];     // 输出（= ItemStats.produced），按 count 降序
}

interface StatsListItem {
    itemId: number;
    name: string;                // 取 itemsMap 原文中文键，不翻译
    count: number;               // 每分钟数量
}
```

### setModelCacheEnabled / isModelCacheEnabled

```typescript
function setModelCacheEnabled(enabled: boolean | null): void   // true 开启 / false 关闭 / null 恢复构建配置
function isModelCacheEnabled(): boolean                        // 不含「浏览器是否支持」的判断
```

默认值来自构建配置 `config/persistence.config.js` 的 `lib` 字段（当前 **`false`**）。
关闭、或浏览器不支持 Cache Storage 时，缓存后端固定是一个**空操作对象**：
`read` 永远未命中、`store` 永远失败、清单永远为空、`clear` 返回 0，而且完全不接触
`caches`——不占宿主存储配额、不弹 `navigator.storage.persist()`、不打印日志。

宿主开启离线缓存只需一行（在任何模型加载之前调用）：

```javascript
import { BlueprintViewer, setModelCacheEnabled } from './dist-lib/dsp-blueprint-editor.esm.js';

setModelCacheEnabled(true);                 // 看过的模型断网也能显示
const viewer = new BlueprintViewer({ container: '#viewer' });
viewer.loadBlueprint(blueprintText);
```

- 缓存键是模型最终的 URL（编辑器构建带 `[contenthash:8]`；库产物的 `models/` 文件名固定，
  需要版本隔离时请在自己的部署路径上加版本前缀）；
- 开关是**全局**的：对所有 `BlueprintViewer` 实例生效，随时可切换（`setModelCacheEnabled(null)`
  恢复构建配置值）；
- 想改变库的出厂默认值，改 `config/persistence.config.js` 的 `lib` 后重新 `yarn build:lib`。

**增产剂等级**

| 值        | 含义 | 对应源码枚举                  |
| :------- | :- | :---------------------- |
| `0`（省略时） | 无  | `AcceleratorItem.None`  |
| `1`      | 一级 | `AcceleratorItem.MkI`   |
| `2`      | 二级 | `AcceleratorItem.MkII`  |
| `3`      | 三级 | `AcceleratorItem.MkIII` |

数值与 `AcceleratorItem` 一一对应；内部自动推出 `useAccelerator = acceleratorItem !== 0`，与网页端 `!== None` 等价。

**出参**

typescript

```
interface StatsListValue {
    totalPower: number;          // 总功耗，kW（同 ProductionStats.totalPower）
    demand: StatsListItem[];     // 需求（= ItemStats.consumed），按 count 降序
    output: StatsListItem[];     // 输出（= ItemStats.produced），按 count 降序
}

interface StatsListItem {
    itemId: number;
    name: string;                // 取 itemsMap 原文中文键，不翻译
    count: number;               // 每分钟数量
}
```

**与** **`calculateProductionStats`** **的映射**

| 网页端字段              | 统计列表字段                            | 说明                        |
| :----------------- | :-------------------------------- | :------------------------ |
| `totalPower`       | `value.totalPower`                | 原样                        |
| `items[].consumed` | `value.demand[].count`            | 只保留 `consumed !== 0` 的项   |
| `items[].produced` | `value.output[].count`            | 只保留 `produced !== 0` 的项   |
| `items[].net`      | **不导出**                           | 需要净量请自行 `output - demand` |
| `items` 按 `net` 降序 | `demand` / `output` 各按 `count` 降序 | **顺序不同**，宿主不要按位置对账        |

**三条口径约定**

1. **同一** **`itemId`** **既产又耗**（某产物被下游当原料）时，`demand` 与 `output` **两边各出现一次**，保真原始值；不做净额合并。
2. **`name`** **不翻译**：取 `itemsMap.get(itemId)?.name`（`itemsData.ts` 的中文键原文），查不到时 `"unknown"`（与 `i18n.ts` 的 `itemName` 兜底一致）。需要本地化名称请在宿主侧用自己的词典翻译。
3. **单位**：`totalPower` = kW；`count` = 每分钟。与网页端「统计」Tab 完全一致。

**错误码**

| `code`                | 触发                                                   | 宿主处理建议    |
| :-------------------- | :--------------------------------------------------- | :-------- |
| `parse-failed`        | 字符串无法被 `parseBlueprint` 解析（含空串）                      | 提示用户修正蓝图串 |
| `invalid-accelerator` | `acceleratorItem` 不是 `0/1/2/3` 的整数                   | 检查宿主传参    |
| `invalid-argument`    | `input` 既非 `string` 也非含 `buildings` 数组的对象；或数据在统计阶段抛错 | 检查数据来源    |

三个错误码与 `ViewerErrorCode` **刻意分离**：3D 生命周期错误与统计入参错误语义不同，宿主不应混用。

**代码示例**

javascript

```
import { calculateStatsList } from './dist-lib/dsp-blueprint-editor.esm.js';

// 1) 蓝图字符串 + 三级增产剂
const r = calculateStatsList(blueprintText, 3);
if (r.ok) {
    console.log('总耗电', r.value.totalPower, 'kW');
    for (const d of r.value.demand) {
        console.log('需求', d.name, d.count, '/min');
    }
    for (const o of r.value.output) {
        console.log('输出', o.name, o.count, '/min');
    }
} else {
    console.warn(r.error.code, r.error.message);
}

// 2) 已解析数据（对象形态接受最小 { buildings: [...] }）
const data = parseBlueprint(blueprintText);
const r2 = calculateStatsList(data, 0);   // 无增产剂

// 3) 批量核算
for (const file of files) {
    const s = calculateStatsList(file);
    if (s.ok) console.log(file, s.value.totalPower);
}
```

**验收对账基线**（与 `tests/unit/blueprint/stats.spec.ts` 同口径）

| 场景              | 增产剂    | `totalPower` | 需求                      | 输出         |
| :-------------- | :----- | :----------- | :---------------------- | :--------- |
| 分馏塔 ×1          | 无      | 3960 kW      | H2 72/min               | D2 72/min  |
| 分馏塔 ×1          | 一级     | 5148 kW      | H2 90/min、增产剂 7.5/min   | D2 90/min  |
| 分馏塔 ×1          | 二级     | 6732 kW      | H2 108/min、增产剂 4.5/min  | D2 108/min |
| 分馏塔 ×1          | 三级     | 9900 kW      | H2 144/min、增产剂 1.92/min | D2 144/min |
| 制造台 Mk.I + 铁块配方 | 无      | 270 kW       | 铁矿 45/min               | 铁块 45/min  |
| 制造台 Mk.I + 铁块配方 | 三级（加速） | 675 kW       | 铁矿 90/min、增产剂 1.2/min   | 铁块 90/min  |

text

```
---

### B-06-6 · §5.5 导出函数（代码块插 1 段 + 表格插 1 行）

**6a · 代码块内追加**
```

┌ 原文窗口
│ function setModelCacheEnabled(enabled: boolean | null): void;
│ function isModelCacheEnabled(): boolean;
│ `└ 在 ` isModelCacheEnabled ` 行之后、代码块结束` 之前插入

text

````
​```typescript
function isModelCacheEnabled(): boolean;
function calculateStatsList(
    input: string | BlueprintData,
    acceleratorItem?: 0 | 1 | 2 | 3,
): StatsListResult;
````

**6b · 表格追加**

text

```
┌ 原文窗口
│ | `isModelCacheEnabled` | 不抛异常 | 只表示开关本身；浏览器能力另由缓存是否真正生效决定 |
└ 在其后追加一行
```

markdown

```
| `isModelCacheEnabled` | 不抛异常 | 只表示开关本身；浏览器能力另由缓存是否真正生效决定 |
| `calculateStatsList` | 不抛异常 | 错误经 `{ ok: false, error }` 返回；算法复用 `calculateProductionStats` |
```

***

## 5. API 参考

### 5.1 构造函数

```typescript
new BlueprintViewer(options: ViewerOptions, callbacks?: ViewerCallbacks)
```

**`ViewerOptions`：**

| 参数                     | 类型                                        | 默认值                        | 说明                                                                                     |
| ---------------------- | ----------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `container`            | `HTMLElement \| string`                   | 必填                         | 容器元素或 CSS 选择器；找不到时初始化失败并记录 `no-container`，后续加载返回该错误                                    |
| `initialSettings`      | `Partial<ViewerRenderSettings>`           | —                          | 渲染设置；省略字段取默认值                                                                          |
| `showRealModels`       | `boolean`                                 | `true`                     | 是否用真实 GLB 模型                                                                           |
| `texturesEnabled`      | `boolean`                                 | `true`                     | 是否贴图                                                                                   |
| `maxInstancesPerModel` | `number`                                  | `Infinity`                 | 单模型最多实例化几栋                                                                             |
| `previewAnimation`     | `'auto' \| 'on' \| 'off'`                 | `'auto'`                   | 增量预览动画开关。`auto` = `prefers-reduced-motion: reduce` 或逻辑核数 < 4 时关闭，否则开启；`off` 不插值、直接跳到目标 |
| `autoResize`           | `boolean`                                 | `true`                     | 用 ResizeObserver 跟随容器尺寸                                                                |
| `pixelRatio`           | `number`                                  | `min(devicePixelRatio, 2)` | 渲染像素比                                                                                  |
| `keyboardTarget`       | `HTMLElement \| null`                     | 容器                         | 键盘（WASD 平移 / N 重置）事件目标                                                                 |
| `keepCamera`           | `boolean`                                 | `true`                     | 加载成功后是否保留当前镜头；`false` 回默认视角                                                            |
| `width`                | `number`                                  | 容器宽度                       | 显式渲染宽度；给出后容器 resize 不再覆盖                                                               |
| `height`               | `number`                                  | 容器高度                       | 显式渲染高度                                                                                 |
| `theme`                | `'editor' \| 'dark' \| 'light' \| 'auto'` | `'editor'`                 | 初始 3D 主题                                                                               |
| `settingsPort`         | `SettingsPort`                            | 进程内存端口                     | 与编辑器共用同一份设置时注入                                                                         |

> `initialSettings` 与平铺字段等价；同时给出时**平铺字段优先**。
> `previewAnimation` 在 `initialSettings` 中也合法，平铺字段同样优先。

**`SettingsPort`：**

```typescript
interface SettingsPort {
    read(): ViewerRenderSettings;
    write(patch: Partial<ViewerRenderSettings>): void;
}
```

与编辑器共用时的典型实现：

```typescript
const settingsPort = {
    read: () => renderSettings,
    write: (patch) => Object.assign(renderSettings, patch),
};
```

`write` 必须**同步写回**宿主；编辑器场景下会连带触发持久化。

### 5.2 实例方法总表

**加载 / 数据**

| 方法                        | 返回                      | 说明                                      |
| ------------------------- | ----------------------- | --------------------------------------- |
| `loadBlueprint(str)`      | `BlueprintLoadOutcome`  | 加载蓝图字符串，可多次调用切换蓝图                       |
| `loadBlueprintData(data)` | `BlueprintLoadOutcome`  | 加载数据对象（总是重建）                            |
| `loadBlueprintJSON(text)` | `BlueprintLoadOutcome`  | 从 JSON 文本导入（`Date` / `Uint8Array` 无损还原） |
| `getBlueprintData()`      | `BlueprintData \| null` | 最近一次**成功**加载的数据                         |
| `exportBlueprintJSON()`   | `string \| null`        | 导出可读 JSON（2 空格缩进）                       |

**增量预览**

| 方法                         | 返回                     | 说明                                |
| -------------------------- | ---------------------- | --------------------------------- |
| `beginPreview(options?)`   | `void`                 | 开始预览；会先丢弃上一次预览                    |
| `applyPreviewDelta(event)` | `boolean`              | 同步摄入一条差量；绝不抛错；未预览 / 已销毁返回 `false` |
| `commitPreview(blueprint)` | `BlueprintLoadOutcome` | 用正式蓝图串收尾（先建后换）                    |
| `discardPreview()`         | `void`                 | 丢弃预览层（失败 / 中止 / 离开页面）             |
| `previewing`               | `boolean`              | 只读属性：是否正在预览                       |
| `previewStats()`           | `PreviewStats \| null` | 运行期统计；未预览时 `null`                 |

**选中 / 定位 / 查询**

| 方法                                    | 返回                                       | 说明                                     |
| ------------------------------------- | ---------------------------------------- | -------------------------------------- |
| `selectBuilding(index \| null)`       | `BuildingLocateResult`                   | 选中单栋（只高亮，不动镜头）                         |
| `selectedBuildings(indexes \| null)`  | `BuildingsLocateResult`                  | 批量选中（去重、保持顺序；任一失败则整次失败）                |
| `focusBuilding(index \| null, opts?)` | `BuildingLocateResult`                   | 镜头居中对齐（不锁镜头）；`null` 等价 `resetCamera()` |
| `getSelectedIndex()`                  | `number \| null`                         | 单选结果；多选时返回第一项                          |
| `getSelectedIndexes()`                | `number[]`                               | 全部选中下标（副本）                             |
| `getBuildingInfo(index)`              | `ViewerQueryResult<BuildingInfoPayload>` | 建筑世界矩阵                                 |
| `resetCamera()`                       | `void`                                   | 重置为默认全局视角                              |

**相机 / 尺寸 / 主题 / 导出**

| 方法                         | 返回                          | 说明                                |
| -------------------------- | --------------------------- | --------------------------------- |
| `getCamera()`              | `PerspectiveCamera \| null` | 相机对象（只读用途）                        |
| `getCameraVersion()`       | `number`                    | 相机版本号；仅在真的变化的帧自增                  |
| `getCanvas()`              | `HTMLCanvasElement \| null` | 渲染 canvas                         |
| `setSize(w, h)`            | `void`                      | 显式尺寸；此后忽略容器 resize                |
| `resetSize()`              | `void`                      | 取消显式尺寸，恢复跟随容器                     |
| `setTheme(theme)`          | `void`                      | 切换主题                              |
| `setCustomTheme(colors)`   | `void`                      | 在当前主题上覆盖颜色                        |
| `getTheme()`               | `ThemeColors \| null`       | 当前主题色                             |
| `toDataURL()`              | `string \| null`            | 导出 base64 PNG                     |
| `toBlob()`                 | `Promise<Blob \| null>`     | 导出 Blob                           |
| `setRenderSettings(patch)` | `void`                      | 更新渲染设置                            |
| `setCallbacks(cbs, opts?)` | `void`                      | 更新回调（默认整体替换，`{ merge: true }` 合并） |
| `dispose()`                | `void`                      | 销毁实例，释放资源（幂等）                     |

### 5.3 回调

| 回调                 | 类型                                      | 说明                                          |
| ------------------ | --------------------------------------- | ------------------------------------------- |
| `onBuildingSelect` | `(pick: { index; id } \| null) => void` | 点击拾取命中；`index` 是数组下标，`id` 是建筑 ID；点空为 `null` |
| `onBuildingRemove` | `(index: number) => void`               | 移除请求（仅内核开启 `contextRemove` 时；Viewer 默认不开）   |
| `onCameraChange`   | `() => void`                            | 相机变化；仅在真的变化的帧触发，同帧最多一次                      |
| `onRebuild`        | `(info: RebuildInfo) => void`           | 场景重建完成（含模型懒加载触发的重建）                         |
| `onError`          | `(error: ViewerError) => void`          | 统一错误通道；按 `code + message` 去重                |

`setCallbacks` 语义：

```javascript
viewer.setCallbacks({ onBuildingSelect: fn });                 // 整体替换，旧回调不再触发
viewer.setCallbacks({ onCameraChange: fn2 }, { merge: true }); // 合并
```

### 5.4 返回值与错误码

**所有加载 / 查询方法不抛异常**，统一按 `ok` 收窄：

```typescript
type BlueprintLoadOutcome = { ok: true; value: BlueprintLoadResult } | { ok: false; error: ViewerError };
type ViewerQueryResult<T>  = { ok: true; value: T }                | { ok: false; error: ViewerError };
type BuildingLocateResult  = { ok: true; index: number }           | { ok: false; error: ViewerError };
type BuildingsLocateResult = { ok: true; indexes: number[] }       | { ok: false; error: ViewerError };
// ---- 统计列表（calculateStatsList）

type StatsListErrorCode =
    | 'parse-failed'
    | 'invalid-accelerator'
    | 'invalid-argument';

interface StatsListError {
    code: StatsListErrorCode;
    message: string;
    cause?: unknown;
}

interface StatsListItem {
    itemId: number;
    name: string;    // itemsMap 原文中文键，不翻译
    count: number;   // 每分钟
}

interface StatsListValue {
    totalPower: number;        // kW
    demand: StatsListItem[];   // = consumed，按 count 降序
    output: StatsListItem[];   // = produced，按 count 降序
}

type StatsListResult =
    | { ok: true; value: StatsListValue }
    | { ok: false; error: StatsListError };
```

| `error.phase` | `error.code`                                                                                                         | 含义                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `parse`       | `invalid-start` / `header-too-short` / `checksum-missing` / `checksum-mismatch` / `buffer-overflow` / `parse-failed` | 蓝图字符串解析失败                      |
| `parse`       | `json-syntax` / `json-shape`                                                                                         | `loadBlueprintJSON` 的语法 / 结构错误 |
| `position`    | `no-root-area` / `no-longitude` / `inconsistent-area`                                                                | 蓝图数据不自洽（用户可修）                  |
| `build`       | `build-failed`                                                                                                       | 渲染构建内部失败（保留旧场景）                |
| `lifecycle`   | `no-container` / `no-webgl` / `already-disposed`                                                                     | 初始化 / 生命周期                     |
| `lifecycle`   | `not-loaded` / `building-not-found` / `not-renderable`                                                               | 查询类失败（未加载 / 找不到 / 无可用矩阵）       |

**失败语义**

- 加载失败：不抛异常，场景、相机、`getBlueprintData()` 保持上一次成功状态；
- 查询失败：不改动选中 / 镜头（`focusBuilding` 在选中前先校验）；
- `onError` 会按 `code + message` 去重；无回调时仍会在控制台留下 `[viewer] phase/code: message`。

### 5.5 导出函数

```typescript
function parseBlueprint(str: string): BlueprintData;
function serializeBlueprint(data: BlueprintData): string;
function configureAssetBaseUrl(baseUrl: string | null | undefined): void;
function setModelCacheEnabled(enabled: boolean | null): void;
function isModelCacheEnabled(): boolean;
function calculateStatsList(
    input: string | BlueprintData,
    acceleratorItem?: 0 | 1 | 2 | 3,
): StatsListResult;
```

| 函数                      | 失败行为    | 说明                                                            |
| ----------------------- | ------- | ------------------------------------------------------------- |
| `parseBlueprint`        | **抛异常** | 调用前建议 `try/catch`，或用 `viewer.loadBlueprint`                   |
| `serializeBlueprint`    | **抛异常** | 数据不自洽（如 `header.time` 非 `Date`）时抛 TypeError                   |
| `configureAssetBaseUrl` | 不抛异常    | `null` / `undefined` / `''` 清除配置                              |
| `setModelCacheEnabled`  | 不抛异常    | 全局开关；`null` 恢复 `config/persistence.config.js` 的构建配置值          |
| `isModelCacheEnabled`   | 不抛异常    | 只表示开关本身；浏览器能力另由缓存是否真正生效决定                                     |
| `calculateStatsList`    | 不抛异常    | 错误经 `{ ok: false, error }` 返回；算法复用 `calculateProductionStats` |

***

## 6. 类型定义

```typescript
type ThemeName = 'dark' | 'light' | 'editor' | 'auto';

interface ViewerOptions {
    container: HTMLElement | string;
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    previewAnimation?: PreviewAnimationMode;
    autoResize?: boolean;
    pixelRatio?: number;
    keyboardTarget?: HTMLElement | null;
    keepCamera?: boolean;
    width?: number;
    height?: number;
    theme?: ThemeName;
    settingsPort?: SettingsPort;
}

interface ViewerRenderSettings {
    readonly showRealModels: boolean;
    readonly texturesEnabled: boolean;
    readonly maxInstancesPerModel: number;
    readonly previewAnimation?: PreviewAnimationMode;
}

type PreviewAnimationMode = 'auto' | 'on' | 'off';

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

interface SettingsPort {
    read(): ViewerRenderSettings;
    write(patch: Partial<ViewerRenderSettings>): void;
}

interface BlueprintLoadResult {
    buildingCount: number;
    areas: BlueprintArea[];
    header: BlueprintData['header'];
    unknownModelIndexes: number[];
    /** 已上报过的诊断键（`code:message`，按首次出现去重）；资源类问题请以 `onError` 为准 */
    warnings: string[];
}

type ViewerErrorPhase = 'parse' | 'position' | 'build' | 'lifecycle';

type ViewerErrorCode =
    // 解析
    | 'invalid-start' | 'header-too-short' | 'checksum-missing'
    | 'checksum-mismatch' | 'buffer-overflow' | 'parse-failed'
    // JSON 导入
    | 'json-syntax' | 'json-shape'
    // 定位
    | 'no-root-area' | 'no-longitude' | 'inconsistent-area'
    // 构建 / 生命周期
    | 'build-failed' | 'no-container' | 'no-webgl' | 'already-disposed'
    // 查询
    | 'not-loaded' | 'building-not-found' | 'not-renderable';

interface ViewerError {
    code: ViewerErrorCode;
    phase: ViewerErrorPhase;
    message: string;
    cause?: unknown;
}

type BlueprintLoadOutcome =
    | { ok: true; value: BlueprintLoadResult }
    | { ok: false; error: ViewerError };

type ViewerQueryResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: ViewerError };

type BuildingLocateResult =
    | { ok: true; index: number }      // index = -1 表示「已清除选中」
    | { ok: false; error: ViewerError };

type BuildingsLocateResult =
    | { ok: true; indexes: number[] }
    | { ok: false; error: ViewerError };
// ---- 统计列表（calculateStatsList）

type StatsListErrorCode =
    | 'parse-failed'
    | 'invalid-accelerator'
    | 'invalid-argument';

interface StatsListError {
    code: StatsListErrorCode;
    message: string;
    cause?: unknown;
}

interface StatsListItem {
    itemId: number;
    name: string;    // itemsMap 原文中文键，不翻译
    count: number;   // 每分钟
}

interface StatsListValue {
    totalPower: number;        // kW
    demand: StatsListItem[];   // = consumed，按 count 降序
    output: StatsListItem[];   // = produced，按 count 降序
}

type StatsListResult =
    | { ok: true; value: StatsListValue }
    | { ok: false; error: StatsListError };
```

**增量预览类型**（公共类型，可从 `dist-lib/index.d.ts` 直接引用；源码侧见 `src/lib/types.ts` / `src/lib/preview/types.ts`）：

```typescript
type PreviewCoordinateSystem =
    | 'layout-grid-v1'
    | 'blueprint-area-local-v1'
    | (string & Record<never, never>);

interface PreviewVec3 { readonly x: number; readonly y: number; readonly z: number }

interface PreviewAreaLike {
    readonly index: number;
    readonly parentIndex?: number;
    readonly tropicAnchor?: number;
    readonly areaSegments: number;
    // 扁平形态（历史）
    readonly anchorLocalOffsetX?: number;
    readonly anchorLocalOffsetY?: number;
    readonly width?: number;
    readonly height?: number;
    // 嵌套形态（新）
    readonly anchorLocalOffset?: { readonly x: number; readonly y: number };
    readonly size?: { readonly x: number; readonly y: number };
}

interface PreviewBuildingLike {
    readonly index?: number;
    readonly isTemporary?: boolean;
    readonly itemId: number;
    readonly modelIndex: number;
    readonly areaIndex?: number;
    readonly localOffset: PreviewVec3;
    readonly localOffset2?: PreviewVec3;
    readonly yaw: number;
    readonly yaw2?: number;
    readonly tilt?: number;
    readonly tilt2?: number;
    readonly pitch?: number;
    readonly pitch2?: number;
    readonly inputObjectId?: string | null;
    readonly outputObjectId?: string | null;
    readonly inputFromSlot?: number;
    readonly outputToSlot?: number;
    readonly productionIndex?: number;
}

type PreviewOperation =
    | { readonly type: 'add' | 'replace'; readonly objectId: string; readonly building: PreviewBuildingLike }
    | { readonly type: 'remove'; readonly objectId: string };

interface PreviewDeltaEvent {
    readonly kind?: string;
    readonly protocolVersion?: number;
    readonly taskId?: string;
    readonly sequence?: number;
    readonly stage?: string;
    readonly message?: string;
    readonly coordinateSystem?: PreviewCoordinateSystem;
    readonly operations?: readonly PreviewOperation[];
    readonly areas?: readonly PreviewAreaLike[];
    readonly primaryAreaIndex?: number;
    readonly previewBatch?: unknown;
}

interface PreviewBeginOptions {
    projector?: 'sphere' | 'plane';
    settleMs?: number;
    enterDelayMs?: number;
    minLifeMs?: number;
}

interface PreviewStats {
    readonly events: number;
    readonly operations: number;
    readonly droppedEvents: number;
    readonly unknownRemoves: number;
    readonly unknownReplaces: number;
    readonly alive: number;
    readonly fading: number;
    readonly peakAlive: number;
    readonly moving: number;
    readonly slots: number;
    readonly filteredByThrash: number;
    readonly coordinateSystem: PreviewCoordinateSystem | null;
    readonly lastIngestMs: number;
    readonly maxIngestMs: number;
    readonly disposed: boolean;
}
```

**蓝图数据类型**（节选，完整声明见 `dist-lib/index.d.ts`）：

```typescript
interface BlueprintArea {
    index: number;
    parentIndex: number;
    tropicAnchor: number;
    areaSegments: number;
    anchorLocalOffset: { x: number; y: number };
    size: { x: number; y: number };
}

interface BlueprintBuilding {
    index: number;
    areaIndex: number;
    localOffset: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
    yaw: [number, number];
    tilt: number;
    itemId: number;
    modelIndex: number;
    outputObjIdx: number;
    inputObjIdx: number;
    outputToSlot: number;
    inputFromSlot: number;
    outputFromSlot: number;
    inputToSlot: number;
    outputOffset: number;
    inputOffset: number;
    recipeId: number;
    filterId: number;
    /** 建筑类型相关参数（不同 itemId 结构不同；发布声明为 Record<string, unknown>） */
    parameters: null | Record<string, unknown>;
    v2ExtraPose?: number[];
    content?: string;
    extraBytes?: Uint8Array;
}

interface BlueprintData {
    header: {
        layout: number;
        icons: number[];
        time: Date;
        gameVersion: string;
        shortDesc: string;
        author: string;
        blueprintVersion: string;
        properties: string;
        desc: string;
    };
    version: number;
    cursorOffset: { x: number; y: number };
    cursorTargetArea: number;
    dragBoxSize: { x: number; y: number };
    primaryAreaIdx: number;
    areas: BlueprintArea[];
    buildings: BlueprintBuilding[];
    patch?: number;
    /** v2 body：地基数据（无地基时为 null；发布声明为 unknown） */
    reformData?: unknown | null;
    tailExtraBytes?: Uint8Array;
}
```

***

## 7. 输入输出格式规范

### 7.1 蓝图字符串

- 以 `BLUEPRINT:` 开头，分段以 `,` 分隔；
- `parseBlueprint` 要求**原样**以 `BLUEPRINT:` 开头；`loadBlueprint` / `commitPreview` 会先 `trim`；
- 失败时 `loadBlueprint` 返回 `ok: false`，`parseBlueprint` 抛异常。

### 7.2 渲染数据流

```
蓝图字符串 ──parseBlueprint──▶ BlueprintData ──loadBlueprintData──▶ 场景
     ▲                                  │
     │                                  ├──serializeBlueprint──▶ 蓝图字符串
     │                                  └──exportBlueprintJSON──▶ JSON 文本
     └──────────────loadBlueprint ◀─────┘
JSON 文本 ──loadBlueprintJSON──▶ BlueprintData ──（同一条应用链路）──▶ 场景
```

### 7.3 JSON 文本

- 导出：2 空格缩进；`Date` → ISO 字符串；`Uint8Array` → `{"0":…}`；
- 导入：根节点对象，必须含 `header`（对象）、`areas`（数组）、`buildings`（数组）；
- `header.time`：ISO 字符串或时间戳；
- 错误码：`json-syntax`（JSON 语法）、`json-shape`（结构 / 字段类型）。

### 7.4 preview-delta 事件

见 [4.2 预览事件输入格式](#预览事件输入格式)。最小可工作事件：

```json
{
  "kind": "preview-delta",
  "sequence": 1,
  "operations": [
    {
      "type": "add",
      "objectId": "b1",
      "building": {
        "itemId": 2001,
        "modelIndex": 35,
        "localOffset": { "x": 0, "y": 0, "z": 0 }
      }
    }
  ]
}
```

> `yaw` 省略按 `0`；`areaIndex` 省略按 `0`；`localOffset2` / `yaw2` 省略时按第一端。

### 7.5 `PreviewStats` 输出形状

数值随蓝图与事件流变化；`events` / `operations` / `alive` / `peakAlive` 取自产物自带
`preview-fixture.json` 的验收基线，其余字段用于说明语义：

```javascript
{
  events: 252,
  operations: 7186,
  droppedEvents: 0,          // 有序投递
  unknownRemoves: 0,
  unknownReplaces: 0,
  alive: 246,                // 流结束后 = 净增量
  fading: 0,                 // 收敛后回落
  peakAlive: 490,            // 样本验收基线
  moving: 0,                 // 收敛后回落到 0
  slots: 512,                // 各池高水位之和（用于显存预估）
  filteredByThrash: 0,       // 事件稀疏时通常为 0
  coordinateSystem: 'blueprint-area-local-v1',
  lastIngestMs: 0.8,
  maxIngestMs: 2.4,
  disposed: false
}
```

***

## 8. 注意事项与最佳实践

### 8.1 通用

1. **容器必须有尺寸**。`height: 0` 的容器会得到空画面；库不会替你撑开布局。
2. **必须 http(s) 访问**。`file://` 下模型 / 图标会被 CORS 拦截；本地验证用 `npx serve dist-lib`。
3. **一页一个 Viewer**。模型 / 贴图 / 图标缓存是模块级单例；多实例会重复占显存。
4. **始终** **`dispose()`**。组件卸载 / 页面销毁时调用，释放 rAF、定时器、ResizeObserver、控件、几何、材质、renderer。
5. **按** **`ok`** **收窄，不靠异常**。只有 `parseBlueprint` / `serializeBlueprint` 会抛异常。
6. **优先用** **`onError`** **做诊断**。错误已按 `code + message` 去重，不会刷屏。
7. **TypeScript 宿主装** **`@types/three`**。类型声明引用 `Matrix4` / `PerspectiveCamera`，运行时不需要 three。

### 8.2 加载与状态

1. 加载失败**不会破坏上一次成功画面**；可以先展示旧蓝图，再提示用户修正输入。
2. `keepCamera: true`（默认）适合「切换蓝图但保持观察角度」；希望每次回到默认视角时传 `false`。
3. 换蓝图会清空选中态，宿主需同步清空自己的选中 UI。
4. `index` 与 `id` 不是同一个概念：`index` 是数组下标，`id` 是蓝图里的建筑 ID。
   绝大多数情况下相等，但蓝图按区域分组存储，不保证顺序。
5. `getBuildingInfo(index)` 只接受**数组下标**，不做 ID 兜底；`selectBuilding` / `focusBuilding`
   在越界时才会按 ID 兜底。

### 8.3 增量预览

1. **顺序**：`beginPreview` → 提交生成请求 → `onProgress` 内 `applyPreviewDelta` → `commitPreview` / `discardPreview`。
2. **同步转发**：不要在回调里 `await`、不要攒队列、不要 `setTimeout` 延迟应用；
   预览层本身就是「逻辑立即生效 + 视觉持续收敛」。
3. **不要逐条播放动画**：事件到达速度（≈50 条/秒）远高于可感知动画时长；
   逐条播放会把总时长拖到分钟级。
4. **`commitPreview`** **只收蓝图字符串**；如果后端给的是 `BlueprintData`，先 `serializeBlueprint`。
5. **预览对象不可交互**：点击拾取 / 选中 / 聚焦只作用于正式场景；预览期间若需要交互，
   应等 `commitPreview` 完成。
6. **不支持回退**：需要回看较早状态时，`discardPreview` + `beginPreview` + 从 0 重放。
7. **低端机 / 无障碍**：`previewAnimation: 'off'` 后事件照常应用，只是不插值（直接跳到目标）；
   也可用 `setRenderSettings({ previewAnimation: 'off' })` 运行时切换，无需重新出包。
8. **抖动抑制默认值适合真实流**；若后端事件更稀疏、希望每个对象都可见，可把
   `enterDelayMs` / `minLifeMs` 设为 `0`。
9. **长会话**：每次生成结束都 `commitPreview` 或 `discardPreview`，避免预览层常驻。
10. **容量**：单池初始容量为传送带 4096、分拣器 / GLB / 回退盒 512，按需翻倍至 `2^18`；
    容量到顶时该次操作跳过，不会在回调里分配 GPU 缓冲。

### 8.4 资产与部署

1. 资产（`models/`、`basis/`、`img/`）必须与产物同目录，或显式 `configureAssetBaseUrl`；
2. KTX2 模型依赖 `basis/` 转码器；缺失时模型退化为无贴图（几何仍保留），并留下告警；
3. CDN 部署需允许跨域（CORS）；建议开启 gzip/br 与长缓存；
4. 模型有浏览器本地缓存（Cache Storage），首次加载后再次访问走缓存；缓存键随 URL 变化自动失效。

### 8.5 性能

1. 3 万级建筑建议保持 `showRealModels: true` 与默认 `maxInstancesPerModel: Infinity`，
   由 GLB 实例化 + 池化承担；若显存紧张再降低上限，超出部分自动走回退盒。
2. 预览峰值可达 3 万+ 实例，避免同时开启多个 Viewer；
3. `texturesEnabled` 切换是原地重挂，成本远低于重建，可放心用于设置面板；
4. `previewAnimation: 'off'` 可显著降低低端设备的每帧计算量；
5. 导出截图会先渲染一帧，可直接在 rAF 之外调用。

***

## 9. 自检与验证

### 9.1 单元测试

```bash
npx jest tests/unit/lib tests/unit/preview --runInBand
yarn test:preview          # 同上，只跑 preview
```

覆盖内容：

- `blueprintViewer.spec.ts`：加载 / 失败保留 / `keepCamera` / 单选 / 多选 / 聚焦 / 查询 / 主题 / 回调；
- `previewLayer.spec.ts`：序号去重、未知 remove/replace、抖动抑制、收敛、容量、坐标切换；
- `projector.spec.ts`：layout 自适应缩放、扁平/嵌套 areas、与 `calcBuildingTrans` 逐位一致；
- `fixture.spec.ts` / `replay.spec.ts`：真实样本回放（`replay` 默认跳过；PowerShell 用
  `$env:PREVIEW_REPLAY=1; npx jest tests/unit/preview/replay.spec.ts`，bash 用 `PREVIEW_REPLAY=1 npx jest tests/unit/preview/replay.spec.ts`）；
- `assetBaseUrl.spec.ts`：资产根探测优先级与显式配置；
- `buildBVH.spec.ts` / `iconTexture.spec.ts` / `planetMapControls.spec.ts`：BVH、图标纹理与相机控件；
- `describeBuild.spec.ts`：构建快照字段与稳定性。

本次文档更新时实际执行结果：**9 个测试套件通过、94 个用例通过、1 个跳过**。

### 9.2 构建产物冒烟

```bash
yarn build:lib
npx serve dist-lib
```

打开：

- `host-test.html`：UMD 全局、fixture 加载、网络零 404、截图非空；
- `esm-test.html`：动态 `import()` ESM，并在 `<base>` 干扰下验证 `import.meta.url` 资产探测；
- `preview-test.html`：252 条事件 / 7,186 个操作回放，页内自动核对验收口径。

### 9.3 解析 / 序列化冒烟

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL('./dist-lib/dsp-blueprint-editor.esm.js').href);
const s = readFileSync('./public/demo/sample_throughput.txt', 'utf8').trim();
const d = m.parseBlueprint(s);
console.log(d.buildings.length, d.areas.length, d.header.shortDesc);
console.log(m.serializeBlueprint(d).length === s.length);
"
```

实测输出：`15 1 Throughput matcher` / `true`，即解析与序列化往返长度一致。

***

## 10. 与既有功能的关系

### 10.1 分层关系

```
┌────────────────────────────────────────────────────────────┐
│ 宿主页面 / Wails / MES                                     │
│   └─ BlueprintViewer（门面：生命周期、错误分类、选中、预览） │
│        ├─ RenderCore（场景构建、相机、拾取、BVH、主题）       │
│        │    ├─ buildBuildings / AllBuildings / BVH           │
│        │    ├─ planet / theme / iconHelpers                  │
│        │    └─ PreviewLayer（增量预览临时层）                 │
│        └─ parseBlueprint / serializeBlueprint（数据层）       │
└────────────────────────────────────────────────────────────┘
```

- **解析层**与编辑器共用 `src/blueprint/parser`；
- **渲染内核**与编辑器共用 `src/lib/core/`、`src/models/`、`src/data/`；
- **预览层**复用同一套 `findPosForAreas` / `calcBuildingTrans` 数学，保证预览位置与正式结果一致；
- **Viewer 不依赖 Vue**，可在任意框架或无框架页面中使用。

### 10.2 新增功能与既有功能的关联

| 新增能力               | 依赖 / 关联的既有能力                                 | 关系说明                                                   |
| ------------------ | -------------------------------------------- | ------------------------------------------------------ |
| 增量预览               | `RenderCore` 场景、`calcBuildingTrans`、GLB / 池化 | 预览是独立 `Group`，不进入正式 BVH；`commitPreview` 才切到正式场景        |
| 建筑多选               | 单选、BVH 选择盒                                   | 复用同一套选择盒池，按需扩容；单选是「只含一个元素的多选」                          |
| `focusBuilding`    | 相机控件、BVH                                     | 只移动相机，不锁目标点；与 `selectBuilding` 可一条调用组合                 |
| JSON 导入导出          | `loadBlueprintData` / `getBlueprintData`     | JSON 入口只是在同一应用链路上多一步类型还原 / 序列化                         |
| editor 主题          | `RenderCore.setTheme`、天光/星空                  | 新默认主题；`dark` / `light` 保持 v1 纯色板                       |
| 外置 GLB / KTX2      | `buildBuildings`、`assetResolver`             | 库构建用字符串拼接资产 URL；编辑器构建保留 webpack `require.context`，行为不变 |
| `previewAnimation` | `settingsPort` / 渲染设置                        | 与既有设置通道共用，宿主零新增机制即可运行时开关                               |
| `describeBuild`    | `BuildStats`、BVH                             | 把构建产物转成可比对快照，用于回归定位                                    |

### 10.3 迁移提示

| 需求      | 旧做法                        | 当前推荐                                                        |
| ------- | -------------------------- | ----------------------------------------------------------- |
| 加载蓝图    | 自己解析后塞进渲染器                 | `loadBlueprint` / `loadBlueprintData` / `loadBlueprintJSON` |
| 选中建筑    | 直接操作场景对象                   | `selectBuilding` / `selectedBuildings`，统一走门面                |
| 定位镜头    | 自己算相机位置                    | `focusBuilding(index, { distance, select })`                |
| 生成过程可视化 | 逐条动画 / 轮询全量                | `beginPreview` + `applyPreviewDelta` + `commitPreview`      |
| 跨进程数据   | 手工还原 `Date` / `Uint8Array` | `loadBlueprintJSON` / `exportBlueprintJSON`                 |
| 低端机降级   | 重新出包关闭动画                   | `previewAnimation: 'off'`                                   |
| 资产路径    | 写死 CDN / publicPath        | `configureAssetBaseUrl` + 自动探测                              |

