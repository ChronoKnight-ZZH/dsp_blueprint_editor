import {
    InstancedMesh, Matrix4, Vector3, Vector2, Color, Object3D,
    BoxGeometry, CylinderGeometry, MeshLambertMaterial,
} from 'three';
import type { TextureSink } from '@/iconTexture';
import { IconTexture } from '@/iconTexture';
import { IconGeometry, Icons } from '@/icons';
import { IconSubscript } from '@/iconSubscript';
import { Cargos } from '@/cargos';
import { buildingMeta, noIconBuildings } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { itemIconId } from '@/data/icons';
import type { BeltParameters, BlueprintBuilding } from '@/blueprint/parser';
import { resolveBuildingModel, requestBuildingModel } from '@/models/buildingModel';
import type { ResolvedBuildingModel } from '@/models/buildingModel';
import { GlbModelInstances } from '@/models/glbInstances';
import { reapplyLoadedModelMaterials } from '@/models/glbLoader';
import type { TextureSettings, ViewerRenderSettings } from '@/renderSettingsTypes';
import { AllBuildings } from './AllBuildings';
import type { BuildStats, BuildingModelRef } from './types';
import {
    buildingIconId, buildingIconPos, beltIconPos, beltIconScale,
    sorterIconPos, sorterIconScale,
} from './iconHelpers';
import { inserterTrans } from './geometryHelpers';

/** 未知建筑（没有 buildingMeta）时使用的占位颜色，与旧 `buildBoxes` 兜底一致 */
const UNKNOWN_BUILDING_COLOR = new Color(0xdddddd);

/** 取建筑元数据颜色；未知建筑回退占位色（修复：旧代码用 `!` 断言，未知模型会抛错白屏） */
function colorOf(modelIndex: number): Color {
    return buildingMeta.get(modelIndex)?.color ?? UNKNOWN_BUILDING_COLOR;
}

export interface BuildBuildingsOptions {
    /** 渲染设置：`showRealModels` / `maxInstancesPerModel` 决定 GLB 与白模的划分 */
    settings: ViewerRenderSettings;
    /** 图标图集 sink（真实 renderer 或测试 stub） */
    textureSink: TextureSink;
    /**
     * 可复用的图标图集。省略时新建一个（调用方负责 dispose）。
     * RenderCore 会跨重建复用它，避免每次重建都重新分配 1920×1920 纹理并重发图标请求。
     */
    iconTexture?: IconTexture;
    /** 是否为图集补挂通道贴图（reapply）。默认 true */
    reapplyMaterials?: boolean;
    /** 完整贴图设置（含 7 通道开关）；省略时由 glbLoader 的 provider 决定 */
    textureSettings?: TextureSettings;
}

export interface BuildBuildingsResult {
    buildings: AllBuildings;
    stats: BuildStats;
    /** 本次构建实际使用的图标图集（可能是传入的，也可能是新建的） */
    iconTexture: IconTexture;
}

/**
 * 按建筑列表装配一个完整的 `AllBuildings`。
 *
 * 从 `BlueprintEditor.vue` 的 `buildBuildings` 下沉，**不依赖 Vue**。
 * 相对原实现的行为修正（方案 D4 / D7）：
 *   1. 未知 `modelIndex` 的配色改用占位色，不再因 `!` 断言抛错（白屏修复）
 *   2. `maxInstancesPerModel` 的计数口径改为「存在 glbName 的实例数」，
 *      不再依赖 GLB 是否已加载 → 同一蓝图同一设置的渲染结果变得确定
 */
export function buildBuildings(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[],
    options: BuildBuildingsOptions,
): BuildBuildingsResult {
    const { settings } = options;

    // 设置变更（texturesEnabled）后重挂通道贴图；材质是共享对象，原地生效。
    // 传入完整贴图设置，避免依赖 glbLoader 的全局 provider（Viewer 场景下没有注入）。
    if (options.reapplyMaterials !== false)
        reapplyLoadedModelMaterials(options.textureSettings);

    const buildBelts = (belts: BlueprintBuilding[]) => {
        const thickness = 0.1;
        const material = new MeshLambertMaterial();
        const objects: Object3D[] = [];
        {
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 8);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            const offset = new Matrix4().makeRotationX(Math.PI / 2);
            offset.premultiply(new Matrix4().makeTranslation(0, 0, thickness / 2));
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b = belts[i];
                trans.copy(transforms[b.index][0]);
                trans.multiply(offset);
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, colorOf(b.modelIndex));
                modelRef[b.index] = { mesh, instance: i };
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            objects.push(mesh);
        }
        const linkThickness = 0.6 * thickness;
        { // links
            const geometry = new BoxGeometry(0.15, linkThickness, 1.0);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            let numLinks = 0;
            const offset = new Matrix4().makeTranslation(0, linkThickness / 2, -0.5);
            const p1 = new Vector3();
            const p2 = new Vector3();
            const d = new Vector3();
            const temp = new Matrix4();
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b1 = belts[i];
                if (b1.outputObjIdx < 0)
                    continue;
                p1.setFromMatrixPosition(transforms[b1.index][0]);
                p2.setFromMatrixPosition(transforms[b1.outputObjIdx][0]);
                const len = d.subVectors(p1, p2).length();
                trans.identity();
                trans.lookAt(p1, p2, p1);
                trans.premultiply(temp.makeTranslation(p1.x, p1.y, p1.z));

                const color = colorOf(b1.modelIndex);
                addCargo(trans, color, len);

                trans.multiply(temp.makeScale(1., 1., len));
                trans.multiply(offset);
                mesh.setMatrixAt(numLinks, trans);
                mesh.setColorAt(numLinks, color);
                numLinks++;
            }
            if (numLinks) {
                mesh.count = numLinks;
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor!.needsUpdate = true;
                objects.push(mesh);
            }
        }
        return objects;
    };

    const buildInserters = (inserters: BlueprintBuilding[]) => {
        const inserterThickness = 0.06;
        const geometry = new BoxGeometry(0.15, inserterThickness, 1.0);
        const material = new MeshLambertMaterial();
        const mesh = new InstancedMesh(geometry, material, inserters.length);
        const offset = new Matrix4().makeTranslation(0, 0, -0.5);
        const temp = new Matrix4();
        const trans = new Matrix4();
        for (let i = 0; i < inserters.length; i++) {
            const b = inserters[i];

            const len = inserterTrans(transforms[b.index], trans);
            const color = colorOf(b.modelIndex);
            addCargo(trans, color, len);

            trans.multiply(temp.makeScale(1., 1., len));
            trans.multiply(offset);
            mesh.setMatrixAt(i, trans);
            mesh.setColorAt(i, color);
            modelRef[b.index] = { mesh, instance: i };
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        return [mesh];
    };

    // 建筑分类：带子 / 分拣器 / 其余（元数据盒或 GLB）
    const belts = buildings.filter(b => isBelt(b.itemId));
    const inserters = buildings.filter(b => isInserter(b.itemId));
    const boxes = buildings.filter(b => !isInserter(b.itemId) && !isBelt(b.itemId));

    const modelRef = new Array<BuildingModelRef>(buildings.length);
    // 容量沿用旧实现：只有带子与分拣器会产生货物
    const cargosMesh = new Cargos(belts.length + inserters.length);
    let numCargos = 0;
    const addCargo = (trans: Matrix4, color: Color, distance: number) => {
        cargosMesh.setMatrixAt(numCargos, trans);
        cargosMesh.setColorAt(numCargos, color);
        cargosMesh.setCargoDistanceAt(numCargos, distance);
        numCargos++;
    };

    const buildBoxes = (boxes: BlueprintBuilding[]) => {
        const objects: Object3D[] = [];
        const unknownModelIndexes = new Set<number>();

        // 1) 解析每个建筑的模型来源：已加载的外部 GLB 优先，其余回退元数据表
        const resolved: (ResolvedBuildingModel | null)[] = boxes.map(b => {
            try {
                return resolveBuildingModel(b.modelIndex);
            } catch {
                return null;  // resolver 内部已兜底，这里只是双保险
            }
        });

        // 2) 同一模型的实例数过多时整组回退（高模 × 上千实例会明显掉帧）。
        //    **计数口径（方案 D7）**：按「存在 glbName 的建筑数」而不是「已加载 GLB 的建筑数」，
        //    这样 GLB 未到达时不会先把整组判成白模，加载完成后再整组跳回 GLB，
        //    同一蓝图同一设置的渲染结果因此与加载时序无关。
        const glbInstanceCounts = new Map<number, number>();
        if (settings.showRealModels) {
            for (const r of resolved) {
                if (r !== null && r.glbName !== null && r.meta !== undefined)
                    glbInstanceCounts.set(r.modelIndex, (glbInstanceCounts.get(r.modelIndex) ?? 0) + 1);
            }
        }

        // 3) 分组：外部 GLB 组 / 元数据盒回退组
        const glbGroups = new Map<number, { model: NonNullable<ResolvedBuildingModel['glb']>; placement: Matrix4; buildings: BlueprintBuilding[] }>();
        const fallback: BlueprintBuilding[] = [];
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const r = resolved[i];
            if (r !== null && r.meta === undefined) {
                // 未知建筑：既定位不了也画不了，更不该下载 GLB
                unknownModelIndexes.add(r.modelIndex);
                fallback.push(b);
                continue;
            }
            const withinLimit = r !== null
                && (glbInstanceCounts.get(r.modelIndex) ?? 0) <= settings.maxInstancesPerModel;
            if (settings.showRealModels && withinLimit && r.glb !== null && r.meta !== undefined) {
                let group = glbGroups.get(r.modelIndex);
                if (group === undefined) {
                    group = { model: r.glb, placement: r.placement, buildings: [] };
                    glbGroups.set(r.modelIndex, group);
                }
                group.buildings.push(b);
                continue;
            }
            fallback.push(b);
            // 有外部模型但还没加载 → 按需触发懒加载（加载器内部并发去重 + 缓存 + 超时）
            // 没有元数据就既定位不了也画不了，因此不为它下载 GLB
            if (r !== null && r.glbName !== null && r.glb === null && r.meta !== undefined)
                requestBuildingModel(b.modelIndex);
        }

        // 4) GLB 实例化渲染；任一环节出错都整组退回元数据盒，不影响其余建筑
        const anchor = new Matrix4();
        const anchorPos = new Vector3();
        const anchorTrans = new Matrix4();
        const perModelGlbCounts: Record<number, number> = {};
        for (const [modelIndex, group] of glbGroups) {
            let instances: GlbModelInstances | null = null;
            try {
                instances = new GlbModelInstances(
                    group.model,
                    group.placement,
                    group.buildings.map(b => transforms[b.index][0]),
                );
            } catch (e) {
                console.warn('[glb] 实例化渲染失败，该模型组回退元数据表', e);
                instances = null;
            }
            if (instances === null || instances.meshes.length === 0) {
                fallback.push(...group.buildings);
                continue;
            }
            objects.push(instances);
            perModelGlbCounts[modelIndex] = group.buildings.length;
            for (const b of group.buildings) {
                // modelRef 沿用旧语义：建筑中心的世界矩阵（供 SpitterInfo 等做投影）
                anchor.copy(transforms[b.index][0]);
                const meta = buildingMeta.get(b.modelIndex);
                if (meta !== undefined) {
                    anchorPos.setFromMatrixPosition(meta.selectUnitBoxTrans);
                    anchor.multiply(anchorTrans.makeTranslation(anchorPos.x, anchorPos.y, anchorPos.z));
                }
                modelRef[b.index] = { matrix: anchor.clone() };
            }
        }

        // 5) 元数据盒回退：与改动前一致的渲染方式
        if (fallback.length) {
            const geometry = new BoxGeometry(1.0, 1.0, 1.0);
            const material = new MeshLambertMaterial();
            const mesh = new InstancedMesh(geometry, material, fallback.length);
            const trans = new Matrix4();
            const hidden = new Matrix4().makeScale(0, 0, 0);
            for (let i = 0; i < fallback.length; i++) {
                const b = fallback[i];
                const meta = buildingMeta.get(b.modelIndex);
                if (meta === undefined) {
                    // 未知建筑：放退化矩阵占位（不可见），保持「不抛错、不白屏」的旧行为
                    mesh.setMatrixAt(i, hidden);
                    mesh.setColorAt(i, UNKNOWN_BUILDING_COLOR);
                    continue;
                }
                trans.multiplyMatrices(transforms[b.index][0], meta.unitBoxTrans);
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, meta.color);
                modelRef[b.index] = { mesh, instance: i };
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            objects.push(mesh);
        }

        return { objects, perModelGlbCounts, unknownModelIndexes, fallbackCount: fallback.length };
    };

    const buildIcons = (iconBuildings: BlueprintBuilding[], iconBelts: BlueprintBuilding[], iconInserters: BlueprintBuilding[], iconTexture: IconTexture) => {
        const subscripts = new Map<BlueprintBuilding, string>();
        for (const b of iconBelts) {
            if (b.parameters === null)
                continue;
            const p = b.parameters as BeltParameters;
            if (p.count === 0)
                continue;
            let s;
            if (p.count >= 100000)
                s = Math.floor(p.count / 1000).toFixed(0) + 'k';
            else
                s = p.count.toFixed(0);
            subscripts.set(b, s);
        }

        const count = iconBuildings.length + iconBelts.length + iconInserters.length;
        const icons = new IconGeometry(count);

        let subscriptsMesh: null | IconSubscript = null;
        const subscriptMap = new Map<BlueprintBuilding, { startIdx: number; length: number }>();
        if (subscripts.size > 0) {
            let numChars = 0;
            for (const s of subscripts.values()) {
                numChars += s.length;
            }
            subscriptsMesh = new IconSubscript(numChars);
        }
        const pos = new Vector3();

        let subscriptIdx = 0;
        for (let i = 0; i < iconBelts.length; i++) {
            const b = iconBelts[i];
            beltIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon((b.parameters as BeltParameters).iconId);
            icons.addIcon(b, iconId, pos, beltIconScale);

            const sub = subscripts.get(b);
            if (sub !== undefined) {
                subscriptsMesh!.setText(subscriptIdx, pos, beltIconScale, sub);
                subscriptMap.set(b, { startIdx: subscriptIdx, length: sub.length });
                subscriptIdx += sub.length;
            }
        }

        for (let i = 0; i < iconInserters.length; i++) {
            const b = iconInserters[i];
            sorterIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon(itemIconId(b.filterId));
            icons.addIcon(b, iconId, pos, sorterIconScale);
        }

        const buildingIconScale = new Vector2();
        for (let i = 0; i < iconBuildings.length; i++) {
            const b = iconBuildings[i];
            if (!buildingIconPos(b, transforms[b.index][0], pos, buildingIconScale))
                continue;
            const iconId = iconTexture.requestIcon(buildingIconId(b));
            icons.addIcon(b, iconId, pos, buildingIconScale);
        }

        if (subscriptsMesh !== null) {
            subscriptsMesh.needsUpdate();
        }
        return { icons, subscriptsMesh, subscriptMap, iconCount: count, subscriptCount: subscriptIdx };
    };

    const iconBuildings = boxes.filter(b => !noIconBuildings.has(b.itemId));
    const iconBelts = belts.filter(b => b.parameters && (b.parameters as BeltParameters).iconId > 0);
    const iconInserters = inserters.filter(b => b.filterId > 0);

    const meshes: Object3D[] = [];
    const built = buildBoxes(boxes);

    if (belts.length)
        meshes.push(...buildBelts(belts));

    if (inserters.length)
        meshes.push(...buildInserters(inserters));

    if (numCargos) {
        cargosMesh.count = numCargos;
        cargosMesh.instanceMatrix.needsUpdate = true;
        cargosMesh.instanceColor!.needsUpdate = true;
        cargosMesh.geometry.cargoDistance.needsUpdate = true;
    }

    if (built.objects.length)
        meshes.push(...built.objects);

    // 未传入时新建一个图集；**释放责任交给调用方**（结果里的 `iconTexture` 字段
    // 就是实际使用的这一个，调用方在场景销毁时调它的 `dispose()`）。
    const iconTexture = options.iconTexture ?? new IconTexture(options.textureSink);
    const iconBuilt = buildIcons(iconBuildings, iconBelts, iconInserters, iconTexture);
    if (iconBuilt.subscriptsMesh) {
        iconBuilt.subscriptsMesh.renderOrder = 11;
    }

    const iconMesh = new Icons(iconTexture.texture, iconBuilt.icons);
    iconMesh.renderOrder = 10;

    const buildings3d = new AllBuildings(
        meshes, iconMesh, iconTexture, cargosMesh, modelRef,
        iconBuilt.subscriptsMesh, iconBuilt.subscriptMap,
    );

    const glbInstanceCount = Object.values(built.perModelGlbCounts).reduce((a, b) => a + b, 0);
    const stats: BuildStats = {
        buildingCount: buildings.length,
        glbGroupCount: Object.keys(built.perModelGlbCounts).length,
        glbInstanceCount,
        fallbackBoxCount: built.fallbackCount,
        hiddenCount: built.unknownModelIndexes.size,
        unknownModelIndexes: Array.from(built.unknownModelIndexes).sort((a, b) => a - b),
        iconCount: iconBuilt.iconCount,
        subscriptCount: iconBuilt.subscriptCount,
        cargoCount: numCargos,
        perModelGlbCounts: built.perModelGlbCounts,
    };

    return { buildings: buildings3d, stats, iconTexture };
}
