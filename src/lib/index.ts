/**
 * BlueprintViewer 库入口。
 *
 * 分发形态（方案 D3）：本轮**仅源码引用**，由宿主直接 `import { BlueprintViewer } from '@/lib'`。
 * API 面按可发布设计（ESM + 独立类型文件），但不产出 lib 构建产物；
 * `require.context` 与静态资源 `require` 仍依赖 webpack（见方案 §8 第 3 条）。
 */

// ---- 对外类与类型 ----
export { BlueprintViewer } from './BlueprintViewer';

// 解析函数就是 parser 的 `fromStr`；以 `parseBlueprint` 别名导出，保持一致的可读 API
export { fromStr as parseBlueprint, toStr as serializeBlueprint } from '@/blueprint/parser';
export type {
    ViewerOptions,
    ViewerRenderSettings,
    ViewerCallbacks,
    RebuildInfo,
    BlueprintLoadResult,
    BlueprintLoadOutcome,
    ViewerError,
    ViewerErrorCode,
    ViewerErrorPhase,
    SettingsPort,
    // 选中 / 定位 / 查询
    BuildingPickPayload,
    BuildingInfoPayload,
    BuildingLocateResult,
    ViewerQueryResult,
    FocusOptions,
    // 主题
    ThemeName,
    ThemeColors,
} from './types';

// 宿主做「按 id 取建筑 / 自己渲染建筑名」时常需要这两个类型
export type { BlueprintBuilding, BlueprintData } from '@/blueprint/parser';

// ---- 诊断（与宿主共用判定口径） ----
export { describeBuild } from './core/describeBuild';
export type { BuildDescription, DescribeBuildInput } from './core/describeBuild';
export type { BuildStats, SceneModel, BuildingModelRef } from './core/types';
