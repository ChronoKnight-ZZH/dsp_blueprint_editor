<template>
    <div class="production-stats">
        <h2>{{ t('生产统计') }}</h2>
        <div class="options">
            <div class="accel-label">{{ t('增产剂：') }}</div>
            <div class="accel-icons">
                <button type="button" class="icon-cell"
                        :class="{ selected: acceleratorItem === AccItem.None }"
                        :title="t('无')" @click="acceleratorItem = AccItem.None">
                    <span class="none-text">{{ t('无') }}</span>
                </button>
                <button v-for="m in acceleratorOptions" :key="m.level" type="button" class="icon-cell"
                        :class="{ selected: acceleratorItem === m.level }"
                        :title="itemName(m.itemId)" @click="acceleratorItem = m.level">
                    <BuildingIcon :icon-id="itemIconId(m.itemId)" :alt="itemName(m.itemId)" />
                </button>
            </div>
        </div>
        <div class="power">
            <span>{{ t('总电力需求：') }}</span>
            <span class="power-value">{{ formatPower(stats.totalPower) }}</span>
        </div>
        <table v-if="stats.items.length > 0">
            <thead>
                <tr>
                    <th class="col-item">
                        <button type="button" class="sort-btn" @click="setSort('item')">
                            <span>{{ t('物品') }}</span>
                            <span class="sort-arrow" :class="{ active: sortKey === 'item' }">{{ sortArrow('item') }}</span>
                        </button>
                    </th>
                    <th class="col-num">
                        <button type="button" class="sort-btn" @click="setSort('produced')">
                            <span>{{ t('产出/分') }}</span>
                            <span class="sort-arrow" :class="{ active: sortKey === 'produced' }">{{ sortArrow('produced') }}</span>
                        </button>
                    </th>
                    <th class="col-num">
                        <button type="button" class="sort-btn" @click="setSort('consumed')">
                            <span>{{ t('消耗/分') }}</span>
                            <span class="sort-arrow" :class="{ active: sortKey === 'consumed' }">{{ sortArrow('consumed') }}</span>
                        </button>
                    </th>
                    <th class="col-num">
                        <button type="button" class="sort-btn" @click="setSort('net')">
                            <span>{{ t('净产出/分') }}</span>
                            <span class="sort-arrow" :class="{ active: sortKey === 'net' }">{{ sortArrow('net') }}</span>
                        </button>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item in sortedItems" :key="item.itemId">
                    <td class="col-item">
                        <BuildingIcon :icon-id="itemIconId(item.itemId)" :alt="itemName(item.itemId)" />
                        <span class="item-text">{{ itemName(item.itemId) }}</span>
                    </td>
                    <td class="col-num">{{ formatRate(item.produced) }}</td>
                    <td class="col-num">{{ formatRate(item.consumed) }}</td>
                    <td class="col-num" :class="{ negative: item.net < 0 }">{{ formatRate(item.net) }}</td>
                </tr>
            </tbody>
        </table>
        <div v-else class="empty-hint">{{ t('暂无生产数据') }}</div>
        <div class="notes">
            <div class="notes-title">{{ t('备注') }}</div>
            <div class="notes-body i18n-text">{{ t('备注说明') }}</div>
        </div>
    </div>
</template>

<script lang="ts">
import { ref } from "vue";

import { AcceleratorItem } from "@/data/acceleratorData";

// 模块级状态：tab 切换时组件会被卸载/重挂载（App.vue 用 v-if 渲染），
// 放在组件外可保证增产剂选择不丢失
const sharedAcceleratorItem = ref(AcceleratorItem.None);
</script>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";

import { commandQueueKey } from "@/define";
import { calculateProductionStats, ProductionStats as ProductionStatsResult, StatsOptions } from "@/blueprint/stats";
import { itemIconId } from "@/data/icons";
import { itemName } from "@/i18n";
import BuildingIcon from "./BuildingIcon.vue";

const { t } = useI18n();

const queueRef = inject(commandQueueKey);
// 引用模块级共享状态，组件重挂载时选择不丢失
const acceleratorItem = sharedAcceleratorItem;
// 枚举来自普通 <script> 块（模块作用域），取别名暴露给模板
const AccItem = AcceleratorItem;

/** 增产剂等级 -> 游戏物品 ID（用于取真实材料图标） */
const acceleratorOptions = [
    { level: AccItem.MkI, itemId: 1141 },
    { level: AccItem.MkII, itemId: 1142 },
    { level: AccItem.MkIII, itemId: 1143 },
];

const emptyResult: ProductionStatsResult = { items: [], totalPower: 0 };

/** 排序：默认按净产出倒序；点击同一列表头在正序/倒序间切换 */
type SortKey = 'item' | 'produced' | 'consumed' | 'net';
const sortKey = ref<SortKey>('net');
const sortDir = ref<'asc' | 'desc'>('desc');

const setSort = (key: SortKey) => {
    if (sortKey.value === key)
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    else {
        sortKey.value = key;
        sortDir.value = 'desc';
    }
};

/** 表头箭头：当前排序列显示正/倒序箭头，其余显示淡色双向箭头 */
const sortArrow = (key: SortKey) => {
    if (key !== sortKey.value)
        return '⇅';
    return sortDir.value === 'asc' ? '▲' : '▼';
};

const stats = computed<ProductionStatsResult>(() => {
    const queue = queueRef?.value;
    if (!queue)
        return emptyResult;
    // stateVersion 在任何命令（含替换配方/加速模式等 silent 命令）后都递增，
    // 保证统计结果随蓝图编辑自动刷新
    queue.stateVersion.value;
    const options: StatsOptions = {
        useAccelerator: acceleratorItem.value !== AccItem.None,
        acceleratorItem: acceleratorItem.value,
    };
    return calculateProductionStats(queue.data, options);
});

const sortedItems = computed(() => {
    const dir = sortDir.value === 'asc' ? 1 : -1;
    return [...stats.value.items].sort((a, b) => {
        let cmp: number;
        if (sortKey.value === 'item')
            cmp = itemName(a.itemId).localeCompare(itemName(b.itemId));
        else
            cmp = a[sortKey.value] - b[sortKey.value];
        return cmp * dir;
    });
});

const formatRate = (v: number) => {
    const abs = Math.abs(v);
    return abs >= 100 ? v.toFixed(0) : abs >= 1 ? v.toFixed(1) : v.toFixed(2);
};

const formatPower = (kW: number) => {
    if (kW > 1000000){
        return `${(kW / 1000000).toFixed(2)} GW`;
    }else if (kW > 1000){
        return `${(kW / 1000).toFixed(2)} MW`;
    }else if (kW > 0){
        return `${kW.toFixed(1)} kW`;
    }else{
        return ` 0 kW`;
    }
};
</script>

<style lang="scss" scoped>
.i18n-text {
  white-space: pre-line;
}
.production-stats {
    h2 {
        font-size: 1rem;
        margin: 6px 0;
    }

    .options {
        display: flex;
        flex-direction: column;
        gap: 4px;

        .accel-label {
            font-size: 0.85rem;
        }

        .accel-icons {
            display: flex;
            flex-direction: row;
            gap: 4px;
        }

        .icon-cell {
            width: 38px;
            height: 38px;
            padding: 2px;
            border: 2px solid transparent;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;

            &:hover {
                background: #ffffff20;
            }

            &.selected {
                border-color: #4a9eff;
                background: #4a9eff33;
            }

            .none-text {
                font-size: 0.8rem;
            }

            :deep(.icon) {
                width: 28px;
                height: 28px;
                margin: 0;
            }
        }
    }

    .power {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        margin: 8px 0;
        font-size: 0.9rem;

        .power-value {
            color: #ffd166;
        }
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;

        th, td {
            padding: 2px 2px;
            border-bottom: 1px solid #ffffff20;
        }

        .col-item {
            text-align: start;
            white-space: nowrap;

            .item-text {
                vertical-align: middle;
            }
        }

        .col-num {
            text-align: end;
            white-space: nowrap;
        }

        thead th {
            color: #9ec7eb;
        }

        .sort-btn {
            width: 100%;
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 2px;

            &:hover {
                color: #ffffff;
            }
        }

        .col-num .sort-btn {
            justify-content: flex-end;
        }

        .sort-arrow {
            font-size: 0.7rem;
            color: #ffffff50;

            &.active {
                color: #4a9eff;
            }
        }

        td.negative {
            color: #ff7b7b;
        }
    }

    .empty-hint {
        color: gray;
        font-size: 0.85rem;
    }

    .notes {
        margin-top: 10px;
        padding: 6px 8px;
        border: 1px solid #ffffff30;
        border-radius: 4px;
        background: #ffffff10;

        .notes-title {
            font-size: 0.8rem;
            color: #9ec7eb;
            margin-bottom: 2px;
        }

        .notes-body {
            font-size: 0.78rem;
            color: #d0d0d0;
        }
    }

    /* 表格内的建筑图标缩小到 20px */
    :deep(.icon) {
        width: 1.25rem;
        display: inline-block;
        vertical-align: middle;
        margin-right: 2px;
    }
}
</style>

<i18n>
{
    "zh": {
        "生产统计": "生产统计",
        "增产剂：": "增产剂：",
        "无": "无",
        "增产剂 Mk.I": "增产剂 Mk.I",
        "增产剂 Mk.II": "增产剂 Mk.II",
        "增产剂 Mk.III": "增产剂 Mk.III",
        "总电力需求：": "总电力需求：",
        "物品": "物品",
        "产出/分": "产出/分",
        "消耗/分": "消耗/分",
        "净产出/分": "净产出/分",
        "暂无生产数据": "暂无生产数据",
        "备注": "备注",
        "备注说明": "1.默认增产剂Mk.III为自喷涂增产剂。\n 2.分馏塔的输入默认为7200/分。\n3.电力计算暂不包含物流塔"
    },
    "en": {
        "生产统计": "Production Stats",
        "增产剂：": "Proliferator: ",
        "无": "None",
        "增产剂 Mk.I": "Proliferator Mk.I",
        "增产剂 Mk.II": "Proliferator Mk.II",
        "增产剂 Mk.III": "Proliferator Mk.III",
        "总电力需求：": "Total power: ",
        "物品": "Item",
        "产出/分": "Output/min",
        "消耗/分": "Input/min",
        "净产出/分": "Net/min",
        "暂无生产数据": "No production data",
        "备注": "Notes",
        "备注说明": "1. Default proliferator Mk.III is self-paint.\n 2. Distillation tower input default is 7200/minute.\n3. Power calculation does not include logistics towers."
    }
}
</i18n>
