/**
 * 库入口（发布面）。
 *
 * 产物形态：UMD（内联 three，全局名 `DSPBlueprintEditor`）+ ESM（`three` 外置），
 * 由 `yarn build:lib` 产出到 `dist-lib/`（见 `scripts/lib-build/build.js`）。
 *
 * 导出面**刻意收窄**（只保留无头命令式 API，不含任何写死 UI）：
 * - `BlueprintViewer`：类实例控制器；
 * - `parseBlueprint` / `serializeBlueprint`：蓝图字符串 ↔ 数据对象；
 * - `configureAssetBaseUrl`：资产根地址（UMD 场景默认自动探测，ESM 场景请显式配置）。
 *
 * `describeBuild` 等诊断能力仍留在 `@/lib/core/...` 源码路径，不进入发布面。
 */

// ---- 对外类与类型 ----
export { BlueprintViewer } from './BlueprintViewer';

// 解析函数就是 parser 的 `fromStr`；以 `parseBlueprint` 别名导出，保持一致的可读 API
export { fromStr as parseBlueprint, toStr as serializeBlueprint } from '@/blueprint/parser';

// 资产根地址：库构建下决定 assets/ 的位置（编辑器构建下由 webpack publicPath 决定，此调用无副作用）
export { configureAssetBaseUrl } from './assets/assetBaseUrl';

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
export type { BlueprintArea, BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
