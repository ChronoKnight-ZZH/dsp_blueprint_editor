/**
 * 资产根自动探测的优先级：
 *   configureAssetBaseUrl 显式值 → import.meta.url（ESM 构建注入）→ document.currentScript.src
 *   → document.baseURI → 空（相对当前页面）
 *
 * `__DSP_LIB_MODULE_URL__` 是构建期由 webpack DefinePlugin 注入的全局标识符，
 * 单测里直接挂在 globalThis 上模拟（源码用 `typeof` 守卫，未注入时不会抛错）。
 */
import type * as AssetBaseUrlModule from '@/lib/assets/assetBaseUrl';

const MODULE_URL = 'https://cdn.example.com/pkg/build/dsp-blueprint-editor.esm.js';
const MODULE_DIR = 'https://cdn.example.com/pkg/build/';

type GlobalWithProbe = {
    __DSP_LIB_MODULE_URL__?: string;
    document?: unknown;
};

/** 测试里要替换 `document` / 注入构建期标识符，先绕开 lib.dom 的全局类型 */
const g = globalThis as unknown as GlobalWithProbe;

async function loadModule(): Promise<typeof AssetBaseUrlModule> {
    jest.resetModules();
    return import('@/lib/assets/assetBaseUrl');
}

function setModuleUrl(url: string | undefined): void {
    if (url === undefined) {
        delete g.__DSP_LIB_MODULE_URL__;
        return;
    }
    g.__DSP_LIB_MODULE_URL__ = url;
}

function setDocument(documentLike: unknown): void {
    g.document = documentLike;
}

afterEach(() => {
    setModuleUrl(undefined);
    delete g.document;
});

describe('assetBaseUrl：未配置时的自动探测', () => {
    it('import.meta.url 优先，取产物文件所在目录（末尾补 /）', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();

        expect(mod.currentAssetBaseUrl()).toBe(MODULE_DIR);
        expect(mod.resolveAssetUrl('models/smelter.glb')).toBe(`${MODULE_DIR}models/smelter.glb`);
        expect(mod.resolveAssetUrl('/img/tech/1001.png')).toBe(`${MODULE_DIR}img/tech/1001.png`);
    });

    it('没有 import.meta.url 时回落到 document.currentScript.src', async () => {
        setDocument({
            currentScript: { src: 'https://host.example.com/assets/lib/dsp-blueprint-editor.umd.js' },
            baseURI: 'https://host.example.com/page/index.html',
        });

        const mod = await loadModule();

        expect(mod.currentAssetBaseUrl()).toBe('https://host.example.com/assets/lib/');
    });

    it('两者都没有时回落到 document.baseURI 目录', async () => {
        setDocument({ currentScript: null, baseURI: 'https://host.example.com/app/deep/page.html' });

        const mod = await loadModule();

        expect(mod.currentAssetBaseUrl()).toBe('https://host.example.com/app/deep/');
    });

    it('没有任何线索时返回空串（相对当前页面）', async () => {
        const mod = await loadModule();

        expect(mod.currentAssetBaseUrl()).toBe('');
        expect(mod.resolveAssetUrl('models/a.glb')).toBe('models/a.glb');
    });
});

describe('assetBaseUrl：显式配置', () => {
    it('configureAssetBaseUrl 覆盖 import.meta.url', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetBaseUrl('https://cdn.example.com/custom/dsp');

        expect(mod.currentAssetBaseUrl()).toBe('https://cdn.example.com/custom/dsp/');
    });

    it('传 null / 空串清除配置，回到自动探测', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetBaseUrl('https://cdn.example.com/custom/');
        mod.configureAssetBaseUrl(null);
        expect(mod.currentAssetBaseUrl()).toBe(MODULE_DIR);

        mod.configureAssetBaseUrl('https://cdn.example.com/custom/');
        mod.configureAssetBaseUrl('');
        expect(mod.currentAssetBaseUrl()).toBe(MODULE_DIR);
    });

    it('无 document 时相对路径按字符串归一（SSR / 单测）', async () => {
        const mod = await loadModule();
        mod.configureAssetBaseUrl('vendor/dsp');

        expect(mod.currentAssetBaseUrl()).toBe('vendor/dsp/');
        expect(mod.resolveAssetUrl('img/signal/signal-0.png')).toBe('vendor/dsp/img/signal/signal-0.png');
    });
});
