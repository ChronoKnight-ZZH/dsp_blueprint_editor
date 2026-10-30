# BlueprintViewer Demo

阶段 B 验证页（方案 §7.2 出口条件 1）：在真实浏览器里跑通
`new BlueprintViewer({ container })` + `loadBlueprint(str)`。

## 启动

```bash
yarn serve
```

打开 http://localhost:8080/dsp_blueprint_editor/demo.html
（8080 被占用时看终端输出的实际端口）。

## 页面功能

| 区域 | 验证点 |
| --- | --- |
| 启动自动执行 | `new BlueprintViewer('#viewer', …)` → fetch `public/demo/sample_throughput.txt` → `loadBlueprint(str)` → 星球+建筑渲染 |
| 蓝图输入框 | 手工粘贴任意 `BLUEPRINT:…` 串再 `loadBlueprint` |
| 「坏字符串」按钮 | `{ ok:false, error.code:'invalid-start' }` 分支 + onError 回调 |
| RenderSettings 三项 | `setRenderSettings`：showRealModels/maxInstances → 重建；texturesEnabled → 原地重挂贴图（不应看到重建日志） |
| 「resetCamera」 | `controls.reset(2R)` |
| 「getBlueprintData」 | 成功后返回数据；失败后应返回**上一次成功**的数据（方案 §6.4） |
| 「dispose」 | canvas 移除、rAF 停止、日志显示残留 canvas 数应为 0；dispose 后再点其它按钮应报 `already-disposed` |
| 日志面板 | `onRebuild`（reason=load/settings/models）与 `onError` 的时间线 |

## 文件

- `demo/main.ts` — demo 逻辑（webpack 入口之一，见 `vue.config.js` 的 `pages.demo`）
- `demo/index.html` — demo 页模板
- `public/demo/*.txt` — fixture 蓝图（从 `tests/unit/blueprint/fixtures/` 复制）

## 注意

- fixture 用**相对路径** fetch（页面与 fixture 同在 `/demo` 路径下），不依赖 publicPath；
  vue-cli/webpack 环境没有 `import.meta.env`，不要改成 Vite 语法。
- GLB 模型与贴图仍走 `require.context` / publicPath（方案 §8 第 3 条），demo 页与主站同构建环境，行为一致。
