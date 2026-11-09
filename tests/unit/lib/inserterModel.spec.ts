import { InstancedMesh, Matrix4 } from "three";
import type { BlueprintBuilding } from "@/blueprint/parser";
import { buildingMeta } from "@/data/building";
import { GRID_HORIZONTAL } from "@/planetConstants";
import type { ViewerRenderSettings } from "@/renderSettingsTypes";
import type { BuildBuildingsResult } from "@/lib/core/buildBuildings";

/**
 * 分拣器（2011-2014 / model 41 42 43 483）接入「元数据盒 + GLB」管线后的行为基线。
 *
 * 本文件**不碰 WebGL**：图标图集、GLB 实例化、材质重挂全部打桩，只验证
 *   - 何时走真实模型、何时退回细条（showRealModels / 上限 / 实例化失败 / 缺元数据）
 *   - 传给 `GlbModelInstances` 的建筑矩阵是不是 `transforms[i][0]`（分拣方向坐标系）
 *   - 货物动画在两个分支下都还在
 *   - 统计口径（perModelGlbCounts）包含分拣器
 */

// ---------------------------------------------------------------- 打桩

/** 解析结果由用例控制（jest.mock 工厂里只能引用 `mock` 前缀的变量） */
const mockResolveBuildingModel = jest.fn();

jest.mock("@/models/buildingModel", () => ({
    resolveBuildingModel: (modelIndex: number) =>
        mockResolveBuildingModel(modelIndex),
    requestBuildingModel: jest.fn(),
}));

jest.mock("@/models/glbLoader", () => ({
    reapplyLoadedModelMaterials: () => undefined,
}));

/** 每次实例化的入参，用来断言建筑矩阵与放置矩阵 */
const mockGlbCalls: {
    model: unknown;
    placement: Matrix4;
    matrices: readonly Matrix4[];
    tint: number | null;
}[] = [];
/** 置为 true 时模拟「实例化渲染失败」 */
let mockGlbShouldThrow = false;

jest.mock("@/models/glbInstances", () => {
    // 工厂里不能引用文件顶部的 import（会被编译成越界变量），就地 require
    const { Object3D: Base } = jest.requireActual("three") as typeof import("three");
    return {
        GlbModelInstances: class extends Base {
            meshes: import("three").Object3D[] = [];
            constructor(
                model: unknown,
                placement: import("three").Matrix4,
                matrices: readonly import("three").Matrix4[],
                tint: number | null = null
            ) {
                super();
                mockGlbCalls.push({ model, placement, matrices, tint });
                if (mockGlbShouldThrow) throw new Error("boom");
                this.meshes = [new Base()];
            }
        },
    };
});

jest.mock("@/iconTexture", () => {
    const { Object3D: Base } = jest.requireActual("three") as typeof import("three");
    return {
        IconTexture: class {
            texture = new Base();
            requestIcon() {
                return 0;
            }
            dispose() {}
        },
    };
});

jest.mock("@/icons", () => {
    const { Object3D: Base } = jest.requireActual("three") as typeof import("three");
    return {
        IconGeometry: class {
            constructor(public readonly count: number) {}
            addIcon() {}
        },
        Icons: class extends Base {},
    };
});

jest.mock("@/iconSubscript", () => {
    const { Object3D: Base } = jest.requireActual("three") as typeof import("three");
    return { IconSubscript: class extends Base {} };
});

// 必须在 jest.mock 之后 require，才能拿到被打桩的依赖
/* eslint-disable @typescript-eslint/no-var-requires */
const { buildBuildings } =
    require("@/lib/core/buildBuildings") as typeof import("@/lib/core/buildBuildings");
/* eslint-enable @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------- 夹具

function settings(
    overrides: Partial<ViewerRenderSettings> = {}
): ViewerRenderSettings {
    return {
        showRealModels: true,
        texturesEnabled: false,
        maxInstancesPerModel: Infinity,
        ...overrides,
    };
}

/** 分拣器建筑：localOffset[0] 自己格、localOffset[1] 目标格（方向 +y） */
function inserter(
    overrides: Partial<BlueprintBuilding> = {}
): BlueprintBuilding {
    return {
        index: 0,
        areaIndex: 0,
        localOffset: [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
        ],
        yaw: [0, 0],
        tilt: 0,
        itemId: 2011,
        modelIndex: 41,
        outputObjIdx: -1,
        inputObjIdx: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        recipeId: 0,
        filterId: 0,
        parameters: null,
        ...overrides,
    };
}

/** 建筑世界矩阵：两段（自己格 / 目标格） */
function transformsFor(buildings: BlueprintBuilding[]): Matrix4[][] {
    return buildings.map(() => [
        new Matrix4().makeTranslation(1, 0, 0),
        new Matrix4().makeTranslation(1, 2, 0),
    ]);
}

function metaOf(modelIndex: number) {
    return buildingMeta.get(modelIndex);
}

function build(
    buildings: BlueprintBuilding[],
    overrides: Partial<ViewerRenderSettings> = {}
): BuildBuildingsResult {
    return buildBuildings(transformsFor(buildings), buildings, {
        settings: settings(overrides),
        textureSink: {} as never,
        reapplyMaterials: false,
    });
}

/** 收集场景里除货物动画以外的 InstancedMesh（细条 / 元数据盒 / GLB 部件） */
function solidMeshes(result: BuildBuildingsResult): InstancedMesh[] {
    const out: InstancedMesh[] = [];
    result.buildings.traverse((o) => {
        if (o instanceof InstancedMesh && o !== result.buildings.cargos)
            out.push(o);
    });
    return out;
}

beforeEach(() => {
    mockGlbCalls.length = 0;
    mockGlbShouldThrow = false;
    mockResolveBuildingModel.mockReset();
    // 默认：登记过元数据的模型都能解析出真实 GLB
    mockResolveBuildingModel.mockImplementation((modelIndex: number) => {
        const meta = metaOf(modelIndex);
        return {
            modelIndex,
            glbName: meta === undefined ? null : "inserter-1",
            glb: meta === undefined ? null : { name: "inserter-1" },
            meta,
            tint: null,
            placement: new Matrix4(),
            source: meta === undefined ? "unknown" : "glb",
        };
    });
});

// ---------------------------------------------------------------- 用例

describe("分拣器走「元数据盒 + GLB」管线", () => {
    it("开了真实模型：分拣器进 GLB 组，世界矩阵用 transforms[i][0]（分拣方向坐标系）", () => {
        const buildings = [inserter({ index: 0 }), inserter({ index: 1 })];
        const transforms = transformsFor(buildings);
        const result = buildBuildings(transforms, buildings, {
            settings: settings(),
            textureSink: {} as never,
            reapplyMaterials: false,
        });

        // 同一模型号只建一组，两个实例
        expect(mockGlbCalls).toHaveLength(1);
        expect(mockGlbCalls[0].matrices).toHaveLength(2);
        // 关键：矩阵就是 transforms[i][0]，不是细条用的 inserterTrans 矩阵
        for (let i = 0; i < buildings.length; i++) {
            expect(mockGlbCalls[0].matrices[i].equals(transforms[i][0])).toBe(
                true
            );
        }

        // 统计口径把分拣器算进 GLB
        expect(result.stats.perModelGlbCounts[41]).toBe(2);
        expect(result.stats.glbInstanceCount).toBe(2);
        expect(result.stats.fallbackBoxCount).toBe(0);
        // 货物动画照旧
        expect(result.stats.cargoCount).toBe(2);
        // modelRef 用矩阵语义（与其它 GLB 建筑一致）
        expect("matrix" in result.buildings.modelRef[0]).toBe(true);
    });

    it("关掉真实模型：退回细条几何，modelRef 用实例语义，货物仍在", () => {
        const buildings = [inserter({ index: 0 }), inserter({ index: 1 })];
        const result = build(buildings, { showRealModels: false });

        expect(mockGlbCalls).toHaveLength(0);
        expect(result.stats.perModelGlbCounts).toEqual({});
        expect(result.stats.cargoCount).toBe(2);

        const meshes = solidMeshes(result);
        // 细条 InstancedMesh 只有一条（2 个实例）
        expect(meshes).toHaveLength(1);
        expect(meshes[0].count).toBe(2);
        expect("mesh" in result.buildings.modelRef[0]).toBe(true);
    });

    it("GLB 实例化失败时那一组分拣器退回细条", () => {
        mockGlbShouldThrow = true;
        const buildings = [inserter({ index: 0 })];
        const result = build(buildings);

        expect(result.stats.perModelGlbCounts).toEqual({});
        expect(solidMeshes(result)).toHaveLength(1);
        expect("mesh" in result.buildings.modelRef[0]).toBe(true);
        expect(result.stats.cargoCount).toBe(1);
    });

    it("超过 maxInstancesPerModel 时整组退回细条", () => {
        const buildings = [inserter({ index: 0 }), inserter({ index: 1 })];
        const result = build(buildings, { maxInstancesPerModel: 1 });

        expect(mockGlbCalls).toHaveLength(0);
        expect(result.stats.perModelGlbCounts).toEqual({});
        expect(solidMeshes(result)).toHaveLength(1);
    });

    it("元数据缺登记的分拣器不参与 GLB，按细条渲染", () => {
        const buildings = [inserter({ index: 0, modelIndex: 987654 })];
        const result = build(buildings);

        expect(mockGlbCalls).toHaveLength(0);
        expect(result.stats.perModelGlbCounts).toEqual({});
        expect(solidMeshes(result)).toHaveLength(1);
    });

    it("四种分拣器各自成组（模型号 41/42/43/483 互不串台）", () => {
        const buildings = [
            inserter({ index: 0, itemId: 2011, modelIndex: 41 }),
            inserter({ index: 1, itemId: 2012, modelIndex: 42 }),
            inserter({ index: 2, itemId: 2013, modelIndex: 43 }),
            inserter({ index: 3, itemId: 2014, modelIndex: 483 }),
        ];
        const result = build(buildings);

        expect(mockGlbCalls).toHaveLength(4);
        expect(Object.keys(result.stats.perModelGlbCounts).sort()).toEqual([
            "41",
            "42",
            "43",
            "483",
        ]);
        expect(result.stats.glbInstanceCount).toBe(4);
    });
});

describe("分拣器的元数据盒", () => {
    /** inserter-1..4.glb 的实测包围盒（世界单位，宽 × 高 × 长） */
    const MODEL = { width: 0.99, height: 1.53, depth: 2.06 };

    it("41/42/43/483 的 box 把模型宽度对齐到 1 格（GRID_HORIZONTAL）", () => {
        for (const modelIndex of [41, 42, 43, 483]) {
            const meta = metaOf(modelIndex);
            expect(meta).toBeDefined();
            // boxSize = [宽, 深, 高]
            expect(meta!.boxSize[0]).toBeCloseTo(GRID_HORIZONTAL, 2);
            // 等比缩放 = 盒高 / 模型高，应当就是「1 格 / 模型宽」那个比例
            expect(meta!.boxSize[2] / MODEL.height).toBeCloseTo(
                GRID_HORIZONTAL / MODEL.width,
                2
            );
            // 长宽比保持模型自身比例（等比缩放，不拉伸）
            expect(meta!.boxSize[1] / meta!.boxSize[0]).toBeCloseTo(
                MODEL.depth / MODEL.width,
                2
            );
        }
    });

    it("盒心位于半个盒高处 → 模型底面正好贴地（不会被 scale 压到地面以下）", () => {
        for (const modelIndex of [41, 42, 43, 483]) {
            const meta = metaOf(modelIndex);
            expect(meta!.boxCenter[2]).toBeCloseTo(meta!.boxSize[2] / 2, 5);
        }
    });
});
