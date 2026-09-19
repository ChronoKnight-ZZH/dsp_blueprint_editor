<template>
    <div class="holo-beacon-info">
        <label class="holo-beacon-label">{{ t('信标文本') }}</label>
        <textarea
            v-model="draft"
            class="holo-beacon-textarea"
            rows="5"
            :placeholder="t('信标文本占位')"
            @blur="commit"
            @keydown.ctrl.enter="commit"
        />
        <div class="holo-beacon-actions">
            <span class="holo-beacon-hint">{{ t('信标文本提示') }}</span>
            <button
                class="holo-beacon-save"
                :disabled="!dirty"
                @click="commit"
            >{{ t('保存') }}</button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { BlueprintBuilding } from '@/blueprint/parser';
import { SetBeaconContentCommand } from '@/blueprint/setBeaconContent';
import { commandQueueKey } from '@/define';

const { t } = useI18n();

const props = defineProps<{
    building: BlueprintBuilding,
}>();

const commandQueue = inject(commandQueueKey)!.value!;

// 初始/重建时同步 content 到 draft
const draft = ref<string>(props.building.content ?? '');
watch(
    () => props.building,
    (b) => { draft.value = b.content ?? ''; },
    { deep: false },
);

const dirty = computed(() => draft.value !== (props.building.content ?? ''));

function commit() {
    if (!dirty.value) return;
    commandQueue.push(new SetBeaconContentCommand(props.building, draft.value));
}
</script>

<style lang="scss" scoped>
.holo-beacon-info {
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.holo-beacon-label {
    font-weight: bold;
    font-size: 0.9em;
}

.holo-beacon-textarea {
    width: 100%;
    resize: vertical;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 0.9em;
    border: 1px solid #555;
    background: #1a1a1a;
    color: #eee;
    border-radius: 4px;
    box-sizing: border-box;
}

.holo-beacon-textarea:focus {
    outline: none;
    border-color: #4fc3f7;
}

.holo-beacon-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}

.holo-beacon-hint {
    font-size: 0.75em;
    color: #888;
}

.holo-beacon-save {
    padding: 4px 12px;
    font-size: 0.8em;
    border: 1px solid #666;
    background: #2a2a2a;
    color: #eee;
    border-radius: 4px;
    cursor: pointer;
}

.holo-beacon-save:hover:not(:disabled) {
    background: #3a3a3a;
    border-color: #4fc3f7;
}

.holo-beacon-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>

<i18n>
{
    "zh": {
        "信标文本": "信标文本",
        "信标文本占位": "输入全息信标文本…",
        "信标文本提示": "失焦 或 Ctrl+Enter 保存",
        "保存": "保存"
    },
    "en": {
        "信标文本": "Beacon Text",
        "信标文本占位": "Enter beacon text…",
        "信标文本提示": "Blurred  or Ctrl+Enter to save",
        "保存": "Save"
    }
}
</i18n>
