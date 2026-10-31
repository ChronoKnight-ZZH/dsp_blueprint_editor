# DSP Blueprint Editor · 无头蓝图渲染库

`BlueprintViewer`：只读的戴森球蓝图 3D 渲染器。**不含任何 UI/按钮**，全部通过类实例方法控制。
本目录由 `yarn build:lib` 生成，可整个拷到任意静态目录 / CDN 下使用。

```
dsp-blueprint-editor.umd.js   UMD（内联 three，全局名 DSPBlueprintEditor）
dsp-blueprint-editor.esm.js   ESM（three 作 external，需要宿主自备 three）
index.d.ts                    公共类型声明
host-test.html                宿主验证页（纯静态，Network 零 404 自检）
assets/                       外置资产
  models/<name>.glb                    建筑模型
  img/models/<建筑>/<贴图>.png          法线 / 自发光 / spec-gloss 通道贴图
  icons/item_recipe/*.png              物品与配方图标
  icons/tech/*.png                     科技图标
  icons/signal/*.png                   信号图标
fixtures/sample_blueprint.txt 验证页用的蓝图样本（可删）
```

## 1. 纯静态 `<script>` 标签（UMD）

```html
<div id="viewer" style="width: 100%; height: 480px"></div>
<script src="./dsp-blueprint-editor.umd.js"></script>
<script>
    const viewer = new DSPBlueprintEditor.BlueprintViewer(
        { container: '#viewer', theme: 'dark' },
        { onError: e => console.warn(e.code, e.message) },
    );
    viewer.loadBlueprint(blueprintText);
</script>
```

资产地址默认取「加载本库的那个 `<script src>` 所在目录 + `assets/`」，所以把整个目录
搬到任何路径、任何子目录都不用改代码。库文件被搬走 / 改名 / 由别的域加载时，显式指定：

```js
DSPBlueprintEditor.configureAssetBaseUrl('https://cdn.example.com/dsp/');
// 传 '.../assets' 本身也认；传 null / '' 恢复自动探测
```

## 2. 工程内 `import`（ESM）

```js
import { BlueprintViewer, parseBlueprint, serializeBlueprint, configureAssetBaseUrl } from './dist-lib/dsp-blueprint-editor.esm.js';

configureAssetBaseUrl('https://cdn.example.com/dsp/');   // ESM 场景请显式配置资产根
const viewer = new BlueprintViewer({ container: '#viewer' });
```

`three` 是 ESM 产物的唯一 external 依赖（`^0.160`），其余依赖已内联。

## 3. 公共 API（只有这 4 个）

| 导出 | 说明 |
|------|------|
| `BlueprintViewer` | 无头渲染器类；加载 / 选中 / 定位 / 主题 / 截图 / 销毁 |
| `parseBlueprint(str)` | 蓝图字符串 → 数据对象（失败抛异常） |
| `serializeBlueprint(data)` | 数据对象 → 蓝图字符串 |
| `configureAssetBaseUrl(base)` | 资产根地址（见上） |

`BlueprintViewer` 的公开方法**不抛异常**，统一返回 `{ ok: true, value } | { ok: false, error }`：

```js
const outcome = viewer.loadBlueprint(text);
if (!outcome.ok) console.warn(outcome.error.code);        // invalid-start / checksum-mismatch / ...
outcome.ok && console.log(outcome.value.buildingCount);  // 建筑数、区域数、未知模型号

viewer.focusBuilding(3);                 // 镜头居中对齐（不锁镜头）
viewer.selectBuilding(3);                // 只选中，不动镜头
viewer.getBuildingInfo(3);               // { ok: true, value: { index, id, matrix } }
viewer.setTheme('light');
viewer.setRenderSettings({ showRealModels: false });
const png = viewer.toDataURL();
viewer.dispose();                        // 幂等
```

完整签名见同目录 `index.d.ts`。

## 4. 自检

用任意静态服务器打开 `host-test.html`（**必须 http(s)，`file://` 会被 CORS 拦住**）：

```bash
npx serve dist-lib     # 或 python -m http.server -d dist-lib 8000
```

页面会用 UMD 全局建实例、加载 fixture、等资源静置后核对：网络零 404、模型/图标/贴图
都从 `assets/` 成功加载、`toDataURL()` 非空、无 `onError`。把整个 `dist-lib/` 换个路径
再打开，结论应完全一致。

页面下方还有一个**控制面板**：31 个按钮，每个直接绑一个 `BlueprintViewer` 实例方法
（加载 / 选中 / 聚焦 / 主题 / 相机 / 尺寸 / 导出 / 渲染设置 / 销毁重建），点击结果写进
旁边的日志。它演示的正是「黑盒里没有 UI，UI 由宿主自己写、方法由宿主自己调」：
面板脚本不持有闭包里的实例，而是点击时向 `window.__dspHost.getViewer()` 取当前实例，
所以「dispose → 重建」之后按钮自动指向新实例。

## 5. 已知约束

- 单实例语义：模型 / 贴图 / 图标缓存是模块级单例，同一页面只建一个 `BlueprintViewer` 最省资源；
- TypeScript 宿主需要 `@types/three`（`index.d.ts` 里的 `Matrix4` / `PerspectiveCamera` 来自 three）；
- 资产体积较大（模型 + 贴图），建议放在支持长缓存与 gzip/br 的静态服务器上；
- 蓝图解析需要 `pako`（解压），已内联，宿主无需安装。
