import { Color, Matrix4, Vector3 } from "three";
import { findPosForAreas, calcBuildingTrans } from "@/planet/planet";
import type { BlueprintArea, BlueprintBuilding } from "@/blueprint/parser";
import type { TextureSink } from "@/icon/iconTexture";
import { PLANET_RADIUS, PLANET_SEGMENT } from "@/planet/planetConstants";
import { buildBuildings } from "@/lib/core/buildBuildings";
import {
    CARGO_COLOR,
    CARGO_FADE,
    CARGO_PERIOD_MS,
    CARGO_SIZE,
    Cargos,
} from "@/Animation/cargos";
import { isBelt, isInserter } from "@/data/items";

/**
 * 货物动画集中在 `Cargos` 的回归。
 *
 * 覆盖：
 *   1. `addTrack` 自己把「起点/终点/带面法线」合成实例姿态（局部 -z 指向终点），
 *      颜色 / 淡出 / 抬升 / 圆弧的默认值也在这里；
 *   2. `finish()` 收口 count 与属性上传；容量不足 / 缺姿态直接报错；
 *   3. `tick()` 自持相位并返回，替代帧循环里各自算 `(time % 1000) / 1000`；
 *   4. `buildBuildings` 只提供轨迹数据：条带货物得到米白 / 0.06 淡出 / 0.22 抬升，
 *      分拣器得到 0.15 淡出且不额外抬升。
 *
 * 边界：Jest 无 WebGL，不验证 GLSL 能否编译与动画观感。
 */

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

/** 传送带：一条记录 = 1 格，`localOffset[0] === localOffset[1]` */
function beltBuilding(
    x: number,
    y: number,
    outputObjIdx: number,
    modelIndex = 35
): BlueprintBuilding {
    return makeBuilding({
        localOffset: [
            { x, y, z: 0 },
            { x, y, z: 0 },
        ],
        yaw: [0, 0],
        itemId: 2001,
        modelIndex,
        outputObjIdx,
    });
}

/** 分拣器：`localOffset[0]` 是起点、`localOffset[1]` 是尖端 */
function inserterBuilding(
    from: { x: number; y: number },
    to: { x: number; y: number }
): BlueprintBuilding {
    return makeBuilding({
        localOffset: [from, to] as BlueprintBuilding["localOffset"],
        yaw: [0, 0],
        itemId: 2011,
        modelIndex: 41,
    });
}

const SETTINGS = {
    showRealModels: false,
    texturesEnabled: false,
    maxInstancesPerModel: Infinity,
};

function build(buildings: BlueprintBuilding[]) {
    const pos = findPosForAreas([area()], PLANET_SEGMENT);
    const transforms = buildings.map((b) =>
        calcBuildingTrans(PLANET_RADIUS, pos, b)
    );
    return buildBuildings(transforms, buildings, {
        settings: SETTINGS,
        textureSink: makeSink(),
        reapplyMaterials: false,
    });
}

describe("Cargos.addTrack：轨迹 → 实例", () => {
    it("start/end/up 合成姿态，局部 -z 指向终点", () => {
        const cargos = new Cargos(1);
        try {
            const start = new Vector3(1, 2, 3);
            const end = new Vector3(4, 2, 3);
            const up = new Vector3(0, 1, 0);
            cargos.addTrack({ start, end, up, distance: 3 });

            const m = new Matrix4();
            cargos.getMatrixAt(0, m);
            // 平移 = 起点
            expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([
                1, 2, 3,
            ]);
            // 着色器沿局部 -z 前进，所以 -z 必须指向终点
            const forward = new Vector3(0, 0, -1)
                .transformDirection(m)
                .normalize();
            expect(forward.x).toBeCloseTo(1, 6);
            expect(forward.y).toBeCloseTo(0, 6);
            expect(forward.z).toBeCloseTo(0, 6);

            cargos.finish();
            expect(cargos.count).toBe(1);
            expect(cargos.cargoCount).toBe(1);
            expect(cargos.geometry.cargoDistance.array[0]).toBeCloseTo(3, 6);
        } finally {
            cargos.dispose();
            cargos.geometry.dispose();
        }
    });

    it("默认色 = CARGO_COLOR，两端淡出/抬升/圆弧默认 0；matrix 与 arc 可覆盖", () => {
        const cargos = new Cargos(2);
        try {
            cargos.addTrack({
                start: new Vector3(0, 0, 0),
                end: new Vector3(1, 0, 0),
                distance: 1,
            });
            const m = new Matrix4().makeRotationY(Math.PI / 2);
            cargos.addTrack({
                matrix: m,
                distance: 0.5,
                color: new Color(0xff0000),
                fadeIn: 0.2,
                fadeOut: 0.1,
                lift: 0.1,
                arc: {
                    theta0: 0.1,
                    theta1: 1.1,
                    centerX: 2,
                    centerZ: 3,
                    slope: 0.4,
                },
            });

            const color = new Color();
            cargos.getColorAt(0, color);
            expect(color.getHex()).toBe(CARGO_COLOR.getHex());
            cargos.getColorAt(1, color);
            expect(color.getHex()).toBe(0xff0000);

            // `aCargoFade` 是 vec2：(fadeIn, fadeOut)
            const fade = cargos.geometry.cargoFade.array as Float32Array;
            expect(fade[0]).toBe(0);
            expect(fade[1]).toBe(0);
            expect(fade[2]).toBeCloseTo(0.2, 6);
            expect(fade[3]).toBeCloseTo(0.1, 6);

            const lift = cargos.geometry.cargoLift.array as Float32Array;
            expect(lift[0]).toBe(0);
            expect(lift[1]).toBeCloseTo(0.1, 6);

            const arc = cargos.geometry.cargoArc.array as Float32Array;
            expect(arc[0]).toBe(0);
            expect(arc[4]).toBeCloseTo(0.1, 6);
            expect(arc[5]).toBeCloseTo(1.1, 6);
            const slope = cargos.geometry.cargoSlope.array as Float32Array;
            expect(slope[1]).toBeCloseTo(0.4, 6);

            // matrix 分支：姿态原样落盘（instanceMatrix 是 Float32，逐元素比对）
            const m2 = new Matrix4();
            cargos.getMatrixAt(1, m2);
            for (let k = 0; k < 16; k++) {
                expect(m2.elements[k]).toBeCloseTo(m.elements[k], 5);
            }
        } finally {
            cargos.dispose();
            cargos.geometry.dispose();
        }
    });

    it("finish 裁 count；容量不足 / 缺姿态直接报错", () => {
        const cargos = new Cargos(3);
        try {
            cargos.addTrack({
                start: new Vector3(0, 0, 0),
                end: new Vector3(1, 0, 0),
                distance: 1,
            });
            cargos.finish();
            expect(cargos.count).toBe(1);
            // `needsUpdate` 是只写的 setter（读回 undefined），用 version 判断已上传标记
            expect(cargos.geometry.cargoLift.version).toBeGreaterThan(0);
        } finally {
            cargos.dispose();
            cargos.geometry.dispose();
        }

        const small = new Cargos(1);
        try {
            small.addTrack({
                start: new Vector3(0, 0, 0),
                end: new Vector3(1, 0, 0),
                distance: 1,
            });
            expect(() =>
                small.addTrack({
                    start: new Vector3(0, 0, 0),
                    end: new Vector3(1, 0, 0),
                    distance: 1,
                })
            ).toThrow(/容量不足/);
        } finally {
            small.dispose();
            small.geometry.dispose();
        }

        const noPose = new Cargos(1);
        try {
            expect(() => noPose.addTrack({ distance: 1 })).toThrow(/addTrack/);
        } finally {
            noPose.dispose();
            noPose.geometry.dispose();
        }
    });

    it("空蓝图时 finish 把 count 置 0", () => {
        const cargos = new Cargos(2);
        try {
            cargos.finish();
            expect(cargos.count).toBe(0);
            expect(cargos.cargoCount).toBe(0);
        } finally {
            cargos.dispose();
            cargos.geometry.dispose();
        }
    });
});

describe("Cargos.tick：自持相位", () => {
    it("按周期返回 0..1 并写 uniform", () => {
        const cargos = new Cargos(1);
        try {
            expect(cargos.tick(0)).toBe(0);
            expect(cargos.tick(250)).toBeCloseTo(0.25, 6);
            expect(cargos.cargoMove).toBeCloseTo(0.25, 6);
            // 回绕
            expect(cargos.tick(CARGO_PERIOD_MS + 500)).toBeCloseTo(0.5, 6);
            // 自定义周期（冻结 / 倍速的入口）
            expect(cargos.tick(250, 500)).toBeCloseTo(0.5, 6);
            expect(cargos.tick(250, 0)).toBe(0);
        } finally {
            cargos.dispose();
            cargos.geometry.dispose();
        }
    });
});

describe("buildBuildings 只给轨迹，不做货物动画", () => {
    it("条带米白 + 0.06 淡出 + 0.22 抬升；分拣器 0.15 淡出且不抬升", () => {
        nextIndex = 0;
        const built = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, -1),
            inserterBuilding({ x: 10, y: 12 }, { x: 10, y: 13 }),
        ]);
        try {
            const cargos = built.buildings.cargos;
            // 1 条带段 + 1 分拣器
            expect(built.stats.cargoCount).toBe(2);
            expect(cargos.count).toBe(2);

            const color = new Color();
            cargos.getColorAt(0, color);
            expect(color.getHex()).toBe(CARGO_COLOR.getHex());

            const fade = cargos.geometry.cargoFade.array as Float32Array;
            // 条带：这是一条只有一段的线路 → 起点淡入 + 终点淡出
            expect(fade[0]).toBeCloseTo(CARGO_FADE, 6);
            expect(fade[1]).toBeCloseTo(CARGO_FADE, 6);
            // 分拣器：单件抓放，两端同宽
            expect(fade[2]).toBeCloseTo(0.15, 6);
            expect(fade[3]).toBeCloseTo(0.15, 6);

            const lift = cargos.geometry.cargoLift.array as Float32Array;
            // ribbon 顶面 0.05 + 货半高 0.15 + 间隙 0.02
            expect(lift[0]).toBeCloseTo(0.22, 6);
            // 分拣器高度已在矩阵里
            expect(lift[1]).toBeCloseTo(0, 6);

            // 立方体底面 = ribbon 顶面 + 间隙（抬升在着色器侧补，这里按矩阵核对）
            const cargoM = new Matrix4();
            cargos.getMatrixAt(0, cargoM);
            const bottom = new Vector3(
                0,
                lift[0] - CARGO_SIZE / 2,
                0
            ).applyMatrix4(cargoM);
            expect(bottom.length() - PLANET_RADIUS).toBeCloseTo(0.07, 1);
        } finally {
            built.buildings.dispose();
            built.iconTexture.dispose();
        }
    });

    it("淡出按端点拓扑给：中段两端 0，只有线头淡入 / 线尾淡出", () => {
        nextIndex = 0;
        // 0 → 1 → 2 → 3，3 为线尾
        const built = build([
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, 3),
            beltBuilding(10, 13, -1),
        ]);
        try {
            const cargos = built.buildings.cargos;
            // 3 条连接
            expect(built.stats.cargoCount).toBe(3);
            const fade = cargos.geometry.cargoFade.array as Float32Array;
            const fadeAt = (i: number) => [fade[i * 2], fade[i * 2 + 1]];

            // 第 1 段：线路起点（无入边）淡入，终点有后继 → 不淡出
            expect(fadeAt(0)[0]).toBeCloseTo(CARGO_FADE, 6);
            expect(fadeAt(0)[1]).toBe(0);
            // 第 2 段：中段，两端都不淡出 → 不会整场闪烁
            expect(fadeAt(1)).toEqual([0, 0]);
            // 第 3 段：起点有前驱 → 不淡入；终点无出边（线尾）→ 淡出
            expect(fadeAt(2)[0]).toBe(0);
            expect(fadeAt(2)[1]).toBeCloseTo(CARGO_FADE, 6);
        } finally {
            built.buildings.dispose();
            built.iconTexture.dispose();
        }
    });

    it("统计口径与建筑分类一致", () => {
        nextIndex = 0;
        const buildings = [
            beltBuilding(10, 10, 1),
            beltBuilding(10, 11, 2),
            beltBuilding(10, 12, -1),
        ];
        const built = build(buildings);
        try {
            // 2 条连接 → 2 件货物；线尾格没有出边
            expect(built.stats.cargoCount).toBe(2);
            expect(built.stats.buildingCount).toBe(3);
            expect(buildings.filter((b) => isBelt(b.itemId))).toHaveLength(3);
            expect(buildings.filter((b) => isInserter(b.itemId))).toHaveLength(
                0
            );
        } finally {
            built.buildings.dispose();
            built.iconTexture.dispose();
        }
    });
});
