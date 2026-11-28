<template>
    <div class="editor-root" ref="root" tabindex="-1">
        <!-- 放置/铺带失败提示：编辑交互层唯一的文字反馈，不改变 App.vue 的状态 -->
        <div v-if="hint !== ''" class="editor-hint">{{ hint }}</div>
        <!-- 建造高度/倾斜度提示：铺传送带时跟随鼠标，挂在光标左下角
             （与游戏内"建造高度:N层"+"倾斜度:A → B"一致，无值时对应行隐藏） -->
        <div
            v-if="beltTipVisible"
            class="belt-z-tip"
            :style="{ left: beltTipPos.x + 'px', top: beltTipPos.y + 'px' }"
        >
            <div v-if="beltTipHeightVisible">建造高度:{{ beltTipLayer }}</div>
            <div v-if="beltTipTiltVisible">
                倾斜度:{{ beltTipStartTilt }} → {{ beltTipEndTilt }}
            </div>
        </div>
    </div>
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
import { calcBuildingTrans, PositionedBlueprint } from "@/planet/planet";
import { Vector3 } from "three";
import { itemIconId } from "@/data/icons";
import { Updater } from "@/render/command";
import { PLANET_RADIUS } from "@/planet/planetConstants";
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
    shallowRef,
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
    Quaternion,
    Ray,
    Sphere,
    Mesh,
    BoxGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial,
    InstancedMesh,
    Color,
    Path,
    Shape,
    ShapeGeometry,
    PlaneGeometry,
    SphereGeometry,
    DoubleSide,
    BufferGeometry,
} from "three";
import { RemoveBuildingCommand } from "@/blueprint/removeBuilding";
import { commandQueueKey } from "@/define";
import { findPosForAreas } from "@/planet/planet";
import { buildReforms } from "@/blueprint/reform";
import { onBuildingModelsChanged } from "@/models/buildingModel";
import { PlanetMapControls } from "@/planet/PlanetMapControls";
import { createSkyGradient } from "@/planet/skyGradient";
import { attachCamera, attachRenderer } from "@/utils";
import {
    createNeutralEnvironment,
    setBuildingEnvironment,
} from "@/models/envMap";
import { setTextureMaxAnisotropy } from "@/models/textureMaps";
import { setKtx2Renderer } from "@/models/ktx2";
import { getAppliedRenderSettings } from "@/render/renderSettings";
import { setSettingsProvider } from "@/models/glbLoader";
import { IconTexture } from "@/icon/iconTexture";
import {
    HEIGHT_GRID_SIZE,
    GRID_PER_SEGMENT,
    PLANET_SEGMENT,
} from "@/planet/planetConstants";
import { buildBuildings } from "@/lib/core/buildBuildings";
import { buildBVH } from "@/lib/core/buildBVH";
import { createPlanetScene } from "@/planet/planetScene";
import type { BuildBuildingsResult } from "@/lib/core/buildBuildings";
import type { BuildingModelRef } from "@/lib/core/types";
import type { BlueprintBuilding } from "@/blueprint/parser";

// ---- 编辑交互层（从 editing_mode 移植，坐标/构造全部走新架构的库）----
import {
    usePlacement,
    resetToIdle,
    setBeltZ,
    setBeltTilt,
} from "@/editor/placementState";
import {
    ROOT_GRID_SIZE,
    areaGridSize,
    canvasTargetAt,
    materializeCanvasTarget,
    planetToLocal,
} from "@/blueprint/globe";
import type { AreaGridOrigin, CanvasTarget } from "@/blueprint/globe";
import { createBuilding, CreateBuildingCommand } from "@/blueprint/create";
import {
    buildBeltLine,
    collectBeltChain,
    CreateBeltLineCommand,
    InsertBeltLineCommand,
} from "@/blueprint/beltLine";
import type { BeltPathMode, BeltPortEnd } from "@/blueprint/beltLine";
import {
    getBeltPorts,
    hasBeltPorts,
    pickBeltPort,
    portWorldNormal,
    portWorldOffset,
} from "@/data/beltPorts";
import type { BeltPort } from "@/data/beltPorts";
import {
    createSorterBetween,
    collectOccupiedSlots,
} from "@/blueprint/sorter";
import { SorterGhost } from "@/editor/sorterGhost";
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
import { buildingMeta } from "@/data/building";
import { isBelt, isInserter } from "@/data/items";

// 加载器需要在「GLB 到达」与「设置变更重挂贴图」时读取当前贴图设置。
// 注入 reactive 单例的读取函数，保持设置面板的响应式驱动（方案 D2）。
setSettingsProvider(() => getAppliedRenderSettings());

const props = defineProps<{
    selectedBuildingIndex: number | null;
}>();

const emit = defineEmits<{
    (e: "update:selectedBuildingIndex", index: number | null): void;
    // App.vue：`@click-empty="palette?.collapse()"`。左键点在空白处（非放置态）时发。
    (e: "clickEmpty"): void;
}>();

/**
 * 只需要屏幕坐标的事件最小结构：MouseEvent / PointerEvent 均可赋值，
 * 也让"鼠标静止时用最后一次坐标重算预览"可以直接传一个普通对象。
 */
type PointerCoords = { clientX: number; clientY: number };

/** 编辑模式状态（放置/删除/地基 + 朝向/吸附），与 App.vue 共用同一个 reactive 单例 */
const placement = usePlacement();

const scene = new Scene();
const planetScene = createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT);
const dirLight = planetScene.dirLight;
scene.add(planetScene.root);

// 网格线随编辑状态变色：预览原色 / 放置绿 / 删除红 / 地基蓝。
// 粗线与细线取同一个颜色，细线仍保持自己的半透明（见 `createPlanetScene`）。
watchEffect(() => {
    let color = 0xf0f0f0;
    if (placement.appMode === "edit") {
        if (placement.mode === "deleting") color = 0xff5050;
        else if (placement.mode === "reforming") color = 0x40a0ff;
        else color = 0x50fa50;
    }
    planetScene.gridMaterial.color.setHex(color);
    planetScene.fineGridMaterial?.color.setHex(color);
});

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
    // 区域定位：渲染与编辑交互（放置幽灵、铺带、架接、地基）共用这一份，
    // 保证预览、落位与真实模型逐格一致（见 `@/blueprint/globe` 的全球画布）。
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
    return { buildings: built.buildings, bvh, reforms, pos };
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

// =============================================================================================
// 编辑交互层
//
// 以下全部是 editing_mode 分支的 3D 编辑交互，已适配 growingTree 的渲染骨架：
// 世界矩阵一律用 `calcBuildingTrans(PLANET_RADIUS, b.value.pos, …)` 现算，
// 坐标空间一律走 `@/blueprint/globe` 的全球画布（一条纬度带一个区域）。
// =============================================================================================

/**
 * 放置/铺带失败提示：1.6 s 自动消失。
 * TODO(i18n)：交互层唯一的内联文案，后续应迁入 `src/locales/*.json`（本次只改本文件）。
 */
const hint = ref("");
let hintTimer: number | null = null;
function showHint(text: string) {
    hint.value = text;
    if (hintTimer !== null) window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
        hintTimer = null;
        hint.value = "";
    }, 1600);
}
onUnmounted(() => {
    if (hintTimer !== null) {
        window.clearTimeout(hintTimer);
        hintTimer = null;
    }
});

/** 放置幽灵：半透明绿盒，placing 时跟随鼠标吸附网格（单个 Mesh 复用） */
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
    // 传送带/分拣器有各自的预览层：切到它们时绿盒必须立即让位（否则会留下上一次的幽灵）
    const show =
        placement.appMode === "edit" &&
        placement.mode === "placing" &&
        !isPlacingBelt() &&
        !isPlacingSorter() &&
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

// ---- 建造高度提示（HTML 覆盖层）：铺传送带时挂在光标左下角 ----
// 游戏里地面层叫"1层"，beltZ=0 是地面层 → 显示 beltZ + 1。
// 可见性做成 computed（依赖 placement）：鼠标静止时用右键退出铺带模式也能立即消失，
// 不用等下一次 pointermove 才刷新。
const beltTipPos = ref({ x: 0, y: 0 });
const pointerInside = ref(false);

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
 * 起点高度（A 点按下时锁定）：起点绑口/压在已有带上时继承其高度，否则 = 当时的建造高度。
 * ↑/↓ 只改终点高度（`placement.beltZ`），起点与终点不同时由 `buildBeltLine` 自动生成坡度。
 */
let beltStartZ = 0;
/** A 点拧转角（按下时锁定）；未设 A 点时整条带使用 placement.beltTilt。 */
const beltStartTilt = ref(0);
/**
 * 是否已确定 A 点（仅用于提示文案的反应式刷新）。
 * 游戏里确定起点后才显示"建造高度"（地面层也显示 1 层），未确定 A 点时地面层不显示。
 */
const beltStartActive = ref(false);
/**
 * A 点来自已有传送带末格时记录其建筑下标（null = 空白网格/建筑口起点）。
 * 用 ref：高亮覆盖层的 watchEffect 要在"确认/取消 A 点"时立即重算，
 * 不能只依赖 beltHover（取消时它可能仍是 null，不会触发重跑）。
 * 提交时复用该末格（CreateBeltLineCommand 按格+高度层匹配）。
 */
const beltStartBuildingIndex = ref<number | null>(null);
/**
 * 本条拖拽传送带所属的区域（一条带一个区域）：A 点按下时确定，
 * 之后 B 点/预览都换算到这个区域的局部坐标，越出该带的部分按边界截断。
 */
let beltArea: { areaIndex: number; origin: AreaGridOrigin } | null = null;
const sorterSource = ref<number | null>(null);

// ---- 建造高度 / 倾斜度提示文案 ----
// 高度：非地面层，或已确定 A 点（图二）；倾斜：起始/目标任一非 0。
// 两项都无值时整个提示不出现（与游戏一致）。
const beltTipLayer = computed(() => `${placement.beltZ + 1}层`);
const beltTipHeightVisible = computed(
    () => placement.beltZ !== 0 || beltStartActive.value
);
const beltTipStartTiltValue = () =>
    beltStart === null ? 0 : beltStartTilt.value;
const beltTipTiltVisible = computed(
    () => beltTipStartTiltValue() !== 0 || placement.beltTilt !== 0
);
const formatBeltTilt = (tilt: number) => {
    // 继承自蓝图的 tilt 是 float32，显示前收敛到 0.1°，避免 12.30000019 这类尾巴
    const v = Math.round(tilt * 10) / 10;
    return `${v > 0 ? "+" : ""}${v}°`;
};
const beltTipStartTilt = computed(() =>
    formatBeltTilt(beltTipStartTiltValue())
);
const beltTipEndTilt = computed(() => formatBeltTilt(placement.beltTilt));
const beltTipVisible = computed(
    () =>
        pointerInside.value &&
        isPlacingBelt() &&
        (beltTipHeightVisible.value || beltTipTiltVisible.value)
);

// 传送带路径走法（R 键循环切换）：latFirst → lonFirst → straight → latFirst
// straight = 自由角度直线（端点吸整格，中间节点按直线等分，见 `@/blueprint/beltLine`）
let beltPathMode: BeltPathMode = "latFirst";
const BELT_PATH_MODES: BeltPathMode[] = ["latFirst", "lonFirst", "straight"];
// 实际切换函数在 onMounted 内部定义（需访问 lastPointer/updateBeltPreview），
// 此处用 ref 桥接供 defineExpose 调用
const cycleBeltPathModeFn = ref<(() => BeltPathMode) | null>(null);

// ---- 传送带预建样式：白色六边形节点 + 白色连线（参考游戏内建造预览） ----
/** 六边形路径，rotation = π/2 → 顶点朝 +y（yaw=0 时即传送带默认走向，节点随路径旋转） */
function hexagonPath<T extends Path>(path: T, radius: number): T {
    const rotation = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
        const a = rotation + (i * Math.PI) / 3;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
    }
    path.closePath();
    return path;
}

const BELT_HEX_R = 0.5; // 节点外接圆半径（世界单位，约 0.4 格）
const BELT_HEX_INNER = 0.36; // 空心环内半径（环宽 0.14）
const BELT_HEX_DOT = 0.14; // 中心实心点半径
const BELT_HEX_END_OUTER = 0.68; // 起止端外圈半径
const BELT_HEX_END_INNER = 0.59;
const BELT_LINK_WIDTH = 0.16; // 连线宽度
const BELT_LINK_THICK = 0.05;
const BELT_PREVIEW_LIFT = 0.05; // 与旧预览一致的贴地微抬

/** 单个节点：空心六边形环 + 中心实心六边形点 */
function makeBeltNodeGeometry(): BufferGeometry {
    const ring = hexagonPath(new Shape(), BELT_HEX_R);
    ring.holes.push(hexagonPath(new Path(), BELT_HEX_INNER));
    const dot = hexagonPath(new Shape(), BELT_HEX_DOT);
    return new ShapeGeometry([ring, dot]);
}
/** 起止端外圈（套在普通节点外面的大号空心六边形） */
function makeBeltEndGeometry(): BufferGeometry {
    const ring = hexagonPath(new Shape(), BELT_HEX_END_OUTER);
    ring.holes.push(hexagonPath(new Path(), BELT_HEX_END_INNER));
    return new ShapeGeometry(ring);
}

// 白色预览材质（节点/端圈/连线共用）
const beltPreviewMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.95,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
});

// 整条传送带的拖拽预览（复用实例网格，count 随路径变化）
const BELT_PREVIEW_CAP = 1024;
const beltPreviewMesh = new InstancedMesh(
    makeBeltNodeGeometry(),
    beltPreviewMaterial,
    BELT_PREVIEW_CAP
);
beltPreviewMesh.matrixAutoUpdate = false;
beltPreviewMesh.count = 0;
beltPreviewMesh.renderOrder = 9;
// InstancedMesh 的包围球只在首次渲染时计算一次，之后 setMatrixAt 不会让它失效；
// 相机拉近后视锥变窄，光标移出这个（过期的）包围球就会被整体剔除 → 光标消失。
// 预览始终贴着光标，直接关闭视锥剔除。
beltPreviewMesh.frustumCulled = false;

// 起止端的大号六边形外圈（最多首尾 2 个）
const beltEndMarkerMesh = new InstancedMesh(
    makeBeltEndGeometry(),
    beltPreviewMaterial,
    2
);
beltEndMarkerMesh.matrixAutoUpdate = false;
beltEndMarkerMesh.count = 0;
beltEndMarkerMesh.renderOrder = 9;
beltEndMarkerMesh.frustumCulled = false;

// 相邻节点之间的白色连线（单位长度盒，按两点距离沿 z 缩放）
const beltLinkMesh = new InstancedMesh(
    new BoxGeometry(BELT_LINK_WIDTH, BELT_LINK_THICK, 1),
    beltPreviewMaterial,
    BELT_PREVIEW_CAP
);
beltLinkMesh.matrixAutoUpdate = false;
beltLinkMesh.count = 0;
beltLinkMesh.renderOrder = 9;
beltLinkMesh.frustumCulled = false;

// ---- 高层传送带的垂直提示（仅预览层，不写入蓝图）----
// 每个节点向球面地面投一根白色细柱 + 地面小六边形落点；高度 z=0 时不显示。
const BELT_GUIDE_WIDTH = 0.1;
const BELT_GUIDE_THICK = 0.04;
const BELT_GROUND_MARKER_R = 0.16;
const BELT_GUIDE_GROUND_LIFT = 0.05; // 地面落点微抬，避开地面网格

/** 地面落点：实心小六边形（XY 平面，+Z 为法线） */
function makeBeltGuideFootGeometry(): BufferGeometry {
    return new ShapeGeometry(hexagonPath(new Shape(), BELT_GROUND_MARKER_R));
}

const beltGuideMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.75,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
});

// 垂直提示柱：几何高度沿 +Y（长度 1，按节点高度缩放）
const beltGuideMesh = new InstancedMesh(
    new BoxGeometry(BELT_GUIDE_WIDTH, 1, BELT_GUIDE_THICK),
    beltGuideMaterial,
    BELT_PREVIEW_CAP
);
beltGuideMesh.matrixAutoUpdate = false;
beltGuideMesh.count = 0;
beltGuideMesh.renderOrder = 9;
beltGuideMesh.frustumCulled = false;

// 地面落点标记
const beltGuideFootMesh = new InstancedMesh(
    makeBeltGuideFootGeometry(),
    beltGuideMaterial,
    BELT_PREVIEW_CAP
);
beltGuideFootMesh.matrixAutoUpdate = false;
beltGuideFootMesh.count = 0;
beltGuideFootMesh.renderOrder = 9;
beltGuideFootMesh.frustumCulled = false;

// 提示柱与节点预览分开可见：三者（latFirst / lonFirst / straight）都渲染六边形节点，
// 这里独立控制是为了将来独立开关高度提示时不影响节点显示
const beltGuideVisible = ref(false);
watchEffect(() => {
    if (isPlacingBelt() && beltGuideVisible.value) {
        scene.add(beltGuideMesh);
        scene.add(beltGuideFootMesh);
    } else {
        scene.remove(beltGuideMesh);
        scene.remove(beltGuideFootMesh);
    }
});

const beltPreviewVisible = ref(false);
watchEffect(() => {
    if (isPlacingBelt() && beltPreviewVisible.value) {
        scene.add(beltPreviewMesh);
        scene.add(beltEndMarkerMesh);
        scene.add(beltLinkMesh);
    } else {
        scene.remove(beltPreviewMesh);
        scene.remove(beltEndMarkerMesh);
        scene.remove(beltLinkMesh);
    }
});

function hideBeltPreview() {
    beltPreviewMesh.count = 0;
    beltEndMarkerMesh.count = 0;
    beltLinkMesh.count = 0;
    beltGuideMesh.count = 0;
    beltGuideFootMesh.count = 0;
    beltGuideVisible.value = false;
    beltPreviewVisible.value = false;
}

// ---- 已有传送带悬停/选中高亮（建造模式下续建/插入）----
// 悬停：鼠标指向节点所在的**整条链路**；选中：A 点所在链路（拖拽期间保持高亮）。
// 只画在预览层（每格一个黄色外圈），不改真实传送带材质，也不进 library 渲染路径。
const beltHover = ref<{ index: number } | null>(null);
const beltHoverMaterial = new MeshBasicMaterial({
    color: 0xffc22e,
    opacity: 0.95,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // 高亮要能透过传送带本体/地面网格看到，与游戏内选中效果一致
    depthTest: false,
});
const beltHoverMarker = new InstancedMesh(
    makeBeltEndGeometry(),
    beltHoverMaterial,
    BELT_PREVIEW_CAP
);
beltHoverMarker.matrixAutoUpdate = false;
beltHoverMarker.count = 0;
beltHoverMarker.renderOrder = 12;
beltHoverMarker.frustumCulled = false;
const beltHoverLift = new Matrix4().makeTranslation(
    0,
    0,
    BELT_PREVIEW_LIFT + 0.01
);
const beltHoverM = new Matrix4();
const beltHoverVisible = ref(false);
watchEffect(() => {
    const bp = b.value;
    const data = commandQueue.value?.data;
    // 优先级：鼠标悬停节点所在链路（拖拽时即"汇入目标"）> 已确定 A 点所在链路
    const index = beltHover.value?.index ?? beltStartBuildingIndex.value ?? null;
    const chain =
        !isPlacingBelt() || bp === null || !data || index === null
            ? []
            : collectBeltChain(data.buildings, index);
    const n = Math.min(chain.length, BELT_PREVIEW_CAP);
    for (let i = 0; i < n; i++) {
        const building = data!.buildings[chain[i]];
        const trans = calcBuildingTrans(PLANET_RADIUS, bp!.pos, building)[0];
        beltHoverM.multiplyMatrices(trans, beltHoverLift);
        beltHoverMarker.setMatrixAt(i, beltHoverM);
    }
    beltHoverMarker.count = n;
    beltHoverMarker.instanceMatrix.needsUpdate = true;
    beltHoverVisible.value = n > 0;
});
watchEffect(() => {
    if (beltHoverVisible.value) scene.add(beltHoverMarker);
    else scene.remove(beltHoverMarker);
});

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
    // 命令重建后下标可能越界（撤销/剔除），取不到选择盒就当作不可显示
    const box =
        b.value !== null && sorterSource.value !== null
            ? b.value.bvh.boxes[sorterSource.value]
            : undefined;
    if (isPlacingSorter() && box !== undefined) {
        sorterSrcBox.matrix.copy(box);
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

/**
 * 分拣器实体幽灵：预演阶段按将建成的造型显示半透明模型（蓝=可建造、红=不可），
 * 与截图里的游戏内预览一致。造型与正式模型共用 `@/Animation/inserter` 的布局
 * 常量，避免"预览一个样、落位另一个样"。
 */
const sorterGhost = new SorterGhost();
const sorterGhostVisible = ref(false);

watchEffect(() => {
    if (slotMarkersVisible.value) scene.add(slotMarkers);
    else scene.remove(slotMarkers);
    if (portMarkersVisible.value) scene.add(portMarkers);
    else scene.remove(portMarkers);
    if (beltRangeVisible.value) scene.add(beltRangeMesh);
    else scene.remove(beltRangeMesh);
    if (sorterPreviewVisible.value) scene.add(sorterPreviewMesh);
    else scene.remove(sorterPreviewMesh);
    if (isPlacingSorter() && sorterGhostVisible.value)
        scene.add(sorterGhost.group);
    else scene.remove(sorterGhost.group);
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
 * 与 `portEndAt` / 标记覆盖层共用同一套换算：
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
    if (area === undefined) return null;
    const turn = areaGridSize(area.segment);
    // 经向环形坐标取短弧（该区域自己的格数，不是固定的 1000）
    let dx = anchor.x - bp.x;
    if (dx > turn / 2) dx -= turn;
    else if (dx < -turn / 2) dx += turn;
    const dy = anchor.y - bp.y;
    const cosLat = Math.cos(
        (area.latitude + bp.y) *
            ((2 * Math.PI) / (PLANET_SEGMENT * GRID_PER_SEGMENT))
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
    sorterGhostVisible.value = false;
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
    if (hoverBuilding === undefined) return;
    const trans = calcBuildingTrans(PLANET_RADIUS, bp.pos, hoverBuilding);

    if (placingSorter && isBelt(hoverBuilding.itemId)) {
        // 皮带：青色范围条沿主轴（盒 y 轴随 yaw 旋转对齐）
        overlayLift.makeTranslation(0, 0, 0.25);
        beltRangeMesh.matrix.multiplyMatrices(trans[0], overlayLift);
        beltRangeVisible.value = true;
        // 不 return：继续走下面的预演和预览连线逻辑
    }

    // 已选源且悬停有效目标 → 全真预演（含被占后的平行切换；与实际放置完全一致）
    const src = placingSorter ? sorterSource.value : null;
    // 撤销/剔除后源下标可能越界：越界就当作"没有源"，别让覆盖层抛错
    const srcBuilding = src === null ? undefined : data.buildings[src];
    let preview: BlueprintBuilding | null = null;
    if (
        src !== null &&
        srcBuilding !== undefined &&
        src !== hover &&
        // 跨纬度带在提交时会被拒绝（单条分拣器只有一个 areaIndex），
        // 预演阶段也按不可建造显示，避免蓝色幽灵与实际结果不一致
        srcBuilding.areaIndex === hoverBuilding.areaIndex
    ) {
        preview = createSorterBetween(
            srcBuilding,
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

    // 实体幽灵模型：有效=蓝、无效=红。无效时以两端建筑中心拉出红色模型
    // （方向与旧红线一致），姿态退化（两端重合）时返回 false，回退到下面的连线提示。
    let ghostPosed = false;
    if (src !== null && srcBuilding !== undefined && src !== hover) {
        if (preview !== null) {
            const et = calcBuildingTrans(PLANET_RADIUS, bp.pos, preview);
            ghostPosed = sorterGhost.setPose(et[0], et[1], true);
        } else {
            const st = calcBuildingTrans(PLANET_RADIUS, bp.pos, srcBuilding);
            ghostPosed = sorterGhost.setPose(st[0], trans[0], false);
        }
    }
    sorterGhostVisible.value = ghostPosed;

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

    // 预览连线：仅在幽灵无法绘制时兜底（两端重合等退化姿态）；
    // 正常情况由上面的蓝/红实体幽灵承担可建造性提示
    if (!ghostPosed && src !== null && srcBuilding !== undefined && src !== hover) {
        if (preview) {
            const et = calcBuildingTrans(PLANET_RADIUS, bp.pos, preview);
            overlayP0.setFromMatrixPosition(et[0]);
            overlayP1.setFromMatrixPosition(et[1]);
            sorterPreviewMesh.material.color.setHex(0x50fa50);
        } else {
            // 不可放置：连两建筑中心的红线提示
            overlayP0.setFromMatrixPosition(
                calcBuildingTrans(PLANET_RADIUS, bp.pos, srcBuilding)[0]
            );
            overlayP1.setFromMatrixPosition(trans[0]);
            sorterPreviewMesh.material.color.setHex(0xff4040);
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
        beltStartZ = 0;
        beltStartTilt.value = 0;
        beltStartActive.value = false;
        beltStartBuildingIndex.value = null;
        beltHover.value = null;
        beltArea = null;
        hideBeltPreview();
    }
    if (!isPlacingSorter()) {
        sorterSource.value = null;
        sorterSourceAnchor = null;
        sorterHover.value = null;
        sorterHoverAnchor.value = null;
        sorterGhostVisible.value = false;
        sorterGhost.hide();
    }
});

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
    /** 全星球经向格数（赤道带一整圈）：把弧度换成 1000 格/圈口径的网格坐标 */
    const RAD_TO_GRID = ROOT_GRID_SIZE / (2 * Math.PI);

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
    /** Raycast 到星球球面：返回世界坐标命中点（供放置/地基换算） */
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
        const latGrid = Math.asin(hit.y / PLANET_RADIUS) * RAD_TO_GRID;
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
        segment: PLANET_SEGMENT,
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
        const col = (((from.longitude + p.x) % fromTurn) + fromTurn) % fromTurn;
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
            z: (p.length() - PLANET_RADIUS) / HEIGHT_GRID_SIZE,
        };
    };
    /** 屏幕位置 → 连续网格坐标（不取整）。用于分拣器的 slot 锚点 */
    const anchorPoint = new Vector3();
    /**
     * @param areaIndex 用哪个区域的坐标空间换算（分拣器/传送带口必须用建筑自己的区域）
     */
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
        anchorPoint.normalize().multiplyScalar(PLANET_RADIUS);
        const latGrid = Math.asin(anchorPoint.y / PLANET_RADIUS) * RAD_TO_GRID;
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
        if (area === undefined) return null;
        const cosLat = Math.cos(
            (area.latitude + bp.y) *
                ((2 * Math.PI) / (PLANET_SEGMENT * GRID_PER_SEGMENT))
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
     * 光标 → 汇入目标（阶段 7）：光标停在**已建传送带**节点上时返回该带。
     *
     * 用户确认的规则：保留目标原线路不动（A→B→C→D 不变），新线路末格接到该节点，
     * 因此目标节点可以有多个上游。拒绝的情况：
     * - 跨区域（一条带只能落在一个区域里）；
     * - 就是 A 点那条带（自己汇入自己）；
     * - A 点是**中间格**（那种情况走 {@link InsertBeltLineCommand} 的"从该格接出"模式）；
     * - 目标的下游链回到 A 点（会成环）。
     */
    const mergeTargetAt = (e: PointerCoords): BlueprintBuilding | null => {
        const queue = commandQueue.value;
        if (!queue || beltArea === null) return null;
        const hit = pickBuildingHit(e);
        if (hit === null) return null;
        const b = queue.data.buildings[hit.index];
        if (b === undefined || !isBelt(b.itemId)) return null;
        if (b.areaIndex !== beltArea.areaIndex) return null;
        const startIdx = beltStartBuildingIndex.value;
        if (startIdx !== null) {
            const startBelt = queue.data.buildings[startIdx];
            // A 点是中间格 → 插入模式优先
            if (startBelt !== undefined && startBelt.outputObjIdx >= 0) return null;
            // 不能汇入 A 点自己
            if (b.index === startIdx) return null;
            // 环路：从目标向下游走，若回到 A 点则汇入会成环
            const seen = new Set<number>();
            let cur: number | undefined = b.index;
            while (cur !== undefined && !seen.has(cur)) {
                if (cur === startIdx) return null;
                seen.add(cur);
                const next = queue.data.buildings[cur];
                cur =
                    next !== undefined && next.outputObjIdx >= 0
                        ? next.outputObjIdx
                        : undefined;
            }
        }
        return b;
    };
    /**
     * 汇入目标的精确格坐标（与目标带同格；用于预览/提交的路径终点）。
     * 自由角度带的节点是分数坐标，不能取整。
     */
    const mergeTargetCell = (
        target: BlueprintBuilding,
        gridSize: number
    ): { x: number; y: number } => {
        const p = target.localOffset[0];
        return {
            x: ((p.x % gridSize) + gridSize) % gridSize,
            y: p.y,
        };
    };
    /**
     * 放置建筑。
     * 可堆叠建筑在光标落在底座上时**叠到该列最上层**（z = 底座 z + 一层高度，x/y 对齐底座中心）；
     * 研究站还会沿用底座的模式与配方（一列研究站共享设置）；
     * 物流配送器（2107）没有箱子底座时直接拒绝（游戏：只能放在箱盖上方）。
     */
    const placeBuilding = (e: PointerCoords) => {
        const queue = commandQueue.value;
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
        if (!queue || itemId === null || modelIndex === null) return;
        const target = placementTargetAt(e);
        if (target === null) return;
        // 该纬度带还没有区域 → 按规范布局补一条（画布扩张；建筑绝对位置不受影响）
        const areaIndex = materializeTarget(target);
        if (areaIndex < 0) {
            showHint("放置失败：无法创建该纬度带的区域");
            return;
        }
        const offset = { x: target.x, y: target.y };
        const parent = placeBaseFor(e, offset, itemId, areaIndex);
        if (requiresBase(itemId) && parent === null) {
            showHint("放置失败：只能放在储物仓顶部");
            return;
        }
        const building = createBuilding(
            itemId,
            modelIndex,
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
            // 纬度带外 / 区域不存在：给一次可见反馈，避免"点了没反应"
            showHint("放置失败：超出纬度带范围");
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
    /**
     * 最后一帧的指针屏幕坐标（投影/拾取只用到 clientX/clientY）。
     * **必须是响应式**：鼠标静止时按 R 旋转 / 切建筑 / 改 Shift 吸附也要立即刷新预览。
     */
    const lastPointer = shallowRef<PointerCoords | null>(null);
    /** 鼠标跟随预览：placing 模式下更新半透明绿盒的位置与朝向（分拣器/传送带走各自预览） */
    const updatePreview = (e: PointerCoords) => {
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
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
        if (target === null || b.value === null || itemId === null || modelIndex === null) {
            previewVisible.value = false;
            return;
        }
        const meta = buildingMeta.get(modelIndex);
        if (!meta) {
            previewVisible.value = false;
            return;
        }
        const offset = { x: target.x, y: target.y };
        // 预演堆叠：底座高度 + 对齐底座中心 + 底座要求的朝向；
        // 只能放在底座上的建筑（物流配送器）没有箱子时不显示预览（点了也放不下去）
        const parent = placeBaseFor(e, offset, itemId, target.areaIndex);
        if (requiresBase(itemId) && parent === null) {
            previewVisible.value = false;
            return;
        }
        const fake = createBuilding(
            itemId,
            modelIndex,
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
        const trans = calcBuildingTrans(
            PLANET_RADIUS,
            syntheticPos(target.origin),
            fake
        )[0];
        previewMesh.matrix.multiplyMatrices(trans, meta.unitBoxTrans);
        previewVisible.value = true;
    };
    // 传送带拖拽预览：把起点到当前点的栅格化路径写入实例网格
    const beltPreviewM = new Matrix4();
    const beltLift = new Matrix4().makeTranslation(0, 0, BELT_PREVIEW_LIFT);
    // 节点世界坐标 / 连线临时对象（复用避免每帧分配）
    const beltCellPos = Array.from(
        { length: BELT_PREVIEW_CAP },
        () => new Vector3()
    );
    const beltLinkStart = new Vector3();
    const beltLinkEnd = new Vector3();
    const beltLinkMid = new Vector3();
    const beltLinkDir = new Vector3();
    const beltLinkLift = new Vector3();
    const beltLinkM = new Matrix4();
    const beltLinkScale = new Matrix4();
    // 垂直提示柱临时对象（复用避免每帧分配）
    const beltGuideRadial = new Vector3();
    const beltGuideGround = new Vector3();
    const beltGuideMid = new Vector3();
    const beltGuideQuat = new Quaternion();
    const beltGuideM = new Matrix4();
    const beltGuideScale = new Vector3();
    const BELT_GUIDE_UP = new Vector3(0, 1, 0);
    const BELT_GUIDE_Z = new Vector3(0, 0, 1);

    /**
     * 高层传送带的垂直占位提示：把一组"带面高度"的锚点投影到球面地面，
     * 每个锚点画一根白色细柱 + 地面小六边形落点。
     * z=0 时只清空 count（完全隐藏）。
     */
    const updateBeltGuides = (points: Vector3[], count: number) => {
        let c = 0;
        for (let i = 0; i < count && c < BELT_PREVIEW_CAP; i++) {
            const top = points[i];
            const h = top.length() - PLANET_RADIUS;
            if (h <= 1e-3) continue; // 贴地（z=0）不显示
            beltGuideRadial.copy(top).normalize();
            beltGuideGround
                .copy(beltGuideRadial)
                .multiplyScalar(PLANET_RADIUS + BELT_GUIDE_GROUND_LIFT);
            const len = top.distanceTo(beltGuideGround);
            if (len <= 1e-3) continue;
            beltGuideMid.copy(top).add(beltGuideGround).multiplyScalar(0.5);
            // 细柱：几何高度沿 +Y，用四元数把 +Y 对到径向
            beltGuideQuat.setFromUnitVectors(BELT_GUIDE_UP, beltGuideRadial);
            beltGuideM.compose(
                beltGuideMid,
                beltGuideQuat,
                beltGuideScale.set(1, len, 1)
            );
            beltGuideMesh.setMatrixAt(c, beltGuideM);
            // 地面落点：XY 平面六边形，+Z 对到径向
            beltGuideQuat.setFromUnitVectors(BELT_GUIDE_Z, beltGuideRadial);
            beltGuideM.compose(
                beltGuideGround,
                beltGuideQuat,
                beltGuideScale.set(1, 1, 1)
            );
            beltGuideFootMesh.setMatrixAt(c, beltGuideM);
            c++;
        }
        beltGuideMesh.count = c;
        beltGuideFootMesh.count = c;
        beltGuideMesh.instanceMatrix.needsUpdate = true;
        beltGuideFootMesh.instanceMatrix.needsUpdate = true;
        beltGuideVisible.value = c > 0;
    };

    // ---- 地基模式：逐格铺/涂 ----
    /** 网格偏移 → 地基光标世界矩阵（薄板贴于格子中心，朝向球面法线） */
    const reformCellMatrix = (
        offset: { x: number; y: number },
        origin: AreaGridOrigin
    ): Matrix4 | null => {
        if (b.value === null) return null;
        const fake = createBuilding(1131, 0, offset, 0);
        const t = calcBuildingTrans(
            PLANET_RADIUS,
            syntheticPos(origin),
            fake
        )[0].clone();
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
        const sizeY =
            area === undefined
                ? target.band.rowHi - target.band.rowLo + 1
                : area.size.y;
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
        if (area === undefined) return;
        const x = target.x;
        const y = target.y;
        if (x < 0 || y < 0 || y >= area.size.y) {
            showHint("地基失败：超出纬度带范围");
            return;
        }
        if (x >= area.size.x) area.size.x = Math.floor(x) + 1;
        queue.push(
            new PaintReformCellCommand(
                areaIndex,
                x,
                y,
                placement.reformColorSlot
            )
        );
    };

    /** 未设 A 点时：在鼠标位置显示单个传送带节点（悬停建筑口时贴到口上） */
    const showSingleBeltPreview = (e: PointerCoords) => {
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
        if (b.value === null || itemId === null || modelIndex === null) return;
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
        if (origin === undefined) return;
        const fake = createBuilding(
            itemId,
            modelIndex,
            offset,
            placement.yaw,
            port ? port.point.z : placement.beltZ
        );
        fake.tilt = placement.beltTilt;
        const t = calcBuildingTrans(PLANET_RADIUS, syntheticPos(origin), fake)[0];
        beltPreviewM.multiplyMatrices(t, beltLift);
        beltPreviewMesh.setMatrixAt(0, beltPreviewM);
        beltPreviewMesh.count = 1;
        beltPreviewMesh.instanceMatrix.needsUpdate = true;
        // 单格预览不画首尾端圈/连线，但高度提示照常
        beltEndMarkerMesh.count = 0;
        beltLinkMesh.count = 0;
        beltCellPos[0].setFromMatrixPosition(t);
        updateBeltGuides(beltCellPos, 1);
        beltPreviewVisible.value = true;
    };

    const updateBeltPreview = (
        p0: { x: number; y: number },
        e: PointerCoords
    ) => {
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
        if (
            b.value === null ||
            itemId === null ||
            modelIndex === null ||
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
        // 插入模式（A 点是中间格，见 InsertBeltLineCommand）：新线路从**光标端**
        // 流回目标格，终点高度 = 目标带高度、起点高度 = 建造高度（或光标口高度）
        const insertTarget =
            beltStartBuildingIndex.value !== null
                ? commandQueue.value?.data.buildings[
                      beltStartBuildingIndex.value
                  ]
                : undefined;
        const inserting =
            insertTarget !== undefined &&
            isBelt(insertTarget.itemId) &&
            insertTarget.outputObjIdx >= 0;
        // 汇入模式（阶段 7）：光标停在已建传送带节点上 → 新线路末格接到它，
        // 路径终点取该节点的精确坐标与高度，并丢弃目标格本身（目标格已有带）。
        const mergeTarget = inserting ? null : mergeTargetAt(e);
        const endPoint =
            mergeTarget !== null
                ? mergeTargetCell(mergeTarget, gridSize)
                : cur;
        const endZ =
            mergeTarget !== null
                ? mergeTarget.localOffset[0].z
                : placement.beltZ;
        // 口不再按高度过滤：口高度与终点高度不同时由 buildBeltLine 自动生成坡度
        const endPort = inserting || mergeTarget !== null ? null : portEndAt(e);
        const startPort = inserting ? portEndAt(e) : beltStartPort;

        // latFirst / lonFirst / straight：统一用六边形节点 + 白色连线预览，
        // 与落位共用同一套路径构造（straight 现在是自由角度直线，节点可为分数）。
        // 起点/终点接建筑口时预览也会贴到口上。
        // 插入模式丢弃目标格本身（目标格已被占用，插入命令会把末格接回它）；
        // 汇入模式同理：末格停在目标节点前，输出指向目标节点。
        const previewBelts = clipBeltPath(
            inserting
                ? buildBeltLine(
                      itemId,
                      modelIndex,
                      cur,
                      p0,
                      placement.yaw,
                      beltPathMode,
                      startPort,
                      endPort,
                      gridSize,
                      beltStartZ,
                      placement.beltZ,
                      beltStartTilt.value,
                      placement.beltTilt
                  ).slice(0, -1)
                : mergeTarget !== null
                ? buildBeltLine(
                      itemId,
                      modelIndex,
                      p0,
                      endPoint,
                      placement.yaw,
                      beltPathMode,
                      startPort,
                      null,
                      gridSize,
                      endZ,
                      beltStartZ,
                      placement.beltTilt,
                      beltStartTilt.value
                  ).slice(0, -1)
                : buildBeltLine(
                      itemId,
                      modelIndex,
                      p0,
                      endPoint,
                      placement.yaw,
                      beltPathMode,
                      startPort,
                      endPort,
                      gridSize,
                      placement.beltZ,
                      beltStartZ,
                      placement.beltTilt,
                      beltStartTilt.value
                  ),
            area
        );
        const n = Math.min(previewBelts.length, BELT_PREVIEW_CAP);
        const pos = syntheticPos(beltArea.origin);
        for (let i = 0; i < n; i++) {
            const t = calcBuildingTrans(PLANET_RADIUS, pos, previewBelts[i])[0];
            beltPreviewM.multiplyMatrices(t, beltLift);
            beltPreviewMesh.setMatrixAt(i, beltPreviewM);
            beltCellPos[i].setFromMatrixPosition(t);
        }
        beltPreviewMesh.count = n;
        beltPreviewMesh.instanceMatrix.needsUpdate = true;
        // 高层时每个节点向地面投一根垂直提示柱
        updateBeltGuides(beltCellPos, n);

        // 首尾端的大号六边形外圈（单格时只画一个）
        const endCount = n === 0 ? 0 : n === 1 ? 1 : 2;
        if (n > 0) {
            const t0 = calcBuildingTrans(
                PLANET_RADIUS,
                pos,
                previewBelts[0]
            )[0];
            beltPreviewM.multiplyMatrices(t0, beltLift);
            beltEndMarkerMesh.setMatrixAt(0, beltPreviewM);
            if (n > 1) {
                const t1 = calcBuildingTrans(
                    PLANET_RADIUS,
                    pos,
                    previewBelts[n - 1]
                )[0];
                beltPreviewM.multiplyMatrices(t1, beltLift);
                beltEndMarkerMesh.setMatrixAt(1, beltPreviewM);
            }
            beltEndMarkerMesh.instanceMatrix.needsUpdate = true;
        }
        beltEndMarkerMesh.count = endCount;

        // 相邻节点之间的白色连线：从六边形边缘连到下一个边缘，避免穿过空心区域
        let linkCount = 0;
        for (let i = 0; i + 1 < n; i++) {
            beltLinkDir.subVectors(beltCellPos[i + 1], beltCellPos[i]);
            const dist = beltLinkDir.length();
            if (dist <= 1e-4) continue;
            beltLinkDir.multiplyScalar(1 / dist);
            const len = dist - 2 * BELT_HEX_R;
            if (len <= 0) continue;
            // 与六边形同层微抬，避免与地面/网格线 Z-fighting
            beltLinkLift
                .copy(beltCellPos[i])
                .normalize()
                .multiplyScalar(BELT_PREVIEW_LIFT);
            beltLinkStart
                .copy(beltCellPos[i])
                .add(beltLinkLift)
                .addScaledVector(beltLinkDir, BELT_HEX_R);
            beltLinkEnd
                .copy(beltCellPos[i + 1])
                .add(beltLinkLift)
                .addScaledVector(beltLinkDir, -BELT_HEX_R);
            beltLinkMid
                .copy(beltLinkStart)
                .add(beltLinkEnd)
                .multiplyScalar(0.5);
            // lookAt 让局部 +z 指向起点方向；缩放后沿 z 拉成从起点到终点的细长条
            beltLinkM.lookAt(beltLinkStart, beltLinkEnd, beltLinkStart);
            beltLinkM.setPosition(beltLinkMid);
            beltLinkM.multiply(beltLinkScale.makeScale(1, 1, len));
            beltLinkMesh.setMatrixAt(linkCount++, beltLinkM);
        }
        beltLinkMesh.count = linkCount;
        beltLinkMesh.instanceMatrix.needsUpdate = true;

        beltPreviewVisible.value = n > 0;
    };
    // 切换传送带路径走法（在 onMounted 内定义，可访问 lastPointer / updateBeltPreview）
    cycleBeltPathModeFn.value = () => {
        const i = BELT_PATH_MODES.indexOf(beltPathMode);
        beltPathMode = BELT_PATH_MODES[(i + 1) % BELT_PATH_MODES.length];
        if (beltStart !== null && lastPointer.value)
            updateBeltPreview(beltStart, lastPointer.value);
        return beltPathMode;
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
        for (const belt of belts) {
            const y = belt.localOffset[0].y;
            if (y < 0 || y >= area.size.y) break;
            out.push(belt);
        }
        return out;
    };
    /** 点击 B 点：提交整条传送带（一次撤销）。仅在放置成功后清空 A 点。 */
    const commitBeltLine = (e: PointerCoords) => {
        const queue = commandQueue.value;
        const start = beltStart;
        const belt = beltArea;
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
        if (!queue || !start || belt === null || itemId === null || modelIndex === null)
            return;
        const area = queue.data.areas[belt.areaIndex];
        if (area === undefined) return;
        // 建筑口必须属于本条带所在区域（一条带 = 一个区域，跨区域的口无法用单条带表示）。
        // 口高度与终点高度不一致时不再放弃绑定：buildBeltLine 会自动生成坡度爬升。
        const hoveredEndPort = portEndAt(e);
        const endPort =
            hoveredEndPort !== null &&
            hoveredEndPort.building.areaIndex === belt.areaIndex
                ? hoveredEndPort
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
        // 插入模式（A 点是中间格，阶段 5）：新线路正常从 A 点铺到光标端，
        // 首格 = 被点选的中间格本身；InsertBeltLineCommand 改写它的输出、
        // 并在新线路末端与原下游相邻时接回原下游（否则原下游断开并提示）。
        const insertTarget =
            beltStartBuildingIndex.value !== null
                ? queue.data.buildings[beltStartBuildingIndex.value]
                : undefined;
        if (
            insertTarget !== undefined &&
            isBelt(insertTarget.itemId) &&
            insertTarget.outputObjIdx >= 0
        ) {
            const insertBelts = clipBeltPath(
                buildBeltLine(
                    itemId,
                    modelIndex,
                    start,
                    end,
                    placement.yaw,
                    beltPathMode,
                    startPort,
                    endPort,
                    gridSize,
                    placement.beltZ,
                    beltStartZ,
                    placement.beltTilt,
                    beltStartTilt.value
                ),
                area
            );
            if (insertBelts.length < 2) {
                showHint("铺带失败：没有可放置的传送带格");
                return;
            }
            // 原下游（必须是传送带；指向建筑口的带不允许插入）
            const oldDown = queue.data.buildings[insertTarget.outputObjIdx];
            if (oldDown === undefined || !isBelt(oldDown.itemId)) {
                showHint("该传送带已接入建筑口，无法在此插入");
                return;
            }
            const lastNew = insertBelts[insertBelts.length - 1];
            // 末端接建筑口（endPort 非空）时不存在"断开原下游"的问题
            const reconnect =
                endPort === null &&
                Math.hypot(
                    lastNew.localOffset[0].x - oldDown.localOffset[0].x,
                    lastNew.localOffset[0].y - oldDown.localOffset[0].y
                ) < 1.5;
            beltStart = null;
            beltStartPort = null;
            beltStartZ = 0;
            beltStartTilt.value = 0;
            beltStartActive.value = false;
            beltStartBuildingIndex.value = null;
            beltArea = null;
            hideBeltPreview();
            try {
                queue.push(
                    new InsertBeltLineCommand(
                        insertBelts,
                        insertTarget,
                        belt.areaIndex,
                        gridSize
                    )
                );
                if (!reconnect)
                    showHint("已从中间接入：原下游传送带被断开");
            } catch (error) {
                // 占用 / 纬度带外 —— 提示具体原因
                showHint(
                    error instanceof Error
                        ? `插入失败：${error.message}`
                        : "插入失败"
                );
            }
            return;
        }
        // 汇入模式（阶段 7）：新线路末格接到已建传送带节点（起点/中间格），
        // 目标原线路完全不动、允许多个上游 —— 与"末格续建""中间格插入"互斥。
        const mergeTarget = mergeTargetAt(e);
        if (mergeTarget !== null) {
            const mergeBelts = clipBeltPath(
                buildBeltLine(
                    itemId,
                    modelIndex,
                    start,
                    mergeTargetCell(mergeTarget, gridSize),
                    placement.yaw,
                    beltPathMode,
                    startPort,
                    null,
                    gridSize,
                    mergeTarget.localOffset[0].z,
                    beltStartZ,
                    placement.beltTilt,
                    beltStartTilt.value
                ).slice(0, -1),
                area
            );
            if (mergeBelts.length === 0) {
                showHint("铺带失败：没有可放置的传送带格");
                return;
            }
            beltStart = null;
            beltStartPort = null;
            beltStartZ = 0;
            beltStartTilt.value = 0;
            beltStartActive.value = false;
            beltStartBuildingIndex.value = null;
            beltArea = null;
            hideBeltPreview();
            try {
                const cmd = new CreateBeltLineCommand(
                    mergeBelts,
                    startPort,
                    null,
                    belt.areaIndex,
                    gridSize,
                    mergeTarget
                );
                queue.push(cmd);
                if (!cmd.merged)
                    showHint("汇入失败：末端未能接到目标节点");
            } catch {
                showHint("铺带失败：超出纬度带范围");
            }
            return;
        }
        const belts = clipBeltPath(
            buildBeltLine(
                itemId,
                modelIndex,
                start,
                end,
                placement.yaw,
                beltPathMode,
                startPort,
                endPort,
                gridSize,
                placement.beltZ,
                beltStartZ,
                placement.beltTilt,
                beltStartTilt.value
            ),
            area
        );
        if (belts.length === 0) {
            showHint("铺带失败：没有可放置的传送带格");
            return;
        }
        beltStart = null;
        beltStartPort = null;
        beltStartZ = 0;
        beltStartTilt.value = 0;
        beltStartActive.value = false;
        beltStartBuildingIndex.value = null;
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
            // 纬度带外 / 区域不存在 — 给一次可见反馈
            showHint("铺带失败：超出纬度带范围");
        }
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
        const itemId = placement.selectedItemId;
        const modelIndex = placement.selectedModelIndex;
        if (
            index === null ||
            index === src ||
            itemId === null ||
            modelIndex === null
        )
            return;
        const srcBuilding = queue.data.buildings[src];
        const dstBuilding = queue.data.buildings[index];
        // 分拣器只有一个 areaIndex：两端必须落在同一条带（跨带无法用单条分拣器表示）
        if (srcBuilding.areaIndex !== dstBuilding.areaIndex) {
            sorterSourceAnchor = null;
            showHint("架接失败：两端不在同一个纬度带");
            return;
        }
        // 允许任意两端组合：建筑↔建筑、建筑↔皮带、皮带↔皮带
        // 传入 buildings 以检测 slot / offset / 分流器口占用
        // 传入两端点击锚点 以按点击所在的列/行选择 slot（与游戏光标行为一致）
        const sorter = createSorterBetween(
            srcBuilding,
            dstBuilding,
            itemId,
            modelIndex,
            queue.data.buildings,
            { src: sorterSourceAnchor ?? undefined, dst: anchor }
        );
        sorterSourceAnchor = null;
        if (sorter) {
            sorter.areaIndex = srcBuilding.areaIndex;
            queue.push(new CreateBuildingCommand(sorter, srcBuilding.areaIndex));
        } else {
            showHint("架接失败：该位置无法连接分拣器");
        }
    };

    // ---- 鼠标事件状态机（点击 / 拖拽 / A-B 两点）----
    /** 拖拽阈值：超过即视为"转地图/平移"，不再算点击（避免拖拽误落建筑/误选中） */
    const DRAG_THRESHOLD = 6;
    // 左键按下的位置：click 与 mouseup 共用（mouseup 先跑，click 负责清空）
    let downPos: { x: number; y: number } | null = null;
    // 右键按下的位置：右键拖拽是旋转，松开时不应剔除建筑
    let rightDownPos: { x: number; y: number } | null = null;
    const isDrag = (a: { x: number; y: number }, e: PointerCoords) =>
        Math.hypot(e.clientX - a.x, e.clientY - a.y) > DRAG_THRESHOLD;

    const onMouseDown = (e: MouseEvent) => {
        if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
        else if (e.button === 2) rightDownPos = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = (e: MouseEvent) => {
        if (downPos === null) return;
        // 右键在 contextmenu 里处理（取消 A 点），不能被当成 B 点确认；
        // Windows 上 contextmenu 在 mouseup 之后才触发，不在这里拦掉会先落一条带
        if (e.button !== 0) {
            downPos = null;
            return;
        }
        if (isDrag(downPos, e)) return;
        // 传送带：非拖拽点击在 A/B 状态间切换
        if (isPlacingBelt()) {
            if (beltStart === null) {
                // 第一次点击：设为 A 点；落在建筑口上则记下"取出"端点。
                // A 点同时决定整条带所属的区域：口 → 该建筑的区域；空格 → 所在纬度带的区域
                const queue = commandQueue.value;
                if (queue === null) return;
                beltStartBuildingIndex.value = null;
                const port = portEndAt(e);
                if (port !== null) {
                    const origin = b.value!.pos.areas[port.building.areaIndex];
                    if (origin === undefined) return;
                    beltArea = {
                        areaIndex: port.building.areaIndex,
                        origin,
                    };
                    const turn = areaGridSize(origin.segment);
                    beltStart = {
                        x:
                            ((Math.round(port.point.x) % turn) + turn) %
                            turn,
                        y: Math.round(port.point.y),
                    };
                    // A 点接建筑口：起点高度 = 口高度（分流器上层口 z=1 / 高层带）；
                    // 建造高度也同步到口高度（默认平铺，↑/↓ 再改终点高度就会自动爬升）
                    beltStartZ = port.point.z;
                    setBeltZ(port.point.z);
                    // 口所在建筑的拧转角作为 A 点固定角度
                    beltStartTilt.value = port.building.tilt ?? 0;
                    setBeltTilt(beltStartTilt.value);
                } else {
                    // 命中已有传送带：只允许从**末格**继续建造（中间格会形成普通带分叉）。
                    // 先判定再 materialize 区域，避免中间格点击把画布无谓扩张。
                    const hit = pickBuildingHit(e);
                    const hitBuilding =
                        hit !== null
                            ? queue.data.buildings[hit.index]
                            : undefined;
                    const hitBelt =
                        hitBuilding !== undefined &&
                        isBelt(hitBuilding.itemId)
                            ? hitBuilding
                            : undefined;
                    if (hitBelt !== undefined && hitBelt.outputObjIdx >= 0) {
                        // 中间格：进入"插入"模式（新线路从该格接出，见 InsertBeltLineCommand）。
                        // 唯一不能插的：该格已把货送入建筑口（outputObjIdx 指向建筑）——
                        // 插入会切断口的供料。
                        const down =
                            queue.data.buildings[hitBelt.outputObjIdx];
                        if (down !== undefined && !isBelt(down.itemId)) {
                            showHint("该传送带已接入建筑口，无法在此插入");
                            return;
                        }
                    }
                    if (hitBelt !== undefined) {
                        // A 点接已有传送带：区域/格/高度全部继承该带。
                        // 末格（outputObjIdx<0）→ 提交时 CreateBeltLineCommand 按格+高度层复用；
                        // 中间格 → 提交时 InsertBeltLineCommand 从该格接出新线路（见 commitBeltLine）。
                        const origin = b.value!.pos.areas[hitBelt.areaIndex];
                        if (origin === undefined) return;
                        const turn = areaGridSize(origin.segment);
                        const p = hitBelt.localOffset[0];
                        // 记录精确坐标（自由角度带的末格是分数坐标，取整会错位）
                        beltArea = { areaIndex: hitBelt.areaIndex, origin };
                        beltStart = {
                            x: ((p.x % turn) + turn) % turn,
                            y: p.y,
                        };
                        beltStartZ = p.z;
                        beltStartTilt.value = hitBelt.tilt ?? 0;
                        beltStartBuildingIndex.value = hit!.index;
                        setBeltZ(p.z);
                        setBeltTilt(beltStartTilt.value);
                    } else {
                        const target = placementTargetAt(e, true);
                        if (target === null) return;
                        const areaIndex = materializeTarget(target);
                        if (areaIndex < 0) return;
                        beltArea = { areaIndex, origin: target.origin };
                        beltStart = { x: target.x, y: target.y };
                        // 起点高度默认 = 当前建造高度（之后 ↑/↓ 改的是终点高度）
                        beltStartZ = placement.beltZ;
                        // 起点倾斜默认 = 当前建造倾斜（之后 ←/→ 改的是终点倾斜）
                        beltStartTilt.value = placement.beltTilt;
                    }
                }
                beltStartPort = port;
                beltStartActive.value = true;
                beltHover.value = null;
            } else commitBeltLine(e); // 第二次点击：A→B 放置
        }
    };
    const onClick = (e: MouseEvent) => {
        if (downPos === null) return;
        const drag = isDrag(downPos, e);
        downPos = null;
        // 传送带在 mouseup 中处理 A/B 点击状态机，click 忽略
        if (isPlacingBelt()) return;
        if (drag) return; // was a drag, not a click
        // 左键：放置 / 删除 / 地基 / 选中
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
    const deleteBuilding = (e: PointerCoords) => {
        const index = pickBuilding(e);
        if (index === null) return;
        const queue = commandQueue.value;
        if (!queue) return;
        queue.push(new RemoveBuildingCommand(index, queue.data));
        emit("update:selectedBuildingIndex", null);
    };
    const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        // 右键拖拽是旋转地图：拖过阈值的一次松开不算右键点击
        if (rightDownPos !== null && isDrag(rightDownPos, e)) {
            rightDownPos = null;
            return;
        }
        rightDownPos = null;
        // 预览模式：右键直接删除鼠标所指建筑（沿用 growingTree 的剔除行为）
        if (placement.appMode === "preview") {
            deleteBuilding(e); // 内部已 emit(selectedBuildingIndex, null)
            return;
        }
        // 编辑态：先取消半途状态，其次退出当前模式，最后才允许右键剔除
        // 传送带已设 A 点：右键取消 A 点选择，不退出放置模式
        if (isPlacingBelt() && beltStart !== null) {
            beltStart = null;
            beltStartPort = null;
            beltStartZ = 0;
            beltStartTilt.value = 0;
            beltStartActive.value = false;
            beltStartBuildingIndex.value = null;
            beltArea = null;
            hideBeltPreview();
            // 回退到"未选 A 点"的光标状态：光标处重新显示单个传送带节点
            if (lastPointer.value) {
                showSingleBeltPreview(lastPointer.value);
                // 恢复悬停高亮：取消 A 点后光标仍指向传送带时继续显示
                const queue = commandQueue.value;
                const hit = pickBuildingHit(lastPointer.value);
                const hoverBuilding =
                    hit === null || queue === null
                        ? undefined
                        : queue.data.buildings[hit.index];
                beltHover.value =
                    hit !== null &&
                    hoverBuilding !== undefined &&
                    isBelt(hoverBuilding.itemId)
                        ? { index: hit.index }
                        : null;
            }
            return;
        }
        // 分拣器已设 A 点（源建筑）：右键取消 A 点选择，不退出放置模式
        if (isPlacingSorter() && sorterSource.value !== null) {
            sorterSource.value = null;
            sorterSourceAnchor = null;
            return;
        }
        // 编辑模式：退出 placing/deleting/reforming
        if (placement.mode !== "idle") {
            resetToIdle();
            return;
        }
        // 编辑态空闲：右键剔除（与预览模式一致）
        deleteBuilding(e);
    };
    const onPointerMove = (e: PointerCoords) => {
        lastPointer.value = { clientX: e.clientX, clientY: e.clientY };
        // 建造高度提示跟随光标：坐标换成 rootEl 局部坐标，锚在光标左下角
        //（右缘对齐光标左侧 6px、顶缘在光标下方 14px，见 .belt-z-tip 的 transform）
        pointerInside.value = true;
        const tipRect = rootEl.getBoundingClientRect();
        beltTipPos.value = {
            x: e.clientX - tipRect.left - 6,
            y: e.clientY - tipRect.top + 14,
        };
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
            // 铺传送带：悬停已有传送带节点时高亮它所在链路（末格续建 / 汇入目标）
            if (isPlacingBelt()) {
                beltHover.value =
                    hit !== null &&
                    hoverBuilding !== undefined &&
                    isBelt(hoverBuilding.itemId)
                        ? { index: hit.index }
                        : null;
            }
        }
    };
    const onMouseLeave = () => {
        lastPointer.value = null;
        pointerInside.value = false; // 建造高度提示随光标离开画布一起隐藏
        previewVisible.value = false;
        reformCursorVisible.value = false;
        sorterHover.value = null;
        sorterHoverAnchor.value = null;
        sorterHoverZ.value = 0;
        beltHover.value = null;
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

    // 事件挂在 rootEl（画布父节点）而不是 canvas 上：
    // PlanetMapControls 的 setPointerCapture 只捕获 pointer 事件，mouse/click 仍从 canvas 冒泡；
    // 用父节点还能收到 mouseleave，避免光标移出画布后幽灵预览留在原地。
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
        // 相位由货物系统自持（`Cargos.tick`），返回值再喂给横梁箭头，
        // 保证「箭头与货物同向同速」
        const built = b.value?.buildings;
        if (built !== undefined) {
            const progress = built.cargos.tick(time);
            // 没有分拣器时 inserters 为 null，必须判空
            if (built.inserters !== null) built.inserters.cargoMove = progress;
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

// 预览层几何/材质只服务本组件：卸载时释放（共用的 `beltPreviewMaterial` 只释放一次）
onUnmounted(() => {
    previewMesh.geometry.dispose();
    previewMesh.material.dispose();
    reformCursor.geometry.dispose();
    reformCursor.material.dispose();
    sorterSrcBox.geometry.dispose();
    sorterSrcBox.material.dispose();
    beltPreviewMesh.geometry.dispose();
    beltEndMarkerMesh.geometry.dispose();
    beltLinkMesh.geometry.dispose();
    beltPreviewMaterial.dispose();
    beltGuideMesh.geometry.dispose();
    beltGuideFootMesh.geometry.dispose();
    beltGuideMaterial.dispose();
    slotMarkers.geometry.dispose();
    slotMarkers.material.dispose();
    portMarkers.geometry.dispose();
    portMarkers.material.dispose();
    beltRangeMesh.geometry.dispose();
    beltRangeMesh.material.dispose();
    sorterPreviewMesh.geometry.dispose();
    sorterPreviewMesh.material.dispose();
    sorterGhost.dispose();
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
    /** App.vue 的 R 键：放置传送带时循环切换路径走法（latFirst / lonFirst / straight）——straight 为自由角度直线 */
    cycleBeltPathMode: () => cycleBeltPathModeFn.value?.(),
});
</script>

<style lang="scss">
.editor-root {
    position: relative;
    width: 100%;
    height: 100%;
}

/* 放置/铺带失败提示：贴着画布底部居中，不拦截鼠标 */
.editor-hint {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.72);
    color: #ffb4b4;
    font-size: 13px;
    pointer-events: none;
    z-index: 10;
}

/* 建造高度提示：挂在光标左下角（left/top 由 pointermove 写入，向左平移自身宽度、
   下沉到光标下方），跟随鼠标移动，不拦截鼠标 */
.belt-z-tip {
    position: absolute;
    transform: translate(-100%, 0);
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 13px;
    line-height: 18px;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
    z-index: 10;
}
</style>
