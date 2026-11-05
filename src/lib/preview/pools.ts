/**
 * 预览槽池：每个「模型」一份 `InstancedMesh` 组 + 一份 SoA 状态表。
 *
 * 为什么是池：实测峰值 **32,581** 个存活对象（其中 91% 是传送带模型），
 * 而增量 add/remove 无法在既有 `AllBuildings`（构造期就把 count 写死）上原地增删。
 * 所以预览层自建池：容量按需翻倍，`mesh.count` 只等于高水位，槽位用自由链表复用。
 *
 * 为什么是 SoA：3 万个槽如果每槽一个 JS 对象，GC 抖动会让「丝滑」直接失效。
 * 这里的状态全部是 `Float32Array` / `Uint8Array`，槽位只是数组下标。
 *
 * 上传策略：**只写脏段**。3 万槽 × 64B 的矩阵整块上传是 2.09 MB/帧，
 * 必须用 `attribute.addUpdateRange()`（three r160 支持，上传后自动清空）。
 */

import {
    BoxGeometry,
    Color,
    CylinderGeometry,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
} from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { buildingMeta } from "@/data/building";
import {
    requestBuildingModel,
    resolveBuildingModel,
} from "@/models/buildingModel";
import { cloneFadeMaterial } from "./materials";

/** 槽的状态机：空 / 存活 / 正在淡出（淡出结束才真正释放） */
export const SLOT_FREE = 0;
export const SLOT_ALIVE = 1;
export const SLOT_DYING = 2;

export type PoolKind = "glb" | "box" | "belt" | "inserter";

const WHITE = new Color(0xffffff);

/** GLB 部件（几何已克隆，可安全挂 `aOpacity`） */
export interface GlbPart {
    readonly geometry: BufferGeometry;
    readonly material: Material | Material[];
    readonly localMatrix: Matrix4;
}

/** 一个池的构建参数（由 `buildPoolSpec` 算出） */
export interface PoolSpec {
    readonly kind: PoolKind;
    readonly modelIndex: number;
    readonly capacity: number;
    readonly parts?: readonly GlbPart[];
    readonly placement?: Matrix4;
    readonly tint?: number | null;
    readonly color?: Color;
    readonly boxTrans?: Matrix4 | null;
}

function makeFadeMesh(
    geometry: BufferGeometry,
    material: Material | Material[],
    capacity: number,
    opacity: InstancedBufferAttribute
): InstancedMesh {
    geometry.setAttribute("aOpacity", opacity);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    // 实例散布很广，包围球无意义（与既有 GlbModelInstances 一致）
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
}

function paint(
    mesh: InstancedMesh,
    color: Color | null,
    capacity: number
): void {
    const c = color ?? WHITE;
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, c);
    if (mesh.instanceColor !== null)
        mesh.instanceColor.setUsage(DynamicDrawUsage);
}

/** 槽池：状态 + 网格。槽号即数组下标 */
export class SlotPool {
    readonly kind: PoolKind;
    readonly modelIndex: number;
    readonly capacity: number;

    readonly meshes: InstancedMesh[];
    /** 每个 mesh 的预乘矩阵（世界矩阵 × pre） */
    readonly pre: Matrix4[];
    readonly opacity: InstancedBufferAttribute;
    /** 不可见矩阵（未知模型 / 传送带没有输出目标时使用） */
    readonly hidden = new Matrix4().makeScale(0, 0, 0);

    // ---- SoA 状态（位置全部是「格坐标」，投影发生在写矩阵时）
    readonly curX: Float32Array;
    readonly curY: Float32Array;
    readonly curZ: Float32Array;
    readonly curYaw: Float32Array;
    readonly tgtX: Float32Array;
    readonly tgtY: Float32Array;
    readonly tgtZ: Float32Array;
    readonly tgtYaw: Float32Array;
    /** 第二端（分拣器用；其余类型不读） */
    readonly curX2: Float32Array;
    readonly curY2: Float32Array;
    readonly curZ2: Float32Array;
    readonly tgtX2: Float32Array;
    readonly tgtY2: Float32Array;
    readonly tgtZ2: Float32Array;
    /** 所属 Area（area-local 期投影用） */
    readonly areaIndex: Int32Array;
    readonly curOpacity: Float32Array;
    readonly tgtOpacity: Float32Array;
    readonly bornAt: Float32Array;
    readonly state: Uint8Array;
    readonly ids: (string | null)[];

    readonly free: number[] = [];
    highWater = 0;
    alive = 0;
    readonly moving = new Set<number>();

    private dirtyMin = Infinity;
    private dirtyMax = -Infinity;

    constructor(spec: PoolSpec) {
        this.kind = spec.kind;
        this.modelIndex = spec.modelIndex;
        this.capacity = Math.max(1, spec.capacity | 0);

        const opacity = new InstancedBufferAttribute(
            new Float32Array(this.capacity),
            1
        );
        opacity.setUsage(DynamicDrawUsage);
        this.opacity = opacity;

        const meshes: InstancedMesh[] = [];
        const pre: Matrix4[] = [];
        const tintColor = spec.tint == null ? null : new Color(spec.tint);

        if (
            spec.kind === "glb" &&
            spec.parts !== undefined &&
            spec.parts.length > 0
        ) {
            const placement = spec.placement ?? new Matrix4();
            for (const part of spec.parts) {
                const mesh = makeFadeMesh(
                    part.geometry,
                    cloneFadeMaterial(part.material),
                    this.capacity,
                    opacity
                );
                pre.push(
                    new Matrix4().multiplyMatrices(placement, part.localMatrix)
                );
                paint(mesh, tintColor, this.capacity);
                meshes.push(mesh);
            }
        } else if (spec.kind === "belt") {
            const thickness = 0.1;
            const disc = makeFadeMesh(
                new CylinderGeometry(0.32, 0.32, thickness, 8),
                cloneFadeMaterial(new MeshLambertMaterial()),
                this.capacity,
                opacity
            );
            pre.push(
                new Matrix4()
                    .makeTranslation(0, 0, thickness / 2)
                    .multiply(new Matrix4().makeRotationX(Math.PI / 2))
            );
            paint(disc, spec.color ?? null, this.capacity);
            meshes.push(disc);

            const link = makeFadeMesh(
                new BoxGeometry(0.15, 0.6 * thickness, 1.0),
                cloneFadeMaterial(new MeshLambertMaterial()),
                this.capacity,
                opacity
            );
            pre.push(new Matrix4());
            paint(link, spec.color ?? null, this.capacity);
            meshes.push(link);
        } else if (spec.kind === "inserter") {
            const mesh = makeFadeMesh(
                new BoxGeometry(0.15, 0.06, 1.0),
                cloneFadeMaterial(new MeshLambertMaterial()),
                this.capacity,
                opacity
            );
            pre.push(new Matrix4());
            paint(mesh, spec.color ?? null, this.capacity);
            meshes.push(mesh);
        } else {
            const mesh = makeFadeMesh(
                new BoxGeometry(1.0, 1.0, 1.0),
                cloneFadeMaterial(new MeshLambertMaterial()),
                this.capacity,
                opacity
            );
            // 未知模型（没有元数据）→ 退化矩阵占位，保持「不抛错、不白屏」
            pre.push(spec.boxTrans ?? this.hidden);
            paint(mesh, spec.color ?? null, this.capacity);
            meshes.push(mesh);
        }

        this.meshes = meshes;
        this.pre = pre;
        this.curX = new Float32Array(this.capacity);
        this.curY = new Float32Array(this.capacity);
        this.curZ = new Float32Array(this.capacity);
        this.curYaw = new Float32Array(this.capacity);
        this.tgtX = new Float32Array(this.capacity);
        this.tgtY = new Float32Array(this.capacity);
        this.tgtZ = new Float32Array(this.capacity);
        this.tgtYaw = new Float32Array(this.capacity);
        this.curX2 = new Float32Array(this.capacity);
        this.curY2 = new Float32Array(this.capacity);
        this.curZ2 = new Float32Array(this.capacity);
        this.tgtX2 = new Float32Array(this.capacity);
        this.tgtY2 = new Float32Array(this.capacity);
        this.tgtZ2 = new Float32Array(this.capacity);
        this.areaIndex = new Int32Array(this.capacity);
        this.curOpacity = new Float32Array(this.capacity);
        this.tgtOpacity = new Float32Array(this.capacity);
        this.bornAt = new Float32Array(this.capacity);
        this.state = new Uint8Array(this.capacity);
        this.ids = new Array<string | null>(this.capacity).fill(null);
        // 逆序入栈 → alloc 从 0 开始，槽号连续
        for (let i = this.capacity - 1; i >= 0; i--) this.free.push(i);
    }

    get full(): boolean {
        return this.free.length === 0;
    }

    alloc(): number {
        const slot = this.free.pop();
        if (slot === undefined) return -1;
        if (slot + 1 > this.highWater) this.highWater = slot + 1;
        this.state[slot] = SLOT_ALIVE;
        this.alive++;
        return slot;
    }

    release(slot: number): void {
        if (this.state[slot] === SLOT_FREE) return;
        this.state[slot] = SLOT_FREE;
        this.ids[slot] = null;
        this.curOpacity[slot] = 0;
        this.tgtOpacity[slot] = 0;
        (this.opacity.array as Float32Array)[slot] = 0;
        this.alive--;
        this.moving.delete(slot);
        this.free.push(slot);
        this.markDirty(slot);
    }

    markDirty(slot: number): void {
        if (slot < this.dirtyMin) this.dirtyMin = slot;
        if (slot > this.dirtyMax) this.dirtyMax = slot;
    }

    /** 本帧末尾提交**局部**上传范围（避免 3 万槽整块上传） */
    flushDirty(): void {
        if (this.dirtyMax < this.dirtyMin) return;
        const start = this.dirtyMin;
        const count = this.dirtyMax - this.dirtyMin + 1;
        this.dirtyMin = Infinity;
        this.dirtyMax = -Infinity;
        for (const mesh of this.meshes) {
            mesh.instanceMatrix.addUpdateRange(start * 16, count * 16);
            mesh.instanceMatrix.needsUpdate = true;
        }
        this.opacity.addUpdateRange(start, count);
        this.opacity.needsUpdate = true;
    }

    /** 更新 `mesh.count` 与可见性（每帧一次，代价极低） */
    syncCount(): void {
        const count = this.highWater;
        const visible = count > 0 && this.alive > 0;
        for (const mesh of this.meshes) {
            mesh.count = count;
            mesh.visible = visible;
        }
    }

    dispose(): void {
        for (const mesh of this.meshes) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            const material = mesh.material;
            if (Array.isArray(material)) {
                for (const m of material) m.dispose();
            } else material.dispose();
        }
        this.meshes.length = 0;
        this.pre.length = 0;
        this.moving.clear();
    }
}

/** 从 GLB 原型里收集可实例化部件（与 `GlbModelInstances` 同语义，几何**克隆**） */
export function collectGlbParts(root: Object3D): GlbPart[] {
    const parts: GlbPart[] = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        const mesh = o as unknown as {
            isMesh?: boolean;
            isSkinnedMesh?: boolean;
            geometry?: BufferGeometry;
            material?: Material | Material[];
            matrixWorld: Matrix4;
        };
        if (
            mesh.isMesh !== true ||
            mesh.isSkinnedMesh === true ||
            mesh.geometry === undefined ||
            mesh.material === undefined
        )
            return;
        parts.push({
            // 预览层往几何上挂 `aOpacity`，必须克隆，不能污染最终场景共享的几何
            geometry: mesh.geometry.clone(),
            material: mesh.material,
            localMatrix: mesh.matrixWorld.clone(),
        });
    });
    return parts;
}

/**
 * 算出池的构建参数。
 *
 * `kind === 'glb'` 但模型还没加载完时：先按回退盒渲染，并**顺手触发懒加载**；
 * 加载完成后由 `PreviewLayer.resyncModels()` 把该池换成真模型。
 */
export function buildPoolSpec(
    kind: PoolKind,
    modelIndex: number,
    capacity: number,
    tintHint: number | null
): PoolSpec {
    const resolved = resolveBuildingModel(modelIndex);
    if (kind === "glb") {
        if (resolved.glb !== null && resolved.meta !== undefined) {
            const parts = collectGlbParts(resolved.glb.scene);
            if (parts.length > 0) {
                return {
                    kind,
                    modelIndex,
                    capacity,
                    parts,
                    placement: resolved.placement,
                    tint: resolved.tint ?? tintHint,
                };
            }
        }
        if (resolved.glbName !== null && resolved.meta !== undefined)
            requestBuildingModel(modelIndex);
        return {
            kind: "box",
            modelIndex,
            capacity,
            color: resolved.meta?.color,
            boxTrans: resolved.meta?.unitBoxTrans ?? null,
        };
    }
    if (kind === "box") {
        return {
            kind,
            modelIndex,
            capacity,
            color: resolved.meta?.color,
            boxTrans: resolved.meta?.unitBoxTrans ?? null,
        };
    }
    return {
        kind,
        modelIndex,
        capacity,
        color: resolved.meta?.color ?? buildingMeta.get(modelIndex)?.color,
    };
}

/** 该 modelIndex 是否已有可实例化的 GLB */
export function glbAvailable(modelIndex: number): boolean {
    const resolved = resolveBuildingModel(modelIndex);
    return resolved.glb !== null && resolved.meta !== undefined;
}
