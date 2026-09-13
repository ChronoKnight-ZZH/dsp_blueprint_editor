<template>
    <svg class="bp-icon" :class="{ editable: props.editable }" viewBox="-50 -50 100 100" xmlns="http://www.w3.org/2000/svg">
        <template v-if="iconUrls">
            <template v-for="(l, i) of layout" :key="i">
                <g v-if="props.editable" class="icon-slot" @click="emit('edit', i)">
                    <image v-if="iconUrls[i] !== null" :x="l.x" :y="l.y" :width="l.w" :height="l.w"
                           :href="iconUrls[i]!"/>
                    <rect v-else class="icon-slot-empty"
                          :x="l.x + 1" :y="l.y + 1" :width="l.w - 2" :height="l.w - 2" rx="3"/>
                    <text v-if="iconUrls[i] === null" class="icon-slot-plus"
                          :x="l.x + l.w / 2" :y="l.y + l.w / 2 + 1"
                          text-anchor="middle" dominant-baseline="central">+</text>
                    <rect class="icon-slot-hit" :x="l.x" :y="l.y" :width="l.w" :height="l.w"/>
                </g>
                <image v-else-if="iconUrls[i] !== null" :x="l.x" :y="l.y" :width="l.w" :height="l.w"
                       :href="iconUrls[i]!"/>
            </template>
        </template>
    </svg>
</template>

<script lang="ts">
const allLayouts = new Map([
    [ 0, []],
    [ 1, []],
    [10, [{x:   0, y:   0, w: 80}]],
    [11, [{x:   0, y:   0, w: 40}]],
    [20, [{x: -20, y:   0, w: 40}, {x:  20, y:   0, w: 40}]],
    [21, [{x: - 4, y:   0, w: 80}, {x:  22, y: -22, w: 40}]],
    [22, [{x: - 4, y:   0, w: 80}, {x:  22, y:  22, w: 40}]],
    [23, [{x:   4, y:   0, w: 80}, {x: -22, y:  22, w: 40}]],
    [24, [{x:   4, y:   0, w: 80}, {x: -22, y: -22, w: 40}]],
    [30, [{x:   0, y:  20, w: 40}, {x: -22, y: -21, w: 40}, {x:  22, y: -21, w: 40}]],
    [31, [{x:   0, y: -20, w: 40}, {x: -22, y:  21, w: 40}, {x:  22, y:  21, w: 40}]],
    [32, [{x:   0, y:   0, w: 80}, {x: -22, y:  22, w: 40}, {x:  22, y: -22, w: 40}]],
    [33, [{x:   0, y:   0, w: 80}, {x:  22, y:  22, w: 40}, {x: -22, y: -22, w: 40}]],
    [40, [{x: -20, y:  20, w: 40}, {x:  20, y:  20, w: 40}, {x: -20, y: -20, w: 40}, {x:  20, y: -20, w: 40}]],
    [41, [{x: -25, y:   0, w: 40}, {x:  25, y:   0, w: 40}, {x:   0, y:  25, w: 40}, {x:   0, y: -25, w: 40}]],
    [50, [{x: -20, y:  20, w: 40}, {x:  20, y:  20, w: 40}, {x: -20, y: -20, w: 40}, {x:  20, y: -20, w: 40}, {x:   0, y:   0, w: 40}]],
    [51, [{x: -16, y: -25, w: 40}, {x:  16, y: -25, w: 40}, {x: -26, y:   4, w: 40}, {x:  26, y:   4, w: 40}, {x:   0, y:  25, w: 40}]],
]);
for (const l of allLayouts.values()) {
    for (const i of l) {
        i.x -= i.w / 2;
        i.y = -i.y - i.w / 2;
    }
}
</script>

<script lang="ts" setup>
import { iconUrl } from '@/data/icons';
import { computed, ref, watchEffect } from 'vue';

const props = defineProps<{
    layoutId: number,
    icons?: number[],
    editable?: boolean,
}>();

const emit = defineEmits<{
    (event: 'edit', index: number): void,
}>();

const layout = computed(() =>  allLayouts.get(props.layoutId) ?? []);
const iconUrls = ref<(string | null)[] | null>(null);
watchEffect(async () => {
    if (!props.icons) {
        iconUrls.value = null;
        return;
    }
    iconUrls.value = await Promise.all(props.icons.map(i => i > 0 ? iconUrl(i) : null))
})
</script>

<style>
.bp-icon {
    background: linear-gradient(to right bottom, #5F9DFA, #547ACF);

    &.editable .icon-slot {
        cursor: pointer;
    }

    .icon-slot-empty {
        fill: rgba(255, 255, 255, 0.18);
        stroke: rgba(255, 255, 255, 0.75);
        stroke-width: 1;
        stroke-dasharray: 3 2;
    }

    .icon-slot-plus {
        fill: white;
        font-size: 22px;
        font-weight: bold;
        pointer-events: none;
    }

    .icon-slot-hit {
        fill: transparent;
        pointer-events: all;
    }

    &.editable .icon-slot:hover .icon-slot-hit {
        fill: rgba(255, 255, 255, 0.25);
    }
}
</style>
