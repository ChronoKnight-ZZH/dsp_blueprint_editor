<script lang="ts" setup>
import { ref } from "vue";

const status = ref("");
const upgradeReady = ref(false);
let upgrade = () => {
    /* NoOP */
};

/* ---------- 新增：弹窗状态 ---------- */
const showUpdateModal = ref(false);
const SNOOZE_KEY = "app.updateModal.snoozedUntil";
const SNOOZE_MS = 24 * 60 * 60 * 1000; // 24 小时

interface UpdateLog {
    version: string;
    date: string;
    items: string[];
}

declare global {
    interface Window {
        /** 本地调试：`window.__DSP_UPDATE_MODAL__ = true` 直接打开更新弹窗 */
        __DSP_UPDATE_MODAL__?: boolean;
    }
}

const updateLog = ref<UpdateLog | null>(null);
const updateLogLoading = ref(false);

/**
 * 更新日志随构建产物发布在 public/update-log.json，必须从网络取最新版本：
 * 弹窗由旧页面渲染，直接打包进 bundle 的日志只会是上一版内容。
 */
const loadUpdateLog = async () => {
    updateLogLoading.value = true;
    try {
        const response = await fetch(
            `${process.env.BASE_URL}update-log.json?t=${Date.now()}`,
            { cache: "no-store" }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const items = Array.isArray(data?.items)
            ? data.items.filter(
                  (item: unknown): item is string =>
                      typeof item === "string" && item.trim() !== ""
              )
            : [];
        if (!items.length) throw new Error("empty update log");
        updateLog.value = {
            version: typeof data.version === "string" ? data.version : "",
            date: typeof data.date === "string" ? data.date : "",
            items,
        };
    } catch {
        updateLog.value = null;
    } finally {
        updateLogLoading.value = false;
    }
};

const isSnoozed = () => {
    try {
        const until = Number(localStorage.getItem(SNOOZE_KEY));
        return Number.isFinite(until) && Date.now() < until;
    } catch {
        return false;
    }
};

const snoozeUpdate = () => {
    try {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
        console.error("更新弹窗静默记录写入失败");
        /* 隐私模式等写入失败则仅本次关闭 */
    }
    showUpdateModal.value = false;
};

/* ---------- 改造：版本就绪时按需弹窗 ---------- */
const setUpgradeReady = (waitingWorker: ServiceWorker) => {
    status.value = "新版本就绪";
    upgradeReady.value = true;
    upgrade = () => {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            window.location.reload();
        });
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
    };
    // 未处于 24 小时静默期才弹窗
    if (!isSnoozed()) {
        void loadUpdateLog();
        showUpdateModal.value = true;
    }
};

/* ---------- 弹窗按钮 ---------- */
const handleKnow = () => snoozeUpdate();

const handleUpdate = () => {
    showUpdateModal.value = false;
    try {
        localStorage.removeItem(SNOOZE_KEY); // 主动更新，清掉静默记录
    } catch { /* ignore */ }
    upgrade(); // 复用原有刷新逻辑
};

/* ---------- 本地调试入口 ---------- */
// 浏览器控制台执行 `window.__DSP_UPDATE_MODAL__ = true` 可直接打开弹窗，
// 用于在本地预览更新内容，不依赖真实的 waiting Service Worker。
if (typeof window !== "undefined") {
    Object.defineProperty(window, "__DSP_UPDATE_MODAL__", {
        get: () => showUpdateModal.value,
        set: (value: boolean) => {
            showUpdateModal.value = Boolean(value);
            if (value) void loadUpdateLog();
        },
        configurable: true,
    });
}

/* ---------- 原有注册逻辑保持不变 ---------- */
if (process.env.NODE_ENV !== "development" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(() => {
        status.value = "可离线使用";
    });
    navigator.serviceWorker
        .register(`${process.env.BASE_URL}service-worker.js`)
        .then((registration) => {
            if (registration.waiting) setUpgradeReady(registration.waiting);
            registration.addEventListener("updatefound", () => {
                if (navigator.serviceWorker.controller)
                    status.value = "正在更新";
                else status.value = "正在缓存";

                registration.installing!.addEventListener(
                    "statechange",
                    function () {
                        if (
                            this.state == "installed" &&
                            navigator.serviceWorker.controller
                        ) {
                            setUpgradeReady(this);
                        }
                    }
                );
            });
        })
        .catch((e) => (status.value = "错误：" + e.message));
}
</script>

<template>
    <span
        >{{ status }}
        <a v-if="upgradeReady" href="#" @click.prevent="upgrade()"
            >刷新</a
        ></span
    >

    <!-- 版本更新弹窗 -->
    <Teleport to="body">
        <Transition name="fade">
            <div
                v-if="showUpdateModal"
                class="update-mask"
            >
                <div class="update-dialog" role="dialog" aria-modal="true">
                    <h3 class="update-title">
                        发现新版本
                        <span v-if="updateLog?.version" class="update-version">
                            v{{ updateLog.version }}
                        </span>
                    </h3>
                    <p class="update-desc">
                        新版本已准备就绪，更新后即可使用最新功能。
                    </p>
                    <div class="update-log-img">
                        <img
                            src="@/assets/icons/update-log.jpg"
                            alt="更新日志"
                            draggable="false"
                        />
                    </div>
                    <div class="update-log">
                        <p class="update-log-title">
                            更新日志<span v-if="updateLog?.date">
                                · {{ updateLog.date }}</span
                            >
                        </p>
                        <p
                            v-if="updateLogLoading"
                            class="update-log-placeholder"
                        >
                            正在获取更新内容…
                        </p>
                        <template v-else-if="updateLog && updateLog.items.length">
                            <p
                                v-for="(item, index) in updateLog.items"
                                :key="index"
                            >
                                {{ item }}
                            </p>
                        </template>
                        <p v-else class="update-log-placeholder">
                            暂无更新说明
                        </p>
                    </div>
                    <div class="update-actions">
                        <button class="btn btn-ghost" @click="handleKnow">
                            知道了
                        </button>
                        <button class="btn btn-primary" @click="handleUpdate">
                            更新
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.update-mask {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    /* background:
        radial-gradient(
            circle at 50% 32%,
            rgba(42, 126, 196, 0.28),
            transparent 58%
        ),
        rgba(3, 9, 16, 0.8); */
    /* backdrop-filter: blur(8px) saturate(1.1); */
    -webkit-backdrop-filter: blur(8px) saturate(1.1);
}

.update-dialog {
    position: relative;
    width: 380px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 40px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 22px 22px 18px;
    border: 1px solid rgba(108, 196, 255, 0.32);
    border-radius: 16px;
    background:
        linear-gradient(
            160deg,
            rgba(26, 52, 76, 0.78),
            rgba(8, 18, 30, 0.9) 55%
        ),
        rgba(10, 22, 35, 0.72);
    box-shadow:
        0 24px 70px -24px rgba(0, 0, 0, 0.9),
        inset 0 0 0 1px rgba(120, 210, 255, 0.08),
        0 0 42px rgba(58, 160, 240, 0.18);
    backdrop-filter: blur(18px) saturate(1.25);
    -webkit-backdrop-filter: blur(18px) saturate(1.25);
    text-align: center;
    color: #cfe8f8;

    &::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image:
            linear-gradient(rgba(110, 200, 255, 0.055) 1px, transparent 1px),
            linear-gradient(
                90deg,
                rgba(110, 200, 255, 0.055) 1px,
                transparent 1px
            );
        background-size: 26px 26px;
        mask-image: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.75),
            transparent 62%
        );
        -webkit-mask-image: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.75),
            transparent 62%
        );
        pointer-events: none;
    }

    &::after {
        content: "";
        position: absolute;
        top: 0;
        left: 15%;
        right: 15%;
        height: 1px;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(140, 225, 255, 0.85),
            transparent
        );
        box-shadow: 0 0 14px rgba(95, 200, 255, 0.7);
        pointer-events: none;
    }
}

.update-title {
    position: relative;
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #eaf8ff;
    text-shadow: 0 0 14px rgba(100, 200, 255, 0.45);

    &::after {
        content: "";
        display: block;
        width: 48px;
        height: 2px;
        margin: 8px auto 0;
        background: linear-gradient(90deg, transparent, #6ccaff, transparent);
    }
}

.update-version {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: #7fd4ff;
    text-shadow: 0 0 8px rgba(108, 202, 255, 0.6);
}

.update-desc {
    position: relative;
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
    color: rgba(176, 206, 226, 0.88);
}

.update-log-img {
    position: relative;
    margin-bottom: 12px;
    overflow: hidden;
    border: 1px solid rgba(108, 196, 255, 0.22);
    border-radius: 10px;
    background: rgba(8, 20, 32, 0.6);
    box-shadow: 0 0 24px rgba(40, 140, 220, 0.16);

    img {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        object-position: center;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
    }

    &::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(
            180deg,
            rgba(10, 26, 42, 0) 55%,
            rgba(8, 18, 30, 0.75)
        );
        pointer-events: none;
    }
}

.update-log {
    position: relative;
    max-height: 150px;
    margin: 0 0 16px;
    padding: 12px 14px;
    overflow-y: auto;
    border: 1px solid rgba(108, 196, 255, 0.18);
    border-radius: 10px;
    background: linear-gradient(
        180deg,
        rgba(96, 190, 255, 0.07),
        rgba(8, 20, 32, 0.32)
    );
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    text-align: left;
    font-size: 12.5px;
    line-height: 1.65;
    color: rgba(190, 216, 234, 0.9);

    &::-webkit-scrollbar {
        width: 4px;
    }

    &::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(108, 196, 255, 0.35);
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    p {
        margin: 0 0 6px;
    }

    p:last-child {
        margin-bottom: 0;
    }

    .update-log-title {
        margin-bottom: 8px;
        color: #7fd4ff;
        font-weight: 600;
        letter-spacing: 0.06em;
    }

    p:not(.update-log-title):not(.update-log-placeholder) {
        position: relative;
        padding-left: 12px;

        &::before {
            content: "";
            position: absolute;
            top: 0.6em;
            left: 0;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: #6ccaff;
            box-shadow: 0 0 6px rgba(108, 202, 255, 0.8);
        }
    }

    .update-log-placeholder {
        color: rgba(176, 206, 226, 0.65);
        font-style: italic;
    }
}

.update-actions {
    position: relative;
    display: flex;
    gap: 10px;
}

.btn {
    flex: 1;
    padding: 9px 0;
    border-radius: 9px;
    cursor: pointer;
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    transition:
        background 0.15s ease,
        border-color 0.15s ease,
        box-shadow 0.15s ease,
        transform 0.12s ease;

    &:active {
        transform: translateY(1px);
    }

    &:focus-visible {
        outline: 2px solid #8fd6ff;
        outline-offset: 2px;
    }
}

.btn-ghost {
    border: 1px solid rgba(120, 190, 255, 0.28);
    background: rgba(120, 190, 255, 0.08);
    color: #bcdcf2;

    &:hover {
        border-color: rgba(120, 190, 255, 0.5);
        background: rgba(120, 190, 255, 0.16);
    }
}

.btn-primary {
    border: 1px solid rgba(128, 214, 255, 0.55);
    background: linear-gradient(135deg, #2d7fc4, #64a0dc);
    color: #fff;
    box-shadow:
        0 0 18px rgba(64, 160, 240, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);

    &:hover {
        background: linear-gradient(135deg, #3b93df, #7cc2ff);
        box-shadow:
            0 0 26px rgba(90, 190, 255, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.24s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.fade-enter-active .update-dialog,
.fade-leave-active .update-dialog {
    transition:
        transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
        opacity 0.24s ease;
}

.fade-enter-from .update-dialog {
    opacity: 0;
    transform: translateY(10px) scale(0.96);
}

.fade-leave-to .update-dialog {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
    .fade-enter-active,
    .fade-leave-active,
    .fade-enter-active .update-dialog,
    .fade-leave-active .update-dialog {
        transition: none;
    }
}
</style>