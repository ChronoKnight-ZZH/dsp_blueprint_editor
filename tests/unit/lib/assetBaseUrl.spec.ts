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

/**
 * 映射钩子：宿主已经把模型/图标交给自己的打包器（带内容哈希）管理时，
 * 用它把库内的相对路径换成宿主地址，库产物里不必再放一份 models/、img/。
 */
describe('assetBaseUrl：地址映射钩子', () => {
    const bundled: Record<string, string> = {
        'models/assembler-1.glb': 'https://host.example.com/assets/assembler-1-3f2a1b.glb',
        'img/tech/1001.png': 'https://host.example.com/assets/1001-9c8d7e.png',
    };

    it('命中时直接返回映射地址，跳过资产根拼接', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper((path) => bundled[path] ?? null);

        expect(mod.resolveAssetUrl('models/assembler-1.glb')).toBe(bundled['models/assembler-1.glb']);
        // 前导斜杠会先归一，保证 `/models/x.glb` 与 `models/x.glb` 命中同一项
        expect(mod.resolveAssetUrl('/models/assembler-1.glb')).toBe(bundled['models/assembler-1.glb']);
        expect(mod.resolveAssetUrl('img/tech/1001.png')).toBe(bundled['img/tech/1001.png']);
    });

    it('未命中的路径回退到资产根拼接', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper((path) => bundled[path] ?? null);

        expect(mod.resolveAssetUrl('models/smelter.glb')).toBe(`${MODULE_DIR}models/smelter.glb`);
        expect(mod.resolveAssetUrl('basis/')).toBe(`${MODULE_DIR}basis/`);
    });

    it('返回 undefined / 空串时回退拼接', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper(() => undefined);
        expect(mod.resolveAssetUrl('models/a.glb')).toBe(`${MODULE_DIR}models/a.glb`);

        mod.configureAssetUrlMapper(() => '');
        expect(mod.resolveAssetUrl('models/a.glb')).toBe(`${MODULE_DIR}models/a.glb`);
    });

    it('钩子抛错时不冒泡，按未命中处理', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper(() => {
            throw new Error('宿主映射表还没准备好');
        });

        expect(mod.resolveAssetUrl('models/a.glb')).toBe(`${MODULE_DIR}models/a.glb`);
    });

    it('传 null 清除钩子，回到默认拼接', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper((path) => bundled[path] ?? null);
        mod.configureAssetUrlMapper(null);

        expect(mod.resolveAssetUrl('models/assembler-1.glb')).toBe(`${MODULE_DIR}models/assembler-1.glb`);
    });

    it('不改变 currentAssetBaseUrl（只影响单个 URL 的解析）', async () => {
        setModuleUrl(MODULE_URL);

        const mod = await loadModule();
        mod.configureAssetUrlMapper((path) => bundled[path] ?? null);

        expect(mod.currentAssetBaseUrl()).toBe(MODULE_DIR);
    });
});
