import { InstancedMesh, Mesh, Object3D } from "three";
import { IconTexture } from "@/icon/iconTexture";
import { Icons } from "@/icon/icons";
import { IconSubscript } from "@/icon/iconSubscript";
import { Cargos } from "@/cargos";
import type { BlueprintBuilding } from "@/blueprint/parser";
import type { BuildingModelRef } from "./types";

/**
 * 一栋蓝图对应的全部可渲染内容（建筑网格 + 图标 + 货物动画 + 下标）。
 *
 * 从 `BlueprintEditor.vue` 下沉而来，**不依赖 Vue**，供编辑器与
 * `BlueprintViewer` 共用（方案 D1、§2）。
 */
export class AllBuildings extends Object3D {
    constructor(
        objects: Object3D[],
        public readonly iconsMesh: Icons,
        public readonly iconTexture: IconTexture,
        public readonly cargos: Cargos,
        public readonly modelRef: BuildingModelRef[],
        public readonly subscriptMesh: IconSubscript | null = null,
        /** 建筑 → 下标文本在 subscriptMesh 中的起始字符位置与长度；belt count 变化时用于局部刷新 */
        public readonly subscriptMap: Map<
            BlueprintBuilding,
            { startIdx: number; length: number }
        > = new Map()
    ) {
        super();
        this.add(...objects);
        this.add(iconsMesh);
        if (cargos) this.add(cargos);
        if (subscriptMesh) this.add(subscriptMesh);
    }

    public get icons() {
        return this.iconsMesh.geometry;
    }

    /**
     * 释放本对象持有的全部 GPU 资源。
     *
     * 注意两条共享约束：
     * - `userData.sharedResource` 的几何来自 GLB 缓存，跨场景复用，**不能**在这里释放
     * - 图标图集是 RenderCore 级别的单例，由调用方在 `dispose()` 里统一释放，
     *   这里只释放网格与下标（`IconTexture` 另有 `dispose()`）
     */
    public dispose() {
        this.traverse((o) => {
            if (o instanceof InstancedMesh) {
                o.dispose();
                // GLB 的几何是跨场景复用的缓存对象，这里不能释放
                if (!o.userData.sharedResource) o.geometry.dispose();
                return;
            }
            if (o instanceof Mesh && !o.userData.sharedResource) {
                (o as Mesh).geometry.dispose();
            }
        });
    }
}
