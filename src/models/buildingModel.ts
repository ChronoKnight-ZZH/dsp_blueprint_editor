/**
 * 建筑模型解析器：**外部 GLB 优先，元数据表回退**。
 *
 * 输入：`modelIndex`（游戏协议里的模型号，也是 `buildingMeta` 的键）
 * 输出：`ResolvedBuildingModel`，其中
 *   - `glb`     已加载的外部模型（null = 没有 / 未加载 / 加载失败）
 *   - `placement` GLB 模型空间 → 建筑局部空间（z 轴向上）的矩阵
 *   - `meta`    `@/data/building` 的元数据（始终保留，供 GLB 缺失时回退）
 *
 * 解析链：modelIndex → Item（itemsData 的 models 数组） → Item.icon → 别名表/变形 → 磁盘上的 .glb
 * 任何一步失败都只是 `glb === null`，绝不抛错。
 */

import { Matrix4, Vector3 } from 'three';
import { buildingMeta } from '@/data/building';
import type { BuildingMeta } from '@/data/building';
import { itemsMap } from '@/data/items';
import { availableModelNames, modelNameCandidates, resolveModelName } from './glbAssets';
import { getLoadedGlbModel, loadGlbModel, onGlbModelLoaded, glbFailedModels } from './glbLoader';
import type { LoadedGlbModel } from './glbLoader';

/** 模型来源：'glb' 外部模型，'meta' 元数据表回退，'unknown' 两边都没有 */
export type ModelSource = 'glb' | 'meta' | 'unknown';

export interface ResolvedBuildingModel {
    readonly modelIndex: number;
    /** 解析出的 GLB 模型名（不含扩展名）；null = 该建筑没有外部模型 */
    readonly glbName: string | null;
    /** 已加载完成的 GLB；null = 未加载 / 加载失败 / 无外部模型 */
    readonly glb: LoadedGlbModel | null;
    /** 元数据表条目（回退基准） */
    readonly meta: BuildingMeta | undefined;
    /** GLB 模型空间 → 建筑局部空间（z 轴向上）的放置矩阵；无 GLB 时为单位矩阵 */
    readonly placement: Matrix4;
    readonly source: ModelSource;
}

// ---------------------------------------------------------------- modelIndex → Item

interface ModelItemRef {
    itemId: number;
    itemName: string;
    icon: string;
    /** 该 modelIndex 在 `Item.models` 里的下标，用于四向分流器这类“一个物品多变形”的模型 */
    variantIndex: number;
}

const modelIndexItems = new Map<number, ModelItemRef[]>();

for (const item of itemsMap.values()) {
    for (let variantIndex = 0; variantIndex < item.models.length; variantIndex++) {
        const modelIndex = item.models[variantIndex];
        const ref: ModelItemRef = { itemId: item.id, itemName: item.name, icon: item.icon, variantIndex };
        const list = modelIndexItems.get(modelIndex);
        if (list === undefined)
            modelIndexItems.set(modelIndex, [ref]);
        else
            list.push(ref);
    }
}

/** modelIndex → GLB 模型名（经 itemsData 的 icon 与别名表）；无匹配返回 null */
export function buildingModelName(modelIndex: number): string | null {
    const refs = modelIndexItems.get(modelIndex);
    if (refs === undefined)
        return null;
    for (const ref of refs) {
        const name = resolveModelName(ref.icon, ref.variantIndex);
        if (name !== null)
            return name;
    }
    return null;
}

// ---------------------------------------------------------------- 放置参数

export type ModelUpAxis = 'y' | 'z';
export type ModelAlign = 'height' | 'none';

export interface ModelPlacementOverride {
    /** GLB 的“上”方向轴。glTF 标准是 y-up，默认 'y' */
    upAxis?: ModelUpAxis;
    /** 'height' 按元数据盒高度等比缩放后居中（默认）；'none' 保持原始比例，仅平移到元数据中心 */
    align?: ModelAlign;
    /** 额外绕 z 轴（建筑局部空间的“上”）旋转，弧度，用于修正模型朝向 */
    yaw?: number;
    /** 在按高度对齐之后的额外缩放系数 */
    scale?: number;
}

/**
 * 逐模型的放置参数覆盖表。
 *
 * 默认约定：GLB 按 glTF 标准 **y-up**、1 单位 ≈ 1 格导出；渲染时绕 X 轴 +90° 转成编辑器使用的
 * z-up 局部坐标系，再按元数据盒的高度等比缩放、对齐到元数据盒中心。
 * 如果某个模型视觉上方向/比例不对，**只需在这里加一条覆盖**，不用改渲染代码。
 */
export const modelPlacementOverrides: Readonly<Record<string, ModelPlacementOverride>> = {
    // 例：'smelter': { yaw: Math.PI / 2, align: 'none' },
};

const DEFAULT_UP_AXIS: ModelUpAxis = 'y';
const DEFAULT_ALIGN: ModelAlign = 'height';
/**
 * 按高度自动缩放时的收紧区间。
 *
 * `buildingMeta` 里的 box 高度是**近似值**（部分条目只是占位盒），而个别 GLB 的实测高度
 * 与它差了数倍。若不加限制，等比缩放到元数据盒高度会把这些模型压成一个点。
 * 实测多数模型与元数据盒高度在 1:1 附近（制造台 4.65/4.6、熔炉 3.98/3.8、
 * 射线接收站 10.4/10.0），因此 1/3 ~ 3 倍足以覆盖正常偏差，超出的交给
 * `modelPlacementOverrides` 逐条修正。
 */
const AUTO_SCALE_MIN = 1 / 3;
const AUTO_SCALE_MAX = 3;

const _size = new Vector3();
const _center = new Vector3();

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/**
 * 计算 GLB 模型空间 → 建筑局部空间（z 向上）的放置矩阵。
 *
 * 建筑局部空间约定（与 `buildingMeta.unitBoxTrans` 完全一致）：
 *   x / y 是水平方向，+z 指向星球法线（向上）。
 *   `meta.boxSize = [x 宽, y 深, 高度]`，`meta.boxCenter = [x, y, z]`。
 */
function buildPlacement(glb: LoadedGlbModel, meta: BuildingMeta | undefined): Matrix4 {
    const override = modelPlacementOverrides[glb.name] ?? {};
    const upAxis = override.upAxis ?? DEFAULT_UP_AXIS;
    const align = override.align ?? DEFAULT_ALIGN;

    // 朝向：glTF y-up → 编辑器 z-up（Rx(+90°) 把 +y 映射到 +z）
    const orient = new Matrix4();
    if (upAxis === 'y')
        orient.makeRotationX(Math.PI / 2);
    if (override.yaw)
        orient.premultiply(new Matrix4().makeRotationZ(override.yaw));

    glb.bbox.getSize(_size);
    glb.bbox.getCenter(_center);
    // 旋转后模型在“上”方向上的原始尺寸
    const modelHeight = upAxis === 'y' ? _size.y : _size.z;

    let scale = override.scale ?? 1;
    let targetX = 0;
    let targetY = 0;
    let targetZ: number;

    if (meta !== undefined) {
        const boxHeight = meta.boxSize[2];
        const [centerX, centerY, centerZ] = meta.boxCenter;
        if (align === 'height' && modelHeight > 1e-6)
            scale *= clamp(boxHeight / modelHeight, AUTO_SCALE_MIN, AUTO_SCALE_MAX);
        targetX = centerX;
        targetY = centerY;
        targetZ = centerZ;
    } else {
        // 没有元数据：把模型底面贴到原点平面（仅当调用方明确允许时才用）
        targetZ = modelHeight * scale / 2;
    }

    const offsetCenter = _center.clone().applyMatrix4(orient).multiplyScalar(scale);
    const placement = new Matrix4().makeTranslation(
        targetX - offsetCenter.x,
        targetY - offsetCenter.y,
        targetZ - offsetCenter.z,
    );
    placement.multiply(new Matrix4().makeScale(scale, scale, scale));
    placement.multiply(orient);
    return placement;
}

// ---------------------------------------------------------------- 解析缓存

const resolvedCache = new Map<number, ResolvedBuildingModel>();
const requested = new Set<number>();
const changeListeners = new Set<() => void>();

/** 解析某个模型号对应的最终渲染模型（GLB 优先 + 元数据回退），结果按 modelIndex 缓存 */
export function resolveBuildingModel(modelIndex: number): ResolvedBuildingModel {
    const cached = resolvedCache.get(modelIndex);
    if (cached !== undefined)
        return cached;

    const meta = buildingMeta.get(modelIndex);
    let glbName: string | null = null;
    let glb: LoadedGlbModel | null = null;
    let placement = new Matrix4();

    try {
        glbName = buildingModelName(modelIndex);
        if (glbName !== null) {
            glb = getLoadedGlbModel(glbName);
            if (glb !== null)
                placement = buildPlacement(glb, meta);
        }
    } catch (e) {
        // 解析/放置任何异常 → 保持 meta 回退
        console.warn(`[glb] modelIndex ${modelIndex} 解析失败，回退元数据表`, e);
        glb = null;
        placement = new Matrix4();
    }

    const source: ModelSource = glb !== null && meta !== undefined ? 'glb' : (meta !== undefined ? 'meta' : 'unknown');
    const result: ResolvedBuildingModel = { modelIndex, glbName, glb, meta, placement, source };
    resolvedCache.set(modelIndex, result);
    return result;
}

/**
 * 按需请求某个建筑的 GLB（fire-and-forget）。
 *
 * - 只在“有外部模型但还没加载”时才真正发请求；同一个 modelIndex 只请求一次
 * - 加载器内部再做并发去重、超时和失败负缓存
 * - 成功后触发 `onBuildingModelsChanged`，渲染层据此重建场景
 */
export function requestBuildingModel(modelIndex: number): void {
    const resolved = resolveBuildingModel(modelIndex);
    if (resolved.glbName === null || resolved.glb !== null || requested.has(modelIndex))
        return;
    requested.add(modelIndex);
    // 失败也只会 resolve(null)，渲染继续保持元数据表回退
    void loadGlbModel(resolved.glbName);
}

/** 外部模型加载完成（导致解析结果变化）时回调；返回取消订阅函数 */
export function onBuildingModelsChanged(cb: () => void): () => void {
    changeListeners.add(cb);
    return () => {
        changeListeners.delete(cb);
    };
}

onGlbModelLoaded(() => {
    // 有模型到达 → 解析缓存失效，通知渲染层重建
    resolvedCache.clear();
    for (const cb of changeListeners) {
        try {
            cb();
        } catch (e) {
            console.warn('[glb] 模型变更监听器抛错（已忽略）', e);
        }
    }
});

// ---------------------------------------------------------------- 映射报告（可复核）

export interface ModelMappingEntry {
    modelIndex: number;
    itemId: number | null;
    itemName: string;
    icon: string;
    variantIndex: number;
    /** 解析出的 GLB 模型名；null = 未匹配 */
    glbName: string | null;
    /** 该图标名下的所有候选文件名（含别名与 LOD 回退） */
    candidates: string[];
}

export interface ModelMappingReport {
    /** 磁盘上实际存在的 GLB 数量与文件名 */
    availableFiles: string[];
    /** 已匹配到 GLB 的模型号 */
    mapped: ModelMappingEntry[];
    /** 未匹配（回退元数据表）的模型号 */
    unmappedBuildings: ModelMappingEntry[];
    /** 有 GLB 但缺少元数据、目前无法渲染的模型号 */
    missingMetaModels: ModelMappingEntry[];
    /** 磁盘上存在但没有被任何模型使用的文件 */
    unusedFiles: string[];
    /** 加载失败的模型名 */
    failedModels: string[];
}

/**
 * 生成映射报告（运行时权威版本）。
 * 实现报告里的静态表格就是用它核对出来的。
 */
export function getModelMappingReport(): ModelMappingReport {
    const mapped: ModelMappingEntry[] = [];
    const unmapped: ModelMappingEntry[] = [];
    const registered = new Set<string>();

    const toEntry = (modelIndex: number): ModelMappingEntry => {
        const refs = modelIndexItems.get(modelIndex) ?? [];
        // 同一 modelIndex 可能被多个 Item 引用（例如蓄电器 / 蓄电器（满）共用 model 46），
        // 所有引用图标名下的候选文件都要登记，否则会误报“未使用文件”
        for (const r of refs) {
            for (const c of modelNameCandidates(r.icon, r.variantIndex)) {
                if (availableModelNames.has(c))
                    registered.add(c);
            }
        }
        const ref = refs[0];
        const icon = ref?.icon ?? '';
        const variantIndex = ref?.variantIndex ?? 0;
        const candidates = icon === '' ? [] : modelNameCandidates(icon, variantIndex);
        return {
            modelIndex,
            itemId: ref?.itemId ?? null,
            itemName: ref?.itemName ?? '(itemsData 未登记)',
            icon,
            variantIndex,
            glbName: buildingModelName(modelIndex),
            candidates,
        };
    };

    const modelIndexes = Array.from(buildingMeta.keys()).sort((a, b) => a - b);
    for (const modelIndex of modelIndexes) {
        const entry = toEntry(modelIndex);
        if (entry.glbName === null)
            unmapped.push(entry);
        else
            mapped.push(entry);
    }

    const missingMeta: ModelMappingEntry[] = [];
    for (const modelIndex of Array.from(modelIndexItems.keys()).sort((a, b) => a - b)) {
        if (buildingMeta.has(modelIndex))
            continue;
        const entry = toEntry(modelIndex);
        if (entry.glbName !== null)
            missingMeta.push(entry);
    }

    // 别名表里登记的备选文件（例如 assembler-mk-1-lod2_0）在 toEntry 里已随候选加入 registered，
    // 因此这里不需要再处理别名。
    const unusedFiles = Array.from(availableModelNames)
        .filter(name => !registered.has(name))
        .sort();

    return {
        availableFiles: Array.from(availableModelNames).sort(),
        mapped,
        unmappedBuildings: unmapped,
        missingMetaModels: missingMeta,
        unusedFiles,
        failedModels: Array.from(glbFailedModels()).sort(),
    };
}
