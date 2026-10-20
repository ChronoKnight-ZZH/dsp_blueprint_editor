<template>
    <Teleport to="body">
        <dialog
            ref="dlg"
            class="tutorial-dialog"
            :class="{ dragging, resizing }"
            @close="onClose"
        >
            <!-- 8 个方向缩放手柄：四边 + 四角 -->
            <div
                v-for="dir in resizeDirs"
                :key="dir"
                class="resize-handle"
                :class="'resize-' + dir"
                @pointerdown="startResize($event, dir)"
            ></div>
            <div class="tutorial-modal" @dragstart.prevent>
                <header
                    class="tutorial-header"
                    @pointerdown="startDrag"
                >
                    <h1 class="tutorial-title">{{ t("使用教程") }}</h1>
                    <button
                        type="button"
                        class="tutorial-close"
                        :title="t('关闭')"
                        @click="close"
                    >
                        ×
                    </button>
                </header>
                <div class="tutorial-body">
                    <nav class="tutorial-toc">
                        <div
                            v-for="item in toc"
                            :key="item.id"
                            class="toc-item"
                            :class="{
                                'toc-h1': item.depth === 1,
                                'toc-h2': item.depth === 2,
                            }"
                            :title="item.text"
                            @click="jumpTo(item.id)"
                        >
                            {{ item.text }}
                        </div>
                    </nav>
                    <div
                        ref="content"
                        class="tutorial-content markdown-body"
                        v-html="html"
                    ></div>
                </div>
            </div>
        </dialog>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import DOMPurify from "dompurify";

// 项目根目录 docs/功能说明.md 的原始文本（webpack asset/source 内联）
import tutorialMd from "../../docs/功能说明.md";

// 加载 docs/images 下的图片，供 markdown 内 <img src="images/..."> 解析
declare const require: {
    context: (
        directory: string,
        useSubdirectories?: boolean,
        regExp?: RegExp
    ) => {
        keys(): string[];
        (id: string): string;
    };
};
const imgCtx = require.context(
    "../../docs/images",
    false,
    /\.(png|jpe?g|gif|webp|svg)$/
);
const imageMap: Record<string, string> = {};
for (const key of imgCtx.keys()) imageMap["images/" + key.slice(2)] = imgCtx(key);

const { t } = useI18n();

const open = ref(false);
const dlg = ref<HTMLDialogElement | null>(null);
const content = ref<HTMLElement | null>(null);

// ---------------- 窗口拖拽移动 / 尺寸缩放 ----------------
const dragging = ref(false);
const resizing = ref(false);

/** 缩放手柄方向（8 个：四边 + 四角） */
const resizeDirs = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type ResizeDir = (typeof resizeDirs)[number];

/** 最小窗口尺寸与窗口距视口边距 */
const MIN_W = 420;
const MIN_H = 300;
const EDGE = 12;

interface PointerAction {
    mode: "move" | "resize";
    dir: ResizeDir;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    origW: number;
    origH: number;
}
let action: PointerAction | null = null;

const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), max);

/** 打开弹窗时恢复默认尺寸（86vw/84vh，上限 1100×800）并居中 */
const resetWindow = () => {
    const el = dlg.value;
    if (!el) return;
    const w = Math.min(Math.floor(window.innerWidth * 0.86), 1100);
    const h = Math.min(Math.floor(window.innerHeight * 0.84), 800);
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.left = Math.round((window.innerWidth - w) / 2) + "px";
    el.style.top = Math.round((window.innerHeight - h) / 2) + "px";
};

/** 按下标题栏开始拖拽移动（排除关闭按钮） */
const startDrag = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = dlg.value!;
    e.preventDefault();
    action = {
        mode: "move",
        dir: "" as ResizeDir,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: el.offsetLeft,
        origTop: el.offsetTop,
        origW: el.offsetWidth,
        origH: el.offsetHeight,
    };
    dragging.value = true;
};

/** 按下缩放手柄开始调整尺寸 */
const startResize = (e: PointerEvent, dir: ResizeDir) => {
    e.stopPropagation();
    const el = dlg.value!;
    e.preventDefault();
    action = {
        mode: "resize",
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: el.offsetLeft,
        origTop: el.offsetTop,
        origW: el.offsetWidth,
        origH: el.offsetHeight,
    };
    resizing.value = true;
};

const onPointerMove = (e: PointerEvent) => {
    if (!action) return;
    const el = dlg.value!;
    const dx = e.clientX - action.startX;
    const dy = e.clientY - action.startY;
    const maxW = window.innerWidth - EDGE * 2;
    const maxH = window.innerHeight - EDGE * 2;

    // 拖拽移动：至少保留一部分窗口在视口内
    if (action.mode === "move") {
        el.style.left =
            clamp(
                action.origLeft + dx,
                EDGE - el.offsetWidth + 120,
                window.innerWidth - EDGE - 120
            ) + "px";
        el.style.top =
            clamp(
                action.origTop + dy,
                EDGE - el.offsetHeight + 60,
                window.innerHeight - EDGE - 60
            ) + "px";
        return;
    }

    // 缩放：按方向分别调整宽度/高度，并修正锚定位置
    let left = action.origLeft;
    let top = action.origTop;
    let width = action.origW;
    let height = action.origH;
    const dir = action.dir;
    if (dir.includes("e")) width = clamp(action.origW + dx, MIN_W, maxW);
    if (dir.includes("s")) height = clamp(action.origH + dy, MIN_H, maxH);
    if (dir.includes("w")) {
        width = clamp(action.origW - dx, MIN_W, maxW);
        left = action.origLeft + (action.origW - width);
    }
    if (dir.includes("n")) {
        height = clamp(action.origH - dy, MIN_H, maxH);
        top = action.origTop + (action.origH - height);
    }
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
};

const endPointer = () => {
    if (!action) return;
    action = null;
    dragging.value = false;
    resizing.value = false;
};

/** 键盘关闭：仅 / 与 Esc 可关闭（捕获阶段拦截，避免触发 App 全局快捷键） */
const onKeydown = (e: KeyboardEvent) => {
    if (!open.value) return;
    if (e.key === "/" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
    }
};

onMounted(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    window.addEventListener("keydown", onKeydown, true);
});
onUnmounted(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endPointer);
    window.removeEventListener("pointercancel", endPointer);
    window.removeEventListener("keydown", onKeydown, true);
});

const openModal = () => {
    open.value = true;
};
const close = () => {
    open.value = false;
};
const onClose = () => {
    open.value = false;
};

watch(open, (v) => {
    if (v) {
        dlg.value?.showModal();
        resetWindow();
    } else {
        dlg.value?.close();
    }
});

defineExpose({ open: openModal });

/** GitHub 风格 slug：仅保留中日韩 / 字母 / 数字 / 空格 / 连字符，空格转连字符 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9\s-]/g, "")
        .replace(/\s+/g, "-");
}

/** 一、二级标题目录 */
interface TocItem {
    id: string;
    text: string;
    depth: number;
}
const toc: TocItem[] = [];

// 自定义 heading 渲染：注入锚点 id 并收集一级/二级标题到左侧目录
marked.use({
    renderer: {
        heading(token: { tokens: Array<{ raw: string }>; depth: number }) {
            const text = token.tokens.map((t) => t.raw ?? "").join("");
            const id = slugify(text);
            if (token.depth <= 2) toc.push({ id, text, depth: token.depth });
            return `<h${token.depth} id="${id}">${text}</h${token.depth}>`;
        },
    },
});

const rendered = marked.parse(tutorialMd, { async: false }) as string;
const html = DOMPurify.sanitize(
    rendered.replace(/(<img[^>]*)\bsrc="(images\/[^"]+)"/g, (_m, pre, path) => {
        const url = imageMap[path as string];
        return url ? `${pre}src="${url}"` : `${pre}`;
    })
);

/** 点击左侧目录项，滚动右侧内容到对应标题 */
const jumpTo = (id: string) => {
    const target = document.getElementById(id);
    const box = content.value;
    if (!target || !box) return;
    box.scrollTo({
        top: target.offsetTop - box.offsetTop - 12,
        behavior: "smooth",
    });
};
</script>

<style lang="scss" scoped>
/* 弹窗容器：深灰半透明、可拖拽可缩放、窗口 chrome 都在此 */
.tutorial-dialog {
    position: fixed;
    margin: 0;
    box-sizing: border-box;
    padding: 0;
    border: none;
    /* 覆盖原生 <dialog> UA 样式表的 max-width/max-height 上限，
       否则渲染尺寸与内联尺寸不一致，导致边缘/角落缩放计算偏移 */
    max-width: none;
    max-height: none;
    background: rgba(60, 60, 60, 0.55);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45);
    min-width: 420px;
    min-height: 300px;

    &.dragging,
    &.resizing {
        user-select: none;
        -webkit-user-select: none;
    }

    /* 拖拽移动中标题栏光标改为抓取 */
    &.dragging .tutorial-header {
        cursor: grabbing;
    }
}

/* 遮罩：完全无色透明（透明度为 0，无任何颜色叠加） */
.tutorial-dialog::backdrop {
    background: transparent;
}

/* 缩放手柄：贴边细条 + 四角方块，触屏拖拽不触发滚动 */
.resize-handle {
    position: absolute;
    z-index: 5;
    touch-action: none;
}

.resize-n,
.resize-s {
    left: 8px;
    right: 8px;
    height: 7px;
    cursor: ns-resize;
}
.resize-e,
.resize-w {
    top: 8px;
    bottom: 8px;
    width: 7px;
    cursor: ew-resize;
}
.resize-nw,
.resize-se {
    width: 15px;
    height: 15px;
    cursor: nwse-resize;
}
.resize-ne,
.resize-sw {
    width: 15px;
    height: 15px;
    cursor: nesw-resize;
}
.resize-n {
    top: 0;
}
.resize-s {
    bottom: 0;
}
.resize-e {
    right: 0;
}
.resize-w {
    left: 0;
}
.resize-nw {
    top: 0;
    left: 0;
}
.resize-ne {
    top: 0;
    right: 0;
}
.resize-sw {
    bottom: 0;
    left: 0;
}
.resize-se {
    bottom: 0;
    right: 0;
}

/* 弹窗内容容器：深色主题，撑满窗口 */
.tutorial-modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: rgba(16, 24, 33, 0.85);
    color: #dfe8f0;
    overflow: hidden;
}

.tutorial-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 10px 16px;
    background: rgba(0, 0, 0, 0.35);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    cursor: move;
    user-select: none;
    touch-action: none;

    .tutorial-title {
        margin: 0;
        font-size: 1.05rem;
        color: #dfe8f0;
    }

    .tutorial-close {
        border: none;
        background: transparent;
        color: #dfe8f0;
        font-size: 1.4rem;
        line-height: 1;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 4px;

        &:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #dfe8f0;
        }
    }
}

.tutorial-body {
    display: flex;
    flex: 1;
    min-height: 0;
}

.tutorial-toc {
    flex: none;
    width: 20%;
    overflow-y: auto;
    padding: 10px 8px;
    background: rgba(0, 0, 0, 0.25);
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    box-sizing: border-box;
}

.toc-item {
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #dfe8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
        background: rgba(100, 160, 220, 0.2);
        color: #dfe8f0;
    }
}

.toc-h1 {
    font-weight: 700;
    color: #dfe8f0;
}

.toc-h2 {
    padding-left: 12px;
}

.tutorial-content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 12px 20px;
    position: relative;
}

/* 深色滚动条 */
.tutorial-toc,
.tutorial-content {
    scrollbar-color: rgba(100, 160, 220, 0.4) rgba(255, 255, 255, 0.08);
    scrollbar-width: thin;

    &::-webkit-scrollbar {
        width: 10px;
    }
    &::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
    }
    &::-webkit-scrollbar-thumb {
        background: rgba(100, 160, 220, 0.35);
        border-radius: 5px;
    }
}

/* markdown 深色主题还原 */
.markdown-body {
    font-size: 0.92rem;
    line-height: 1.65;
    color: #dfe8f0;

    :deep(h1),
    :deep(h2) {
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        padding-bottom: 4px;
        color: #dfe8f0;
    }

    :deep(h1) {
        font-size: 1.35rem;
    }

    :deep(h2) {
        font-size: 1.15rem;
    }

    :deep(h3) {
        font-size: 1rem;
        color: #dfe8f0;
    }

    :deep(a) {
        color: #64a0dc;
    }

    :deep(img) {
        max-width: 100%;
        -webkit-user-drag: none;
        user-drag: none;
        user-select: none;
    }

    :deep(table) {
        border-collapse: collapse;
        margin: 8px 0;
    }

    :deep(th),
    :deep(td) {
        border: 1px solid rgba(255, 255, 255, 0.18);
        padding: 4px 10px;
    }

    :deep(th) {
        background: rgba(100, 160, 220, 0.22);
        color: #dfe8f0;
    }

    :deep(pre) {
        background: #1e2a33;
        color: #dfe8f0;
        padding: 8px 12px;
        border-radius: 6px;
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    :deep(code) {
        font-family: "Menlo", "Consolas", monospace;
        font-size: 0.85em;
        color: #dfe8f0;
        background: rgba(255, 255, 255, 0.08);
        padding: 1px 4px;
        border-radius: 3px;
    }

    :deep(pre code) {
        background: none;
        padding: 0;
    }

    :deep(blockquote) {
        margin: 8px 0;
        padding: 4px 12px;
        border-left: 4px solid #64a0dc;
        background: rgba(100, 160, 220, 0.12);
        color: #dfe8f0;
    }

    :deep(hr) {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        margin: 16px 0;
    }
}
</style>

<i18n>
{
    "zh": {
        "使用教程": "使用教程",
        "关闭": "关闭"
    },
    "en": {
        "使用教程": "Tutorial",
        "关闭": "Close"
    }
}
</i18n>
