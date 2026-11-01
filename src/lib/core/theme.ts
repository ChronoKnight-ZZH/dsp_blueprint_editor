import type { ThemeColors, ThemeName } from '../types';

/**
 * 主题色板与解析（对齐 v1 的 `Pu` / `resolveTheme`）。
 *
 * 色值直接从 v1 打包产物读出（`灰灰-简单版本/dsp-blueprint-editor.js` @ 688101），
 * 因此两版切换主题后的观感一致。
 */
export const THEME_PALETTE: Record<'dark' | 'light', ThemeColors> = {
    dark: {
        sceneBackground: 0x0D1117,
        planet: 0x1C2128,
        grid: 0x6E7681,
        textFill: '#ffffff',
        textStroke: '#44444488',
    },
    light: {
        sceneBackground: 0xD8DEE4,
        planet: 0xC8D0D8,
        grid: 0xFFFFFF,
        textFill: '#1a1a1a',
        textStroke: '#ffffffaa',
    },
};

/**
 * 把主题名解析成具体色值。
 *
 * `'auto'` 跟随系统 `prefers-color-scheme: light`（与 v1 同一判定）；
 * 无 `window`（SSR / 单测 node 环境）时回落到 dark。返回值是副本，调用方可自由修改。
 */
export function resolveTheme(theme: ThemeName): ThemeColors {
    if (theme === 'auto') {
        const prefersLight = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: light)').matches;
        return { ...THEME_PALETTE[prefersLight ? 'light' : 'dark'] };
    }
    return { ...THEME_PALETTE[theme] };
}
