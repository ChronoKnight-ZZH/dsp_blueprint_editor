# GLB 贴图 KTX2 化（Basis Universal）流水线

把 `src/assets/icons/models/` 下「GLB 模型 + 外置 PNG 通道贴图」改造成**自包含的 KTX2 内嵌 GLB**：
下载体积与显存占用同时下降，材质关联与 UV 完全不变。

```
原始状态                             目标状态
├─ accumulator.glb  (内嵌 albedo)  →  └─ accumulator.glb
└─ accumulator/                    　　  ├─ baseColor    ETC1S (KTX2)
   ├─ accumulator-a.png (锚点)    　　  ├─ normal       UASTC (KTX2)
   ├─ accumulator-n.png           　　  ├─ emissive     ETC1S (KTX2)
   └─ accumulator-s.png          　　　  └─ metallicRoughness UASTC (KTX2)  ← 由 -s 离线重打包
```

## 为什么不是「一条命令搞定」

本项目的现状决定了必须分三步（每步都能单独验证、单独回滚）：

1. **GLB 里目前只有底色图**。`-n / -e / -s` 三张通道图是运行期由 `src/models/materialTextures.ts`
   用 `new Image()` 拉 PNG、再由 `textureMaps.ts` 在 canvas 里把 Unity spec-gloss
   重打包成 ORM 的。`gltf-transform` 不认识这套规则，所以**必须先把它们合进 GLB**，
   合的时候就把 ORM 重打包算好（`01-embed-textures.mjs`）。
2. **`ktx` 编码必须在「贴图已挂到正确槽位」之后做**。`gltf-transform etc1s/uastc` 是
   按**槽位**过滤、按槽位推导色彩空间（`baseColorTexture` → sRGB，`normalTexture`
   → linear）来决定 `ktx create --assign-tf` 的。顺序反了就会得到「发灰的贴图」——
   这是 KTX2 最常见的翻车点，详见下文「避坑」第 1 条。
3. **-s 贴图不是 roughnessMap**。DSP 的 `-s` 是 Unity spec-gloss：RGB=高光色、
   A=光滑度；three 的 `roughnessMap` 读 **G**、`metalnessMap` 读 **B**。所以要先按
   `R=255 / G=1-A / B=0.299R+0.587G+0.114B` 重打包成 ORM（与
   `textureMaps.packOrm()` 逐像素等价），再交给 KTX2。

## 步骤

### 0. 环境

```powershell
# ktx.exe（KTX-Software ≥ 4.4.0，gltf-transform 4.4+ 硬性要求）
#   下载 https://github.com/KhronosGroup/KTX-Software/releases
#   解压 KTX-Software-<ver>-Windows-x64.zip，把里面的 bin\ 加入 PATH
ktx --version          # 期望: ktx version: 4.4.x

# npm 依赖（全是 devDependencies，不进产物）
npm i -D @gltf-transform/cli@^4.5.0 @gltf-transform/core@^4.5.0 `
          @gltf-transform/extensions@^4.5.0 @gltf-transform/functions@^4.5.0 `
          sharp@^0.33.0

# 国内网络装 sharp 需要镜像
npm config set sharp_binary_host "https://npmmirror.com/mirrors/sharp"
npm config set sharp_libvips_binary_host "https://npmmirror.com/mirrors/sharp-libvips"
```

### 1. 合体：外置 PNG → GLB 内嵌（仍是 PNG）

```powershell
node scripts/glb-ktx2/01-embed-textures.mjs                     # 全量 78 个模型
node scripts/glb-ktx2/01-embed-textures.mjs --only accumulator  # 先拿一个模型试
```

输出 `temp/ktx2/01-embedded/*.glb` + `_report.json`。**不改动 `src/` 下任何原始文件。**

### 2. 编码：PNG → KTX2（两遍，颜色与数据分开）

```powershell
node scripts/glb-ktx2/02-encode-ktx2.mjs --concurrency 2
```

等价的手工命令（理解参数用，脚本内部就是这两行）：

```powershell
# 第一遍：颜色贴图 → ETC1S（quality 128 / compression 2）
gltf-transform etc1s in.glb mid.glb `
  --slots "{baseColorTexture,emissiveTexture}" `
  --quality 128 --compression 2 --mipmaps --jobs 4

# 第二遍：数据贴图 → UASTC（level 2 / rdo lambda 4）
gltf-transform uastc mid.glb out.glb `
  --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" `
  --level 2 --rdo --rdo-lambda 4 --zstd 18 --mipmaps --jobs 4
```

参数对照（与 `@gltf-transform/cli` 4.5 源码 `toktx.ts` 一致）：

| 用户目标 | CLI 参数 | 落到 `ktx create` 的实际参数 | 备注 |
| --- | --- | --- | --- |
| 颜色 = ETC1S, quality 128 | `--quality 128` | `--qlevel 128` | 128 就是默认值，写出来只为自证 |
| 颜色 = ETC1S, compression 2 | `--compression 2` | `--clevel 2` | 默认 1；2 更慢一点、质量更好 |
| 数据 = UASTC, level 2 | `--level 2` | `--uastc-quality 2` | 0~4，2 是默认（47.47dB） |
| 数据 = UASTC, rdo 4 | `--rdo --rdo-lambda 4` | `--uastc-rdo --uastc-rdo-l 4` | **法线图会被自动跳过**，见下 |
| 双遍超压缩 | `--zstd 18` | `--zstd 18` | 默认值；`0` 可关闭 |
| 色彩空间 | 自动 | 颜色 `--assign-tf srgb`，数据 `--assign-tf linear` | 由槽位推导，别手动改 |

> ⚠️ **法线图不会吃到 RDO**：`toktx.ts` 里有
> `const isNormalMap = slots.find(slot => micromatch.isMatch(slot, '*normal*'))`，
> 命中就整段跳过 `--uastc-rdo`（KTX-Software #600：RDO 会破坏法线图的方向精度）。
> 所以 `--rdo --rdo-lambda 4` 实际只作用于 `metallicRoughnessTexture`（和 occlusionTexture）。
> 这正好符合「法线不能有伪影」的诉求，不需要额外处理。

### 3. 校验（务必先跑，别急着删源图）

```powershell
node scripts/glb-ktx2/03-verify.mjs
```

逐项检查：`extensionsRequired` 含 `KHR_texture_basisu`、所有 `images[].mimeType` 为
`image/ktx2` 且无外链 `uri`、每个材质的每个贴图槽都挂了 `KHR_texture_basisu.source`、
KTX2 魔数 `AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A` 正确、体积与压缩比。

### 4. 覆盖回源码 + 前端接 KTX2Loader

见仓库根 `docs/` 与本目录 `ktx2-demo.html`；运行时改造要点见下文「前端接入」。

## 前端接入（已落地，四处改动）

| 文件 | 改动 |
| --- | --- |
| `src/models/ktx2.ts` | **新增**：懒加载 `KTX2Loader`、`setTranscoderPath(${BASE_URL}basis/)`、`detectSupport(renderer)`、失败降级为 `null` |
| `src/models/glbLoader.ts` | `parseGlb()` 里 `loader.setKTX2Loader(await getKtx2Loader())` |
| `src/components/BlueprintEditor.vue` | `new WebGLRenderer()` 后 `setKtx2Renderer(renderer)` |
| `src/lib/core/RenderCore.ts` | 同上（库模式入口；ItemInfo 那个渲染器不渲染建筑，不需要注册） |
| `src/models/materialTextures.ts` | 通道贴图**优先用 GLB 内嵌**（KTX2），老 GLB 缺通道才回退外置 PNG（可灰度） |

> KTX2 是 **required 扩展**：带 KTX2 的 GLB 遇到没配 `setKTX2Loader` 的 `GLTFLoader`
> 会直接抛错（不是静默降级），所以「先转 GLB、后改代码」的顺序会让人误以为模型全坏了。

独立的可运行 Demo（不依赖本项目构建，直接用 CDN 的 three 0.160）：
`scripts/glb-ktx2/ktx2-demo.html` —— 打开后选一个内嵌 KTX2 的 `.glb`，
即可看到「置空 / 纯色占位 / 恢复」三种开关的实际效果。

## 避坑清单

1. **色彩空间（发灰）**：ETC1S/UASTC 都是「容器 + 像素格式」，色彩空间写在 KTX2 头部
   （`--assign-tf`）而不是靠 three 猜。`.ktx2` 走 `GLTFLoader` 时由
   `KHR_texture_basisu` 槽位决定，**不需要也不应该**手改 `texture.colorSpace`；
   但如果你自己 `new KTX2Loader().load('x.ktx2')` 手动挂到 `material.map`，
   必须 `texture.colorSpace = SRGBColorSpace`，法线/ORM 必须 `NoColorSpace`。
2. **法线伪影**：法线**永远不要 ETC1S**（块内 4×4 的色度聚类会把 R/G 方向压成噪点）；
   也不要用 RDO。UASTC level 2~4 才有可用结果；level 0/1 在斜面上会出现块状条纹。
3. **`-s` 直接当 roughnessMap**（本项目历史坑）：G/B 通道语义完全不同，必须重打包 ORM。
4. **`flipY`**：GLB 走 glTF 的 UV 约定（v 轴向下），`KTX2Loader` 产出的贴图
   `flipY=false` 是正确的；自己用 `<img>` 加载替换时必须手动 `flipY = false`，
   否则法线/自发光会整体上下错位。
5. **KTX2Loader 路径**：`setTranscoderPath()` 末尾**必须带斜杠**，且指向
   `basis_transcoder.js` + `basis_transcoder.wasm` 所在目录。用 CDN 时注意版本要和
   `three` 对齐（本项目 0.160 → `three@0.160.0/examples/jsm/libs/basis/`）。
6. **忘了 `detectSupport(renderer)`**：不调它也能解析，但会按默认能力猜转码格式，
   iOS / 老 Android 上可能拿到不支持的 `RGBA_ASTC` → 黑图或直接报错。
7. **`extensionsRequired`**：KTX2 是 **required** 扩展，任何没 `setKTX2Loader` 的
   `GLTFLoader` 都会直接抛错（不是静默降级），所以老版本客户端会整模型失败——
   灰度期间建议保留 PNG 版本或做 capability 探测。
8. **mipmap**：`--mipmaps`（默认开）会让 KTX2 自带 mip 链，three 会把
   `generateMipmaps` 置 false 并直接用；关掉它会让远景闪烁，且
   `KTX2Loader` 不会替你补 mip。
9. **`prune --keep-solid-textures`**：不要把 `prune` 的 solid-texture 优化和 KTX2
   混着跑，纯色图会被改成 factor，材质的 `map` 消失，`materialTextures` 的槽位逻辑会错位。

## 体积/显存预期

| 项 | 现状 | KTX2 后（估算） |
| --- | --- | --- |
| 外置 PNG 161 张 | 约 210 MB | ——（不再单独下载） |
| GLB 78 个 | 约 125 MB（内嵌 PNG 底色） | 约 25~40 MB |
| 单张 1024² 底色 PNG | ~1.5 MB / 显存 4 MB | ETC1S ~120 KB / 显存 0.5 MB |
| 单张 1024² 法线 PNG | ~2.5 MB / 显存 4 MB | UASTC ~700 KB / 显存 1 MB |
