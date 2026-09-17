<template>
    <div class="container">
        <BlueprintEditor ref="renderer" v-model:selectedBuildingIndex="selectedBuildingIndex"
            @update:selectedBuildingIndex="i => buildingFocused(i !== null)" />
        <div class="sidebar" :class="{ expanded: sidebarExpanded }">
            <div>
                <div class="info-tab tab" :class="{ active: activeTab === 'info' }" @click="activeTab = 'info'"></div>
                <div class="operations-tab tab" :class="{ active: activeTab === 'operations' }"
                    @click="activeTab = 'operations'"></div>
            </div>
            <div v-if="activeTab === 'info'">
                <section style="display: flex; flex-direction: row; gap: 5px;">
                    <div>
                        <label for="iconLayout">{{ t('图标布局') }}</label>
                        <select id="iconLayout" :disabled="!data" v-model="iconLayout">
                            <option v-for="[id, s] of allIconLayouts" :key="id" :value="id">{{ s }}</option>
                        </select>
                        <label for="shortDesc">{{ t('缩略图文字') }}</label>
                        <input type="text" id="shortDesc" :disabled="!data" :value="data?.header.shortDesc"
                            @input="e => data!.header.shortDesc = (e.target as HTMLInputElement).value">
                    </div>
                    <BlueprintIcon style="height: 90px; flex: none;" :layout-id="iconLayout" :icons="data?.header.icons"
                        editable @edit="editHeaderIcon" />
                    <IconPickerModal ref="iconPickerModal" @select="setHeaderIcon" />
                </section>
                <section v-if="data">
                    <div class="row props-header">
                        <div style="flex: 1;">
                            <label for="author">{{ t('作者') }}</label>
                            <input type="text" id="author" :value="data.header.author"
                                @input="e => data!.header.author = (e.target as HTMLInputElement).value">
                        </div>
                        <div style="flex: 1;">
                            <label for="bpVersion">{{ t('蓝图版本') }}</label>
                            <input type="text" id="bpVersion" :value="data.header.blueprintVersion"
                                @input="e => data!.header.blueprintVersion = (e.target as HTMLInputElement).value">
                        </div>
                        <button type="button" class="prop-add" :title="t('新建属性')" @click="addProperty">
                            {{ t('新建属性') }}
                        </button>
                    </div>
                    <div class="properties-list">
                        <div v-for="(p, i) in propertyPairs" :key="i" class="property-item">
                            <div class="property-name-row">
                                <div class="prop-tag">
                                    <input type="text" class="prop-name" :value="p.name" :placeholder="t('新属性')"
                                        @input="e => updateProperty(i, 'name', (e.target as HTMLInputElement).value)">
                                </div>
                                <button type="button" class="prop-del" :title="t('删除属性')"
                                    @click="removeProperty(i)">×</button>
                            </div>
                            <input type="text" class="prop-value" :value="p.value" :placeholder="t('属性内容')"
                                @input="e => updateProperty(i, 'value', (e.target as HTMLInputElement).value)">
                        </div>
                    </div>
                </section>
                <section>
                    <label for="desc">{{ t('蓝图介绍') }}</label>
                    <textarea rows="2" id="desc" :disabled="!data" :value="data?.header.desc"
                        @input="e => data!.header.desc = (e.target as HTMLInputElement).value"></textarea>
                </section>
                <section>
                    <div class="row">
                        <label for="bp-str" style="margin-right: auto;">{{ t('蓝图代码') }}</label>
                        <button style="margin-left: 4px;" @click="copy" :disabled="working || !bpStr">{{ t('复制')
                            }}</button>
                        <button style="margin-left: 4px;" @click="paste" :disabled="working">{{ t('粘贴') }}</button>
                    </div>
                    <textarea class="bp-code" rows="3" id="bp-str" v-model="bpStrInput"
                        :placeholder="isDragOver ? t('拖拽文件到此处打开') : ''"
                        :class="{ 'drag-over': isDragOver }"
                        @copy="onCopy" @cut="onCut" @paste="onPaste"
                        @focus="encodeBp" @change="e => parseBp((e.target as HTMLTextAreaElement).value)"
                        @dragover.prevent="onDragOver"
                        @dragleave.prevent="onDragLeave"
                        @drop.prevent="onDrop">
                    </textarea>
                    <div class="row" style="align-items: stretch; column-gap: 4px;">
                        <button @click="parseBp('')" :disabled="working"
                            style="position: relative; flex: auto; width: 50px;">
                            {{ bpStr ? t("清空") : t("选择文件") }}
                            <input v-if="!bpStr" @change="onBpFile" :disabled="working" type="file"
                                accept=".txt,text/plain" id="blueprint-file"
                                style="position: absolute; inset: 0; opacity: 0;" />
                        </button>
                        <a v-if="bpStr && data" class="button" @click="prepareSave" :href="bpUrl"
                            :download="data.header.shortDesc + '.txt'" style="flex: auto; width: 50px;">
                            {{ t("保存文件") }}
                        </a>
                    </div>
                    <div class="error">{{ parseErrorMessage }}</div>
                </section>
                <section>
                    <div class="row">
                        <span style="margin-right: auto;">{{ t('创建版本号') }}</span>
                        <span>{{ data?.header.gameVersion }}</span>
                    </div>
                    <div class="row">
                        <span style="margin-right: auto;">{{ t('创建时间') }}</span>
                        <span>{{ data?.header.time.toLocaleString([], { timeZone: 'UTC' }) }}</span>
                    </div>
                </section>
                <section>
                    <BuildingInfoPanel v-if="selectedBuilding !== null" :building="selectedBuilding" />
                    <BuildingOverview v-else-if="data" @remove-by-item="removeBuildingsByItem" />
                </section>
            </div>
            <ul class="operations" v-else-if="activeTab === 'operations'">
                <template v-if="data && commandQueue">
                    <li>
                        <button @click="replaceModal!.open()">
                            <img src="@/assets/icons/find_replace.svg">
                            {{ t('批量替换') }}
                        </button>
                        <ReplaceModal :blueprint="data" ref="replaceModal" />
                    </li>
                    <li>
                        <button @click="commandQueue!.undo()" :disabled="!commandQueue.canUndo()">
                            <img src="@/assets/icons/undo.svg">
                            {{ t('撤销') }}
                        </button>
                    </li>
                    <li>
                        <button @click="commandQueue!.redo()" :disabled="!commandQueue.canRedo()">
                            <img src="@/assets/icons/redo.svg">
                            {{ t('重做') }}
                        </button>
                    </li>
                </template>
                <li style="margin-top: auto;">
                    <div class="select-li">
                        <label for="select-language">
                            <img src="@/assets/icons/translate.svg">
                            Languages
                        </label>
                        <select id="select-language" v-model="lang">
                            <option value="auto">{{ t('自动选择语言') }}</option>
                            <option value="en">English</option>
                            <option value="zh">中文</option>
                        </select>
                    </div>
                </li>
            </ul>
            <footer>
                {{ version }}
                <SWStatus />
            </footer>
        </div>
        <button class="expand-btn" :class="{ expanded: sidebarExpanded, pinned: pinned }"
            @click="toggleSidebar"></button>
        <button class="expand-btn" :class="{ expanded: sidebarExpanded }" @click="toggleSidebar"></button>
        <button class="pin-btn" :class="{ active: pinned }" :title="pinned ? t('解除固定') : t('固定面板')"
            @click="togglePin"></button>
    </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, reactive, ref, shallowReactive, shallowRef, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { BlueprintData, fromStr, toStr } from '@/blueprint/parser';
import { version, rendererKey, buildingInfoKey, commandQueueKey } from '@/define';
import { BuildingInfo } from './blueprint/buildingInfo';
import { RemoveBuildingsByItemCommand } from './blueprint/removeBuilding';

import BuildingInfoPanel from './components/BuildingInfoPanel.vue';
import SWStatus from '@/swStatus.vue';
import BlueprintIcon from './components/BlueprintIcon.vue';
import IconPickerModal from './components/IconPickerModal.vue';
import ReplaceModal from './components/ReplaceModal.vue';
import { CommandQueue } from './command';
import BuildingOverview from './components/BuildingOverview.vue';
import { useLang } from './i18n';
// 仅用于类型标注，编译时擦除，不影响 defineAsyncComponent 的异步分包
import type BlueprintEditorImpl from './components/BlueprintEditor.vue';
const BlueprintEditor = defineAsyncComponent(() => import(/* webpackChunkName: "renderer" */'./components/BlueprintEditor.vue'));

const { t } = useI18n();
const lang = useLang();

const renderer = ref<null | InstanceType<typeof BlueprintEditorImpl>>(null);
const replaceModal = ref<null | InstanceType<typeof ReplaceModal>>(null);
const iconPickerModal = ref<null | InstanceType<typeof IconPickerModal>>(null);
provide(rendererKey, renderer);

const bpStr = ref('');
const data = shallowRef(null as BlueprintData | null);
const expandSidebar = ref(true);
const pinned = ref(false);
const sidebarExpanded = computed(() => expandSidebar.value || pinned.value);

const toggleSidebar = () => {
    if (pinned.value) {
        // 固定状态下点击关闭：解除固定并收起
        pinned.value = false;
        expandSidebar.value = false;
    } else {
        expandSidebar.value = !expandSidebar.value;
    }
}

const togglePin = () => {
    pinned.value = !pinned.value;
    if (pinned.value) {
        expandSidebar.value = true;
    }
}
const activeTab = ref<'info' | 'operations'>('info')
const working = ref(false);
const codeExpired = ref(false);
const parseErrorMessage = ref('');
const selectedBuildingIndex = ref(null as number | null);

const commandQueue = computed(() => {
    if (data.value === null)
        return null;
    return new CommandQueue(data.value);
});
provide(commandQueueKey, commandQueue);

watchEffect(onCleanup => {
    if (commandQueue.value) {
        const stopWatch = watch(commandQueue.value.execVersion, () => codeExpired.value = true);
        onCleanup(stopWatch);
    }
});

const buildingFocused = (selected: boolean) => {
    // 固定状态下取消选择不会收起面板
    if (selected || !pinned.value)
        expandSidebar.value = selected;
    if (selected)
        activeTab.value = 'info';
}

// 右键列表图标：一键剔除全部同 itemId 建筑（支持撤销/重做）
const removeBuildingsByItem = (itemId: number) => {
    const queue = commandQueue.value;
    if (!queue)
        return;
    queue.push(new RemoveBuildingsByItemCommand(itemId, queue.data));
    selectedBuildingIndex.value = null;
}

const selectedBuilding = computed(() => {
    if (data.value === null || selectedBuildingIndex.value === null)
        return null;
    return data.value.buildings[selectedBuildingIndex.value];
})
const buildingInfo = computed(() => {
    if (data.value === null)
        return null;
    return new BuildingInfo(data.value.buildings);
})
provide(buildingInfoKey, buildingInfo);

const allIconLayouts = new Map<number, string>([
    [1, '无'],
    [10, '1-1'], [11, '1-2'],
    [20, '2-1'], [21, '2-2'], [22, '2-3'], [23, '2-4'], [24, '2-5'],
    [30, '3-1'], [31, '3-2'], [32, '3-3'], [33, '3-4'],
    [40, '4-1'], [41, '4-2'],
    [50, '5-1'], [51, '5-2'],
]);
const iconLayout = computed<number>({
    get() { return data.value?.header.layout ?? 0; },
    set(v) { data.value!.header.layout = v; },
})

const editingIconSlot = ref<number | null>(null);
const editHeaderIcon = (index: number) => {
    if (!data.value)
        return;
    editingIconSlot.value = index;
    iconPickerModal.value?.open();
}
const setHeaderIcon = (iconId: number) => {
    if (data.value && editingIconSlot.value !== null)
        data.value.header.icons[editingIconSlot.value] = iconId;
    editingIconSlot.value = null;
}

/** 将 properties 原始字符串解析为 [{ name, value }] 列表 */
const propertyPairs = computed<{ name: string; value: string }[]>(() => {
    const raw = data.value?.header.properties ?? '';
    if (!raw) return [];
    return raw.split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => {
            const idx = s.indexOf(':');
            if (idx < 0) return { name: s, value: '' };
            return { name: s.substring(0, idx), value: s.substring(idx + 1) };
        });
});

const rebuildProperties = (pairs: { name: string; value: string }[]) => {
    data.value!.header.properties = pairs.map(p => `${p.name}:${p.value};`).join('');
};

const updateProperty = (index: number, field: 'name' | 'value', val: string) => {
    const pairs = propertyPairs.value.map(p => ({ ...p }));
    pairs[index][field] = val;
    rebuildProperties(pairs);
};

const addProperty = () => {
    const pairs = [...propertyPairs.value, { name: '', value: '' }];
    rebuildProperties(pairs);
};

const removeProperty = (index: number) => {
    const pairs = propertyPairs.value.filter((_, i) => i !== index);
    rebuildProperties(pairs);
};

const encodeBp = () => {
    if (!codeExpired.value || !data.value)
        return;
    bpStr.value = toStr(data.value)
    codeExpired.value = false;
}
const bpStrLatest = () => {
    encodeBp();
    return bpStr.value;
}

const bpStrInput = ref('');
const bpStrDisplay = () => {
    if (codeExpired.value)
        return 'BLUEPRINT:...';
    const len = bpStr.value.length
    if (len < 1000)
        return bpStr.value;
    return bpStr.value.substring(0, 400) + '\n...\n' + bpStr.value.substring(len - 400, len);
}
watchEffect(() => {
    bpStrInput.value = bpStrDisplay();
});

const bpUrl = ref('');
watchEffect(() => {
    if (codeExpired.value && bpUrl.value) {
        URL.revokeObjectURL(bpUrl.value);
        bpUrl.value = '';
    }
})
const prepareSave = () => {
    if (!bpUrl.value) {
        bpUrl.value = URL.createObjectURL(new Blob([bpStrLatest()], { type: 'text/plain' }));
    }
}
onUnmounted(() => {
    if (bpUrl.value) {
        URL.revokeObjectURL(bpUrl.value);
        bpUrl.value = '';
    }
})

const parseBp = (s: string) => {
    if (s) {
        try {
            data.value = shallowReactive(fromStr(s.trim()));
            data.value.header = reactive(data.value.header);
            parseErrorMessage.value = '';
            watch(data.value, () => codeExpired.value = true);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'bp_parse', {
                    'bp_length': s.length,
                })
            }
        } catch (e) {
            parseErrorMessage.value = String(e);
            console.error(e);
        }
    } else {
        data.value = null;
        parseErrorMessage.value = '';
    }
    selectedBuildingIndex.value = null;
    bpStr.value = s;
    codeExpired.value = false;
}

// 拖拽状态
const isDragOver = ref(false);

// 拖拽进入
const onDragOver = (e: DragEvent) => {
    isDragOver.value = true;
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
    }
};

// 拖拽离开
const onDragLeave = () => {
    isDragOver.value = false;
};

// 拖拽放下：读取文件内容并解析
const onDrop = async (e: DragEvent) => {
    isDragOver.value = false;
    if (!e.dataTransfer)
        return;

    const files = e.dataTransfer.files;
    if (files.length === 0)
        return;

    const file = files[0];
    // 限制文件类型：仅允许 .txt 或 text/plain
    const isTxt = file.name.toLowerCase().endsWith('.txt')
        || file.type === 'text/plain';

    if (!isTxt) {
        parseErrorMessage.value = t('仅支持 .txt 文件');
        return;
    }

    working.value = true;
    try {
        parseBp(await file.text());
    } catch (err) {
        parseErrorMessage.value = String(err);
        console.error(err);
    } finally {
        working.value = false;
    }
};
const onBpFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        // 限制文件类型：仅允许 .txt 或 text/plain
        const isTxt = file.name.toLowerCase().endsWith('.txt')
            || file.type === 'text/plain';

        if (!isTxt) {
            parseErrorMessage.value = t('仅支持 .txt 文件');
            input.value = '';
            return;
        }

        working.value = true;
        try {
            parseBp(await file.text());
        } catch (err) {
            parseErrorMessage.value = String(err);
            console.error(err);
        } finally {
            working.value = false;
        }
    }
    input.value = '';
};

const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', bpStrLatest());
}

const onCut = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', bpStrLatest());
    parseBp('');
}

const onPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    (e.target as HTMLElement).blur();
    parseBp(e.clipboardData.getData('text/plain'));
}

const copy = async () => {
    working.value = true;
    try {
        await navigator.clipboard.writeText(bpStrLatest());
    } catch {
        alert(t('复制粘贴不支持'));
    }
    working.value = false;
}

const paste = async () => {
    working.value = true;
    try {
        parseBp(await navigator.clipboard.readText());
    } catch {
        alert(t('复制粘贴不支持'));
    }
    working.value = false;
}

const hotkey = (event: KeyboardEvent) => {
    if (event.isComposing)
        return;
    if (event.ctrlKey && !event.altKey) {
        if (event.code === 'KeyZ') {
            if (event.shiftKey)
                commandQueue.value?.redo();
            else
                commandQueue.value?.undo();
        } else if (event.code === 'KeyY' && !event.shiftKey) {
            commandQueue.value?.redo();
        }
        return;
    }
    if (event.altKey || event.metaKey)
        return;
    // 在输入框/文本域中打字时不触发
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable)
        return;
    // O 或 0：快速打开蓝图面板
    if (event.code === 'KeyO' || event.code === 'Digit0') {
        if (pinned.value) return; // 固定状态时不响应快捷键
        expandSidebar.value = !expandSidebar.value;
        if (expandSidebar.value) activeTab.value = 'info';
    }
}
onMounted(() => document.body.addEventListener('keydown', hotkey));
onUnmounted(() => document.body.removeEventListener('keydown', hotkey));
</script>

<style lang="scss">
body {
    margin: 0;
    background: black;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
        Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}

.container {
    width: 100vw;
    height: 100vh;
    position: relative;
}

.expand-btn {
    position: absolute;
    right: 0;
    top: 0;
    height: 60px;
    width: 60px;
    background: url(@/assets/icons/menu.svg) center no-repeat, #00000060;
    border: 0;

    &.expanded {
        background: url(@/assets/icons/close.svg) center no-repeat;
    }
}

.pin-btn {
    position: absolute;
    right: 60px;
    /* 位于关闭按钮左侧 */
    top: 0;
    height: 60px;
    width: 60px;
    border: 0;
    opacity: 0.55;
    background: url(@/assets/icons/pin.svg) center / 24px no-repeat, #00000060;
    transition: opacity 0.2s, background-color 0.2s, transform 0.2s;

    &.active {
        opacity: 1;
        background-color: #64a0dc;
        // transform: rotate(45deg);
    }
}

.tab {
    height: 60px;
    width: 60px;
    opacity: 0.5;
    display: inline-block;

    &.active {
        opacity: 1.0;
    }
}

.info-tab {
    background: url(@/assets/icons/menu.svg) center no-repeat;
}

.operations-tab {
    background: url(@/assets/icons/settings.svg) center no-repeat;
}

.row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
}

.sidebar {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    overflow-y: auto;
    box-sizing: border-box;
    background: #000000b0;
    color: white;
    display: none;
    padding-left: 10px;
    padding-right: 10px;

    @media screen and (max-width: 360px) {
        width: 100%;
    }

    section {
        margin: 5px 0;
    }

    footer {
        margin-top: auto;
        margin-bottom: 5px;
        color: gray;
    }

    &.expanded {
        display: flex;
        flex-direction: column;
    }

    .error {
        color: red;
    }

    button,
    .button {
        color: inherit;
        background: #64a0dc;
        border: 0;
        box-sizing: border-box;
        font-size: 0.9rem;
        padding: 1px 4px;
        margin: 0;
        text-decoration: none;
        text-align: center;
        user-select: none;
        cursor: pointer;

        &[disabled] {
            background: gray;
            cursor: default;
        }
    }

    textarea,
    input[type="text"],
    select {
        background: #ffffff40;
        border: 0;
        width: 100%;
        font-size: 0.9rem;
        box-sizing: border-box;
        resize: none;
        color: inherit;

        &:focus {
            background: #4f6671;
        }
    }

    /* ---------- 蓝图属性：游戏内样式（切角标签 + 整行内容 + 新建按钮） ---------- */
    .props-header {
        align-items: flex-end;
        column-gap: 5px;
    }

    .prop-add {
        flex: none;
        align-self: flex-end;
        padding: 2px 10px;
        white-space: nowrap;
        background: #4a90d9;

        &:hover {
            background: #5aa0ec;
        }
    }

    .properties-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 6px;
    }

    .property-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .property-name-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
    }

    $tag-cut: 10px;
    $tag-clip: polygon(0 0, 100% 0, 100% calc(100% - #{$tag-cut}), calc(100% - #{$tag-cut}) 100%, 0 100%);

    .property-name-row .prop-tag {
        flex: 0 1 72%;
        min-width: 0;
        padding: 1px;
        background: rgba(150, 195, 235, 0.65);
        clip-path: $tag-clip;
    }

    .property-name-row .prop-name {
        width: 100%;
        box-sizing: border-box;
        padding: 3px 8px;
        border: 0;
        border-radius: 0;
        background: rgba(20, 36, 54, 0.92);
        clip-path: $tag-clip;

        &::placeholder {
            color: rgba(255, 255, 255, 0.38);
        }

        &:focus {
            background: rgba(36, 60, 88, 0.95);
        }
    }

    .property-item .prop-value {
        box-sizing: border-box;
        padding: 4px 8px;
        border: 0;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.10);

        &::placeholder {
            color: rgba(255, 255, 255, 0.35);
        }

        &:focus {
            background: rgba(100, 160, 220, 0.18);
        }
    }

    .property-name-row .prop-del {
        flex: none;
        width: 22px;
        height: 22px;
        padding: 0;
        line-height: 1;
        font-size: 14px;
        border: 0;
        border-radius: 50%;
        background: rgba(192, 57, 43, 0.28);
        color: #ff8d7d;
        transition: background 0.15s, color 0.15s;

        &:hover {
            background: #c0392b;
            color: #fff;
        }
    }

    /* ---------- 蓝图代码区样式微调 ---------- */
    .bp-code {
        word-break: break-all;
        font-family: 'Menlo', 'Consolas', monospace;
        font-size: 0.8rem;
        line-height: 1.4;
        background: #1e2a33;
        border-radius: 4px;
        padding: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);

        &:focus {
            background: #1e2a33;
            border-color: #64a0dc;
        }
    }
}

.bp-code {
    word-break: break-all;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 0.8rem;
    line-height: 1.4;
    background: #1e2a33;
    border-radius: 4px;
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;

    &:focus {
        background: #1e2a33;
        border-color: #64a0dc;
    }

    // 拖拽悬停时高亮
    &.drag-over {
        border-color: #64a0dc;
        background: #24384d;
        box-shadow: 0 0 0 2px rgba(100, 160, 220, 0.35);
    }
}

ul.operations {
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: auto;

    >li {
        display: block;
        list-style: none;
        border-bottom: 1px solid #fff6;
        margin: 0;

        button,
        .select-li {
            box-sizing: border-box;
            padding: 5px;
            color: white;
            width: 100%;
            background: transparent;
            text-align: start;

            &[disabled] {
                background: transparent;
                opacity: 0.5;
            }
        }

        img {
            vertical-align: middle;
        }
    }
}

.select-li {
    display: flex;

    >select {
        margin-left: 5px;
        flex: 1 100px;
    }
}
</style>

<i18n>
{
    zh: {
        "复制": "复制",
        "粘贴": "粘贴",
        "选择文件": "选择文件",
        "清空": "清空",
        "复制粘贴不支持": "不支持，请手动复制",
        "保存文件": "保存文件",

        "批量替换": "批量替换",
        "撤销": "撤销",
        "重做": "重做",
        "自动选择语言": "自动选择",
        "新建属性": "新建属性",
        "新属性": "新属性",
        "属性内容": "属性内容",
        "删除属性": "删除属性",
        "固定面板": "固定面板（固定后无法点击隐藏）",
        "右键点击剔除": "右键点击建筑可剔除",
        "仅支持 .txt 文件": "仅支持 .txt 文件",
        "拖拽文件到此处打开": "拖拽文件到此处打开"
    },
    en: {
        "复制": "Copy",
        "粘贴": "Paste",
        "选择文件": "Select File",
        "清空": "Clear",
        "复制粘贴不支持": "Not supported, please copy manually",
        "保存文件": "Save File",

        "批量替换": "Batch Replace",
        "撤销": "Undo",
        "重做": "Redo",
        "自动选择语言": "Auto Select",
        "新建属性": "New Property",
        "新属性": "New Property",
        "属性内容": "Property Value",
        "删除属性": "Delete Property",
        "固定面板": "Pin panel (cannot be hidden by clicking)",
        "右键点击剔除": "Right-click a building to remove it",
        "仅支持 .txt 文件": "Only .txt files are supported",
        "拖拽文件到此处打开": "Drop file here to open"
    },
}
</i18n>