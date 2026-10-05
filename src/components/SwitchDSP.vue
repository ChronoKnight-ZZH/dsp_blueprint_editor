<template>
    <div class="switch" :class="{ opened: props.opened }">
        <slot></slot>
        <span v-if="opened">{{ t("储液罐开") }}</span>
        <span v-else>{{ t("储液罐关") }}</span>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
    opened: boolean;
}>();
</script>

<style lang="scss">
.switch {
    padding: 2px 10px;
    display: flex;
    flex-direction: row;
    justify-content: space-between;

    background: #b2b2b2;
    &.opened {
        background: #4a8ba8;
    }
}
</style>
