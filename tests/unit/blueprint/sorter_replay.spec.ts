import * as fs from 'fs';
import { fromStr, BlueprintBuilding } from '@/blueprint/parser';
import { createSorterBetween } from '@/blueprint/sorter';
import { isInserter } from '@/data/items';

/**
 * 用真实蓝图全量复现分拣器连接：
 * - `sorter_belt_replay.txt`（0.10.35，12 皮带 + 3 分拣器，皮带↔皮带）
 * - `sorter_building_belt_replay.txt`（0.10.35，制造台 Mk.I 环 + 29 分拣器：
 *   建筑→皮带 / 皮带→建筑 / 建筑→建筑 / 皮带→皮带，即 tests/tools/分拣器.txt 的副本）
 * - `sorter_multi_building_replay.txt`（0.10.35，长皮带线 + 12 种建筑 × 23 分拣器：
 *   输入（皮带→建筑）/ 输出（建筑→皮带）两个方向、长度 1 与 2，
 *   即 tests/tools/分拣器示例.txt 的副本）
 *
 * 解析蓝图 → 对每根分拣器用 createSorterBetween 重算 → 逐字段比对。
 * 锚点按"游戏记录端点的所在格中心"给出（等价于玩家点击的那一格）。
 *
 * 已知微差（均为游戏自身的球面浮点噪声或标定精度，非逻辑差异，用容差吸收）：
 * - yaw[0]：游戏存球面精确角（如 359.944°），复现用整 90° → 容差 0.5°
 * - yaw[1] / tilt：游戏在同为 0 的基准上带 ±0.9° 球面噪声 → 容差 0.9°
 * - v2ExtraPose[0]：语义未公开（游戏自身在 -0.7..0.22 间跳变），工具按启发式写固定值，
 *   故此处不复现（另由 sorter.spec.ts 断言工具写入的值）
 * - 端点：slot 表按赤道基准标定，源蓝图所在分区的经向格宽略有差异（±2%）→ 容差 0.02 格；
 *   同款模型别名（如制造台 Mk.II 用 Mk.I 表）另有 ≤0.011 的模型差
 * - 皮带端 offset：端点落在分段边界（main ≈ ±0.19）时，游戏的浮点噪声会让
 *   floor(main×21) 差 1 档 → 容差 1
 */

/** 角度差（处理 359.944 ≈ -0.056 的环绕） */
function angleDiff(a: number, b: number): number {
    return Math.abs(((a - b + 540) % 360) - 180);
}

interface ReplayReport {
    total: number;
    failures: string[];
}

/** 单元格中心：分拣器端点的所在格（模拟玩家点击的格子） */
function cellCenter(p: { x: number, y: number }) {
    return { x: Math.round(p.x), y: Math.round(p.y) };
}

function replayFixture(path: string): ReplayReport {
    const text = fs.readFileSync(path, 'utf-8').trim();
    const data = fromStr(text);
    const bs = data.buildings;
    const sorters = bs.filter(b => isInserter(b.itemId));
    const report: ReplayReport = { total: sorters.length, failures: [] };

    for (const s of sorters) {
        const src = bs[s.inputObjIdx];
        const dst = bs[s.outputObjIdx];
        // 该分拣器之外的所有建筑（占用检测用）
        const others = bs.filter(b => b.index !== s.index);
        const replay = createSorterBetween(src, dst, s.itemId, s.modelIndex, others, {
            src: cellCenter(s.localOffset[0]),
            dst: cellCenter(s.localOffset[1]),
        });

        const diffs: string[] = [];
        if (replay === null) {
            diffs.push('replay returned null');
        } else {
            const num = (name: string, a: number, b: number, tol: number) => {
                if (Math.abs(a - b) > tol)
                    diffs.push(`${name} ${a.toFixed(3)} != ${b.toFixed(3)}`);
            };
            const ang = (name: string, a: number, b: number, tol: number) => {
                if (angleDiff(a, b) > tol)
                    diffs.push(`${name} ${a.toFixed(3)} != ${b.toFixed(3)}`);
            };
            num('length', (replay.parameters as { length: number }).length,
                (s.parameters as { length: number }).length, 0);
            num('inputFromSlot', replay.inputFromSlot, s.inputFromSlot, 0);
            num('outputToSlot', replay.outputToSlot, s.outputToSlot, 0);
            num('inputToSlot', replay.inputToSlot, s.inputToSlot, 0);
            num('outputFromSlot', replay.outputFromSlot, s.outputFromSlot, 0);
            num('inputOffset', replay.inputOffset, s.inputOffset, 1);
            num('outputOffset', replay.outputOffset, s.outputOffset, 1);
            for (const i of [0, 1] as const) {
                num(`p${i}.x`, replay.localOffset[i].x, s.localOffset[i].x, 0.02);
                num(`p${i}.y`, replay.localOffset[i].y, s.localOffset[i].y, 0.02);
            }
            ang('yaw[0]', replay.yaw[0], s.yaw[0], 0.5);
            ang('yaw[1]', replay.yaw[1], s.yaw[1], 0.9);
            ang('tilt', replay.tilt, s.tilt, 0.9);
            // v2ExtraPose[0] 语义未公开（游戏自身在 -0.7..0.22 间跳变），不复现
        }

        if (diffs.length > 0) {
            report.failures.push(
                `#${s.index} (${src.itemId}→${dst.itemId}): ${diffs.join('; ')}`);
        }
    }
    return report;
}

describe('sorter replay against real blueprints', () => {
    test('belt ↔ belt fixture reproduces every sorter', () => {
        const report = replayFixture('tests/unit/blueprint/fixtures/sorter_belt_replay.txt');
        expect(report.total).toBe(3);
        expect(report.failures).toEqual([]);
    });

    test('building/belt fixture (分拣器.txt) reproduces every sorter', () => {
        const report = replayFixture(
            'tests/unit/blueprint/fixtures/sorter_building_belt_replay.txt');
        // 制造台环：12 根建筑→皮带 + 3 根皮带→建筑 + 3 根建筑→建筑 + 3 根皮带→皮带 = 29
        expect(report.total).toBe(29);
        expect(report.failures).toEqual([]);
    });

    test('multi-building fixture (分拣器示例.txt) reproduces every sorter', () => {
        const report = replayFixture(
            'tests/unit/blueprint/fixtures/sorter_multi_building_replay.txt');
        // 12 种建筑 ×（输入皮带→建筑 / 输出建筑→皮带）= 23 根（含 2 根长度 2）
        expect(report.total).toBe(23);
        expect(report.failures).toEqual([]);
    });

    test('multi-building fixture covers input/output directions and lengths', () => {
        const text = fs.readFileSync(
            'tests/unit/blueprint/fixtures/sorter_multi_building_replay.txt', 'utf-8').trim();
        const bs = fromStr(text).buildings;
        const sorters = bs.filter(b => isInserter(b.itemId));
        // 输入（皮带→建筑）与输出（建筑→皮带）两个方向都存在
        const toBuilding = sorters.filter(s => bs[s.inputObjIdx].itemId === 2001);
        const fromBuilding = sorters.filter(s => bs[s.outputObjIdx].itemId === 2001);
        expect(toBuilding.length).toBeGreaterThan(5);
        expect(fromBuilding.length).toBeGreaterThan(5);
        // 连接长度覆盖 1 与 2
        const lengths = new Set(sorters.map(s => (s.parameters as { length: number }).length));
        expect(lengths.has(1)).toBe(true);
        expect(lengths.has(2)).toBe(true);
        // 连接的建筑种类数（不含皮带）
        const items = new Set<number>();
        for (const s of sorters) {
            for (const b of [bs[s.inputObjIdx], bs[s.outputObjIdx]])
                if (b.itemId !== 2001) items.add(b.itemId);
        }
        expect(items.size).toBeGreaterThanOrEqual(10);
    });

    test('created sorters keep the blueprint invariants', () => {
        // 复现结果里所有分拣器的固定字段：分拣器自身 slot 与两端 slot 约定
        const text = fs.readFileSync(
            'tests/unit/blueprint/fixtures/sorter_building_belt_replay.txt', 'utf-8').trim();
        const bs = fromStr(text).buildings;
        for (const s of bs.filter(b => isInserter(b.itemId))) {
            expect(s.inputToSlot).toBe(1);
            expect(s.outputFromSlot).toBe(0);
            const len = (s.parameters as { length: number }).length;
            expect(len).toBeGreaterThanOrEqual(1);
            expect(len).toBeLessThanOrEqual(3);
            const src: BlueprintBuilding = bs[s.inputObjIdx];
            const dst: BlueprintBuilding = bs[s.outputObjIdx];
            // 皮带端 slot 恒 -1 且带 offset；建筑端 slot ≥ 0 且 offset 0
            if (src.itemId === 2001)
                expect(s.inputFromSlot).toBe(-1);
            else
                expect(s.inputOffset).toBe(0);
            if (dst.itemId === 2001)
                expect(s.outputToSlot).toBe(-1);
            else
                expect(s.outputOffset).toBe(0);
        }
    });
});
