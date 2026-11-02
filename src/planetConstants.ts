/**
 * 星球与格子的世界坐标常量。
 *
 * 这些数值原本散落在三处并被互相复制：
 *   - `components/BlueprintEditor.vue` 的 `R` / `SEGMENT`
 *   - `blueprint/planet.ts` 的 `HEIGHT_GRID_SIZE` / `GRID_PER_SEGMENT`
 *   - `models/buildingModel.ts` 的 `GRID_HORIZONTAL` / `GRID_VERTICAL`
 *
 * 任一处不同步都会让 GLB 的放置矩阵与星球表面错位（模型整体漂浮或陷进地面），
 * 因此统一收敛到这里。**不支持运行时修改**：`calculate` 出来的常量被模块级缓存，
 * 改动需要重启构建。
 */

/** 星球半径（世界单位）。`planet.ts` 的 `calcBuildingTrans` 与相机距离都用它 */
export const PLANET_RADIUS = 200.2;

/** 星球球面与经纬网格的细分段数（横向）；纵向是它的一半 */
export const PLANET_SEGMENT = 200;

/** 每个 area segment 对应的格数（DSP 的 1 个区域段 = 5 格） */
export const GRID_PER_SEGMENT = 5;

/** 一个垂直格对应的世界单位（z 方向） */
export const HEIGHT_GRID_SIZE = 4 / 3;

/**
 * 一个水平格对应的世界单位。
 * 等于球面一个经度格在赤道处的弧长：2π / SEGMENT / GRID_PER_SEGMENT × R
 */
export const GRID_HORIZONTAL =
    ((2 * Math.PI) / PLANET_SEGMENT / GRID_PER_SEGMENT) * PLANET_RADIUS;
