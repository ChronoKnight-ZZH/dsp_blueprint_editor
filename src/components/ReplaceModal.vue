<template>
    <Modal v-model:open="open">
        <h2>{{t('批量替换')}}</h2>
        <template v-if="r.scope.buildingLevel">
            <div>{{t('源建筑：')}}</div>
            <div class="icon-row">
                <span v-for="id in sourceOptions" :key="id" class="icon-cell"
                      :class="{selected: r.sourceItemId === id}"
                      :title="itemName(id)" @click="r.sourceItemId = id">
                    <BuildingIcon :icon-id="itemIconId(id)" :alt="itemName(id)"/>
                </span>
            </div>
            <div>{{t('目标建筑：')}}</div>
            <div class="icon-row">
                <span v-if="targetOptions.length === 0" class="empty-hint">{{t('请选择源建筑')}}</span>
                <span v-for="id in targetOptions" :key="id" class="icon-cell"
                      :class="{selected: r.targetItemId === id}"
                      :title="itemName(id)" @click="r.targetItemId = id">
                    <BuildingIcon :icon-id="itemIconId(id)" :alt="itemName(id)"/>
                </span>
            </div>
        </template>
        <template v-else>
            <div>{{t('搜索：')}} <RecipeSelect v-model:recipeId="r.searchRecipe"/></div>
            <div>{{t('替换：')}} <RecipeSelect v-model:recipeId="r.replaceRecipe"/></div>
        </template>
        <div>
            {{t('范围：')}}
            <span class="replace-scope">
                <input type="checkbox" id="replace-recipe" v-model="r.scope.recipe" @change="onScopeChange('recipe')"><label for="replace-recipe">{{t('配方')}}</label>
            </span>
            <span class="replace-scope">
                <input type="checkbox" id="replace-filter" v-model="r.scope.filter" @change="onScopeChange('filter')"><label for="replace-filter">{{t('分拣器筛选')}}</label>
            </span>
            <span class="replace-scope">
                <input type="checkbox" id="replace-station" v-model="r.scope.station" @change="onScopeChange('station')"><label for="replace-station">{{t('物流塔栏位')}}</label>
            </span>
            <span class="replace-scope">
                <input type="checkbox" id="replace-band-icon" v-model="r.scope.beltIcon" @change="onScopeChange('beltIcon')"><label for="replace-band-icon">{{t('传送带图标')}}</label>
            </span>
            <span class="replace-scope">
                <input type="checkbox" id="replace-bp-icon" v-model="r.scope.blueprintIcon" @change="onScopeChange('blueprintIcon')"><label for="replace-bp-icon">{{t('蓝图图标')}}</label>
            </span>
            <span class="replace-scope">
                <input type="checkbox" id="replace-building-level" v-model="r.scope.buildingLevel" @change="onScopeChange('buildingLevel')"><label for="replace-building-level">{{t('升降建筑等级')}}</label>
            </span>
        </div>
        <div>
            <button @click="execute" :disabled="!canExecute">{{t('全部替换')}}</button>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { ReplaceCommand, ReplaceParams } from "@/blueprint/replace";
import { UpgradeCommand, upgradeableItems, reachableTargets } from "@/blueprint/upgrade";
import { BlueprintData } from "@/blueprint/parser";
import Modal from "./ModalDSP.vue";
import RecipeSelect from "./RecipeSelect.vue";
import BuildingIcon from "./BuildingIcon.vue";
import { itemIconId } from "@/data/icons";
import { itemName } from "@/i18n";
import { commandQueueKey } from "@/define";

const { t } = useI18n();
const commandQueue = inject(commandQueueKey)!.value!;

const open = ref(false);

defineExpose({
    open: () => open.value = true,
})

const r = reactive({
    searchRecipe: null as null | number,
    replaceRecipe: null as null | number,
    sourceItemId: null as null | number,
    targetItemId: null as null | number,
    scope: {
        recipe: true,
        filter: true,
        station: true,
        beltIcon: true,
        blueprintIcon: true,
        buildingLevel: false,
    },
});

const props = defineProps<{blueprint: BlueprintData}>()

// 升降级：源建筑候选 = 全部可升降级建筑
const targetItemOrder:number[] = [2001, 2002, 2003, 2011, 2012, 2013, 2014, 2303, 2304, 2305, 2318, 2302, 2315, 2319, 2309, 2317, 2901, 2902]
const sourceOptions = computed(() => {
    return upgradeableItems.filter(id => targetItemOrder.includes(id)).sort((a, b) => targetItemOrder.indexOf(a) - targetItemOrder.indexOf(b));
});
// 目标建筑候选 = 从源建筑可达的全部节点（升级 + 降级，含跳级）
const targetOptions = computed(() => {
    if (r.sourceItemId === null)
        return [];
    return reachableTargets(r.sourceItemId);
});

// 切换源建筑时清空已选目标，避免出现非法组合
watch(() => r.sourceItemId, () => { r.targetItemId = null; });

/**
 * 范围多选组的互斥逻辑：
 * “升降建筑等级”与其余所有选项互斥——勾选它时清空其它，勾选任意其它时清空它。
 */
const otherScopes = ['recipe', 'filter', 'station', 'beltIcon', 'blueprintIcon'] as const;
const onScopeChange = (key: typeof otherScopes[number] | 'buildingLevel') => {
    if (key === 'buildingLevel') {
        if (r.scope.buildingLevel)
            for (const k of otherScopes)
                r.scope[k] = false;
    } else {
        if (r.scope[key])
            r.scope.buildingLevel = false;
    }
};

// 切回非升降级模式时清空升降级选择，避免脏数据
watch(() => r.scope.buildingLevel, (lv) => {
    if (!lv) {
        r.sourceItemId = null;
        r.targetItemId = null;
    }
});

const canExecute = computed(() => {
    if (r.scope.buildingLevel)
        return r.sourceItemId !== null && r.targetItemId !== null;
    return r.searchRecipe !== null && r.replaceRecipe !== null
        && Object.values(r.scope).some(s => s);
})

const execute = () => {
    if (!canExecute.value)
        return;
    if (r.scope.buildingLevel) {
        commandQueue.push(new UpgradeCommand(props.blueprint, r.sourceItemId!, r.targetItemId!));
    } else {
        commandQueue.push(new ReplaceCommand(props.blueprint, r as ReplaceParams));
    }
    open.value = false;
}
</script>

<style lang="scss">
.replace-scope {
    display: inline-block;
    margin-left: 10px;

    @media screen and (max-width: 360px) {
        display: block;
    }
}

.icon-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0.25rem 0 0.75rem;
}

.icon-cell {
    display: inline-block;
    cursor: pointer;
    border-radius: 4px;
    padding: 2px;

    &:hover {
        outline: 1px solid rgba(120, 180, 255, .7);
    }

    &.selected {
        outline: 2px solid #6cf;
    }
}

.empty-hint {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.8rem;
}
</style>

<i18n>
{
    "zh": {
        "批量替换": "批量替换",
        "搜索：": "搜索：",
        "替换：": "替换：",
        "范围：": "范围：",
        "配方": "配方",
        "分拣器筛选": "分拣器筛选",
        "物流塔栏位": "物流塔栏位",
        "传送带图标": "传送带图标",
        "蓝图图标": "蓝图图标",
        "升降建筑等级": "升降建筑等级",
        "源建筑：": "源建筑：",
        "目标建筑：": "目标建筑：",
        "请选择源建筑": "请选择源建筑",
        "全部替换": "全部替换",
    },
    "en": {
        "批量替换": "Batch Replace",
        "搜索：": "Search:",
        "替换：": "Replace:",
        "范围：": "Scope:",
        "配方": "Recipe",
        "分拣器筛选": "Sorter",
        "物流塔栏位": "Station",
        "传送带图标": "Belt Icon",
        "蓝图图标": "Blueprint Icon",
        "升降建筑等级": "Building Level",
        "源建筑：": "Source:",
        "目标建筑：": "Target:",
        "请选择源建筑": "Select a source building",
        "全部替换": "Replace All",
    },
    "fr": {
        "批量替换": "Remplacer en vrac",
        "搜索：": "Recherche:",
        "替换：": "Remplacer:",
        "范围：": "Portée:",
        "配方": "Recette",
        "分拣器筛选": "Trieuse",
        "物流塔栏位": "Station",
        "传送带图标": "Icône de ceinture",
        "蓝图图标": "Icône de plan",
        "升降建筑等级": "Niveau du bâtiment",
        "源建筑：": "Source:",
        "目标建筑：": "Cible:",
        "请选择源建筑": "Sélectionnez un bâtiment source",
        "全部替换": "Tout remplacer",
    }
}
</i18n>
