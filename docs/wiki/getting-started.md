# 环境配置与运行

## 前置条件

| 工具 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18 | Vue CLI 5 + webpack 5 需要 |
| Yarn | ≥ 1.22 | 项目用 yarn（非 npm），有 `yarn.lock` |

## 安装

```bash
# 克隆
git clone <repo-url>
cd dsp_blueprint_editor

# 安装依赖（会自动触发 patch-package postinstall）
yarn install
```

`postinstall` 脚本（`package.json:13`）自动运行 `patch-package`，应用 `patches/` 目录下的 node_modules 补丁。

## 常用命令

### 开发服务器

```bash
yarn serve
```

启动 `vue-cli-service serve`，默认监听 `http://localhost:8080`。HMR（Hot Module Replacement）默认开启，前端改动自动热更新。访问路径带 `publicPath: '/dsp_blueprint_editor/'` 子路径。

### 生产构建

```bash
yarn build
```

输出到 `dist/` 目录，包含：
- HTML 入口页
- 按 chunk 拆分的 JS（`renderer` chunk 异步加载 3D 模块）
- PWA service worker
- `public/img/icons/` 下的 PWA 图标

构建时 webpack DefinePlugin 注入：
- `VERSION` = `git describe --tags --always --dirty`（在 `App.vue` 页脚显示）

### 测试

```bash
yarn test:unit               # 跑全部 Jest 测试
yarn test:unit -- --watch    # 监视模式
yarn test:unit -- tests/unit/blueprint/stats.spec.ts  # 指定文件
```

测试配置：`jest.config.js`，ts-jest + @vue/vue3-jest，`moduleNameMapper '@/*' → '<rootDir>/src/*'`。

### CLI（蓝图字符串 → JSON）

```bash
echo 'BLUEPRINT:0,10,...' | yarn cli
# 或
cat blueprint.txt | yarn cli > bp.json
```

底层命令：
```bash
ts-node -r tsconfig-paths/register -O '{"module":"commonjs"}' src/cli.ts
```

`-r tsconfig-paths/register` 让 CLI 运行时支持 `@/` 路径别名。

### 代码格式化

```bash
yarn format
```

Prettier 配置：项目根目录 `.prettierrc`，覆盖 src 下 js/ts/vue/json/css/scss/md。

### 代码检查

```bash
yarn lint
```

`vue-cli-service lint`，ESLint + eslint-plugin-vue + @vue/eslint-config-typescript。

## 项目结构

```
dsp_blueprint_editor/
├── src/
│   ├── App.vue                    # 根组件
│   ├── main.ts                    # createApp 入口
│   ├── blueprint/                 # 蓝图逻辑（纯 TypeScript）
│   │   ├── parser.ts              # 蓝图字符串 ↔ 数据结构
│   │   ├── planet.ts              # 区域定位 + 坐标变换
│   │   ├── area.ts                # 区域坐标换算
│   │   ├── md5.ts                 # 纯 JS MD5
│   │   ├── replace.ts             # 批量替换
│   │   ├── upgrade.ts             # 建筑升降级
│   │   ├── sorter.ts              # 分拣器连接构造
│   │   ├── beltLine.ts            # 传送带铺线
│   │   ├── create.ts              # 新建蓝图 + CreateBuildingCommand
│   │   ├── removeBuilding.ts      # 删除建筑命令
│   │   ├── defaultParams.ts       # 默认参数模板
│   │   ├── stats.ts               # 生产统计
│   │   ├── reformEdit.ts          # 地基逐格编辑
│   │   ├── reformImage.ts         # 照片转蓝图
│   │   └── ...
│   ├── components/                # Vue UI
│   │   ├── BlueprintEditor.vue    # 3D 编辑器主体
│   │   ├── BuildingInfoPanel.vue  # 建筑详情
│   │   ├── ReplaceModal.vue       # 批量替换弹窗
│   │   └── ...
│   ├── data/                      # 数据资源（纯 TypeScript）
│   ├── locales/                   # zh.json / en.json
│   ├── bvh/                       # BVH 射线拾取
│   ├── command.ts                 # CommandQueue + Updater
│   ├── define.ts                  # VERSION + provide keys
│   └── iconTexture.ts             # 图标图集纹理
├── tests/unit/blueprint/          # Jest 单元测试
├── tests/tools/                   # ts-node 诊断/标定脚本
├── docs/wiki/                     # 本 Wiki 文档
├── vue.config.js                  # Vue CLI 配置
├── tsconfig.json                  # TypeScript 配置
├── jest.config.js                 # Jest 配置
├── package.json                   # scripts + 依赖
└── yarn.lock
```

## 关键配置文件

### vue.config.js

```javascript
module.exports = {
    publicPath: '/dsp_blueprint_editor/',  // GitHub Pages 子路径
    chainWebpack: config => {
        config.resolve.alias.set('three$', 'three/src/Three.js');
    },
    pwa: { name: '戴森球计划蓝图预览', themeColor: '#000000' },
    pluginOptions: { i18n: { localeDir: 'locales', compositionOnly: true } },
};
```

### tsconfig.json

```json
{
    "target": "esnext",
    "module": "esnext",
    "strict": true,
    "paths": { "@/*": ["src/*"] },
    "types": ["webpack-env", "jest"]
}
```

## 开发工作流

1. `yarn install` → `yarn serve`
2. 浏览器打开 `http://localhost:8080/dsp_blueprint_editor/`
3. 粘贴蓝图字符串或拖入 .txt 文件
4. 在 3D 视图中编辑（点选、右键删除、侧栏批量操作）
5. 点击"复制"或"保存文件"导出新蓝图
6. 粘贴回游戏或保存到文件

## 常见问题

### Q: yarn cli 报 "Cannot find module '@/blueprint/parser'"？

需要 `-r tsconfig-paths/register` 参数（见 `package.json:11`），或者先 `yarn build-cli` 再运行编译后的 `cli/cli.js`。

### Q: 蓝图解析报错 MD5 不匹配？

MD5 是从 `BLUEPRINT:` 开头到引号（不含引号和 md5 本身）的字符串计算的。粘贴时确保没有多余空格。

### Q: 批量替换配方后加速度没变？

需要在 ReplaceModal 勾选配方范围后选择加速模式（不改变/额外产出/生产加速），这会额外推送 `SetAcceleratorCommand`。

### Q: 分流器角度偏移报错？

这是早期版本的导出 bug。当前版本确保 `v2ExtraPose[4] === yaw[0]`，且导入时会自愈角度差 >45° 的坏数据。详见 `modules/blueprint-core.md`。

## CI/CD

GitHub Actions workflow `.github/workflows/gh-pages.yml`：

- 触发：push 到 main 分支
- steps：checkout (fetch-depth:0) → setup-node@18 → yarn install → yarn build → upload → deploy-pages
- 部署 URL：`https://<user>.github.io/dsp_blueprint_editor/`

## 参考链接

- 游戏官网: https://store.steampowered.com/app/1366540/Dyson_Sphere_Program/
- Vue 3 文档: https://vuejs.org/
- Three.js 文档: https://threejs.org/docs/
