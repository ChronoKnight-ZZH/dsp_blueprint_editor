<template>
    <Modal v-model:open="open">
        <h2>{{ t('选择图标') }}</h2>
        <div class="icon-picker-tabs">
            <div v-for="tab of tabs" :key="tab.id" class="icon-picker-tab"
                 :class="{ active: category === tab.id }"
                 @click="category = tab.id">{{ t(tab.label) }}</div>
        </div>
        <div class="icon-picker-grid">
            <button type="button" v-for="id of iconIds" :key="id" class="icon-cell"
                    :title="nameOf(id)" @click="choose(id)">
                <BuildingIcon :icon-id="id" :alt="nameOf(id)"/>
            </button>
        </div>
        <div class="icon-picker-actions">
            <button type="button" class="clear-btn" @click="clear">{{ t('清除图标') }}</button>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Modal from './ModalDSP.vue';
import BuildingIcon from './BuildingIcon.vue';
import { itemsMap } from '@/data/items';
import { recipesMap } from '@/data/recipes';
import { signal } from '@/data/signalIconsData';
import { tech } from '@/data/techIconsData';
import { itemIconId, recipeIconId, signalIconId, techIconId } from '@/data/icons';
import { itemName, recipeName } from '@/i18n';

const { t } = useI18n();

const open = ref(false);

defineExpose({
    open: () => open.value = true,
})

const emit = defineEmits<{
    (event: 'select', iconId: number): void,
}>();

type Category = 'item' | 'recipe' | 'signal' | 'tech';
const category = ref<Category>('item');

const tabs: { id: Category, label: string }[] = [
    { id: 'item',   label: '物品' },
    { id: 'recipe', label: '配方' },
    { id: 'signal', label: '信号' },
    { id: 'tech',   label: '科技' },
];

const itemIds = [...itemsMap.values()].map(i => itemIconId(i.id));
const recipeIds = [...recipesMap.values()].filter(r => r.icon).map(r => recipeIconId(r.id));
const signalIds = signal.map(s => signalIconId(s.id));
const techIds = tech.map(x => techIconId(x.id));

const iconsByCategory: Record<Category, number[]> = {
    item: itemIds,
    recipe: recipeIds,
    signal: signalIds,
    tech: techIds,
};
const iconIds = computed(() => iconsByCategory[category.value]);

const nameOf = (id: number): string => {
    if (id < 1000)
        return `${t('信号')} ${id}`;
    if (id < 20000)
        return itemName(id);
    if (id < 40000)
        return recipeName(id - 20000);
    return `${t('科技')} ${id - 40000}`;
}

const choose = (id: number) => {
    open.value = false;
    emit('select', id);
}

const clear = () => {
    open.value = false;
    emit('select', 0);
}
</script>

<style lang="scss">
.icon-picker-tabs {
    display: flex;
    gap: 8px;
}

.icon-picker-tab {
    padding: 2px 10px;
    border: 1px solid #fff6;
    opacity: 0.6;
    cursor: pointer;
    user-select: none;

    &.active {
        opacity: 1;
        background: #64a0dc;
    }
}

.icon-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 40px);
    gap: 2px;
    margin-top: 8px;
    padding: 4px;
    border: 1px solid #fff3;
    max-height: 55vh;
    overflow-y: auto;

    .icon-cell {
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;

        &:hover {
            background: #ffffff30;
        }

        .icon {
            width: 100%;
            height: 100%;
        }
    }
}

.icon-picker-actions {
    margin-top: 8px;
    text-align: end;

    .clear-btn {
        background: #c0392b;
    }
}
</style>

<i18n>
{
    "zh": {
        "选择图标": "选择图标",
        "物品": "物品",
        "配方": "配方",
        "信号": "信号",
        "科技": "科技",
        "清除图标": "清除图标"
    },
    "en": {
        "选择图标": "Select Icon",
        "物品": "Items",
        "配方": "Recipes",
        "信号": "Signals",
        "科技": "Tech",
        "清除图标": "Clear Icon"
    }
}
</i18n>
