# 建筑模型：贴图通道接入与资源清理

> 实现报告（可复核）。目标：给 `src/assets/icons/models/` 里的 78 个 GLB 建筑模型补上 DSP 原包的
> 法线（`-n`）/ 自发光（`-e`）/ 高光（`-s`）三套贴图，并把永远用不上的贴图移出仓库；
> 同时为全部建筑模型提供 `emissiveIntensity` / `envMapIntensity` / `metalness` 三个可调参数。

---

## 0. TL;DR

| 项 | 结果 |
| --- | --- |
| GLB 模型 | 78 个（125.4 MB），内嵌的全部是**底色图**，没有任何通道图 |
| 材质 | 129 个；其中 **69 个**是「底色来自 `-a` 图」的真实建筑材质，其余 60 个是特效/玻璃材质（底色本身就是特效图） |
| 接入结果 | 法线 **67**、自发光 **61**、spec-gloss **69** 个材质；共引用 **161** 张贴图（210.0 MB） |
| 贴图清理 | 移走 **373** 张（176.1 MB，含 108 张与 GLB 内嵌图逐字节相同的 `-a` 源图）；仓库内保留 161 张 |
| 可调参数 | `src/models/modelMaterialTuning.ts`：78 个模型各一条，见 §5 |
| 环境反射 | 程序化 PMREM 中性环境图，只挂建筑材质（不污染行星/网格线），见 §6 |
| 构建 | ✅ `vue-cli-service build` 通过；`dist/textures/` 161 个文件、`dist/models/` 78 个文件 |
| 单测 | ✅ 12 个套件 / 79 个用例全过（新增 `tests/unit/models/textureManifest.spec.ts` 8 个用例） |
| 备份 | `D:\aksa\aska\github\_unused_textures_20261029\`（含 `MOVE_LIST.md` 与 `restore.ps1`） |

---

## 1. 两个决定实现方式的前置事实

### 1.1 GLB 里只有底色图

抽查 + 全量扫描（`parseGlb` 直接读 GLB 的 JSON chunk 与 BIN chunk）：

```text
assembler.glb   materials=[{name:"assembler-mk-1", pbrMetallicRoughness:{baseColorTexture:{index:0}}}]  images=1
smelter.glb     materials=[{name:"smelter-lod0",   ...同上...}]                                          images=1
splitter-a.glb  materials=[{name:"splitter", ...}, {name:"splitter-black", {}}]                          images=1
```

即：`map` 有、`normalMap` / `emissiveMap` / `metallicRoughnessTexture` 全都没有；而 glTF 的
`metallicFactor` 缺省是 **1.0**，场景里又没有环境贴图——所以接入前金属面除了方向光的镜面高光以外基本是黑的。

色彩通道统计也印证了这些未接入贴图的语义：

| 后缀 | 尺寸/数量 | 通道统计 | 结论 |
| --- | --- | --- | --- |
| `-a` | 2048²，87 张 105 MB | RGBA，`map` 用 | 底色（已内嵌） |
| `-n` | 2048²，88 张 128 MB | B 通道均值 ≈0.5，A 恒 255 | 切线空间法线（绿通道朝上） |
| `-e` | 1024²，91 张 12 MB | 近灰度、带 alpha | 自发光 |
| `-s` | 1024²，97 张 95 MB | RGB=高光色，A=光滑度（mean≈0.4） | Unity **spec-gloss** |

### 1.2 磁盘命名不统一，只能靠哈希锚定

同一个建筑的通道图可能叫 `assembler-mk-n.png`、`smelter-a-lod0.png`、`splitter-lod-s.png`，
甚至 `tesla-tower-1n.png`（通道字母粘在编号后面）。所以映射不能用「猜文件名」：

1. 读 GLB 内嵌图的字节 → **MD5**；
2. 与磁盘 PNG 的 MD5 全等比对 → 确定「这个材质用的到底是哪张底色图」；
3. 由命中的文件名剥掉通道标记与 LOD 标记得到**词干**（如 `assembler-mk`），
   再在同目录同词干里找 `-n/-e/-s`。

这条路是 100% 可复核的：同一张图在多个目录重复出现时取路径最短的那份，不会串到别的建筑上。

---

## 2. 映射生成器：`scripts/gen-texture-manifest.mjs`

```bash
node scripts/gen-texture-manifest.mjs                        # 扫描 GLB + PNG，重新生成映射
node scripts/gen-texture-manifest.mjs --report               # 只打印覆盖率
node scripts/gen-texture-manifest.mjs --extra-root <备份目录>  # 底色图已清理时，把备份当只读素材池
node scripts/gen-texture-manifest.mjs --from-mapping          # 完全按 scripts/texture-mapping.json 复原
```

产物：

| 文件 | 用途 |
| --- | --- |
| `scripts/texture-mapping.json` | 持久映射表（材质 → 底色/法线/自发光/spec 的相对路径 + 生成时间），清理脚本与单元测试都读它 |
| `src/models/textureManifest.ts` | **自动生成**的运行期清单：`模型名::材质名 → {normal, emissive, spec}`（`require()` 出 webpack URL）+ `manifestTextureFiles` 全量列表 |

### 2.1 命名家族与 LOD 选择

| 家族 | 例子 | 识别方式 |
| --- | --- | --- |
| `dash` | `assembler-mk-n.png`、`smelter-a-lod0.png`、`smelter-lod-s.png` | 通道是独立的 `-n/-a/-s` 片段 |
| `glued` | `tesla-tower-1a.png`、`tesla-tower-1n.png` | 正则 `^(.+?\d)([aens])$` 兜底 |

同组三张图必须同族（否则拼出来的文件名对不上）。通道图优先挑与底色图**同一 LOD 层级**的那张
（GLB 内嵌的是 LOD0 底色，就取 LOD0 的法线/高光），保证细节密度一致。

> 执行过程中这两条规则各自救回一处真实缺陷：
> - 初版没认 `glued` 家族 → **电力感应塔（`tesla-coil`）的 4 张贴图被误判为无用**，已修正并保留 `tesla-tower-1e/1n/1s`；
> - 初版 LOD 只按「无 LOD > lod0 > 其它」排序，`smelter` 的底色是 `smelter-a-lod0.png` 却配了 `smelter-lod-n.png`，
>   现在改成「同 LOD 优先」，`smelter` 整套走 lod0，自发光因没有 lod0 版本才退回 `smelter-e.png`。

### 2.2 覆盖率与已知缺口

69/129 个材质挂上了至少一张通道图；10 处缺口都是**原包里就没有这张图**，不是匹配失败：

| 模型 | 缺什么 | 原因 |
| --- | --- | --- |
| `inserter-1/2/3/4` | `-e` | 分拣器目录里不存在 `inserter-e.png` |
| `monitor` | `-e` | 同上（只有 `monitor-light.png`，是独立的发光贴图，不是自发光通道） |
| `splitter-a/b/c` | `-e` | 同上 |
| `smelter-2-glass-1/2` | `-n` | 玻璃材质只导出 `-s`/`-e` |

---

## 3. 运行期加载：`src/models/textureMaps.ts`

| 关注点 | 做法 |
| --- | --- |
| 懒加载 | 模型加载成功后按清单异步取图；**不 await、不阻塞**模型可用性，没到之前先显示底色 |
| 去重 | 同一 URL 只解码一次（`imageCache` / `setCache` 双层 Promise 缓存） |
| 失败 | 任一通道失败 → 该项为 `null`，模型保留底色；整体**永不 reject**（与 `glbLoader` 同契约） |
| UV 约定 | `texture.flipY = false`——GLB 是 glTF 的 UV（v 轴朝下），保持 three 默认会整体上下错位 |
| 色彩空间 | 自发光用 `SRGBColorSpace`；法线与 ORM 用 `NoColorSpace` |
| 过滤 | `anisotropy = renderer.capabilities.getMaxAnisotropy()`（由 `BlueprintEditor` 初始化时注入） |
| spec-gloss → three | 内存里用 canvas 重打包成 **ORM 图**：`G = 255·(1−A)`（粗糙度）、`B = 255·luma(RGB)`（金属度）、R/A 留白；`roughnessMap` 与 `metalnessMap` 共用这一张，不落盘、不新增文件 |

---

## 4. 材质接入：`src/models/materialTextures.ts`

在 `glbLoader` 解析成功、写入缓存之后触发（`void applyModelMaterialTextures(model)`）：

1. 遍历 `scene` 收集 `MeshStandardMaterial`（按 `uuid` 去重，同一材质只改一次）；
2. `envMap = 中性环境图`、`envMapIntensity = tuning.envMapIntensity`——**所有**标准材质都设，玻璃/特效也不例外；
3. 有 `-s` → `metalness = tuning.metalness`（作为乘数）、`metalnessMap = orm`、`roughness = 1`、`roughnessMap = orm`；
   没有 `-s` → `metalness = tuning.metalness × METALNESS_WITHOUT_SPEC_MAP(0.25)`（避免纯金属无反射发黑）；
4. 有 `-e` → `emissive = 白`、`emissiveMap`、`emissiveIntensity = tuning.emissiveIntensity`；
5. 有 `-n` → `normalMap`、`normalScale = (1, 1)`；
6. `material.needsUpdate = true`。

**为什么原地改材质就够**：`GlbModelInstances` 复用 GLB 缓存里的同一个材质对象建 `InstancedMesh`，
贴图到达时改的是同一个对象，已经建好的实例自动跟着变，不需要重建场景。
法线方向若上机后发现凹凸相反，只需把 `materialTextures.ts` 里的 `NORMAL_SCALE_Y` 取负。

---

## 5. 可调参数：`src/models/modelMaterialTuning.ts`

唯一的手调入口，78 个模型各一条（键 = `.glb` 文件名，注释里标了该模型实际可用的通道图）：

```ts
'assembler-4': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
```

| 参数 | 语义 | 调参建议 |
| --- | --- | --- |
| `emissiveIntensity` | 自发光强度；**只有带 `-e` 图的模型才生效** | 6 个无 `-e` 的模型（分拣器/监测器/分流器）调了没用；过曝调到 0.6~0.9 |
| `envMapIntensity` | 环境反射权重 | 整批偏暗先动它（0.6~1.2）；偏低更像哑光塑料 |
| `metalness` | 金属度；有 `-s` 图时是**乘数**，没有时按 0.25 缩放后使用 | 塑料感太强往上调（0.4~1.0） |

`DEFAULT_MODEL_MATERIAL_TUNING` / `METALNESS_WITHOUT_SPEC_MAP` 是兜底常量；改完刷新页面即可，无需重新生成清单。

---

## 6. 环境反射：`src/models/envMap.ts`

- 用 `PMREMGenerator.fromEquirectangular()` 从一张 256×128 的**程序化渐变图**（天顶偏冷 → 地平线偏亮 → 地面偏暗）
  生成环境图，**不引入任何外部资源文件**；
- 只设置到 `material.envMap`，**不设 `scene.environment`**——否则行星本体、经纬网格也会被环境光洗亮，整屏泛白；
- 生成失败（无 WebGL / PMREM 不可用）时返回 `null`，材质退回「无环境反射」而不是崩掉。

---

## 7. 资源清理：`scripts/prune-model-textures.mjs`

```bash
node scripts/prune-model-textures.mjs            # 预演，只打印统计
node scripts/prune-model-textures.mjs --apply    # 真正移动
```

| 项 | 数值 |
| --- | --- |
| 原始 PNG | 534 张 / 386.1 MB |
| 保留 | **161 张 / 210.0 MB**（= 清单里 `normal`/`emissive`/`spec` 指向的文件） |
| 移走 | **373 张 / 176.1 MB** |
| 移走内容 | LOD1/LOD2 变体、未接入的特效/遮罩图、108 张与 GLB 内嵌图逐字节一致的 `-a` 源图、无对应建筑的目录（`belt`/`cargo`/`common ruins`/`space capsule*`） |

判定口径写死在脚本里：**只有 `scripts/texture-mapping.json` 引用到的文件才算「有用」**，
不做「可能以后有用」的猜测。安全性：

- 只移动、不删除：目标 `D:\aksa\aska\github\_unused_textures_20261029\`（仓库外），保持原相对路径；
- 每次移动都校验 `statSync` 字节数一致；
- 备份目录内有 `MOVE_LIST.md`（全部 373 条的清单 + 本次移动明细）与 `restore.ps1`（一键按原路径还原）；
- 清空后的 5 个空目录已删除（`belt` / `cargo` / `common ruins` / `space capsule` / `space capsule 1`）。

---

## 8. 构建配置

`vue.config.js` 新增一条规则（排在 `/\/assets\//` 之后，靠后匹配覆盖前面的 `type`）：

```js
{
    test: /assets[\\/]icons[\\/]models[\\/].+\.png$/i,
    type: 'asset/resource',
    generator: { filename: 'textures/[path][name].[contenthash:8][ext]' },
}
```

两个坑：

1. 正则必须同时兼容 `\` 与 `/`：webpack 在 Windows 上给的是反斜杠路径，只写 `/` 会**静默失配**，
   贴图会落到默认的 `img/[name].[hash]`（首次构建实测：`dist/img` 354 个文件、`dist/textures` 根本不存在）；
2. 用 `[path]` 保留目录结构：不同建筑目录里有同名贴图（如 `color-palette-256.png`），只按 `[name]` 会互相覆盖。

---

## 9. 验证

```bash
npx eslint src/models/textureMaps.ts ...          # ✅ 新增/修改文件 0 error
npx jest                                          # ✅ 12 套件 / 79 用例全部通过
npx vue-cli-service build                         # ✅ 0 error
```

| 检查项 | 结果 |
| --- | --- |
| `dist/textures/` | ✅ 161 个文件 / 210.0 MB（与清单一一对应） |
| `dist/models/` | ✅ 78 个文件 / 125.4 MB |
| `dist/img/` | ✅ 200 个文件 / 2.9 MB（只剩物品图标，不再混入建筑贴图） |
| 清单完整性单测 | ✅ 每个 `manifestTextureFiles` 都在磁盘上；键里的模型名都有真实 `.glb`；69/67/61/69/161 的规模断言 |
| 参数表单测 | ✅ 78 个模型全覆盖、无僵尸条目、三参数有限且在区间内、兜底行为正确 |
| 全项目 lint | ⚠️ 仅 1 条**既有**错误：`tests/unit/blueprint/command.spec.ts:2` 未使用的 `Command` 导入（本次未触碰该文件） |

---

## 10. 代价与风险

1. **显存/带宽**：保留的 210 MB 是「未压缩」贴图。法线多为 2048² RGBA（单张含 mipmap ≈21 MB），
   同时把几十种建筑都亮出来时显存占用可观。若后续需要瘦身，可单独做 KTX2/WebP 压缩（本次按要求未做）。
2. **法线绿通道方向**：Unity 与 glTF 的切线空间约定若不一致，表现为凹凸反向——一键改 `NORMAL_SCALE_Y = -1` 即可。
3. **特效/玻璃材质的观感变化**：60 个特效材质原先 `metalness=1`（无环境反射时几乎全黑），现在降到 0.25 并吃到环境反射，
   会比接入前「亮」。这是修正，但如果某个特效依赖「纯黑底」，需要在参数表里单独调。
4. **没有做视觉验收截图**（按要求只交代码）：朝向/亮度主观项仍需在浏览器里过一遍。

---

## 11. 人工确认清单

- [ ] 熔炉/制造台上机后，金属斜坡是否出现细微凹凸（法线）？
- [ ] 人造恒星、射线接收站、护盾发生器、垂直发射井的发光部位是否亮起（自发光）？
- [ ] 整体是否比之前更亮但不发灰？若整体偏暗 → 调 `envMapIntensity`；若塑料感 → 调 `metalness`。
- [ ] 建筑表面有没有出现上下/左右错位的图案（`flipY` 或 UV 问题）？
- [ ] 凹凸看起来是「凸」还是「凹」？反了 → `NORMAL_SCALE_Y = -1`。
- [ ] 分拣器/监测器/分流器这些没有 `-e` 的模型，是否至少没有变黑？
- [ ] 断网后打开蓝图：模型应正常显示底色，控制台只出现 `[tex] 贴图加载失败` 警告，不白屏。
