import {
    Color,
    InstancedMesh,
    Matrix4,
    Quaternion,
    ShaderLib,
    Vector3,
} from "three";
import type { BoxGeometry, WebGLProgramParametersWithUniforms } from "three";
import { readFileSync } from "fs";
import { findPosForAreas, calcBuildingTrans } from "@/planet/planet";
import { fromStr } from "@/blueprint/parser";
import type { BlueprintArea, BlueprintBuilding } from "@/blueprint/parser";
import type { TextureSink } from "@/icon/iconTexture";
import {
    HEIGHT_GRID_SIZE,
    PLANET_RADIUS,
    PLANET_SEGMENT,
} from "@/planet/planetConstants";
import { buildBuildings } from "@/lib/core/buildBuildings";
import type { BuildBuildingsResult } from "@/lib/core/buildBuildings";
import {
    Belts,
    BELT_ARC_LENGTH,
    BELT_ELBOW_LIFT,
    BELT_ELBOW_STUB,
    BELT_HEIGHT,
    BELT_LEN,
    BELT_LIFT,
    BELT_RISER_BASE,
    BELT_WIDTH,
    CARGO_LIFT,
    RISER_CARGO_SIDE,
} from "@/Animation/belt";
import { BeltElbows } from "@/Animation/beltElbow";
import { computeBeltShapes } from "@/Animation/beltArc";
import {
    BELT_CAP_DIAMETER,
    BELT_CAP_LIFT,
    BELT_CAP_OVERLAP,
    BELT_CAP_RADIUS,
    BELT_CAP_SHORTEN,
    BELT_CAP_TIP_INSET,
} from "@/Animation/beltCaps";
import {
    CARGO_COLOR,
    CARGO_FADE,
    CARGO_SIZE,
    Cargos,
} from "@/Animation/cargos";
import { isBelt, isInserter } from "@/data/items";

/**
 * `buildBuildings` 的渲染层回归（方案 §9.1-A/C/D/E、§9.2、P6）。
 *
 * 覆盖在无 WebGL 环境下**可以确定性验证**的部分：
 *   1. 条带 / 圆点实例数与 `belts` 字段的可空语义（A-1、R-5）；
 *   2. 条带姿态（段长 = 一格、朝向与数据一致、相邻段首尾相接）与 `modelRef` 语义（A-2/A-4、R-2）；
 *   3. 货物与条带/横梁的垂直预算、配色分离、以及箭头着色器的注入结构（D-1/D-3/E-1/G-1~G-5）。
 *
 * 边界：Jest 无 WebGL，**不验证** GLSL 能否编译、Draw Call 实测值、动画观感与帧率
 * （走 §9.3-E-5 人工冒烟与 A-P1~A-P3 浏览器核对）。
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

function stripMeshes(result: BuildBuildingsResult): Belts[] {
    return result.buildings.children.filter(
        (o): o is Belts => o instanceof Belts
    );
}

/** 圆点 mesh（真正孤立的格；名字写在 `buildBelts` 里） */
function dotMeshes(result: BuildBuildingsResult) {
    return result.buildings.children.filter((o) => o.name === "beltDots");
}

/** 端帽 mesh（半圆盘，v4 新增） */
function capMeshes(result: BuildBuildingsResult): InstancedMesh[] {
    return result.buildings.children.filter(
        (o): o is InstancedMesh =>
            o instanceof InstancedMesh && o.name === "beltCaps"
    );
}

/** 圆环弯头 mesh（转角格，v5 新增） */
function elbowMeshes(result: BuildBuildingsResult): BeltElbows[] {
    return result.buildings.children.filter(
        (o): o is BeltElbows => o instanceof BeltElbows
    );
}

/** 读第 i 个条带/圆环两端的端面位移（正=伸出格子，负=内收） */
function endsAt(mesh: Belts | BeltElbows, i: number) {
    const a = mesh.geometry.beltEnds.array as Float32Array;
    return { back: a[i * 2], front: a[i * 2 + 1] };
}

function instanceCount(mesh: unknown): number {
    return (mesh as { count: number }).count;
}

/** 条带两端点（局部 z = ∓BELT_LEN/2；-z 为流动方向） */
function stripEnds(mesh: Belts, i: number) {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return {
        matrix: m,
        down: new Vector3(0, 0, -BELT_LEN / 2).applyMatrix4(m),
        up: new Vector3(0, 0, BELT_LEN / 2).applyMatrix4(m),
    };
}

function cellCenter(transforms: Matrix4[][], index: number): Vector3 {
    return new Vector3().setFromMatrixPosition(transforms[index][0]);
}

/** 读第 i 个条带的形状参数（`aBeltArc` = 弧参数，`aBeltAux` = 坡度 / 外延 / 出口切线） */
function shapeAt(mesh: Belts | BeltElbows, i: number) {
    const arc = mesh.geometry.beltArc.array as Float32Array;
    const aux = mesh.geometry.beltAux.array as Float32Array;
    return {
        theta0: arc[i * 4],
        theta1: arc[i * 4 + 1],
        centerX: arc[i * 4 + 2],
        centerZ: arc[i * 4 + 3],
        slope: aux[i * 4],
        extend: aux[i * 4 + 1],
        exitX: aux[i * 4 + 2],
        exitZ: aux[i * 4 + 3],
    };
}

/**
 * 复刻 `BeltMaterial` 顶点着色器的圆弧公式（v4：圆心 / θ 范围由 CPU 给，着色器只插值），
 * 返回相位 `phase`（1=后缘入射，0=前缘出射）处的中线点（世界坐标，含 `BELT_LIFT` 抬升）。
 *
 * 用途：验证转角两端的**落点**——正确时正好是相邻两格共享边的中点，
 * 圆心取错（本格中心 / 等弧长半径）会偏出 0.24 以上。
 */
function arcPoint(mesh: Belts | BeltElbows, i: number, phase: number): Vector3 {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    const s = shapeAt(mesh, i);
    const u = 1 - phase; // u = 0 后缘（入射）、u = 1 前缘（出射）
    const th = s.theta0 + (s.theta1 - s.theta0) * u;
    return new Vector3(
        s.centerX + (BELT_LEN / 2) * Math.cos(th),
        0,
        s.centerZ + (BELT_LEN / 2) * Math.sin(th)
    ).applyMatrix4(m);
}

/** 两格中心连线的中点 ≈ 它们共享边的中点（仅差球面弦高） */
function sharedEdgeMid(a: Vector3, b: Vector3): Vector3 {
    return a.clone().add(b).multiplyScalar(0.5);
}

/** 世界点 → 相对某格地板的（高度 h，沿流向 along），两者都以该格的 base 帧为准 */
function localOf(
    transforms: Matrix4[][],
    index: number,
    p: Vector3
): { h: number; along: number } {
    const up = new Vector3()
        .setFromMatrixColumn(transforms[index][0], 2)
        .normalize();
    const flow = new Vector3()
        .setFromMatrixColumn(transforms[index][0], 1)
        .normalize();
    const d = p.clone().sub(cellCenter(transforms, index));
    return { h: d.dot(up), along: d.dot(flow) };
}

describe("buildBuildings · 传送带条带与圆点", () => {
    it("有连接的格子出条带（含线尾格），真正孤立的格出圆点（A-1、v4 三态）", () => {
        nextIndex = 0;
        const buildings = [
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1), // 线尾：有入无出 → 条带 + 前端端帽
            beltBuilding(9, 10, -1), // 真正孤立：无入无出 → 圆点
        ];
        const result = build(buildings);
        try {
            const strips = stripMeshes(result);
            const dots = dotMeshes(result);
            const caps = capMeshes(result);
            expect(strips).toHaveLength(1);
            expect(strips[0].count).toBe(3);
            expect(dots).toHaveLength(1);
            expect(instanceCount(dots[0])).toBe(1);
            // 线头（#0，无前驱）+ 线尾（#2，无后继）各一个半圆帽
            expect(caps).toHaveLength(1);
            expect(instanceCount(caps[0])).toBe(2);
            // 每个非圆点带子格都挂货物（含线尾格 #2）
            expect(result.stats.cargoCount).toBe(3);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("段长恒为一格，相邻段首尾相接（A-2、A-3）", () => {
        nextIndex = 0;
        const buildings = [
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1),
        ];
        const result = build(buildings);
        try {
            const mesh = stripMeshes(result)[0];
            // v4：线尾格也是条带（+ 端帽），所以是 3 段而不是 2 段
            expect(mesh.count).toBe(3);
            for (let i = 0; i < mesh.count; i += 1) {
                const { up, down } = stripEnds(mesh, i);
                expect(up.distanceTo(down)).toBeCloseTo(BELT_LEN, 6);
            }
            for (let i = 0; i < 2; i += 1) {
                const first = stripEnds(mesh, i);
                const second = stripEnds(mesh, i + 1);
                // 段 i 下游端点 ≡ 段 i+1 上游端点；残差只是球面弦高（远小于 0.01）
                expect(first.down.distanceTo(second.up)).toBeLessThan(0.01);
            }
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("直段条带朝向 = 本格 → 输出格的格方向；转角格改走圆环（A-4）", () => {
        nextIndex = 0;
        const northward = beltBuilding(10, 10, 1);
        // 转角格的 yaw 是入 (+y) / 出 (+x) 方向的角平分线 = 45°
        const corner = beltBuilding(10, 11, 2, 45);
        // 转角后继续向东，保证转角段有输出
        const eastward = beltBuilding(11, 11, -1, 90);
        const result = build([northward, corner, eastward]);
        try {
            const mesh = stripMeshes(result)[0];
            // 直段 2 段；转角 #1 是圆环，不在条带 mesh 里
            expect(mesh.count).toBe(2);
            const sources = [northward, eastward];
            for (let i = 0; i < mesh.count; i += 1) {
                const source = sources[i];
                // 线尾格没有后继，拿不到「本格 → 输出格」的方向，跳过
                if (source.outputObjIdx < 0) continue;
                const target = result.transforms[source.outputObjIdx][0];
                const dir = new Vector3()
                    .setFromMatrixPosition(target)
                    .sub(cellCenter(result.transforms, source.index))
                    .normalize();
                const ends = stripEnds(mesh, i);
                const axis = ends.down.clone().sub(ends.up).normalize();
                // 与格方向同向（±1），且另一轴向投影 ≈ 0 → 不会出现斜条
                expect(Math.abs(axis.dot(dir))).toBeCloseTo(1, 2);
                expect(Math.abs(axis.dot(dir))).toBeLessThanOrEqual(1.0001);
            }

            // 转角：圆环姿态仍以本格中心为原点，本地 -z = 入/出方向的角平分线
            const elbows = elbowMeshes(result);
            expect(elbows).toHaveLength(1);
            expect(instanceCount(elbows[0])).toBe(1);
            const m = new Matrix4();
            elbows[0].getMatrixAt(0, m);
            // 姿态原点 = 本格中心沿法线抬 BELT_LIFT + BELT_ELBOW_LIFT（与条带同一基准面）
            expect(
                new Vector3()
                    .setFromMatrixPosition(m)
                    .distanceTo(cellCenter(result.transforms, corner.index))
            ).toBeCloseTo(BELT_LIFT + BELT_ELBOW_LIFT, 3);
            const axis = new Vector3(0, 0, -1).transformDirection(m);
            const dIn = new Vector3()
                .setFromMatrixPosition(result.transforms[corner.index][0])
                .sub(cellCenter(result.transforms, northward.index))
                .normalize();
            const dOut = new Vector3()
                .setFromMatrixPosition(result.transforms[eastward.index][0])
                .sub(cellCenter(result.transforms, corner.index))
                .normalize();
            // 角平分线：与入向、出向各成 45°
            expect(Math.abs(axis.dot(dIn))).toBeCloseTo(Math.SQRT1_2, 2);
            expect(Math.abs(axis.dot(dOut))).toBeCloseTo(Math.SQRT1_2, 2);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("全部孤立段 / 没有带子时 belts 为 null（R-5）", () => {
        nextIndex = 0;
        const isolated = build([
            beltBuilding(10, 10, -1),
            beltBuilding(10, 11, -1),
        ]);
        try {
            expect(isolated.buildings.belts).toBeNull();
            expect(stripMeshes(isolated)).toHaveLength(0);
            expect(dotMeshes(isolated)).toHaveLength(1);
            expect(isolated.stats.cargoCount).toBe(0);
        } finally {
            isolated.buildings.dispose();
            isolated.iconTexture.dispose();
        }

        // 同一个 `build` 内建筑 index 必须从 0 起（`buildBuildings` 用 b.index 索引 transforms）
        nextIndex = 0;
        const noBelts = build([
            inserterBuilding({ x: 10, y: 10 }, { x: 10, y: 11 }),
        ]);
        try {
            expect(noBelts.buildings.belts).toBeNull();
        } finally {
            noBelts.buildings.dispose();
            noBelts.iconTexture.dispose();
        }
    });
    it("带子的 modelRef 是无 scale 的 base 矩阵（R-2）", () => {
        nextIndex = 0;
        const buildings = [beltBuilding(10, 10, 1), beltBuilding(10, 11, -1)];
        const result = build(buildings);
        try {
            for (const b of buildings) {
                const ref = result.buildings.modelRef[b.index];
                expect(ref).toBeDefined();
                if (ref === undefined || !("matrix" in ref)) {
                    throw new Error(`modelRef[${b.index}] 不是 matrix 引用`);
                }
                expect(ref.matrix.elements).toEqual(
                    result.transforms[b.index][0].elements
                );
                // 无 scale：三列长度都为 1
                for (let c = 0; c < 3; c += 1) {
                    expect(
                        new Vector3()
                            .setFromMatrixColumn(ref.matrix, c)
                            .length()
                    ).toBeCloseTo(1, 6);
                }
            }
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});

describe("buildBuildings · 货物几何与垂直预算", () => {
    it("货物是 0.3³ 正方体，传送带与分拣器共用同一几何（C-1、C-2）", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, -1),
            inserterBuilding({ x: 12, y: 10 }, { x: 12, y: 11 }),
        ]);
        try {
            const geometry = result.buildings.cargos
                .geometry as unknown as BoxGeometry;
            expect(geometry.parameters.width).toBeCloseTo(CARGO_SIZE, 6);
            expect(geometry.parameters.height).toBeCloseTo(CARGO_SIZE, 6);
            expect(geometry.parameters.depth).toBeCloseTo(CARGO_SIZE, 6);
            // 两类货物共用一个 Cargos 实例 → 尺寸必然一致
            const cargoM = new Matrix4();
            for (let i = 0; i < result.stats.cargoCount; i += 1) {
                result.buildings.cargos.getMatrixAt(i, cargoM);
                const scale = new Vector3();
                cargoM.decompose(new Vector3(), new Quaternion(), scale);
                expect(scale.x).toBeCloseTo(1, 6);
                expect(scale.y).toBeCloseTo(1, 6);
                expect(scale.z).toBeCloseTo(1, 6);
            }
            // 2 个带子格（线尾格也挂货物）+ 1 个分拣器 = 3 件货物
            expect(result.stats.cargoCount).toBe(3);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("传送带货物底面高于条带顶面约 0.02，条带底面不穿球面（D-3、D-4）", () => {
        nextIndex = 0;
        const buildings = [beltBuilding(10, 10, 1), beltBuilding(10, 11, -1)];
        const result = build(buildings);
        try {
            const mesh = stripMeshes(result)[0];
            const cargos = result.buildings.cargos;
            // v4：线尾格也是条带（+ 端帽），所以是 2 段
            expect(mesh.count).toBe(2);

            const beltM = new Matrix4();
            mesh.getMatrixAt(0, beltM);
            const cargoM = new Matrix4();
            cargos.getMatrixAt(0, cargoM);

            const beltBottom = new Vector3(0, -BELT_HEIGHT / 2, 0).applyMatrix4(
                beltM
            );
            const beltTop = new Vector3(0, BELT_HEIGHT / 2, 0).applyMatrix4(
                beltM
            );
            const cargoBottom = new Vector3(0, -CARGO_SIZE / 2, 0).applyMatrix4(
                cargoM
            );
            const cargoTop = new Vector3(0, CARGO_SIZE / 2, 0).applyMatrix4(
                cargoM
            );

            // 世界原点即球心：条带底面不得低于球面
            expect(beltBottom.length()).toBeGreaterThanOrEqual(
                PLANET_RADIUS - 1e-3
            );
            expect(BELT_LIFT).toBeCloseTo(BELT_HEIGHT / 2, 6);
            expect(beltTop.length() - beltBottom.length()).toBeCloseTo(
                BELT_HEIGHT,
                3
            );
            // 货物整体在条带上方，间隙 ≈ 0.02（残差来自球面弦高）
            expect(cargoBottom.length()).toBeGreaterThan(beltTop.length());
            expect(cargoBottom.length() - beltTop.length()).toBeCloseTo(
                0.02,
                2
            );
            expect(cargoTop.length()).toBeCloseTo(
                PLANET_RADIUS + CARGO_LIFT + CARGO_SIZE / 2,
                2
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

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

            const beamBottom = new Vector3(0, -0.03, 0).applyMatrix4(beamM);
            const cargoTop = new Vector3(0, CARGO_SIZE / 2, 0).applyMatrix4(
                cargoM
            );
            // 方案 §6.4 垂直预算：横梁 [0.37, 0.43]、货物 [0.05, 0.35]
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

    it("条带取元数据色、货物取 CARGO_COLOR，明度差 ≥ 0.2（E-1、E-2、E-3）", () => {
        nextIndex = 0;
        const buildings = [
            beltBuilding(10, 10, 1, 0, 2001, 35),
            beltBuilding(10, 11, 2, 0, 2002, 36),
            beltBuilding(10, 12, 3, 0, 2003, 37),
            beltBuilding(10, 13, -1),
        ];
        const result = build(buildings);
        try {
            const mesh = stripMeshes(result)[0];
            // v4：4 格都是条带（末格 = 线尾 + 端帽）
            expect(mesh.count).toBe(4);
            const lightness = (c: Color) =>
                (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2;
            const cargoL = lightness(CARGO_COLOR);
            const beltColor = new Color();
            for (let i = 0; i < mesh.count; i += 1) {
                mesh.getColorAt(i, beltColor);
                // 三种带子色（橙 / 青 / 蓝）与货物色的明度差均 ≥ 0.2
                expect(
                    Math.abs(cargoL - lightness(beltColor))
                ).toBeGreaterThanOrEqual(0.2);
            }
            const cargoColor = new Color();
            result.buildings.cargos.getColorAt(0, cargoColor);
            expect(cargoColor.getHexString()).toBe("f5e6c8");
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});

describe("buildBuildings · 转角与坡度", () => {
    it("转角格：圆环走同一条弧，两端落在相邻两格共享边的中点（A-4、A-6）", () => {
        nextIndex = 0;
        const north = beltBuilding(10, 10, 1, 0);
        // 转角格的 yaw 是入 (+y) / 出 (+x) 方向的角平分线 = 45°
        const corner = beltBuilding(10, 11, 2, 45);
        const east = beltBuilding(11, 11, -1, 90);
        const result = build([north, corner, east]);
        try {
            // 直段 2 段（条带）+ 1 个圆环
            const mesh = stripMeshes(result)[0];
            expect(mesh.count).toBe(2);
            const elbows = elbowMeshes(result);
            expect(elbows).toHaveLength(1);
            expect(instanceCount(elbows[0])).toBe(1);
            const ring = elbows[0];

            // 圆环仍是「圆心 = 共享角点、半径 = 半格长、扫角 ±90°」那条唯一的弧
            const arc = shapeAt(ring, 0);
            expect(Math.abs(arc.theta1 - arc.theta0)).toBeCloseTo(
                Math.PI / 2,
                6
            );

            const entry = sharedEdgeMid(
                cellCenter(result.transforms, north.index),
                cellCenter(result.transforms, corner.index)
            );
            const exit = sharedEdgeMid(
                cellCenter(result.transforms, corner.index),
                cellCenter(result.transforms, east.index)
            );
            // 端点必须落在共享边中点的**正上方**（竖直方向只差预期抬升，水平方向误差≈0）。
            // 竖直抬升 = BELT_LIFT + BELT_ELBOW_LIFT，与 `BELT_HEIGHT` 无关地成立；
            // 只比 3D 距离的话，厚带子时抬升会把「圆心取错」的误差盖住。
            const up = entry.clone().normalize();
            const horizErr = (p: Vector3, ref: Vector3) => {
                const d = p.clone().sub(ref);
                return d.sub(up.clone().multiplyScalar(d.dot(up))).length();
            };
            const verticalErr = (p: Vector3, ref: Vector3) =>
                Math.abs(p.clone().sub(ref).dot(up));
            // 圆心取错会偏出 0.24 以上
            expect(horizErr(arcPoint(ring, 0, 1), entry)).toBeLessThan(0.06);
            expect(horizErr(arcPoint(ring, 0, 0), exit)).toBeLessThan(0.06);
            expect(verticalErr(arcPoint(ring, 0, 1), entry)).toBeCloseTo(
                BELT_LIFT + BELT_ELBOW_LIFT,
                1
            );

            // 出口切线 = 本格 → 输出格的格方向（支线贴边与货物转向都靠它）
            const m = new Matrix4();
            ring.getMatrixAt(0, m);
            const tangent = new Vector3(
                arc.exitX,
                0,
                arc.exitZ
            ).transformDirection(m);
            const dir = new Vector3()
                .setFromMatrixPosition(result.transforms[east.index][0])
                .sub(cellCenter(result.transforms, corner.index))
                .normalize();
            expect(tangent.dot(dir)).toBeCloseTo(1, 2);

            // 两端都邻接直段 → 两端都伸出，把接缝埋进环里（属性是 Float32，precision 取 6）
            const stub = endsAt(ring, 0);
            expect(stub.back).toBeCloseTo(BELT_ELBOW_STUB, 6);
            expect(stub.front).toBeCloseTo(BELT_ELBOW_STUB, 6);
            // 圆的弧长 R·π/2 = 0.785L，加上两端 stub 正好 = 1 格 → 箭头间距与直段一致
            expect(BELT_ARC_LENGTH + 2 * BELT_ELBOW_STUB).toBeCloseTo(
                BELT_LEN,
                9
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("小环形（4 格全是转角）没有条带，只有圆环；两端 stub 归零避免互相穿插", () => {
        nextIndex = 0;
        // (0,0)→(1,0)→(1,1)→(0,1)→(0,0) 的四方环：每格都是 1 入 1 出且互相垂直
        const ring4 = [
            beltBuilding(0, 0, 1, 45),
            beltBuilding(1, 0, 2, 315),
            beltBuilding(1, 1, 3, 225),
            beltBuilding(0, 1, 0, 135),
        ];
        const result = build(ring4);
        try {
            expect(stripMeshes(result)).toHaveLength(0);
            const elbows = elbowMeshes(result);
            expect(elbows).toHaveLength(1);
            expect(instanceCount(elbows[0])).toBe(4);
            for (let i = 0; i < 4; i += 1) {
                const stub = endsAt(elbows[0], i);
                expect(stub.back).toBe(0);
                expect(stub.front).toBe(0);
                const arc = shapeAt(elbows[0], i);
                expect(Math.abs(arc.theta1 - arc.theta0)).toBeCloseTo(
                    Math.PI / 2,
                    6
                );
            }
            // 没有条带时 belts 也要非空，否则帧循环写不到 cargoMove（箭头不动）
            expect(result.buildings.belts).not.toBeNull();
            expect(result.buildings.belts?.cargoMove).toBe(0);
            result.buildings.belts!.cargoMove = 0.42;
            expect(elbows[0].material.cargoMoveUniform.value).toBe(0.42);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("坡度 = Δz × HEIGHT_GRID_SIZE，亚台阶噪声归零（F8、S12）", () => {
        nextIndex = 0;
        const flat = beltBuilding(10, 10, 1, 0, 2001, 35, 0);
        const up = beltBuilding(10, 11, 2, 0, 2001, 35, 0.5);
        const noise = beltBuilding(10, 12, -1, 0, 2001, 35, 0.52);
        const result = build([flat, up, noise]);
        try {
            const mesh = stripMeshes(result)[0];
            expect(mesh.count).toBe(3);
            expect(shapeAt(mesh, 0).theta1 - shapeAt(mesh, 0).theta0).toBe(0);
            expect(shapeAt(mesh, 0).slope).toBeCloseTo(
                0.5 * HEIGHT_GRID_SIZE,
                6
            );
            // 0.02 格 = 0.027 世界单位 < BELT_SLOPE_EPS → 视为平地
            expect(shapeAt(mesh, 1).slope).toBe(0);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});

describe("buildBuildings · 资源释放", () => {
    it("dispose 释放条带/圆点/分拣器几何，且可重复调用（R-4）", () => {
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
        // 条带（BoxGeometry）与圆点（CylinderGeometry）都必须被释放
        expect(disposed).toContain("CylinderGeometry");
        expect(disposed.length).toBeGreaterThanOrEqual(3);
        expect(() => result.buildings.dispose()).not.toThrow();
        result.iconTexture.dispose();
    });
});

describe("BeltMaterial · 箭头着色器注入结构", () => {
    /** 注入前后的 shader 源码；注入点来自 `ShaderLib.lambert` 的两段源码 */
    function injected() {
        const mesh = new Belts(1);
        const params = {
            uniforms: {} as Record<string, { value: unknown }>,
            vertexShader: ShaderLib.lambert.vertexShader,
            fragmentShader: ShaderLib.lambert.fragmentShader,
        } as unknown as WebGLProgramParametersWithUniforms;
        mesh.material.onBeforeCompile(params);
        return {
            mesh,
            params,
            vs: params.vertexShader,
            fs: params.fragmentShader,
        };
    }

    it("顶点阶段从 position / normal 取坐标，不引用 uv（G-1）", () => {
        const { vs } = injected();
        // BELT_LEN 已烘进几何 → 相位必须除以段长（§3.6 / GL10）
        expect(vs).toContain("vBeltPhase = position.z /");
        expect(vs).toContain("+ 0.5;");
        expect(vs).toContain("vBeltX = position.x;");
        expect(vs).toContain("vBeltNY = normal.y;");
        expect(vs).toContain("attribute vec4 aBeltArc;");
        expect(vs).toContain("attribute vec4 aBeltAux;");
        expect(vs).toContain("transformed.y -= (position.z /");
        // v4：判据从 "bend" 变成 CPU 给的扫角，直段 sweep = 0 不进分支（GL11）
        expect(vs).toContain("if (abs(sweep) >");
        expect(vs).toContain("aBeltArc.z + r * cos(th)");
        expect(vs).not.toContain("vUv");
    });

    it("片元阶段声明 uniform / varying，并有顶面 mask（G-2）", () => {
        const { fs } = injected();
        expect(fs).toContain("uniform float cargoMove;");
        expect(fs).toContain("uniform vec3 uArrowColor;");
        expect(fs).toContain("varying float vBeltPhase;");
        expect(fs).toContain("varying float vBeltX;");
        expect(fs).toContain("varying float vBeltNY;");
        expect(fs).toContain("step(0.9, vBeltNY)");
    });

    it("相位公式为 fract(phase + cargoMove)，周期取自段长（G-3、G-4）", () => {
        const { fs, mesh } = injected();
        // 符号必须是 +：货物着色器是 transformed.z -= cargoMove * d
        expect(fs).toContain("fract(vBeltPhase + cargoMove)");
        expect(fs).not.toContain("fract(vBeltPhase - cargoMove)");
        // 几何本身长度 = 段长（实例矩阵不再缩放），每格一个周期
        const geometry = mesh.geometry;
        expect(geometry.parameters.depth).toBeCloseTo(BELT_LEN, 6);
        expect(geometry.parameters.width).toBeCloseTo(BELT_WIDTH, 6);
        expect(geometry.parameters.height).toBeCloseTo(BELT_HEIGHT, 6);
    });

    it("customProgramCacheKey 与 CargoMaterial 不同（G-5）", () => {
        const belts = new Belts(1);
        const cargos = new Cargos(1);
        expect(belts.material.customProgramCacheKey()).toBe(
            "dsp-belt-arrow-v4"
        );
        expect(belts.material.customProgramCacheKey()).not.toBe(
            cargos.material.customProgramCacheKey()
        );
    });

    it("uniform 与 accessor 指向同一对象（每帧只写一个 float）", () => {
        const { mesh, params } = injected();
        expect(params.uniforms.cargoMove).toBe(mesh.material.cargoMoveUniform);
        expect(params.uniforms.uArrowColor).toBe(
            mesh.material.arrowColorUniform
        );
        mesh.cargoMove = 0.37;
        expect(mesh.material.cargoMoveUniform.value).toBe(0.37);
    });
});

describe("fixture 回归 · starting_base_01029", () => {
    it("条带实例数 = 有连接的带子数（含线尾格），圆点实例数 = 真孤立带子数", () => {
        // fixture 里的非带子建筑会触发 GLB 懒加载；node 环境没有 XHR，加载必然失败并 warn。
        // 这里屏蔽该噪音（只影响本用例，不影响断言）。
        const warn = jest
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const data = fromStr(
            readFileSync(
                __dirname + "/../blueprint/fixtures/starting_base_01029.txt",
                "utf8"
            )
        );
        const pos = findPosForAreas(data.areas, PLANET_SEGMENT);
        const transforms = data.buildings.map((b) =>
            calcBuildingTrans(PLANET_RADIUS, pos, b)
        );
        const built = buildBuildings(transforms, data.buildings, {
            settings: SETTINGS,
            textureSink: makeSink(),
            reapplyMaterials: false,
        });
        try {
            const beltsInData = data.buildings.filter((b) => isBelt(b.itemId));
            const withOutput = beltsInData.filter((b) => b.outputObjIdx >= 0);
            // 线尾格（有入无出）：v4 里是条带 + 端帽，不再算孤立方点
            const fedByBelt = new Set(
                data.buildings
                    .filter((b) => isBelt(b.itemId) && b.outputObjIdx >= 0)
                    .map((b) => b.outputObjIdx)
            );
            const strips = beltsInData.filter(
                (b) => b.outputObjIdx >= 0 || fedByBelt.has(b.index)
            );
            const isolated = beltsInData.filter(
                (b) => b.outputObjIdx < 0 && !fedByBelt.has(b.index)
            );
            expect(withOutput.length).toBeGreaterThan(0);
            expect(strips.length + isolated.length).toBe(beltsInData.length);
            expect(strips.length).toBeGreaterThanOrEqual(withOutput.length);

            expect(built.buildings.belts).not.toBeNull();
            // v5：转角格走独立的圆环 mesh，条带 mesh 只装直段格
            const elbows = elbowMeshes(built);
            const elbowCount = elbows.length ? instanceCount(elbows[0]) : 0;
            expect(elbowCount).toBeGreaterThan(0);
            expect((built.buildings.belts?.count ?? 0) + elbowCount).toBe(
                strips.length
            );
            // 货物口径：每个条带 / 圆环格一件（含线尾格）+ 每个分拣器一件
            const inserterCount = data.buildings.filter((b) =>
                isInserter(b.itemId)
            ).length;
            expect(built.stats.cargoCount).toBe(strips.length + inserterCount);

            const dots = dotMeshes(built);
            if (isolated.length === 0) expect(dots).toHaveLength(0);
            else {
                expect(dots).toHaveLength(1);
                expect(instanceCount(dots[0])).toBe(isolated.length);
            }
            // 线头 / 线尾都要有半圆帽
            const caps = capMeshes(built);
            expect(caps).toHaveLength(1);
            expect(instanceCount(caps[0])).toBeGreaterThan(0);
        } finally {
            built.buildings.dispose();
            built.iconTexture.dispose();
            warn.mockRestore();
        }
    });
});

describe("buildBuildings · 端帽内收与货物端点淡出", () => {
    it("端帽压进条带：条带端面内收，半圆尖点在格边界内侧（不再向格外鼓出）", () => {
        nextIndex = 0;
        const buildings = [
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1), // 线尾
        ];
        const result = build(buildings);
        try {
            const mesh = stripMeshes(result)[0];
            // 中间格两端都接邻格 → 不内收
            expect(endsAt(mesh, 1)).toEqual({ back: 0, front: 0 });
            // 线尾格的前端内收，后端不动
            const tail = endsAt(mesh, 2);
            expect(tail.front).toBeCloseTo(-BELT_CAP_SHORTEN, 5);
            expect(tail.back).toBe(0);

            // 几何关系自洽：尖点 = 格边界 − 内收量；条带端面 = 直径面 + 重叠
            expect(BELT_CAP_DIAMETER + BELT_CAP_RADIUS).toBeCloseTo(
                BELT_LEN / 2 - BELT_CAP_TIP_INSET,
                9
            );
            expect(BELT_LEN / 2 - BELT_CAP_SHORTEN).toBeCloseTo(
                BELT_CAP_DIAMETER + BELT_CAP_OVERLAP,
                9
            );
            // 关键：端帽整体不再超出格子（旧实现是 L/2 + R）
            expect(BELT_CAP_DIAMETER + BELT_CAP_RADIUS).toBeLessThanOrEqual(
                BELT_LEN / 2 + 1e-12
            );

            // 端帽实例：距各自格心 = (直径面, 抬升) 的斜边；两个帽（线头 #0 + 线尾 #2）
            const caps = capMeshes(result);
            expect(caps).toHaveLength(1);
            expect(instanceCount(caps[0])).toBe(2);
            const expected = Math.hypot(
                BELT_CAP_DIAMETER,
                BELT_LIFT + BELT_CAP_LIFT
            );
            const m = new Matrix4();
            const p = new Vector3();
            const centers = buildings.map((b) =>
                cellCenter(result.transforms, b.index)
            );
            for (let i = 0; i < instanceCount(caps[0]); i++) {
                caps[0].getMatrixAt(i, m);
                p.setFromMatrixPosition(m);
                const nearest = Math.min(
                    ...centers.map((c) => p.distanceTo(c))
                );
                expect(nearest).toBeCloseTo(expected, 2);
            }
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("数据 yaw 与连线不符时，端面仍落在共享边中点（v7 连接修复）", () => {
        nextIndex = 0;
        // L 形：A(0,0) → B(1,0) → C(1,1)，但三格的 yaw 全部写错（0/0/180）
        // 正确值应是 A=90(+x)、B=45(角平分线)、C=0(+y)
        const a = beltBuilding(0, 0, 1, 0);
        const b = beltBuilding(1, 0, 2, 0);
        const c = beltBuilding(1, 1, -1, 180);
        const result = build([a, b, c]);
        try {
            const strips = stripMeshes(result)[0];
            const elbows = elbowMeshes(result);
            expect(instanceCount(elbows[0])).toBe(1);
            const ring = elbows[0];

            const ab = sharedEdgeMid(
                cellCenter(result.transforms, a.index),
                cellCenter(result.transforms, b.index)
            );
            const bc = sharedEdgeMid(
                cellCenter(result.transforms, b.index),
                cellCenter(result.transforms, c.index)
            );
            // 竖直方向只有预期抬升（BELT_LIFT / BELT_LIFT+ELBOW_LIFT），水平误差应为 0
            const flat = (p: Vector3, ref: Vector3) => {
                const up = ref.clone().normalize();
                const d = p.clone().sub(ref);
                return d.sub(up.clone().multiplyScalar(d.dot(up))).length();
            };
            // A 的前端面中心（条带实例的 local -z 端）
            expect(flat(stripEnds(strips, 0).down, ab)).toBeLessThan(0.02);
            // 圆环的入端 / 出端
            expect(flat(arcPoint(ring, 0, 1), ab)).toBeLessThan(0.06);
            expect(flat(arcPoint(ring, 0, 0), bc)).toBeLessThan(0.06);
            // C 的后端面中心（条带实例的 local +z 端）
            expect(flat(stripEnds(strips, 1).up, bc)).toBeLessThan(0.02);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("转角的圆环与货物必须用**同一份**弧参数（cornerPhi 补偿不能只给圆环）", () => {
        nextIndex = 0;
        // yaw 全写错（0/0/180）→ 转角帧要绕法线转 phi ≠ 0，补偿必须同时作用在圆环和货物上
        const buildings = [
            beltBuilding(0, 0, 1, 0),
            beltBuilding(1, 0, 2, 0),
            beltBuilding(1, 1, -1, 180),
        ];
        const result = build(buildings);
        try {
            const ring = elbowMeshes(result)[0];
            expect(instanceCount(ring)).toBe(1);
            const ringArc = ring.geometry.beltArc.array as Float32Array;

            // 直段 2 格（#0 / #2）先入 cargo，转角那一格排第 3 件
            const cargoIdx = 2;
            const cargoArc = result.buildings.cargos.geometry.cargoArc
                .array as Float32Array;
            for (let k = 0; k < 4; k++) {
                expect(cargoArc[cargoIdx * 4 + k]).toBeCloseTo(
                    ringArc[k],
                    6
                );
            }

            // 同样的弧参数也来自 CPU（`beltArc`），只是叠了 phi 补偿：
            // 断言两者差 ≤ 一格的量级，防止以后又有人把补偿整段丢掉
            const raw = computeBeltShapes(buildings).shapes.get(1)!;
            expect(Math.abs(ringArc[0] - raw.theta0)).toBeLessThan(0.1);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("货物端点淡出：条带写 CARGO_FADE，分拣器为 0（整块出现/消失）", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1),
            inserterBuilding({ x: 12, y: 10 }, { x: 12, y: 11 }),
        ]);
        try {
            // 3 个带子格（含线尾 #2）+ 1 个分拣器
            expect(result.stats.cargoCount).toBe(4);
            const fades = result.buildings.cargos.geometry.cargoFade
                .array as Float32Array;
            expect(fades[0]).toBeCloseTo(CARGO_FADE, 6);
            expect(fades[1]).toBeCloseTo(CARGO_FADE, 6);
            expect(fades[2]).toBeCloseTo(CARGO_FADE, 6);
            expect(fades[3]).toBe(0);
            // 淡出窗口必须 < 半个周期，否则整段都在缩
            expect(CARGO_FADE).toBeGreaterThan(0);
            expect(CARGO_FADE).toBeLessThan(0.5);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("线尾格也生成货物，行程收到端帽尖点（m = 1 时刚好缩没在尖点上）", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1), // 线尾：前端是端帽
        ]);
        try {
            expect(result.stats.cargoCount).toBe(3);
            const dist = result.buildings.cargos.geometry.cargoDistance
                .array as Float32Array;
            expect(dist[0]).toBeCloseTo(BELT_LEN, 6);
            expect(dist[1]).toBeCloseTo(BELT_LEN, 6);
            // 线尾格少走 `BELT_CAP_TIP_INSET`：货物中心终点 = 端帽尖点
            expect(dist[2]).toBeCloseTo(BELT_LEN - BELT_CAP_TIP_INSET, 6);
            expect(BELT_LEN / 2 - dist[2]).toBeCloseTo(
                -(BELT_CAP_DIAMETER + BELT_CAP_RADIUS),
                6
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

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

describe("传送带 · 垂直段（riser）", () => {
    /**
     * 实测 `data/三种坡度上升的高度1.txt` 的 y=2 行：
     * `#0(4,2,0) → #1(3.002,2,0) → #2(3,2,1) → #3(2,2,1)`，流向 -x。
     */
    function buildRiserChain() {
        nextIndex = 0;
        return build([
            beltBuilding(11, 10, 1, 270), // #0 水平来料
            beltBuilding(10.002, 10, 2, 270), // #1 上升格（同格，中心偏 1.58e-3）
            beltBuilding(10, 10, 3, 270, 2001, 35, 1), // #2 上层水平（z = 1）
            beltBuilding(9, 10, -1, 270, 2001, 35, 1), // #3 上层线尾
        ]);
    }

    it("渲染成刚性竖条：两端面落在上下层条带的中面上，板站在两格公共边上", () => {
        const result = buildRiserChain();
        try {
            const mesh = stripMeshes(result)[0];
            // 3 个直段 + 1 个垂直段共用同一个 Belts mesh
            expect(instanceCount(mesh)).toBe(4);
            const riserIndex = 1; // strips 顺序 = 建筑顺序

            const m = new Matrix4();
            mesh.getMatrixAt(riserIndex, m);
            const up = new Vector3()
                .setFromMatrixColumn(result.transforms[1][0], 2)
                .normalize();
            // 局部 +z 朝下（局部 -z = 行进方向 = 上），即整根刚性竖起来、没有斜坡剪切
            const zAxis = new Vector3().setFromMatrixColumn(m, 2).normalize();
            expect(zAxis.dot(up)).toBeCloseTo(-1, 6);

            // 板心 = 半格高（BELT_LIFT + rise/2），X/Y 落在**本格格心**（along = 0）
            const centre = new Vector3().setFromMatrixPosition(m);
            const c = localOf(result.transforms, 1, centre);
            expect(c.h).toBeCloseTo(BELT_LIFT + HEIGHT_GRID_SIZE / 2, 4);
            expect(c.along).toBeCloseTo(0, 3);

            // 端面：后缘（局部 +z）= 本层中面；前缘（局部 -z）= 上层中面
            const ends = stripEnds(mesh, riserIndex);
            const back = localOf(result.transforms, 1, ends.up);
            const front = localOf(result.transforms, 1, ends.down);
            expect(back.h).toBeCloseTo(BELT_RISER_BASE, 4);
            expect(front.h).toBeCloseTo(BELT_RISER_BASE + HEIGHT_GRID_SIZE, 4);
            // 两端水平位置相同：板是竖直的，没有沿流向倾倒
            expect(back.along).toBeCloseTo(front.along, 6);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("货物贴在板外侧、行程 = |rise|（从下端滑到上端）", () => {
        const result = buildRiserChain();
        try {
            const dist = result.buildings.cargos.geometry.cargoDistance
                .array as Float32Array;
            // cargo 下标 = strips 顺序；#1 是垂直段
            expect(dist[1]).toBeCloseTo(HEIGHT_GRID_SIZE, 6);

            const m = new Matrix4();
            result.buildings.cargos.getMatrixAt(1, m);
            const p = new Vector3().setFromMatrixPosition(m);
            const loc = localOf(result.transforms, 1, p);
            // 起点 = 板的下端面；横向离开**格心处的板中面**「板半厚 + 货物半边长 + 间隙」
            expect(loc.h).toBeCloseTo(BELT_RISER_BASE, 4);
            expect(Math.abs(loc.along)).toBeCloseTo(RISER_CARGO_SIDE, 3);
            expect(RISER_CARGO_SIDE).toBeCloseTo(
                BELT_HEIGHT / 2 + CARGO_SIZE / 2 + 0.02,
                9
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("来料格用 extend 把条带接到板近面，货物也一路滑到贴着板面", () => {
        const result = buildRiserChain();
        try {
            const mesh = stripMeshes(result)[0];
            // 0 号实例 = 来料格 #0（条带顺序 = 建筑顺序）
            const s = shapeAt(mesh, 0);
            // 缺口 ≈ 半格 − 板半厚 = 0.629 − 0.04
            expect(s.extend).toBeCloseTo(0.589, 2);
            // 出口切线 = 本格流向（帧的局部 −z）
            expect(s.exitX).toBe(0);
            expect(s.exitZ).toBe(-1);

            // 复刻着色器：只推前缘顶点，沿出口切线
            const m = new Matrix4();
            mesh.getMatrixAt(0, m);
            const front = new Vector3(
                s.extend * s.exitX,
                0,
                -BELT_LEN / 2 + s.extend * s.exitZ
            ).applyMatrix4(m);
            // 前缘落在板近面：沿流向距板格中心 = 板半厚（取负号 = 来料侧）
            expect(localOf(result.transforms, 1, front).along).toBeCloseTo(
                -BELT_HEIGHT / 2,
                2
            );

            // 货物：终点（cargoMove = 1）的**鼻尖**贴着板面 = 板半厚 + 半个货
            const dist = result.buildings.cargos.geometry.cargoDistance
                .array as Float32Array;
            expect(dist[0]).toBeGreaterThan(BELT_LEN);
            const cm = new Matrix4();
            result.buildings.cargos.getMatrixAt(0, cm);
            const end = new Vector3(0, 0, -dist[0]).applyMatrix4(cm);
            expect(localOf(result.transforms, 1, end).along).toBeCloseTo(
                -(BELT_HEIGHT / 2 + CARGO_SIZE / 2),
                2
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("垂直段不加端帽（两端被上下层条带盖住），端面也不内收", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1, 0), // #0 线头就是垂直段：capBack = true
            beltBuilding(10, 10, -1, 0, 2001, 35, 1), // #1 上层线尾：capFront = true
        ]);
        try {
            const mesh = stripMeshes(result)[0];
            expect(instanceCount(mesh)).toBe(2);
            expect(endsAt(mesh, 0)).toEqual({ back: 0, front: 0 });
            // 只有上层那一格（真·线尾）出端帽，垂直段本身不出
            const caps = capMeshes(result);
            expect(caps).toHaveLength(1);
            expect(instanceCount(caps[0])).toBe(1);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});

describe("传送带 · 非一格后继（两点连线兜底）", () => {
    it("弦长与一格同量级时按世界弦连线：长度 = 弦长、前端面落在两格中点", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1, 90), // #0 → #1 偏了 1.1 格（异尺度数据）
            beltBuilding(11.1, 10, -1, 90),
        ]);
        try {
            const mesh = stripMeshes(result)[0];
            expect(instanceCount(mesh)).toBe(2);
            const ends = stripEnds(mesh, 0);
            // 长度 = 世界弦长（1.1 格），不再是固定的一格
            expect(ends.down.distanceTo(ends.up)).toBeCloseTo(
                1.1 * BELT_LEN,
                2
            );
            // 前端（局部 -z = 流向）正好落在两格中点
            const mid = sharedEdgeMid(
                cellCenter(result.transforms, 0),
                cellCenter(result.transforms, 1)
            );
            const up = new Vector3()
                .setFromMatrixColumn(result.transforms[0][0], 2)
                .normalize();
            const d = ends.down.clone().sub(mid);
            const flatErr = d.sub(up.clone().multiplyScalar(d.dot(up))).length();
            expect(flatErr).toBeLessThan(0.02);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("太短的侧口（0.2 格）不缩成短桩：保持满格条带 + 网格帧朝向", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1, 0), // 侧口：目标只偏 0.2 格
            beltBuilding(10.2, 10, -1, 0),
        ]);
        try {
            const mesh = stripMeshes(result)[0];
            const ends = stripEnds(mesh, 0);
            // 条带仍占满自己那一格（侧口是真实接头，缩短会在接头上挖出缝）
            expect(ends.down.distanceTo(ends.up)).toBeCloseTo(BELT_LEN, 4);
            // 朝向仍由网格帧（数据 yaw = 0 → +y）决定，不会被 0.2 格的方向带偏
            const flow = ends.down.clone().sub(ends.up).normalize();
            const want = new Vector3()
                .setFromMatrixColumn(result.transforms[0][0], 1)
                .normalize();
            expect(flow.dot(want)).toBeCloseTo(1, 3);
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });

    it("非一格后继带高度差：按弦长缩放 + 按高度差剪切（坡度写进实例属性）", () => {
        nextIndex = 0;
        const result = build([
            beltBuilding(10, 10, 1, 90, 2001, 35, 0),
            beltBuilding(11.1, 10, -1, 90, 2001, 35, 0.5), // 高处半层
        ]);
        try {
            const mesh = stripMeshes(result)[0];
            // 坡度 = 世界高度差（0.5 层 × 4/3），写进 aBeltAux.x → 着色器剪切
            expect(shapeAt(mesh, 0).slope).toBeCloseTo(
                0.5 * HEIGHT_GRID_SIZE,
                4
            );
            // 实例抬升 = slope/2（后缘落在本格中面、前缘落在上一层中面）
            const m = new Matrix4();
            mesh.getMatrixAt(0, m);
            const c = localOf(
                result.transforms,
                0,
                new Vector3().setFromMatrixPosition(m)
            );
            expect(c.h).toBeCloseTo(
                BELT_LIFT + (0.5 * HEIGHT_GRID_SIZE) / 2,
                3
            );
        } finally {
            result.buildings.dispose();
            result.iconTexture.dispose();
        }
    });
});
