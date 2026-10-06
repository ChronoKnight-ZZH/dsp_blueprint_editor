import * as fs from 'fs';
import { createEmptyBlueprint, CreateBuildingCommand } from '@/blueprint/create';
import { buildBeltLine, CreateBeltLineCommand } from '@/blueprint/beltLine';
import { createSorterBetween } from '@/blueprint/sorter';
import { toStr, fromStr } from '@/blueprint/parser';
import { normalizeBlueprintAreas } from '@/blueprint/area';

/**
 * 工具"新建蓝图 → 铺传送带 → 加分拣器 → 保存"链路的导出回归测试。
 *
 * 背景（bug 复现）：工具生成的分拣器在游戏里"角度偏移 / 报错"。原因是导出必经的
 * `normalizeBlueprintAreas` 把 `v2ExtraPose` 置成 undefined，导出时退化成
 * `[0, tip…, 0, 0, yaw1]`——`pose[4]` 应为分拣器朝向 `yaw[0]`，写成 0 后游戏把
 * 分拣器摆成 0°（真实蓝图实测：游戏自己写的 pose[4] 恒等于 yaw[0]）。
 */
describe('created blueprint export (分拣器姿态)', () => {
    /** 上排向东、下排向西，中间用分拣器跨排连接（与用户样本同构） */
    function buildSorterBlueprint(len: number) {
        const bp = createEmptyBlueprint();
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 2, y: 4 }, { x: 6, y: 4 }, 90, 'latFirst')).do(bp);
        new CreateBeltLineCommand(
            buildBeltLine(2001, 35, { x: 6, y: 1 }, { x: 2, y: 1 }, 270, 'latFirst')).do(bp);

        const find = (x: number, y: number) =>
            bp.buildings.find(b => b.localOffset[0].x === x && b.localOffset[0].y === y)!;
        const sorter = createSorterBetween(find(3, 4), find(3, 1), 2011, 41, bp.buildings, {
            src: { x: 3, y: 4 }, dst: { x: 3, y: 1 },
        })!;
        (sorter.parameters as { length: number }).length = len;
        new CreateBuildingCommand(sorter).do(bp);
        return { bp, sorter };
    }

    test('导出再解析后 pose[4] 仍是 yaw[0]（不能退化成 0）', () => {
        const { bp } = buildSorterBlueprint(3);
        const parsed = fromStr(toStr(bp));
        const sorters = parsed.buildings.filter(b => b.itemId === 2011);
        expect(sorters.length).toBe(1);
        const s = sorters[0];
        expect(s.yaw[0]).toBe(180);
        expect(s.v2ExtraPose).toBeDefined();
        expect(s.v2ExtraPose![4]).toBeCloseTo(180, 5);   // 基准朝向
        expect(s.v2ExtraPose![6]).toBeCloseTo(s.yaw[1], 5);
        // 尖端坐标仍与 localOffset[1] 一致
        expect(s.v2ExtraPose![1]).toBeCloseTo(s.localOffset[1].x, 5);
        expect(s.v2ExtraPose![2]).toBeCloseTo(s.localOffset[1].y, 5);
        expect(s.v2ExtraPose![3]).toBeCloseTo(s.localOffset[1].z, 5);
    });

    test('四个朝向的 pose[4] 都与 yaw[0] 一致', () => {
        /** 在 p 处放一条与分拣器垂直的 3 格传送带（vertical=true 时沿 y 走向） */
        const beltAt = (bp: ReturnType<typeof createEmptyBlueprint>, p: { x: number, y: number }, vertical: boolean) => {
            const a = vertical ? { x: p.x, y: p.y - 1 } : { x: p.x - 1, y: p.y };
            const b = vertical ? { x: p.x, y: p.y + 1 } : { x: p.x + 1, y: p.y };
            new CreateBeltLineCommand(buildBeltLine(2001, 35, a, b, 90, 'latFirst')).do(bp);
        };
        const cases: [number, number, number][] = [
            [0, 3, 180],    // 源在上、目标在下 → 朝向 -y
            [0, -3, 0],     // 源在下、目标在上 → 朝向 +y
            [3, 0, 270],    // 源在右、目标在左 → 朝向 -x
            [-3, 0, 90],    // 源在左、目标在右 → 朝向 +x
        ];
        for (const [dx, dy, expectYaw] of cases) {
            const bp = createEmptyBlueprint();
            const srcPos = { x: 4 + dx, y: 4 + dy };
            const dstPos = { x: 4, y: 4 };
            const vertical = dy === 0;          // 分拣器沿 x 时传送带沿 y
            beltAt(bp, srcPos, vertical);
            beltAt(bp, dstPos, vertical);
            const src = bp.buildings.find(x => x.localOffset[0].x === srcPos.x && x.localOffset[0].y === srcPos.y)!;
            const dst = bp.buildings.find(x => x.localOffset[0].x === dstPos.x && x.localOffset[0].y === dstPos.y)!;
            const sorter = createSorterBetween(src, dst, 2011, 41, bp.buildings);
            expect(sorter).not.toBeNull();
            expect(sorter!.yaw[0]).toBe(expectYaw);
            new CreateBuildingCommand(sorter!).do(bp);
            const parsed = fromStr(toStr(bp));
            const s = parsed.buildings.find(x => x.itemId === 2011)!;
            expect(s.v2ExtraPose![4]).toBeCloseTo(expectYaw, 5);
        }
    });

    test('normalizeBlueprintAreas 平移尖端但保留姿态角，且不修改入参', () => {
        const { bp, sorter } = buildSorterBlueprint(3);
        const before = sorter.v2ExtraPose!.slice();
        const normalized = normalizeBlueprintAreas(bp);
        const s = normalized.buildings.find(b => b.itemId === 2011)!;
        expect(s.v2ExtraPose![4]).toBeCloseTo(180, 5);
        expect(s.v2ExtraPose![5]).toBeCloseTo(before[5], 5);
        // 尖端随 localOffset[1] 平移
        expect(s.v2ExtraPose![1]).toBeCloseTo(s.localOffset[1].x, 5);
        expect(s.v2ExtraPose![2]).toBeCloseTo(s.localOffset[1].y, 5);
        expect(s.v2ExtraPose![3]).toBeCloseTo(s.localOffset[1].z, 5);
        // 入参未被修改
        expect(sorter.v2ExtraPose).toEqual(before);
        expect(sorter.localOffset[0].y).toBe(4);
    });

    test('缺失 v2ExtraPose 时导出兜底也写 yaw[0]（不再写 0）', () => {
        const { bp, sorter } = buildSorterBlueprint(3);
        sorter.v2ExtraPose = undefined;
        const parsed = fromStr(toStr(bp));
        const s = parsed.buildings.find(b => b.itemId === 2011)!;
        expect(s.v2ExtraPose![4]).toBeCloseTo(s.yaw[0], 5);
    });
});

/**
 * 用户实测坏文件（工具早期版本导出：pose[4] 被写成 0，游戏里分拣器角度偏移）。
 * 导入时按 yaw[0]/tilt 自愈，使"打开旧文件 → 保存"即可修好。
 */
describe('导入早期工具导出的坏蓝图（分拣器姿态自愈）', () => {
    const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

    test('导入后 pose[4] 与 yaw[0] 一致，再导出仍一致', () => {
        const text = fs.readFileSync(
            'tests/unit/blueprint/fixtures/tool_export_pose_broken.txt', 'utf-8').trim();
        const bp = fromStr(text);
        const sorters = bp.buildings.filter(b => b.itemId === 2011);
        expect(sorters.length).toBe(3);
        for (const s of sorters) {
            expect(s.v2ExtraPose).toBeDefined();
            expect(angleDiff(s.v2ExtraPose![4], s.yaw[0])).toBeLessThan(0.001);
            // 尖端与位置字段仍自洽
            expect(s.v2ExtraPose![1]).toBeCloseTo(s.localOffset[1].x, 5);
            expect(s.v2ExtraPose![2]).toBeCloseTo(s.localOffset[1].y, 5);
        }

        const again = fromStr(toStr(bp));
        const againSorters = again.buildings.filter(b => b.itemId === 2011);
        expect(againSorters.length).toBe(3);
        for (const s of againSorters)
            expect(angleDiff(s.v2ExtraPose![4], s.yaw[0])).toBeLessThan(0.001);
    });
});
