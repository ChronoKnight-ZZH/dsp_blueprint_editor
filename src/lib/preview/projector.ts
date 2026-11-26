/**
 * 预览坐标投影器：把「格坐标」变成世界矩阵。
 *
 * 两个阶段、两种语义（都来自后端的 `coordinateSystem`）：
 * - `layout-grid-v1`：生成中的**临时布局格坐标**。指南明确"不直接当作行星世界坐标"，
 *   且实测跨度最大 320 格（≈115°，会穿过极点）。因此这里做**X/Y 换算**：
 *   按流式 bbox 自动居中 + 等比缩放，把跨度压到 `maxSpanDeg` 以内，再投到球面
 *   （或可选贴到锚点的切平面）。
 * - `blueprint-area-local-v1`：Area 局部坐标，直接走真实 `findPosForAreas` 结果，
 *   与正式场景的 `calcBuildingTrans` 完全一致（实测 40,181 次操作 100% 落在 area 内）。
 *
 * 两个约定：
 * 1. **不做隐式插值**——`version` 变化表示投影参数变了，调用方必须硬重投影（不插值）。
 * 2. 姿态只有 `yaw`（实测 tilt/pitch 恒 0、yaw2 === yaw），故不处理四元数。
 */

import { Euler, Matrix4 } from "three";
import {
    GRID_PER_SEGMENT,
    HEIGHT_GRID_SIZE,
    PLANET_RADIUS,
    PLANET_SEGMENT,
} from "@/planet/planetConstants";
import { findPosForAreas } from "@/planet/planet";
import type { PositionedBlueprint } from "@/planet/planet";
import type { BlueprintArea } from "@/blueprint/parser";
import type { PreviewAreaLike, PreviewCoordinateSystem } from "./types";

/** 格坐标 → 蓝图的 Area 适配器（兼容扁平与嵌套两种历史形态） */
export function toBlueprintAreas(
    areas: readonly PreviewAreaLike[]
): BlueprintArea[] {
    return areas.map((a) => ({
        index: a.index,
        parentIndex: a.parentIndex ?? -1,
        tropicAnchor: a.tropicAnchor ?? 0,
        areaSegments: a.areaSegments,
        anchorLocalOffset: {
            x: a.anchorLocalOffset?.x ?? a.anchorLocalOffsetX ?? 0,
            y: a.anchorLocalOffset?.y ?? a.anchorLocalOffsetY ?? 0,
        },
        size: {
            x: a.size?.x ?? a.width ?? 0,
            y: a.size?.y ?? a.height ?? 0,
        },
    }));
}

export interface PreviewProjectorOptions {
    /** `sphere`：球面投影（默认）；`plane`：锚点处的切平面 */
    kind?: "sphere" | "plane";
    /** 行星半径（世界单位），默认 `PLANET_RADIUS` */
    radius?: number;
    /** 行星分段数，默认 `PLANET_SEGMENT` */
    segment?: number;
    /**
     * layout 期允许的最大跨度角（度）。默认 63°。
     * 超过则按 bbox 等比缩小；这是"320 格 ≈115°"不再穿极点的关键。
     */
    maxSpanDeg?: number;
}

/** 投影参数快照（诊断/统计用） */
export interface PreviewProjectorSnapshot {
    readonly kind: "sphere" | "plane";
    readonly mode: "layout" | "area";
    readonly scale: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly version: number;
}

const DEG_TO_RAD = Math.PI / 180;
const _rot = new Matrix4();
const _euler = new Euler();

export class PreviewProjector {
    readonly kind: "sphere" | "plane";
    private readonly radius: number;
    private readonly segment: number;
    /** 一格的角宽（弧度）：与 `calcBuildingTrans` 的经纬格完全一致 */
    private readonly baseCellRad: number;
    private readonly maxSpanRad: number;

    private mode: "layout" | "area" = "layout";
    private coordinateSystem: PreviewCoordinateSystem | null = null;

    // ---- layout 期的自适应参数
    private minX = Infinity;
    private maxX = -Infinity;
    private minY = Infinity;
    private maxY = -Infinity;
    private scale = 1;
    private centerX = 0;
    private centerY = 0;
    private version = 0;

    // ---- area 期：真实 Area 定位结果
    private positioned: PositionedBlueprint | null = null;

    constructor(options: PreviewProjectorOptions = {}) {
        this.kind = options.kind ?? "sphere";
        this.radius = options.radius ?? PLANET_RADIUS;
        this.segment = options.segment ?? PLANET_SEGMENT;
        this.baseCellRad =
            (2 * Math.PI) / this.segment / GRID_PER_SEGMENT;
        this.maxSpanRad = (options.maxSpanDeg ?? 63) * DEG_TO_RAD;
    }

    /** 当前投影参数快照 */
    snapshot(): PreviewProjectorSnapshot {
        return {
            kind: this.kind,
            mode: this.mode,
            scale: this.scale,
            centerX: this.centerX,
            centerY: this.centerY,
            version: this.version,
        };
    }

    get currentVersion(): number {
        return this.version;
    }

    get currentMode(): "layout" | "area" {
        return this.mode;
    }

    /**
     * 切换坐标语义。返回 `true` 表示语义变化，调用方需**硬重投影**（不插值）。
     * 实测每次都只会切一次：`layout-grid-v1` → `blueprint-area-local-v1`。
     */
    setCoordinateSystem(system: PreviewCoordinateSystem | undefined): boolean {
        if (system === undefined || system === this.coordinateSystem) return false;
        this.coordinateSystem = system;
        this.mode = system === "blueprint-area-local-v1" ? "area" : "layout";
        this.version++;
        return true;
    }

    /**
     * 喂入 area-local 事件的 `areas`（后端会为保留对象重发 replace，故这些 area
     * 在切换帧即可用）。解析失败时保持上一次结果，不抛错（预览不能因此中断）。
     */
    setAreas(areas: readonly PreviewAreaLike[] | undefined): boolean {
        if (areas === undefined || areas.length === 0) return false;
        let next: PositionedBlueprint;
        try {
            next = findPosForAreas(toBlueprintAreas(areas), this.segment);
        } catch (e) {
            console.warn("[preview] areas 定位失败（保留上一次投影）", e);
            return false;
        }
        this.positioned = next;
        this.version++;
        return true;
    }

    /**
     * 观察一个 layout 格坐标，必要时调整缩放/居中。
     *
     * 返回 `true` 表示参数变化超过阈值（需要重投影）。阈值存在的意义：
     * 避免 bbox 每长一格就重算一次，把画面变成持续蠕动。
     */
    observeGrid(x: number, y: number): boolean {
        if (this.mode !== "layout") return false;
        let changed = false;
        if (x < this.minX) {
            this.minX = x;
            changed = true;
        }
        if (x > this.maxX) {
            this.maxX = x;
            changed = true;
        }
        if (y < this.minY) {
            this.minY = y;
            changed = true;
        }
        if (y > this.maxY) {
            this.maxY = y;
            changed = true;
        }
        if (!changed) return false;
        return this.refit();
    }

    /** 重算 scale / center；变化显著才 bump version */
    private refit(): boolean {
        const spanX = Math.max(1, this.maxX - this.minX + 1);
        const spanY = Math.max(1, this.maxY - this.minY + 1);
        const span = Math.max(spanX, spanY);
        const scale = Math.min(1, this.maxSpanRad / (span * this.baseCellRad));
        const centerX = (this.minX + this.maxX) / 2;
        const centerY = (this.minY + this.maxY) / 2;

        const scaleChanged = Math.abs(scale - this.scale) > this.scale * 0.08;
        const centerMoved =
            Math.abs(centerX - this.centerX) > Math.max(2, span * 0.06) ||
            Math.abs(centerY - this.centerY) > Math.max(2, span * 0.06);
        if (!scaleChanged && !centerMoved) return false;

        this.scale = scale;
        this.centerX = centerX;
        this.centerY = centerY;
        this.version++;
        return true;
    }

    /**
     * 写入一个槽的世界矩阵。
     *
     * 数学与 `src/blueprint/planet.ts` 的 `calcBuildingTrans` 保持一致
     * （`-lat, lon, -yaw` 的 YXZ 欧拉 + 沿法线抬升），只是把格坐标先做居中/缩放。
     */
    writeMatrix(
        out: Matrix4,
        x: number,
        y: number,
        z: number,
        yawDeg: number,
        areaIndex: number
    ): void {
        const yawRad = -yawDeg * DEG_TO_RAD;
        const height = this.radius + z * HEIGHT_GRID_SIZE;

        if (this.mode === "area") {
            const area = this.positioned?.areas[areaIndex] ?? this.positioned?.areas[0];
            if (area !== undefined) {
                const lonSize = (2 * Math.PI) / area.segment / GRID_PER_SEGMENT;
                const latSize = (2 * Math.PI) / this.segment / GRID_PER_SEGMENT;
                const lon = (area.longitude + x) * lonSize;
                const lat = (area.latitude + y) * latSize;
                this.writeSpherical(out, lat, lon, height, yawRad);
                return;
            }
            // 没有 area 定位结果 → 退化为 layout 期同款球形投影（不中断预览）
        }

        const gx = (x - this.centerX) * this.scale;
        const gy = (y - this.centerY) * this.scale;
        if (this.kind === "plane") {
            out.makeRotationZ(yawRad);
            const cellWorld = this.baseCellRad * this.radius;
            out.setPosition(gx * cellWorld, gy * cellWorld, height);
            return;
        }
        this.writeSpherical(out, gy * this.baseCellRad, gx * this.baseCellRad, height, yawRad);
    }

    private writeSpherical(
        out: Matrix4,
        lat: number,
        lon: number,
        height: number,
        yawRad: number
    ): void {
        _euler.set(-lat, lon, yawRad, "YXZ");
        _rot.makeRotationFromEuler(_euler);
        out.makeTranslation(0, 0, height);
        out.premultiply(_rot);
    }
}
