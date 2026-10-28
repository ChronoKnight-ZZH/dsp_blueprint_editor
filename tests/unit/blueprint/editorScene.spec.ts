import { Matrix4, Vector3 } from "three";
import {
    BlueprintData,
    BlueprintReformRect,
    fromStr,
    toStr,
} from "@/blueprint/parser";
import {
    bandOfRow,
    calcBuildingTrans,
    findPosForAreas,
    planetBands,
} from "@/blueprint/planet";
import {
    areaGridSize,
    canvasTargetAt,
    expandToGlobalCanvas,
    materializeCanvasTarget,
} from "@/blueprint/globe";
import {
    createBuilding,
    CreateBuildingCommand,
    createEmptyBlueprint,
} from "@/blueprint/create";
import { buildReforms, Reforms } from "@/blueprint/reform";
import { buildSceneData, rebuildScene } from "@/editor/scene";
import * as fs from "fs";
import * as path from "path";

/**
 * 编辑模式的场景重建回归。
 *
 * 线上问题（新回归）：导入蓝图 → 点「编辑模式」→ 原有建筑模型整体消失，退出编辑也不回来。
 * 根因：进入编辑模式唯一的改动是 `expandToGlobalCanvas`，它重建建筑局部格时只算了经纬两格
 * （`absToLocal` 返回 {x,y}），**丢掉了 z（高度格）**；`calcBuildingTrans` 于是算出
 * `height = R + undefined * (4/3) = NaN`，所有建筑矩阵变 NaN → 整层不可见，且 NaN 会被
 * `toStr` 写回蓝图，所以退出编辑也恢复不了。
 *
 * 这里锁死两件事：
 * 1) 数据级：展开全球画布后，建筑的**绝对格位置（含 z）**与展开前逐格一致，变换/选择盒全部有限；
 * 2) 渲染路径：重建是"先构建、后替换"，构建失败时旧模型留在场景里（不会出现空场景）。
 */

const R = 200.2;
const SEGMENT = 200;
const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixture(name: string) {
    return fromStr(
        fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8").trim()
    );
}

function fixtureNames(): string[] {
    return fs
        .readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith(".txt"))
        .sort();
}

function wrap(x: number, turn: number) {
    return ((x % turn) + turn) % turn;
}

/** 环形经度上的有符号差值（0..1 的分数，取最短方向） */
function circularDelta(a: number, b: number): number {
    let d = a - b;
    d -= Math.round(d);
    return d;
}

/** 建筑端点在该区域坐标系下的绝对位置（纬向行 + 经向分数 + 高度格） */
interface Endpoint {
    row: number;
    lonFrac: number;
    z: number;
}

function endpoints(bp: BlueprintData): Endpoint[] {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    const out: Endpoint[] = [];
    for (const b of bp.buildings) {
        const area = pos.areas[b.areaIndex];
        const turn = areaGridSize(area.segment);
        for (const p of b.localOffset) {
            out.push({
                row: area.latitude + p.y,
                lonFrac: wrap(area.longitude + p.x, turn) / turn,
                z: p.z,
            });
        }
    }
    return out;
}

/** 地基格的绝对位置（按行 + 经向分数，排序后用于跨区域对比） */
function reformCellKeys(bp: BlueprintData): string[] {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    const keys: string[] = [];
    for (const rect of bp.reformData?.rects ?? []) {
        const area = pos.areas[rect.areaIndex];
        if (area === undefined) continue;
        const turn = areaGridSize(area.segment);
        for (let dx = 0; dx < rect.w; dx++) {
            for (let dy = 0; dy < rect.h; dy++) {
                const row = area.latitude + rect.y + dy;
                const lonFrac =
                    wrap(area.longitude + rect.x + dx, turn) / turn;
                keys.push(`${row.toFixed(6)}|${lonFrac.toFixed(9)}`);
            }
        }
    }
    return keys.sort();
}

function worldPosition(m: Matrix4): Vector3 {
    return new Vector3().setFromMatrixPosition(m);
}

function expectFiniteMatrix(m: Matrix4, label: string) {
    for (const e of m.elements)
        if (!Number.isFinite(e)) throw new Error(`${label} 含非有限元素：${e}`);
}

/** 建筑端点世界坐标（变换矩阵的位置部分） */
function worldEndpoints(data: ReturnType<typeof buildSceneData>): Vector3[][] {
    return data.transforms.map((t) => t.map((m) => worldPosition(m)));
}

describe("进入编辑模式（expandToGlobalCanvas）不得让已有建筑消失", () => {
    test("17 份导入蓝图：展开后绝对位置（含高度格 z）逐点不变、变换全部有限", () => {
        const names = fixtureNames();
        expect(names.length).toBe(17);
        for (const name of names) {
            const bp = loadFixture(name);
            const beforeEndpoints = endpoints(bp);
            const beforeCells = reformCellKeys(bp);
            const before = buildSceneData(bp, R, SEGMENT);
            expect(before.invalidBuildings).toEqual([]);
            const beforeWorld = worldEndpoints(before);

            expect(expandToGlobalCanvas(bp)).toBe(true);

            const after = buildSceneData(bp, R, SEGMENT);
            expect(after.invalidBuildings).toEqual([]);
            expect(after.repairedBuildings).toEqual([]);
            expect(after.transforms.length).toBe(bp.buildings.length);
            expect(after.selectBoxes.length).toBe(bp.buildings.length);

            // 1) 每个建筑引用了存在的区域
            for (const b of bp.buildings) {
                expect(after.pos.areas[b.areaIndex]).toBeDefined();
                expect(b.areaIndex).toBeLessThan(bp.areas.length);
            }
            // 2) 变换/选择盒全部有限（NaN 会让建筑整体不可见）
            after.transforms.forEach((t, i) => {
                t.forEach((m) => expectFiniteMatrix(m, `${name} 建筑${i}变换`));
            });
            after.selectBoxes.forEach((m, i) =>
                expectFiniteMatrix(m, `${name} 建筑${i}选择盒`)
            );
            // 3) 高度格（z）必须原样保留——丢掉它就是本次线上回归的根因
            const afterEndpoints = endpoints(bp);
            expect(afterEndpoints).toHaveLength(beforeEndpoints.length);
            beforeEndpoints.forEach((e, i) => {
                expect(afterEndpoints[i].z).toBe(e.z);
                expect(afterEndpoints[i].row).toBeCloseTo(e.row, 8);
                expect(afterEndpoints[i].lonFrac).toBeCloseTo(e.lonFrac, 8);
            });
            // 4) 世界坐标不变（建筑在世界里的位置一格都不该动）。
            //    容差 1e-4 世界单位：区域原点从紧凑纬度改到整带首行后，`area.latitude + y`
            //    的浮点抵消会带来 1e-6 量级差异，物理上不可见（星球半径 200）。
            const afterWorld = worldEndpoints(after);
            afterWorld.forEach((points, i) =>
                points.forEach((p, j) => {
                    expect(p.x).toBeCloseTo(beforeWorld[i][j].x, 4);
                    expect(p.y).toBeCloseTo(beforeWorld[i][j].y, 4);
                    expect(p.z).toBeCloseTo(beforeWorld[i][j].z, 4);
                })
            );
            // 5) 地基格位置不变
            expect(reformCellKeys(bp)).toEqual(beforeCells);
            // 6) 分拣器尖端姿态与 localOffset 同步（否则导出后角度/尖端错位）
            for (const b of bp.buildings) {
                if (b.v2ExtraPose === undefined) continue;
                expect(b.v2ExtraPose[1]).toBe(b.localOffset[1].x);
                expect(b.v2ExtraPose[2]).toBe(b.localOffset[1].y);
                expect(b.v2ExtraPose[3]).toBe(b.localOffset[1].z);
            }
        }
    });

    test("展开后再「保存 → 重新导入」仍然可见（退出编辑不回来 的回归）", () => {
        for (const name of fixtureNames()) {
            const bp = loadFixture(name);
            expandToGlobalCanvas(bp);
            const beforeEndpoints = endpoints(bp);

            const imported = fromStr(toStr(bp));
            const data = buildSceneData(imported, R, SEGMENT);
            expect(data.invalidBuildings).toEqual([]);
            expect(data.repairedBuildings).toEqual([]);
            data.transforms.forEach((t, i) =>
                t.forEach((m) => expectFiniteMatrix(m, `${name} 重导入建筑${i}`))
            );

            const afterEndpoints = endpoints(imported);
            expect(afterEndpoints).toHaveLength(beforeEndpoints.length);
            // 导出会把整带区域收缩成紧凑区域：单区域蓝图的**经度**在游戏里本来就由粘贴位置
            // 决定，收缩会整体平移 1~2 列（内部相对位置不变），所以这里比相对几何 + 高度格。
            for (let i = 0; i < beforeEndpoints.length; i++) {
                const e = beforeEndpoints[i];
                const a = afterEndpoints[i];
                expect(a.z).toBe(e.z);
                expect(a.row - beforeEndpoints[0].row).toBeCloseTo(
                    e.row - beforeEndpoints[0].row,
                    4
                );
                expect(circularDelta(a.lonFrac, afterEndpoints[0].lonFrac)).toBeCloseTo(
                    circularDelta(e.lonFrac, beforeEndpoints[0].lonFrac),
                    6
                );
            }

            // 再进一次编辑模式（`canvasExpanded` 不随蓝图保存，重新导入后会再展开一次）：
            // 必须保持绝对位置、且重建仍然可见
            expect(expandToGlobalCanvas(imported)).toBe(true);
            const again = endpoints(imported);
            expect(again).toHaveLength(afterEndpoints.length);
            again.forEach((e, i) => {
                expect(e.z).toBe(afterEndpoints[i].z);
                expect(e.row).toBeCloseTo(afterEndpoints[i].row, 8);
                expect(
                    circularDelta(e.lonFrac, afterEndpoints[i].lonFrac)
                ).toBeCloseTo(0, 8);
            });
            const twice = buildSceneData(imported, R, SEGMENT);
            expect(twice.invalidBuildings).toEqual([]);
            expect(twice.repairedBuildings).toEqual([]);
            twice.transforms.forEach((t, i) =>
                t.forEach((m) =>
                    expectFiniteMatrix(m, `${name} 二次展开建筑${i}`)
                )
            );
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * 多带 / 非赤道带 / 堆叠 / 地基：合成一份"游戏导出"的蓝图再导入
 * ---------------------------------------------------------------------------------------------- */

function place(
    bp: BlueprintData,
    row: number,
    col: number,
    z = 0
): number {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    const band = bandOfRow(row);
    if (band === null) throw new Error(`row ${row} 超出星球范围`);
    const target = canvasTargetAt(
        bp,
        pos,
        row,
        col * (SEGMENT / band.segment)
    );
    if (target === null) throw new Error("no canvas target");
    const placed = materializeCanvasTarget(bp, target);
    const building = createBuilding(
        2101,
        0,
        { x: Math.floor(placed.x), y: Math.floor(placed.y) },
        0,
        z
    );
    new CreateBuildingCommand(building, placed.areaIndex).do(bp);
    return placed.areaIndex;
}

function rect(
    areaIndex: number,
    x: number,
    y: number,
    w: number,
    h: number
): BlueprintReformRect {
    return {
        reserved: 0,
        x,
        y,
        w,
        h,
        type: 1,
        color: 3,
        areaIndex,
    };
}

/** 跨 4 条纬度带 + 堆叠高度 + 地基的"游戏导出"蓝图 */
function multiBandBlueprint(): BlueprintData {
    const bp = createEmptyBlueprint();
    const bands = planetBands();
    const north160 = bands.find((b) => b.segment === 160 && b.hemisphere === 1);
    const south80 = bands.find((b) => b.segment === 80 && b.hemisphere === -1);
    const north4 = bands.find((b) => b.segment === 4 && b.hemisphere === 1);
    if (!north160 || !south80 || !north4) throw new Error("band table broken");

    place(bp, -80, 0); // 赤道带
    place(bp, 80, 3); // 赤道带（另一端）
    place(bp, north160.rowLo + 3, 20, 2); // 北 160 段带 + 堆叠高度
    place(bp, south80.rowLo + 1, 7, 3); // 南 80 段带 + 堆叠高度
    place(bp, north4.rowLo, 1); // 极区 4 段带
    bp.reformData = {
        reserved: 0,
        rects: [rect(0, 1, 2, 3, 2), rect(1, 4, 1, 2, 3)],
        customReformColorMask: 0,
        customReformColors: [],
    };
    return bp;
}

describe("多带 / 非赤道带导入蓝图进入编辑模式", () => {
    test("导入后展开：多区域成链、绝对位置含 z 不变、变换有限", () => {
        const exported = toStr(multiBandBlueprint());
        const bp = fromStr(exported);
        // 导入后的游戏蓝图本身应是多区域（跨带）
        expect(bp.areas.length).toBeGreaterThan(1);
        expect(bp.buildings).toHaveLength(5);

        const beforeEndpoints = endpoints(bp);
        const beforeCells = reformCellKeys(bp);
        const before = buildSceneData(bp, R, SEGMENT);
        expect(before.invalidBuildings).toEqual([]);
        const beforeWorld = worldEndpoints(before);

        expect(expandToGlobalCanvas(bp)).toBe(true);
        // 一条带一个区域：赤道带 + 北 160 + 南 80 + 北 4
        expect(bp.areas.length).toBe(4);
        expect(bp.areas[0].areaSegments).toBe(SEGMENT);
        expect(bp.areas[0].parentIndex).toBe(-1);

        const after = buildSceneData(bp, R, SEGMENT);
        expect(after.invalidBuildings).toEqual([]);
        expect(after.repairedBuildings).toEqual([]);
        after.transforms.forEach((t, i) =>
            t.forEach((m) => expectFiniteMatrix(m, `多带建筑${i}`))
        );
        after.selectBoxes.forEach((m, i) =>
            expectFiniteMatrix(m, `多带建筑${i}选择盒`)
        );

        const afterEndpoints = endpoints(bp);
        beforeEndpoints.forEach((e, i) => {
            expect(afterEndpoints[i].z).toBe(e.z);
            expect(afterEndpoints[i].row).toBeCloseTo(e.row, 9);
            expect(afterEndpoints[i].lonFrac).toBeCloseTo(e.lonFrac, 9);
        });
        expect(reformCellKeys(bp)).toEqual(beforeCells);

        worldEndpoints(after).forEach((points, i) =>
            points.forEach((p, j) => {
                expect(p.x).toBeCloseTo(beforeWorld[i][j].x, 4);
                expect(p.y).toBeCloseTo(beforeWorld[i][j].y, 4);
                expect(p.z).toBeCloseTo(beforeWorld[i][j].z, 4);
            })
        );

        // 进入编辑后再保存 → 重新导入 → 仍然可见
        const reimported = fromStr(toStr(bp));
        const again = buildSceneData(reimported, R, SEGMENT);
        expect(again.invalidBuildings).toEqual([]);
        again.transforms.forEach((t) =>
            t.forEach((m) => expectFiniteMatrix(m, "重导入多带建筑"))
        );
        expect(endpoints(reimported)).toEqual(endpoints(bp));
    });
});

/* ------------------------------------------------------------------------------------------------
 * 容错：单个坏建筑只影响它自己，不能让整层消失
 * ---------------------------------------------------------------------------------------------- */

describe("场景重建的容错（单个坏数据不拖垮整个场景）", () => {
    function expandedFixture(name: string) {
        const bp = loadFixture(name);
        expect(expandToGlobalCanvas(bp)).toBe(true);
        return bp;
    }

    test("未知模型序号（游戏新版本 / mod）：不抛错，选择盒退化为建筑自身盒", () => {
        const bp = expandedFixture("starting_base_01029.txt");
        bp.buildings[0].modelIndex = 60000;
        const data = buildSceneData(bp, R, SEGMENT);
        expect(data.invalidBuildings).toEqual([]);
        data.selectBoxes.forEach((m) => expectFiniteMatrix(m, "未知模型选择盒"));
        // 其余建筑照旧
        expect(data.transforms.length).toBe(bp.buildings.length);
    });

    test("区域下标越界：只让该建筑不可见，其余建筑照常构建", () => {
        const bp = expandedFixture("starting_base_01029.txt");
        bp.buildings[0].areaIndex = bp.areas.length + 5;
        const data = buildSceneData(bp, R, SEGMENT);
        expect(data.invalidBuildings).toEqual([0]);
        // 退化矩阵 = 零尺寸（元素 15 恒为 1）
        const hidden = data.transforms[0][0].elements;
        expect(hidden[0]).toBe(0);
        expect(hidden[5]).toBe(0);
        expect(hidden[10]).toBe(0);
        expect(hidden[12]).toBe(0);
        expect(hidden[13]).toBe(0);
        expect(hidden[14]).toBe(0);
        for (let i = 1; i < data.transforms.length; i++)
            data.transforms[i].forEach((m) =>
                expectFiniteMatrix(m, `建筑${i}`)
            );
    });

    test("高度格 z 缺失/NaN（历史 bug 写坏的蓝图）：按地面兜底，不消失", () => {
        const bp = expandedFixture("stack_upward_game_sample.txt");
        bp.buildings[0].localOffset[1].z = NaN;
        const data = buildSceneData(bp, R, SEGMENT);
        expect(data.repairedBuildings).toEqual([0]);
        expect(data.invalidBuildings).toEqual([]);
        data.transforms.forEach((t, i) =>
            t.forEach((m) => expectFiniteMatrix(m, `兜底建筑${i}`))
        );
    });

    test("calcBuildingTrans 对越界区域给出可定位的报错", () => {
        const bp = expandedFixture("analyzer_box_game_sample.txt");
        const pos = findPosForAreas(bp.areas, SEGMENT);
        const broken = { ...bp.buildings[0], areaIndex: 99 };
        expect(() => calcBuildingTrans(R, pos, broken)).toThrow(/区域 99/);
    });
});

/* ------------------------------------------------------------------------------------------------
 * UI 重建路径：先构建、后替换
 * ---------------------------------------------------------------------------------------------- */

describe("场景模型原子替换（UI 重建路径）", () => {
    interface Host {
        active: Set<object>;
        apply: (next: object | null) => void;
        current: () => object | null;
    }

    /** 模拟 BlueprintEditor 里的 applySceneModel：移除旧内容 + 加入新内容 */
    function makeHost(): Host {
        const active = new Set<object>();
        let current: object | null = null;
        return {
            active,
            apply(next) {
                if (next === current) return;
                if (current !== null) active.delete(current);
                current = next;
                if (next !== null) active.add(next);
            },
            current: () => current,
        };
    }

    test("构建抛错：旧模型仍留在场景里（不会出现空白场景）", () => {
        const host = makeHost();
        const oldModel = { name: "old" };
        host.apply(oldModel);
        const errors: unknown[] = [];

        const ok = rebuildScene(
            () => {
                throw new Error("boom");
            },
            host.apply,
            (e) => errors.push(e)
        );

        expect(ok).toBe(false);
        expect(host.active.has(oldModel)).toBe(true);
        expect(host.current()).toBe(oldModel);
        expect(errors).toHaveLength(1);
    });

    test("构建成功：旧模型被移除、新模型进场景", () => {
        const host = makeHost();
        const oldModel = { name: "old" };
        const newModel = { name: "new" };
        host.apply(oldModel);

        const ok = rebuildScene(() => newModel, host.apply);

        expect(ok).toBe(true);
        expect(host.active.has(oldModel)).toBe(false);
        expect(host.current()).toBe(newModel);
        expect(host.active.size).toBe(1);
    });

    test("真实蓝图：展开前后重建都可成功（buildSceneData 不抛错）", () => {
        for (const name of fixtureNames()) {
            const bp = loadFixture(name);
            const host = makeHost();
            const build = () =>
                buildSceneData(bp, R, SEGMENT) as unknown as object;
            expect(rebuildScene(build, host.apply)).toBe(true);
            const before = host.current();
            expect(expandToGlobalCanvas(bp)).toBe(true);
            expect(rebuildScene(build, host.apply)).toBe(true);
            expect(host.current()).not.toBe(before);
            expect(host.active.size).toBe(1);
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * 地基渲染路径：buildReforms（jsdom 无 canvas 2D，这里给纹理绘制一个最小桩）
 * ---------------------------------------------------------------------------------------------- */

interface MockContext {
    createLinearGradient: () => { addColorStop: () => void };
    fillRect: () => void;
    fillStyle: string;
}

function installCanvasStub() {
    const ctx: MockContext = {
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        fillRect: () => undefined,
        fillStyle: "",
    };
    const g = globalThis as unknown as {
        document?: { createElement: (tag: string) => unknown };
    };
    const previous = g.document;
    g.document = {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => ctx,
        }),
    };
    return () => {
        g.document = previous;
    };
}

describe("地基渲染路径（buildReforms）", () => {
    let restore: () => void;
    beforeAll(() => {
        restore = installCanvasStub();
    });
    afterAll(() => restore());

    test("多带蓝图：逐格矩阵有限，实例数与地基格数一致", () => {
        const bp = fromStr(toStr(multiBandBlueprint()));
        expandToGlobalCanvas(bp);
        const data = buildSceneData(bp, R, SEGMENT);
        expect(data.reformCells.length).toBeGreaterThan(0);

        const reforms = buildReforms(R, data.pos, bp.reformData, data.reformCells);
        expect(reforms).toBeInstanceOf(Reforms);
        const meshes = reforms!.children as unknown as {
            count: number;
            instanceMatrix: { array: Float32Array };
        }[];
        expect(meshes.length).toBeGreaterThan(0);
        expect(meshes[0].count).toBe(data.reformCells.length);
        for (const m of meshes) {
            for (const v of m.instanceMatrix.array)
                expect(Number.isFinite(v)).toBe(true);
        }
    });

    test("地基矩形引用越界区域：跳过该格而不是抛错", () => {
        const bp = fromStr(toStr(multiBandBlueprint()));
        expandToGlobalCanvas(bp);
        bp.reformData!.rects.push(rect(99, 0, 0, 2, 2));
        const data = buildSceneData(bp, R, SEGMENT);
        expect(() =>
            buildReforms(R, data.pos, bp.reformData, data.reformCells)
        ).not.toThrow();
    });
});
