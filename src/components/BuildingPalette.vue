<template>
    <div class="building-palette">
        <div class="palette-buildings">
            <button v-for="(b, i) in currentBuildings" :key="b.itemId"
                class="palette-building"
                :class="{ disabled: b.disabled, selected: isSelected(b) }"
                :title="b.disabled ? t('暂不支持') : t(b.nameKey)"
                @click="onSelect(b)">
                <BuildingIcon :iconId="b.itemId" :alt="t(b.nameKey)" />
                <span class="fn-key">F{{ i + 1 }}</span>
            </button>
        </div>
        <div class="palette-categories">
            <button v-for="cat in buildingCategories" :key="cat.key"
                class="palette-category"
                :class="{ active: placement.categoryIndex === cat.key }"
                @click="placement.categoryIndex = cat.key">
                <span class="cat-num">{{ cat.key }}</span>
                <span class="cat-name">{{ t(cat.nameKey) }}</span>
            </button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BuildingIcon from './BuildingIcon.vue';
import { buildingCategories, CategoryBuilding } from '@/data/buildingCategories';
import { usePlacement, selectBuilding } from '@/editor/placementState';

const { t } = useI18n();
const placement = usePlacement();

const currentBuildings = computed(() => {
    const cat = buildingCategories.find(c => c.key === placement.categoryIndex);
    return cat ? cat.buildings : [];
});

const isSelected = (b: CategoryBuilding) =>
    placement.selectedItemId === b.itemId && placement.mode === 'placing';

const onSelect = (b: CategoryBuilding) => {
    if (b.disabled) return;
    if (isSelected(b)) {
        // Clicking the selected building again exits placing
        placement.mode = 'idle';
        placement.selectedItemId = null;
        placement.selectedModelIndex = null;
    } else {
        selectBuilding(b.itemId, b.modelIndex);
    }
};
</script>

<style lang="scss" scoped>
.building-palette {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: #000000c0;
    color: white;
    user-select: none;
    z-index: 10;
}

.palette-buildings {
    display: flex;
    flex-direction: row;
    gap: 2px;
    padding: 4px 8px;
    overflow-x: auto;
}

.palette-building {
    position: relative;
    background: #1a1a2e;
    border: 2px solid transparent;
    padding: 2px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: border-color 0.1s, background 0.1s;

    .icon {
        width: 2.5rem;
        height: 2.5rem;
        img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
    }

    .fn-key {
        font-size: 0.65rem;
        color: #888;
        line-height: 1;
    }

    &:hover {
        background: #2a2a4e;
        border-color: #4a8;
    }

    &.selected {
        border-color: #4af;
        background: #2a3a5e;
    }

    &.disabled {
        opacity: 0.35;
        cursor: not-allowed;
        &:hover {
            border-color: transparent;
            background: #1a1a2e;
        }
    }
}

.palette-categories {
    display: flex;
    flex-direction: row;
    gap: 1px;
    padding: 0 8px 4px;
}

.palette-category {
    background: #222;
    border: 0;
    color: #aaa;
    padding: 3px 8px;
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: 3px;

    .cat-num {
        color: #64a0dc;
        font-weight: bold;
    }

    &:hover {
        background: #333;
        color: #fff;
    }

    &.active {
        background: #2a3a5e;
        color: #fff;
    }
}
</style>
