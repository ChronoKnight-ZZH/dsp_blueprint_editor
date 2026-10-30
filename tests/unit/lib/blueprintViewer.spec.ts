import type { BlueprintData } from '@/blueprint/parser';

/**
 * `BlueprintViewer` 的契约测试。
 *
 * 为什么 mock `./core/RenderCore` 而不是跑真渲染：
 *   - `RenderCore` 构造要 `new WebGLRenderer` + `PlanetMapControls`，
 *     本项目没有 jsdom、也没有 WebGL，直连必然构建失败；
 *   - 而 `loadBlueprintData` / `loadBlueprint` 的**全部逻辑**都在 Viewer 这一层：
 *     数据提交、错误按阶段分类、失败保留旧数据、keepCamera，内核只是被调用。
 *   所以只替换内核，正好把这层契约完整测到，且不依赖图形栈。
 *
 * 内核本身的行为（重建原子性、设置生效路径、拾取）另由 RenderCore 自己的测试覆盖。
 */

/** 内核 stub 句柄（mock 工厂把实例登记到这里，测试体从中取用） */
interface CoreHandle {
    calls: {
        setBlueprintData: unknown[];
        resetCamera: number;
        dispose: number;
        setRenderSettings: unknown[];
    };
    failNext(e: unknown): void;
    setStats(s: { buildingCount: number; unknownModelIndexes: number[] } | null): void;
}

/** jest.mock 工厂只能引用 `mock` 前缀的外部变量（其求值晚于工厂定义，故不是 TDZ 问题） */
const mockCoreInstances: CoreHandle[] = [];

jest.mock('@/lib/core/RenderCore', () => {
    class MockRenderPhaseError extends Error {
        constructor(
            public readonly phase: 'position' | 'build',
            public readonly original: unknown,
        ) {
            super(original instanceof Error ? original.message : String(original));
            this.name = 'RenderPhaseError';
        }
    }

    class MockRenderCore implements CoreHandle {
        calls: CoreHandle['calls'] = {
            setBlueprintData: [],
            resetCamera: 0,
            dispose: 0,
            setRenderSettings: [],
        };
        private stats: { buildingCount: number; unknownModelIndexes: number[] } | null = null;
        /** 预设 stats 后不再被 setBlueprintData 的默认值覆盖 */
        private statsPreset = false;
        private throwNext: unknown = null;

        constructor() {
            mockCoreInstances.push(this);
        }

        setBlueprintData(data: unknown) {
            if (this.throwNext !== null) {
                const e = this.throwNext;
                this.throwNext = null;
                throw e;
            }
            this.calls.setBlueprintData.push(data);
            if (!this.statsPreset) {
                const d = data as { buildings: unknown[] };
                this.stats = { buildingCount: d.buildings.length, unknownModelIndexes: [] };
            }
        }

        resetCamera() { this.calls.resetCamera++; }
        setRenderSettings(v: unknown) { this.calls.setRenderSettings.push(v); }
        lastBuildStats() { return this.stats; }
        dispose() { this.calls.dispose++; }

        failNext(e: unknown) { this.throwNext = e; }
        setStats(s: { buildingCount: number; unknownModelIndexes: number[] } | null) {
            this.stats = s;
            this.statsPreset = s !== null;
        }
    }

    return { RenderCore: MockRenderCore, RenderPhaseError: MockRenderPhaseError };
});

import { BlueprintViewer } from '@/lib/BlueprintViewer';
import { RenderPhaseError } from '@/lib/core/RenderCore';

/** 取最后一次构造的内核句柄 */
function lastCore(): CoreHandle {
    const inst = mockCoreInstances[mockCoreInstances.length - 1];
    if (inst === undefined)
        throw new Error('RenderCore 未被构造（mock 未生效或容器解析失败）');
    return inst;
}

/** 造一份最小 BlueprintData：只填 Viewer 真正读到的字段 */
function makeData(buildingCount = 3): BlueprintData {
    return {
        header: {
            layout: 0, icons: [], time: new Date(0), gameVersion: '0.10.34', shortDesc: 'test',
            author: '', blueprintVersion: '1', properties: '', desc: '',
        },
        version: 1,
        cursorOffset: { x: 0, y: 0 },
        cursorTargetArea: 0,
        dragBoxSize: { x: 1, y: 1 },
        primaryAreaIdx: 0,
        areas: [],
        buildings: Array.from({ length: buildingCount }, (_, i) => ({
            index: i, areaIndex: 0,
            localOffset: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
            yaw: [0, 0], tilt: 0, itemId: 0, modelIndex: 0,
            outputObjIdx: 0, inputObjIdx: 0, outputToSlot: 0, inputFromSlot: 0,
            outputFromSlot: 0, inputToSlot: 0, outputOffset: 0, inputOffset: 0,
            recipeId: 0, filterId: 0, parameters: null,
        })) as BlueprintData['buildings'],
        reforms: null,
    } as unknown as BlueprintData;
}

/**
 * 容器解析：Viewer 会 `document.querySelector`，node 环境没有 document。
 * 给一个最小占位，只实现 Viewer 用到的 `querySelector`。
 */
beforeAll(() => {
    const g = globalThis as { document?: unknown };
    if (g.document === undefined) {
        g.document = {
            querySelector: () => ({ appendChild: () => undefined }),
        };
    }
});

beforeEach(() => {
    mockCoreInstances.length = 0;
});

function createViewer(
    options: Partial<ConstructorParameters<typeof BlueprintViewer>[0]> = {},
    cbs: ConstructorParameters<typeof BlueprintViewer>[1] = {},
) {
    const viewer = new BlueprintViewer({ container: '#el', ...options }, cbs);
    const core = lastCore();
    return { viewer, core };
}

describe('loadBlueprintData', () => {
    it('成功时返回 ok 且 buildingCount 等于 buildings.length', () => {
        const { viewer } = createViewer();
        const out = viewer.loadBlueprintData(makeData(3));

        expect(out.ok).toBe(true);
        if (!out.ok)
            throw new Error('unreachable');
        expect(out.value.buildingCount).toBe(3);
        expect(out.value.areas).toEqual([]);
        expect(out.value.header.shortDesc).toBe('test');
        viewer.dispose();
    });

    it('成功时把数据交给内核，并记入 getBlueprintData', () => {
        const { viewer, core } = createViewer();
        const data = makeData(2);
        viewer.loadBlueprintData(data);

        expect(core.calls.setBlueprintData).toHaveLength(1);
        expect(core.calls.setBlueprintData[0]).toBe(data);
        expect(viewer.getBlueprintData()).toBe(data);
        viewer.dispose();
    });

    it('默认会重置相机（keepCamera 未设）', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData());
        expect(core.calls.resetCamera).toBe(1);
        viewer.dispose();
    });

    it('keepCamera: true 时不重置相机', () => {
        const { viewer, core } = createViewer({ keepCamera: true });
        viewer.loadBlueprintData(makeData());
        expect(core.calls.resetCamera).toBe(0);
        viewer.dispose();
    });

    it('内核上报 unknownModelIndexes 时透传到返回值', () => {
        const { viewer, core } = createViewer();
        core.setStats({ buildingCount: 1, unknownModelIndexes: [117, 999] });
        const out = viewer.loadBlueprintData(makeData(1));

        expect(out.ok).toBe(true);
        if (!out.ok)
            throw new Error('unreachable');
        expect(out.value.unknownModelIndexes).toEqual([117, 999]);
        viewer.dispose();
    });

    it('内核抛错时返回 ok:false，且保留上一次成功的数据', () => {
        const { viewer, core } = createViewer();
        const good = makeData(2);
        viewer.loadBlueprintData(good);
        expect(viewer.getBlueprintData()).toBe(good);

        core.failNext(new Error('boom'));
        const out = viewer.loadBlueprintData(makeData(5));

        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('build-failed');
        // 关键约定（方案 §6.4）：失败不改数据
        expect(viewer.getBlueprintData()).toBe(good);
        viewer.dispose();
    });

    it('RenderPhaseError(position) 的分类是定位阶段而非 build-failed', () => {
        const { viewer, core } = createViewer();
        core.failNext(new RenderPhaseError('position', new Error('No root area')));
        const out = viewer.loadBlueprintData(makeData());

        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.phase).toBe('position');
        expect(out.error.code).toBe('no-root-area');
        viewer.dispose();
    });

    it('dispose 之后调用返回 already-disposed', () => {
        const { viewer, core } = createViewer();
        viewer.dispose();
        const out = viewer.loadBlueprintData(makeData());

        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('already-disposed');
        expect(core.calls.dispose).toBe(1);
    });

    it('容器解析失败时返回 no-container', () => {
        const g = globalThis as { document?: unknown };
        const saved = g.document;
        g.document = undefined;
        try {
            const viewer = new BlueprintViewer({ container: '#missing' });
            const out = viewer.loadBlueprintData(makeData());
            expect(out.ok).toBe(false);
            if (out.ok)
                throw new Error('unreachable');
            expect(out.error.code).toBe('no-container');
            viewer.dispose();
        }
        finally {
            g.document = saved;
        }
    });
});

describe('loadBlueprint 与 loadBlueprintData 共用同一条链路', () => {
    it('解析失败时不进内核', () => {
        const { viewer, core } = createViewer();
        const out = viewer.loadBlueprint('BLUEPRINT:bad');
        expect(out.ok).toBe(false);
        expect(core.calls.setBlueprintData).toHaveLength(0);
        viewer.dispose();
    });
});
