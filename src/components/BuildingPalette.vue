<template>
    <div class="building-palette" :class="{ collapsed }">
        <div class="palette-buildings">
            <button
                v-for="(b, i) in currentBuildings"
                :key="b.itemId"
                v-show="!collapsed"
                class="palette-building"
                :class="{ disabled: b.disabled, selected: isSelected(b) }"
                :title="b.disabled ? t('暂不支持') : t(b.nameKey)"
                @click="onSelect(b)"
            >
                <BuildingIcon :icon-id="b.itemId" :alt="t(b.nameKey)" />
                <span class="fn-key">F{{ i + 1 }}</span>
            </button>
            <template v-if="isFoundationCategory">
                <button
                    v-show="!collapsed"
                    class="palette-building palette-action"
                    :title="t('导入照片生成地基蓝图')"
                    @click="emit('import-photo')"
                >
                    <span class="action-icon">照片</span>
                    <span class="fn-key">{{ t("导入照片") }}</span>
                </button>
                <button
                    v-show="!collapsed"
                    class="palette-building palette-action"
                    :title="t('自定义色槽 RGBA')"
                    @click="emit('open-rgba')"
                >
                    <span class="action-icon">RGBA</span>
                    <span class="fn-key">{{ t("RGBA 上色") }}</span>
                </button>
            </template>
        </div>
        <div class="palette-categories">
            <button
                v-for="cat in buildingCategories"
                :key="cat.key"
                class="palette-category"
                :class="{ active: placement.categoryIndex === cat.key }"
                @click="onCategory(cat.key)"
            >
                <span class="cat-num">{{ cat.key }}</span>
                <span class="cat-name">{{ t(cat.nameKey) }}</span>
            </button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import BuildingIcon from "./BuildingIcon.vue";
import {
    buildingCategories,
    CategoryBuilding,
} from "@/data/buildingCategories";
import {
    usePlacement,
    selectBuilding,
    selectFoundation,
} from "@/editor/placementState";

const { t } = useI18n();
const placement = usePlacement();

const emit = defineEmits<{
    (e: "import-photo"): void;
    (e: "open-rgba"): void;
}>();

const currentBuildings = computed(() => {
    const cat = buildingCategories.find(
        (c) => c.key === placement.categoryIndex
    );
    return cat ? cat.buildings : [];
});

const isFoundationCategory = computed(() => placement.categoryIndex === 9);

const isSelected = (b: CategoryBuilding) =>
    placement.selectedItemId === b.itemId &&
    (b.foundation
        ? placement.mode === "reforming"
        : placement.mode === "placing");

const onSelect = (b: CategoryBuilding) => {
    if (b.disabled) return;
    if (isSelected(b)) {
        // Clicking the selected building again exits placing
        placement.mode = "idle";
        placement.selectedItemId = null;
        placement.selectedModelIndex = null;
    } else if (b.foundation) {
        selectFoundation();
    } else {
        selectBuilding(b.itemId, b.modelIndex);
    }
};

const collapsed = ref(true); // 进入编辑模式即折叠
function collapse() {
    collapsed.value = true;
}
function expand() {
    collapsed.value = false;
}
/** 点击分类：切换分类并展开 */
const onCategory = (key: number) => {
    placement.categoryIndex = key;
    collapsed.value = false;
};
defineExpose({ collapse, expand });
</script>

<style lang="scss" scoped>
.building-palette {
    position: absolute;
    bottom: 0;
    // 展开与折叠统一：内容宽 + 水平居中，展开时只是多一行建筑图标
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    width: max-content;
    max-width: 100vw;
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
        width: 2.25rem;
        height: 2.25rem;
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

    &.palette-action {
        margin-left: 6px;
        border-color: #555;
        &:hover {
            border-color: #f90;
            background: #2e2a22;
        }
    }

    .action-icon {
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.68rem;
        font-weight: bold;
        letter-spacing: 0.5px;
        color: #f90;
        line-height: 1;
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
