/**
 * 增量预览（preview-delta）的**结构宽容**类型定义。
 *
 * 设计约束（来自 `data/蓝图预览方案.md` 与 7 份样本的实测）：
 * 1. 宿主事件类型在 Wails 应用的 `types/factory-progress.ts`，本库不能 import 它，
 *    因此这里声明**同构但全可选**的镜像类型：宿主对象可直接传入，不需要转换。
 * 2. `areas` 存在两种形态（后端即将改为嵌套，但过渡期两种都要吃）：
 *    扁平 `anchorLocalOffsetX/Y` + `width/height`，嵌套 `anchorLocalOffset{x,y}` + `size{x,y}`。
 * 3. 字段缺失一律按默认值处理：`tilt/pitch` 视为 0、`yaw2` 视为 `yaw`、
 *    `inputObjectId` 缺失视为「无输入」。
 */

import type { Matrix4 } from "three";
import type { PoolKind } from "./pools";

/** 预览动画模式：`off` = 不插值（直接跳变），`on` = 完整动效，`auto` = 按设备能力判定 */
export type PreviewAnimationMode = "auto" | "on" | "off";

/** 预览期坐标语义（与后端 `coordinateSystem` 一致，未知值按 layout 处理） */
export type PreviewCoordinateSystem =
    | "layout-grid-v1"
    | "blueprint-area-local-v1"
    | (string & Record<never, never>);

/** 三维向量（结构上兼容 `{x,y,z}`） */
export interface PreviewVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * area 的两种历史形态。
 * 过渡期同时支持，见文件头说明第 2 条。
 */
export interface PreviewAreaLike {
    readonly index: number;
    readonly parentIndex?: number;
    readonly tropicAnchor?: number;
    readonly areaSegments: number;
    /** 扁平形态（历史） */
    readonly anchorLocalOffsetX?: number;
    readonly anchorLocalOffsetY?: number;
    readonly width?: number;
    readonly height?: number;
    /** 嵌套形态（新） */
    readonly anchorLocalOffset?: { readonly x: number; readonly y: number };
    readonly size?: { readonly x: number; readonly y: number };
}

/** 预览建筑：只依赖渲染必需字段，其余可选 */
export interface PreviewBuildingLike {
    readonly index?: number;
    /** 后端 T2 新增：是否为临时对象（缺失时按 `index === -1` 推断） */
    readonly isTemporary?: boolean;
    readonly itemId: number;
    readonly modelIndex: number;
    readonly areaIndex?: number;
    readonly localOffset: PreviewVec3;
    readonly localOffset2?: PreviewVec3;
    readonly yaw: number;
    readonly yaw2?: number;
    readonly tilt?: number;
    readonly tilt2?: number;
    readonly pitch?: number;
    readonly pitch2?: number;
    readonly inputObjectId?: string | null;
    readonly outputObjectId?: string | null;
    readonly inputFromSlot?: number;
    readonly outputToSlot?: number;
    readonly productionIndex?: number;
}

/** 三类操作；`remove` 不携带 building */
export type PreviewOperation = {
    readonly type: "add" | "replace";
    readonly objectId: string;
    readonly building: PreviewBuildingLike;
} | {
    readonly type: "remove";
    readonly objectId: string;
};

/** 一条增量事件（其余字段按需忽略） */
export interface PreviewDeltaEvent {
    readonly kind?: string;
    readonly protocolVersion?: number;
    readonly taskId?: string;
    readonly sequence?: number;
    readonly stage?: string;
    readonly message?: string;
    readonly coordinateSystem?: PreviewCoordinateSystem;
    readonly operations?: readonly PreviewOperation[];
    readonly areas?: readonly PreviewAreaLike[];
    readonly primaryAreaIndex?: number;
    /** 兼容旧接口的最终建筑分块（本层不使用） */
    readonly previewBatch?: unknown;
}

/** `beginPreview` 的选项 */
export interface PreviewBeginOptions {
    /**
     * layout 阶段的投影方式：
     * - `sphere`（默认）：格坐标 → 经纬度投影到球面，并按 bbox 自动居中/缩放（跨度 ≤ ~63°）
     * - `plane`：贴在锚点处的切平面（不绕球，永不穿极点）
     * 两种都会在切到 `blueprint-area-local-v1` 后转为真实 Area 球面投影。
     */
    projector?: "sphere" | "plane";
    /** 收敛时间常数 τ（毫秒）。默认 100 */
    settleMs?: number;
    /** 抖动抑制：新对象延迟多久才淡入（毫秒）。默认 120；`0` = 关闭 */
    enterDelayMs?: number;
    /** 抖动抑制：存活短于该值即被撤销的对象不出场（毫秒）。默认 120 */
    minLifeMs?: number;
}

/** 运行期统计（诊断用，`__DSP_PREVIEW__` 也读它） */
export interface PreviewStats {
    /** 已摄入事件 / 操作数 */
    readonly events: number;
    readonly operations: number;
    /** 因序号过期被整条丢弃的事件数 */
    readonly droppedEvents: number;
    /** 删除不存在的对象（已忽略）次数 */
    readonly unknownRemoves: number;
    /** 替换不存在的对象（已按 add 处理）次数 */
    readonly unknownReplaces: number;
    /** 当前存活对象 / 槽位占用峰值 */
    readonly alive: number;
    /** 正在淡出（已不属于逻辑对象，但仍占着槽）的数量 */
    readonly fading: number;
    readonly peakAlive: number;
    /** 当前仍在运动的槽数与槽位总数 */
    readonly moving: number;
    readonly slots: number;
    /** 抖动抑制吞掉的可见槽数 */
    readonly filteredByThrash: number;
    /** 当前坐标语义 */
    readonly coordinateSystem: PreviewCoordinateSystem | null;
    /** 最近一次摄入耗时（毫秒），用于验证 ≤50ms 预算 */
    readonly lastIngestMs: number;
    readonly maxIngestMs: number;
    readonly disposed: boolean;
}

/** 对齐式提交用的单对象骨架（矩阵来自预览层收敛值，与画面逐像素一致） */
export interface PreviewAlignedObject {
    readonly objectId: string;
    /** 建筑 ID（`BlueprintBuilding.index`），由 `building-N` 解析 */
    readonly buildingIndex: number;
    readonly kind: PoolKind;
    readonly itemId: number;
    readonly modelIndex: number;
    readonly areaIndex: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
    readonly x2: number;
    readonly y2: number;
    readonly z2: number;
    /** 第一端世界矩阵（与 `writeSlot` 同一数据源） */
    readonly matrix: Matrix4;
    /** 第二端世界矩阵（分拣器用；其他建筑与第一端同源、yaw 取 0） */
    readonly matrix2: Matrix4;
    /** 输出对象的建筑 ID（未携带或无法解析时为 null） */
    readonly outputBuildingIndex: number | null;
}

/** 预览层收敛后的整体骨架快照（`exportAlignedSnapshot` 的返回） */
export interface PreviewAlignedSnapshot {
    /** 键为建筑 ID（`BlueprintBuilding.index`） */
    readonly objects: Map<number, PreviewAlignedObject>;
    readonly count: number;
    readonly coordinateSystem: PreviewCoordinateSystem | null;
}
