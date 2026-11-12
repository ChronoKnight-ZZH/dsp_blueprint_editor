/**
 * 库入口（发布面）。
 *
 * 产物形态：UMD（内联 three，全局名 `DSPBlueprintEditor`）+ ESM（`three` 外置），
 * 由 `yarn build:lib` 产出到 `dist-lib/`（见 `scripts/lib-build/build.js`）。
 *
 * 导出面**刻意收窄**（只保留无头命令式 API，不含任何写死 UI）：
 * - `BlueprintViewer`：类实例控制器；
 * - `parseBlueprint` / `serializeBlueprint`：蓝图字符串 ↔ 数据对象；
 * - `configureAssetBaseUrl`：资产根地址（UMD 场景默认自动探测，ESM 场景请显式配置）；
 * - `calculateStatsList`：蓝图统计列表（总耗电 / 需求 / 输出），复用 `@/blueprint/stats` 算法。
 *
 * `describeBuild` 等诊断能力仍留在 `@/lib/core/...` 源码路径，不进入发布面。
 */

// ---- 对外类与类型 ----
export { BlueprintViewer } from "./BlueprintViewer";

// 解析函数就是 parser 的 `fromStr`；以 `parseBlueprint` 别名导出，保持一致的可读 API
export {
    fromStr as parseBlueprint,
    toStr as serializeBlueprint,
} from "@/blueprint/parser";

// 资产根地址：库构建下决定 assets/ 的位置（编辑器构建下由 webpack publicPath 决定，此调用无副作用）
export { configureAssetBaseUrl } from "./assets/assetBaseUrl";

// 资产地址映射钩子：模型/图标已由宿主打包器带哈希管理时，用它把库内的相对路径
// 换成宿主地址（库产物里不必再放一份 models/、img/）
export {
    configureAssetUrlMapper,
    type AssetUrlMapper,
} from "./assets/assetBaseUrl";

// 模型本地持久化缓存（Cache Storage）的运行时开关。
// 库构建默认**关闭**（构建配置 config/persistence.config.js 的 `lib` 字段），
// 宿主需要「看过的模型断网也能显示」时显式打开；传 null 恢复构建配置的值。
export {
    isModelCacheEnabled,
    setModelCacheEnabled,
} from "@/models/modelCacheConfig";

// 统计列表：输入蓝图字符串或 BlueprintData + 增产剂等级（0/1/2/3），返回耗电/需求/输出。
// 算法复用 @/blueprint/stats 的 calculateProductionStats，不改其一行。
export { calculateStatsList } from "./statsList";

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
    // 增量预览（preview-delta）：宿主可原样转发自己的事件对象
    PreviewAnimationMode,
    PreviewBeginOptions,
    PreviewBuildingLike,
    PreviewCoordinateSystem,
    PreviewDeltaEvent,
    PreviewOperation,
    PreviewStats,
    PreviewVec3,
    // 选中 / 定位 / 查询
    BuildingPickPayload,
    BuildingInfoPayload,
    BuildingLocateResult,
    BuildingsLocateResult,
    ViewerQueryResult,
    FocusOptions,
    // 批量删除（deleteBuilding 的返回值与入参类型）
    DeleteMode,
    DeleteResult,
    DeleteOutcome,
    // 主题
    ThemeName,
    ThemeColors,
} from "./types";

// 宿主做「按 id 取建筑 / 自己渲染建筑名」时常需要这两个类型
export type {
    BlueprintArea,
    BlueprintBuilding,
    BlueprintData,
} from "@/blueprint/parser";

// 统计列表的公开类型（值导出见上方 calculateStatsList）
export type {
    StatsListResult,
    StatsListValue,
    StatsListItem,
    StatsListError,
    StatsListErrorCode,
} from "./types";