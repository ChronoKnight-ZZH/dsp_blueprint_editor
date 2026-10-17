<template>
    <div class="splitter-pannel" @contextmenu.prevent>
        <svg viewBox="-125 -125 250 250" xmlns="http://www.w3.org/2000/svg">
            <circle
                cx="0"
                cy="0"
                r="50"
                stroke="currentcolor"
                fill="#0006"
                stroke-width=".5"
                opacity="0.6"
            />
            <template v-for="(a, i) in adjacency" :key="i">
                <g
                    v-if="a"
                    class="splitter-port"
                    :opacity="params.priority[i] ? 1 : 0.5"
                    @click.left.prevent.stop="onPortLeft(i)"
                    @contextmenu.prevent.stop="onPortRight(i)"
                >
                    <path
                        d="M-5 -55l5 10 5 -10z"
                        :fill="color(i)"
                        :transform="
                            `rotate(${yaw[i]})` +
                            (isInput(i) ? '' : 'rotate(180 0 -50)')
                        "
                    />
                    <g :transform="circleTrans[i]">
                        <template v-if="!isInput(i) && params.priority[i]">
                            <circle
                                cx="0"
                                cy="0"
                                r="16"
                                fill="none"
                                :stroke="color(i)"
                                stroke-width="3"
                            />
                            <image
                                v-if="props.building.filterId > 0"
                                :href="filterIcon"
                                width="24"
                                height="24"
                                x="-12"
                                y="-12"
                            ></image>
                            <text
                                v-else
                                fill="currentcolor"
                                x="0"
                                y="0"
                                textLength="24"
                                font-size="8"
                                text-anchor="middle"
                                dominant-baseline="middle"
                            >
                                过滤器
                            </text>
                        </template>
                        <circle v-else cx="0" cy="0" r="12" :fill="color(i)" />
                    </g>
                </g>
            </template>
        </svg>
        <div class="model" ref="glRoot"></div>
        <!-- 筛选器选择（复用物品/建筑两页签弹窗）；触发器隐藏，由端口左键二次点击直接 open() -->
        <ItemSelect
            ref="itemSelect"
            :itemId="filterItemId"
            @update:itemId="onFilterSelected"
            class="splitter-filter-trigger"
        />
    </div>
</template>

<script lang="ts" setup>
import { computed, inject, ref, watch, watchEffect } from "vue";
import { BlueprintBuilding, SplitterParameters } from "@/blueprint/parser";
import { itemsMap } from "@/data";
import {
    AmbientLight,
    BoxGeometry,
    DirectionalLight,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { attachRenderer } from "@/utils";
import { itemRecipeIconUrl } from "@/data/icons";
import { buildingInfoKey, commandQueueKey, rendererKey } from "@/define";
import {
    SetSplitterFilterCommand,
    SetSplitterPriorityCommand,
} from "@/blueprint/setSplitterPort";
import {
    splitterPortClickAction,
    splitterPortKind,
} from "@/blueprint/splitterPorts";
import ItemSelect from "./ItemSelect.vue";

const props = defineProps<{
    building: BlueprintBuilding;
}>();

const mainRenderer = inject(rendererKey)!.value!;
// 保持注入的 ref 并在 computed 里读 .value：data 是 shallowRef，
// 传送带连接后 buildingInfo 依赖 execVersion 重建，必须响应式跟踪才拿得到新邻接表。
const buildingInfoRef = inject(buildingInfoKey)!;
const queue = inject(commandQueueKey)!.value!;

/**
 * 面板数据版本号：priority / filterId / 连接关系都是原地修改
 * （props.building 与 buildings 数组都非响应式对象），每个命令都会令
 * `queue.stateVersion` 递增，在各 computed / watchEffect 里读它即可重算，
 * 保证"opacity 1↔0.5、口角色、筛选图标"与蓝图数据同步。
 * （与 StationInfo 同一套模式；不依赖 updateStationInfo 派发，
 * 因为 3D 场景重建时 registerUpdater 会 clearAll 掉所有派发回调。）
 */
const stateVersion = queue.stateVersion;

const adjacency = computed(() => {
    stateVersion.value;
    return buildingInfoRef.value?.adjacency[props.building.index] ?? [];
});
const isInput = (i: number) => {
    return adjacency.value[i].outputObjIdx === props.building.index;
};
const color = (i: number) => {
    return isInput(i) ? "#AFFFFF" : "#FCE88F";
};

const posFromCamera = computed(() => {
    const pos = new Matrix4();
    mainRenderer.cameraPosVersion;
    const model = mainRenderer.getModel(props.building.index);
    if (model) {
        // may be null when closing blueprint
        pos.multiplyMatrices(mainRenderer.camera.matrixWorldInverse, model);
    }
    return pos;
});

const offset = new Vector2();
const pos = new Vector3();
const defaultR = 90;
const offsetR = 16;
const circlePos = (i: number) => {
    const singleLine = props.building.modelIndex === 39;
    let deg;
    let r = defaultR;
    if (singleLine) {
        deg = Math.floor(i / 2) * 180.0;
    } else {
        deg = 90 * i;
        r -= offsetR;
    }
    const rad = ((deg + props.building.yaw[0]) / 180.0) * Math.PI;
    const c = new Vector2(Math.sin(rad), -Math.cos(rad)).multiplyScalar(r);

    if (singleLine) {
        pos.setFromMatrixPosition(posFromCamera.value);
        const up = i % 2 === 1 ? 1 : -1;
        offset
            .set(pos.x, -pos.y)
            .normalize()
            .multiplyScalar(offsetR * up);
        c.add(offset);
    }
    return c;
};
const circlePoses = computed(() => {
    const ps = new Array<Vector2>(4);
    for (let i = 0; i < ps.length; i++) {
        ps[i] = circlePos(i);
    }
    return ps;
});
const circleTrans = computed(() =>
    circlePoses.value.map((p) => `translate(${p.x} ${p.y})`)
);
const yaw = computed(() =>
    circlePoses.value.map((p) => (Math.atan2(p.y, p.x) / Math.PI) * 180 + 90)
);

const filterIcon = ref("");
watchEffect(async () => {
    stateVersion.value;
    filterIcon.value = "";
    if (props.building.filterId <= 0) return;
    const name = itemsMap.get(props.building.filterId)!.icon;
    filterIcon.value = await itemRecipeIconUrl(name);
});

const camera = new PerspectiveCamera(50.0);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setClearAlpha(0.0);
const glRoot = ref<HTMLElement | null>(null);
attachRenderer(glRoot, renderer);

const scene = new Scene();
const geometry = new BoxGeometry(1.0, 1.0, 1.0);
const material = new MeshStandardMaterial({
    color: 0xffffff,
    opacity: 0.5,
    transparent: true,
    depthWrite: false,
});
const model = new Mesh(geometry, material);
model.matrixAutoUpdate = false;
const dirLight = new DirectionalLight();
dirLight.position.set(0, 0, 1);
dirLight.target = model;
const envLight = new AmbientLight(0xffffff, 0.3);
scene.add(model, dirLight, envLight);

let animationFrame: null | number = null;
const updateModel = () => {
    animationFrame = null;
    pos.setFromMatrixPosition(posFromCamera.value);
    pos.normalize().multiplyScalar(8.0);
    model.matrix.copy(posFromCamera.value);
    model.matrix.setPosition(pos);
    camera.lookAt(pos);
    renderer.render(scene, camera);
};

watch(
    posFromCamera,
    () => {
        if (animationFrame === null) {
            animationFrame = requestAnimationFrame(updateModel);
        }
    },
    { immediate: true }
);

const params = computed(() => {
    stateVersion.value;
    return props.building.parameters as SplitterParameters;
});

// ---- 端口交互：左键设优先/开筛选，右键取消优先 ----

/** 该口的输入/输出角色（实时读取队列数据，点击时总是最新） */
const portKindAt = (i: number) =>
    splitterPortKind(queue.data.buildings, props.building.index, i);

/**
 * 左键点击口（与游戏一致）：
 * - 未设优先 → 设优先（opacity → 1）
 * - 已设优先且是输出口 → 再点进入筛选器选择界面（物品/建筑两页签）
 * - 已设优先但是输入口 → 无操作（取消用右键）
 */
const onPortLeft = (i: number) => {
    const p = props.building.parameters as SplitterParameters | null;
    const prioritized = p !== null && p.priority[i] === true;
    const action = splitterPortClickAction(prioritized, portKindAt(i));
    if (action === "priority") {
        queue.push(new SetSplitterPriorityCommand(props.building, i, true));
    } else if (action === "filter") {
        itemSelect.value?.open();
    }
};

/** 右键点击口：取消该口的优先（opacity → 0.5）；未设优先后无操作 */
const onPortRight = (i: number) => {
    const p = props.building.parameters as SplitterParameters | null;
    if (p !== null && p.priority[i] === true) {
        queue.push(new SetSplitterPriorityCommand(props.building, i, false));
    }
};

// ---- 筛选器选择界面（复用 ItemSelect：组件公式 / 建筑公式）----

const itemSelect = ref<InstanceType<typeof ItemSelect> | null>(null);
const filterItemId = computed(() => {
    stateVersion.value;
    return props.building.filterId > 0 ? props.building.filterId : null;
});
const onFilterSelected = (id: number | null) => {
    // null = 关闭弹窗未选择，忽略，避免清空已有筛选
    if (id === null) return;
    queue.push(new SetSplitterFilterCommand(props.building, id));
};
</script>

<style lang="scss">
.splitter-pannel {
    position: relative;

    svg {
        inset: 0;
        display: block;
    }
    .model {
        position: absolute;
        inset: 30%;
    }
    .splitter-port {
        cursor: pointer;
    }
    /* ItemSelect 触发器隐藏：筛选弹窗由端口左键二次点击直接 open() */
    .splitter-filter-trigger {
        display: none;
    }
}
</style>
