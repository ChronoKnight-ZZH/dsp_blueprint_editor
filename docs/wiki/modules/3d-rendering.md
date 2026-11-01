# 模块：3d-rendering —— 3D 渲染系统

## 职责概述

负责把 `BlueprintData` 可视化为星球表面的 3D 交互场景。核心能力：
- 星球几何体（经/纬度网格线）。
- 建筑实例化渲染（传送带圆柱体 + link 方框 + 分拣器盒子 + 储物仓等选择盒）。
- 统一图标图集（`IconTexture`）+ 每个建筑/配方/信号的 icon 叠层（`IconsMaterial` + `InstancedBufferGeometry`）。
- 货物滑动动画（传送带 / 分拣器货物沿 z 推进）。
- 自实现 BVH（`src/bvh/bvh.ts`）用于射线拾取（点选建筑、点选 slot）。
- 相机控制（`PlanetMapControls`，类 OrbitControls 但绕星球中心旋转）。
- Vue computed() 响应式重建（`BlueprintEditor.vue` 内顶层函数，被 command.execVersion bump 触发整体重建）。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/components/BlueprintEditor.vue` | 编辑器主组件，含所有场景构建顶层函数（约 1943 行） |
| `src/bvh/bvh.ts` | 自实现 BVH（递归 partition 最长轴），197 行 |
| `src/iconTexture.ts` | 24×24 槽位图集，`copyTextureToTexture` 异步上传，74 行 |
| `src/icons.ts` | `IconsMaterial`（自定义 shader）+ `IconGeometry`（InstancedBufferGeometry）+ `Icons` Mesh，238 行 |
| `src/cargos.ts` | 带 `cargoDistance` 实例属性的几何体 + `cargoMove` uniform 实现滑动，75 行 |
| `src/PlanetMapControls.ts` | 星球地图相机：锚点在球面上、可自由俯仰，731 行 |
| `src/skyGradient.ts` | 渐变天光背景（全屏四边形 + 反投影取色），116 行 |
| `src/SphereGridGeometry.ts` | 经/纬度网格线 BufferGeometry，96 行 |

## 公开接口

### BlueprintEditor.vue —— 顶层函数（参见：src/components/BlueprintEditor.vue）

**场景构建函数**（位于 `<script>` 顶层）

- `buildPlanetGrid(radius=1, segment=200)`（行 61-91）：返回 `{ grids: Group, material }`。内部创建一个纬度环 `SphereLatitudeGridGeometry`（覆盖整圈）+ `gridAreas(segment)` 遍历星球所有分区，每个分区一条经度弧线 `SphereLongitudeGridGeometry`（`thetaStart/thetaLength` 根据分区的 `minLatitudeSeg/latitudeSeg` 定）。
- `inserterTrans(transforms, trans)`（行 134-146）：分拣器的局部变换矩阵（从起点 pos1 到终点 pos2，沿两者法线方向抬起 `inserterHeight=0.3`），返回长度。**buildInserters / buildBVH / registerUpdater 都调用此函数**。
- `buildingIconId(b)`（行 148-159）：返回建筑当前应显示的图标 rawId（未过 IconTexture 的 slot 映射）。逻辑：研究站 + `researchMode==Compose && recipeId>0` → `recipeIconId(recipeId)`；否则 `recipeId>0` → `recipeIconId(recipeId)`；否则 `itemIconId(b.itemId)`。
- `buildBuildings(transforms, buildings, renderer)`（行 213-323 … 后续还有 buildBoxes/buildBaths/buildAssemblers/buildCargoes/buildIcons/buildSubscript 等分支）：按 itemId 分类（isBelt / isInserter / isSplitter / isStation 等）分别构建 InstancedMesh + 材质 + ModelRef 映射；最后组装进 `AllBuildings extends Object3D`（行 93-128）。典型分支：
  - **传送带**：`CylinderGeometry(r=0.32, thickness=0.1)` + `BoxGeometry(0.15, linkThickness, 1.0)` 做 link（buildBelts 行 218-285）。link 长度由两端点距离决定（`dir.subVectors(pos1, pos2).length()`），同时创建 `CargoGeometry` 实例（见 `cargos.ts`）。
  - **分拣器**：`BoxGeometry(0.1, 0.1, 1.0)` + `inserterTrans` 算长度（行 286-309）。
  - **盒子/制造台**：`unitBoxTrans`（来自 `buildingMeta`）做选择盒渲染（行 310-323）。
- `buildBVH(transforms, buildings)`（行 499-516）：为所有建筑构建射线拾取 BVH。分拣器用 `inserterTrans` 生成拉伸盒；其余用 `meta.selectUnitBoxTrans`。

**响应式注册**（Vue 组件 `setup` 作用域）

- `const b = computed(() => { commandQueue.value?.execVersion.value; ... return { buildings, bvh, reforms, pos }; })`（行 711-723）：**被 execVersion 触发整体重建**——剔除建筑/撤销/重做后 bump execVersion → 重新 buildBuildings + buildBVH + registerUpdater。
- `registerUpdater(updater, buildings, pos)`（行 518-601）：命令执行后**增量刷新**图标（silent 命令不触发 execVersion 时也能生效）。先 `updater.clearAll()` 清空旧回调，然后：
  - `updateBuildingIcon`：按 `buildingIconId(b)` 重算 iconId，调用 `icons.updateIconId`。
  - `updateBeltIcon`：传送带的 `BeltParameters.iconId` → `icons.updateIconId`（若该建筑原本无图标但现在有了 → 动态 `addIcon`）。
  - `updateBeltIconSubscript`：传送带 count 变化时刷新下标文本（注意文本长度不变才局部刷新，避免覆盖后续 belt 字符位置）。
  - `updateSorterIcon`：四向分流器的 `filterId` → `icons.updateIconId`。

### BVH（参见：src/bvh/bvh.ts）

```typescript
export class BVH {
    root: BVHNode;
    constructor(public boxes: Matrix4[], { maxDepth=32, leafBoxes=1 }?: BVHOptions);
    raycast(ray: Ray): IntersectionInfo[];
}
```

**构建**（行 72-151）：
1. 对每个 `box`（Matrix4）计算 `Box3().copy(unitBox).applyMatrix4(box)` 作为包围盒。
2. `centers = { x[], y[], z[] }`（从 Matrix4 平移分量提取）。
3. 根节点含所有 index，递归 `split(node, depth)`：
   - `longestAxis(node.bounding)` → 选最长维度切分（`partition(arr, pred)` 做 in-place 分区，行 49-63）。
   - `splitValue`：取该轴上所有有限中心的均值（跳过 NaN/空盒）。
   - `splitValue` 为边界 / `splitPos==0 / splitPos==length` / `axis===null` 时退化为叶子。
   - 叶子条件：`node.idx.length <= leafBoxes` 或 `depth == 0`。

**raycast**（行 153-196）：
- 递归下降：`ray.intersectBox(node.bounding)` 命中才进子树。
- 叶子：把 Ray 反变换到每个 box 的局部系（`localRay.applyMatrix4(invertB)`），与 `unitBoxTriangles`（12 个三角形）逐个 `intersectTriangle`。命中后用原 Matrix4 反变换回世界，算 `distanceToSquared`。
- 返回按 `distanceSquared` 升序排列的 `IntersectionInfo[] = { index, distanceSquared }`。

### IconTexture（参见：src/iconTexture.ts）

```typescript
export class IconTexture {
    static readonly WIDTH = 24;
    static readonly HEIGHT = 24;
    static readonly ICON_SIZE = 80;
    texture: Texture;
    requestIcon(iconId: number): number;   // 返回 atlas slot index
    has(iconId: number): boolean;
}
```

- 图集：24×24 槽位，每槽 80×80 像素 → 最终 Texture 尺寸 1920×1920（行 27-28）。
- slot 映射：构造时遍历 `allIconIds()`，依次分配 1..(WIDTH*HEIGHT-1) 槽（0 预留给空图标）（行 38-44）。
- 异步上传：`requestIcon` 首次请求时 `loader.loadAsync(await iconUrl(iconId))`，然后 `renderer.copyTextureToTexture(pos, texture, this.texture)` 把子纹理贴到图集的指定位置（行 59-65）。返回 slot index 立即返回（不等待异步完成，shader 里显示会稍晚清晰）。
- `loaded: boolean[]`：防止重复下载（行 22、46-47）。

### Icons（参见：src/icons.ts）

**IconsMaterial**（行 19-107）：自定义 ShaderMaterial。
- **顶点着色器**：三个实例属性 `iconPos(xyz) / iconScale(uv) / iconId(int)`。`iconId` 映射到 `iMapSize`（=24）的 atlas 位置：`ivec2(iPosition) = iconId % iMapSize.x, iconId / iMapSize.x`，`vMapUv = (vMapUv + iPosition) / iMapSize`。物体空间 z 轴抬高 5.0（`depthPosition.z += 5.`）以避免深度测试遮挡星球，真正的 gl_Position 仍用原 mvPosition。
- **片元着色器**：`ShaderLib.sprite.fragmentShader`（即 sprite shader，用 map + diffuse + transparent）。
- 选项：`depthTest=true`、`depthWrite=false`、`transparent=true`、`fog=true`。

**IconGeometry**（行 131-232）：extends `InstancedBufferGeometry`。
- 顶点几何：一个带 2 个三角形的 `InterleavedBuffer`（pos xyz + uv xy，4 顶点）。
- 实例属性：`iconId`（Int32）/ `iconPos`（Float32 × 3）/ `iconScale`（Float32 × 2）。
- 方法：`addIcon(b, iconId, pos, scale, update=false)` 向几何体追加一个实例；`reserve(length)` 扩容 attribute；`updateIconId(b, iconId)` 原地更新已有实例的 iconId；`hasIcon(b)` 判建筑是否已有图标（分流器 / 监测器 / 喷涂机 / 电力感应塔等在 `noIconBuildings` 里 → 跳过）。

**Icons**（行 233-238）：`Mesh<IconGeometry, IconsMaterial>` 薄壳。

### cargos.ts —— cargoMove uniform（参见：src/cargos.ts）

```typescript
export function makeCargoGeometry(geo: BufferGeometry, count: number): CargoGeometry;
export class Cargos extends InstancedMesh {
    setCargoDistanceAt(i, d); // 设置第 i 个货物的相对位置（沿带方向 0..1）
    cargoMove: number;        // uniform value，render loop 递增实现滑动
}
```

**滑动实现**（行 35-51）：
- `CargoMaterial extends MeshLambertMaterial`，覆盖 `onBeforeCompile`：
  1. 在 `<common>` 后插入 `attribute float cargoDistance; uniform float cargoMove;`。
  2. 在 `<skinning_vertex>` 后插入 `transformed.z -= cargoMove * cargoDistance;`。
- 带方向沿局部 +z → 把每个货物的 z 减去 `cargoMove × cargoDistance`（cargoDistance 0..1 沿带长插值）。
- render loop：主场景 tick 中递增 `cargoMoveUniform.value = (value + dt * speed) % 1.0` → 所有传送带/分拣器货物同步沿各自方向滑动。

### PlanetMapControls（参见：src/PlanetMapControls.ts）

星球地图相机（高德地图网页版那一套）。**锚点是球面上的一点**（`anchor`，单位向量），不是球心；相机永远看向 `anchor × R`，因此才能出现真正的俯仰 —— 旧版锚在球心时，屏幕中心的视线永远垂直于球面，怎么拖都只是一张俯视图。

- 状态：
  - `anchor`（球面单位向量，同时是当地法线）/ `viewDir`（切平面内由锚点指向相机的单位向量，`update()` 保证其与 `anchor` 正交，即平移时的平行移动）。
  - `tilt` 仰角：`minTilt = 0`（平视）/ `maxTilt = 85°`（俯瞰）。上限不取 90° 是因为正上方时相机 `up` 与视线平行、`lookAt` 会退化。
  - `distance`（用户设定的期望距离）与 `effectiveDistance`（受地平线约束后的实际距离）分开存：压到平视时距离自动收回，抬回仰角能复原缩放级别。
  - `minHeight = 1.5`：平视时相机贴在离地 1.5 处，不会钻进地面。
- 每帧解算（`update()`，行 306-345）：
  `height = minHeight + sin(tilt) × effectiveDistance`，`horizontal = cos(tilt) × effectiveDistance`；
  `camera.position = anchor × (R + height) + viewDir × horizontal`；`camera.up = anchor`；`camera.lookAt(anchor × R)`。
  相机 up 取当地法线 → 地平线永远水平、建筑永远竖着，但**不吸附正北**。
- 输入：右键拖拽（`MOUSE.ROTATE`：水平 → 方位，竖直 → 仰角）、左键拖拽（`MOUSE.PAN`：锚点沿球面平移，`anchor += 切向位移 / R` 后归一化）、滚轮（`wheelDollyBase = 0.999` 乘性改距离，唯一缩放入口）、`WASD`（上下左右平移，`keyPanSpeed = 240 px/s`，与拖拽同一套像素→世界换算）、触屏单指旋转 / 双指缩放+旋转。**中键不绑定任何动作**（`mouseButtons.MIDDLE = -1`）。拖拽有 `dragThreshold = 3px` 死区，避免单击时抖视角。
- **地平线联动**：站在离地 h 处只能看到 `R·acos(R/(R+h))` 以内的目标。`setDistance()` 拉远到锚点会被挡住时自动抬高 `tilt`；`setTilt()` 只夹范围，距离由 `effectiveDistance` 收。实现在 `maxDistanceForTilt` / `minTiltForDistance`（二分）。
- `setHome(anchor, viewDir, tilt, distance)` / `reset()`：入场姿态。`BlueprintEditor.applyHome()` 按建筑质心的球面点作锚点、图纸长边横向摆正、外接圆半径定距离；蓝图替换时重置，`N` 键也调它。
- 配套：`camera.near = 0.5`（再往小会让 24 位深度缓冲在 z≈200 处的精度低于地基 `REFORM_LIFT = 0.015` 的抬升量）；`src/skyGradient.ts` 的天光背景（见下节）按 `camera.up`（当地法线）取色，俯瞰时星球铺满画面看不见，平视时地平线上一条大气雾带、抬头是星空。

### skyGradient（参见：src/skyGradient.ts）

全屏四边形直接写 NDC（不走相机/模型矩阵，与 FOV、宽高比无关），片元里用 `uProjectionInverse` + 相机旋转反投影出视线方向 `dir`，再按 `elevation = dot(dir, camera.up)` 取色。颜色按 sRGB 直接写，不做线性转换。

- **大气雾带**：`haze = exp(-elev² × 6.76)`（约 ±40° 宽带）与 `rim = exp(-elev² × 81.0)`（约 ±12° 亮边），叠出「贴着地平线那层大气」的厚度。
- **星空**：`starLayer()` 把方向向量乘 `scale` 切 3D 格子、`hash13` 命中阈值的格子放一个星点（两层：45/0.965 与 90/0.982×0.6），星星固定在世界空间、不随相机漂移；雾带里的星星按 `1 - haze × 0.85` 被吃掉（俯瞰时 haze≈0，星空不受影响）。再叠 `noise3()` 两阶噪声做极淡星云。
- **星球边缘光**：解析算出视线到球心的最近距离 `closest`，取 `limb = closest / R`，在 `limb ≈ 1.02` 附近加一圈 `exp(-Δ² × 100)` 的亮边 + `exp(-Δ² × 10) × 0.22` 的柔和外扩；乘 `smoothstep(1.15, 1.9, 相机半径 / R)` 只在相机退到大气层外时出现，贴地时交给上面的雾带。
- 所有高斯一律写成 `x * x`，不用 `pow(x, 2.0)` —— `elevation` 会是负数，GLSL 的 `pow` 在底数为负时是未定义行为。

### SphereGridGeometry（参见：src/SphereGridGeometry.ts）

- `SphereBaseGridGeometry`（行 14-52）：`BufferGeometry` 基类，循环 `iy`（纬度）× `ix`（经度）生成顶点。三个角度旋转 → x/y/z。
- `SphereLatitudeGridGeometry extends SphereBaseGridGeometry`（行 54-74）：纬度环线。indices 沿同一 `iy` 把相邻 `ix` 连成线段（跳过北极/thetaStart>0 的情况）。
- `SphereLongitudeGridGeometry extends SphereBaseGridGeometry`（行 76-96）：经度弧线。indices 沿同一 `ix` 把相邻 `iy` 连成线段。

## 内部关键逻辑

### 坐标分层

1. **蓝图局部格**（x, y）：每个 area 有自己的经向段数 `areaSegments`，决定该 area 经向格宽（= 2π / (areaSegments×5)）。纬向格宽固定 = 2π / (200×5)。
2. **星球全局格**：纬向全星球 1000 格（`ROOT_GRID_SIZE = 1000`），经向赤道 1000 格。纬度格 ∝ cos(lat)。
3. **世界 3D 坐标**：`calcBuildingTrans(R=200.2, pos, building)` 把局部 offset + area 定位 + yaw/tilt 旋转 → 两个 Matrix4（起点 + 终点）。高度 `z` 乘以 `HEIGHT_GRID_SIZE = 4/3`。

### execVersion / stateVersion 双版本号分流

- **execVersion bump**（剔除建筑 / 撤销 / 重做 / merge 失败的 push） → `computed(() => { commandQueue.value?.execVersion.value; ... })` 整体重建场景。
- **stateVersion bump**（所有命令，包括 silent） → App.vue 重新生成蓝图代码（codeExpired）。
- **Updater dispatcher**（4 个）：`updateBuildingIcon / updateBeltIcon / updateBeltIconSubscript / updateSorterIcon / updateStationInfo` → 增量刷新图标，适用于 silent 命令（改 recipe / filter 不改几何时）。

### BVH 射线拾取

- 拾取盒的 size：传送带 = `meta.selectUnitBoxTrans` 旋转缩放；分拣器 = `0.5×0.5×len` 的盒子沿 z 拉伸 `len`（由 `inserterTrans` 返回）。
- `raycast` 结果按 `distanceSquared` 升序，UI 取第一个（最近的）作为命中对象。

## 依赖的其他模块

| 依赖 | 用途 |
| --- | --- |
| `@/blueprint/planet` 的 `findPosForAreas / calcBuildingTrans` | 区域经纬度定位 + 建筑 Matrix4 变换 |
| `@/blueprint/area` 的 `planetToLocal / AreaGridOrigin` | 光标屏幕命中 → 区域局部格 |
| `@/blueprint/parser` 的 `BlueprintBuilding / BlueprintData / BeltParameters / LabParamerters / ResearchMode` | 场景构建和增量刷新用到类型和字段 |
| `@/command` 的 `CommandQueue / Updater` | 命令执行 → execVersion bump → 整体重建；Updater dispatcher 增量刷新 |
| `@/data/items` 的 `isBelt / isInserter / isSplitter / isStation / isLab / isMonitor / isStorage / isArtificialStar / isBattleBase / isDispenser` 等 | buildBuildings 按 itemId 分支 |
| `@/data/building` 的 `buildingMeta / noIconBuildings / buildingBoxes` | 选择盒尺寸、颜色、icon 偏移；跳过无图标建筑 |
| `@/data/icons` 的 `itemIconId / recipeIconId / iconUrl / allIconIds` | 图标 ID 计算和 URL 获取 |
| `three` | 全部 3D 基础 |
| `vue` | computed / inject / watchEffect |
