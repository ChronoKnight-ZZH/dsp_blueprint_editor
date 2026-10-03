<template>
    <div class="shortcut-hint">
        <div class="hint-title" @click="collapsed = !collapsed">
            <span class="hint-arrow">{{ collapsed ? '▸' : '▾' }}</span>
            {{ t('当前模式') }}：{{ t(modeTitle) }}
        </div>
        <div v-if="!collapsed" class="hint-rows">
            <div v-for="row of rows" :key="row[0]" class="hint-row">
                <span class="hint-key">{{ t(row[0]) }}</span>
                <span class="hint-action">{{ t(row[1]) }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePlacement } from '@/editor/placementState';

const { t } = useI18n();
const placement = usePlacement();

const collapsed = ref(false);

const modeTitle = computed(() => {
    if (placement.appMode === 'preview')
        return '预览模式';
    return placement.mode === 'deleting' ? '删除模式' : '编辑模式';
});

// 仅列已实现的快捷键
const rows = computed<[string, string][]>(() => {
    if (placement.appMode === 'preview')
        return [
            ['左键', '选中建筑'],
            ['右键', '删除建筑'],
            ['滚轮', '缩放'],
            ['拖拽', '旋转'],
            ['0 / O', '显示/隐藏列表'],
            ['WASD', '上下左右滚动'],
            ['N', '重置镜头'],
        ];
    if (placement.mode === 'deleting')
        return [
            ['左键', '删除建筑'],
            ['右键 / Esc', '退出删除'],
            ['N', '重置镜头'],
        ];
    return [
        ['1-9', '切换分类'],
        ['F1-F12', '选建筑'],
        ['左键', '放置建筑'],
        ['R', '旋转 90°'],
        ['X', '删除模式'],
        ['Esc', '取消/收起'],
        ['Shift', '自由放置'],
        ['N', '重置镜头'],
    ];
});
</script>

<style lang="scss" scoped>
.shortcut-hint {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: #00000080;
    color: white;
    font-size: 0.8rem;
    padding: 6px 12px;
    border-radius: 0 6px 6px 0;
    user-select: none;
}

.hint-title {
    cursor: pointer;
    font-weight: bold;
    white-space: nowrap;

    .hint-arrow {
        display: inline-block;
        width: 1em;
        color: #64a0dc;
    }

    &:hover {
        color: #a8d0f0;
    }
}

.hint-rows {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.hint-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    white-space: nowrap;

    .hint-key {
        flex: none;
        min-width: 56px;
        text-align: end;
        color: #8ec9ff;
        font-family: 'Menlo', 'Consolas', monospace;
        font-size: 0.72rem;
    }

    .hint-action {
        color: #ddd;
    }
}
</style>

<i18n>
{
    "zh": {
        "当前模式": "当前模式",
        "预览模式": "预览模式",
        "编辑模式": "编辑模式",
        "删除模式": "删除模式",
        "选中建筑": "选中建筑",
        "删除建筑": "删除建筑",
        "缩放": "缩放",
        "旋转": "旋转",
        "显示/隐藏列表": "显示/隐藏列表",
        "上下左右滚动": "上下左右滚动",
        "重置镜头": "重置镜头",
        "切换分类": "切换分类",
        "选建筑": "选建筑",
        "放置建筑": "放置建筑",
        "旋转 90°": "旋转 90°",
        "删除模式": "删除模式",
        "取消/收起": "取消/收起",
        "退出删除": "退出删除",
        "自由放置": "自由放置",
        "左键": "左键",
        "右键": "右键",
        "滚轮": "滚轮",
        "拖拽": "拖拽",
        "0 / O": "0 / O",
        "WASD": "WASD",
        "N": "N",
        "右键 / Esc": "右键 / Esc"
    },
    "en": {
        "当前模式": "Mode",
        "预览模式": "Preview",
        "编辑模式": "Edit",
        "删除模式": "Delete",
        "选中建筑": "Select building",
        "删除建筑": "Delete building",
        "缩放": "Zoom",
        "旋转": "Rotate",
        "显示/隐藏列表": "Show/hide list",
        "上下左右滚动": "Pan view",
        "重置镜头": "Reset view",
        "切换分类": "Switch category",
        "选建筑": "Pick building",
        "放置建筑": "Place building",
        "旋转 90°": "Rotate 90°",
        "取消/收起": "Cancel/collapse",
        "退出删除": "Exit delete",
        "自由放置": "Free placement",
        "左键": "Left click",
        "右键": "Right click",
        "滚轮": "Scroll wheel",
        "拖拽": "Drag",
        "0 / O": "0 / O",
        "WASD": "WASD",
        "N": "N",
        "右键 / Esc": "Right click / Esc"
    }
}
</i18n>
