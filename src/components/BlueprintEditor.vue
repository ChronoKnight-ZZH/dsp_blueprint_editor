<template>
    <div class="editor-root" ref="root" tabindex="-1"></div>
</template>

<script lang="ts">
import {
    Group,
    LineSegments,
    InstancedMesh,
    WebGLRenderer,
    LineBasicMaterial,
    MeshStandardMaterial,
    MeshLambertMaterial,
    MeshBasicMaterial,
    CylinderGeometry,
    BoxGeometry,
    PlaneGeometry,
    DoubleSide,
    Matrix4,
    DirectionalLight,
    Vector3,
    Object3D,
    Color,
    Ray,
    Sphere,
    Vector2,
    Mesh,
    Line,
    BufferGeometry,
    Float32BufferAttribute,
} from "three";
import {
    SphereLatitudeGridGeometry,
    SphereLongitudeGridGeometry,
} from "@/SphereGridGeometry";
import {
    gridAreas,
    calcBuildingTrans,
    PositionedBlueprint,
    HEIGHT_GRID_SIZE,
} from "@/blueprint/planet";
import { buildReforms, Reforms } from "@/blueprint/reform";
import {
    buildSceneData,
    INSERTER_HEIGHT,
    inserterTrans,
    rebuildScene,
} from "@/editor/scene";
import { buildingMeta, noIconBuildings } from "@/data/building";
import { itemIconId, recipeIconId } from "@/data/icons";
import { IconTexture } from "@/iconTexture";
import { IconGeometry, Icons } from "@/icons";
import { IconSubscript } from "@/iconSubscript";
import { Cargos, CargoGeometry, makeCargoGeometry } from "@/cargos";
import { BVH } from "@/bvh";
import { Updater } from "@/command";
import { RemoveBuildingCommand } from "@/blueprint/removeBuilding";
import { commandQueueKey } from "@/define";
import {
    BeltParameters,
    BlueprintBuilding,
    LabParamerters,
    ResearchMode,
} from "@/blueprint/parser";
import { isBelt, isInserter, isLab } from "@/data/items";
function buildPlanetGrid(radius = 1, segment = 200) {
    const allGrids = new Group();
    const material = new LineBasicMaterial({
        color: 0xf0f0f0,
        depthWrite: false,
    });

    const latitudeGeometry = new SphereLatitudeGridGeometry({
        radius,
        widthSegments: segment,
        heightSegments: segment / 2,
    });
    allGrids.add(new LineSegments(latitudeGeometry, material));

    const radPerSeg = (2 * Math.PI) / segment;
    for (const { minLatitudeSeg, latitudeSeg, longitudeSeg } of gridAreas(
        segment
    )) {
        const geometry = new SphereLongitudeGridGeometry({
            radius,
            widthSegments: longitudeSeg,
            heightSegments: Math.abs(latitudeSeg),
            phiStart: 0,
            phiLength: Math.PI * 2,
            thetaStart: (minLatitudeSeg + segment / 4) * radPerSeg,
            thetaLength: latitudeSeg * radPerSeg,
        });
        allGrids.add(new LineSegments(geometry, material));
    }
    return { grids: allGrids, material };
}

class AllBuildings extends Object3D {
    constructor(
        objects: Object3D[],
        public readonly iconsMesh: Icons,
        public readonly iconTexture: IconTexture,
        public readonly cargos: Cargos[],
        public readonly modelRef: { mesh: InstancedMesh; instance: number }[],
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
        for (const c of cargos) this.add(c);
        if (subscriptMesh) this.add(subscriptMesh);
    }

    public get icons() {
        return this.iconsMesh.geometry;
    }

    public dispose() {
        this.traverse((o) => {
            if (o instanceof Mesh) {
                (o as Mesh).geometry.dispose();
            }
            if (o instanceof InstancedMesh) {
                o.dispose();
            }
        });
    }
}

function buildingIconId(b: BlueprintBuilding) {
    if (isLab(b.itemId)) {
        const mode = (b.parameters as LabParamerters | null)?.researchMode;
        // 矩阵合成：有配方显示配方图标，无配方退回研究站自身图标
        if (mode === ResearchMode.Compose && b.recipeId > 0) {
            return recipeIconId(b.recipeId);
        }
        // 科研模式 / 选择模式 / 合成但未选配方：显示研究站自身图标
        return itemIconId(b.itemId);
    }
    return b.recipeId > 0 ? recipeIconId(b.recipeId) : itemIconId(b.itemId);
}

const scale3 = new Vector3();
const trans = new Matrix4();
function buildingIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3,
    scale: Vector2
) {
    const meta = buildingMeta.get(b.modelIndex);
    if (meta === undefined) return false; // TODO: unknown building, print warning
    trans.multiplyMatrices(buildingTrans, meta.iconTrans);
    scale3.setFromMatrixScale(trans);
    scale.set(scale3.x, scale3.y);
    pos.setFromMatrixPosition(trans);
    return true;
}

const beltIconScale = new Vector2(1.1, 1.1);
const beltIconTrans = new Matrix4().makeTranslation(0, 0, 0.5);
function beltIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3
) {
    trans.multiplyMatrices(buildingTrans, beltIconTrans);
    pos.setFromMatrixPosition(trans);
}

const sorterIconScale = new Vector2(0.8, 0.8);
const sorterIconTrans = new Matrix4().makeTranslation(0, 0, INSERTER_HEIGHT);
function sorterIconPos(
    b: BlueprintBuilding,
    buildingTrans: Matrix4,
    pos: Vector3
) {
    trans.multiplyMatrices(buildingTrans, sorterIconTrans);
    pos.setFromMatrixPosition(trans);
}

/** 传送带货物：正六棱柱，外接圆半径 0.15，长 0.4，轴向沿 z CylinderGeometry */
function createBeltCargoGeometry(count: number): CargoGeometry {
    const geo = new BoxGeometry(0.4, 0.4, 0.4);
    geo.rotateX(Math.PI / 2); // 圆柱轴向从 y 转到 z
    return makeCargoGeometry(geo, count);
}

/** 分拣器货物：正四棱柱，正方形截面 0.15 × 0.15，长 0.4（沿 z）BoxGeometry */
function createInserterCargoGeometry(count: number): CargoGeometry {
    const geo = new BoxGeometry(0.4, 0.4, 0.6);
    return makeCargoGeometry(geo, count);
}

function buildBuildings(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[],
    renderer: WebGLRenderer
) {
    const buildBelts = (belts: BlueprintBuilding[]) => {
        const thickness = 0.1;
        const material = new MeshLambertMaterial();
        const objects: Object3D[] = [];
        {
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 6);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            const offset = new Matrix4().makeRotationX(Math.PI / 2);
            offset.premultiply(
                new Matrix4().makeTranslation(0, 0, thickness / 2)
            );
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b = belts[i];
                trans.copy(transforms[b.index][0]);
                trans.multiply(offset);
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, buildingColor(b));
                modelRef[b.index] = { mesh, instance: i };
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            objects.push(mesh);
        }
        const linkThickness = 0.6 * thickness;
        {
            // links
            const geometry = new BoxGeometry(0.15, linkThickness, 1.0);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            let numLinks = 0;
            const offset = new Matrix4().makeTranslation(
                0,
                linkThickness / 2,
                -0.5
            );
            const pos1 = new Vector3();
            const pos2 = new Vector3();
            const dir = new Vector3();
            const temp = new Matrix4();
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b1 = belts[i];
                if (b1.outputObjIdx < 0) continue;
                pos1.setFromMatrixPosition(transforms[b1.index][0]);
                pos2.setFromMatrixPosition(transforms[b1.outputObjIdx][0]);
                const len = dir.subVectors(pos1, pos2).length();
                trans.identity();
                trans.lookAt(pos1, pos2, pos1);
                trans.premultiply(temp.makeTranslation(pos1.x, pos1.y, pos1.z));

                const color = buildingColor(b1);
                addBeltCargo(trans, color, len);

                trans.multiply(temp.makeScale(1, 1, len));
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
        const geometry = new BoxGeometry(0.1, 0.1, 1.0);
        const material = new MeshLambertMaterial();
        const mesh = new InstancedMesh(geometry, material, inserters.length);
        const offset = new Matrix4().makeTranslation(0, 0, -0.5);
        const temp = new Matrix4();
        const trans = new Matrix4();
        for (let i = 0; i < inserters.length; i++) {
            const b = inserters[i];

            const len = inserterTrans(transforms[b.index], trans);
            const color = buildingColor(b);
            addInserterCargo(trans, color, len);

            trans.multiply(temp.makeScale(1, 1, len));
            trans.multiply(offset);
            mesh.setMatrixAt(i, trans);
            mesh.setColorAt(i, color);
            modelRef[b.index] = { mesh, instance: i };
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        return [mesh];
    };
    const buildBoxes = (boxes: BlueprintBuilding[]) => {
        const geometry = new BoxGeometry(1.0, 1.0, 1.0);
        const material = new MeshLambertMaterial();
        const mesh = new InstancedMesh(geometry, material, boxes.length);
        const trans = new Matrix4();
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const meta = buildingMeta.get(b.modelIndex);
            if (meta === undefined) continue;
            trans.multiplyMatrices(transforms[b.index][0], meta.unitBoxTrans);
            mesh.setMatrixAt(i, trans);
            mesh.setColorAt(i, meta.color);
            modelRef[b.index] = { mesh, instance: i };
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        return [mesh];
    };
    const buildIcons = (
        iconBuildings: BlueprintBuilding[],
        iconBelts: BlueprintBuilding[],
        iconInsterters: BlueprintBuilding[]
    ) => {
        const subscripts = new Map<BlueprintBuilding, string>();
        for (const b of iconBelts) {
            if (b.parameters === null) continue;
            const p = b.parameters as BeltParameters;
            if (p.count === 0) continue;
            let s;
            if (p.count >= 100000)
                s = Math.floor(p.count / 1000).toFixed(0) + "k";
            else s = p.count.toFixed(0);
            subscripts.set(b, s);
        }

        const count =
            iconBuildings.length + iconBelts.length + iconInsterters.length;
        const icons = new IconGeometry(count);

        let subscriptsMesh: null | IconSubscript = null;
        const subscriptMap = new Map<
            BlueprintBuilding,
            { startIdx: number; length: number }
        >();
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
            const iconId = iconTexture.requestIcon(
                (b.parameters as BeltParameters).iconId
            );
            icons.addIcon(b, iconId, pos, beltIconScale);

            const sub = subscripts.get(b);
            if (sub !== undefined) {
                subscriptsMesh!.setText(subscriptIdx, pos, beltIconScale, sub);
                subscriptMap.set(b, {
                    startIdx: subscriptIdx,
                    length: sub.length,
                });
                subscriptIdx += sub.length;
            }
        }

        for (let i = 0; i < iconInsterters.length; i++) {
            const b = iconInsterters[i];
            sorterIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon(itemIconId(b.filterId));
            icons.addIcon(b, iconId, pos, sorterIconScale);
        }

        const buildingIconScale = new Vector2();
        for (let i = 0; i < iconBuildings.length; i++) {
            const b = iconBuildings[i];
            if (
                !buildingIconPos(
                    b,
                    transforms[b.index][0],
                    pos,
                    buildingIconScale
                )
            )
                continue;
            const iconId = iconTexture.requestIcon(buildingIconId(b));
            icons.addIcon(b, iconId, pos, buildingIconScale);
        }

        if (subscriptsMesh !== null) {
            subscriptsMesh.needsUpdate();
        }
        return [icons, subscriptsMesh, subscriptMap] as const;
    };

    const belts = buildings.filter((b) => isBelt(b.itemId));
    const inserters = buildings.filter((b) => isInserter(b.itemId));

    const boxes = buildings.filter(
        (b) => !isInserter(b.itemId) && !isBelt(b.itemId)
    );

    const iconBuildings = boxes.filter((b) => !noIconBuildings.has(b.itemId));
    const iconBelts = belts.filter(
        (b) => b.parameters && (b.parameters as BeltParameters).iconId > 0
    );
    const iconInsterters = inserters.filter((b) => b.filterId > 0);

    const modelRef = new Array<{ mesh: InstancedMesh; instance: number }>(
        buildings.length
    );
    const beltCargosMesh = new Cargos(
        createBeltCargoGeometry(belts.length),
        belts.length
    );
    const inserterCargosMesh = new Cargos(
        createInserterCargoGeometry(inserters.length),
        inserters.length
    );
    let numBeltCargos = 0;
    let numInserterCargos = 0;
    const addBeltCargo = (trans: Matrix4, color: Color, distance: number) => {
        beltCargosMesh.setMatrixAt(numBeltCargos, trans);
        beltCargosMesh.setColorAt(numBeltCargos, color);
        beltCargosMesh.setCargoDistanceAt(numBeltCargos, distance);
        numBeltCargos++;
    };
    const addInserterCargo = (
        trans: Matrix4,
        color: Color,
        distance: number
    ) => {
        inserterCargosMesh.setMatrixAt(numInserterCargos, trans);
        inserterCargosMesh.setColorAt(numInserterCargos, color);
        inserterCargosMesh.setCargoDistanceAt(numInserterCargos, distance);
        numInserterCargos++;
    };

    const meshes: Object3D[] = [];
    if (belts.length) meshes.push(...buildBelts(belts));

    if (inserters.length) meshes.push(...buildInserters(inserters));

    if (numBeltCargos) {
        beltCargosMesh.count = numBeltCargos;
        beltCargosMesh.instanceMatrix.needsUpdate = true;
        beltCargosMesh.instanceColor!.needsUpdate = true;
        beltCargosMesh.geometry.cargoDistance.needsUpdate = true;
    }
    if (numInserterCargos) {
        inserterCargosMesh.count = numInserterCargos;
        inserterCargosMesh.instanceMatrix.needsUpdate = true;
        inserterCargosMesh.instanceColor!.needsUpdate = true;
        inserterCargosMesh.geometry.cargoDistance.needsUpdate = true;
    }

    if (boxes.length) meshes.push(...buildBoxes(boxes));

    const iconTexture = new IconTexture(renderer);
    const [icons, subscriptsMesh, subscriptMap] = buildIcons(
        iconBuildings,
        iconBelts,
        iconInsterters
    );
    if (subscriptsMesh) {
        subscriptsMesh.renderOrder = 11;
    }

    const iconMesh = new Icons(iconTexture.texture, icons);
    iconMesh.renderOrder = 10;

    return new AllBuildings(
        meshes,
        iconMesh,
        iconTexture,
        [beltCargosMesh, inserterCargosMesh],
        modelRef,
        subscriptsMesh,
        subscriptMap
    );
}

/** 建筑颜色：未知模型用中性灰兜底（`!` 断言会让一个未知模型毁掉整次场景重建） */
const UNKNOWN_BUILDING_COLOR = new Color(0x808080);
function buildingColor(b: BlueprintBuilding): Color {
    return buildingMeta.get(b.modelIndex)?.color ?? UNKNOWN_BUILDING_COLOR;
}

function registerUpdater(
    updater: Updater,
    buildings: AllBuildings,
    posBP: PositionedBlueprint
) {
    // 先清空所有旧回调，防止场景重建时重复注册导致陈旧回调引用已销毁的 AllBuildings
    updater.clearAll();

    updater.updateBuildingIcon.on((b) => {
        const icons = buildings.icons;
        // hasIcon 守卫：跳过 noIconBuildings（分流器/监测器等）与从未被渲染的建筑
        if (!icons.hasIcon(b)) return;
        const rawIconId = buildingIconId(b);
        const iconId =
            rawIconId > 0 ? buildings.iconTexture.requestIcon(rawIconId) : 0;
        icons.updateIconId(b, iconId);
    });

    updater.updateBeltIcon.on((b) => {
        const icons = buildings.icons;
        const params = b.parameters as BeltParameters | null;
        const rawIconId = params ? params.iconId : 0;
        const iconId =
            rawIconId > 0 ? buildings.iconTexture.requestIcon(rawIconId) : 0;

        if (icons.hasIcon(b)) {
            // 已有图标 → 直接更新 UV（包括 iconId=0 清空图标的情况）
            icons.updateIconId(b, iconId);
        } else if (iconId !== 0) {
            // 之前无图标，现在有了 → 动态添加
            const pos = new Vector3();
            const trans = calcBuildingTrans(R, posBP, b);
            beltIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, beltIconScale, true);
        }
    });

    updater.updateBeltIconSubscript.on((b) => {
        const subEntry = buildings.subscriptMap.get(b);
        if (!subEntry || !buildings.subscriptMesh) return;
        const params = b.parameters as BeltParameters | null;
        if (!params) return;
        // 重算 count 文本并更新 subscriptMesh 的 iconId / iconPos 属性
        let s: string;
        if (params.count >= 100000)
            s = Math.floor(params.count / 1000).toFixed(0) + "k";
        else s = params.count.toFixed(0);
        // 保护：若新文本长度与初始构建时不同，跳过本次局部刷新（下一非 silent 命令会重建场景）
        // 原因：subscriptMesh 是连续字符池，长度变化会覆盖/遗漏后续 belt 的下标
        if (s.length !== subEntry.length) return;
        const pos = new Vector3();
        const trans = calcBuildingTrans(R, posBP, b);
        beltIconPos(b, trans[0], pos);
        buildings.subscriptMesh.setText(
            subEntry.startIdx,
            pos,
            beltIconScale,
            s
        );
        buildings.subscriptMesh.needsUpdate();
    });

    updater.updateSorterIcon.on((b) => {
        const icons = buildings.icons;
        const rawIconId = b.filterId;
        const iconId =
            rawIconId > 0
                ? buildings.iconTexture.requestIcon(itemIconId(rawIconId))
                : 0;

        if (icons.hasIcon(b)) {
            icons.updateIconId(b, iconId);
        } else if (iconId !== 0) {
            // 之前无图标，现在有了 → 动态添加
            const pos = new Vector3();
            const trans = calcBuildingTrans(R, posBP, b);
            sorterIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, sorterIconScale, true);
        }
    });

    // updateStationInfo：当前物流塔面板自己响应式刷新即可；
    // 若未来要按库存首物品染色，在这里改颜色 attribute。
}

const R = 200.2;
const SEGMENT = 200;
</script>

<script setup lang="ts">
import {
    ref,
    onMounted,
    Ref,
    onUnmounted,
    shallowRef,
    watchEffect,
    computed,
    inject,
} from "vue";
import { Scene, PerspectiveCamera, SphereGeometry, AmbientLight } from "three";
import { PlanetMapControls } from "@/PlanetMapControls";
import { attachCamera, attachRenderer } from "@/utils";
import { usePlacement, resetToIdle } from "@/editor/placementState";
import {
    areaGridSize,
    canvasTargetAt,
    materializeCanvasTarget,
    planetToLocal,
    type AreaGridOrigin,
    type CanvasTarget,
} from "@/blueprint/globe";
import { createBuilding, CreateBuildingCommand } from "@/blueprint/create";
import {
    buildBeltLine,
    CreateBeltLineCommand,
    type BeltPathMode,
    type BeltPortEnd,
} from "@/blueprint/beltLine";
import {
    getBeltPorts,
    hasBeltPorts,
    pickBeltPort,
    portWorldNormal,
    portWorldOffset,
    type BeltPort,
} from "@/data/beltPorts";
import { createSorterBetween, collectOccupiedSlots } from "@/blueprint/sorter";
import { PaintReformCellCommand, reformColorHex } from "@/blueprint/reformEdit";
import { getBuildingSlots, slotDisplayPos } from "@/data/buildingSlots";
import {
    inheritLabSettings,
    isStackChild,
    linkStack,
    requiresBase,
    stackBaseFor,
    stackYawFor,
    stackedZ,
} from "@/data/stacking";

/**
 * 只需要屏幕坐标的事件最小结构：MouseEvent / PointerEvent 均可赋值，
 * 也让"鼠标静止时用最后一次坐标重算预览"可以直接传一个普通对象。
 */
type PointerCoords = { clientX: number; clientY: number };

const props = defineProps<{
    selectedBuildingIndex: number | null;
}>();

const emit = defineEmits<{
    (e: "update:selectedBuildingIndex", index: number | null): void;
    (e: "clickEmpty"): void;
}>();

const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 0.3));
const dirLight = new DirectionalLight(0xffffff, 2);
scene.add(dirLight);
{
    const geometry = new SphereGeometry(R, SEGMENT, SEGMENT / 2);
    const material = new MeshStandardMaterial({ color: 0xb0b0b0 });
    const planet = new Mesh(geometry, material);
    scene.add(planet);
}
const { grids: planetGrid, material: gridMaterial } = buildPlanetGrid(
    R * 1.0001,
    SEGMENT
);
scene.add(planetGrid);

const placement = usePlacement();
// 网格线随模式变色：预览原色 / 编辑绿 / 删除红 / 地基蓝
watchEffect(() => {
    if (placement.appMode === "edit") {
        if (placement.mode === "deleting") gridMaterial.color.set(0xff5050);
        else if (placement.mode === "reforming")
            gridMaterial.color.set(0x40a0ff);
        else gridMaterial.color.set(0x50fa50);
    } else gridMaterial.color.set(0xf0f0f0);
});

const root: Ref<HTMLDivElement | null> = ref(null);
const renderer = new WebGLRenderer({ antialias: true });
attachRenderer(root, renderer);

const camera = new PerspectiveCamera(50);
camera.near = 0.5;
camera.far = 3000;
camera.position.z = 2 * R;
attachCamera(root, camera);

const commandQueue = inject(commandQueueKey)!;

let controls: PlanetMapControls | null = null;

/** 一次重建产出的场景模型（建筑 + 地基 + 拾取结构 + 区域定位） */
interface SceneModel {
    buildings: AllBuildings;
    reforms: Reforms | null;
    bvh: BVH;
    pos: PositionedBlueprint;
}

/**
 * 当前生效的场景模型。
 *
 * 语义与旧实现一致（下游都读 `b.value.xxx`），但**替换是原子的**：新模型构建成功后才
 * 移除旧模型。旧实现用 `watchEffect` + `onCleanup`，清理函数在每次重算**之前**执行 ——
 * 一旦新一次计算抛错（区域越界 / 未知模型 / 定位失败），旧模型已从场景移除、新模型没加
 * 进去，表现就是"模型整体消失且不会自己回来"。
 */
const b = shallowRef<SceneModel | null>(null);

/** 上一次真正加进场景的模型（用于原子替换时移除旧内容） */
let appliedModel: SceneModel | null = null;

function applySceneModel(next: SceneModel | null) {
    if (next === appliedModel) return;
    if (appliedModel !== null) {
        scene.remove(appliedModel.buildings);
        appliedModel.buildings.dispose();
        if (appliedModel.reforms !== null) scene.remove(appliedModel.reforms);
    }
    appliedModel = next;
    b.value = next;
    if (next !== null) {
        scene.add(next.buildings);
        if (next.reforms !== null) scene.add(next.reforms);
    }
}

watchEffect(() => {
    // 任意命令（剔除建筑 / 撤销 / 重做）后整体重建场景
    commandQueue.value?.execVersion.value;
    const queue = commandQueue.value;
    if (queue === null) {
        applySceneModel(null);
        return;
    }
    rebuildScene(
        (): SceneModel => {
            const data = buildSceneData(queue.data, R, SEGMENT);
            const reforms = buildReforms(
                R,
                data.pos,
                queue.data.reformData,
                data.reformCells
            );
            const buildings = buildBuildings(
                data.transforms,
                queue.data.buildings,
                renderer
            );
            // 放在最后：只有模型建成了才换掉 updater 的回调
            registerUpdater(queue.updater, buildings, data.pos);
            return { buildings, reforms, bvh: data.bvh, pos: data.pos };
        },
        applySceneModel,
        (error) =>
            console.error("3D 场景重建失败，保留上一次的模型", error)
    );
});

{
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({
        color: 0x0074e8,
        opacity: 0.5,
        transparent: true,
        depthWrite: false,
    });
    const selectBox = new Mesh(geometry, material);
    selectBox.matrixAutoUpdate = false;
    watchEffect(() => {
        if (b.value === null || props.selectedBuildingIndex === null) {
            scene.remove(selectBox);
            return;
        }
        selectBox.matrix.copy(b.value.bvh.boxes[props.selectedBuildingIndex]);
        scene.add(selectBox);
    });
}

// 放置预览：半透明绿盒，编辑模式 placing 时跟随鼠标吸附网格（单个 Mesh 复用）
const previewVisible = ref(false);
const previewMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({
        color: 0x50fa50,
        opacity: 0.4,
        transparent: true,
        depthWrite: false,
    })
);
previewMesh.matrixAutoUpdate = false;
previewMesh.renderOrder = 9;
watchEffect(() => {
    const show =
        placement.appMode === "edit" &&
        placement.mode === "placing" &&
        previewVisible.value;
    if (show) scene.add(previewMesh);
    else scene.remove(previewMesh);
});

// ---- 传送带拖拽铺线 / 分拣器两点架接 ----
const isPlacingBelt = () =>
    placement.appMode === "edit" &&
    placement.mode === "placing" &&
    placement.selectedItemId !== null &&
    isBelt(placement.selectedItemId);
const isPlacingSorter = () =>
    placement.appMode === "edit" &&
    placement.mode === "placing" &&
    placement.selectedItemId !== null &&
    isInserter(placement.selectedItemId);

// 地基模式光标：跟随鼠标高亮目标格（薄板，颜色 = 当前选择的槽位色）
const reformCursorVisible = ref(false);
const reformCursor = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0.55,
        transparent: true,
        depthWrite: false,
    })
);
reformCursor.matrixAutoUpdate = false;
reformCursor.renderOrder = 9;
watchEffect(() => {
    const show =
        placement.appMode === "edit" &&
        placement.mode === "reforming" &&
        reformCursorVisible.value;
    if (show) scene.add(reformCursor);
    else scene.remove(reformCursor);
});

let beltStart: { x: number; y: number } | null = null;
/** A 点落在建筑口上时的口绑定（取出：建筑→带）；null = 普通空格/带格起点 */
let beltStartPort: BeltPortEnd | null = null;
/**
 * 本条拖拽传送带所属的区域（一条带一个区域）：A 点按下时确定，
 * 之后 B 点/预览都换算到这个区域的局部坐标，越出该带的部分按边界截断。
 */
let beltArea: { areaIndex: number; origin: AreaGridOrigin } | null = null;
const sorterSource = ref<number | null>(null);

// 传送带路径走法（R 键循环切换）：latFirst → lonFirst → straight → latFirst
let beltPathMode: BeltPathMode = "latFirst";
const BELT_PATH_MODES: BeltPathMode[] = ["latFirst", "lonFirst", "straight"];
// 实际切换函数在 onMounted 内部定义（需访问 lastMouseEvent/updateBeltPreview），
// 此处用 ref 桥接供 defineExpose 调用
const cycleBeltPathModeFn = ref<(() => BeltPathMode) | null>(null);

// 整条传送带的拖拽预览（复用实例网格，count 随路径变化）
const BELT_PREVIEW_CAP = 1024;
const beltPreviewMesh = new InstancedMesh(
    new BoxGeometry(0.6, 0.6, 0.1),
    new MeshBasicMaterial({
        color: 0x50fa50,
        opacity: 0.45,
        transparent: true,
        depthWrite: false,
    }),
    BELT_PREVIEW_CAP
);
beltPreviewMesh.matrixAutoUpdate = false;
beltPreviewMesh.count = 0;
beltPreviewMesh.renderOrder = 9;
// InstancedMesh 的包围球只在首次渲染时计算一次，之后 setMatrixAt 不会让它失效；
// 相机拉近后视锥变窄，光标移出这个（过期的）包围球就会被整体剔除 → 光标消失。
// 预览始终贴着光标，直接关闭视锥剔除。
beltPreviewMesh.frustumCulled = false;
const beltPreviewVisible = ref(false);
watchEffect(() => {
    if (isPlacingBelt() && beltPreviewVisible.value) scene.add(beltPreviewMesh);
    else scene.remove(beltPreviewMesh);
});

// straight 模式预览：矢量直线（非阶梯状位图）
const beltStraightLine = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({ color: 0x50fa50, opacity: 0.8, transparent: true })
);
beltStraightLine.renderOrder = 10;
const beltStraightLineVisible = ref(false);
watchEffect(() => {
    if (isPlacingBelt() && beltStraightLineVisible.value)
        scene.add(beltStraightLine);
    else scene.remove(beltStraightLine);
});
function hideBeltPreview() {
    beltPreviewMesh.count = 0;
    beltPreviewVisible.value = false;
    beltStraightLineVisible.value = false;
}

// 分拣器第一点（源建筑）高亮 / 点击锚点（决定挂哪个 slot，与游戏光标一致）
let sorterSourceAnchor: { x: number; y: number } | null = null;
// 悬停锚点用 ref：鼠标在同一建筑内移动时也要驱动 slot 预演刷新
const sorterHoverAnchor = ref<{ x: number; y: number } | null>(null);
const sorterSrcBox = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({
        color: 0x50fa50,
        opacity: 0.3,
        transparent: true,
        depthWrite: false,
    })
);
sorterSrcBox.matrixAutoUpdate = false;
watchEffect(() => {
    if (b.value !== null && isPlacingSorter() && sorterSource.value !== null) {
        sorterSrcBox.matrix.copy(b.value.bvh.boxes[sorterSource.value]);
        scene.add(sorterSrcBox);
    } else {
        scene.remove(sorterSrcBox);
    }
});

// ---- 分拣器架接可视化：slot 标记 / 皮带 segIndex 范围 / 预览连线 ----
/** 鼠标悬停的建筑下标（pointermove 时更新；驱动覆盖层 watchEffect） */
const sorterHover = ref<number | null>(null);

const SLOT_MARKER_CAP = 12; // 建筑 slot 数上限
const slotMarkers = new InstancedMesh(
    new SphereGeometry(0.09, 12, 8),
    // 白底乘 instanceColor；depthTest:false 透过建筑可见，模拟游戏内 slot 指示
    new MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        depthTest: false,
    }),
    SLOT_MARKER_CAP
);
slotMarkers.matrixAutoUpdate = false;
slotMarkers.count = 0;
slotMarkers.renderOrder = 10;
slotMarkers.frustumCulled = false; // 同 beltPreviewMesh：实例包围球不随 setMatrixAt 更新
const slotMarkersVisible = ref(false);
const SLOT_COLORS = {
    free: new Color(0x50fa50), // 空闲
    used: new Color(0xff4040), // 已被其他分拣器占用
    target: new Color(0xffd700), // 本次将连接（含被占后切换到的平行 slot）
};

/**
 * 建筑**传送带口**标记（正方形）：与分拣器口（圆点）配套，
 * 铺传送带时悬停建筑就显示"这个建筑有哪些口可以接带"——绿色空闲、红色已有带、黄色本次将接。
 */
const PORT_MARKER_CAP = 12; // 建筑传送带口数上限（物流站 12 口）
const portMarkers = new InstancedMesh(
    new PlaneGeometry(0.2, 0.2),
    new MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        side: DoubleSide,
    }),
    PORT_MARKER_CAP
);
portMarkers.matrixAutoUpdate = false;
portMarkers.count = 0;
portMarkers.renderOrder = 10;
portMarkers.frustumCulled = false; // 同 beltPreviewMesh：实例包围球不随 setMatrixAt 更新
const portMarkersVisible = ref(false);
/** 悬停点的相对高度（格）：用于区分分流器的地面层/上层口 */
const sorterHoverZ = ref(0);

// 皮带可连接范围（沿主轴 ±0.5 格 = offset ±10 段，与 sorter.ts 的 main 区间一致）
const beltRangeMesh = new Mesh(
    new BoxGeometry(0.1, 1.0, 0.1),
    new MeshBasicMaterial({
        color: 0x40c8ff,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
    })
);
beltRangeMesh.matrixAutoUpdate = false;
beltRangeMesh.renderOrder = 10;
const beltRangeVisible = ref(false);

// 源→悬停目标的预览连线（细长盒，z 轴沿连线拉伸）
const sorterPreviewMesh = new Mesh(
    new BoxGeometry(0.14, 0.14, 1),
    new MeshBasicMaterial({
        color: 0x50fa50,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
    })
);
sorterPreviewMesh.matrixAutoUpdate = false;
sorterPreviewMesh.renderOrder = 10;
const sorterPreviewVisible = ref(false);

watchEffect(() => {
    if (slotMarkersVisible.value) scene.add(slotMarkers);
    else scene.remove(slotMarkers);
    if (portMarkersVisible.value) scene.add(portMarkers);
    else scene.remove(portMarkers);
    if (beltRangeVisible.value) scene.add(beltRangeMesh);
    else scene.remove(beltRangeMesh);
    if (sorterPreviewVisible.value) scene.add(sorterPreviewMesh);
    else scene.remove(sorterPreviewMesh);
});

// 覆盖层刷新用的临时对象（复用避免每帧分配）
const overlayM = new Matrix4();
const overlayLift = new Matrix4();
const overlayP0 = new Vector3();
const overlayP1 = new Vector3();
const overlayZ = new Vector3();
const overlayX = new Vector3();
const overlayY = new Vector3();

/**
 * 光标（连续网格坐标）→ 建筑上的传送带口。
 * 与 `BlueprintEditor.portEndAt` / 标记覆盖层共用同一套换算：
 * 命中点 → 建筑局部系（`x` 按纬度归一到赤道基准）→ `pickBeltPort`（先按高度层、再按 xy 最近）。
 */
function beltPortAtPointer(
    building: BlueprintBuilding,
    anchor: { x: number; y: number },
    hitZ: number,
    pos: PositionedBlueprint
): { slot: number; port: BeltPort } | null {
    if (!hasBeltPorts(building.itemId, building.modelIndex)) return null;
    const bp = building.localOffset[0];
    const area = pos.areas[building.areaIndex];
    const turn = areaGridSize(area.segment);
    // 经向环形坐标取短弧（该区域自己的格数，不是固定的 1000）
    let dx = anchor.x - bp.x;
    if (dx > turn / 2) dx -= turn;
    else if (dx < -turn / 2) dx += turn;
    const dy = anchor.y - bp.y;
    const cosLat = Math.cos(
        (area.latitude + bp.y) * ((2 * Math.PI) / (SEGMENT * 5))
    );
    const yaw = building.yaw[0];
    const r = (yaw * Math.PI) / 180;
    // 网格偏移 → 建筑局部系（x 归一到赤道基准）
    const lx = (dx * Math.cos(r) - dy * Math.sin(r)) * cosLat;
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    return pickBeltPort(building.itemId, building.modelIndex, lx, ly, hitZ);
}

/** 该口上是否已经挂着传送带（口带：带以建筑口为端点） */
function portHasBelt(
    buildings: readonly BlueprintBuilding[],
    building: BlueprintBuilding,
    slot: number
): boolean {
    return buildings.some(
        (b) =>
            isBelt(b.itemId) &&
            ((b.inputObjIdx === building.index && b.inputFromSlot === slot) ||
                (b.outputObjIdx === building.index && b.outputToSlot === slot))
    );
}

/**
 * 刷新架接/铺带覆盖层。
 * 依赖 b.value / sorterHover / sorterSource / placement，任一变化自动重跑：
 * - 悬停建筑：显示**分拣器口（圆点）**与**传送带口（方块）**，绿=空闲，红=已占用，黄=本次将连接
 * - 悬停皮带（分拣器模式）：显示主轴 segIndex 范围条
 * - 已选源且悬停有效目标（分拣器模式）：调 createSorterBetween 全真预演（含占用切换），
 *   绿线=可放置，红线=不可（平行组占满 / 距离超 3 格）
 */
function refreshSorterOverlay() {
    slotMarkersVisible.value = false;
    portMarkersVisible.value = false;
    beltRangeVisible.value = false;
    sorterPreviewVisible.value = false;
    const bp = b.value;
    const queue = commandQueue.value;
    const placingSorter = isPlacingSorter();
    const placingBelt = isPlacingBelt();
    if (
        !bp ||
        !queue ||
        (!placingSorter && !placingBelt) ||
        placement.selectedItemId === null ||
        placement.selectedModelIndex === null
    )
        return;
    const hover = sorterHover.value;
    if (hover === null) return;
    const data = queue.data;
    const hoverBuilding = data.buildings[hover];
    const trans = calcBuildingTrans(R, bp.pos, hoverBuilding);

    if (placingSorter && isBelt(hoverBuilding.itemId)) {
        // 皮带：青色范围条沿主轴（盒 y 轴随 yaw 旋转对齐）
        overlayLift.makeTranslation(0, 0, 0.25);
        beltRangeMesh.matrix.multiplyMatrices(trans[0], overlayLift);
        beltRangeVisible.value = true;
        // 不 return：继续走下面的预演和预览连线逻辑
    }

    // 已选源且悬停有效目标 → 全真预演（含被占后的平行切换；与实际放置完全一致）
    const src = placingSorter ? sorterSource.value : null;
    let preview: BlueprintBuilding | null = null;
    if (src !== null && src !== hover) {
        preview = createSorterBetween(
            data.buildings[src],
            hoverBuilding,
            placement.selectedItemId,
            placement.selectedModelIndex,
            data.buildings,
            {
                src: sorterSourceAnchor ?? undefined,
                dst: sorterHoverAnchor.value ?? undefined,
            }
        );
        // 分拣器属于源建筑那片区域：算出世界矩阵前先对齐 areaIndex（一条带一个区域）
        if (preview !== null) preview.areaIndex = hoverBuilding.areaIndex;
    }

    const slots = getBuildingSlots(hoverBuilding.itemId);
    if (slots.some((s) => s !== null)) {
        // 建筑：已标定 slot 全部染色显示（未标定 slot 为 null，不显示标记）
        const occupied = collectOccupiedSlots(data.buildings, hover);
        const targetSlot = preview ? preview.outputToSlot : -1;
        let count = 0;
        for (let i = 0; i < slots.length && count < SLOT_MARKER_CAP; i++) {
            // 坐标用 slotDisplayPos：角 slot 与相邻面边界 slot 在蓝图数据里完全重合，
            // 按真实坐标画会两两叠成一个点（看起来只有 8 个）——显示时沿所属面向内收一点，
            // 呈现游戏里的"四边各三个"。连接用的端点仍是真实坐标。
            const slot = slotDisplayPos(hoverBuilding.itemId, i);
            if (slot === null) continue;
            overlayLift.makeTranslation(slot.x, slot.y, 0.35);
            overlayM.multiplyMatrices(trans[0], overlayLift);
            slotMarkers.setMatrixAt(count, overlayM);
            slotMarkers.setColorAt(
                count,
                i === targetSlot
                    ? SLOT_COLORS.target
                    : occupied.has(i)
                    ? SLOT_COLORS.used
                    : SLOT_COLORS.free
            );
            count++;
        }
        slotMarkers.count = count;
        slotMarkers.instanceMatrix.needsUpdate = true;
        if (slotMarkers.instanceColor)
            slotMarkers.instanceColor.needsUpdate = true;
        slotMarkersVisible.value = true;
    }

    // 传送带口（正方形）：所有有带口表的建筑都画；绿=空闲、红=已挂带、黄=本次光标选中的口
    const ports = getBeltPorts(hoverBuilding.itemId, hoverBuilding.modelIndex);
    if (ports.some((p) => p !== null)) {
        const anchor = sorterHoverAnchor.value;
        const targetPort =
            placingBelt && anchor !== null
                ? beltPortAtPointer(
                      hoverBuilding,
                      anchor,
                      sorterHoverZ.value,
                      bp.pos
                  )?.slot ?? -1
                : -1;
        let count = 0;
        for (
            let slot = 0;
            slot < ports.length && count < PORT_MARKER_CAP;
            slot++
        ) {
            const port = ports[slot];
            if (!port) continue;
            // z 是高度格：换算成局部单位（分流器的上下层口差 1 格 ≈ 1.33 单位）
            overlayLift.makeTranslation(
                port.x,
                port.y,
                port.z * HEIGHT_GRID_SIZE + 0.35
            );
            overlayM.multiplyMatrices(trans[0], overlayLift);
            portMarkers.setMatrixAt(count, overlayM);
            portMarkers.setColorAt(
                count,
                slot === targetPort
                    ? SLOT_COLORS.target
                    : portHasBelt(data.buildings, hoverBuilding, slot)
                    ? SLOT_COLORS.used
                    : SLOT_COLORS.free
            );
            count++;
        }
        portMarkers.count = count;
        portMarkers.instanceMatrix.needsUpdate = true;
        if (portMarkers.instanceColor)
            portMarkers.instanceColor.needsUpdate = true;
        portMarkersVisible.value = true;
    }

    // 预览连线（建筑有无 slot 数据均显示；绿=可放置，红=不可）
    if (src !== null && src !== hover) {
        if (preview) {
            const et = calcBuildingTrans(R, bp.pos, preview);
            overlayP0.setFromMatrixPosition(et[0]);
            overlayP1.setFromMatrixPosition(et[1]);
            (sorterPreviewMesh.material as MeshBasicMaterial).color.setHex(
                0x50fa50
            );
        } else {
            // 不可放置：连两建筑中心的红线提示
            overlayP0.setFromMatrixPosition(
                calcBuildingTrans(R, bp.pos, data.buildings[src])[0]
            );
            overlayP1.setFromMatrixPosition(trans[0]);
            (sorterPreviewMesh.material as MeshBasicMaterial).color.setHex(
                0xff4040
            );
        }
        // 右手正交基：x=切向(yaw 轴)，y=径向，z=沿连线（连线方向在局部 xy 平面内）
        overlayZ.subVectors(overlayP1, overlayP0);
        const len = overlayZ.length();
        if (len > 1e-6) {
            overlayZ.divideScalar(len);
            overlayY.copy(overlayP0).add(overlayP1).normalize(); // 中点径向
            overlayX.crossVectors(overlayY, overlayZ).normalize();
            overlayY.crossVectors(overlayZ, overlayX); // 重新正交化
            sorterPreviewMesh.matrix.makeBasis(overlayX, overlayY, overlayZ);
            sorterPreviewMesh.matrix.setPosition(
                (overlayP0.x + overlayP1.x) / 2,
                (overlayP0.y + overlayP1.y) / 2,
                (overlayP0.z + overlayP1.z) / 2
            );
            sorterPreviewMesh.matrix.scale(overlayX.set(1, 1, len));
            sorterPreviewVisible.value = true;
        }
    }
}
watchEffect(refreshSorterOverlay);

// 退出 placing / 切换建筑时清理中途状态
watchEffect(() => {
    placement.mode;
    placement.selectedItemId;
    if (!isPlacingBelt()) {
        beltStart = null;
        beltStartPort = null;
        beltArea = null;
        hideBeltPreview();
    }
    if (!isPlacingSorter()) {
        sorterSource.value = null;
        sorterSourceAnchor = null;
        sorterHover.value = null;
        sorterHoverAnchor.value = null;
    }
});

onMounted(() => {
    const rootEl = root.value!;

    controls = new PlanetMapControls(camera, renderer.domElement);
    const c = controls;
    c.listenToKeyEvents(rootEl);
    c.minDistance = R * 1.04;
    c.maxDistance = R * 4;
    c.targetRadius = R;
    onUnmounted(() => c.dispose());
    c.update();

    const ray = new Ray();
    const planetSphere = new Sphere(new Vector3(), R);
    const v = new Vector3();
    const GRID_SIZE = 1000; // 200 segments * 5 grids/segment
    const RAD_TO_GRID = GRID_SIZE / (2 * Math.PI);

    const setupRay = (e: PointerCoords) => {
        ray.origin.setFromMatrixPosition(camera.matrixWorld);
        const rect = renderer.domElement.getBoundingClientRect();
        ray.direction.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ray.direction.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.direction.z = 0.5;
        ray.direction.unproject(camera).sub(ray.origin).normalize();
    };
    const pickBuilding = (e: PointerCoords) => {
        if (b.value === null) return null;
        setupRay(e);
        const intersects = b.value.bvh.raycast(ray);
        if (intersects.length === 0) return null;

        const intersectPlanet = ray.intersectSphere(planetSphere, v);
        if (
            intersectPlanet !== null &&
            intersectPlanet.distanceToSquared(ray.origin) <
                intersects[0].distanceSquared
        )
            intersects.length = 0;

        return intersects.length === 0 ? null : intersects[0].index;
    };
    /** Raycast to planet sphere, return 3D hit point or null */
    const screenToPlanet = (e: PointerCoords): Vector3 | null => {
        setupRay(e);
        return ray.intersectSphere(planetSphere, v);
    };
    /**
     * 屏幕位置 → 放置目标：命中的**纬度带** + 该带区域（可能尚未建，`areaIndex=-1`）+ 区域局部格。
     *
     * 编辑坐标空间 = 全球画布（见 `@/blueprint/globe`）：每条纬度带一个区域，
     * 于是光标落在任何纬度都能换算成"某条带的局部格"，不再受赤道带 ±80 行限制。
     * 与 `calcBuildingTrans` 用同一份区域原点换算，预览/落位/地基/传送带共用。
     */
    const placementTargetAt = (
        e: PointerCoords,
        snap = !placement.freePlacement
    ): CanvasTarget | null => {
        const queue = commandQueue.value;
        const hit = screenToPlanet(e);
        if (queue === null || b.value === null || hit === null) return null;
        const latGrid = Math.asin(hit.y / R) * RAD_TO_GRID;
        const lonGrid = Math.atan2(hit.x, hit.z) * RAD_TO_GRID;
        const row = snap ? Math.floor(latGrid) : latGrid;
        const target = canvasTargetAt(queue.data, b.value.pos, row, lonGrid);
        if (target === null) return null;
        if (snap) {
            target.x = Math.floor(target.x);
            target.y = Math.floor(target.y);
        }
        return target;
    };
    /**
     * 目标区域若还没建出来 → 按需补一条该带的区域（画布扩张，不进撤销栈），
     * 并把目标局部格换到新原点上（物理位置不变，保证与绿盒一致）。
     */
    const materializeTarget = (target: CanvasTarget): number => {
        const queue = commandQueue.value;
        if (queue === null) return -1;
        if (target.areaIndex >= 0) return target.areaIndex;
        const placed = materializeCanvasTarget(queue.data, target);
        target.areaIndex = placed.areaIndex;
        target.origin = placed.origin;
        target.x = placed.x;
        target.y = placed.y;
        return placed.areaIndex;
    };
    /** 用某个区域原点构造合成定位：预览对象还没入库时也能算出世界矩阵 */
    const syntheticPos = (origin: AreaGridOrigin): PositionedBlueprint => ({
        segment: SEGMENT,
        areas: [{ ...origin }],
    });
    /**
     * 区域局部格 → 区域（用于把别的纬度带上的点搬到本条带的局部坐标）。
     * 两个区域段数不同时按**物理经度比例**换算（极区/低段数区域的格更宽）。
     */
    const convertLocal = (
        p: { x: number; y: number },
        from: AreaGridOrigin,
        to: AreaGridOrigin
    ): { x: number; y: number } => {
        const fromTurn = areaGridSize(from.segment);
        const toTurn = areaGridSize(to.segment);
        const col = ((from.longitude + p.x) % fromTurn + fromTurn) % fromTurn;
        const x = ((col / fromTurn) * toTurn - to.longitude) % toTurn;
        return {
            x: (x + toTurn) % toTurn,
            y: from.latitude + p.y - to.latitude,
        };
    };
    /**
     * 屏幕位置 → 命中的建筑与命中点高度格（用于区分分流器的地面层/上层口）。
     * 高度格 = (命中点到星球中心的距离 − R) / (4/3)，与 `calcBuildingTrans` 同一套换算。
     */
    const pickBuildingHit = (
        e: PointerCoords
    ): { index: number; z: number } | null => {
        if (b.value === null) return null;
        setupRay(e);
        const intersects = b.value.bvh.raycast(ray);
        if (intersects.length === 0) return null;
        const hitPlanet = ray.intersectSphere(planetSphere, v);
        if (
            hitPlanet !== null &&
            hitPlanet.distanceToSquared(ray.origin) <
                intersects[0].distanceSquared
        )
            return null;
        const p = ray.origin
            .clone()
            .addScaledVector(
                ray.direction,
                Math.sqrt(intersects[0].distanceSquared)
            );
        return {
            index: intersects[0].index,
            z: (p.length() - R) / HEIGHT_GRID_SIZE,
        };
    };
    /**
     * 光标 → 建筑传送带口绑定（串联用）。
     * 命中的建筑有口表、且光标在某个口附近（`pickBeltPort` 的 limit）时返回该口；
     * 否则返回 null（当作普通空格/带格处理）。换算与标记覆盖层共用 `beltPortAtPointer`。
     */
    const portEndAt = (e: PointerCoords): BeltPortEnd | null => {
        const queue = commandQueue.value;
        if (!queue || b.value === null) return null;
        const hit = pickBuildingHit(e);
        if (hit === null) return null;
        const building = queue.data.buildings[hit.index];
        if (!building) return null;
        const a = anchorOffset(e, building.areaIndex);
        if (a === null) return null;
        const picked = beltPortAtPointer(building, a, hit.z, b.value.pos);
        if (!picked) return null;
        const bp = building.localOffset[0];
        const area = b.value.pos.areas[building.areaIndex];
        const cosLat = Math.cos(
            (area.latitude + bp.y) * ((2 * Math.PI) / (SEGMENT * 5))
        );
        const off = portWorldOffset(picked.port, building.yaw[0], cosLat);
        const n = portWorldNormal(picked.port, building.yaw[0]);
        return {
            building,
            slot: picked.slot,
            point: { x: bp.x + off.x, y: bp.y + off.y, z: off.z },
            nx: n.x,
            ny: n.y,
        };
    };
    /**
     * 屏幕位置 → 连续网格坐标（不取整）。用于分拣器的 slot 锚点：
     * 与游戏一致，光标落在哪一列/哪一行就决定挂哪个 slot。
     * 命中建筑时用建筑表面命中点径向投影回球面，否则用星球表面点。
     * @param areaIndex 用哪个区域的坐标空间换算（分拣器/传送带口必须用建筑自己的区域）
     */
    const anchorPoint = new Vector3();
    const anchorOffset = (e: PointerCoords, areaIndex?: number) => {
        const queue = commandQueue.value;
        if (b.value === null || queue === null) return null;
        setupRay(e);
        const intersects = b.value.bvh.raycast(ray);
        const hitPlanet = ray.intersectSphere(planetSphere, anchorPoint);
        if (
            intersects.length > 0 &&
            (hitPlanet === null ||
                intersects[0].distanceSquared <=
                    hitPlanet.distanceToSquared(ray.origin))
        ) {
            anchorPoint
                .copy(ray.origin)
                .addScaledVector(
                    ray.direction,
                    Math.sqrt(intersects[0].distanceSquared)
                );
        } else if (hitPlanet === null) {
            return null;
        }
        // 径向投影回球面后再转网格（建筑命中点浮在地表上方）
        anchorPoint.normalize().multiplyScalar(R);
        const latGrid = Math.asin(anchorPoint.y / R) * RAD_TO_GRID;
        const lonGrid = Math.atan2(anchorPoint.x, anchorPoint.z) * RAD_TO_GRID;
        const origin =
            areaIndex !== undefined
                ? b.value.pos.areas[areaIndex]
                : canvasTargetAt(queue.data, b.value.pos, latGrid, lonGrid)
                      ?.origin;
        if (origin === undefined) return null;
        return planetToLocal(latGrid, lonGrid, origin);
    };
    /**
     * 放置建筑。
     * 可堆叠建筑（储物仓 / 储液罐 / 矩阵研究站 / 四向分流器 / 战场分析基站）在光标落在
     * 底座上时**叠到该列最上层**（z = 底座 z + 一层高度，x/y 对齐底座中心，写 15/14 端口）；
     * 研究站还会沿用底座的模式与配方（一列研究站共享设置）；
     * 底座对朝向有要求时（分析基站上的大箱子必须转 90°）按 `stackYawFor` 强制对齐。
     * 物流配送器（2107）没有箱子底座时直接拒绝（游戏：只能放在箱盖上方）。
     */
    const placeBuilding = (e: PointerCoords) => {
        const queue = commandQueue.value;
        if (
            !queue ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        )
            return;
        const target = placementTargetAt(e);
        if (target === null) return;
        // 该纬度带还没有区域 → 按规范布局补一条（画布扩张；建筑绝对位置不受影响）
        const areaIndex = materializeTarget(target);
        if (areaIndex < 0) return;
        const offset = { x: target.x, y: target.y };
        const itemId = placement.selectedItemId;
        const parent = placeBaseFor(e, offset, itemId, areaIndex);
        if (requiresBase(itemId) && parent === null) return;
        const building = createBuilding(
            itemId,
            placement.selectedModelIndex,
            parent
                ? {
                      x: parent.localOffset[0].x,
                      y: parent.localOffset[0].y,
                  }
                : offset,
            (parent ? stackYawFor(parent, itemId) : null) ?? placement.yaw,
            stackedZ(parent, itemId)
        );
        if (parent) {
            linkStack(building, parent);
            inheritLabSettings(building, parent);
        }
        try {
            // areaIndex = 建筑所在纬度带的区域（全球画布下每条带一个区域）
            queue.push(new CreateBuildingCommand(building, areaIndex));
        } catch {
            // 纬度带外 / 区域不存在 — ignore
        }
    };
    /** 放置/预览共用的堆叠底座求解（光标所指建筑优先，其次同格最上层可承载建筑） */
    const placeBaseFor = (
        e: PointerCoords,
        offset: { x: number; y: number },
        itemId: number,
        areaIndex: number
    ): BlueprintBuilding | null => {
        const queue = commandQueue.value;
        // 只有"可以叠在别人身上"的建筑才需要做拾取，普通建筑放置不付这份开销；
        // 目标纬度带还没有区域（areaIndex<0）时该带里不可能有底座
        if (!queue || !isStackChild(itemId) || areaIndex < 0) return null;
        const hit = pickBuilding(e);
        return stackBaseFor(
            queue.data.buildings,
            hit === null ? null : queue.data.buildings[hit],
            offset.x,
            offset.y,
            itemId,
            areaIndex
        );
    };
    /** 鼠标跟随预览：placing 模式下更新半透明绿盒的位置与朝向（分拣器走两点架接，无绿盒） */
    /**
     * 最后一帧的指针屏幕坐标（投影/拾取只用到 clientX/clientY）。
     * **必须是响应式**：鼠标静止时按 R 旋转 / 切建筑 / 改 Shift 吸附也要立即刷新预览。
     * 用普通变量时，下面 onMounted 里的 watchEffect 首次执行会因 null 提前 return，
     * 一个依赖都收集不到 → 之后永不重跑，表现为"按 R 没反应、动一下鼠标才转"。
     */
    const lastPointer = shallowRef<PointerCoords | null>(null);
    const updatePreview = (e: PointerCoords) => {
        if (
            placement.appMode !== "edit" ||
            placement.mode !== "placing" ||
            isPlacingSorter() ||
            isPlacingBelt()
        ) {
            if (previewVisible.value) previewVisible.value = false;
            return;
        }
        const target = placementTargetAt(e);
        if (
            target === null ||
            b.value === null ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        ) {
            previewVisible.value = false;
            return;
        }
        const meta = buildingMeta.get(placement.selectedModelIndex);
        if (!meta) {
            previewVisible.value = false;
            return;
        }
        const offset = { x: target.x, y: target.y };
        const itemId = placement.selectedItemId;
        // 预演堆叠：底座高度 + 对齐底座中心 + 底座要求的朝向；
        // 只能放在底座上的建筑（物流配送器）没有箱子时不显示预览（点了也放不下去）
        const parent = placeBaseFor(e, offset, itemId, target.areaIndex);
        if (requiresBase(itemId) && parent === null) {
            previewVisible.value = false;
            return;
        }
        const fake = createBuilding(
            itemId,
            placement.selectedModelIndex,
            parent
                ? {
                      x: parent.localOffset[0].x,
                      y: parent.localOffset[0].y,
                  }
                : offset,
            (parent ? stackYawFor(parent, itemId) : null) ?? placement.yaw,
            stackedZ(parent, itemId)
        );
        // 预览可能落在还没建出区域的纬度带上：用该带规范原点做合成定位，落位后与真实区域一致
        const trans = calcBuildingTrans(R, syntheticPos(target.origin), fake)[0];
        previewMesh.matrix.multiplyMatrices(trans, meta.unitBoxTrans);
        previewVisible.value = true;
    };
    // 传送带拖拽预览：把起点到当前点的栅格化路径写入实例网格
    const beltPreviewM = new Matrix4();
    const beltLift = new Matrix4().makeTranslation(0, 0, 0.05);
    const _tmpPos = new Vector3();

    /** 网格偏移 → 世界坐标（用于直线预览端点） */
    const gridToWorld = (
        offset: { x: number; y: number },
        origin: AreaGridOrigin
    ): Vector3 | null => {
        if (
            b.value === null ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        )
            return null;
        const fake = createBuilding(
            placement.selectedItemId,
            placement.selectedModelIndex,
            offset,
            0
        );
        const t = calcBuildingTrans(R, syntheticPos(origin), fake)[0];
        return _tmpPos.setFromMatrixPosition(t).clone();
    };

    // ---- 地基模式：逐格铺/涂 ----
    /** 网格偏移 → 地基光标世界矩阵（薄板贴于格子中心，朝向球面法线） */
    const reformCellMatrix = (
        offset: { x: number; y: number },
        origin: AreaGridOrigin
    ): Matrix4 | null => {
        if (b.value === null) return null;
        const fake = createBuilding(1131, 0, offset, 0);
        const t = calcBuildingTrans(R, syntheticPos(origin), fake)[0].clone();
        t.multiply(new Matrix4().makeScale(1, 1, 0.12));
        return t;
    };

    /** 地基模式：鼠标所在格 → 目标格高亮（颜色 = 当前槽位色） */
    const updateReformCursor = (e: PointerCoords) => {
        if (placement.appMode !== "edit" || placement.mode !== "reforming") {
            reformCursorVisible.value = false;
            return;
        }
        const queue = commandQueue.value;
        if (!queue) {
            reformCursorVisible.value = false;
            return;
        }
        // 地基格同样按"所在纬度带"选区域：全球任意纬度都能铺（地基格一律吸附整格）
        const target = placementTargetAt(e, true);
        if (target === null) {
            reformCursorVisible.value = false;
            return;
        }
        const x = target.x;
        const y = target.y;
        const area = queue.data.areas[target.areaIndex];
        // 区域还没建出来时按规范整带高度判断（点击时会补建），已建区域按它自己的 size
        const sizeY = area === undefined ? target.band.rowHi - target.band.rowLo + 1 : area.size.y;
        if (x < 0 || y < 0 || y >= sizeY) {
            reformCursorVisible.value = false;
            return;
        }
        const m = reformCellMatrix({ x, y }, target.origin);
        if (m === null) {
            reformCursorVisible.value = false;
            return;
        }
        reformCursor.matrix.copy(m);
        // 更新光标矩阵
        reformCursor.updateMatrixWorld();
        reformCursor.material.color.set(
            reformColorHex(queue.data.reformData, placement.reformColorSlot)
        );
        reformCursorVisible.value = true;
    };

    /** 地基模式：单击格 = 铺/涂一格当前颜色（空域铺新格，有地基改色） */
    const paintReformCell = (e: PointerCoords) => {
        const queue = commandQueue.value;
        if (!queue) return;
        const target = placementTargetAt(e, true);
        if (target === null) return;
        // 该纬度带还没有区域 → 先补一条（与建筑放置同一套画布扩张），再铺格
        const areaIndex = materializeTarget(target);
        if (areaIndex < 0) return;
        const area = queue.data.areas[areaIndex];
        const x = target.x;
        const y = target.y;
        if (x < 0 || y < 0 || y >= area.size.y) return;
        if (x >= area.size.x) area.size.x = Math.floor(x) + 1;
        queue.push(
            new PaintReformCellCommand(areaIndex, x, y, placement.reformColorSlot)
        );
    };

    /** 未设 A 点时：在鼠标位置显示单个传送带方块（悬停建筑口时贴到口上） */
    const showSingleBeltPreview = (e: PointerCoords) => {
        if (
            b.value === null ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        )
            return;
        const port = portEndAt(e);
        const target = placementTargetAt(e, true);
        const offset = port
            ? { x: port.point.x, y: port.point.y }
            : target === null
            ? null
            : { x: target.x, y: target.y };
        if (offset === null) return;
        const origin =
            port !== null
                ? b.value.pos.areas[port.building.areaIndex]
                : target!.origin;
        const fake = createBuilding(
            placement.selectedItemId,
            placement.selectedModelIndex,
            offset,
            placement.yaw,
            port ? port.point.z : 0
        );
        const t = calcBuildingTrans(R, syntheticPos(origin), fake)[0];
        beltPreviewM.multiplyMatrices(t, beltLift);
        beltPreviewMesh.setMatrixAt(0, beltPreviewM);
        beltPreviewMesh.count = 1;
        beltPreviewMesh.instanceMatrix.needsUpdate = true;
        beltPreviewVisible.value = true;
        beltStraightLineVisible.value = false;
    };

    const updateBeltPreview = (p0: { x: number; y: number }, e: MouseEvent) => {
        if (
            b.value === null ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null ||
            beltArea === null
        )
            return;
        const target = placementTargetAt(e, true);
        if (target === null) return;
        // 终点换算到"本条带所在区域"的局部坐标（跨带时按物理经度搬过来，随后按带边界截断）
        const cur = convertLocal(
            { x: target.x, y: target.y },
            target.origin,
            beltArea.origin
        );
        const area = commandQueue.value?.data.areas[beltArea.areaIndex];
        const gridSize = areaGridSize(beltArea.origin.segment);
        const endPort = portEndAt(e);
        // straight 模式：矢量直线预览（沿球面采样，非阶梯状位图）
        if (beltPathMode === "straight") {
            const startPos = gridToWorld(p0, beltArea.origin);
            const endPos = gridToWorld(cur, beltArea.origin);
            if (startPos && endPos) {
                const dist = startPos.distanceTo(endPos);
                const segments = Math.min(
                    128,
                    Math.max(2, Math.ceil(dist * 2))
                );
                const positions = new Float32Array((segments + 1) * 3);
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const p = startPos
                        .clone()
                        .lerp(endPos, t)
                        .normalize()
                        .multiplyScalar(R + 0.05);
                    positions[i * 3] = p.x;
                    positions[i * 3 + 1] = p.y;
                    positions[i * 3 + 2] = p.z;
                }
                beltStraightLine.geometry.setAttribute(
                    "position",
                    new Float32BufferAttribute(positions, 3)
                );
                beltStraightLine.geometry.computeBoundingSphere();
                beltStraightLineVisible.value = true;
            }
            beltPreviewMesh.count = 0;
            beltPreviewVisible.value = false;
            return;
        }

        // latFirst / lonFirst：阶梯状传送带方块预览（复用与落位同一套路径构造，
        // 起点/终点接建筑口时预览也会贴到口上）
        const previewBelts = clipBeltPath(
            buildBeltLine(
                placement.selectedItemId,
                placement.selectedModelIndex,
                p0,
                cur,
                placement.yaw,
                beltPathMode,
                beltStartPort,
                endPort,
                gridSize
            ),
            area
        );
        const n = Math.min(previewBelts.length, BELT_PREVIEW_CAP);
        for (let i = 0; i < n; i++) {
            const t = calcBuildingTrans(
                R,
                syntheticPos(beltArea.origin),
                previewBelts[i]
            )[0];
            beltPreviewM.multiplyMatrices(t, beltLift);
            beltPreviewMesh.setMatrixAt(i, beltPreviewM);
        }
        beltPreviewMesh.count = n;
        beltPreviewMesh.instanceMatrix.needsUpdate = true;
        beltPreviewVisible.value = n > 0;
        beltStraightLineVisible.value = false;
    };
    // 切换传送带路径走法（在 onMounted 内定义，可访问 lastPointer / updateBeltPreview）
    cycleBeltPathModeFn.value = () => {
        const i = BELT_PATH_MODES.indexOf(beltPathMode);
        beltPathMode = BELT_PATH_MODES[(i + 1) % BELT_PATH_MODES.length];
        if (beltStart !== null && lastPointer.value)
            updateBeltPreview(beltStart, lastPointer.value);
        return beltPathMode;
    };
    /** 点击 B 点：提交整条传送带（一次撤销）。仅在放置成功后清空 A 点。 */
    const commitBeltLine = (e: PointerCoords) => {
        const queue = commandQueue.value;
        const start = beltStart;
        const belt = beltArea;
        if (
            !queue ||
            !start ||
            belt === null ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        )
            return;
        const area = queue.data.areas[belt.areaIndex];
        if (area === undefined) return;
        // 建筑口必须属于本条带所在区域（一条带 = 一个区域，跨区域的口无法用单条带表示）
        const endPortRaw = portEndAt(e);
        const endPort =
            endPortRaw !== null && endPortRaw.building.areaIndex === belt.areaIndex
                ? endPortRaw
                : null;
        const target = placementTargetAt(e, true);
        const end = endPort
            ? { x: Math.round(endPort.point.x), y: Math.round(endPort.point.y) }
            : target === null
            ? null
            : convertLocal(
                  { x: target.x, y: target.y },
                  target.origin,
                  belt.origin
              );
        if (end === null) return;
        const startPort =
            beltStartPort !== null &&
            beltStartPort.building.areaIndex === belt.areaIndex
                ? beltStartPort
                : null;
        const gridSize = areaGridSize(belt.origin.segment);
        const belts = clipBeltPath(
            buildBeltLine(
                placement.selectedItemId,
                placement.selectedModelIndex,
                start,
                end,
                placement.yaw,
                beltPathMode,
                startPort,
                endPort,
                gridSize
            ),
            area
        );
        if (belts.length === 0) return;
        beltStart = null;
        beltStartPort = null;
        beltArea = null;
        hideBeltPreview();
        try {
            queue.push(
                new CreateBeltLineCommand(
                    belts,
                    startPort,
                    endPort,
                    belt.areaIndex,
                    gridSize
                )
            );
        } catch {
            // 纬度带外 / 区域不存在 — ignore
        }
    };
    /**
     * 传送带只能落在**一条纬度带**里（一个建筑只有一个 `areaIndex`）：
     * 路径越出该带的行范围就在边界处截断，与"格已被占用"同样处理，老线路不受影响。
     */
    const clipBeltPath = (
        belts: BlueprintBuilding[],
        area: { size: { x: number; y: number } } | undefined
    ): BlueprintBuilding[] => {
        if (area === undefined) return belts;
        const out: BlueprintBuilding[] = [];
        for (const b of belts) {
            const y = b.localOffset[0].y;
            if (y < 0 || y >= area.size.y) break;
            out.push(b);
        }
        return out;
    };
    /** 分拣器两点架接：支持建筑↔建筑、建筑↔皮带、皮带↔皮带 */
    const pickSorterPoint = (e: PointerCoords) => {
        const queue = commandQueue.value;
        if (!queue) return;
        const index = pickBuilding(e);
        const anchor =
            index === null
                ? undefined
                : anchorOffset(e, queue.data.buildings[index].areaIndex) ??
                  undefined;
        if (sorterSource.value === null) {
            if (index !== null) {
                sorterSource.value = index;
                sorterSourceAnchor = anchor ?? null;
            }
            return;
        }
        const src = sorterSource.value;
        sorterSource.value = null;
        if (
            index === null ||
            index === src ||
            placement.selectedItemId === null ||
            placement.selectedModelIndex === null
        )
            return;
        const srcBuilding = queue.data.buildings[src];
        const dstBuilding = queue.data.buildings[index];
        // 分拣器只有一个 areaIndex：两端必须落在同一条带（跨带无法用单条分拣器表示）
        if (srcBuilding.areaIndex !== dstBuilding.areaIndex) return;
        // 允许任意两端组合：建筑↔建筑、建筑↔皮带、皮带↔皮带
        // 传入 buildings 以检测 slot / offset / 分流器口占用
        // 传入两端点击锚点 以按点击所在的列/行选择 slot（与游戏光标行为一致）
        const sorter = createSorterBetween(
            srcBuilding,
            dstBuilding,
            placement.selectedItemId,
            placement.selectedModelIndex,
            queue.data.buildings,
            { src: sorterSourceAnchor ?? undefined, dst: anchor }
        );
        sorterSourceAnchor = null;
        if (sorter) {
            sorter.areaIndex = srcBuilding.areaIndex;
            queue.push(
                new CreateBuildingCommand(sorter, srcBuilding.areaIndex)
            );
        }
    };
    const onMouseUp = (e: MouseEvent) => {
        if (downPos === null) return;
        // 右键在 contextmenu 里处理（取消 A 点），不能被当成 B 点确认；
        // Windows 上 contextmenu 在 mouseup 之后才触发，不在这里拦掉会先落一条带
        if (e.button !== 0) {
            downPos = null;
            return;
        }
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        const isDrag = dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD;
        // 传送带：拖拽（旋转地图）时不处理；非拖拽点击在 A/B 状态间切换
        if (isPlacingBelt() && !isDrag) {
            if (beltStart === null) {
                // 第一次点击：设为 A 点；落在建筑口上则记下"取出"端点。
                // A 点同时决定整条带所属的区域：口 → 该建筑的区域；空格 → 所在纬度带的区域
                const queue = commandQueue.value;
                const port = portEndAt(e);
                if (queue === null) return;
                if (port !== null) {
                    beltArea = {
                        areaIndex: port.building.areaIndex,
                        origin: b.value!.pos.areas[port.building.areaIndex],
                    };
                    beltStart = {
                        x: Math.round(port.point.x),
                        y: Math.round(port.point.y),
                    };
                } else {
                    const target = placementTargetAt(e, true);
                    if (target === null) return;
                    const areaIndex = materializeTarget(target);
                    if (areaIndex < 0) return;
                    beltArea = { areaIndex, origin: target.origin };
                    beltStart = { x: target.x, y: target.y };
                }
                beltStartPort = port;
            } else commitBeltLine(e); // 第二次点击：A→B 放置
        }
    };
    const onPointerMove = (e: PointerCoords) => {
        lastPointer.value = { clientX: e.clientX, clientY: e.clientY };
        if (placement.mode === "reforming") {
            updateReformCursor(e);
        } else if (isPlacingBelt()) {
            if (beltStart !== null) updateBeltPreview(beltStart, e);
            else showSingleBeltPreview(e);
        } else {
            updatePreview(e);
        }
        // 架接（分拣器）/ 铺带（传送带）模式：追踪悬停建筑与悬停锚点，
        // 驱动 分拣器口（圆点）/ 传送带口（方块）/ 范围条 / 预览连线 覆盖层
        if (isPlacingSorter() || isPlacingBelt()) {
            const hit = pickBuildingHit(e);
            sorterHover.value = hit === null ? null : hit.index;
            sorterHoverZ.value = hit === null ? 0 : hit.z;
            const queue = commandQueue.value;
            const hoverBuilding =
                hit === null || queue === null
                    ? undefined
                    : queue.data.buildings[hit.index];
            // 锚点必须用**建筑自己所在区域**的坐标空间（不同纬度带的局部格互不相通）
            sorterHoverAnchor.value =
                hoverBuilding === undefined
                    ? null
                    : anchorOffset(e, hoverBuilding.areaIndex) ?? null;
        }
    };
    const onMouseLeave = () => {
        lastPointer.value = null;
        previewVisible.value = false;
        reformCursorVisible.value = false;
        sorterHover.value = null;
        sorterHoverAnchor.value = null;
        sorterHoverZ.value = 0;
        hideBeltPreview(); // 隐藏路径预览，但保留 A 点
    };
    // 鼠标静止时，键盘切换建筑 / R 旋转 / Shift 吸附变化也要刷新预览
    // 依赖由 lastPointer.value 与 update* 内部读到的 placement 字段共同收集，
    // 任意一个变化（含 R 键改 placement.yaw / 切分流器形态）都会让本 effect 重跑。
    watchEffect(() => {
        const p = lastPointer.value;
        if (!p) return;
        if (placement.mode === "reforming") {
            updateReformCursor(p);
        } else if (isPlacingBelt()) {
            if (beltStart !== null) updateBeltPreview(beltStart, p);
            else showSingleBeltPreview(p);
        } else {
            updatePreview(p);
        }
    });
    /** Delete building at clicked position */
    const deleteBuilding = (e: PointerCoords) => {
        const index = pickBuilding(e);
        if (index === null) return;
        const queue = commandQueue.value;
        if (!queue) return;
        queue.push(new RemoveBuildingCommand(index, queue.data));
        emit("update:selectedBuildingIndex", null);
    };

    // Drag threshold: distinguish click from drag.
    // Listen on rootEl (parent div) — events bubble from canvas, unaffected by
    // PlanetMapControls' setPointerCapture which only captures pointer events.
    const DRAG_THRESHOLD = 4;
    let downPos: { x: number; y: number } | null = null;
    const onMouseDown = (e: PointerCoords) => {
        downPos = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: PointerCoords) => {
        if (downPos === null) return;
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        downPos = null;
        // 传送带在 mouseup 中处理 A/B 点击状态机，click 忽略
        if (isPlacingBelt()) return;
        if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) return; // was a drag, not a click
        // Left click: place / delete / reform / select
        if (placement.mode === "placing") {
            if (isPlacingSorter()) pickSorterPoint(e);
            else placeBuilding(e);
        } else if (placement.mode === "deleting") deleteBuilding(e);
        else if (placement.mode === "reforming") paintReformCell(e);
        else {
            const index = pickBuilding(e);
            if (index === null) emit("clickEmpty");
            emit("update:selectedBuildingIndex", index);
        }
    };
    const onContextMenu = (e: MouseEvent) => {
        // Right click: exit placement/deleting mode (PlanetMapControls already
        // preventDefault on canvas; this fires via bubbling)
        // 预览模式：右键直接删除鼠标所指建筑
        if (placement.appMode === "preview") {
            e.preventDefault();
            deleteBuilding(e); // 内部已 emit(selectedBuildingIndex, null)
            return;
        }
        // 传送带已设 A 点：右键取消 A 点选择，不退出放置模式
        if (isPlacingBelt() && beltStart !== null) {
            e.preventDefault();
            beltStart = null;
            beltStartPort = null;
            beltArea = null;
            hideBeltPreview();
            // 回退到"未选 A 点"的光标状态：光标处重新显示单个传送带方块
            if (lastPointer.value) showSingleBeltPreview(lastPointer.value);
            return;
        }
        // 分拣器已设 A 点（源建筑）：右键取消 A 点选择，不退出放置模式
        if (isPlacingSorter() && sorterSource.value !== null) {
            e.preventDefault();
            sorterSource.value = null;
            sorterSourceAnchor = null;
            return;
        }
        // 编辑模式：原行为 —— 退出 placing/deleting
        if (placement.mode !== "idle") {
            e.preventDefault();
            resetToIdle();
        }
    };
    rootEl.addEventListener("mousedown", onMouseDown);
    rootEl.addEventListener("mouseup", onMouseUp);
    rootEl.addEventListener("click", onClick);
    rootEl.addEventListener("contextmenu", onContextMenu);
    rootEl.addEventListener("pointermove", onPointerMove);
    rootEl.addEventListener("mouseleave", onMouseLeave);
    onUnmounted(() => {
        rootEl.removeEventListener("mousedown", onMouseDown);
        rootEl.removeEventListener("mouseup", onMouseUp);
        rootEl.removeEventListener("click", onClick);
        rootEl.removeEventListener("contextmenu", onContextMenu);
        rootEl.removeEventListener("pointermove", onPointerMove);
        rootEl.removeEventListener("mouseleave", onMouseLeave);
    });

    let mounted = true;
    onUnmounted(() => {
        mounted = false;
    });
    let lastTimeStamp: number | null = null;
    function animate(time: number) {
        if (!mounted) return;
        if (lastTimeStamp) {
            c.updateTimeDelta((time - lastTimeStamp) / 1000);
        }
        if (b.value?.buildings.cargos) {
            const move = (time % 1000) / 1000;
            for (const c of b.value.buildings.cargos) c.cargoMove = move;
        }
        lastTimeStamp = time;
        requestAnimationFrame(animate);
        const cameraUpdated = c.update();
        dirLight.position.copy(camera.position);
        renderer.render(scene, camera);
        if (cameraUpdated) {
            cameraPosVersion.value++;
        }
    }
    requestAnimationFrame(animate);
});

const selectBoxes = computed(() => b.value?.bvh.boxes);
const cameraPosVersion = ref(0);
const getModel = (index: number) => {
    if (b.value === null) return null;
    const ref = b.value.buildings.modelRef[index];
    const m = new Matrix4();
    ref.mesh.getMatrixAt(ref.instance, m);
    return m;
};
/** 重置相机视角到默认位置（星球正上方默认距离） */
const resetCamera = () => {
    controls?.reset(2 * R);
};
defineExpose({
    selectBoxes,
    camera,
    cameraPosVersion,
    getModel,
    resetCamera,
    cycleBeltPathMode: () => cycleBeltPathModeFn.value?.(),
});
</script>

<style lang="scss">
.editor-root {
    width: 100%;
    height: 100%;
}
</style>
