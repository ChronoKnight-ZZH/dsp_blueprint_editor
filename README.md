# Code Wiki — dsp_blueprint_editor

> 戴森球计划（Dyson Sphere Program, DSP）蓝图编辑器
> 一个基于 Vue 3 + Three.js 的纯前端单页应用，用于在 3D 星球网格上可视化、编辑、批量替换、撤销/重做戴森球计划蓝图，并能以字节级 round-trip 兼容游戏的 v1/v2 蓝图格式。

---

## 项目目的

DSP（戴森球计划）玩家常需要分享和批量编辑复杂蓝图。本工具提供：

- **可视化编辑**：3D 星球表面实时预览蓝图布局
- **批量操作**：一键替换配方、筛选器、物流塔栏位、传送带图标、蓝图图标；建筑升降级
- **照片转蓝图（像素画）**：上传图片自动量化为地基蓝图
- **完整撤销重做**：256 容量历史栈，支持命令合并
- **字节级 round-trip**：导出的蓝图字符串可直接粘贴回游戏，二进制与原文件一致
- **中英双语**：UI 和物品/配方名称

## 技术栈

| 分类     | 技术                | 版本     |
| -------- | ------------------- | -------- |
| 前端框架 | Vue 3               | ^3.2.13  |
| 3D 渲染  | Three.js            | ^0.160.0 |
| 蓝图压缩 | pako                | ^2.0.4   |
| 国际化   | vue-i18n            | ^9.1.0   |
| Markdown | marked              | ^18.1.1  |
| XSS 防护 | DOMPurify           | ^3.4.17  |
| 语言     | TypeScript          | ^5.1.3   |
| 构建     | Vue CLI (webpack 5) | ~5.0.1   |
| 测试     | Jest + ts-jest      | ^29      |

详细架构见 [architecture.md](./docs/wiki/architecture.md)。

## 模块地图

```
┌─────────────────────────────────────────────────────────┐
│                    UI 组件层 (Vue 3)                      │
│  App.vue · BlueprintEditor.vue · BuildingInfoPanel.vue   │
│  StationInfo.vue · SpitterInfo.vue · ReplaceModal.vue    │
│  ProductionStats.vue · BuildingPalette.vue               │
│  ReformColorDialog.vue · TutorialModal.vue               │
└──────────────────────────┬──────────────────────────────┘
                           │ provide/inject + hotkey
┌──────────────────────────▼──────────────────────────────┐
│               命令系统 (Command System)                    │
│  CommandQueue · Command 接口 · Updater · EventDispatcher │
└──────────────────────────┬──────────────────────────────┘
                           │ do() / undo()
┌──────────────────────────▼──────────────────────────────┐
│              蓝图逻辑层 (Blueprint Logic)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ 蓝图解析核心   │  │ 建筑批量操作  │  │  地基系统       │ │
│  │ parser/planet │  │ replace/... │  │ reformEdit.ts  │ │
│  │ area/md5      │  │ stats.ts    │  │                │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│  ┌──────────────┐                                       │
│  │ 照片转蓝图    │  reformImage.ts · medianCutQuantize    │
│  └──────────────┘                                       │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│            数据资源层 + 3D 渲染层                           │
│  data/*.ts · iconTexture.ts · bvh.ts · cargos.ts          │
└─────────────────────────────────────────────────────────┘
```

## 核心模块索引

| 模块         | 文档                                                     | 关键文件                                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------ |
| 蓝图解析核心 | [blueprint-core.md](./docs/wiki/modules/blueprint-core.md)           | `parser.ts`, `planet.ts`, `area.ts`, `md5.ts`                |
| 3D 渲染系统  | [3d-rendering.md](./docs/wiki/modules/3d-rendering.md)               | `BlueprintEditor.vue`, `bvh/`, `iconTexture.ts`, `cargos.ts` |
| 命令系统     | [command-system.md](./docs/wiki/modules/command-system.md)           | `command.ts`, `create.ts`, `removeBuilding.ts`, `defaultParams.ts` |
| 数据资源层   | [data-layer.md](./docs/wiki/modules/data-layer.md)                   | `data/items.ts`, `data/buildingSlots.ts`, `data/stacking.ts` |
| 建筑批量操作 | [building-operations.md](./docs/wiki/modules/building-operations.md) | `replace.ts`, `upgrade.ts`, `sorter.ts`, `beltLine.ts`, `stats.ts` |
| 地基系统     | [reform-system.md](./docs/wiki/modules/reform-system.md)             | `reform.ts`, `reformEdit.ts`                                 |
| 照片转蓝图   | [image-to-blueprint.md](./docs/wiki/modules/image-to-blueprint.md)   | `reformImage.ts`                                             |
| UI 组件层    | [ui-components.md](./docs/wiki/modules/ui-components.md)             | `components/*.vue`                                           |

## 图表索引

| 图表                     | 文件                                                     |
| ------------------------ | -------------------------------------------------------- |
| 总体架构 flowchart       | [architecture.md](./docs/wiki/architecture.md) §2                    |
| 蓝图核心数据结构类图     | [class-diagrams.md](./docs/wiki/diagrams/class-diagrams.md) §1       |
| 命令系统类图             | [class-diagrams.md](./docs/wiki/diagrams/class-diagrams.md) §2       |
| 参数类型层次类图         | [class-diagrams.md](./docs/wiki/diagrams/class-diagrams.md) §3       |
| 蓝图解析流程时序图       | [sequence-diagrams.md](./docs/wiki/diagrams/sequence-diagrams.md) §1 |
| 撤销重做流程时序图       | [sequence-diagrams.md](./docs/wiki/diagrams/sequence-diagrams.md) §2 |
| 照片转蓝图时序图         | [sequence-diagrams.md](./docs/wiki/diagrams/sequence-diagrams.md) §3 |
| 新建建筑命令时序图       | [sequence-diagrams.md](./docs/wiki/diagrams/sequence-diagrams.md) §4 |
| 分流器设置优先输出时序图 | [sequence-diagrams.md](./docs/wiki/diagrams/sequence-diagrams.md) §5 | 

## 快速开始

```bash
# 安装依赖
yarn install

# 开发服务器（HMR）
yarn serve

# 生产构建到 dist/
yarn build

# 跑单元测试
yarn test:unit

# 蓝图字符串 → JSON（CLI）
echo 'BLUEPRINT:...' | yarn cli

# 代码格式化
yarn format
```

详细步骤见 [getting-started.md](./docs/wiki/getting-started.md)，API 见 [api.md](./docs/wiki/api.md)。  

## 文档目录

```
docs/wiki/
├── README.md                  # 本文件
├── architecture.md            # 架构文档（含 Mermaid flowchart）
├── getting-started.md         # 环境配置与运行
├── api.md                     # CLI / Node API 参考
├── diagrams/
│   ├── class-diagrams.md      # 类图（蓝图数据 / 命令系统 / 参数类型）
│   └── sequence-diagrams.md   # 时序图（解析 / 撤销 / 照片转蓝图 / 新建建筑 / 分流器）
└── modules/
    ├── blueprint-core.md      # 蓝图解析核心
    ├── 3d-rendering.md        # 3D 渲染系统
    ├── command-system.md      # 命令系统
    ├── data-layer.md          # 数据资源层
    ├── building-operations.md # 建筑批量操作
    ├── reform-system.md       # 地基系统
    ├── image-to-blueprint.md  # 照片转蓝图
    └── ui-components.md        # UI 组件层
```