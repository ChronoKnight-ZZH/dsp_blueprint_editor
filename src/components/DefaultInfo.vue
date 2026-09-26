<template>
    <div class="building-params">
        <div><label>itemId</label><span class="v">{{ building.itemId }}</span></div>
        <div><label>modelIndex</label><span class="v">{{ building.modelIndex }}</span></div>
        <div><label>{{ t('坐标') }}</label><span class="v">{{ coord }}</span></div>
        <div><label>{{ t('朝向') }}</label><span class="v">{{ building.yaw[0] }}</span></div>
        <div class="no-more">{{ t('无更多可配置参数') }}</div>
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { BlueprintBuilding } from '@/blueprint/parser';

const { t } = useI18n();
const props = defineProps<{ building: BlueprintBuilding }>();

const coord = computed(() => {
    const p = props.building.localOffset[0];
    return `${p.x}, ${p.y}, ${p.z}`;
});
</script>

<style lang="scss">
.no-more {
    color: #888;
    font-style: italic;
    margin-top: 8px;
}
</style>

<i18n>
{
    "zh": { "坐标": "坐标", "朝向": "朝向", "无更多可配置参数": "无更多可配置参数" },
    "en": { "坐标": "Coord", "朝向": "Yaw", "无更多可配置参数": "No more configurable parameters" }
}
</i18n>