/**
 * 预览动画模式的**运行时解析**（这是"外部端 / MES 端的开关"落地的那一层）。
 *
 * 为什么放在运行时而不是构建期（对应 `data/3.` 的 §5）：
 * 一份产物要同时服务外部端（Wails 桌面）与 MES 端，构建期开关只能"一刀切且必须重新出包"；
 * 而运行时开关可以走既有的 `ViewerRenderSettings` + `SettingsPort` 通道，宿主零新增机制。
 * 构建期那一刀（`DSP_ANIM=off`）仍然保留，只用于"彻底不想让这段代码存在"的发行场景。
 *
 * `auto` 的判定刻意**不做帧率自测**：自测会与"首帧可见 ≤50ms"的预算打架，而且结果不稳定。
 * 只用两个廉价且确定的信号：无障碍偏好 + 逻辑核数。
 */

import type { PreviewAnimationMode } from "./types";

/** `auto` 判定为关闭时逻辑核数的下限 */
const MIN_CORES = 4;

/** 把三态模式解析成确定的两态（`on` / `off`） */
export function resolvePreviewAnimation(
    mode: PreviewAnimationMode | undefined
): "on" | "off" {
    const value = mode ?? "auto";
    if (value === "on") return "on";
    if (value === "off") return "off";

    if (typeof window !== "undefined") {
        try {
            if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
                return "off";
        } catch {
            // matchMedia 在某些嵌入式 WebView 里会抛错 → 视为无偏好
        }
    }
    const cores =
        typeof navigator !== "undefined" &&
        typeof navigator.hardwareConcurrency === "number"
            ? navigator.hardwareConcurrency
            : MIN_CORES;
    return cores >= MIN_CORES ? "on" : "off";
}
