/**
 * 把一个已加载的 GLB 模型按建筑实例化渲染。
 *
 * 做法：遍历 GLB 原型场景里的每个子网格，为**每个子网格**建一个 `InstancedMesh`，
 * 几何与材质直接复用 GLB 缓存里的对象（不做合并、不烘焙顶点色），因此模型的
 * 贴图/多材质都能原样显示，显存也只需要一份。
 *
 * 每个实例的矩阵 = 建筑世界矩阵 × 放置矩阵 × 子网格在模型内的局部矩阵。
 */

import { Group, InstancedMesh, Matrix4, Mesh } from 'three';
import type { Object3D } from 'three';
import type { LoadedGlbModel } from './glbLoader';

interface GlbPart {
    geometry: Mesh['geometry'];
    material: Mesh['material'];
    /** 子网格在 GLB 模型空间里的矩阵（已含模型内部的节点变换） */
    localMatrix: Matrix4;
}

function collectParts(root: Object3D): GlbPart[] {
    const parts: GlbPart[] = [];
    root.updateMatrixWorld(true);
    root.traverse(o => {
        // 结构化判断（不要直接把 Object3D 断言成 Mesh：isMesh 会被收窄成字面量 true）
        const mesh = o as unknown as {
            isMesh?: boolean;
            isSkinnedMesh?: boolean;
            geometry?: Mesh['geometry'];
            material?: Mesh['material'];
            matrixWorld: Matrix4;
        };
        // 只处理普通网格；蒙皮网格（建筑模型里通常没有）跳过，避免实例化后骨骼错位
        if (mesh.isMesh !== true || mesh.isSkinnedMesh === true || mesh.geometry === undefined)
            return;
        parts.push({
            geometry: mesh.geometry,
            material: mesh.material as Mesh['material'],
            localMatrix: mesh.matrixWorld.clone(),
        });
    });
    return parts;
}

export class GlbModelInstances extends Group {
    /** 本组实际创建的 InstancedMesh（数量 = GLB 子网格数） */
    readonly meshes: InstancedMesh[] = [];

    /**
     * @param model            已加载的 GLB 原型
     * @param placement        模型空间 → 建筑局部空间的放置矩阵
     * @param buildingTransforms 每个实例的建筑世界矩阵
     */
    constructor(model: LoadedGlbModel, placement: Matrix4, buildingTransforms: readonly Matrix4[]) {
        super();
        this.name = `glb:${model.name}`;

        const count = buildingTransforms.length;
        if (count === 0)
            return;

        const parts = collectParts(model.scene);
        if (parts.length === 0)
            return;

        const instanceMatrix = new Matrix4();
        const partMatrix = new Matrix4();
        for (const part of parts) {
            const mesh = new InstancedMesh(part.geometry, part.material, count);
            // 几何/材质与 GLB 缓存共用：打上标记，AllBuildings.dispose 不会误删共享资源
            mesh.userData.sharedResource = true;
            mesh.frustumCulled = false;  // 实例散布在球面上，几何自身的包围球不适用于视锥剔除
            for (let i = 0; i < count; i++) {
                instanceMatrix.multiplyMatrices(buildingTransforms[i], placement);
                partMatrix.multiplyMatrices(instanceMatrix, part.localMatrix);
                mesh.setMatrixAt(i, partMatrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            this.meshes.push(mesh);
            this.add(mesh);
        }
    }
}
