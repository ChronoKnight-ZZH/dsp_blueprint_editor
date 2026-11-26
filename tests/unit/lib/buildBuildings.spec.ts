import { Matrix4, Vector3 } from "three";
import { findPosForAreas, calcBuildingTrans } from "@/planet/planet";
import type { BlueprintArea, BlueprintBuilding } from "@/blueprint/parser";
import type { TextureSink } from "@/icon/iconTexture";
import { PLANET_RADIUS, PLANET_SEGMENT } from "@/planet/planetConstants";
import { buildBuildings } from "@/lib/core/buildBuildings";
import type { BuildBuildingsResult } from "@/lib/core/buildBuildings";
import { CARGO_FADE, CARGO_SIZE } from "@/Animation/cargos";
import { INSERTER_BEAM_THICKNESS } from "@/Animation/inserter";

/**
 * `buildBuildings` 的渲染层回归（方案 §9.1-A/C/D/E、§9.2、P6）。
 *
 * 覆盖在无 WebGL 环境下**可以确定性验证**的部分：货物几何与分拣器横梁的垂直
 * 资源预算、以及 GPU 资源的释放行为。
 *
 * 边界：Jest 无 WebGL，**不验证** GLSL 能否编译、Draw Call 实测值、动画观感与帧率
 * （走 §9.3-E-5 人工冒烟与 A-P1~A-P3 浏览器核对）。传送带侧的条带 / 圆弧几何
 * 原先由 `Animation/belt.ts` 承载，该实现已被 ribbon 方案取代并删除，相关用例一并下线。
 */

// `IconTexture` 只需要 canvas 占位对象作纹理源，真正上传走 stub sink（node 环境无 document）
beforeAll(() => {
    const g = globalThis as { document?: unknown };
    if (g.document === undefined) {
        g.document = { createElement: () => ({ width: 0, height: 0 }) };
    }
});

function makeSink(): TextureSink {
    return {
        initTexture: () => undefined,
        copyTextureToTexture: () => undefined,
    };
}

/** 单 region、足够大的 area：`calcBuildingTrans` 不校验 localOffset 是否越界 */
function area(): BlueprintArea {
    return {
        index: 0,
        parentIndex: -1,
        tropicAnchor: 0,
        areaSegments: 200,
        anchorLocalOffset: { x: 0, y: 0 },
        size: { x: 40, y: 40 },
    };
}

let nextIndex = 0;

function makeBuilding(
    overrides: Partial<BlueprintBuilding>
): BlueprintBuilding {
    return {
        index: nextIndex++,
        areaIndex: 0,
        localOffset: [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
        ] as BlueprintBuilding["localOffset"],
        yaw: [0, 0] as BlueprintBuilding["yaw"],
        tilt: 0,
        itemId: 0,
        modelIndex: 0,
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

/** 传送带：一条记录 = 1 格，`localOffset[0] === localOffset[1]`（方案 §3.4-F1） */
function beltBuilding(
    x: number,
    y: number,
    outputObjIdx: number,
    yaw = 0,
    itemId = 2001,
    modelIndex = 35,
    z = 0
): BlueprintBuilding {
    return makeBuilding({
        localOffset: [
            { x, y, z },
            { x, y, z },
        ],
        yaw: [yaw, yaw],
        itemId,
        modelIndex,
        outputObjIdx,
    });
}

/** 分拣器：`localOffset[0]` 是起点、`localOffset[1]` 是尖端 */
function inserterBuilding(
    from: { x: number; y: number },
    to: { x: number; y: number },
    modelIndex = 41
): BlueprintBuilding {
    return makeBuilding({
        localOffset: [
            { x: from.x, y: from.y, z: 0 },
            { x: to.x, y: to.y, z: 0 },
        ],
        itemId: 2011,
        modelIndex,
    });
}

const SETTINGS = {
    showRealModels: false,
    texturesEnabled: false,
    maxInstancesPerModel: Infinity,
};

function build(
    buildings: BlueprintBuilding[]
): BuildBuildingsResult & { transforms: Matrix4[][] } {
    const pos = findPosForAreas([area()], PLANET_SEGMENT);
    const transforms = buildings.map((b) =>
        calcBuildingTrans(PLANET_RADIUS, pos, b)
    );
    const built = buildBuildings(transforms, buildings, {
        settings: SETTINGS,
        textureSink: makeSink(),
        reapplyMaterials: false,
    });
    return { ...built, transforms };
}

describe("buildBuildings · 货物几何与垂直预算", () => {
    it("分拣器：横梁在上、货物在下，间隙约 0.02（D-1）", () => {
        nextIndex = 0;
        const buildings = [
            inserterBuilding({ x: 10, y: 10 }, { x: 10, y: 11 }),
            inserterBuilding({ x: 12, y: 10 }, { x: 13, y: 10 }, 42),
        ];
        const result = build(buildings);
        try {
            const first = result.buildings.modelRef[0];
            expect(first).toBeDefined();
            if (first === undefined || !("mesh" in first)) {
                throw new Error("分拣器 modelRef 不是 mesh 引用");
            }
            const beamM = new Matrix4();
            first.mesh.getMatrixAt(first.instance, beamM);
            const cargoM = new Matrix4();
            result.buildings.cargos.getMatrixAt(0, cargoM);

            const beamBottom = new Vector3(
                0,
                -INSERTER_BEAM_THICKNESS / 2,
                0
            ).applyMatrix4(beamM);
            const cargoTop = new Vector3(0, CARGO_SIZE / 2, 0).applyMatrix4(
                cargoM
            );
            // 方案 §6.4 垂直预算：横梁 [0.37, 0.49]（厚度翻倍后抬高 0.03）、
            // 货物 [0.05, 0.35]
            expect(beamBottom.length() - PLANET_RADIUS).toBeCloseTo(0.37, 2);
            expect(cargoTop.length() - PLANET_RADIUS).toBeCloseTo(0.35, 2);
            expect(beamBottom.length()).toBeGreaterThan(cargoTop.length());
            expect(beamBottom.length() - cargoTop.length()).toBeCloseTo(
                0.02,
                1
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});

describe("buildBuildings · 资源释放", () => {
    it("dispose 释放条带/货物/分拣器几何，且可重复调用（R-4）", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, -1),
            inserterBuilding({ x: 12, y: 10 }, { x: 12, y: 11 }),
        ]);
        const disposed: string[] = [];
        const seen = new Set<object>();
        result.buildings.traverse((o) => {
            const geometry = (o as { geometry?: object }).geometry as
                | {
                      type: string;
                      addEventListener(e: string, cb: () => void): void;
                  }
                | undefined;
            if (geometry === undefined || seen.has(geometry)) return;
            seen.add(geometry);
            geometry.addEventListener("dispose", () =>
                disposed.push(geometry.type)
            );
        });

        result.buildings.dispose();
        // 条带 ribbon（带身 + 半圆端帽 + 弧形边框，均为 BufferGeometry）必须被释放；
        // 孤立格的端点圆柱已由两个半圆端帽取代，因此这里不再断言 CylinderGeometry。
        expect(disposed).toContain("BufferGeometry");
        expect(disposed.length).toBeGreaterThanOrEqual(3);
        expect(() => result.buildings.dispose()).not.toThrow();
        result.iconTexture.dispose();
    });
});

describe("buildBuildings · 货物端点淡出", () => {
    it("淡出窗口内货物缩到 0（复刻着色器公式：端点处 cubic 曲线两端为 0）", () => {
        // 与 cargos.ts 的 GLSL 同式：sizeScale = smoothstep(0,F,m) * (1 - smoothstep(1-F,1,m))
        const smoothstep = (a: number, b: number, x: number) => {
            const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        const scale = (m: number) =>
            smoothstep(0, CARGO_FADE, m) *
            (1 - smoothstep(1 - CARGO_FADE, 1, m));
        expect(scale(0)).toBe(0);
        expect(scale(1)).toBe(0);
        expect(scale(0.5)).toBe(1);
        expect(scale(CARGO_FADE)).toBe(1);
        // 单调：刚出端点时变大、快到端点时变小
        expect(scale(0.01)).toBeGreaterThan(0);
        expect(scale(0.01)).toBeLessThan(scale(0.03));
        expect(scale(0.99)).toBeLessThan(scale(0.97));
    });
});
