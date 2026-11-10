<template>
    <div class="editor-root" ref="root" tabindex="-1"></div>
</template>

<script lang="ts">
/**
 * 蓝图编辑器。
 *
 * 渲染构建（场景装配、GLB/白模、图标、货物、下标、BVH）已下沉到 `src/lib/core/`，
 * 与 `BlueprintViewer` 共用同一套实现（见 docs/BlueprintViewer-实施计划.md 阶段 A）。
 * 本文件只保留 Vue 交互：放置 / 删除 / 预览 / 选中 / 快捷键 / 侧栏联动。
 */
import { BeltParameters } from "@/blueprint/parser";
import { calcBuildingTrans, PositionedBlueprint } from "@/blueprint/planet";
import { Vector3 } from "three";
import { itemIconId } from "@/data/icons";
import { Updater } from "@/command";
import { PLANET_RADIUS } from "@/planetConstants";
import { AllBuildings } from "@/lib/core/AllBuildings";
import {
    buildingIconId,
    beltIconPos,
    beltIconScale,
    sorterIconPos,
    sorterIconScale,
} from "@/lib/core/iconHelpers";

/**
 * 注册编辑器的增量刷新回调（图标 / 下标局部更新）。
 *
 * **留在 Vue 层**（方案 §5 第 7 行）：它依赖 `Updater`（`@/command`，import vue），
 * 放进 `lib/core` 会破坏「core 不依赖 Vue」的约束。core 只提供 `AllBuildings`
 * 的公开面（`icons` / `iconTexture` / `subscriptMesh` / `subscriptMap`）。
 */
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
            const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
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
        const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
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
            const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
            sorterIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, sorterIconScale, true);
        }
    });

    // updateStationInfo：当前物流塔面板自己响应式刷新即可；
    // 若未来要按库存首物品染色，在这里改颜色 attribute。
}
</script>

<script setup lang="ts">
import {
    ref,
    onMounted,
    Ref,
    onUnmounted,
    watchEffect,
    computed,
    inject,
} from "vue";
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Matrix4,
    Ray,
    Sphere,
    Mesh,
    BoxGeometry,
    MeshStandardMaterial,
} from "three";
import { RemoveBuildingCommand } from "@/blueprint/removeBuilding";
import { commandQueueKey } from "@/define";
import { findPosForAreas } from "@/blueprint/planet";
import { buildReforms } from "@/blueprint/reform";
import { onBuildingModelsChanged } from "@/models/buildingModel";
import { PlanetMapControls } from "@/PlanetMapControls";
import { createSkyGradient } from "@/skyGradient";
import { attachCamera, attachRenderer } from "@/utils";
import {
    createNeutralEnvironment,
    setBuildingEnvironment,
} from "@/models/envMap";
import { setTextureMaxAnisotropy } from "@/models/textureMaps";
import { setKtx2Renderer } from "@/models/ktx2";
import { getAppliedRenderSettings } from "@/renderSettings";
import { setSettingsProvider } from "@/models/glbLoader";
import { IconTexture } from "@/iconTexture";
import { PLANET_SEGMENT } from "@/planetConstants";
import { buildBuildings } from "@/lib/core/buildBuildings";
import { buildBVH } from "@/lib/core/buildBVH";
import { createPlanetScene } from "@/lib/core/planetScene";
import type { BuildBuildingsResult } from "@/lib/core/buildBuildings";
import type { BuildingModelRef } from "@/lib/core/types";

// 加载器需要在「GLB 到达」与「设置变更重挂贴图」时读取当前贴图设置。
// 注入 reactive 单例的读取函数，保持设置面板的响应式驱动（方案 D2）。
setSettingsProvider(() => getAppliedRenderSettings());

const props = defineProps<{
    selectedBuildingIndex: number | null;
}>();

const emit = defineEmits<{
    (e: "update:selectedBuildingIndex", index: number | null): void;
}>();

const scene = new Scene();
const planetScene = createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT);
const dirLight = planetScene.dirLight;
scene.add(planetScene.root);

const root: Ref<HTMLDivElement | null> = ref(null);
const renderer = new WebGLRenderer({ antialias: true });
attachRenderer(root, renderer);

// 建筑材质：贴图各向异性过滤 + 程序化中性环境反射。
// 环境反射只挂到建筑材质（material.envMap），不设 scene.environment，
// 免得行星本体、网格线跟着泛白。
setTextureMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
// KTX2 转码目标要按当前 GPU 能力挑（ASTC / ETC2 / BC7 / PVRTC），
// 所以必须把渲染器交给 ktx2 模块，GLTFLoader 解析 GLB 时才有转码器可用。
setKtx2Renderer(renderer);
setBuildingEnvironment(createNeutralEnvironment(renderer));

const camera = new PerspectiveCamera(50);
// near 保持 0.5：相机最低离地 1.5（PlanetMapControls.minHeight），最近可见面约 1.5，
// 再往小会让 24 位深度缓冲在 z≈200 处的精度掉到 0.015 的地基抬升量以下，地基会闪
camera.near = 0.5;
camera.far = 3000;
camera.position.z = 2 * PLANET_RADIUS;
attachCamera(root, camera);

// 天光/星空背景：平视时地平线上一条大气雾带 + 头顶星空；拉远时星球带一圈大气边缘光
const sky = createSkyGradient({ planetRadius: PLANET_RADIUS });
scene.add(sky.mesh);
onUnmounted(() => {
    scene.remove(sky.mesh);
    sky.dispose();
});

const commandQueue = inject(commandQueueKey)!;

let controls: PlanetMapControls | null = null;

/** 外部 GLB 模型到达时自增，触发场景按“GLB 优先”重建 */
const modelVersion = ref(0);

/**
 * 图标图集跨重建复用：每次重建都 new 一个会重新分配 1920×1920 纹理，
 * 并重发全部图标请求（方案 §5 第 9 行的配套修正）。
 */
const editorIconTexture = new IconTexture(renderer);
onUnmounted(() => editorIconTexture.dispose());

const b = computed(() => {
    // 任意命令（剔除建筑 / 撤销 / 重做）后整体重建场景
    commandQueue.value?.execVersion.value;
    // 外部 GLB 模型加载完成 → 重建场景，让新模型接管渲染（旧场景由下面的 watchEffect 回收）
    modelVersion.value;
    if (!commandQueue.value) return null;
    const d = commandQueue.value.data;
    const pos = findPosForAreas(d.areas, PLANET_SEGMENT);
    const transforms = d.buildings.map((building) =>
        calcBuildingTrans(PLANET_RADIUS, pos, building)
    );
    const applied = getAppliedRenderSettings();
    const built: BuildBuildingsResult = buildBuildings(
        transforms,
        d.buildings,
        {
            settings: applied,
            textureSink: renderer,
            iconTexture: editorIconTexture,
            textureSettings: applied,
        }
    );
    const { bvh } = buildBVH(transforms, d.buildings);
    const reforms = buildReforms(PLANET_RADIUS, pos, d.reformData);
    registerUpdater(commandQueue.value.updater, built.buildings, pos);
    return { buildings: built.buildings, bvh, reforms };
});

watchEffect((onCleanUp) => {
    if (b.value !== null) {
        const buildings = b.value.buildings;
        const reforms = b.value.reforms;
        scene.add(buildings);
        if (reforms) scene.add(reforms);
        onCleanUp(() => {
            scene.remove(buildings);
            buildings.dispose();
            if (reforms) scene.remove(reforms);
        });
    }
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

/** 入场仰角：85° ≈ 俯瞰（旧版的「正上方地图」视角） */
const HOME_TILT = (85 * Math.PI) / 180;

/**
 * 按当前场景算出入场姿态并回到它。
 *
 * 锚点 = 所有建筑的世界坐标质心对应的球面点，距离按图纸外接圆半径给，
 * 朝向取「垂直于图纸长边的切向」，这样打开蓝图时图纸长边横在屏幕水平方向。
 */
const applyHome = () => {
    const c = controls;
    if (c === null) return;

    let distance = 150;
    const boxes = b.value?.bvh.boxes;
    if (boxes !== undefined && boxes.length > 0) {
        // 质心
        let cx = 0,
            cy = 0,
            cz = 0;
        for (const m of boxes) {
            const e = m.elements;
            cx += e[12];
            cy += e[13];
            cz += e[14];
        }
        const n = boxes.length;
        cx /= n;
        cy /= n;
        cz /= n;
        const length = Math.hypot(cx, cy, cz);
        if (length > 1e-6) {
            // 锚点：球面法线
            const nx = cx / length,
                ny = cy / length,
                nz = cz / length;
            // 切平面基：e1 取 +Z 在切平面上的投影（退化成 +X）
            let e1x = -nz * nx,
                e1y = -nz * ny,
                e1z = 1 - nz * nz;
            if (e1x * e1x + e1y * e1y + e1z * e1z < 1e-6) {
                e1x = 1 - nx * nx;
                e1y = -nx * ny;
                e1z = -nx * nz;
            }
            const e1Len = Math.hypot(e1x, e1y, e1z);
            e1x /= e1Len;
            e1y /= e1Len;
            e1z /= e1Len;
            // e2 = n × e1
            const e2x = ny * e1z - nz * e1y;
            const e2y = nz * e1x - nx * e1z;
            const e2z = nx * e1y - ny * e1x;
            // 在切平面上量一下图纸的延展
            let min1 = Infinity,
                max1 = -Infinity,
                min2 = Infinity,
                max2 = -Infinity;
            for (const m of boxes) {
                const e = m.elements;
                const px = e[12] - cx,
                    py = e[13] - cy,
                    pz = e[14] - cz;
                const a = px * e1x + py * e1y + pz * e1z;
                const b2 = px * e2x + py * e2y + pz * e2z;
                min1 = Math.min(min1, a);
                max1 = Math.max(max1, a);
                min2 = Math.min(min2, b2);
                max2 = Math.max(max2, b2);
            }
            const extent1 = max1 - min1;
            const extent2 = max2 - min2;
            // 相机站在「垂直于长边」的方向上，长边自然横在屏幕水平方向
            const long = extent1 >= extent2;
            c.anchor.set(nx, ny, nz);
            if (long) c.viewDir.set(e2x, e2y, e2z);
            else c.viewDir.set(e1x, e1y, e1z);
            // 外接圆半径 → 视野刚好兜住图纸的距离
            distance = Math.max(40, 0.5 * Math.hypot(extent1, extent2) * 2.4);
        }
    }

    c.setHome(c.anchor, c.viewDir, HOME_TILT, distance);
    c.reset();
};

onMounted(() => {
    const rootEl = root.value!;

    // 星球地图相机：锚点在球面上，可自由俯仰（0 = 平视，85° = 俯瞰）
    controls = new PlanetMapControls(camera, renderer.domElement);
    const c = controls;
    c.listenToKeyEvents(rootEl);
    c.planetRadius = PLANET_RADIUS;
    c.minDistance = 3;
    c.maxDistance = 1200;
    c.minHeight = 1.5;
    c.minTilt = 0;
    c.maxTilt = (85 * Math.PI) / 180;
    c.tilt = (85 * Math.PI) / 180;
    c.distance = 150;
    onUnmounted(() => c.dispose());
    c.update();
    // 有蓝图就锚到图纸质心，没有就停在「+Z 正上方俯瞰」的默认位置
    applyHome();

    const ray = new Ray();
    const planetSphere = new Sphere(new Vector3(), PLANET_RADIUS);
    const v = new Vector3();
    const pickBuilding = (e: MouseEvent) => {
        if (b.value === null) return null;
        ray.origin.setFromMatrixPosition(camera.matrixWorld);
        const rect = renderer.domElement.getBoundingClientRect();
        ray.direction.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ray.direction.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.direction.z = 0.5;
        ray.direction.unproject(camera).sub(ray.origin).normalize();
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
    // 右键点击剔除建筑 / 左键点击选中：记录按下位置，避免把拖拽误判为点击
    let rightDownPos: { x: number; y: number } | null = null;
    let leftDownPos: { x: number; y: number } | null = null;

    const onClick = (e: MouseEvent) => {
        // 左键拖拽现在是平移，拖过阈值的一次松开不算「点击选中」
        if (
            leftDownPos !== null &&
            Math.hypot(e.clientX - leftDownPos.x, e.clientY - leftDownPos.y) > 6
        )
            return;
        emit("update:selectedBuildingIndex", pickBuilding(e));
    };
    renderer.domElement.addEventListener("click", onClick);
    onUnmounted(() =>
        renderer.domElement.removeEventListener("click", onClick)
    );

    const onMouseDown = (e: MouseEvent) => {
        if (e.button === 2) rightDownPos = { x: e.clientX, y: e.clientY };
        else if (e.button === 0) leftDownPos = { x: e.clientX, y: e.clientY };
    };
    const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        if (
            rightDownPos !== null &&
            Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y) >
                6
        )
            return;
        const index = pickBuilding(e);
        if (index === null) return;
        const queue = commandQueue.value;
        if (!queue) return;
        queue.push(new RemoveBuildingCommand(index, queue.data));
        emit("update:selectedBuildingIndex", null);
    };
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    onUnmounted(() =>
        renderer.domElement.removeEventListener("mousedown", onMouseDown)
    );
    onUnmounted(() =>
        renderer.domElement.removeEventListener("contextmenu", onContextMenu)
    );

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
        // 货物位移与条带箭头共用一个 0..1 相位；没有条带时 belts 为 null，必须判空
        const built = b.value?.buildings;
        if (built !== undefined) {
            const cargoMove = (time % 1000) / 1000;
            built.cargos.cargoMove = cargoMove;
            if (built.belts !== null) built.belts.cargoMove = cargoMove;
            // 没有分拣器时 inserters 为 null，必须判空
            if (built.inserters !== null) built.inserters.cargoMove = cargoMove;
        }
        lastTimeStamp = time;
        requestAnimationFrame(animate);
        const cameraUpdated = c.update();
        dirLight.position.copy(camera.position);
        // 网格 LOD：按相机到球心的距离切换细线可见性
        planetScene.updateGridLOD(camera.position.length());
        renderer.render(scene, camera);
        if (cameraUpdated) {
            cameraPosVersion.value++;
        }
    }
    requestAnimationFrame(animate);

    // 外部 GLB 模型到达：合并成一次重建，避免几十个模型各触发一次整场景重建
    let modelRefreshTimer: number | null = null;
    const offModelsChanged = onBuildingModelsChanged(() => {
        if (modelRefreshTimer !== null) return;
        modelRefreshTimer = window.setTimeout(() => {
            modelRefreshTimer = null;
            modelVersion.value++;
        }, 150);
    });
    onUnmounted(() => {
        offModelsChanged();
        if (modelRefreshTimer !== null) {
            window.clearTimeout(modelRefreshTimer);
            modelRefreshTimer = null;
        }
    });
});

const selectBoxes = computed(() => b.value?.bvh.boxes);
const cameraPosVersion = ref(0);
const getModel = (index: number) => {
    if (b.value === null) return null;
    const ref = b.value.buildings.modelRef[index] as
        | BuildingModelRef
        | undefined;
    if (ref === undefined) return null;
    if ("mesh" in ref) {
        const m = new Matrix4();
        ref.mesh.getMatrixAt(ref.instance, m);
        return m;
    }
    return ref.matrix;
};
/** 重置相机视角到入场姿态（俯瞰 + 锚在图纸质心） */
const resetCamera = () => {
    applyHome();
};
defineExpose({
    selectBoxes,
    camera,
    cameraPosVersion,
    getModel,
    resetCamera,
});
</script>

<style lang="scss">
.editor-root {
    width: 100%;
    height: 100%;
}
</style>
