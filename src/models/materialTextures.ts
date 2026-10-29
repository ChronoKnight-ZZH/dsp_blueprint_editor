/**
 * 把外部通道贴图接到 GLB 材质上。
 *
 * 背景：导出的 GLB 只有底色图（`map`），没有法线 / 自发光 / 高光；而 DSP 原包里
 * 每栋建筑都有独立的 `-n` / `-e` / `-s` 三张图。这里在模型解析完成后，按
 * `textureManifest`（模型名::材质名）把三张图挂到材质上，并把 `-s` 的 spec-gloss
 * 语义翻译成 three 的 metalness / roughness。
 *
 * 设计要点：
 * - **原地改材质**：`GlbModelInstances` 复用 GLB 缓存里的同一个材质对象，
 *   所以这里改完，已经建好的实例化网格会自动跟着变，不需要重建。
 * - **不阻塞模型加载**：调用方 fire-and-forget；贴图没到之前先显示底色，到了再
 *   补上。任何一张图失败都只是该项为 `null`，不影响模型本身。
 * - 三个可调参数（自发光强度 / 环境反射强度 / 金属度）来自
 *   `modelMaterialTuning.ts`，是唯一的手调入口。
 */

import type { Object3D, Texture } from 'three';
import { renderSettings } from '@/renderSettings';
import { getBuildingEnvironment } from './envMap';
import type { LoadedGlbModel } from './glbLoader';
import { METALNESS_WITHOUT_SPEC_MAP, resolveModelMaterialTuning } from './modelMaterialTuning';
import { materialMapUrls } from './textureManifest';
import type { MaterialTextureSet } from './textureMaps';
import { loadMaterialTextureSet } from './textureMaps';

/**
 * 法线强度。
 * 若上机后发现凹凸方向相反（Unity 与 glTF 的绿通道朝向约定不同），
 * 把 `NORMAL_SCALE_Y` 取负即可，不需要改别的代码。
 */
const NORMAL_SCALE_X = 1;
const NORMAL_SCALE_Y = 1;

/** 结构化取材质：不直接断言 `MeshStandardMaterial`，避免 `isMeshStandardMaterial` 被收窄成字面量 */
interface StandardMaterialLike {
    isMeshStandardMaterial?: boolean;
    name: string;
    uuid: string;
    map: Texture | null;
    metalness: number;
    roughness: number;
    normalMap: Texture | null;
    normalScale: { set(x: number, y: number): void };
    emissive: { r: number; g: number; b: number; setRGB(r: number, g: number, b: number): void };
    emissiveMap: Texture | null;
    emissiveIntensity: number;
    envMap: Texture | null;
    envMapIntensity: number;
    metalnessMap: Texture | null;
    roughnessMap: Texture | null;
    needsUpdate: boolean;
}

/** 材质被改之前的原始状态：关闭某个通道时从这里恢复，避免残留贴图 / 发光 */
interface MaterialSnapshot {
    map: Texture | null;
    metalness: number;
    roughness: number;
    normalMap: Texture | null;
    emissiveMap: Texture | null;
    emissive: [number, number, number];
    emissiveIntensity: number;
    metalnessMap: Texture | null;
    roughnessMap: Texture | null;
}

const originalStates = new WeakMap<StandardMaterialLike, MaterialSnapshot>();

function snapshotOf(material: StandardMaterialLike): MaterialSnapshot {
    let snapshot = originalStates.get(material);
    if (snapshot === undefined) {
        snapshot = {
            map: material.map,
            metalness: material.metalness,
            roughness: material.roughness,
            normalMap: material.normalMap,
            emissiveMap: material.emissiveMap,
            emissive: [material.emissive.r, material.emissive.g, material.emissive.b],
            emissiveIntensity: material.emissiveIntensity,
            metalnessMap: material.metalnessMap,
            roughnessMap: material.roughnessMap,
        };
        originalStates.set(material, snapshot);
    }
    return snapshot;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function collectStandardMaterials(root: Object3D): StandardMaterialLike[] {
    const found = new Map<string, StandardMaterialLike>();
    root.traverse(object => {
        const mesh = object as unknown as {
            isMesh?: boolean;
            material?: unknown;
        };
        if (mesh.isMesh !== true || mesh.material === undefined)
            return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const raw of materials) {
            const material = raw as StandardMaterialLike | null | undefined;
            if (material === null || material === undefined || material.isMeshStandardMaterial !== true)
                continue;
            if (!found.has(material.uuid))
                found.set(material.uuid, material);
        }
    });
    return [...found.values()];
}

function applyToMaterial(
    material: StandardMaterialLike,
    tuning: { emissiveIntensity: number; envMapIntensity: number; metalness: number },
    textures: MaterialTextureSet | null,
): void {
    const base = snapshotOf(material);
    const useTextures = renderSettings.texturesEnabled;

    // 0) -a 反照率：关闭后只保留材质基础色（GLB 内嵌的底色图）
    material.map = useTextures && renderSettings.textures.albedo ? base.map : null;

    // 1) 环境反射强度：给所有标准材质都设，金属/玻璃都有反射可吃，避免发黑
    material.envMap = getBuildingEnvironment();
    material.envMapIntensity = tuning.envMapIntensity;

    // 2) -s 高光/粗糙：金属度 / 粗糙度
    if (useTextures && renderSettings.textures.spec && textures !== null && textures.orm !== null) {
        // 有 -s 图：完全交给贴图（G=粗糙度、B=金属度），tuning.metalness 作为乘数
        material.metalness = clamp01(tuning.metalness);
        material.metalnessMap = textures.orm;
        material.roughness = 1;
        material.roughnessMap = textures.orm;
    }
    else {
        // 关闭或没有 -s 图：恢复 GLB 原始值，并按基准给个偏绝缘体的金属度
        material.metalness = clamp01(tuning.metalness * METALNESS_WITHOUT_SPEC_MAP);
        material.roughness = base.roughness;
        material.metalnessMap = base.metalnessMap;
        material.roughnessMap = base.roughnessMap;
    }

    // 3) -e 自发光：emissive 必须是白色，emissiveMap 才会按图发光
    if (useTextures && renderSettings.textures.emissive && textures !== null && textures.emissive !== null) {
        material.emissive.setRGB(1, 1, 1);
        material.emissiveMap = textures.emissive;
        material.emissiveIntensity = tuning.emissiveIntensity;
    }
    else {
        material.emissiveMap = base.emissiveMap;
        material.emissive.setRGB(base.emissive[0], base.emissive[1], base.emissive[2]);
        material.emissiveIntensity = base.emissiveIntensity;
    }

    // 4) -n 法线
    if (useTextures && renderSettings.textures.normal && textures !== null && textures.normal !== null) {
        material.normalMap = textures.normal;
        material.normalScale.set(NORMAL_SCALE_X, NORMAL_SCALE_Y);
    }
    else {
        material.normalMap = base.normalMap;
    }

    material.needsUpdate = true;
}

/**
 * 给一个已加载的 GLB 模型套用通道贴图与调参。
 * **永不 reject**；返回真正挂上了通道贴图的材质数量（便于日志/测试）。
 */
export async function applyModelMaterialTextures(model: LoadedGlbModel): Promise<number> {
    const tuning = resolveModelMaterialTuning(model.name);
    const materials = collectStandardMaterials(model.scene);
    if (materials.length === 0)
        return 0;

    let textured = 0;
    await Promise.all(materials.map(async material => {
        const urls = materialMapUrls[`${model.name}::${material.name}`];
        if (urls === undefined) {
            // 没有通道图（特效/玻璃材质，或该模型本身没导出通道图）：只套参数
            applyToMaterial(material, tuning, null);
            return;
        }
        try {
            const textures = await loadMaterialTextureSet(urls);
            applyToMaterial(material, tuning, textures);
            if (textures.normal !== null || textures.emissive !== null || textures.orm !== null)
                textured++;
        }
        catch (e) {
            console.warn(`[tex] 材质 ${model.name}::${material.name} 贴图接入失败（保留底色）`, e);
            applyToMaterial(material, tuning, null);
        }
    }));
    return textured;
}

/** 供测试/诊断：某个模型是否在清单里有通道贴图 */
export function hasMaterialTextures(modelName: string, materialName: string): boolean {
    return materialMapUrls[`${modelName}::${materialName}`] !== undefined;
}
