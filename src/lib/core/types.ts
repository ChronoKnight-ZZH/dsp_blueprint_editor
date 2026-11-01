import type { InstancedMesh, Matrix4 } from 'three';
import type { BVH } from '@/bvh/bvh';
import type { AllBuildings } from './AllBuildings';

/** 回退建筑（元数据盒 / 程序化几何）的实例引用 */
export interface ModelRefInstanced {
    mesh: InstancedMesh;
    instance: number;
}

/** 外部 GLB 建筑：直接给出建筑中心的世界矩阵，保持旧 `getModel` 的投影语义 */
export interface ModelRefMatrix {
    matrix: Matrix4;
}

export type BuildingModelRef = ModelRefInstanced | ModelRefMatrix;

/** 单次构建的统计信息：供 `describeBuild` 快照、问题定位与上限判定使用 */
export interface BuildStats {
    /** 蓝图里的建筑总数 */
    buildingCount: number;
    /** 走外部 GLB 的模型组数 */
    glbGroupCount: number;
    /** 走外部 GLB 的实例总数 */
    glbInstanceCount: number;
    /** 回退元数据盒的建筑数（含隐藏占位） */
    fallbackBoxCount: number;
    /** 未知 modelIndex（没有 buildingMeta）被放退化矩阵占位的数量 */
    hiddenCount: number;
    /** 未知 modelIndex 去重升序列表 */
    unknownModelIndexes: number[];
    /** 图标数量 */
    iconCount: number;
    /** 下标（传送带数字）数量 */
    subscriptCount: number;
    /** 货物动画实例数 */
    cargoCount: number;
    /** 每个 modelIndex 走 GLB 的实例数（判定上限时使用） */
    perModelGlbCounts: Record<number, number>;
}

/** 一次重建产出的完整场景模型 */
export interface SceneModel {
    buildings: AllBuildings;
    bvh: BVH;
    transforms: Matrix4[][];
    stats: BuildStats;
}
