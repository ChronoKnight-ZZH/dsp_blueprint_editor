import { BlueprintBuilding } from '@/blueprint/parser';
import { createBuilding } from '@/blueprint/create';
import { createSorterBetween } from '@/blueprint/sorter';
import { isBelt, isInserter } from '@/data/items';
import { getBuildingSlots, findNearestSlot, findNearestFreeSlot } from '@/data/buildingSlots';

describe('buildingSlots', () => {
    test('assembler 2303 has 12 slots', () => {
        const slots = getBuildingSlots(2303);
        expect(slots.length).toBe(12);
    });

    test('unknown building returns empty slots', () => {
        expect(getBuildingSlots(9999)).toEqual([]);
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
    // 火力发电厂 2204（非四条边建筑，5 slot）：
    // slot 0/1/2 在 +x 列（1.686, -0.81/0/0.81），slot 3/4 在 -x 列

    test('no occupancy behaves like findNearestSlot', () => {
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set())).toBe(1);
    });

    test('occupied nearest slot switches to nearest parallel slot', () => {
        // slot 1 被占 → 同侧 +x 列 slot 0/2 等距，稳定排序取小编号 0
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set([1]))).toBe(0);
    });

    test('occupied nearest slot picks closer parallel slot', () => {
        // 点击偏下 (1.68, -0.5)：slot 0 被占 → 切同列最近的 slot 1
        expect(findNearestFreeSlot(2204, 1.68, -0.5, new Set([0]))).toBe(1);
    });

    test('does not switch to non-parallel group', () => {
        // slot 1（+x 列）被占，slot 3（-x 列）空闲但方向不平行 → 仍选 +x 列
        const r = findNearestFreeSlot(2204, 1.68, 0, new Set([1]));
        expect([0, 2]).toContain(r);
    });

    test('returns -1 when whole parallel group occupied', () => {
        expect(findNearestFreeSlot(2204, 1.68, 0, new Set([0, 1, 2]))).toBe(-1);
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
        expect(sorter.outputOffset).toBeGreaterThanOrEqual(-5);
        expect(sorter.outputOffset).toBeLessThanOrEqual(4);
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
        expect(sorter.inputOffset).toBeGreaterThanOrEqual(-5);
        expect(sorter.inputOffset).toBeLessThanOrEqual(4);
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
        expect(sorter.inputOffset).toBeGreaterThanOrEqual(-5);
        expect(sorter.inputOffset).toBeLessThanOrEqual(4);
        expect(sorter.outputOffset).toBeGreaterThanOrEqual(-5);
        expect(sorter.outputOffset).toBeLessThanOrEqual(4);
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

            // 构造一个虚拟分拣器占满 belt1 的全部 13 档 offset
            const blocker = createBuilding(2011, 0, { x: 0, y: 0 }, 0);
            blocker.index = 99;
            const placed: BlueprintBuilding[] = [belt1, belt2];
            for (const o of [-10, -8, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 7, 10]) {
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
