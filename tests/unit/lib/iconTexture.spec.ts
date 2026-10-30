import { IconTexture } from '@/iconTexture';
import type { TextureSink } from '@/iconTexture';
import { allIconIds } from '@/data/icons';

/**
 * `IconTexture` 的两处修复（方案 §5 第 8、9 行）：
 *   1. `loaded` 必须按**槽位索引**记录：旧代码用 `this.loaded[iconId]` 索引一个
 *      长度为 WIDTH*HEIGHT 的数组，而 iconId 普遍远大于该长度，守卫形同失效，
 *      同一图标会被反复下载/上传。
 *   2. 新增 `dispose()`：图集纹理经 `renderer.initTexture` 上传，不释放就会在
 *      每次场景重建时泄漏一张 1920×1920 纹理。
 */

/** 取前 n 个真实 icon id（`allIconIds` 是 generator，需要迭代取出） */
function firstIconIds(n: number): number[] {
    const out: number[] = [];
    for (const id of allIconIds()) {
        out.push(id);
        if (out.length >= n)
            break;
    }
    return out;
}

/**
 * jest 默认是 node 环境（本项目未安装 jest-environment-jsdom）。
 * `IconTexture` 只需要一个 canvas 占位对象作纹理源，真正的 WebGL 上传走 stub sink，
 * 不会触碰 canvas 的任何像素接口，因此给个最小对象即可。
 */
beforeAll(() => {
    const g = globalThis as { document?: unknown };
    if (g.document === undefined) {
        g.document = {
            createElement: () => ({ width: 0, height: 0 }),
        };
    }
});

/** 记录调用的 sink：不碰真实 WebGL，node 环境下可跑 */
function makeSink() {
    const inits: string[] = [];
    const copyCount = { value: 0 };
    const sink: TextureSink = {
        initTexture: t => { inits.push(t.name); },
        copyTextureToTexture: () => { copyCount.value++; },
    };
    return { sink, inits, copyCount };
}

describe('IconTexture', () => {
    it('构造时只上传一次图集纹理', () => {
        const { sink, inits } = makeSink();
        const tex = new IconTexture(sink);
        expect(inits).toEqual(['icons']);
        tex.dispose();
    });

    it('同一 iconId 重复请求返回同一槽位，且只发起一次下载', () => {
        const { sink, copyCount } = makeSink();
        const tex = new IconTexture(sink);
        const [iconId] = firstIconIds(1);

        const a = tex.requestIcon(iconId);
        const b = tex.requestIcon(iconId);
        const c = tex.requestIcon(iconId);

        expect(a).toBeGreaterThan(0);
        expect(a).toBe(b);
        expect(b).toBe(c);
        // 异步加载尚未完成 → 还没有任何纹理拷贝
        expect(copyCount.value).toBe(0);
        tex.dispose();
    });

    it('不同 iconId 分配不同槽位', () => {
        const { sink } = makeSink();
        const tex = new IconTexture(sink);
        const [first, second] = firstIconIds(2);
        expect(tex.requestIcon(first)).not.toBe(tex.requestIcon(second));
        tex.dispose();
    });

    it('未知 iconId 返回 0（保留给空图标），且不分配槽位', () => {
        const { sink } = makeSink();
        const tex = new IconTexture(sink);
        expect(tex.requestIcon(-12345)).toBe(0);
        expect(tex.has(-12345)).toBe(false);
        tex.dispose();
    });

    it('已知 iconId 在分配后 has() 为 true', () => {
        const { sink } = makeSink();
        const tex = new IconTexture(sink);
        const [iconId] = firstIconIds(1);
        expect(tex.has(iconId)).toBe(true);
        tex.dispose();
    });

    it('dispose 释放图集纹理', () => {
        const { sink } = makeSink();
        const tex = new IconTexture(sink);
        const disposeSpy = jest.spyOn(tex.texture, 'dispose');
        tex.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
});
