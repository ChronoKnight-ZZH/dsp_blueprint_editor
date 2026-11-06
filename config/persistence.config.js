/**
 * 本地持久化（缓存）的**全局开关** —— 编辑器构建与发布库构建共用这一份配置。
 *
 * 关闭后，运行时拿到的是一个「空操作」缓存对象（`src/models/modelCache.ts` 的
 * `NoopModelCache`）：读永远未命中、写永远失败、清单永远为空、清空永远 0 条，
 * 而且**完全不碰 Cache Storage** —— 不占配额、不发请求、不抛错、不留日志。
 * 调用方（glbLoader / 离线模型包 / 宿主）不需要任何 `if (开关)` 分支。
 *
 * 为什么是构建期开关而不是运行时读取 localStorage：
 * - 关闭时整条缓存链路在产物里就退化成常量，没有探测与分支成本；
 * - 发布库需要由宿主决定是否替它写存储，所以「构建期默认值 + 运行时 API」
 *   （`setModelCacheEnabled()`）两段式最稳。
 *
 * 改完必须重新构建对应产物才生效：
 * - web：`yarn build` / `yarn serve` —— 编辑器 + PWA（含「离线模型包」入口）
 * - lib：`yarn build:lib`         —— `dist-lib/` 发布产物
 *
 * 注入方式：两个构建脚本各自把对应字段编译成 `__DSP_MODEL_CACHE_ENABLED__`
 * （见 `vue.config.js` 与 `scripts/lib-build/build.js` 的 DefinePlugin）。
 */

module.exports = {
    /**
     * Web 端（编辑器 / PWA）：默认**开启**。
     * 看过的模型顺手落盘 → 断网也能显示；「离线模型包」按钮才有意义。
     */
    web: true,

    /**
     * 构建库（`dist-lib/`）：默认**关闭**。
     * 库是嵌在宿主页面里的无头渲染器，存储属于宿主；不替宿主预写最多 ~128 MB
     * 的模型。宿主需要离线能力时，在启动时调用 `setModelCacheEnabled(true)`
     * 显式开启（见 `src/lib/index.ts` 的导出）。
     */
    lib: false,
};
