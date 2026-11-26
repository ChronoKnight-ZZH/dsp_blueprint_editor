/**
 * 模型本地缓存（持久化）的**全局开关**。
 *
 * 开关值来自构建配置 `config/persistence.config.js`：
 * - 编辑器构建（`vue.config.js`）注入 `web` 字段；
 * - 发布库构建（`scripts/lib-build/build.js`）注入 `lib` 字段。
 * 两个脚本都把它编译成同一个常量 `__DSP_MODEL_CACHE_ENABLED__`。
 *
 * 运行时还有一层**覆盖**（`setModelCacheEnabled()`）：发布库默认关闭持久化，
 * 宿主可以在启动时显式打开，而不必重新出包。优先级：
 *   运行时覆盖 > 构建期注入 > 默认值（开启，保持「看过的模型可离线」的既有行为）
 *
 * 源码引用 / 单测里没有构建步骤、常量不存在时，走默认值。
 */

declare const __DSP_MODEL_CACHE_ENABLED__: boolean | undefined;

/** 未配置时的默认值：开启 */
const DEFAULT_ENABLED = true;

/** 构建期注入的开关；没有注入（Node 单测 / 未配置的宿主）时为 null */
function readBuildSwitch(): boolean | null {
    try {
        if (
            typeof __DSP_MODEL_CACHE_ENABLED__ === "undefined" ||
            __DSP_MODEL_CACHE_ENABLED__ === null
        )
            return null;
        return __DSP_MODEL_CACHE_ENABLED__ === true;
    } catch {
        return null;
    }
}

const buildEnabled = readBuildSwitch();

/** 运行时覆盖：null = 跟随构建配置 */
let runtimeOverride: boolean | null = null;

/** 持久化总开关当前是否打开（只表示开关，不表示浏览器能力） */
export function isModelCacheEnabled(): boolean {
    if (runtimeOverride !== null) return runtimeOverride;
    return buildEnabled ?? DEFAULT_ENABLED;
}

/**
 * 运行时覆盖持久化开关。
 *
 * 编辑器不需要调用它（用 `config/persistence.config.js` 的 `web` 字段即可）；
 * 这是给**发布库宿主**的：库默认不写宿主存储，宿主显式打开后才落盘。
 *
 * @param enabled `true` / `false` 覆盖；`null` 恢复成构建配置的值
 */
export function setModelCacheEnabled(enabled: boolean | null): void {
    runtimeOverride = enabled === null ? null : enabled === true;
}
