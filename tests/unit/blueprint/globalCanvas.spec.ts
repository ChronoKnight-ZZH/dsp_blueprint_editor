import { BlueprintData, fromStr, toStr } from "@/blueprint/parser";
import {
    bandOfRow,
    bandSpan,
    findPosForAreas,
    planetBands,
    planetBandGridRange,
    planetRowLimit,
} from "@/blueprint/planet";
import {
    areaGridSize,
    canvasTargetAt,
    ensureCanvasArea,
    expandToGlobalCanvas,
    materializeCanvasTarget,
} from "@/blueprint/globe";
import {
    createBuilding,
    CreateBuildingCommand,
    createEmptyBlueprint,
} from "@/blueprint/create";
import { buildBeltLine, CreateBeltLineCommand } from "@/blueprint/beltLine";
import { PaintReformCellCommand } from "@/blueprint/reformEdit";
import { normalizeBlueprintAreas } from "@/blueprint/area";
import * as fs from "fs";
import * as path from "path";

const SEGMENT = 200;
const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** 带内列 → 全局 1000 格/圈口径的经度坐标 */
function lonGridForColumn(col: number, segment: number): number {
    return col * (SEGMENT / segment);
}

/** 内容里每个建筑端点的绝对位置（行 + 该端点所在区域的列） */
function endpoints(bp: BlueprintData) {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    const out: { row: number; col: number; areaIndex: number }[] = [];
    for (const b of bp.buildings) {
        const area = pos.areas[b.areaIndex];
        const turn = areaGridSize(area.segment);
        for (const p of b.localOffset) {
            out.push({
                row: area.latitude + p.y,
                col: (((area.longitude + p.x) % turn) + turn) % turn,
                areaIndex: b.areaIndex,
            });
        }
    }
    return out;
}

/**
 * 模拟编辑器的一次放置：按绝对纬度行取目标纬度带 → 需要时补出该带区域 → 放置建筑。
 * @returns 落位区域的 areaIndex
 */
function place(
    bp: BlueprintData,
    row: number,
    col: number,
    itemId = 2101,
    modelIndex = 0
): number {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    const band = bandOfRow(row);
    if (band === null) throw new Error(`row ${row} outside planet`);
    const target = canvasTargetAt(
        bp,
        pos,
        row,
        lonGridForColumn(col, band.segment)
    );
    if (target === null) throw new Error("no target");
    const placed = materializeCanvasTarget(bp, target);
    const building = createBuilding(
        itemId,
        modelIndex,
        { x: Math.floor(placed.x), y: Math.floor(placed.y) },
        0
    );
    new CreateBuildingCommand(building, placed.areaIndex).do(bp);
    return placed.areaIndex;
}

/** 蓝图在游戏里必须成立的结构约束 */
function expectGameValid(bp: BlueprintData) {
    const pos = findPosForAreas(bp.areas, SEGMENT);
    for (let i = 0; i < bp.areas.length; i++) {
        const area = bp.areas[i];
        const origin = pos.areas[i];
        // 区域整块落在自己那条带的原始区间里（占两边的带按半球取半边）
        const raw = planetBandGridRange(area.areaSegments, SEGMENT);
        const south = area.areaSegments !== SEGMENT && origin.latitude < 0;
        const lo = south ? -raw.hi : raw.lo;
        const hi = south ? -raw.lo : raw.hi;
        expect(origin.latitude).toBeGreaterThanOrEqual(lo);
        expect(origin.latitude + area.size.y - 1).toBeLessThanOrEqual(hi);
        expect(area.size.x).toBeGreaterThanOrEqual(1);
        expect(area.size.y).toBeGreaterThanOrEqual(1);
        if (area.parentIndex >= 0) {
            // 子区域必须有非零纬度锚点，且段数严格小于父区域（findPosForAreas 的硬约束）
            expect(area.anchorLocalOffset.y).not.toBe(0);
            expect(area.areaSegments).toBeLessThan(
                bp.areas[area.parentIndex].areaSegments
            );
        }
    }
    for (const b of bp.buildings) {
        const area = bp.areas[b.areaIndex];
        const turn = areaGridSize(area.areaSegments);
        for (const p of b.localOffset) {
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThan(area.size.y);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThan(turn);
        }
    }
}

function loadFixture(name: string) {
    return fromStr(
        fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8").trim()
    );
}

describe("区域模型结论：一个 blueprint area 只能落在一条纬度带里", () => {
    test("星球按经向段数分带：赤道 [-80,80]、北 160 段 [81,130]、南 160 段 [-130,-81]", () => {
        const bands = planetBands();
        const equator = bands.find((b) => b.hemisphere === 0)!;
        expect(equator.segment).toBe(200);
        expect([equator.rowLo, equator.rowHi]).toEqual([-80, 80]);
        const n160 = bands.find((b) => b.segment === 160 && b.hemisphere === 1)!;
        expect([n160.rowLo, n160.rowHi]).toEqual([81, 130]);
        const s160 = bands.find((b) => b.segment === 160 && b.hemisphere === -1)!;
        expect([s160.rowLo, s160.rowHi]).toEqual([-130, -81]);
        const pole = bands.find((b) => b.segment === 4 && b.hemisphere === 1)!;
        expect([pole.rowLo, pole.rowHi]).toEqual([246, 250]);
        expect(planetRowLimit()).toBe(250);
    });

    test("带与带按行不重叠：任意一行只属于一条带，全域铺满 -250..250", () => {
        const rows = new Map<number, number>();
        for (const band of planetBands()) {
            for (let r = band.rowLo; r <= band.rowHi; r++) {
                rows.set(r, (rows.get(r) ?? 0) + 1);
            }
        }
        expect(Math.min(...rows.keys())).toBe(-250);
        expect(Math.max(...rows.keys())).toBe(250);
        expect(rows.size).toBe(501);
        for (const [, count] of rows) expect(count).toBe(1);
        expect(bandOfRow(0)!.hemisphere).toBe(0);
        expect(bandOfRow(81)!.segment).toBe(160);
        expect(bandOfRow(-81)!.segment).toBe(160);
        expect(bandOfRow(251)).toBeNull();
    });

    test("赤道带整带高度 161 行 = 游戏整赤道带蓝图 size.y；区域不能跨带", () => {
        const equator = planetBands().find((b) => b.hemisphere === 0)!;
        expect(bandSpan(equator)).toBe(161);
        const raw = planetBandGridRange(200);
        expect(raw.hi - raw.lo + 1).toBe(161);
        // 赤道带区域的合法行范围就是 [-80, 80]：81 行已属于 160 段带
        expect(bandOfRow(raw.hi)!.segment).toBe(200);
        expect(bandOfRow(raw.hi + 1)!.segment).toBe(160);
    });

    test("子区域段数必须严格小于父区域（findPosForAreas 的硬约束）", () => {
        const bp = createEmptyBlueprint();
        bp.areas.push({
            index: 1,
            parentIndex: 0,
            tropicAnchor: 0,
            areaSegments: 200,
            anchorLocalOffset: { x: 0, y: 10 },
            size: { x: 1, y: 1 },
        });
        expect(() => findPosForAreas(bp.areas, SEGMENT)).toThrow();
    });
});

describe("全球放置：任意纬度都能落建筑（自建画布）", () => {
    test("赤道 / 中纬 / 极区 / 南半球各放一个：绝对纬度全对，区域整块落在自己的带里", () => {
        const bp = createEmptyBlueprint();
        const targets = [0, 100, 200, -100, -200];
        for (const row of targets) place(bp, row, 10);
        const rows = endpoints(bp).map((p) => p.row);
        expect(rows).toEqual(targets.flatMap((r) => [r, r]));
        // 赤道带根区域 + 每条用到的带各一个区域
        expect(bp.areas.length).toBe(5);
        expect(bp.areas[0].areaSegments).toBe(200);
        expect(
            bp.areas
                .map((a) => a.areaSegments)
                .slice(1)
                .sort((a, b) => b - a)
        ).toEqual([160, 160, 60, 60]);
        expectGameValid(bp);
    });

    test("同一纬度带反复放置只补一个区域，size.x 随内容增长", () => {
        const bp = createEmptyBlueprint();
        place(bp, 100, 3);
        place(bp, 105, 40);
        expect(bp.areas.length).toBe(2);
        const north = bp.areas[1];
        expect(north.areaSegments).toBe(160);
        expect(north.size.y).toBe(50);
        expect(north.size.x).toBeGreaterThan(40);
        expectGameValid(bp);
    });

    test("带边界行有唯一归属：80 行 = 赤道带，81 行 = 北 160 段带", () => {
        const bp = createEmptyBlueprint();
        expect(place(bp, 80, 5)).toBe(0);
        expect(place(bp, 81, 5)).toBe(1);
        expect(bp.areas[1].areaSegments).toBe(160);
        expect(findPosForAreas(bp.areas, SEGMENT).areas[1].latitude).toBe(81);
        expectGameValid(bp);
    });
});

describe("导入蓝图同样适用：展开成全球画布后绝对位置一格不动", () => {
    test("赤道带小蓝图展开后每个端点绝对位置不变，且能放到南极附近", () => {
        const bp = loadFixture("sample_outpost_ils.txt");
        const before = endpoints(bp);
        expect(expandToGlobalCanvas(bp)).toBe(true);
        expect(bp.canvasExpanded).toBe(true);
        const after = endpoints(bp);
        expect(after.length).toBe(before.length);
        for (let i = 0; i < before.length; i++) {
            expect(after[i].row).toBeCloseTo(before[i].row, 6);
            expect(after[i].col).toBeCloseTo(before[i].col, 6);
        }
        // 画布 = 赤道带整带（根区域）
        expect(bp.areas[0].areaSegments).toBe(200);
        expect(bp.areas[0].size.y).toBe(161);
        // 现在可以在任意纬度继续放置
        place(bp, -200, 20);
        const rows = endpoints(bp).map((p) => p.row);
        expect(Math.min(...rows)).toBe(-200);
        expectGameValid(bp);
    });

    test("导入蓝图展开后直接导出：收缩回单区域且绝对位置不变（进编辑器不改动也能存）", () => {
        const bp = loadFixture("sample_outpost_ils.txt");
        expect(expandToGlobalCanvas(bp)).toBe(true);
        const before = endpoints(bp);
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(1);
        const after = endpoints(out);
        expect(after.length).toBe(before.length);
        // 纬向逐端点必须一致；经向对单区域蓝图是"自由旋转"（游戏按光标落位），
        // 只能比较相对经度（分拣器尖端是 float32，按 5 位小数比较）
        const relative = (list: { col: number }[]) => {
            const turn = 1000;
            const base = list[0].col;
            return list.map((p) => {
                const d = ((((p.col - base) % turn) + turn) % turn);
                return d > turn / 2 ? d - turn : d;
            });
        };
        const beforeRel = relative(before);
        const afterRel = relative(after);
        for (let i = 0; i < before.length; i++) {
            expect(after[i].row).toBeCloseTo(before[i].row, 5);
            expect(afterRel[i]).toBeCloseTo(beforeRel[i], 5);
        }
        expectGameValid(out);
        // 真的能导出成字符串再解析回来
        expect(fromStr(toStr(bp)).buildings.length).toBe(bp.buildings.length);
    });

    test("根区域不在赤道带的导入蓝图（160 段单区域）也能展开到全球", () => {
        const bp = createEmptyBlueprint();
        bp.areas = [
            {
                index: 0,
                parentIndex: -1,
                tropicAnchor: 0,
                areaSegments: 160,
                anchorLocalOffset: { x: 0, y: 0 },
                size: { x: 10, y: 20 },
            },
        ];
        bp.buildings.push(createBuilding(2101, 0, { x: 2, y: 5 }, 0));
        const before = endpoints(bp);
        expect(before[0].row).toBeGreaterThan(80); // 居中在北 160 段带
        expect(expandToGlobalCanvas(bp)).toBe(true);
        expect(bp.areas[0].areaSegments).toBe(200); // 补出赤道带根区域
        expect(endpoints(bp)[0].row).toBeCloseTo(before[0].row, 6);
        // 展开后还能在南半球放
        place(bp, -120, 3);
        expectGameValid(bp);
    });

    test("只有地基的照片蓝图（无建筑）也能展开成全球画布", () => {
        const bp = createEmptyBlueprint();
        bp.reformData = {
            reserved: 0,
            rects: [
                {
                    reserved: 0,
                    x: 3,
                    y: 4,
                    w: 2,
                    h: 1,
                    type: 2,
                    color: 5,
                    areaIndex: 0,
                },
            ],
            customReformColorMask: 0,
            customReformColors: [],
        };
        bp.areas[0].size = { x: 10, y: 160 };
        expect(expandToGlobalCanvas(bp)).toBe(true);
        expect(bp.canvasExpanded).toBe(true);
        expect(bp.reformData!.rects[0].areaIndex).toBe(0);
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(1);
        expectGameValid(out);
    });
    test("未展开的导入蓝图（根区域 size.y=6）：ensureCanvasArea 把根区域补成整带且绝对位置不变", () => {
        const bp = loadFixture("sample_outpost_ils.txt");
        const before = endpoints(bp).map((p) => p.row);
        const band = bandOfRow(40)!;
        const pos = findPosForAreas(bp.areas, SEGMENT);
        const target = canvasTargetAt(
            bp,
            pos,
            40,
            lonGridForColumn(3, band.segment)
        )!;
        expect(target.areaIndex).toBe(-1); // 旧小方框盖不住第 40 行
        const areaIndex = ensureCanvasArea(bp, target.band);
        expect(areaIndex).toBe(0);
        expect(bp.areas[0].size.y).toBe(161);
        expect(findPosForAreas(bp.areas, SEGMENT).areas[0].latitude).toBe(-80);
        expect(endpoints(bp).map((p) => p.row)).toEqual(before);
        // 虚拟原点的局部格与补成整带后的真实区域一致
        expect(target.y).toBe(120);
        const building = createBuilding(
            2101,
            0,
            { x: Math.floor(target.x), y: target.y },
            0
        );
        new CreateBuildingCommand(building, 0).do(bp);
        expect(endpoints(bp).map((p) => p.row).slice(-1)[0]).toBe(40);
        expectGameValid(bp);
    });
    test("展开是幂等的（第二次调用不做事）", () => {
        const bp = loadFixture("same_buildings_v2.txt");
        expect(expandToGlobalCanvas(bp)).toBe(true);
        const snapshot = JSON.stringify(bp.areas);
        expect(expandToGlobalCanvas(bp)).toBe(false);
        expect(JSON.stringify(bp.areas)).toBe(snapshot);
    });

    test("多带游戏蓝图（赤道 + 160 段子区域）展开后绝对位置不变、可导出", () => {
        const bp = createEmptyBlueprint();
        bp.areas = [
            {
                index: 0,
                parentIndex: -1,
                tropicAnchor: 0,
                areaSegments: 200,
                anchorLocalOffset: { x: 0, y: 0 },
                size: { x: 10, y: 161 },
            },
            {
                index: 1,
                parentIndex: 0,
                tropicAnchor: 0,
                areaSegments: 160,
                anchorLocalOffset: { x: 0, y: 161 },
                size: { x: 4, y: 10 },
            },
        ];
        const a = createBuilding(2101, 0, { x: 2, y: 10 }, 0);
        const b = createBuilding(2101, 0, { x: 1, y: 3 }, 0);
        b.areaIndex = 1;
        bp.buildings.push(a, b);
        const before = endpoints(bp);
        expect(expandToGlobalCanvas(bp)).toBe(true);
        const after = endpoints(bp);
        expect(after.map((p) => p.row)).toEqual(before.map((p) => p.row));
        expectGameValid(bp);
        const out = fromStr(toStr(bp));
        expect(out.areas.length).toBe(2);
        expectGameValid(out);
    });
});

describe("导出：单带收缩成紧凑区域（游戏里可整带移动）", () => {
    test("赤道带两个建筑 → 单个区域，绝对纬度保持", () => {
        const bp = createEmptyBlueprint();
        place(bp, 10, 100);
        place(bp, 20, 120);
        const before = endpoints(bp).map((p) => p.row);
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(1);
        expect(out.areas[0].areaSegments).toBe(200);
        expect(out.areas[0].anchorLocalOffset).toEqual({ x: 0, y: 0 });
        const rows = endpoints(out).map((p) => p.row);
        expect(rows).toEqual(before);
        expectGameValid(out);
    });

    test("中纬度单带（160 段）→ 单个 160 段区域，游戏里在该带内可移动", () => {
        const bp = createEmptyBlueprint();
        place(bp, 100, 30);
        place(bp, 105, 35);
        const before = endpoints(bp).map((p) => p.row);
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(1);
        expect(out.areas[0].areaSegments).toBe(160);
        expect(out.areas[0].parentIndex).toBe(-1);
        const pos = findPosForAreas(out.areas, SEGMENT);
        const rows = endpoints(out).map((p) => p.row);
        expect(rows).toEqual(before);
        // 单区域蓝图的尺寸受"居中"约束量化：内容 100..105 → 6 行，居中后必须取 12 行
        expect(out.areas[0].size.y).toBe(12);
        expect(pos.areas[0].latitude).toBe(99);
        expectGameValid(out);
    });
});

describe("导出：跨带蓝图按带拆区域（赤道带为根 + 链式锚点）", () => {
    function multiBandBlueprint() {
        const bp = createEmptyBlueprint();
        place(bp, 0, 10);
        place(bp, 100, 20); // 北 160 段带
        place(bp, -120, 30); // 南 160 段带
        return bp;
    }

    test("导出的区域：赤道带为根、子区域落在各自带里、锚点相对根区域", () => {
        const bp = multiBandBlueprint();
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(3);
        expect(out.areas[0].areaSegments).toBe(200);
        expect(out.areas[0].size.y).toBe(161);
        expect(out.areas[0].parentIndex).toBe(-1);
        const pos = findPosForAreas(out.areas, SEGMENT);
        expect(pos.areas[0].latitude).toBe(-80);
        const north = out.areas.findIndex(
            (a, i) => i > 0 && pos.areas[i].latitude > 0
        );
        expect(north).toBeGreaterThan(0);
        expect(pos.areas[north].latitude).toBeGreaterThanOrEqual(81);
        expect(out.areas[north].parentIndex).toBe(0);
        expect(out.areas[north].anchorLocalOffset.y).toBe(
            pos.areas[north].latitude - pos.areas[0].latitude
        );
        const south = out.areas.findIndex(
            (a, i) => i > 0 && pos.areas[i].latitude < 0
        );
        expect(south).toBeGreaterThan(0);
        expect(pos.areas[south].latitude).toBeLessThanOrEqual(-81);
        expectGameValid(out);
    });

    test("导出的建筑绝对纬度与编辑时一致（纬度由区域元数据唯一确定）", () => {
        const bp = multiBandBlueprint();
        const before = endpoints(bp).map((p) => p.row);
        const out = normalizeBlueprintAreas(bp);
        const rows = endpoints(out).map((p) => p.row);
        expect(rows).toEqual(before);
    });

    test("导出后的蓝图再导入/再导出稳定（游戏可直接粘贴）", () => {
        const bp = multiBandBlueprint();
        const str1 = toStr(bp);
        const bp2 = fromStr(str1);
        // 纯导入的蓝图不会再被收缩（保持原样，字节级 round-trip）
        expect(bp2.canvasExpanded).toBeUndefined();
        // body（gzip 后的区域/建筑二进制）逐字节一致；header 的时间戳因
        // `(ms - base) * 10000` 超出 double 精度会掉 1 tick（parser 既有行为，与区域无关）
        const body = (s: string) => s.slice(s.indexOf('"'), s.indexOf('"', s.indexOf('"') + 1));
        const str2 = toStr(bp2);
        expect(body(str2)).toBe(body(str1));
        expectGameValid(bp2);
    });

    test("南北同名段数（都在 160 段带）→ 也必须拆成两个区域", () => {
        const bp = createEmptyBlueprint();
        place(bp, 100, 5);
        place(bp, -100, 5);
        const out = normalizeBlueprintAreas(bp);
        expect(out.areas.length).toBe(3); // 赤道带根 + 南北各一个 160 段区域
        expect(out.areas.filter((a) => a.areaSegments === 160).length).toBe(2);
        expectGameValid(out);
    });
});

describe("地基与传送带：同样按纬度带落到对应区域", () => {
    test("在地基中纬带铺一格：rect 落在该带区域，导出后绝对行不变", () => {
        const bp = createEmptyBlueprint();
        const row = 150;
        const band = bandOfRow(row)!;
        const target = canvasTargetAt(
            bp,
            findPosForAreas(bp.areas, SEGMENT),
            row,
            lonGridForColumn(7, band.segment)
        )!;
        const placed = materializeCanvasTarget(bp, target);
        const areaIndex = placed.areaIndex;
        new PaintReformCellCommand(
            areaIndex,
            Math.floor(placed.x),
            Math.floor(placed.y),
            3
        ).do(bp);
        expect(bp.reformData!.rects[0].areaIndex).toBe(areaIndex);
        expect(bp.areas[areaIndex].areaSegments).toBe(band.segment);

        // 补一个赤道带建筑，让导出走多带路径（只铺地基时沿用旧行为不收缩）
        place(bp, 0, 1);
        const out = normalizeBlueprintAreas(bp);
        const pos = findPosForAreas(out.areas, SEGMENT);
        const rect = out.reformData!.rects[0];
        const area = pos.areas[rect.areaIndex];
        expect(area.latitude + rect.y).toBe(row);
        expectGameValid(out);
    });

    test("传送带：中纬带内按该带格数(800)铺线，整条写进对应区域", () => {
        const bp = createEmptyBlueprint();
        const row = 100;
        const band = bandOfRow(row)!;
        const target = canvasTargetAt(
            bp,
            findPosForAreas(bp.areas, SEGMENT),
            row,
            lonGridForColumn(10, band.segment)
        )!;
        const placed = materializeCanvasTarget(bp, target);
        const areaIndex = placed.areaIndex;
        const gridSize = areaGridSize(band.segment);
        expect(gridSize).toBe(800);
        const start = { x: Math.floor(placed.x), y: Math.floor(placed.y) };
        const belts = buildBeltLine(
            2001,
            0,
            start,
            { x: start.x + 5, y: start.y },
            0,
            "latFirst",
            null,
            null,
            gridSize
        );
        expect(belts.length).toBe(6);
        const command = new CreateBeltLineCommand(
            belts,
            null,
            null,
            areaIndex,
            gridSize
        );
        command.do(bp);
        expect(bp.buildings.length).toBe(6);
        for (const b of bp.buildings) expect(b.areaIndex).toBe(areaIndex);
        expect(bp.buildings[0].outputObjIdx).toBe(bp.buildings[1].index);
        expect(bp.buildings[5].outputObjIdx).toBe(-1);
        expectGameValid(bp);
        command.undo(bp);
        expect(bp.buildings.length).toBe(0);
    });

    test("一条带 = 一个区域：越出带边界的路径要在边界处截断", () => {
        const bp = createEmptyBlueprint();
        const row = 128; // 北 160 段带里靠北边界的一行
        const band = bandOfRow(row)!;
        const target = canvasTargetAt(
            bp,
            findPosForAreas(bp.areas, SEGMENT),
            row,
            lonGridForColumn(10, band.segment)
        )!;
        const placed = materializeCanvasTarget(bp, target);
        const areaIndex = placed.areaIndex;
        const area = bp.areas[areaIndex];
        const gridSize = areaGridSize(band.segment);
        const start = { x: Math.floor(placed.x), y: Math.floor(placed.y) };
        const belts = buildBeltLine(
            2001,
            0,
            start,
            { x: start.x, y: start.y + 5 },
            0,
            "latFirst",
            null,
            null,
            gridSize
        );
        const clipped = belts.filter(
            (b) => b.localOffset[0].y >= 0 && b.localOffset[0].y < area.size.y
        );
        expect(belts.length).toBe(6);
        expect(clipped.length).toBeLessThan(belts.length);
        expect(clipped.length).toBeGreaterThan(0);
        expect(area.size.y).toBe(50);
    });
});
