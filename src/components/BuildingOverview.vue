<template>
    <h2 class="overview-header">
        {{ t("包含设施") }}
    </h2>
    <div class="overview-hint">{{ t("右键点击剔除") }}</div>
    <p>{{ t("共{total}个", { total }) }}</p>
    <div class="overview-icons">
        <span
            v-for="[itemId, count] in buildingCounter"
            :key="itemId"
            class="overview-icon-item"
            :title="
                itemId === FOUNDATION_ITEM_ID
                    ? t('地基不可在此剔除')
                    : t('右键删除全部此类建筑')
            "
            @contextmenu.prevent="onIconContextMenu(itemId)"
        >
            <BuildingIcon
                :icon-id="itemIconId(itemId)"
                :alt="itemName(itemId)"
                :count="count"
            />
        </span>
    </div>
</template>

<script lang="ts" setup>
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";

import { commandQueueKey } from "@/define";
import BuildingIcon from "./BuildingIcon.vue";
import { itemIconId } from "@/data/icons";
import { itemName } from "@/i18n";

const { t } = useI18n();

const emit = defineEmits<{
    (e: "remove-by-item", itemId: number): void;
}>();

const commandQueue = inject(commandQueueKey)!.value!;

/** 地基对应的 itemId（items 表中 "地基"） */
const FOUNDATION_ITEM_ID = 1131;

const onIconContextMenu = (itemId: number) => {
    // 地基来自 reformData（地形改造），不属于 buildings 数组，无法通过剔除命令删除
    if (itemId === FOUNDATION_ITEM_ID) return;
    // 右键列表图标：一键剔除全部同类建筑（可 Ctrl+Z 撤销）
    emit("remove-by-item", itemId);
};

/** 地基瓦片数 = Σ(矩形宽 × 高) */
const foundationTiles = computed(() => {
    commandQueue.execVersion.value;
    const rects = commandQueue.data.reformData?.rects;
    if (!rects) return 0;
    let tiles = 0;
    for (const r of rects) tiles += r.w * r.h;
    return tiles;
});

const total = computed(() => {
    // 命令（剔除同类 / 撤销 / 重做）后重新统计
    commandQueue.execVersion.value;
    return commandQueue.data.buildings.length + foundationTiles.value;
});

const buildingCounter = computed(() => {
    commandQueue.execVersion.value;
    const counter = new Map<number, number>();
    for (const b of commandQueue.data.buildings) {
        const count = counter.get(b.itemId) ?? 0;
        counter.set(b.itemId, count + 1);
    }
    // 地基按瓦片数作为一项建筑计入列表
    const tiles = foundationTiles.value;
    if (tiles > 0)
        counter.set(
            FOUNDATION_ITEM_ID,
            (counter.get(FOUNDATION_ITEM_ID) ?? 0) + tiles
        );
    return counter;
});
</script>

<style>
.overview-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
}

.overview-hint {
    font-size: 0.78rem;
    font-weight: normal;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
}

.overview-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.overview-icon-item {
    display: inline-block;
    cursor: context-menu;
    border-radius: 4px;

    &:hover {
        outline: 1px solid rgba(230, 80, 80, 0.7);
    }
}
</style>

<i18n>
{
    "zh": {
        "共{total}个": "共{total}个",
        "右键点击剔除": "右键点击建筑可剔除；右键图标删除全部同类",
        "右键删除全部此类建筑": "右键一键删除全部此类建筑（可撤销）",
        "地基不可在此剔除": "地基（地形改造），按瓦片计数，不可在此剔除",
    },
    "en": {
        "共{total}个": "{total} in total",
        "右键点击剔除": "Right-click a building to remove it; right-click an icon to remove all of that type",
        "右键删除全部此类建筑": "Right-click to remove all buildings of this type (undoable)",
        "地基不可在此剔除": "Foundation (terrain reform), counted by tile; cannot be removed here",
    },
    "fr": {
        "共{total}个": "{total} au total",
        "右键点击剔除": "Clic droit sur un bâtiment pour le retirer ; clic droit sur une icône pour tout retirer du même type",
        "右键删除全部此类建筑": "Clic droit pour retirer tous les bâtiments de ce type (annulable)",
        "地基不可在此剔除": "Fondation (terrain), comptée par tuile ; suppression impossible ici",
    }
}
</i18n>
