import { BlueprintBuilding } from '@/blueprint/parser';
import { createBuilding } from '@/blueprint/create';
import { createSorterBetween, beltOffsetFromMain } from '@/blueprint/sorter';
import { isBelt, isInserter } from '@/data/items';
import { getBuildingSlots, findNearestSlot, findNearestFreeSlot } from '@/data/buildingSlots';

/** 创建测试用建筑（index 由调用方设置） */
function makeBuildingAt(
    itemId: number, modelIndex: number, x: number, y: number, yaw = 0,
): BlueprintBuilding {
    return createBuilding(itemId, modelIndex, { x, y }, yaw);
}

describe('buildingSlots', () => {
    test('assembler 2303 has 12 slots', () => {
        const slots = getBuildingSlots(2303);
        expect(slots.length).toBe(12);
    });

    test('unknown building returns empty slots', () => {
        expect(getBuildingSlots(9999)).toEqual([]);
    });

    test('same-model tiers share the calibrated slot table', () => {
        // 制造台 Mk.II/III/IV 与 Mk.I 同选择盒（4.2 格）→ 复用 slot 表
        expect(getBuildingSlots(2304).length).toBe(12);
        expect(getBuildingSlots(2305).length).toBe(12);
        expect(getBuildingSlots(2305)[10]).toEqual(getBuildingSlots(2303)[10]);
        // 位面熔炉 / 熔炉 Mk.III 复用 2302；研究站 Mk.II 复用 2901
        expect(getBuildingSlots(2315)).toEqual(getBuildingSlots(2302));
        expect(getBuildingSlots(2319)).toEqual(getBuildingSlots(2302));
        expect(getBuildingSlots(2902)).toEqual(getBuildingSlots(2901));
        expect(getBuildingSlots(2301)).toEqual([]);   // 采矿机尚未收录
    });

    test('findNearestSlot returns correct slot for top-center', () => {
        // slot 1 是上方中间 (0, 0.8745)
        expect(findNearestSlot(2303, 0, 0.87)).toBe(1);
    });

    test('findNearestSlot returns correct slot for right-middle', () => {
        // slot 4 是右方中间 (0.8925, 0.0005)
        expect(findNearestSlot(2303, 0.89, 0)).toBe(4);
    });

    test('findNearestSlot returns -1 for unknown building', () => {
        expect(findNearestSlot(9999, 0, 0)).toBe(-1);
    });
});

describe('findNearestFreeSlot', () => {
    // 火力发电厂 2204（非四条边建筑，5 slot，模型在选盒内偏移）：
    // slot 0/1/2 在 -x 侧（-1.686, 0.80/0/-0.80），slot 3/4 在 +x 侧（0.69, 0/0.80）

    test('no occupancy behaves like findNearestSlot', () => {
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set())).toBe(3);
    });

    test('occupied nearest slot switches within the same face', () => {
        // slot 3（+x 面）被占 → 同一面内的 slot 4
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set([3]))).toBe(4);
    });

    test('click near a slot picks that slot; occupied switches to same face', () => {
        // 点击 (0.6, 0.80) 贴近 slot 4
        expect(findNearestFreeSlot(2204, 0.6, 0.8, new Set())).toBe(4);
        // 点击 -x 侧偏下贴近 slot 2：被占 → 同面最近的 slot 1
        expect(findNearestFreeSlot(2204, -1.68, -0.5, new Set([2]))).toBe(1);
    });

    test('does not switch to another face', () => {
        // 点击 +x 侧，+x 面（slot 3/4）全占 → 不切到 -x 侧，返回 -1
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set([3, 4]))).toBe(-1);
        // 点击 -x 侧，-x 面全占 → 也不切到 +x 侧
        expect(findNearestFreeSlot(2204, -1.68, 0, new Set([0, 1, 2]))).toBe(-1);
    });

    test('returns -1 for unknown building', () => {
        expect(findNearestFreeSlot(9999, 0, 0, new Set())).toBe(-1);
    });
});

describe('isBelt / isInserter', () => {
    test('belt ids 2001-2003', () => {
        expect(isBelt(2001)).toBe(true);
        expect(isBelt(2002)).toBe(true);
        expect(isBelt(2003)).toBe(true);
        expect(isBelt(2004)).toBe(false);
    });

    test('inserter ids 2011-2014', () => {
        expect(isInserter(2011)).toBe(true);
        expect(isInserter(2014)).toBe(true);
        expect(isInserter(2015)).toBe(false);
    });
});

describe('createSorterBetween', () => {
    /** 创建测试用建筑 */
    function makeBuilding(itemId: number, modelIndex: number, x: number, y: number, yaw = 0): BlueprintBuilding {
        const b = createBuilding(itemId, modelIndex, { x, y }, yaw);
        b.index = 0; // 测试中手动设置
        return b;
    }

    test('assembler to assembler (slot to slot)', () => {
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 3, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).not.toBeNull();
        if (!sorter) return;

        // 连接字段
        expect(sorter.inputObjIdx).toBe(0);
        expect(sorter.outputObjIdx).toBe(1);
        expect(sorter.inputFromSlot).toBeGreaterThanOrEqual(0);  // 建筑 slot
        expect(sorter.outputToSlot).toBeGreaterThanOrEqual(0);   // 建筑 slot
        expect(sorter.inputToSlot).toBe(1);   // 分拣器固定
        expect(sorter.outputFromSlot).toBe(0); // 分拣器固定
        expect(sorter.inputOffset).toBe(0);    // 建筑端无 offset
        expect(sorter.outputOffset).toBe(0);   // 建筑端无 offset

        // 长度
        const len = (sorter.parameters as { length: number }).length;
        expect(len).toBeGreaterThanOrEqual(1);
        expect(len).toBeLessThanOrEqual(3);
    });

    test('assembler to belt (slot to belt)', () => {
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2001, 0, 3, 0, 0); // 皮带，yaw=0（向上）
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).not.toBeNull();
        if (!sorter) return;

        expect(sorter.inputObjIdx).toBe(0);
        expect(sorter.outputObjIdx).toBe(1);
        expect(sorter.inputFromSlot).toBeGreaterThanOrEqual(0);  // 建筑 slot
        expect(sorter.outputToSlot).toBe(-1);  // 皮带端固定 -1
        expect(sorter.outputOffset).toBeGreaterThanOrEqual(-10);
        expect(sorter.outputOffset).toBeLessThanOrEqual(10);
    });

    test('belt to assembler (belt to slot)', () => {
        const src = makeBuilding(2001, 0, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 3, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).not.toBeNull();
        if (!sorter) return;

        expect(sorter.inputObjIdx).toBe(0);
        expect(sorter.outputObjIdx).toBe(1);
        expect(sorter.inputFromSlot).toBe(-1);  // 皮带端固定 -1
        expect(sorter.outputToSlot).toBeGreaterThanOrEqual(0);  // 建筑 slot
        expect(sorter.inputOffset).toBeGreaterThanOrEqual(-10);
        expect(sorter.inputOffset).toBeLessThanOrEqual(10);
        expect(sorter.outputOffset).toBe(0);  // 建筑端无 offset
    });

    test('belt to belt', () => {
        const src = makeBuilding(2001, 0, 0, 0, 0);
        const dst = makeBuilding(2001, 0, 3, 0, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).not.toBeNull();
        if (!sorter) return;

        expect(sorter.inputFromSlot).toBe(-1);
        expect(sorter.outputToSlot).toBe(-1);
        expect(sorter.inputOffset).toBeGreaterThanOrEqual(-10);
        expect(sorter.inputOffset).toBeLessThanOrEqual(10);
        expect(sorter.outputOffset).toBeGreaterThanOrEqual(-10);
        expect(sorter.outputOffset).toBeLessThanOrEqual(10);
    });

    test('too far returns null', () => {
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 10, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).toBeNull();
    });

    test('same position returns null', () => {
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 0, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0);
        expect(sorter).toBeNull();
    });

    test('yaw rotation maps to correct local middle slot (90°)', () => {
        // dst 在 src 的 +x 方向（网格 -x 面进入）。
        // dst yaw=90°：局部下排中间 slot 7 经 R_Z(-90°) 转到网格 -x 面
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 3, 0, 90);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0)!;
        expect(sorter).not.toBeNull();
        expect(sorter.outputToSlot).toBe(7);  // 下排中间
        expect(sorter.inputFromSlot).toBe(4); // 右列中间
    });

    test('yaw rotation maps to correct local middle slot (180°)', () => {
        // dst 在 src 的 +x 方向，dst yaw=180°：局部右列中间 slot 4
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 3, 0, 180);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0)!;
        expect(sorter).not.toBeNull();
        expect(sorter.outputToSlot).toBe(4); // 右列中间
    });

    test('yaw=0 maps to middle slot of each edge', () => {
        // dst 在 src 的 +x 方向，src 端从 +x 面输出(slot 4)，dst 端从 -x 面进入(slot 10)
        const src = makeBuilding(2303, 0, 0, 0);
        const dst = makeBuilding(2303, 0, 3, 0, 0);
        src.index = 0;
        dst.index = 1;

        const sorter = createSorterBetween(src, dst, 2011, 0)!;
        expect(sorter).not.toBeNull();
        expect(sorter.inputFromSlot).toBe(4);  // 右列中间
        expect(sorter.outputToSlot).toBe(10);  // 左列中间
    });

    describe('slot occupancy (one sorter per slot)', () => {
        /**
         * src(0,0) → dst(3,0) 沿 +x 方向：
         * src 端从 +x 面输出（右列 slot 3/4/5），dst 端从 -x 面进入（左列 slot 9/10/11）。
         */
        function setup() {
            const src = makeBuilding(2303, 0, 0, 0);
            const dst = makeBuilding(2303, 0, 3, 0);
            src.index = 0;
            dst.index = 1;
            return { src, dst };
        }

        test('first sorter connects middle slot of each edge', () => {
            const { src, dst } = setup();
            const s = createSorterBetween(src, dst, 2011, 0)!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(4);   // 右列中间（最近）
            expect(s.outputToSlot).toBe(10);   // 左列中间（最近）
        });

        test('second sorter on same endpoint switches to parallel slot', () => {
            const { src, dst } = setup();
            const s1 = createSorterBetween(src, dst, 2011, 0)!;
            // 第二根：slot 4 和 10 都被占 → 切到同列平行的 3/5 和 9/11
            const s2 = createSorterBetween(src, dst, 2011, 0, [src, dst, s1])!;
            expect(s2).not.toBeNull();
            expect([3, 5]).toContain(s2.inputFromSlot);
            expect([9, 11]).toContain(s2.outputToSlot);
            expect(s2.inputFromSlot).not.toBe(s1.inputFromSlot);
            expect(s2.outputToSlot).not.toBe(s1.outputToSlot);
        });

        test('repeated sorters never reuse a slot on either endpoint', () => {
            const { src, dst } = setup();
            const placed: BlueprintBuilding[] = [src, dst];
            const inUsed = new Set<number>();
            const outUsed = new Set<number>();
            for (let i = 0; i < 3; i++) {  // 每列 3 个 slot，最多 3 根
                const s = createSorterBetween(src, dst, 2011, 0, placed)!;
                expect(s).not.toBeNull();
                expect(inUsed.has(s.inputFromSlot)).toBe(false);
                expect(outUsed.has(s.outputToSlot)).toBe(false);
                inUsed.add(s.inputFromSlot);
                outUsed.add(s.outputToSlot);
                placed.push(s);
            }
        });

        test('returns null when parallel group exhausted', () => {
            const { src, dst } = setup();
            const placed: BlueprintBuilding[] = [src, dst];
            // src 右列 3 个 slot（3/4/5）占满后拒绝
            let last: BlueprintBuilding | null = null;
            for (let i = 0; i < 4; i++) {
                last = createSorterBetween(src, dst, 2011, 0, placed);
                if (!last) break;
                placed.push(last);
            }
            expect(last).toBeNull();
            expect(placed.length).toBe(2 + 3); // 只成功放下 3 根
        });
    });

    describe('belt offset occupancy (one sorter per offset)', () => {
        // 皮带↔皮带：同一 offset 只能有一个分拣器端点
        test('second sorter on same belt switches to nearest free offset', () => {
            const belt1 = makeBuilding(2001, 0, 0, 0, 0);
            const belt2 = makeBuilding(2001, 0, 0, 3, 0);
            belt1.index = 0;
            belt2.index = 1;

            const s1 = createSorterBetween(belt1, belt2, 2011, 0)!;
            expect(s1).not.toBeNull();
            const off1in = s1.inputOffset, off1out = s1.outputOffset;

            // 第二根：相同位置 → offset 被占 → 切到最近空闲 offset
            const s2 = createSorterBetween(belt1, belt2, 2011, 0, [belt1, belt2, s1])!;
            expect(s2).not.toBeNull();
            expect(s2.inputOffset).not.toBe(off1in);
            expect(s2.outputOffset).not.toBe(off1out);
        });

        test('returns null when all offsets occupied on one belt', () => {
            const belt1 = makeBuilding(2001, 0, 0, 0, 0);
            const belt2 = makeBuilding(2001, 0, 0, 3, 0);
            belt1.index = 0;
            belt2.index = 1;

            // 皮带可连接分段为 -10 .. 10 共 21 档（±半格 × 每格 21 段），全部占满 → 拒绝
            const placed: BlueprintBuilding[] = [belt1, belt2];
            for (let o = -10; o <= 10; o++) {
                const fake = createBuilding(2011, 0, { x: 0, y: 0 }, 0);
                fake.index = 100 + o + 10;
                fake.inputObjIdx = 0;  // 指向 belt1
                fake.inputFromSlot = -1;
                fake.inputOffset = o;
                fake.outputObjIdx = -1;
                placed.push(fake);
            }

            expect(createSorterBetween(belt1, belt2, 2011, 0, placed)).toBeNull();
        });
    });

    describe('belt-to-belt length (verified against real blueprint)', () => {
        // 真实蓝图 0.10.35：皮带中心距 = len，端点 = 中心（无内缩）
        test.each([
            [1, 1],  // (3,3)→(3,2) 距 1 → len 1
            [2, 2],  // (2,3)→(2,1) 距 2 → len 2
            [3, 3],  // (1,3)→(1,0) 距 3 → len 3
        ])('center distance %i → length %i', (dist, expectedLen) => {
            const src = makeBuilding(2001, 0, 0, 0, 0);
            const dst = makeBuilding(2001, 0, dist, 0, 0); // dst 在 (+dist, 0)
            src.index = 0;
            dst.index = 1;
            const s = createSorterBetween(src, dst, 2011, 0)!;
            expect(s).not.toBeNull();
            expect((s.parameters as { length: number }).length).toBe(expectedLen);
            // 端点 = 皮带中心
            expect(s.localOffset[0].x).toBeCloseTo(0, 3);
            expect(s.localOffset[0].y).toBeCloseTo(0, 3);
            expect(s.localOffset[1].x).toBeCloseTo(dist, 3);
            expect(s.localOffset[1].y).toBeCloseTo(0, 3);
        });
    });

    describe('cardinal axis only (90° steps, no 45° diagonals)', () => {
        test('diagonal building-to-building is rejected', () => {
            const src = makeBuilding(2303, 0, 0, 0, 0);
            const dst = makeBuilding(2303, 0, 3, 3, 0);  // 45° 斜对角
            src.index = 0;
            dst.index = 1;
            expect(createSorterBetween(src, dst, 2011, 0)).toBeNull();
        });

        test('diagonal building-to-belt is rejected', () => {
            const src = makeBuilding(2303, 0, 0, 0, 0);
            const dst = makeBuilding(2001, 0, 2, 2, 0);
            src.index = 0;
            dst.index = 1;
            expect(createSorterBetween(src, dst, 2011, 0)).toBeNull();
        });

        test('diagonal belt-to-belt is rejected', () => {
            const src = makeBuilding(2001, 0, 0, 0, 0);
            const dst = makeBuilding(2001, 0, 3, 3, 0);
            src.index = 0;
            dst.index = 1;
            expect(createSorterBetween(src, dst, 2011, 0)).toBeNull();
        });

        test('near-axis placement within sphere noise tolerance is accepted', () => {
            const src = makeBuilding(2303, 0, 0, 0, 0);
            const dst = makeBuilding(2303, 0, 3, 0.1, 0);  // 约 1.9° 偏差
            src.index = 0;
            dst.index = 1;
            expect(createSorterBetween(src, dst, 2011, 0)).not.toBeNull();
        });
    });

    describe('splitter port uniqueness (2020)', () => {
        test('inline splitter (39): A and B ends each accept one sorter', () => {
            // 一字形 yaw=0：长轴沿 ±y，0=A(+y)，2=B(-y)
            const sp = makeBuilding(2020, 39, 0, 0, 0);
            const a = makeBuilding(2303, 0, 0, 3, 0);   // A 端 (+y)
            const b = makeBuilding(2303, 0, 0, -3, 0);  // B 端 (-y)
            sp.index = 0; a.index = 1; b.index = 2;

            const sA = createSorterBetween(sp, a, 2011, 0, [sp, a, b])!;
            const sB = createSorterBetween(b, sp, 2011, 0, [sp, a, b, sA])!;
            expect(sA).not.toBeNull();
            expect(sB).not.toBeNull();
        });

        test('inline splitter (39): same end cannot be referenced twice', () => {
            const sp = makeBuilding(2020, 39, 0, 0, 0);
            const a = makeBuilding(2303, 0, 0, 3, 0);
            sp.index = 0; a.index = 1;

            const s1 = createSorterBetween(sp, a, 2011, 0, [sp, a])!;
            expect(s1).not.toBeNull();
            // 第二个分拣器再引 A 端 → 拒绝（输出侧也一样）
            expect(createSorterBetween(sp, a, 2011, 0, [sp, a, s1])).toBeNull();
            expect(createSorterBetween(a, sp, 2011, 0, [sp, a, s1])).toBeNull();
        });

        test('inline splitter (39): closed short sides are rejected', () => {
            const sp = makeBuilding(2020, 39, 0, 0, 0);
            const side = makeBuilding(2303, 0, 3, 0, 0);  // +x 短边：无开口
            sp.index = 0; side.index = 1;
            expect(createSorterBetween(sp, side, 2011, 0, [sp, side])).toBeNull();
            expect(createSorterBetween(side, sp, 2011, 0, [sp, side])).toBeNull();
        });

        test('inline splitter (39) with yaw 90: open ends rotate to ±x', () => {
            const sp = makeBuilding(2020, 39, 0, 0, 90);  // 长轴旋到 ±x
            const open = makeBuilding(2303, 0, 3, 0, 0);   // +x = A 端
            const closed = makeBuilding(2303, 0, 0, 3, 0); // +y = 封闭短边
            sp.index = 0; open.index = 1; closed.index = 2;
            expect(createSorterBetween(sp, open, 2011, 0, [sp, open, closed])).not.toBeNull();
            expect(createSorterBetween(sp, closed, 2011, 0, [sp, open, closed])).toBeNull();
        });

        test('cross splitter (38): four ports independent, same port rejected', () => {
            const sp = makeBuilding(2020, 38, 0, 0, 0);
            const north = makeBuilding(2303, 0, 0, 3, 0);  // port 0 (+y)
            const east = makeBuilding(2303, 0, 3, 0, 0);   // port 1 (+x)
            const south = makeBuilding(2303, 0, 0, -3, 0); // port 2 (-y)
            sp.index = 0; north.index = 1; east.index = 2; south.index = 3;

            const sN = createSorterBetween(north, sp, 2011, 0, [sp, north, east, south])!;
            const sE = createSorterBetween(sp, east, 2011, 0, [sp, north, east, south, sN])!;
            const sS = createSorterBetween(sp, south, 2011, 0, [sp, north, east, south, sN, sE])!;
            expect(sN).not.toBeNull();
            expect(sE).not.toBeNull();
            expect(sS).not.toBeNull();
            // port 0 已被 sN 占用 → 再来一根拒绝；port 3 (-x) 仍空闲
            const west = makeBuilding(2303, 0, -3, 0, 0);
            west.index = 4;
            expect(createSorterBetween(north, sp, 2011, 0, [sp, north, east, south, west, sN, sE, sS])).toBeNull();
            expect(createSorterBetween(west, sp, 2011, 0, [sp, north, east, south, west, sN, sE, sS])).not.toBeNull();
        });
    });

    describe('duplicate / overlap rejection', () => {
        // 2030 流速器：无 slot 表、非皮带/分流器，端点 slot 写 -1，适合验证纯重复
        test('identical endpoint pair (slot-less buildings) is rejected, reverse too', () => {
            const a = makeBuilding(2030, 208, 0, 0, 0);
            const b = makeBuilding(2030, 208, 0, 3, 0);
            a.index = 0; b.index = 1;

            const s1 = createSorterBetween(a, b, 2011, 0, [a, b])!;
            expect(s1).not.toBeNull();
            expect(createSorterBetween(a, b, 2011, 0, [a, b, s1])).toBeNull();
            expect(createSorterBetween(b, a, 2011, 0, [a, b, s1])).toBeNull();
        });

        test('collinear overlapping sorters between different pairs are rejected', () => {
            const m = makeBuilding(2030, 208, 0, 0, 0);
            const beltA = makeBuilding(2001, 0, 0, 2, 0);  // 近皮带
            const beltB = makeBuilding(2001, 0, 0, 3, 0);  // 远皮带（线段包含 s1）
            m.index = 0; beltA.index = 1; beltB.index = 2;

            const s1 = createSorterBetween(m, beltA, 2011, 0, [m, beltA, beltB])!;
            expect(s1).not.toBeNull();
            expect(createSorterBetween(m, beltB, 2011, 0, [m, beltA, beltB, s1])).toBeNull();
        });

        test('parallel side-by-side sorters are allowed', () => {
            const belt1a = makeBuilding(2001, 0, 0, 0, 0);
            const belt1b = makeBuilding(2001, 0, 0, 3, 0);
            const belt2a = makeBuilding(2001, 0, 1, 0, 0);  // 相邻一列
            const belt2b = makeBuilding(2001, 0, 1, 3, 0);
            belt1a.index = 0; belt1b.index = 1; belt2a.index = 2; belt2b.index = 3;

            const s1 = createSorterBetween(belt1a, belt1b, 2011, 0,
                [belt1a, belt1b, belt2a, belt2b])!;
            expect(s1).not.toBeNull();
            const s2 = createSorterBetween(belt2a, belt2b, 2011, 0,
                [belt1a, belt1b, belt2a, belt2b, s1])!;
            expect(s2).not.toBeNull();
        });
    });
});

/**
 * 以下用例按真实蓝图 tests/tools/分拣器.txt（游戏 0.10.35）标定的规则编写：
 * 建筑端端点 = slot 坐标；皮带端端点 = 轴线与皮带中心线交点；offset = floor(main × 21)。
 * 坐标取自该蓝图中制造台 Mk.I（2303，中心 (13,11)）与周边皮带的实际布局。
 */
describe('blueprint-calibrated rules (分拣器.txt)', () => {
    /** 制造台 Mk.I：modelIndex 65，选择盒 4.2 格 */
    function assembler(x: number, y: number, yaw = 0) {
        return makeBuildingAt(2303, 65, x, y, yaw);
    }
    /** 低速传送带：modelIndex 35 */
    function belt(x: number, y: number, yaw: number) {
        return makeBuildingAt(2001, 35, x, y, yaw);
    }

    describe('belt offset encoding', () => {
        test.each([
            [0, 0],
            [0.0025, 0],
            [-0.0025, -1],
            [0.1865, 3],          // 3/21 = 0.1429 ≤ x < 4/21 = 0.1905
            [0.1907, 4],
            [-0.1865, -4],
            [-0.1907, -5],
            [0.2075, 4],
            [-0.2075, -5],
            [0.476, 9],
            [0.5, 10],            // 上限截断
            [-0.5, -10],
        ])('main %f → offset %i', (main, expected) => {
            expect(beltOffsetFromMain(main)).toBe(expected);
        });
    });

    describe('building → belt (#0 in 分拣器.txt)', () => {
        // 制造台 (13,11) → 皮带 (11,12) yaw=180（皮带向 -y 走）
        test('slot 11 endpoint + belt centerline projection + offset 4', () => {
            const asm = assembler(13, 11);
            const dst = belt(11, 12, 180);
            asm.index = 0;
            dst.index = 1;

            const s = createSorterBetween(asm, dst, 2011, 41, [asm, dst], {
                src: { x: 12, y: 12 },   // 点击落在 y=12 行 → slot 11（+0.7955）
            })!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(11);
            expect(s.inputOffset).toBe(0);
            expect(s.outputToSlot).toBe(-1);
            expect(s.outputOffset).toBe(4);
            expect(s.inputToSlot).toBe(1);
            expect(s.outputFromSlot).toBe(0);
            expect((s.parameters as { length: number }).length).toBe(1);
            expect(s.yaw[0]).toBe(270);
            // 建筑端 = 建筑中心 + slot 11 局部坐标 (yaw=0)
            expect(s.localOffset[0].x).toBeCloseTo(13 - 0.8916, 3);
            expect(s.localOffset[0].y).toBeCloseTo(11 + 0.7955, 3);
            // 皮带端 = 轴线与皮带中心线交点（皮带中心 (11,12)，主轴投影 +0.2045）
            expect(s.localOffset[1].x).toBeCloseTo(11, 3);
            expect(s.localOffset[1].y).toBeCloseTo(11.7955, 3);
        });

        test('click row selects the slot (#56 / #15 in 分拣器.txt)', () => {
            const asm = assembler(13, 11);
            asm.index = 0;
            // #56：点击 y=11 行 → slot 10（左列中间），挂到同排皮带 (11,11)，offset -1
            const beltMiddle = belt(11, 11, 180);
            beltMiddle.index = 1;
            const middle = createSorterBetween(asm, beltMiddle, 2011, 41,
                [asm, beltMiddle], { src: { x: 12, y: 11 } })!;
            expect(middle).not.toBeNull();
            expect(middle.inputFromSlot).toBe(10);
            expect(middle.outputOffset).toBe(-1);

            // #15：点击 y=10 行 → slot 9（左列偏下），挂到 (11,10)，offset -5
            const beltLower = belt(11, 10, 180);
            beltLower.index = 2;
            const lower = createSorterBetween(asm, beltLower, 2011, 41,
                [asm, beltLower], { src: { x: 12, y: 10 } })!;
            expect(lower).not.toBeNull();
            expect(lower.inputFromSlot).toBe(9);
            expect(lower.outputOffset).toBe(-5);
        });

        test('anchor row that cannot reach the belt falls back to the belt row', () => {
            const asm = assembler(13, 11);
            const dst = belt(11, 12, 180);
            asm.index = 0;
            dst.index = 1;
            // 锚点落在 y=11 行（slot 10 → 轴线 y≈11.0）时皮带 (11,12) 在另一格、无法挂接，
            // 此时忽略锚点用"对端中心"基准重试 → 自动选到能连上的 slot 11（与游戏结果一致）
            const s = createSorterBetween(asm, dst, 2011, 41, [asm, dst],
                { src: { x: 12, y: 11 } })!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(11);
            expect(s.outputOffset).toBe(4);
        });
    });

    describe('belt → building (#10 in 分拣器.txt)', () => {
        test('destination slot from source lateral + belt offset -1', () => {
            const src = belt(4, 11, 180);
            const dst = assembler(2, 11);
            src.index = 0;
            dst.index = 1;

            const s = createSorterBetween(src, dst, 2011, 41, [src, dst])!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(-1);
            expect(s.inputOffset).toBe(-1);     // main = -0.0005 → floor(-0.0105) = -1
            expect(s.outputToSlot).toBe(4);     // 右列中间
            expect(s.outputOffset).toBe(0);
            expect(s.localOffset[1].x).toBeCloseTo(2 + 0.8925, 3);
            expect(s.localOffset[0].x).toBeCloseTo(4, 3);
            expect(s.yaw[0]).toBe(270);
        });
    });

    describe('building ↔ building (#12 / #16 in 分拣器.txt)', () => {
        test('#12: lateral -0.794 slot row on both ends, len 2', () => {
            const src = assembler(27, 11);
            const dst = assembler(23, 11);
            src.index = 0;
            dst.index = 1;

            const s = createSorterBetween(src, dst, 2011, 41, [src, dst], {
                src: { x: 26, y: 10 },
                dst: { x: 24, y: 10 },
            })!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(9);
            expect(s.outputToSlot).toBe(5);
            expect((s.parameters as { length: number }).length).toBe(2);
            expect(s.localOffset[0].y).toBeCloseTo(11 - 0.7945, 3);
            expect(s.localOffset[1].y).toBeCloseTo(11 - 0.7945, 3);
            expect(s.localOffset[0].x).toBeCloseTo(27 - 0.8934, 3);
            expect(s.localOffset[1].x).toBeCloseTo(23 + 0.8934, 3);
        });

        test('#16: reverse direction uses the mirrored slot row', () => {
            const src = assembler(23, 11);
            const dst = assembler(27, 11);
            src.index = 0;
            dst.index = 1;

            const s = createSorterBetween(src, dst, 2011, 41, [src, dst], {
                src: { x: 24, y: 12 },
                dst: { x: 26, y: 12 },
            })!;
            expect(s).not.toBeNull();
            expect(s.inputFromSlot).toBe(3);
            expect(s.outputToSlot).toBe(11);
            expect(s.yaw[0]).toBe(90);
            expect((s.parameters as { length: number }).length).toBe(2);
        });

        test('default (no anchor) picks the middle slot row', () => {
            const src = assembler(27, 11);
            const dst = assembler(23, 11);
            src.index = 0;
            dst.index = 1;

            const s = createSorterBetween(src, dst, 2011, 41, [src, dst])!;
            expect(s).not.toBeNull();
            expect([4, 10]).toContain(s.inputFromSlot);
            expect([4, 10]).toContain(s.outputToSlot);
        });
    });

    describe('axis and cell rules', () => {
        test('axis comes from the dominant cell delta (not the exact center line)', () => {
            // Δ = (-2, +1)：主轴 -x，斜向偏差由 slot 横向坐标吸收
            const asm = assembler(13, 11);
            const dst = belt(11, 12, 180);
            asm.index = 0;
            dst.index = 1;
            const s = createSorterBetween(asm, dst, 2011, 41, [asm, dst])!;
            expect(s).not.toBeNull();
            expect(s.yaw[0]).toBe(270);
        });

        test('45° diagonal (equal cell deltas) is rejected', () => {
            const asm = assembler(13, 11);
            const dst = belt(11, 13, 180);
            asm.index = 0;
            dst.index = 1;
            expect(createSorterBetween(asm, dst, 2011, 41, [asm, dst])).toBeNull();
        });

        test('axis parallel to the belt: endpoint falls back to the belt cell center', () => {
            // 皮带 (0,0) yaw=90（向 +x 走）正对建筑 (3,0)：轴线与皮带方向平行
            const src = belt(0, 0, 90);
            const dst = assembler(3, 0);
            src.index = 0;
            dst.index = 1;

            const s = createSorterBetween(src, dst, 2011, 41, [src, dst])!;
            expect(s).not.toBeNull();
            expect(s.localOffset[0].x).toBeCloseTo(0, 6);
            expect(s.localOffset[0].y).toBeCloseTo(0, 6);
            expect(s.inputOffset).toBe(0);
            expect(s.outputToSlot).toBe(10);          // 建筑 -x 面中间 slot
            expect((s.parameters as { length: number }).length).toBe(2);
        });

        test('building↔building with mismatched lateral slot rows is rejected', () => {
            // 沿 +y 相隔 3 格、横向错开 2 格：主轴 +y，但两端 slot 横向差 ≈2 格
            // （游戏里分拣器只沿主轴架接，横向差这么大的连线必然是斜向）→ 拒绝
            const src = assembler(0, 0);
            const dst = assembler(2, 3);
            src.index = 0;
            dst.index = 1;
            expect(createSorterBetween(src, dst, 2011, 65, [src, dst])).toBeNull();
        });

        test('lateral offset is measured in a single global frame', () => {
            // 轴向隔 3 格、横向错 2 格：两端 slot 横向差 ≈0.41 格（超出容差）→ 拒绝
            const a = assembler(0, 0);
            const b = assembler(3, 2);
            a.index = 0; b.index = 1;
            expect(createSorterBetween(a, b, 2011, 65, [a, b])).toBeNull();

            // 横向错 1 格：算法选到对侧中间 slot，偏差压到 ≈0.20 格 → 允许（轻微斜置）
            const c = assembler(0, 0);
            const d = assembler(3, 1);
            c.index = 0; d.index = 1;
            const s = createSorterBetween(c, d, 2011, 65, [c, d]);
            expect(s).not.toBeNull();
            expect(s!.yaw[0]).toBe(90);
            expect(s!.inputFromSlot).toBe(3);    // +x 面偏上 slot
            expect(s!.outputToSlot).toBe(10);    // -x 面中间 slot
        });
    });

    describe('v2ExtraPose 首字段（根端为建筑时游戏固定值）', () => {
        test('building root → ≈0.20118；belt root → 0', () => {
            const asm = assembler(13, 11);
            const dst = belt(11, 12, 180);
            asm.index = 0; dst.index = 1;
            const fromBuilding = createSorterBetween(asm, dst, 2011, 41, [asm, dst])!;
            expect(fromBuilding.v2ExtraPose![0]).toBeCloseTo(0.20118311047554016, 6);

            const beltSrc = belt(4, 11, 180);
            const target = assembler(2, 11);
            beltSrc.index = 0; target.index = 1;
            const fromBelt = createSorterBetween(beltSrc, target, 2011, 41, [beltSrc, target])!;
            expect(fromBelt.v2ExtraPose![0]).toBe(0);
        });
    });
});

/**
 * 以下用例取自 tests/tools/分拣器示例.txt（游戏 0.10.35，长皮带线 + 12 种建筑 ×
 * 输入/输出两个方向 + 长度 1/2）。它同时验证：
 * - 方建筑（电弧熔炉 3.2×3.2）的角 slot 面归属：从 -y 接入要挂 slot 8 而不是中间的 slot 7
 * - 大建筑（火力发电厂）slot 表在早期版本里整体转了 180°（现已修正）
 * - 只标定了一部分 slot 的建筑（原油精炼厂）仍能连对已标定的 slot
 */
describe('blueprint-calibrated rules (分拣器示例.txt)', () => {
    test('square building: -y side sorter picks the corner slot 8 (#88)', () => {
        const beltSrc = makeBuildingAt(2001, 35, 16, 4, 90);
        const smelter = makeBuildingAt(2302, 62, 17, 6, 0);
        beltSrc.index = 0; smelter.index = 1;

        const s = createSorterBetween(beltSrc, smelter, 2011, 41, [beltSrc, smelter], {
            src: { x: 16, y: 4 }, dst: { x: 16, y: 5 },
        })!;
        expect(s).not.toBeNull();
        expect(s.outputToSlot).toBe(8);          // 角 slot（不是 -y 面中间的 7）
        expect(s.inputFromSlot).toBe(-1);
        expect(s.inputOffset).toBe(4);           // main = 0.199 → floor(0.199×21) = 4
        expect(s.localOffset[1].x).toBeCloseTo(16.199, 3);
        expect(s.localOffset[1].y).toBeCloseTo(5.205, 3);
        expect((s.parameters as { length: number }).length).toBe(1);
    });

    test('thermal power plant slot table is no longer rotated 180° (#80/#81)', () => {
        // 皮带 (2,4) yaw=90 → 发电厂 (2,6) yaw=90：slot 3 在 -y 侧（旧表会算到 +y 侧）
        const beltSrc = makeBuildingAt(2001, 35, 2, 4, 90);
        const plant = makeBuildingAt(2204, 54, 2, 6, 90);
        beltSrc.index = 0; plant.index = 1;

        const s = createSorterBetween(beltSrc, plant, 2011, 41, [beltSrc, plant], {
            src: { x: 2, y: 4 }, dst: { x: 2, y: 5 },
        })!;
        expect(s).not.toBeNull();
        expect(s.outputToSlot).toBe(3);
        expect(s.localOffset[1].x).toBeCloseTo(2.0, 3);
        expect(s.localOffset[1].y).toBeCloseTo(5.308, 3);
        expect((s.parameters as { length: number }).length).toBe(1);

        // 反向（发电厂输出到皮带）：slot 4
        const plantSrc = makeBuildingAt(2204, 54, 2, 6, 90);
        const beltDst = makeBuildingAt(2001, 35, 3, 4, 90);
        plantSrc.index = 0; beltDst.index = 1;
        const back = createSorterBetween(plantSrc, beltDst, 2011, 41, [plantSrc, beltDst], {
            src: { x: 3, y: 5 }, dst: { x: 3, y: 4 },
        })!;
        expect(back).not.toBeNull();
        expect(back.inputFromSlot).toBe(4);
        expect(back.outputOffset).toBe(-5);
        expect((back.parameters as { length: number }).length).toBe(1);
    });

    test('fusion power station (2211) shares the thermal plant slot layout', () => {
        expect(getBuildingSlots(2211)).toEqual(getBuildingSlots(2204));
    });

    test('partially calibrated building (oil refinery 2308) connects its known slots', () => {
        // slot 0..5 未标定 → null 占位；slot 6/7/8 已标定
        const slots = getBuildingSlots(2308);
        expect(slots[6]).not.toBeNull();
        expect(slots[7]).not.toBeNull();
        expect(slots[0]).toBeNull();

        // #102：皮带 (64,4) → 精炼厂 (64,8)，挂 -y 面中间 slot 7
        const beltSrc = makeBuildingAt(2001, 35, 64, 4, 90);
        const refinery = makeBuildingAt(2308, 63, 64, 8, 0);
        beltSrc.index = 0; refinery.index = 1;
        const s = createSorterBetween(beltSrc, refinery, 2011, 41, [beltSrc, refinery], {
            src: { x: 64, y: 4 }, dst: { x: 64, y: 5 },
        })!;
        expect(s).not.toBeNull();
        expect(s.outputToSlot).toBe(7);
        expect(s.localOffset[1].y).toBeCloseTo(5.138, 3);
        expect((s.parameters as { length: number }).length).toBe(1);

        // #103：精炼厂输出到皮带 (63,4)，挂 -y 面角 slot 6
        const refinerySrc = makeBuildingAt(2308, 63, 64, 8, 0);
        const beltDst = makeBuildingAt(2001, 35, 63, 4, 90);
        refinerySrc.index = 0; beltDst.index = 1;
        const back = createSorterBetween(refinerySrc, beltDst, 2011, 41,
            [refinerySrc, beltDst], { src: { x: 63, y: 5 }, dst: { x: 63, y: 4 } })!;
        expect(back).not.toBeNull();
        expect(back.inputFromSlot).toBe(6);
        expect(back.outputOffset).toBe(4);
        expect((back.parameters as { length: number }).length).toBe(1);
    });

    test('longer connection (length 2) across the belt line (#91/#92)', () => {
        // 皮带 (20,4) → 战场分析基站 (21,0)：长度 2，挂 slot 3
        const beltSrc = makeBuildingAt(2001, 35, 20, 4, 90);
        const base = makeBuildingAt(3009, 453, 21, 0, 180);
        beltSrc.index = 0; base.index = 1;
        const s = createSorterBetween(beltSrc, base, 2011, 41, [beltSrc, base], {
            src: { x: 20, y: 4 }, dst: { x: 20, y: 2 },
        })!;
        expect(s).not.toBeNull();
        expect(s.outputToSlot).toBe(3);
        expect((s.parameters as { length: number }).length).toBe(2);
        expect(s.localOffset[1].x).toBeCloseTo(20.20, 1);
        expect(s.localOffset[1].y).toBeCloseTo(1.83, 1);
    });
});

