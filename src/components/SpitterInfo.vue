<template>
    <div class="splitter-pannel">
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
            <!--
                每个可用口：左键 = 设优先输入/输出（已优先的输出口再点一次打开筛选），
                右键 = 取消该口的优先。未连接的口也可以先设优先（游戏里连接后即生效）。
            -->
            <template v-for="p in portList" :key="p.port">
                <g
                    class="splitter-port"
                    :class="{
                        connected: p.connected,
                        prioritized: p.prioritized,
                    }"
                    :opacity="p.prioritized ? 1 : p.connected ? 0.7 : 0.3"
                    @click="onPortClick(p.port)"
                    @contextmenu.prevent="onPortClear(p.port)"
                >
                    <title>{{ portTitle(p) }}</title>
                    <path
                        d="M-5 -55l5 10 5 -10z"
                        :fill="p.fill"
                        :transform="
                            `rotate(${yaw[p.port]})` +
                            (p.isInput ? '' : 'rotate(180 0 -50)')
                        "
                    />
                    <g :transform="circleTrans[p.port]">
                        <template v-if="p.showFilter">
                            <circle
                                cx="0"
                                cy="0"
                                r="16"
                                fill="none"
                                :stroke="p.fill"
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
                                {{ t("过滤器") }}
                            </text>
                        </template>
                        <circle v-else cx="0" cy="0" r="12" :fill="p.fill" />
                    </g>
                </g>
            </template>
        </svg>
        <div class="model" ref="glRoot"></div>
    </div>
    <div class="splitter-ports">
        <div v-for="p in portList" :key="p.port" class="port-row">
            <span class="port-label">{{ t("端口") }} {{ p.port }}</span>
            <span
                class="port-kind"
                :class="p.kind === null ? 'none' : p.kind"
                >{{ p.kindText }}</span
            >
            <button
                type="button"
                class="prio-btn"
                :class="{ active: p.prioritized }"
                :title="t('左键设优先/筛选，右键取消')"
                @click="onPortClick(p.port)"
                @contextmenu.prevent="onPortClear(p.port)"
            >
                {{ p.prioritized ? t("取消优先") : t("设为优先") }}
            </button>
        </div>
        <div v-if="hasFilterPort" class="port-row filter-row">
            <span class="port-label">{{ t("筛选") }}</span>
            <ItemSelect
                ref="filterPicker"
                :itemId="filterIdValue"
                @update:itemId="onFilter"
            />
            <span class="filter-hint">{{ t("只作用于优先输出口") }}</span>
        </div>
        <div class="port-tip">
            {{ t("左键点端口：设优先输入/输出，输出口再点一次设置筛选；右键取消优先") }}
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed, inject, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { BlueprintBuilding, SplitterParameters } from "@/blueprint/parser";
import {
    splitterPortClickAction,
    splitterPortKinds,
    type SplitterPortKind,
} from "@/blueprint/splitterPorts";
import {
    SetSplitterFilterCommand,
    SetSplitterPriorityCommand,
} from "@/blueprint/setSplitterPort";
import { splitterPorts } from "@/data/splitter";
import ItemSelect from "./ItemSelect.vue";
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
import { commandQueueKey, rendererKey } from "@/define";

const props = defineProps<{
    building: BlueprintBuilding;
}>();

const mainRenderer = inject(rendererKey)!.value!;
const commandQueue = inject(commandQueueKey)!.value!;

/** 分流器参数/筛选变更后 bump：props.building 是原始对象，直接改字段不会触发 Vue 响应式 */
const version = ref(0);
commandQueue.updater.updateStationInfo.onMounted((b) => {
    if (b === props.building) version.value++;
});
const params = computed(() => {
    version.value;
    return props.building.parameters as SplitterParameters;
});

/**
 * 各口的角色（输入口 = 对端把货送进来，输出口 = 分流器把货送出去）。
 * 直接从当前蓝图数据算，不依赖 `BuildingInfo.adjacency`（后者是解析时构建的，增删分拣器后不刷新）。
 */
const kindsMap = computed(() => {
    version.value;
    const queue = commandQueue.value;
    // 分拣器/传送带增删也会改变口角色 → 依赖执行版本号
    queue?.execVersion.value;
    if (!queue) return new Map<number, SplitterPortKind>();
    return splitterPortKinds(queue.data.buildings, props.building.index);
});

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
    version.value;
    filterIcon.value = "";
    if (props.building.filterId <= 0) return;
    const name = itemsMap.get(props.building.filterId)!.icon;
    filterIcon.value = await itemRecipeIconUrl(name);
});

// ---- 口交互：左键设优先输入/输出，输出口再点一次设置筛选，右键取消优先 ----
const { t } = useI18n();
const filterPicker = ref<null | InstanceType<typeof ItemSelect>>(null);

/** 口列表（十字形 4 个 / 一字形 2 个）：含连接状态、角色、优先与筛选显示信息 */
const portList = computed(() => {
    const p = params.value;
    const filterId = props.building.filterId;
    return splitterPorts(props.building.modelIndex).map(({ port }) => {
        const kind = kindsMap.value.get(port) ?? null;
        const prioritized = p ? p.priority[port] === true : false;
        const filtered = prioritized && kind === "out" && filterId > 0;
        return {
            port,
            kind,
            connected: kind !== null,
            isInput: kind === "in",
            prioritized,
            /** 该口是否要画"优先输出 + 筛选"圈 */
            showFilter: prioritized && kind === "out",
            kindText:
                kind === "in"
                    ? t("输入口")
                    : kind === "out"
                    ? t("输出口")
                    : t("未连接"),
            fill: filtered
                ? "#c39bff"
                : prioritized
                ? "#FCE88F"
                : kind === "in"
                ? "#AFFFFF"
                : kind === "out"
                ? "#FCE88F"
                : "#888888",
        };
    });
});
const hasFilterPort = computed(() =>
    portList.value.some((p) => p.showFilter)
);
const filterIdValue = computed(() =>
    props.building.filterId > 0 ? props.building.filterId : null
);

/** 左键点口：未优先 → 设优先；已优先的输出口 → 打开筛选物品选择；已优先的输入口 → 无操作 */
function onPortClick(port: number) {
    const p = params.value;
    const action = splitterPortClickAction(
        p ? p.priority[port] === true : false,
        kindsMap.value.get(port) ?? null
    );
    if (action === "priority")
        commandQueue.value?.push(
            new SetSplitterPriorityCommand(props.building, port, true)
        );
    else if (action === "filter") filterPicker.value?.open();
}

/** 右键点口：取消该口的优先输入/输出（若已无优先输出口，命令内部会把筛选一并清空） */
function onPortClear(port: number) {
    const p = params.value;
    if (!p || p.priority[port] !== true) return;
    commandQueue.value?.push(
        new SetSplitterPriorityCommand(props.building, port, false)
    );
}

/** 选择筛选物品（null = 关闭弹窗未选择，忽略，避免清空筛选） */
function onFilter(itemId: number | null) {
    if (itemId === null) return;
    commandQueue.value?.push(
        new SetSplitterFilterCommand(props.building, itemId)
    );
}

/** 口标记的悬浮提示 */
function portTitle(p: {
    port: number;
    kindText: string;
    prioritized: boolean;
}): string {
    return (
        `${t("端口")} ${p.port} · ${p.kindText} · ` +
        (p.prioritized ? t("右键取消优先") : t("左键设为优先"))
    );
}

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
}

/* 分流器口列表：左键设优先/筛选，右键取消优先 */
.splitter-ports {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 6px 0 12px;

    .port-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .port-label {
        min-width: 52px;
        font-weight: bold;
    }

    .port-kind {
        min-width: 48px;
        font-size: 0.85em;
        color: #8ec9ff;

        &.in {
            color: #afffff;
        }
        &.out {
            color: #fce88f;
        }
        &.none {
            color: #888;
        }
    }

    .prio-btn {
        padding: 1px 8px;
        margin-left: auto;
        color: #ddd;
        cursor: pointer;
        background: #1f1f1f;
        border: 1px solid #555;
        border-radius: 3px;

        &.active {
            color: #111;
            background: #fce88f;
            border-color: #fce88f;
        }
        &:hover {
            border-color: #8ec9ff;
        }
    }

    .filter-row {
        .filter-hint {
            font-size: 0.8em;
            color: #999;
        }
    }

    .port-tip {
        font-size: 0.78em;
        color: #888;
        line-height: 1.35;
    }
}

.splitter-pannel .splitter-port {
    cursor: pointer;

    &:hover circle {
        stroke: #fff;
        stroke-width: 2;
    }
}
</style>

<i18n>
{
    "zh": {
        "端口": "端口",
        "输入口": "输入口",
        "输出口": "输出口",
        "未连接": "未连接",
        "设为优先": "设为优先",
        "取消优先": "取消优先",
        "筛选": "筛选",
        "只作用于优先输出口": "只作用于优先输出口",
        "左键设为优先": "左键设为优先",
        "右键取消优先": "右键取消优先",
        "左键设优先/筛选，右键取消": "左键设优先/筛选，右键取消",
        "左键点端口：设优先输入/输出，输出口再点一次设置筛选；右键取消优先": "左键点端口：设优先输入/输出，输出口再点一次设置筛选；右键取消优先",
        "过滤器": "过滤器"
    },
    "en": {
        "端口": "Port",
        "输入口": "Input",
        "输出口": "Output",
        "未连接": "Unconnected",
        "设为优先": "Set priority",
        "取消优先": "Clear priority",
        "筛选": "Filter",
        "只作用于优先输出口": "applies to prioritized output port",
        "左键设为优先": "left click: set priority",
        "右键取消优先": "right click: clear priority",
        "左键设优先/筛选，右键取消": "Left click: priority/filter. Right click: clear",
        "左键点端口：设优先输入/输出，输出口再点一次设置筛选；右键取消优先": "Left click a port: set input/output priority; click an output port again to set its filter; right click clears priority",
        "过滤器": "Filter"
    }
}
</i18n>
