import type { BlueprintData } from '@/blueprint/parser';
import type { BuildingPickPayload } from '@/lib';

/**
 * `BlueprintViewer` 的契约测试。
 *
 * 为什么 mock `./core/RenderCore` 而不是跑真渲染：
 *   - `RenderCore` 构造要 `new WebGLRenderer` + `PlanetMapControls`，
 *     本项目没有 jsdom、也没有 WebGL，直连必然构建失败；
 *   - 而 `loadBlueprintData` / `loadBlueprint` / 选中 / 定位 / 查询的**全部逻辑**都在 Viewer 这一层：
 *     数据提交、错误按阶段分类、失败保留旧数据、keepCamera、id↔下标解析，内核只是被调用。
 *   所以只替换内核，正好把这层契约完整测到，且不依赖图形栈。
 *
 * 内核本身的行为（重建原子性、设置生效路径、拾取、focusOn 摆位）另由 RenderCore 自己的测试覆盖。
 */

/** 内核 stub 句柄（mock 工厂把实例登记到这里，测试体从中取用） */
interface CoreHandle {
    calls: {
        setBlueprintData: unknown[];
        resetCamera: number;
        dispose: number;
        setRenderSettings: unknown[];
        setSelectedIndex: (number | null)[];
        setSelectedIndexes: number[][];
        clearSelection: number;
        focusBuilding: { index: number; distance?: number }[];
        setSize: { w: number; h: number }[];
        setCallbacks: number;
        setTheme: string[];
        setCustomTheme: unknown[];
    };
    /** 最近一次交给内核的回调桥（用于验证 setCallbacks 的替换语义） */
    coreCallbacks: {
        onBuildingSelect?(pick: BuildingPickPayload | null): void;
        onCameraChange?(): void;
    } | null;
    selectedIndex: number | null;
    camera: unknown;
    cameraVersion: number;
    rendererRef: { domElement: { tagName: string } };
    /** 标记某下标建筑「没有可渲染矩阵」，模拟未知 modelIndex */
    markNotRenderable(index: number): void;
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
            setSelectedIndex: [],
            setSelectedIndexes: [],
            clearSelection: 0,
            focusBuilding: [],
            setSize: [],
            setCallbacks: 0,
            setTheme: [],
            setCustomTheme: [],
        };
        private theme = {
            sceneBackground: 0x000000, planet: 0xB0B0B0, grid: 0xF0F0F0,
            textFill: '#ffffff', textStroke: '#44444488',
        };
        coreCallbacks: CoreHandle['coreCallbacks'] = null;
        selectedIndex: number | null = null;
        private selectedIndexesValue: number[] = [];
        camera = { position: { z: 400.4 } };
        cameraVersion = 7;
        rendererRef = { domElement: { tagName: 'CANVAS' } };

        private stats: { buildingCount: number; unknownModelIndexes: number[] } | null = null;
        /** 预设 stats 后不再被 setBlueprintData 的默认值覆盖 */
        private statsPreset = false;
        private throwNext: unknown = null;
        /** 建筑总数（由最后一次 setBlueprintData 推出），用于「下标是否越界」的判定 */
        private buildingCount = 0;
        private readonly notRenderable = new Set<number>();
        private readonly unknownModels = new Set<number>();

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
            this.buildingCount = (data as { buildings: unknown[] }).buildings.length;
        }

        resetCamera() { this.calls.resetCamera++; }
        setRenderSettings(v: unknown) { this.calls.setRenderSettings.push(v); }
        lastBuildStats() { return this.stats; }
        dispose() { this.calls.dispose++; }

        // --- 选中 / 定位 / 查询（对齐 v1 后新增的门面转发目标） ---
        selectByBuildingId(id: number): number | null {
            return id >= 0 && id < this.buildingCount ? id : null;
        }

        setSelectedIndex(i: number | null) {
            this.selectedIndex = i;
            this.selectedIndexesValue = i === null ? [] : [i];
            this.calls.setSelectedIndex.push(i);
        }

        setSelectedIndexes(indexes: readonly number[]) {
            this.selectedIndexesValue = [...indexes];
            this.selectedIndex = indexes[0] ?? null;
            this.calls.setSelectedIndexes.push([...indexes]);
        }

        get selectedIndexes() { return [...this.selectedIndexesValue]; }

        clearSelection() {
            this.selectedIndex = null;
            this.selectedIndexesValue = [];
            this.calls.clearSelection++;
        }

        getSelectBoxMatrix(i: number) {
            return i >= 0 && i < this.buildingCount ? ({ elements: [] } as never) : null;
        }

        getBuildingModel(i: number) {
            return i >= 0 && i < this.buildingCount ? ({ elements: [] } as never) : null;
        }

        getBuildingInfo(i: number) {
            if (this.notRenderable.has(i) || i < 0 || i >= this.buildingCount)
                return null;
            return { index: i, matrix: { elements: [] } as never };
        }

        isUnknownModel(i: number) { return this.unknownModels.has(i); }

        focusBuilding(i: number, distance?: number) {
            this.calls.focusBuilding.push({ index: i, distance });
            return !this.unknownModels.has(i) && i >= 0 && i < this.buildingCount;
        }

        setSize(w: number, h: number) { this.calls.setSize.push({ w, h }); }

        setTheme(theme: string) { this.calls.setTheme.push(theme); }
        setCustomTheme(patch: unknown) { this.calls.setCustomTheme.push(patch); }
        getTheme() { return { ...this.theme }; }
        toDataURL() { return 'data:image/png;base64,stub'; }
        toBlob() { return Promise.resolve({ size: 1 } as unknown as Blob); }

        setCallbacks(cbs: CoreHandle['coreCallbacks']) {
            this.coreCallbacks = cbs;
            this.calls.setCallbacks++;
        }

        markNotRenderable(i: number) { this.notRenderable.add(i); }
        markUnknown(i: number) { this.unknownModels.add(i); }
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
    return inst as unknown as CoreHandle & { markUnknown(i: number): void };
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
 * 给一个最小占位，只实现 Viewer 用到的 `querySelector` / `getBoundingClientRect`。
 */
beforeAll(() => {
    const g = globalThis as { document?: unknown };
    if (g.document === undefined) {
        g.document = {
            querySelector: () => ({
                appendChild: () => undefined,
                getBoundingClientRect: () => ({ width: 800, height: 600 }),
            }),
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

    it('keepCamera 默认 true：加载后不重置相机（对齐 v1）', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData());
        expect(core.calls.resetCamera).toBe(0);
        viewer.dispose();
    });

    it('keepCamera: false 时加载后自动重置相机', () => {
        const { viewer, core } = createViewer({ keepCamera: false });
        viewer.loadBlueprintData(makeData());
        expect(core.calls.resetCamera).toBe(1);
        viewer.dispose();
    });

    it('keepCamera: true 时同样不重置相机', () => {
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

// ---------------------------------------------------------------- 选中 / 定位

describe('selectBuilding', () => {
    it('选中后内核下标更新，并返回命中的下标', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        const out = viewer.selectBuilding(1);
        expect(out).toEqual({ ok: true, index: 1 });
        expect(core.calls.setSelectedIndex).toEqual([1]);
        expect(viewer.getSelectedIndex()).toBe(1);
        viewer.dispose();
    });

    it('传 null 清除选中，返回 index: -1', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));
        viewer.selectBuilding(1);

        const out = viewer.selectBuilding(null);
        expect(out).toEqual({ ok: true, index: -1 });
        expect(core.calls.clearSelection).toBe(1);
        expect(viewer.getSelectedIndex()).toBeNull();
        viewer.dispose();
    });

    it('未加载时返回 not-loaded', () => {
        const { viewer } = createViewer();
        const out = viewer.selectBuilding(1);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('not-loaded');
        viewer.dispose();
    });

    it('越界下标返回 building-not-found', () => {
        const { viewer } = createViewer();
        viewer.loadBlueprintData(makeData(2));

        const out = viewer.selectBuilding(99);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('building-not-found');
        viewer.dispose();
    });
});

describe('selectedBuildings（多选）', () => {
    it('批量选中并去重，返回命中的数组下标', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        const out = viewer.selectedBuildings([0, 2, 2]);
        expect(out).toEqual({ ok: true, indexes: [0, 2] });
        expect(core.calls.setSelectedIndexes).toEqual([[0, 2]]);
        expect(viewer.getSelectedIndexes()).toEqual([0, 2]);
        expect(viewer.getSelectedIndex()).toBe(0);
        viewer.dispose();
    });

    it('任一建筑找不到时整次失败，且不改动原选中', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(2));

        const out = viewer.selectedBuildings([0, 99]);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('building-not-found');
        expect(core.calls.setSelectedIndexes).toEqual([]);
        expect(core.calls.clearSelection).toBe(0);
        viewer.dispose();
    });

    it('null 或空数组清除选中', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));
        viewer.selectedBuildings([1]);

        expect(viewer.selectedBuildings(null)).toEqual({ ok: true, indexes: [] });
        expect(viewer.selectedBuildings([])).toEqual({ ok: true, indexes: [] });
        expect(core.calls.clearSelection).toBe(2);
        expect(viewer.getSelectedIndexes()).toEqual([]);
        viewer.dispose();
    });
});

describe('focusBuilding（镜头居中对齐）', () => {
    it('默认同时选中，并按默认距离交给内核', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        const out = viewer.focusBuilding(2);
        expect(out).toEqual({ ok: true, index: 2 });
        expect(core.calls.setSelectedIndex).toEqual([2]);
        expect(core.calls.focusBuilding).toEqual([{ index: 2, distance: undefined }]);
        viewer.dispose();
    });

    it('select: false 时只动镜头、不改选中态；distance 原样透传', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        viewer.focusBuilding(2, { select: false, distance: 60 });
        expect(core.calls.setSelectedIndex).toEqual([]);
        expect(core.calls.focusBuilding).toEqual([{ index: 2, distance: 60 }]);
        viewer.dispose();
    });

    it('index 为 null 等价 resetCamera', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        const out = viewer.focusBuilding(null);
        expect(out).toEqual({ ok: true, index: -1 });
        expect(core.calls.resetCamera).toBe(1);
        expect(core.calls.focusBuilding).toEqual([]);
        viewer.dispose();
    });

    it('未加载时返回 not-loaded 且不动镜头', () => {
        const { viewer, core } = createViewer();
        const out = viewer.focusBuilding(1);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('not-loaded');
        expect(core.calls.focusBuilding).toEqual([]);
        viewer.dispose();
    });

    it('未知 modelIndex 返回 not-renderable 且不动镜头', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));
        (core as unknown as { markUnknown(i: number): void }).markUnknown(1);

        const out = viewer.focusBuilding(1);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('not-renderable');
        expect(core.calls.focusBuilding).toEqual([]);
        expect(core.calls.setSelectedIndex).toEqual([]);
        viewer.dispose();
    });

    it('越界下标返回 building-not-found', () => {
        const { viewer } = createViewer();
        viewer.loadBlueprintData(makeData(2));

        const out = viewer.focusBuilding(99);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('building-not-found');
        viewer.dispose();
    });
});

describe('getSelectedIndex', () => {
    it('初始为 null，选中后变值', () => {
        const { viewer } = createViewer();
        viewer.loadBlueprintData(makeData(3));
        expect(viewer.getSelectedIndex()).toBeNull();

        viewer.selectBuilding(2);
        expect(viewer.getSelectedIndex()).toBe(2);
        viewer.dispose();
    });
});

describe('getBuildingInfo', () => {
    it('返回 { index, id, matrix }', () => {
        const { viewer } = createViewer();
        viewer.loadBlueprintData(makeData(3));

        const out = viewer.getBuildingInfo(1);
        expect(out.ok).toBe(true);
        if (!out.ok)
            throw new Error('unreachable');
        expect(out.value.index).toBe(1);
        expect(out.value.id).toBe(1);
        expect(out.value.matrix).toBeDefined();
        viewer.dispose();
    });

    it('没有可渲染矩阵时返回 not-renderable', () => {
        const { viewer, core } = createViewer();
        viewer.loadBlueprintData(makeData(3));
        core.markNotRenderable(1);

        const out = viewer.getBuildingInfo(1);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('not-renderable');
        viewer.dispose();
    });

    it('越界下标返回 building-not-found，未加载返回 not-loaded', () => {
        const { viewer } = createViewer();
        const before = viewer.getBuildingInfo(0);
        expect(before.ok).toBe(false);
        if (before.ok)
            throw new Error('unreachable');
        expect(before.error.code).toBe('not-loaded');

        viewer.loadBlueprintData(makeData(2));
        const out = viewer.getBuildingInfo(9);
        expect(out.ok).toBe(false);
        if (out.ok)
            throw new Error('unreachable');
        expect(out.error.code).toBe('building-not-found');
        viewer.dispose();
    });
});

describe('只读透出与尺寸', () => {
    it('getCamera / getCameraVersion / getCanvas 透传内核', () => {
        const { viewer, core } = createViewer();
        expect(viewer.getCamera()).toBe(core.camera);
        expect(viewer.getCameraVersion()).toBe(7);
        expect(viewer.getCanvas()).toBe((core.rendererRef as { domElement: unknown }).domElement);
        viewer.dispose();
    });

    it('setSize 透传显式尺寸', () => {
        const { viewer, core } = createViewer();
        viewer.setSize(400, 300);
        expect(core.calls.setSize).toEqual([{ w: 400, h: 300 }]);
        viewer.dispose();
    });

    it('构造参数 width/height 会转成 setSize', () => {
        const { core } = createViewer({ width: 320, height: 240 });
        expect(core.calls.setSize).toEqual([{ w: 320, h: 240 }]);
    });
});

describe('主题与导出', () => {
    it('构造时默认套用 editor 主题', () => {
        const { core } = createViewer();
        expect(core.calls.setTheme).toEqual(['editor']);
    });

    it('构造参数 theme 透传', () => {
        const { core } = createViewer({ theme: 'light' });
        expect(core.calls.setTheme).toEqual(['light']);
    });

    it('setTheme / setCustomTheme / getTheme 透传内核', () => {
        const { viewer, core } = createViewer();
        viewer.setTheme('auto');
        expect(core.calls.setTheme).toEqual(['editor', 'auto']);

        viewer.setCustomTheme({ grid: 0xFF0000 });
        expect(core.calls.setCustomTheme).toEqual([{ grid: 0xFF0000 }]);

        expect(viewer.getTheme()?.sceneBackground).toBe(0x000000);
        viewer.dispose();
    });

    it('toDataURL / toBlob 透传内核', async () => {
        const { viewer } = createViewer();
        expect(viewer.toDataURL()).toBe('data:image/png;base64,stub');
        await expect(viewer.toBlob()).resolves.toBeTruthy();
        viewer.dispose();
    });

    it('销毁后 toDataURL 返回 null，toBlob resolve null', async () => {
        const { viewer } = createViewer();
        viewer.dispose();
        expect(viewer.toDataURL()).toBeNull();
        await expect(viewer.toBlob()).resolves.toBeNull();
        expect(viewer.getTheme()).toBeNull();
    });
});

describe('setCallbacks', () => {
    it('默认整体替换：旧回调不再触发', () => {
        const { viewer, core } = createViewer();
        const first = jest.fn();
        viewer.setCallbacks({ onBuildingSelect: first });

        // 模拟内核点击命中（走的是内核回调桥）
        core.coreCallbacks?.onBuildingSelect?.({ index: 0, id: 0 });
        expect(first).toHaveBeenCalledTimes(1);

        viewer.setCallbacks({ onCameraChange: jest.fn() });
        core.coreCallbacks?.onBuildingSelect?.({ index: 1, id: 1 });
        expect(first).toHaveBeenCalledTimes(1);   // 已被替换掉
        viewer.dispose();
    });

    it('merge: true 时保留旧回调', () => {
        const { viewer, core } = createViewer();
        const first = jest.fn();
        viewer.setCallbacks({ onBuildingSelect: first });
        viewer.setCallbacks({ onCameraChange: jest.fn() }, { merge: true });

        core.coreCallbacks?.onBuildingSelect?.({ index: 0, id: 0 });
        expect(first).toHaveBeenCalledTimes(1);
        viewer.dispose();
    });
});
