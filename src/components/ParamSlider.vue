<template>
    <div class="param-slider">
        <div class="param-row">
            <label>{{ label }}</label>
            <span class="v">{{ displayValue }}</span>
        </div>
        <input type="range" min="0" :max="steps.length - 1" step="1"
            :value="localIndex"
            :disabled="disabled"
            @input="onInput"
            @change="onChange" />
    </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';

const props = defineProps<{
    label: string,
    /** 当前值（滑块单位，必须是 steps 之一或接近） */
    value: number,
    /** 刻度数组（滑块单位） */
    steps: number[],
    /** 显示格式化，缺省直接 String(v) */
    format?: (v: number) => string,
    disabled?: boolean,
}>();

const emit = defineEmits<{
    (e: 'change', value: number): void,
}>();

/** 找到 value 在 steps 中的最近索引（容忍浮点误差） */
const valueToIndex = (v: number) => {
    let best = 0, bestDist = Infinity;
    for (let j = 0; j < props.steps.length; j++) {
        const d = Math.abs(props.steps[j] - v);
        if (d < bestDist) { bestDist = d; best = j; }
    }
    return best;
};

const localIndex = ref(valueToIndex(props.value));

// 外部数据变化（如 undo/redo）时同步回本地索引
watch(() => props.value, (v) => {
    localIndex.value = valueToIndex(v);
});

const displayValue = computed(() => {
    const v = props.steps[localIndex.value];
    return props.format ? props.format(v) : String(v);
});

const onInput = (e: Event) => {
    // 拖动中：只更新本地索引，不写入蓝图数据
    localIndex.value = Number((e.target as HTMLInputElement).value);
};

const onChange = () => {
    // 松手：提交最终值
    emit('change', props.steps[localIndex.value]);
};
</script>

<style lang="scss" scoped>
.param-slider {
    margin: 4px 0;

    .param-row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
    }
    input[type=range] {
        width: 100%;
    }
}
</style>