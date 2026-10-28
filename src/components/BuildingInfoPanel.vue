<template>
    <h2>
        {{ t(buildingItem.name) }} <small>#{{ building.index }}</small>
    </h2>
    <RecipeSelect
        v-if="showRecipeRow"
        :recipeId="currentRecipeId > 0 ? currentRecipeId : null"
        @update:recipeId="onRecipeSelected"
        class="recipe-edit"
    >
        <BuildingRecipe
            v-if="currentRecipeId > 0"
            :recipeId="currentRecipeId"
        />
        <div v-else class="recipe-placeholder">{{ t("选择配方") }}</div>
    </RecipeSelect>

    <SplitterInfo v-if="isSplitter(building.itemId)" :building="building" />
    <StationInfo v-if="isStation(building.itemId)" :building="building" />
    <MonitorInfo v-if="isMonitor(building.itemId)" :building="building" />
    <BattleBaseInfo v-if="isBattleBase(building.itemId)" :building="building" />
    <StorageInfo v-if="isStorage(building.itemId)" :building="building" />
    <div class="building-params">
        <div v-if="isInserter(building.itemId)" class="filter-row">
            <label>{{ t("过滤器") }}</label>
            <ItemSelect
                :itemId="filterItem ? filterItem.id : null"
                @update:itemId="onFilter"
            />
            <button
                v-if="filterItem"
                class="clear-btn"
                type="button"
                @click="clearFilter"
            >
                ×
            </button>
        </div>
        <div
            v-if="isLab(building.itemId)"
            class="editable-row"
            @click="onLabModeClick"
        >
            <label>{{ t("模式") }}</label>
            <span class="v">{{ LabModeText }}</span>
        </div>
        <div v-if="accModeText !== undefined">
            <label>{{ t("增产剂效果") }}</label>
            <span class="v">{{ accModeText }}</span>
        </div>
        <div v-if="isInserter(building.itemId)">
            <label>{{ t("分拣长度") }}</label>
            <span class="v">{{ (bParams as InserterParameters).length }}</span>
        </div>
        <template v-if="isEjector(building.itemId)">
            <div>
                <label>{{ t("送入轨道") }}</label>
                <span class="v">{{
                    (bParams as EjectorParameters).orbitId === 0
                        ? t("不选轨道")
                        : (bParams as EjectorParameters).orbitId
                }}</span>
            </div>
            <div>
                <label>{{ t("十倍射速") }}</label>
                <span class="v">{{
                    truth((bParams as EjectorParameters).boost)
                }}</span>
            </div>
        </template>
        <div v-if="isEnergyExchanger(building.itemId)">
            <label>{{ t("模式") }}</label>
            <span class="v">{{ energyExchangerMode }}</span>
        </div>
        <div v-if="isRayReciver(building.itemId)">
            <label>{{ t("模式") }}</label>
            <span class="v">{{
                (bParams as PowerGeneratorParameters).productId > 0
                    ? t("光子生成")
                    : t("直接发电")
            }}</span>
        </div>
        <div v-if="isArtificialStar(building.itemId)">
            <label>{{ t("百倍发电") }}</label>
            <span class="v">{{
                truth((bParams as ArtifacialStarParameters).boost)
            }}</span>
        </div>
    </div>
    <div v-if="isBeltBuilding" class="belt-edit">
        <div class="belt-row">
            <label>{{ t("图标") }}</label>
            <ItemSelect
                :itemId="beltIconId > 0 ? beltIconId : null"
                @update:itemId="onBeltIcon"
            />
            <button
                v-if="beltIconId > 0"
                class="clear-btn"
                type="button"
                @click="clearBeltIcon"
            >
                ×
            </button>
        </div>
        <div class="belt-row">
            <label>{{ t("数量") }}</label>
            <input
                type="number"
                min="0"
                class="count-input"
                :value="beltCount"
                @change="onBeltCount"
            />
        </div>
    </div>
    <div class="tank-io" v-if="isTank(building.itemId)">
        <SwitchDSP :opened="(bParams as TankParameters).output">{{
            t("储液罐输出")
        }}</SwitchDSP>
        <SwitchDSP :opened="(bParams as TankParameters).input">{{
            t("储液罐输入")
        }}</SwitchDSP>
    </div>
    <DispenserInfo v-if="isDispenser(building.itemId)" :building="building" />
    <HoloBeaconInfo v-if="isHoloBeacon(building.itemId)" :building="building" />
    <Modal v-model:open="labModeModalOpen" v-if="isLab(building.itemId)">
        <h3>{{ t("研究模式") }}</h3>
        <div class="mode-list">
            <label v-for="m in labModes" :key="m" class="mode-option">
                <input
                    type="radio"
                    name="labMode"
                    :value="m"
                    :checked="labResearchMode === m"
                    @change="onLabModeSelected(m)"
                />
                {{ t(labModeTexts.get(m)!) }}
            </label>
        </div>
    </Modal>
    <DefaultInfo v-if="showDefaultInfo" :building="building" />
</template>

<script lang="ts">
import {
    ResearchMode,
    AcceleratorMode,
    EnergyExchangerMode,
} from "@/blueprint/parser";

const labModeTexts = new Map([
    [ResearchMode.None, "选择模式"],
    [ResearchMode.Compose, "矩阵合成"],
    [ResearchMode.Research, "科研模式"],
]);

const accModeTexts = new Map([
    [AcceleratorMode.ExtraOutput, "额外产出"],
    [AcceleratorMode.Accelerate, "加速生产"],
]);

const energyExchangerModeTexts = new Map([
    [EnergyExchangerMode.Discharge, "放电"],
    [EnergyExchangerMode.StandBy, "待机"],
    [EnergyExchangerMode.Charge, "充电"],
]);
</script>

<script lang="ts" setup>
import { computed, defineAsyncComponent, inject, ref } from "vue";
import { useI18n } from "vue-i18n";

import { truth } from "@/utils";
import {
    LabParamerters,
    AssembleParamerters,
    TankParameters,
    BlueprintBuilding,
    BeltParameters,
    InserterParameters,
    EjectorParameters,
    EnergyExchangerParameters,
    PowerGeneratorParameters,
    ArtifacialStarParameters,
} from "@/blueprint/parser";
import { recipesMap } from "@/data";
import { commandQueueKey } from "@/define";
import {
    SetBuildingRecipeCommand,
    SetLabResearchModeCommand,
} from "@/blueprint/setBuildingRecipe";
import { SetBeltParamsCommand } from "@/blueprint/setBeltParams";
import { SetSorterFilterCommand } from "@/blueprint/setSorterFilter";

import BuildingRecipe from "./BuildingRecipe.vue";
import RecipeSelect from "./RecipeSelect.vue";
import Modal from "./ModalDSP.vue";
import StationInfo from "./StationInfo.vue";
import MonitorInfo from "./MonitorInfo.vue";
import BattleBaseInfo from "./BattleBaseInfo.vue";
import StorageInfo from "./StorageInfo.vue";
import DispenserInfo from "./DispenserInfo.vue";
import HoloBeaconInfo from "./HoloBeaconInfo.vue";
import SwitchDSP from "./SwitchDSP.vue";
import DefaultInfo from "./DefaultInfo.vue";
import ItemSelect from "./ItemSelect.vue";
import {
    isLab,
    allAssemblers,
    isBelt,
    isStation,
    itemsMap,
    isInserter,
    isStorage,
    isTank,
    isEjector,
    isEnergyExchanger,
    isArtificialStar,
    isRayReciver,
    isMonitor,
    isSplitter,
    isBattleBase,
    isDispenser,
    isHoloBeacon,
} from "@/data/items";

const showDefaultInfo = computed(() => {
    const id = props.building.itemId;
    // 专属面板
    if (
        isSplitter(id) ||
        isStation(id) ||
        isMonitor(id) ||
        isBattleBase(id) ||
        isStorage(id) ||
        isDispenser(id) ||
        isHoloBeacon(id)
    )
        return false;
    // 内联字段
    if (showRecipeRow.value) return false;
    if (isLab(id)) return false;
    if (accModeText.value !== undefined) return false;
    if (isInserter(id)) return false;
    if (isEjector(id)) return false;
    if (isEnergyExchanger(id)) return false;
    if (isRayReciver(id)) return false;
    if (isArtificialStar(id)) return false;
    if (isBelt(id)) return false;
    if (isTank(id)) return false;
    return true;
});

const SplitterInfo = defineAsyncComponent(
    () => import(/* webpackChunkName: "renderer" */ "./SpitterInfo.vue")
);

const { t } = useI18n();

const commandQueue = inject(commandQueueKey)!.value!;

const props = defineProps<{
    building: BlueprintBuilding;
}>();

const buildingItem = computed(() => {
    return itemsMap.get(props.building.itemId)!;
});
const filterVersion = ref(0);
const filterItem = computed(() => {
    filterVersion.value;
    if (props.building.filterId <= 0) return null;
    return itemsMap.get(props.building.filterId)!;
});
commandQueue.updater.updateSorterIcon.onMounted((b) => {
    if (b === props.building) filterVersion.value++;
});

// 单体建筑数据变更（配方 / 研究模式）走 updateBuildingIcon 通道：
// data 是 shallowRef，直接改 building.recipeId / parameters.researchMode 不触发响应式，
// 需要通过版本号 bump 让下面的 computed 重新求值。
const buildingVersion = ref(0);
commandQueue.updater.updateBuildingIcon.onMounted((b) => {
    if (b === props.building) buildingVersion.value++;
});
const currentRecipeId = computed(() => {
    buildingVersion.value;
    return props.building.recipeId;
});
const showRecipeRow = computed(() => {
    if (isLab(props.building.itemId)) {
        return labResearchMode.value === ResearchMode.Compose;
    }
    if (allAssemblers.has(props.building.itemId)) {
        return true;
    }
    return currentRecipeId.value > 0;
});
const labResearchMode = computed(() => {
    buildingVersion.value;
    return (props.building.parameters as LabParamerters).researchMode;
});
const labModes = [
    ResearchMode.None,
    ResearchMode.Compose,
    ResearchMode.Research,
];
const labModeModalOpen = ref(false);

function onRecipeSelected(recipeId: number | null) {
    // null = RecipeSelect 关闭弹窗未选择，忽略，避免清空配方
    if (recipeId === null) return;
    commandQueue.push(new SetBuildingRecipeCommand(props.building, recipeId));
}

function onLabModeClick() {
    if (!props.building.parameters) return;
    labModeModalOpen.value = true;
}

function onLabModeSelected(mode: ResearchMode) {
    commandQueue.push(new SetLabResearchModeCommand(props.building, mode));
    labModeModalOpen.value = false;
}

const LabModeText = computed(() => {
    return t(labModeTexts.get(labResearchMode.value)!);
});
const productive = computed(() => {
    const recipeId = props.building.recipeId;
    if (recipeId === 0) return undefined;
    const recipe = recipesMap.get(recipeId)!;
    if (recipe.nonProductive) return false;
    let p = true;
    for (const i of recipe.to) p &&= i.item.productive === true;
    return p;
});
const accModeText = computed(() => {
    if (!allAssemblers.has(props.building.itemId)) return undefined;

    const p = productive.value;
    if (p === undefined) return undefined;
    let mode = AcceleratorMode.Accelerate;
    if (p)
        mode = (props.building!.parameters as AssembleParamerters)
            .acceleratorMode;
    return t(accModeTexts.get(mode)!);
});

const beltVersion = ref(0);
/**
 * 传送带参数：游戏里"没设过图标/数量"的传送带**没有 parameters 字段**，
 * 但工具必须能让用户给这类传送带设置图标与数量，所以 UI 按 null → 0/0 显示，
 * 真正写入时由 SetBeltParamsCommand 按需创建 `{iconId, count}`（与游戏编码一致）。
 */
const isBeltBuilding = computed(() => isBelt(props.building.itemId));
const beltIconId = computed(() => {
    beltVersion.value;
    const p = props.building.parameters as BeltParameters | null;
    return p ? p.iconId : 0;
});
const beltCount = computed(() => {
    beltVersion.value;
    const p = props.building.parameters as BeltParameters | null;
    return p ? p.count : 0;
});
commandQueue.updater.updateBeltIcon.onMounted((b) => {
    if (b === props.building) beltVersion.value++;
});

// 传送带图标：选择物品（null = 关闭弹窗未选，忽略）；× 按钮清零
function onBeltIcon(id: number | null) {
    if (id === null) return;
    commandQueue.push(new SetBeltParamsCommand(props.building, "iconId", id));
}
function clearBeltIcon() {
    commandQueue.push(new SetBeltParamsCommand(props.building, "iconId", 0));
}
function onBeltCount(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isNaN(v) || v < 0) return;
    commandQueue.push(new SetBeltParamsCommand(props.building, "count", v));
}
// 分拣器过滤器：选择物品（null 忽略）；× 清零（0 = 不过滤）
function onFilter(id: number | null) {
    if (id === null) return;
    commandQueue.push(new SetSorterFilterCommand(props.building, id));
}
function clearFilter() {
    commandQueue.push(new SetSorterFilterCommand(props.building, 0));
}

const bParams = computed(() => props.building.parameters);
const energyExchangerMode = computed(() => {
    const mode = (props.building.parameters as EnergyExchangerParameters).mode;
    return t(energyExchangerModeTexts.get(mode)!);
});
</script>

<style lang="scss">
.building-params {
    margin-bottom: 20px;
    h3 {
        margin-bottom: 0;
    }

    > div,
    .p {
        display: flex;
        flex-direction: row;
        margin-top: 4px;
    }
    .r {
        gap: 10px;
    }
    .p {
        gap: 5px;
    }
    label {
        display: inline-block;
        font-weight: bold;
    }
    .v {
        display: inline-block;
        text-align: right;
        flex: auto;
    }
}

/* 分拣器过滤器行（位于 .building-params 内） */
.filter-row {
    align-items: center;
    gap: 8px;
}

/* 传送带图标 / 数量编辑 */
.belt-edit {
    margin-bottom: 14px;

    .belt-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        margin-top: 6px;

        label {
            font-weight: bold;
            min-width: 48px;
        }
    }

    .count-input {
        width: 84px;
        padding: 2px 6px;
        color: #eee;
        background: #1f1f1f;
        border: 1px solid #444;
        border-radius: 3px;
    }
}

.clear-btn {
    width: 20px;
    height: 20px;
    padding: 0;
    line-height: 1;
    color: #ccc;
    cursor: pointer;
    background: transparent;
    border: 1px solid #666;
    border-radius: 3px;

    &:hover {
        color: #f88;
        background: #3a2222;
        border-color: #aa5555;
    }
}

.tank-io {
    display: flex;
    flex-direction: row;
    gap: 6px;

    .switch {
        flex: 1 50px;
    }
}

.recipe-edit {
    display: block;
    cursor: pointer;
    border-radius: 4px;
    padding: 2px 4px;
    margin: -2px -4px;
    transition: background 0.12s;

    &:hover {
        background: #2a2a2a;
    }

    /* 让 RecipeSelect 的 .icon-select 触发器透传点击 */
    .icon-select {
        display: block;
    }
}

.editable-row {
    cursor: pointer;
    border-radius: 4px;
    padding: 0 4px;
    margin: 0 -4px;
    transition: background 0.12s;

    &:hover {
        background: #2a2a2a;
    }
}

.mode-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0;
    min-width: 180px;

    .mode-option {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;

        &:hover {
            background: #2a2a2a;
        }

        input[type="radio"] {
            cursor: pointer;
        }
    }
}
.recipe-placeholder {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #888;
    font-style: italic;
    padding: 2px 6px;
    border: 1px dashed #555;
    border-radius: 4px;

    &::before {
        content: "+";
        font-style: normal;
        font-weight: bold;
    }
}

.recipe-edit:hover .recipe-placeholder {
    color: #ccc;
    border-color: #888;
}
</style>

<i18n>
{
    "zh": {
        "模式": "模式",
        "送入轨道": "送入轨道",
        "研究模式": "研究模式",
        "选择配方": "选择配方",
        "过滤器": "过滤器",
        "图标": "图标",
        "数量": "数量"
    },
    "en": {
        "模式": "Mode",
        "送入轨道": "Orbit",
        "研究模式": "Research Mode",
        "选择配方": "Select Recipe",
        "过滤器": "Filter",
        "图标": "Icon",
        "数量": "Count"
    },
    "fr": {
        "模式": "Mode",
        "送入轨道": "Orbit",
        "研究模式": "Mode de recherche",
        "选择配方": "Sélectionner une recette",
        "过滤器": "Filtre",
        "图标": "Icône",
        "数量": "Quantité"
    }
}
</i18n>
