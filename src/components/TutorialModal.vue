<template>
    <Teleport to="body">
        <dialog
            ref="dlg"
            class="tutorial-dialog"
            @close="onClose"
            @click="onBackdropClick"
        >
            <div class="tutorial-modal" @dragstart.prevent>
                <header class="tutorial-header">
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
import { ref, watch } from "vue";
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

const openModal = () => {
    open.value = true;
};
const close = () => {
    open.value = false;
};
const onClose = () => {
    open.value = false;
};
const onBackdropClick = (e: MouseEvent) => {
    // 点击遮罩（dialog 自身）关闭
    if (e.target === dlg.value) close();
};

watch(open, (v) => {
    if (v) dlg.value?.showModal();
    else dlg.value?.close();
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
.tutorial-dialog {
    padding: 0;
    border: none;
    background: transparent;
}

/* 遮罩：淡灰色且透明 */
.tutorial-dialog::backdrop {
    background: rgba(185, 185, 185, 0.45);
}

.tutorial-modal {
    display: flex;
    flex-direction: column;
    width: 86vw;
    max-width: 1100px;
    height: 84vh;
    max-height: 800px;
    background: #f3f3f3;
    color: #222;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
}

.tutorial-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 10px 16px;
    background: #e8e8e8;
    border-bottom: 1px solid #cfcfcf;

    .tutorial-title {
        margin: 0;
        font-size: 1.1rem;
    }

    .tutorial-close {
        border: none;
        background: transparent;
        color: #444;
        font-size: 1.4rem;
        line-height: 1;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 4px;

        &:hover {
            background: rgba(0, 0, 0, 0.12);
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
    background: #ececec;
    border-right: 1px solid #d5d5d5;
    box-sizing: border-box;
}

.toc-item {
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #444;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #111;
    }
}

.toc-h1 {
    font-weight: 700;
    margin-top: 8px;
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

/* markdown 还原样式 */
.markdown-body {
    font-size: 0.92rem;
    line-height: 1.65;

    :deep(h1),
    :deep(h2) {
        border-bottom: 1px solid #d5d5d5;
        padding-bottom: 4px;
    }

    :deep(h1) {
        font-size: 1.35rem;
    }

    :deep(h2) {
        font-size: 1.15rem;
    }

    :deep(h3) {
        font-size: 1rem;
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
        border: 1px solid #b8b8b8;
        padding: 4px 10px;
    }

    :deep(th) {
        background: #e2e2e2;
    }

    :deep(pre) {
        background: #2d2d2d;
        color: #e8e8e8;
        padding: 8px 12px;
        border-radius: 6px;
        overflow: auto;
    }

    :deep(code) {
        font-family: "Menlo", "Consolas", monospace;
        font-size: 0.85em;
    }

    :deep(blockquote) {
        margin: 8px 0;
        padding: 4px 12px;
        border-left: 4px solid #b5b5b5;
        background: #e9e9e9;
        color: #555;
    }

    :deep(hr) {
        border: none;
        border-top: 1px solid #cfcfcf;
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
