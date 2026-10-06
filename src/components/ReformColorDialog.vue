<template>
    <Teleport to="body">
        <div class="rgba-overlay" @click.self="emit('close')">
            <div class="rgba-panel">
                <div class="rgba-title">
                    <span>{{ t("自定义颜色") }}</span>
                    <span class="rgba-close" @click="emit('close')">×</span>
                </div>
                <p class="rgba-hint">
                    {{ t("点击色块选择当前地基颜色；自定义色槽可修改 RGBA 值。") }}
                </p>

                <div class="rgba-current">
                    <span
                        class="swatch"
                        :style="{ background: currentColorCss }"
                    ></span>
                    <span>
                        {{ t("当前颜色") }}：
                        {{ t("槽位") }} {{ placement.reformColorSlot }}
                        <span class="rgba-hex">#{{ currentHex }}</span>
                    </span>
                </div>

                <div class="rgba-section">
                    <div class="rgba-section-title">
                        {{ t("内置色") }} (0-15)
                    </div>
                    <div class="rgba-swatches">
                        <div
                            v-for="(c, i) in builtinColors"
                            :key="i"
                            class="rgba-swatch"
                            :class="{ active: placement.reformColorSlot === i }"
                            :style="{ background: hexToCss(c) }"
                            :title="`${i} #${hexStr(c)}`"
                            @click="placement.reformColorSlot = i"
                        ></div>
                    </div>
                </div>

                <div class="rgba-section">
                    <div class="rgba-section-title">
                        {{ t("自定义色槽") }} (16-31，{{ t("点击选中") }})
                    </div>
                    <div class="rgba-swatches">
                        <div
                            v-for="i in customSlots"
                            :key="i"
                            class="rgba-swatch custom"
                            :class="{
                                active: placement.reformColorSlot === i,
                                used: isCustomUsed(i),
                            }"
                            :style="{ background: customColorCss(i) }"
                            :title="`${i} #${customHexStr(i)} (${i === placement.reformColorSlot ? t('当前') : t('点击选中')})`"
                            @click="selectCustom(i)"
                        ></div>
                    </div>
                    <template v-if="editingSlot !== null">
                        <div class="rgba-edit">
                            <label v-for="ch in channels" :key="ch.key">
                                {{ ch.key.toUpperCase() }}
                                <input
                                    type="number"
                                    min="0"
                                    max="255"
                                    v-model.number="editing[ch.key]"
                                />
                            </label>
                            <button class="rgba-apply" @click="applyColor">
                                {{ t("应用") }}
                            </button>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script lang="ts" setup>
import { computed, inject, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { commandQueueKey } from "@/define";
import { usePlacement } from "@/editor/placementState";
import {
    DEFAULT_REFORM_COLORS,
    customSlotColor,
    SetReformCustomColorCommand,
} from "@/blueprint/reformEdit";

const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const placement = usePlacement();
const commandQueue = inject(commandQueueKey)!;

const builtinColors = DEFAULT_REFORM_COLORS;
const customSlots = Array.from({ length: 16 }, (_, i) => 16 + i);

function hexStr(hex: number): string {
    return ((hex || 0) & 0xffffff).toString(16).padStart(6, "0");
}

function hexToCss(hex: number): string {
    const h = (hex || 0) & 0xffffff;
    return `rgb(${(h >> 16) & 0xff},${(h >> 8) & 0xff},${h & 0xff})`;
}

const reformData = computed(
    () => commandQueue.value?.data.reformData ?? null
);

const isCustomUsed = (slot: number): boolean => {
    const rd = reformData.value;
    if (!rd) return false;
    return ((rd.customReformColorMask >>> slot) & 1) !== 0;
};

const customColorCss = (slot: number): string => {
    const rd = reformData.value;
    if (!rd) return "transparent";
    const v = customSlotColor(rd, slot);
    if (v === null) return "transparent";
    return `rgba(${(v >>> 24) & 0xff},${(v >>> 16) & 0xff},${(v >>> 8) & 0xff},${(v >>> 0) & 0xff})`;
};

const customHexStr = (slot: number): string => {
    const rd = reformData.value;
    if (!rd) return "unset";
    const v = customSlotColor(rd, slot);
    return v === null ? "unset" : hexStr(v >>> 8);
};

const currentHex = computed(() => {
    if (placement.reformColorSlot < 16)
        return hexStr(DEFAULT_REFORM_COLORS[placement.reformColorSlot]);
    const rd = reformData.value;
    if (!rd) return "ffffff";
    const v = customSlotColor(rd, placement.reformColorSlot);
    return v === null ? "ffffff" : hexStr(v >>> 8);
});

const currentColorCss = computed(() => {
    if (placement.reformColorSlot < 16)
        return hexToCss(DEFAULT_REFORM_COLORS[placement.reformColorSlot]);
    const rd = reformData.value;
    if (!rd) return "transparent";
    const v = customSlotColor(rd, placement.reformColorSlot);
    return v === null ? "transparent" : customColorCss(placement.reformColorSlot);
});

// ---- 自定义槽编辑 ----
interface Channel {
    key: "r" | "g" | "b" | "a";
}
const channels: Channel[] = [
    { key: "r" },
    { key: "g" },
    { key: "b" },
    { key: "a" },
];
const editingSlot = ref<number | null>(null);
const editing = reactive({ r: 255, g: 255, b: 255, a: 255 });

const selectCustom = (slot: number) => {
    placement.reformColorSlot = slot;
    const rd = reformData.value;
    const v = rd ? customSlotColor(rd, slot) : null;
    if (v !== null) {
        editing.r = (v >>> 24) & 0xff;
        editing.g = (v >>> 16) & 0xff;
        editing.b = (v >>> 8) & 0xff;
        editing.a = v & 0xff;
    } else {
        editing.r = 255;
        editing.g = 255;
        editing.b = 255;
        editing.a = 255;
    }
    editingSlot.value = slot;
};

const applyColor = () => {
    const queue = commandQueue.value;
    if (!queue || editingSlot.value === null) return;
    const rgba =
        (((editing.r & 0xff) << 24) |
            ((editing.g & 0xff) << 16) |
            ((editing.b & 0xff) << 8) |
            (editing.a & 0xff)) >>>
        0;
    queue.push(new SetReformCustomColorCommand(editingSlot.value, rgba));
    placement.reformColorSlot = editingSlot.value;
};
</script>

<style scoped>
.rgba-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}

.rgba-panel {
    background: #14141f;
    color: white;
    border: 1px solid #3a3a55;
    border-radius: 8px;
    padding: 14px 18px;
    min-width: 340px;
    max-width: 90vw;
    max-height: 84vh;
    overflow-y: auto;
    user-select: none;
}

.rgba-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: bold;
    margin-bottom: 6px;
}

.rgba-close {
    cursor: pointer;
    font-size: 1.2rem;
    color: #999;
    &:hover {
        color: #fff;
    }
}

.rgba-hint {
    font-size: 0.78rem;
    color: #9ad;
    margin: 0 0 8px;
}

.rgba-current {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 0.85rem;

    .swatch {
        width: 28px;
        height: 28px;
        border: 1px solid #666;
        border-radius: 4px;
    }

    .rgba-hex {
        color: #9ad;
        font-family: Menlo, Consolas, monospace;
    }
}

.rgba-section {
    margin-bottom: 12px;

    .rgba-section-title {
        font-size: 0.8rem;
        color: #bbb;
        margin-bottom: 4px;
    }
}

.rgba-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    .rgba-swatch {
        width: 26px;
        height: 26px;
        border: 2px solid #333;
        border-radius: 4px;
        cursor: pointer;
        box-sizing: border-box;

        &.custom {
            border-style: dashed;
        }

        &.used {
            border-color: #6a6;
        }

        &.active {
            border-color: #4af;
            outline: 2px solid #4af8;
        }

        &:hover {
            border-color: #f90;
        }
    }
}

.rgba-edit {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;

    label {
        font-size: 0.75rem;
        color: #aaa;
        display: flex;
        align-items: center;
        gap: 3px;

        input {
            width: 52px;
            background: #0c0c16;
            color: white;
            border: 1px solid #3a3a55;
            padding: 2px 4px;
        }
    }
}

.rgba-apply {
    background: #2a3a5e;
    color: white;
    border: 1px solid #4a6;
    border-radius: 4px;
    padding: 3px 12px;
    cursor: pointer;
    &:hover {
        background: #3a4a7e;
    }
}
</style>

<i18n>
{
    "zh": {
        "自定义颜色": "自定义颜色",
        "点击色块选择当前地基颜色；自定义色槽可修改 RGBA 值。": "点击色块选择当前地基颜色；自定义色槽可修改 RGBA 值。",
        "当前颜色": "当前颜色",
        "槽位": "槽位",
        "内置色": "内置色",
        "自定义色槽": "自定义色槽",
        "点击选中": "点击选中",
        "当前": "当前",
        "应用": "应用"
    },
    "en": {
        "自定义颜色": "Custom Colors",
        "点击色块选择当前地基颜色；自定义色槽可修改 RGBA 值。": "Click a swatch to pick the current foundation color; custom slots can be edited in RGBA.",
        "当前颜色": "Current color",
        "槽位": "Slot",
        "内置色": "Built-in",
        "自定义色槽": "Custom slots",
        "点击选中": "click to select",
        "当前": "current",
        "应用": "Apply"
    }
}
</i18n>