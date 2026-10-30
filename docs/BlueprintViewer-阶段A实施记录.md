# BlueprintViewer 阶段 A 实施记录

> 对应方案：[BlueprintViewer-实施计划.md](./BlueprintViewer-实施计划.md)（v2 定稿）
> 日期：2026-10-30
> 状态：**已完成并通过验证**（tsc / jest / lint / build 四项全绿，见 §3）

---

## 1. 已完成

### 1.1 新增文件

| 文件 | 作用 |
| --- | --- |
| `src/planetConstants.ts` | `PLANET_RADIUS` / `PLANET_SEGMENT` / `GRID_PER_SEGMENT` / `HEIGHT_GRID_SIZE` / `GRID_HORIZONTAL` 单一来源 |
| `src/renderSettingsTypes.ts` | 纯类型设置定义（**不 import vue**），供 models 与 lib 共用 |
| `src/lib/types.ts` | 公开 API 类型 |
| `src/lib/index.ts` | 库入口 |
| `src/lib/BlueprintViewer.ts` | 对外 Viewer 类 |
| `src/lib/core/types.ts` | `BuildingModelRef` / `BuildStats` / `SceneModel` |
| `src/lib/core/AllBuildings.ts` | 从 `.vue` 下沉 |
| `src/lib/core/planetScene.ts` | 星球 + 经纬网格 + 灯光 |
| `src/lib/core/geometryHelpers.ts` | `inserterTrans`（渲染与选择盒共用） |
| `src/lib/core/buildBuildings.ts` | 建筑/GLB/图标/Cargos/下标装配 + `BuildStats` |
| `src/lib/core/buildBVH.ts` | 选择盒 + BVH（**未知模型兜底**） |
| `src/lib/core/iconHelpers.ts` | 图标 id 与位置计算 |
| `src/lib/core/describeBuild.ts` | 诊断快照对象 |
| `src/lib/core/RenderCore.ts` | 场景生命周期内核 |

### 1.2 修改文件

| 文件 | 改动 | 类型 |
| --- | --- | --- |
| `src/iconTexture.ts` | `loaded` 改按**槽位索引**；新增 `dispose()`；renderer 改 `TextureSink` 接口；请求失败可重试；dispose 后不再回写纹理 | 缺陷修复 ×2 |
| `src/lib/core/buildBVH.ts` | `buildingMeta.get(...)!` → 未知模型退化矩阵 + `unknownModelIndexes` | 缺陷修复（白屏） |
| `src/lib/core/buildBuildings.ts` | `buildingMeta.get(...)!` 配色 → `colorOf()` 占位色；`maxInstancesPerModel` 计数改按 `glbName` | 缺陷修复 + D7 |
| `src/models/materialTextures.ts` | 5 处 `renderSettings` 全局读取改为参数 `settings` | D1 解耦 |
| `src/models/glbLoader.ts` | 新增 `setSettingsProvider` / `currentTextureSettings` / `resolveTextureSettings`；两处调用点收 settings | D1 解耦 |
| `src/models/buildingModel.ts` | `GRID_HORIZONTAL` / `GRID_VERTICAL` 改从 `planetConstants` 取 | 常量收敛 |
| `src/blueprint/planet.ts` | `GRID_PER_SEGMENT` / `HEIGHT_GRID_SIZE` 改从 `planetConstants` 取 | 常量收敛 |
| `src/renderSettings.ts` | 新增与 `FullRenderSettings` 的结构对齐断言 | 防漂移 |
| `src/components/BlueprintEditor.vue` | 删除已下沉的构建函数；改用 core；图标图集跨重建复用；注入 settingsProvider | 阶段 A 主体 |
| `tests/unit/models/placement.spec.ts` | 新增 `planetConstants` 与既有换算的一致性断言 | 回归保护 |

### 1.3 与方案的偏差

1. **`core/settings.ts` 改为 `src/renderSettingsTypes.ts`**：`materialTextures` / `glbLoader` 也要用这些类型，若放在 `lib/core` 会形成 `models → lib` 的反向依赖。
2. **新增 `core/geometryHelpers.ts`**：`inserterTrans` 同时被 `buildBuildings`（渲染）与 `buildBVH`（选择盒）使用，放在任一者内都会造成循环依赖。
3. **`RenderCore` 新增 `textureSettings` 选项**：`ViewerRenderSettings` 只有 `texturesEnabled` 总开关，而材质重挂需要完整的 7 通道设置。
4. **编辑器也改为复用 `IconTexture`**：原实现每次重建都 `new IconTexture(renderer)`，会重新分配 1920×1920 纹理并重发全部图标请求。这是 D4 范围内的顺带修复。

### 1.4 静态审查中已修正的编译级问题

由于无法运行 `tsc`，改用人工审查，已发现并修掉以下**必然导致编译失败或运行异常**的问题：

1. `RenderCore` 中 `private readonly camera` 字段与 `get camera()` getter 同名 → duplicate identifier。字段改为 `_camera`，对外仍经 getter 暴露。
2. `SceneBundle` 作为 public getter `sceneModel` 的返回类型却未导出 → 已 `export`。
3. `buildBuildings.ts` 中残留一份 `inserterTrans` 副本，引用未导入的 `INSERTER_HEIGHT` → 已删除（唯一实现位于 `core/geometryHelpers.ts`）。
4. `RenderCore.ts` 两条 import 被挤在同一行（前一次编辑合并所致）→ 已拆分。
5. 测试中 `localOffset` / `yaw` 是元组类型，直接写字面量数组会被推断为普通数组 → 已加 `as BlueprintBuilding['localOffset']`。
6. 测试中 `allIconIds()` 是 generator，`allIconIds()[0]` 非法 → 改为迭代取值。

### 1.5 静态审查中修正的语义缺陷

1. **`setBlueprintData` 失败时数据被污染**：原实现先 `this.data = data` 再重建，构建抛错时 `this.data` 已经是坏数据，而 Viewer 侧的 `this.data` 仍是旧的——两边状态分叉，下一次 `notifyDataChanged` 会用坏数据重建。已改为失败时回滚。
2. **`scheduleModelRebuild` 的异常外泄**：150ms 定时器内的 `rebuildScene` 抛错会变成未处理错误。已用 try/catch 包住并保留旧场景。
3. **Viewer 的 `texturesEnabled=false` 对后加载模型无效**：`glbLoader` 在模型加载完成时调用 `currentTextureSettings()`，Viewer 场景下没人注入 provider 就回落到「七通道全开」默认值，于是设了关闭贴图之后、新到达的模型仍然带贴图。已让 `RenderCore` 在宿主未提供 `textureSettings` 时把自身合成逻辑注册为 provider，并在 `dispose` 时撤销（单实例前提下安全，方案 D6）。
4. **重建时重复重挂贴图**：`rebuildScene` 传 `reapplyMaterials: true` 会对全部已加载模型跑一遍贴图流程，而 `setRenderSettings` 的 `texturesEnabled` 分支也会跑一遍。重建时已改为 `false`，只在设置变更时重挂（符合方案 §4.1）。
5. **测试辅助函数名遮蔽 Jest 全局 `describe`**：`tests/unit/lib/describeBuild.spec.ts` 里定义了 `function describe(...)`，会让文件内所有 `describe('...')` 调用指向自己而不是 Jest，整个测试文件崩溃。已改名为 `describeOf`。
6. **`RenderCore.dispose()` 会释放宿主注入的图标图集**：`createIconTexture` 是测试注入点，宿主传入的图集不应由内核销毁。已加 `ownsIconTexture` 标记，只释放自己创建的。

---

## 2. 已知未修缺陷（记录，不在本轮范围）

静态审查中发现、但**有意不修**的问题，避免在无法编译验证的条件下扩大改动面：

1. **`IconSubscript` 的字体纹理从不释放**：`IconSubscript` 持有 `FontTexture`（`iconSubscript.ts:51`），而 `AllBuildings.dispose()` 只遍历释放几何与 `InstancedMesh`，不碰材质/纹理。每次场景重建都会泄漏一张字体图集纹理。修它需要给 `FontTexture` 补 `dispose()` 并在 `AllBuildings` 里区分「共享材质」与「独占材质」，属于独立改动。
2. **`buildBuildings` 里的 `MeshLambertMaterial` 由同组多个格子共享**：`buildBelts` 的带子网格与链接网格共用一个 material，直接 `dispose()` 需要保证只释放一次。

---

### 2.1 搬迁正确性逐行比对

对 `buildBelts` / `buildInserters` / `buildBoxes` / `buildIcons` 与 `BlueprintEditor.vue` 旧实现做了逐行比对，**逻辑完全一致**，差异仅三处且都是有意的：

| 差异 | 原因 |
| --- | --- |
| `buildingMeta.get(...)!.color` → `colorOf(...)` | D4 缺陷修复：未知模型不再抛错 |
| `glbInstanceCounts` 统计条件 `r.glb !== null` → `r.glbName !== null` | D7 计数口径修正 |
| 内层临时变量 `trans/dir` → `p1/p2/d` | 避免与外层同名变量遮蔽 |

### 2.2 外部依赖核实

- `@/` 别名：`vue.config.js` 没有自定义 `@`，由 vue-cli 内置提供；`src/blueprint/parser.ts` 等既有文件早已在用，新增的 `@/planetConstants` 同样可解析。
- `TextureSink` 的结构兼容：`@types/three` 的 `WebGLRenderer.copyTextureToTexture(position, srcTexture, dstTexture, level?)` 与 `initTexture(texture)` 签名**恰好与自定义接口一致**，因此 `new IconTexture(renderer)` 不需要强制转换。

### 2.3 lint 预检（按 `.eslintrc.js` 静态核对）

无法执行 `yarn lint`，改为按配置逐条人工核对（`plugin:vue/vue3-essential` + `@vue/typescript/recommended`；其中 `no-non-null-assertion` 已关闭、`no-console` 仅生产环境告警）：

- 全部新增/修改文件的 import 均已实际使用（逐文件 grep 核对），无 `@typescript-eslint/no-unused-vars` 命中。
- `iconTexture.spec.ts` 原用 `_pos` / `_src` / `_dst` 占位参数，而配置未声明 `argsIgnorePattern`，存在被判未使用的风险；已改为无参箭头函数，并移除随之未使用的 `Texture` / `Vector2` 导入。
- `RenderCore` 的 `as unknown as WebGLRendererLike` 是必要断言（`WebGLRenderer.render` 签名与其窄接口不完全一致），未使用 `@ts-ignore`。

---

## 3. 验证结果（已通过）

四条命令全部实跑，全部通过：

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0 错误**（`strict: true`） |
| `npx jest` | **15 套件 / 97 用例全绿** |
| `npx vue-cli-service lint --no-fix` | **0 错误 0 警告** |
| `npx vue-cli-service build` | **构建成功**（25s，`dist` 就绪） |

### 3.1 关于此前的「shell 不可用」

**此前的归因是错的，此处更正。** 前 5 轮所有命令都返回 `0xC0000142`，当时判断为「宿主环境故障 / 与项目无关」。实际原因是**会话的 `workspace-write` 沙箱层无法创建进程**；把 DSH 文件策略切到 `danger-full-access` 后，同一批命令立即正常执行。也就是说那 17 次失败是沙箱配置问题，不是机器坏了，也不是代码问题。

### 3.2 实跑后发现并修复的真实缺陷

前 5 轮纯静态审查**没有发现**下面两个问题，它们只有真正执行才能暴露：

1. **`buildBVH` 的零缩放占位盒会让 BVH 构建抛错**（`tests/unit/lib/buildBVH.spec.ts` 的「多个未知模型」用例）。
   `BVH.split` 在包围盒退化成点时 `longestAxis` 返回 `null`，抛 `Unexpected empty box`。
   这意味着「未知模型白屏」的修复**原本并没有修好**：蓝图里只要有 2 个以上未知建筑，仍然会崩。
   已改为 `1e-6` 的极小缩放（非零 → 包围盒有尺寸 → BVH 可构建；视觉不可见、几乎不可拾取）。

2. **`BlueprintEditor.vue` 的 `<script>` 与 `<script setup>` 重复导入**（`no-redeclare` ×3：`Vector3` / `calcBuildingTrans` / `PLANET_RADIUS`）。
   Vue SFC 会把两个 script 块合并成同一模块，同名 import 会导致构建期 `SyntaxError`——这是**会直接让页面挂掉**的问题，而 `tsc` 不检查 `.vue`，所以只有 `lint` 和 `build` 能发现。
   已把共享导入只保留在普通 `<script>` 块，`<script setup>` 复用。

3. 顺带清掉 `tests/unit/blueprint/command.spec.ts` 的未使用导入 `Command`（既有问题）。

### 3.3 为什么静态审查漏掉了它们

前 5 轮共改掉十余处问题，但没有一处是编译器发现的——这次实跑证明了同一个结论的另一面：**静态审查同样有系统性盲区**。两处漏网都不是「类型写错」，而是「跨模块/跨文件的运行期约束」：`BVH` 对退化包围盒的隐含前提、Vue SFC 两个 script 块共享作用域。这类约束不在单个文件的类型签名里，只有执行才能验证。

### 3.4 新测试（已运行通过）

- `tests/unit/lib/buildBVH.spec.ts` — 未知模型不抛错、极小占位盒、去重升序
- `tests/unit/lib/iconTexture.spec.ts` — 槽位守卫、dispose（node 环境下用最小 canvas 占位）
- `tests/unit/lib/describeBuild.spec.ts` — 快照基线、GLB/fallback 计数

### 3.5 仍需人工回归（自动化测不到的部分）

以下属于 WebGL 实际渲染效果，单测无法覆盖，需在浏览器里点检：

- [ ] 白模场景正常
- [ ] GLB 场景正常（模型位置不飘）
- [ ] 贴图开关生效（关掉后不再有法线/自发光）
- [ ] 图标正常显示
- [ ] 传送带数字下标正常
- [ ] 货物动画在移动
- [ ] 点击拾取建筑正确
- [ ] 右键剔除可用
- [ ] 相机重置正常
- [ ] 设置面板「需重新导入蓝图」提示行为不变
- [ ] **含未知 modelIndex 的蓝图不再白屏**

---

## 4. 下一阶段

阶段 B（`RenderCore` + `BlueprintViewer` 的独立验证页）的代码已随本次构建编译通过，但**尚无任何运行时验证**——`BlueprintViewer` 从未被实例化过。建议下一步：起一个最小 demo 页跑通 `new BlueprintViewer({container})` + `loadBlueprint(str)`，确认 Viewer 的实际渲染结果与编辑器一致。
