# BlueprintViewer 实施方案（v2 修订版）

> 状态：已定稿（评审通过，待实施）· 修订日期：2026-10-30
> 依据：`src/components/BlueprintEditor.vue`（814 行）、`src/models/*`、`src/blueprint/*`、`src/PlanetMapControls.ts`、`src/iconTexture.ts` 的实际代码，以及 `docs/CODE_WIKI.md` §6.7 / §16.5 / §16.9 / §16.10。
> 本版替代 v1 草案；v1 与本版的差异见 §0。

---

## 0. 本版改了什么

### 0.1 八条方向性决策（已确认）

| 编号 | 方向 | 决策 | 直接影响 |
| --- | --- | --- | --- |
| D1 | Vue 依赖 | **彻底解耦**：`src/lib/core/` 不出现任何 `from 'vue'` 的 import，渲染设置改为参数注入 | 需改 `materialTextures.ts` 5 处读点、`glbLoader.ts` 2 处调用点 |
| D2 | 设置归属 | **单一全局 + 持久化**，Viewer 通过 SettingsPort 做投影 | 同页多 Viewer 不能各用各的设置（写入 §8 限制） |
| D3 | 交付形态 | **仅源码引用**，按可发布设计 API，但不建 lib 构建 | `assetBaseUrl` 等字段只占位不实现 |
| D4 | 修复边界 | **允许顺带修**已确认缺陷 | A 阶段包含 4 项缺陷修复 + 1 项确定性修正（D7） |
| D5 | 阶段 C | **本轮不做**，但预留接口 | 保留两份场景生命周期，接口先定 |
| D6 | 多实例 | **只保证单实例**，多实例文档标记为不支持 | dispose 与缓存共享语义按单实例简化 |
| D7 | 上限计数口径 | **按「存在 `glbName` 的实例数」判定**，不再依赖加载进度 | 编辑器渲染结果变得确定（同一蓝图同一设置可复现） |
| D8 | 相机重置 | `loadBlueprint` 成功后**默认 `resetCamera()`**，`keepCamera: true` 关闭 | Viewer 换蓝图不再停在旧视角；编辑器不受影响 |

### 0.2 相对 v1 的契约修正（重要）

| # | v1 的问题 | v2 的处理 |
| --- | --- | --- |
| 12 | 方案原定 `core/settings.ts` 放设置定义 | 实施中改为 `src/renderSettingsTypes.ts`：`materialTextures` / `glbLoader` 也要用这些类型，放进 `lib/core` 会造成 `models → lib` 的反向依赖 |
| --- | --- | --- |
| 1 | 「纯 TS 不依赖 Vue」与 `renderSettings.ts` 的 `reactive` 单例冲突 | D1：core 收 `ViewerRenderSettings` 参数，不再模块内读全局；Vue 侧保留单例作为 port 实现 |
| 2 | `RenderSettings` 与 `src/renderSettings.ts` 同名不同形（缺 `textures` 7 通道） | 改用显式的 `ViewerRenderSettings`（三字段），并在 `renderSettings.ts` 加双向可赋值断言；禁止另起同名类型 |
| 3 | 把「`texturesEnabled` 是否重建」列为未决风险 | 已定论：**只走 reapply，不重建**（§4.1） |
| 4 | `setBlueprintData` 注释写「返回 `{buildings, bvh, pos}`」而签名是 `: void` | 定稿为 `void`，诊断数据走 `getSceneModel()`（§3.3） |
| 5 | `dispose()` 未定义释放边界 | 两张清单：必释放 / 禁止释放（§6.5） |
| 6 | `buildBVH` 用 `!` 断言，与 `buildBoxes` 的兜底意图相反 | 列为 A 阶段必须修的现存缺陷（§5 第 10 行） |
| 7 | `{ error: string }` 无法区分可修复/内部缺陷 | `error.code + error.phase` 结构化（§6.4） |
| 8 | 缺少模型懒加载后的重建、原地改数据入口 | 新增 `notifyDataChanged()`、模型到达自动重建（§6.2） |
| 9 | `ViewerOptions` 缺尺寸/键盘/相机策略 | 补齐 `autoResize / pixelRatio / keyboardTarget / keepCamera`（§3.1） |
| 10 | 单测要求「dispose 后无残留 canvas」但 jsdom 无 WebGL | 渲染器与纹理 sink 可注入（§3.3、§7.4） |
| 11 | 多处引用 `lib-README.md` 的既有约定 | 仓库中无此文件，v2 改为「新建」，其约定由本方案重新定义 |

> 一并更正：评审中「`ViewerOptions` 缺 container」一条不成立——v1 已写了 `container`；真正缺的是尺寸、键盘与相机策略，本版在 §3.1 补齐。

---

## 1. 目标与边界

### 1.1 目标

在仓库内新增 `src/lib/`，把 `BlueprintEditor.vue` 里的 Three.js 装配逻辑下沉为**与 Vue 无关**的 `core/`，在其上包一层 `BlueprintViewer` 类，实现「只读蓝图渲染器」。编辑器与 Viewer 共用同一套构建函数，避免 GLB / 贴图逻辑分叉。

### 1.2 渲染范围（做）

- 星球球体 + 经纬网格 + 灯光
- 建筑：外部 GLB（`GlbModelInstances`）或元数据盒回退
- 传送带 / 分拣器 / 货物动画（`Cargos`）
- 图标图集（`IconTexture`）与 `IconSubscript` 数字下标
- BVH 拾取（含星球遮挡判定）

### 1.3 不做（明确排除）

- 地基 `buildReforms`
- 放置 / 删除 / 预览 / 快捷键 / 侧栏等编辑态
- 自定义星球半径（`R`、`SEGMENT` 为编译期常量，见 §5）
- 全球画布 `expandToGlobalCanvas`
- 多实例并行（D6）
- lib 构建产物（D3）

### 1.4 硬约束

1. `src/lib/core/**` 不得 import `vue`。允许的 import 白名单：`three`、`@/blueprint/*`、`@/data/*`、`@/models/*`、`@/bvh`、`@/icons`、`@/iconTexture`、`@/cargos`、`@/iconSubscript`、`@/SphereGridGeometry`、`@/PlanetMapControls`、`@/planetConstants`、`src/lib/*`。
2. 单实例：一个页面只允许一个 `BlueprintViewer`（D6）。
3. 失败不抛异常：所有公开方法返回结构化结果或经 `onError` 上报；内部 catch 后保持上一份可用场景。
4. 资源释放只做「自己创建的」，不碰进程级缓存（§6.5）。

---

## 2. 目录结构

```text
src/
├── planetConstants.ts            # 新增：PLANET_RADIUS / PLANET_SEGMENT（见 §5 第 1 行）
├── renderSettings.ts             # 改动：改为基于 core 的纯数据 + reactive 包装，提供 settingsPort 适配器
├── models/
│   ├── materialTextures.ts       # 改动：函数签名收 settings 参数
│   ├── glbLoader.ts              # 改动：reapply 收 settings；新增 setSettingsProvider
│   ├── buildingModel.ts          # 改动：GRID_HORIZONTAL 改从 planetConstants 取
│   └── ...
├── iconTexture.ts                # 改动：loaded 按槽位索引、新增 dispose()、renderer 改注入式接口
├── components/
│   └── BlueprintEditor.vue       # 改动：import core；顶层构建函数删除（阶段 A）
└── lib/
    ├── index.ts                  # 出口：BlueprintViewer / 类型 / parseBlueprint
    ├── BlueprintViewer.ts        # 纯 TS 对外类
    ├── types.ts                  # 全部公开类型
    └── core/
        ├── types.ts              # core 内部类型（BuildingModelRef / BuildStats / SceneModel）
        ├── geometryHelpers.ts    # inserterTrans / INSERTER_HEIGHT（渲染与选择盒共用）
        ├── RenderCore.ts         # 场景/相机/renderer/controls/rAF/重建/dispose
        ├── AllBuildings.ts       # 从 .vue 抽出
        ├── planetScene.ts        # 星球 + 经纬网格 + 灯光
        ├── buildBuildings.ts     # 建筑/GLB/图标/Cargos/下标装配（返回 stats）
        ├── buildBVH.ts           # 选择盒 + BVH（未知模型兜底）
        ├── iconHelpers.ts        # buildingIconId / beltIconId / sorterIconId / 位置计算
        └── describeBuild.ts      # 诊断对象（测试与问题定位用，§附录 A）
```

`BlueprintEditor.vue` 阶段 A 后只保留：Vue 生命周期、放置/删除/预览/选中/快捷键、侧栏联动、`registerUpdater`（留在 Vue 层，见 §5 第 7 行）。

---

## 3. 类型与 API 定稿

### 3.1 `src/lib/types.ts`

```ts
import type { BlueprintArea, BlueprintData } from '@/blueprint/blueprint';

/**
 * 只暴露三个设置；textures 的 7 个通道开关不进 Viewer API（D2）。
 * 有意不 import `@/renderSettings`：该模块 import vue，
 * 结构性兼容 `Pick<RenderSettings, 'showRealModels' | 'texturesEnabled' | 'maxInstancesPerModel'>`
 * 由 `src/renderSettings.ts` 侧的类型断言保证双向可赋值（`RenderSettings extends ViewerRenderSettings`）。
 */
export interface ViewerRenderSettings {
    showRealModels: boolean;
    texturesEnabled: boolean;
    maxInstancesPerModel: number;
}

export interface ViewerOptions {
    /** 必填。元素或选择器；选择器解析失败返回 no-container 错误 */
    container: HTMLElement | string;
    /** 初始设置；与下面三个平铺字段二选一，平铺字段优先（兼容 v1 写法） */
    initialSettings?: Partial<ViewerRenderSettings>;
    showRealModels?: boolean;
    texturesEnabled?: boolean;
    maxInstancesPerModel?: number;
    /** 是否跟随容器尺寸（ResizeObserver）。default true */
    autoResize?: boolean;
    /** default: min(devicePixelRatio, 2) */
    pixelRatio?: number;
    /** 键盘事件目标（PlanetMapControls.listenToKeyEvents）。default: container */
    keyboardTarget?: HTMLElement | null;
    /** loadBlueprint 成功后是否保留当前相机。default false（自动 resetCamera） */
    keepCamera?: boolean;
    /**
     * 设置读写端口。缺省时使用进程内存中的一份投影（单例），
     * 与编辑器共用时由宿主传入 reactive 适配器（§4.2）
     */
    settingsPort?: SettingsPort;
}

export interface SettingsPort {
    read(): ViewerRenderSettings;
    /** 必须同步写回宿主（编辑器场景下会触发 persistRenderSettings） */
    write(patch: Partial<ViewerRenderSettings>): void;
}

export interface ViewerCallbacks {
    onBuildingSelect?(index: number | null): void;
    /** 仅 interaction.contextRemove = true 时触发（阶段 C 预留） */
    onBuildingRemove?(index: number): void;
    /** 仅在 controls.update() 返回 true 的帧触发；同一帧最多一次 */
    onCameraChange?(): void;
    onRebuild?(info: RebuildInfo): void;
    /** 非致命问题（未知 modelIndex、资源缺失）与致命错误都走这里 */
    onError?(error: ViewerError): void;
}

export interface RebuildInfo {
    reason: 'load' | 'settings' | 'data' | 'models';
    buildingCount: number;
    unknownModelIndexes: number[];
    durationMs: number;
}

export interface BlueprintLoadResult {
    buildingCount: number;
    areas: BlueprintArea[];
    header: BlueprintData['header'];
    /** 无 buildingMeta 的 modelIndex：已按隐藏占位处理，不参与拾取 */
    unknownModelIndexes: number[];
    warnings: string[];
}

export type ViewerErrorPhase = 'parse' | 'position' | 'build' | 'lifecycle';

export interface ViewerError {
    code: ViewerErrorCode;
    phase: ViewerErrorPhase;
    message: string;
    cause?: unknown;
}

export type ViewerErrorCode =
    | 'invalid-start' | 'header-too-short' | 'checksum-missing' | 'checksum-mismatch'
    | 'buffer-overflow' | 'no-root-area' | 'no-longitude' | 'inconsistent-area'
    | 'build-failed' | 'parse-failed'
    | 'no-container' | 'no-webgl' | 'already-disposed';

export type BlueprintLoadOutcome =
    | { ok: true; value: BlueprintLoadResult }
    | { ok: false; error: ViewerError };
```

> 判别方式由 v1 的 `'error' in result` 改为 `result.ok`，便于 TS 收窄；`ok: false` 时**不改变**当前场景与 `getBlueprintData()` 的返回值。

### 3.2 `src/lib/core/types.ts`

```ts
export interface ModelRefInstanced { mesh: InstancedMesh; instance: number }
export interface ModelRefMatrix   { matrix: Matrix4 }
export type BuildingModelRef = ModelRefInstanced | ModelRefMatrix;   // SpitterInfo 依赖 'mesh' in ref

export interface BuildStats {
    buildingCount: number;
    glbGroupCount: number;
    glbInstanceCount: number;
    fallbackBoxCount: number;
    hiddenCount: number;            // 未知 modelIndex 的隐藏占位数量
    unknownModelIndexes: number[];  // 去重升序
    iconCount: number;
    subscriptCount: number;
    cargoCount: number;
    perModelGlbCounts: Record<number, number>;   // 设置生效的判定依据（附录 A）
}

export interface SceneModel {
    buildings: AllBuildings;
    bvh: BVH;
    transforms: Matrix4[][];
    stats: BuildStats;
}
```

### 3.3 `RenderCore`

```ts
export interface RenderCoreOptions {
    container: HTMLElement;
    /** 引用语义；RenderCore 只读，变更由外部先写 port 再调 setRenderSettings */
    settings: ViewerRenderSettings;
    interactions?: { select?: boolean; contextRemove?: boolean };  // default: select=true, remove=false
    keyboardTarget?: HTMLElement | null;
    autoResize?: boolean;
    pixelRatio?: number;
    /** 测试注入点：jsdom 下无 WebGL（§7.4） */
    createRenderer?: (canvas: HTMLCanvasElement) => WebGLRendererLike;
    createIconTexture?: (renderer: WebGLRendererLike) => IconTextureLike;
}

export class RenderCore {
    constructor(options: RenderCoreOptions);

    /** 成功才替换旧场景；失败保留旧场景并抛给调用方（由 Viewer 转成 ViewerError） */
    setBlueprintData(data: BlueprintData | null): void;
    /** 原地修改 data 后调用（Editor 阶段 C 依赖它，§6.2） */
    notifyDataChanged(): void;
    /** 合并设置 → 是否需要重建由 §4.1 决定 */
    setRenderSettings(patch: Partial<ViewerRenderSettings>): void;
    setCallbacks(cbs: ViewerCallbacks): void;
    resetCamera(): void;
    dispose(): void;

    get camera(): PerspectiveCamera;
    get controls(): PlanetMapControls;
    get sceneModel(): SceneModel | null;
    get cameraVersion(): number;
    getBuildingModel(index: number): Matrix4 | null;    // 兼容 getModel 语义
    getSelectBoxMatrix(index: number): Matrix4 | null;  // 阶段 C 的高亮盒
    getSettings(): Readonly<ViewerRenderSettings>;
}
```

**关键实现约定**

1. `rebuildScene` 原子替换：`buildSceneData → buildBuildings → buildBVH` 全部成功后，才 `scene.remove` 旧模型 + `dispose()`，再 `add` 新模型。任何一步 throw 都保留旧场景（这是对现状的修复：现在 `watchEffect` 的 cleanup 先于 effect 重跑，构建一失败就是空场景）。
2. `buildSceneData` 固定：`findPosForAreas(data.areas, PLANET_SEGMENT)` + `calcBuildingTrans(PLANET_RADIUS, pos, b)`，不调 `buildReforms`、不调 `expandToGlobalCanvas`。
3. 尺寸：`ResizeObserver` 观察 container，同时更新 `renderer.setSize / setPixelRatio / camera.aspect`。**不复用 `@/utils` 的 `attachRenderer/attachCamera`**（它们是 `onMounted/onUnmounted` 绑定，且会在卸载时 `renderer.dispose()`）。
4. animate 循环固定顺序：`controls.updateTimeDelta(dt)` → `cargos.cargoMove = (t % 1000) / 1000` → `dirLight.position.copy(camera.position)` → `renderer.render` → `controls.update()` 返回 true 时 `cameraVersion++` 并合并调用 `onCameraChange`（每帧最多一次）。
5. `dispose()` 幂等；再调用任一方法返回 `already-disposed`（Viewer 层判定）。

### 3.4 `BlueprintViewer`

```ts
export class BlueprintViewer {
    constructor(options: ViewerOptions, callbacks?: ViewerCallbacks);

    loadBlueprint(str: string): BlueprintLoadOutcome;          // 内部 trim + parse + load
    loadBlueprintData(data: BlueprintData): BlueprintLoadOutcome; // 总是重建，不做引用比较
    getBlueprintData(): BlueprintData | null;                  // 失败保留上一次成功值
    resetCamera(): void;
    setRenderSettings(partial: Partial<ViewerRenderSettings>): void;
    setCallbacks(cbs: ViewerCallbacks): void;                  // 合并，同名回调覆盖
    dispose(): void;
}
```

---

## 4. 设置契约

### 4.1 设置 → 生效路径（定稿，不再留为风险）

| 设置 | 生效方式 | 依据 |
| --- | --- | --- |
| `showRealModels` | 必须重建（分组决策在构建期） | `BlueprintEditor.vue:264,277` |
| `maxInstancesPerModel` | 必须重建（同一处计数判定） | `BlueprintEditor.vue:278` |
| `texturesEnabled` | **只调 `reapplyLoadedModelMaterials(settings)`，不重建** | `CODE_WIKI.md:1379`、`glbLoader.ts:246` |

因此 `BlueprintViewer.setRenderSettings` 的实现是：

```ts
setRenderSettings(patch: Partial<ViewerRenderSettings>) {
    const before = this.port.read();
    this.port.write(patch);
    const after = this.port.read();
    const needsRebuild = before.showRealModels !== after.showRealModels
                      || before.maxInstancesPerModel !== after.maxInstancesPerModel;
    if (needsRebuild && this.data !== null)
        this.core.setBlueprintData(this.data);       // 全量重建，相机不动
    else if (before.texturesEnabled !== after.texturesEnabled)
        reapplyLoadedModelMaterials(after);          // 原地改共享材质
}
```

### 4.2 归属与持久化（D2 + D1）

- **唯一真相**：一个进程一份 `ViewerRenderSettings`。
- **core**：只持有构造时传入的只读引用，不做持久化。
- **Viewer**：默认 `LocalSettingsPort`（内存对象，初值 = 默认值 + `initialSettings`）；宿主可传 `settingsPort` 接管读写。
- **与编辑器共用时**：宿主传入

  ```ts
  { read: () => renderSettings, write: p => Object.assign(renderSettings, p) }
  ```

  写入经由 `reactive` 代理，`App.vue` 的 `watch(renderSettings, …, {deep:true})` 会照常触发 `persistRenderSettings()`。本轮不在 Viewer 内直接 import `@/renderSettings`（会破坏 D1）。

### 4.3 边界语义（必须与编辑器一致）

- `maxInstancesPerModel = N` 时，**恰好 N 个实例仍用 GLB**（现状 `<=`，`BlueprintEditor.vue:278`）。
- `Infinity` 表示不限制；序列化为 `null` 是 `renderSettings.ts` 的持久化细节，不进 Viewer API。
- **计数口径（D7，已确认）**：按「该 `modelIndex` 存在 `glbName` 的建筑数」判定，而不是「已加载 GLB 的建筑数」。现状计数随加载进度漂移（`BlueprintEditor.vue:266` 只统计 `r.glb !== null`），同一蓝图同一设置会出现「先白模后 GLB」或「先 GLB 后整组回退」两种结果，对截图/分享场景不可接受。

---

## 5. 对现有代码的改动清单（阶段 A 一次性完成）

| # | 文件 | 改动 | 行为影响 |
| --- | --- | --- | --- |
| 1 | `src/planetConstants.ts` | 新增 `PLANET_RADIUS = 200.2`、`PLANET_SEGMENT = 200` | 无（纯常量搬迁） |
| 2 | `src/components/BlueprintEditor.vue:566-567` | 删除本地 `R/SEGMENT`，改 import | 无 |
| 3 | `src/models/buildingModel.ts:80`、`src/blueprint/planet.ts:187` | `GRID_HORIZONTAL` 改由 `PLANET_RADIUS / PLANET_SEGMENT` 推导；`HEIGHT_GRID_SIZE = 4/3` 一并移入 `planetConstants`（`buildingModel.ts:81` 注释、`modelTransform.ts:10` 同步引用） | 无（数值等价，需单测断言） |
| 4 | `src/models/materialTextures.ts:118,121,128,144,156` | 5 处读 `renderSettings` 改为读函数参数 `settings`；`applyModelMaterialTextures(model, settings)` | 无 |
| 5 | `src/models/glbLoader.ts:180,246` | 调用点补 settings；新增 `setSettingsProvider(read: () => ViewerRenderSettings)`，加载完成时按当前值套用 | 无 |
| 6 | `src/models/glbLoader.ts` | 不新增任何释放入口；`releaseGlbModel*` 保持现状（§6.5 禁止项） | 无 |
| 7 | `src/components/BlueprintEditor.vue:490-564` | `registerUpdater` **留在 Vue 层**，移到 `src/components/blueprintUpdater.ts`，只依赖 core 导出的 `AllBuildings` 公开面、`iconHelpers` 与 `calcBuildingTrans` | 无 |
| 8 | `src/iconTexture.ts:49-51` | `loaded[iconId]` → `loaded[index]`（槽位索引），修掉守卫失效导致的重复 fetch | 修复：重复下载/上传消失 |
| 9 | `src/iconTexture.ts` | 新增 `dispose()`（`texture.dispose()`）；构造函数参数由 `WebGLRenderer` 改为 `TextureSink` 接口（`initTexture` / `copyTextureToTexture`） | 修复：可释放、可测试 |
| 10 | `src/components/BlueprintEditor.vue:471-488` | `buildBVH` 未知 `modelIndex` 兜底：`meta === undefined` → 退化零缩放矩阵（不可拾取）；未知索引汇总进 `stats.unknownModelIndexes` | **修复现存白屏** |
| 11 | `src/components/BlueprintEditor.vue:178,207,237` | 同类 `!` 断言改为「查不到则用默认色」（`0xdddddd`，与 `:334` 一致） | 修复：传送带/分拣器配色不再可能崩 |
| 12 | `src/lib/core/buildBuildings.ts` | 返回值改为 `{ buildings, stats }`；实例上限计数改用「存在 `glbName` 的实例数」（D7） | 确定性修复：白模/GLB 划分不再随加载时序变化 |

> 第 10、11 行是 v1 未识别的现存缺陷：`buildBoxes` 明确写了「未知建筑放退化矩阵占位，保持不抛错、不白屏的旧行为」（`BlueprintEditor.vue:338-343`），但 `buildBVH:476` 与传送带配色路径用 `!` 直接取元数据，两处态度相反。含 `modelIndex 117`（轨道采集器）之类建筑的蓝图目前会白屏。

---

## 6. 场景生命周期与错误模型

### 6.1 加载流程

```text
Viewer.loadBlueprint(str)
  └─ trim → parseBlueprint(str)                 // 抛错 → {ok:false, phase:'parse'}
       └─ loadBlueprintData(data)
            ├─ core.setBlueprintData(data)
            │   ├─ findPosForAreas(areas, PLANET_SEGMENT)      // 抛错 → phase:'position'
            │   ├─ calcBuildingTrans(PLANET_RADIUS, pos, b)
            │   ├─ buildBuildings(transforms, buildings, settings) // 抛错 → phase:'build'
            │   │   └─ 设置：showRealModels / maxInstancesPerModel（计数口径见 §4.3）
            │   ├─ buildBVH(transforms, buildings)              // 未知模型走退化矩阵
            │   └─ 原子替换：成功才 remove+dispose 旧模型
            └─ { ok:true, value:{ buildingCount, areas, header, unknownModelIndexes, warnings } }
```

相机（D8，已确认）：`keepCamera !== true` 时成功后自动 `resetCamera()`，即 `controls.reset(2 * R)`。编辑器侧现状是「蓝图串变化才 reset」，本轮不改编辑器行为。

### 6.2 模型到达 → 重建

`buildingModel.ts` 的 `onBuildingModelsChanged` 已被现有代码订阅。RenderCore 内部：

- 订阅 `onBuildingModelsChanged`，150ms 合并（沿用 `BlueprintEditor.vue:762-778`）；
- 触发 `rebuild('models')`，成功后 `onRebuild({reason:'models'})`；
- `dispose()` 时退订并清除定时器。

### 6.3 相机变化与选中

- `onCameraChange`：仅在 `controls.update()` 返回 true 时记录「本帧有变化」，rAF 末尾合并通知一次（不新增第二套 matrixWorld 阈值，避免与 `cameraVersion` 漂移）。
- 点击拾取：`bvh.raycast` 取 `intersects[0].index`，再做星球球遮挡比较（沿用 `BlueprintEditor.vue:699-707`）。命中空 → `onBuildingSelect(null)`。
- `interaction.contextRemove` 默认 `false`；为 `true` 时绑定右键剔除回调 `onBuildingRemove?(index)`（阶段 C 预留，本轮 Viewer 不用）。

### 6.4 错误模型

- `phase` 表示失败阶段；`code` 由消息映射到枚举（附录 B）。
- `{ ok:false }` 时：场景、相机、`getBlueprintData()` 全部保持上一次成功状态。
- `onError` 是统一通道：致命错误（`ok:false`）必须上报一次；非致命警告（未知 modelIndex、GLB 404、贴图失败）按 `code + message` 去重后最多上报一次。

### 6.5 dispose 两张清单

**必须释放（自己创建的）**

1. `AllBuildings.dispose()`（已尊重 `sharedResource`）
2. `IconTexture.dispose()`（新增）
3. 星球球 / 经纬网格 / 灯光的 geometry + material
4. `PlanetMapControls.dispose()`
5. `ResizeObserver.disconnect()`、`keyboardTarget` 事件、canvas 上的 click/contextmenu 监听
6. `cancelAnimationFrame`
7. `renderer.dispose()` + `renderer.domElement.remove()`
8. 模型到达订阅、150ms 定时器

**禁止释放（进程级共享）**

1. `releaseGlbModel()` / `releaseAllGlbModels()`
2. `textureMaps` 缓存（`sharedTexture` 标记）
3. `buildingModel` 的 `resolvedCache`
4. `maxAnisotropy` / `buildingEnvironment` 单例
5. `IconTexture` 的图标 `TextureLoader` 结果（已自行 dispose）

---

## 7. 分阶段与验收

### 7.1 阶段 A：解耦 + 搬家 + 修缺陷（必须一次完成）

范围：§5 表格 12 行 + core 目录建立 + `describeBuild`。

**出口条件**

1. `grep -R "from 'vue'" src/lib/core` 无命中。
2. `yarn test:unit` 全绿；新增 `tests/unit/lib/describeBuild.spec.ts`：对 2~3 个现有 fixture 断言 `stats`（分组数、隐藏数、`unknownModelIndexes`、`perModelGlbCounts`）与 `bvh.boxes[i]` 的 `Matrix4.elements` 快照。
3. 手动回归清单（编辑器）：白模 / GLB / 贴图开关 / 图标 / 下标 / 货物动画 / 拾取 / 右键剔除 / 相机重置 / 设置面板「需重新导入」。
4. 含 `modelIndex 117` 的蓝图不再白屏，`unknownModelIndexes` 有值。
5. D7 生效验证：同一 fixture 在「GLB 未加载」与「GLB 已加载」两种状态下，`describeBuild()` 的 `perModelIndex` 划分一致。

> 不满足 2、3 不算完成——「行为不变」必须可证伪。

### 7.2 阶段 B：RenderCore + BlueprintViewer

范围：`RenderCore.ts`、`BlueprintViewer.ts`、`types.ts`、`index.ts`、单测。

**出口条件**

1. 独立 HTML 页（或 story 组件）能 `new BlueprintViewer({container})` + `loadBlueprint(str)` 渲染出与编辑器一致的白模/GLB 场景。
2. 单测覆盖：成功返回 `buildingCount`、解析失败 `{ok:false, code}`、`setRenderSettings` 的两个重建分支与一个 reapply 分支、`dispose` 后 canvas 移除、`dispose` 后调用返回 `already-disposed`、`unknownModelIndexes` 上报。
3. 新建 `lib-README.md`（v2 API；仓库当前不存在该文件，v1 把它当作既有文档引用是错的）：去掉 `setTheme/toDataURL/selectBuilding`，补 `setRenderSettings`、`loadBlueprint` 返回值、`settingsPort`、`onRebuild`。

### 7.3 阶段 C（本轮不做，仅预留）

已预留的接口：`notifyDataChanged()`、`getSelectBoxMatrix()`、`interaction.contextRemove`、`onBuildingRemove`、`getBuildingModel()`。切换时还需要回归：选中盒、编辑预览（绿盒/红线/slot）、`defineExpose` 的 `selectBoxes/camera/cameraVersion/getModel/resetCamera`、`rebuildScene` 的 `onError`、`updater.clearAll()` 时机。

### 7.4 单元测试可行性（jsdom）

jsdom 无 WebGL，且 `IconTexture` 构造需要真实 renderer。方案要求两处注入（`RenderCoreOptions.createRenderer / createIconTexture`），测试用 stub 实现 `initTexture / copyTextureToTexture / setSize / setPixelRatio / render / dispose` 的空实现；`document.createElement('canvas')` 在 jsdom 下可用。

---

## 8. 已知限制（写入 lib-README）

1. **单实例**：同页多个 Viewer 未验证；模块级 GLB 缓存、`resolvedCache`、150ms 节流为进程共享。**实施补充**：`RenderCore` 在宿主未提供 `textureSettings` 时会把自身的贴图设置注册为 `glbLoader` 的全局 provider（否则 Viewer 的 `texturesEnabled=false` 对后加载的模型无效），该注册在 `dispose` 时撤销——因此同页两个 Viewer 会互相覆盖，且后销毁的会清掉 provider。
2. **设置全局**：`texturesEnabled` 作用于共享材质，两个实例无法各用各的值。
3. **资产依赖构建环境**：`require.context`（`glbAssets.ts:36`）与 `textureManifest.ts` 的静态 `require` 资源清单只在 webpack 下成立；`vue.config.js:6` 的 `publicPath: '/dsp_blueprint_editor/'` 决定 GLB/贴图 URL，宿主站点不在该子路径时会 404 且仅有一条 `console.warn`。`assetBaseUrl` 字段已预留，本轮不实现。
4. **星球尺寸固定**：`PLANET_RADIUS / PLANET_SEGMENT` 与 `buildingModel.ts:80`、`planet.ts:187` 的换算耦合，不支持运行时改半径。
5. **不含编辑态**：无放置/删除/预览/地基。

---

## 9. 交付物清单

- `src/lib/types.ts`、`src/lib/index.ts`、`src/lib/BlueprintViewer.ts`
- `src/lib/core/{types,settings,RenderCore,AllBuildings,planetScene,buildBuildings,buildBVH,iconHelpers,describeBuild}.ts`
- `src/planetConstants.ts`
- 改动：`src/components/BlueprintEditor.vue`、`src/components/blueprintUpdater.ts`（新增）、`src/models/materialTextures.ts`、`src/models/glbLoader.ts`、`src/models/buildingModel.ts`、`src/iconTexture.ts`、`src/renderSettings.ts`
- 测试：`tests/unit/lib/describeBuild.spec.ts`、`tests/unit/lib/viewer.spec.ts`
- 文档：`lib-README.md`（新建，v2 API）、`docs/CODE_WIKI.md` 新增 §17、根 `CODE_WIKI.md` 标注过期

---

## 10. 后续（不在本轮）

- lib 构建（ESM + `d.ts`）、`import.meta.glob` 迁移、`assetBaseUrl` 真正实现
- 多实例支持（引用计数式 GLB 缓存）
- 阶段 C 的编辑器切换

---

## 附录 A：`describeBuild` 诊断对象

```ts
export interface BuildDescription {
    settings: ViewerRenderSettings;
    buildingCount: number;
    perModelIndex: Record<number, { total: number; glb: number; fallback: number; hidden: number }>;
    glbGroups: { modelIndex: number; count: number }[];
    fallbackBoxCount: number;
    unknownModelIndexes: number[];
    selectBoxes: number[][];        // 每个 Matrix4.elements
    subscriptCount: number;
    iconCount: number;
}
```

用途：A 阶段快照基线、线上问题定位、Viewer/Editor 一致性校验。

## 附录 B：错误消息 → code 映射

| 来源 | 消息前缀 | code | phase |
| --- | --- | --- | --- |
| `parser.ts:1265` | `Invalid start` | `invalid-start` | parse |
| `parser.ts:1272` | `Header too short` | `header-too-short` | parse |
| `parser.ts:1287` | `Checksum not found` | `checksum-missing` | parse |
| `parser.ts:1291` | `Checksum mismatch` | `checksum-mismatch` | parse |
| `parser.ts:110/122` | 越界 | `buffer-overflow` | parse |
| `planet.ts:66` | `No root area` | `no-root-area` | position |
| `planet.ts:104` | `No suitable longitude` | `no-longitude` | position |
| `planet.ts:131` | `same segments as its parent` | `inconsistent-area` | position |
| `planet.ts:145/147` | `anchorLocalOffsetY == 0` | `inconsistent-area` | position |
| 构建期其它 | — | `build-failed` | build |
