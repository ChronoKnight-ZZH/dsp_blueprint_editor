import { Matrix4, Vector3 } from 'three';

/** 分拣器抬升高度（建筑局部空间，沿法线方向） */
export const INSERTER_HEIGHT = 0.3;

const pos1 = new Vector3();
const pos2 = new Vector3();
const dir = new Vector3();

/**
 * 计算分拣器的姿态矩阵，返回其长度（沿传送方向）。
 *
 * 从 `BlueprintEditor.vue` 下沉，供 `buildBuildings`（渲染）与
 * `buildBVH`（选择盒）共用——两者必须用同一套几何，否则点选位置会偏移。
 */
export function inserterTrans(transforms: Matrix4[], trans: Matrix4) {
    pos1.setFromMatrixPosition(transforms[0]);
    dir.copy(pos1).normalize().multiplyScalar(INSERTER_HEIGHT);
    pos1.add(dir);

    pos2.setFromMatrixPosition(transforms[1]);
    dir.copy(pos2).normalize().multiplyScalar(INSERTER_HEIGHT);
    pos2.add(dir);

    trans.setPosition(pos1.x, pos1.y, pos1.z);
    trans.lookAt(pos1, pos2, pos1);
    return dir.subVectors(pos1, pos2).length();
}
