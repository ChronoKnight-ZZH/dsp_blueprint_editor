import * as fs from 'fs';
import { createEmptyBlueprint } from '@/blueprint/create';
import { buildBeltLine, CreateBeltLineCommand } from '@/blueprint/beltLine';
import { fromStr, toStr } from '@/blueprint/parser';

/**
 * 游戏自己保存的样本（tests/unit/blueprint/fixtures/belt_inserter_game_sample.txt
 * = 用户提供的"游戏生成.txt"）：用它把游戏的传送带/分拣器约定固化成断言，
 * 工具输出必须与之一致（曾因 v2ExtraPose[4] 被写成 0 导致游戏里分拣器角度偏移）。
 */
describe('游戏样本约定（传送带 + 分拣器）', () => {
    const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    const bp = fromStr(fs.readFileSync(
        'tests/unit/blueprint/fixtures/belt_inserter_game_sample.txt', 'utf-8').trim());

    test('分拣器 pose[4] ≈ yaw[0]（游戏写法；工具曾退化成 0）', () => {
        const sorters = bp.buildings.filter(b => b.itemId >= 2011 && b.itemId <= 2014);
        expect(sorters.length).toBeGreaterThan(0);
        for (const s of sorters) {
            expect(s.v2ExtraPose).toBeDefined();
            expect(angleDiff(s.v2ExtraPose![4], s.yaw[0])).toBeLessThan(0.5);
            // pose[1..3] 与 localOffset[1] 一致，pose[6] 与 yaw[1] 一致
            expect(s.v2ExtraPose![1]).toBeCloseTo(s.localOffset[1].x, 3);
            expect(s.v2ExtraPose![2]).toBeCloseTo(s.localOffset[1].y, 3);
            expect(s.v2ExtraPose![3]).toBeCloseTo(s.localOffset[1].z, 3);
            expect(s.v2ExtraPose![6]).toBeCloseTo(s.yaw[1], 3);
            // 分拣器自身 slot 约定
            expect(s.inputToSlot).toBe(1);
            expect(s.outputFromSlot).toBe(0);
        }
    });

    test('传送带只通过 outputObjIdx 串联，slot 约定与工具一致', () => {
        const belts = bp.buildings.filter(b => b.itemId >= 2001 && b.itemId <= 2003);
        expect(belts.length).toBeGreaterThan(0);
        for (const b of belts) {
            expect(b.inputObjIdx).toBe(-1);
            expect(b.inputFromSlot).toBe(0);
            expect(b.inputToSlot).toBe(1);
            expect(b.outputFromSlot).toBe(0);
            expect(b.parameters).toBeNull();
            expect([0, 1]).toContain(b.outputToSlot);
            expect(b.outputToSlot).toBe(b.outputObjIdx >= 0 ? 1 : 0);
        }
    });

    test('拐角格 yaw = 进入/离开方向的平分角（45° 斜角）', () => {
        const belts = bp.buildings.filter(b => b.itemId >= 2001 && b.itemId <= 2003);
        const byIndex = new Map(belts.map(b => [b.index, b]));
        const pred = new Map<number, number>();          // 下游 index → 上游 index
        for (const b of belts) {
            if (b.outputObjIdx >= 0)
                pred.set(b.outputObjIdx, b.index);
        }
        const dirYaw = (a: { x: number, y: number }, b: { x: number, y: number }) => {
            // 用 round 后的格坐标求轴向（样本本身带球面浮点噪声）
            const dx = Math.round(b.x) - Math.round(a.x);
            const dy = Math.round(b.y) - Math.round(a.y);
            const rad = Math.PI / 180;
            return (Math.atan2(dx, dy) / rad + 360) % 360;
        };
        let corners = 0;
        for (const b of belts) {
            const p = b.localOffset[0];
            const up = pred.get(b.index);
            const down = b.outputObjIdx >= 0 ? byIndex.get(b.outputObjIdx) : undefined;
            const a = up !== undefined ? byIndex.get(up) : undefined;
            if (!a || !down) continue;                    // 端点格不检查
            const din = dirYaw(a.localOffset[0], p);
            const dout = dirYaw(p, down.localOffset[0]);
            if (Math.abs(din - dout) < 1) continue;        // 直格
            corners++;
            const rad = Math.PI / 180;
            const bx = Math.sin(din * rad) + Math.sin(dout * rad);
            const by = Math.cos(din * rad) + Math.cos(dout * rad);
            const bisector = (Math.atan2(bx, by) / rad + 360) % 360;
            expect(angleDiff(b.yaw[0], bisector)).toBeLessThan(2.5);
        }
        expect(corners).toBeGreaterThan(0);               // 样本里确实有拐角
    });
});

describe('belt line game consistency', () => {
    test('generated belt matches game blueprint format', () => {
        // 创建一条从 (0,0) 到 (10,0) 的传送带（与游戏示例一致）
        const bp = createEmptyBlueprint();
        const belts = buildBeltLine(2001, 35, { x: 0, y: 0 }, { x: 10, y: 0 }, 90, 'latFirst');
        const cmd = new CreateBeltLineCommand(belts);
        cmd.do(bp);

        // 导出并重新解析
        const str = toStr(bp);
        const parsed = fromStr(str);

        const beltBuildings = parsed.buildings.filter(b => b.itemId === 2001);
        expect(beltBuildings.length).toBe(11);

        // 1. 所有传送带 parameters 应为 null（游戏不存储传送带参数）
        for (const b of beltBuildings)
            expect(b.parameters).toBeNull();

        // 2. 所有传送带 inputObjIdx 应为 -1（游戏只通过 outputObjIdx 串联）
        for (const b of beltBuildings)
            expect(b.inputObjIdx).toBe(-1);

        // 3. 所有传送带 inputToSlot 应为 1
        for (const b of beltBuildings)
            expect(b.inputToSlot).toBe(1);

        // 4. outputFromSlot 和 inputFromSlot 全为 0
        for (const b of beltBuildings) {
            expect(b.outputFromSlot).toBe(0);
            expect(b.inputFromSlot).toBe(0);
        }

        // 5. 按 x 坐标排序，验证 outputToSlot 和连接链
        const sortedByX = [...beltBuildings].sort(
            (a, b) => a.localOffset[0].x - b.localOffset[0].x
        );
        const lastBelt = sortedByX[sortedByX.length - 1];
        for (const b of sortedByX) {
            if (b === lastBelt) {
                expect(b.outputToSlot).toBe(0);
                expect(b.outputObjIdx).toBe(-1);
            } else {
                expect(b.outputToSlot).toBe(1);
            }
        }

        // 6. 连接链正确：每条传送带 output 指向下一条
        for (let i = 0; i < sortedByX.length - 1; i++)
            expect(sortedByX[i].outputObjIdx).toBe(sortedByX[i + 1].index);
    });

    /** 取 (x,y) 格上的传送带 */
    const at = (bp: ReturnType<typeof createEmptyBlueprint>, x: number, y: number) =>
        bp.buildings.find(b => b.localOffset[0].x === x && b.localOffset[0].y === y);

    test('拐角格 yaw = 进入/离开方向的平分角（与游戏一致）', () => {
        // 东进南出 → 135°；南进西出 → 225°（游戏真实蓝图为 136.5 / 223.6）
        const bp = createEmptyBlueprint();
        // 一次拖拽：(2,4) → (6,3)：先向东到 (6,4)，再向南一格
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 3 }, 90, 'latFirst')).do(bp);

        expect(at(bp, 5, 4)!.yaw[0]).toBe(90);    // 直格：向东
        expect(at(bp, 6, 4)!.yaw[0]).toBe(135);   // 拐角：东进南出
        expect(at(bp, 6, 3)!.yaw[0]).toBe(180);   // 末格：延续向南

        // 再向西接一段，接缝格 (6,3) 变成"南进西出"→ 225°
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 6, y: 3 }, { x: 3, y: 3 }, 270, 'latFirst')).do(bp);
        expect(at(bp, 6, 3)!.yaw[0]).toBe(225);
        expect(at(bp, 5, 3)!.yaw[0]).toBe(270);
    });

    test('多次拖拽在接缝处重叠时不产生重复格，并接成一条链', () => {
        const bp = createEmptyBlueprint();
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 3 }, 90, 'latFirst')).do(bp);
        const firstCount = bp.buildings.length;
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 6, y: 3 }, { x: 3, y: 3 }, 270, 'latFirst')).do(bp);

        const belts = bp.buildings.filter(b => b.itemId === 2001);
        const cells = new Set(belts.map(b => `${b.localOffset[0].x},${b.localOffset[0].y}`));
        expect(cells.size).toBe(belts.length);          // 无重复格
        expect(belts.length).toBe(firstCount + 3);      // 第二段只新增 3 格（接缝格复用）

        // 链完整：(2,4)→(3,4)→…→(6,3)→(5,3)→(4,3)→(3,3)，末格 output=-1
        for (const b of belts) {
            if (b.localOffset[0].x === 3 && b.localOffset[0].y === 3) {
                expect(b.outputObjIdx).toBe(-1);
                expect(b.outputToSlot).toBe(0);
                continue;
            }
            expect(b.outputObjIdx).toBeGreaterThanOrEqual(0);
            expect(b.outputToSlot).toBe(1);
        }
        // 导出后依然无重复格
        const parsed = fromStr(toStr(bp));
        const parsedBelts = parsed.buildings.filter(b => b.itemId === 2001);
        expect(new Set(parsedBelts.map(b => `${b.localOffset[0].x},${b.localOffset[0].y}`)).size)
            .toBe(parsedBelts.length);
    });

    test('复用接缝格后撤销会恢复原 yaw 并移除新增格', () => {
        const bp = createEmptyBlueprint();
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 3 }, 90, 'latFirst')).do(bp);
        const seam = at(bp, 6, 3)!;
        const before = { yaw: seam.yaw[0], count: bp.buildings.length };

        const cmd = new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 6, y: 3 }, { x: 3, y: 3 }, 270, 'latFirst'));
        cmd.do(bp);
        expect(at(bp, 6, 3)!.yaw[0]).toBe(225);
        cmd.undo(bp);

        expect(bp.buildings.length).toBe(before.count);
        expect(at(bp, 6, 3)!.yaw[0]).toBe(before.yaw);
    });

    test('画到已有线路中间时在冲突前截断，不改动老线路（避免两个上游）', () => {
        const bp = createEmptyBlueprint();
        // 一条向东的干线 (1,4)…(6,4)
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 1, y: 4 }, { x: 6, y: 4 }, 90, 'latFirst')).do(bp);
        const before = bp.buildings.map(b => ({ index: b.index, yaw: b.yaw[0], out: b.outputObjIdx }));

        // 从南边画一条支线，终点落在干线中间格 (4,4)（该格已有下游）→ 在冲突前截断
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 4, y: 2 }, { x: 4, y: 4 }, 0, 'latFirst')).do(bp);

        // 老线路（6 格）逐字段不变；新增的只是前缀 (4,2)→(4,3)，且末格正常终结
        for (const old of before) {
            const b = bp.buildings.find(x => x.index === old.index)!;
            expect(b.yaw[0]).toBe(old.yaw);
            expect(b.outputObjIdx).toBe(old.out);
        }
        expect(bp.buildings.length).toBe(before.length + 2);
        expect(at(bp, 4, 2)!.outputObjIdx).toBe(at(bp, 4, 3)!.index);
        expect(at(bp, 4, 3)!.outputObjIdx).toBe(-1);
        expect(at(bp, 4, 3)!.outputToSlot).toBe(0);
    });
});
