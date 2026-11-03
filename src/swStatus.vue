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
                @click.self="handleKnow"
            >
                <div class="update-dialog" role="dialog" aria-modal="true">
                    <h3 class="update-title">发现新版本</h3>
                    <p class="update-desc">
                        新版本已准备就绪，更新后即可使用最新功能。
                    </p>
                    <!-- 更新日志容器：暂未实现 -->
                     <div class="update-log">
                        <p>更新日志：</p>
                        <p>1. 新增：设置页高级选项，支持开启高级模型渲染</p>
                        <p>2. 优化：支持更多视角查看</p>
                        <p>3. 修复了一些 bug，顺便抓了几只捣蛋的幽灵</p>
                        <p>新版本已就绪，不给糖就更新？</p>
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
    background: rgba(17, 24, 39, 0.45);
    backdrop-filter: blur(2px);
}

.update-dialog {
    width: 360px;
    max-width: calc(100vw - 40px);
    padding: 24px 22px 20px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 24px 60px -20px rgba(17, 24, 39, 0.5);
    text-align: center;
}

.update-title {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 700;
    color: #171a23;
}

.update-desc {
    margin: 0 0 20px;
    font-size: 13.5px;
    line-height: 1.6;
    color: #6b7280;
}

.update-actions {
    display: flex;
    gap: 10px;
}

.btn {
    flex: 1;
    padding: 9px 0;
    font-size: 14px;
    font-weight: 600;
    border-radius: 9px;
    cursor: pointer;
    transition: 0.15s;
    font-family: inherit;
}

.btn-ghost {
    border: 1px solid #e7e9f2;
    background: #fff;
    color: #3b3f52;
}
.btn-ghost:hover {
    background: #f7f8fc;
}

.btn-primary {
    border: 1px solid transparent;
    background: #5b5bd6;
    color: #fff;
}
.btn-primary:hover {
    background: #4f4fc4;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>