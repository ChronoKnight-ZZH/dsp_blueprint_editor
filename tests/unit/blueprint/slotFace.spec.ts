import * as fs from 'fs';
import { BlueprintBuilding, fromStr } from '@/blueprint/parser';
import {
    SLOT_MARKER_FACE_INSET,
    faceSlotIndices,
    getBuildingSlots,
    slotDisplayPos,
    slotFaceOf,
} from '@/data/buildingSlots';
import { createSorterBetween } from '@/blueprint/sorter';
import { isInserter } from '@/data/items';

/**
 * slot 面分组（"四边各三个"）与角 slot 归属的回归测试。
 *
 * 背景（bug）：方建筑（电弧熔炉 2302 / 小型储物仓 2101）每个面的**角 slot 与相邻面的
 * 边界 slot 在蓝图数据里坐标逐位相同**（0.10.35 实测），游戏靠"分拣器从哪个面离开"
 * 区分这两个编号（北面出 → slot 2，东面出 → slot 3）。旧实现用几何极值分组，会把角
 * slot 同时算进两个相邻面 → 每个面 5 个候选、占用切换时跳到相邻面的错误编号，
 * 实际只用到 8 个 slot（用户反馈"接口有 12 个、四边各三个，不是 8 个"）。
 */

/** 四个面方向（建筑 yaw=0 局部系） */
const FACE = {
    N: { x: 0, y: 1 },
    E: { x: 1, y: 0 },
    S: { x: 0, y: -1 },
    W: { x: -1, y: 0 },
};
const FACES = [FACE.N, FACE.E, FACE.S, FACE.W];

describe('slot 面分组', () => {
    // 12 slot 环建筑（含同款模型别名）：储物仓 / 电弧熔炉 / 制造台 / 矩阵研究站
    for (const itemId of [2101, 2102, 2302, 2303, 2304, 2305, 2318, 2901, 2902]) {
        test(`itemId ${itemId}：每面 3 个，四面不重不漏覆盖 0-11`, () => {
            const perFace = FACES.map((d) => faceSlotIndices(itemId, d));
            for (const f of perFace) expect(f.length).toBe(3);
            const all = perFace.flat().sort((a, b) => a - b);
            expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        });
    }

    test('电弧熔炉角 slot 归属唯一（+x 面只有 3/4/5）', () => {
        expect(faceSlotIndices(2302, FACE.N)).toEqual([0, 1, 2]);
        expect(faceSlotIndices(2302, FACE.E)).toEqual([3, 4, 5]);
        expect(faceSlotIndices(2302, FACE.S)).toEqual([6, 7, 8]);
        expect(faceSlotIndices(2302, FACE.W)).toEqual([9, 10, 11]);
    });

    test('小型储物仓面分组与电弧熔炉相同', () => {
        expect(faceSlotIndices(2101, FACE.E)).toEqual([3, 4, 5]);
        expect(faceSlotIndices(2101, FACE.W)).toEqual([9, 10, 11]);
    });

    test('矩阵研究站编号绕向相反（+x 面是 9/10/11）', () => {
        expect(faceSlotIndices(2901, FACE.E)).toEqual([9, 10, 11]);
        expect(faceSlotIndices(2901, FACE.W)).toEqual([3, 4, 5]);
    });

    test('slotFaceOf 给出每个 slot 的唯一面', () => {
        expect(slotFaceOf(2302, 0)).toBe(0);
        expect(slotFaceOf(2302, 3)).toBe(1);
        expect(slotFaceOf(2302, 7)).toBe(2);
        expect(slotFaceOf(2302, 11)).toBe(3);
        expect(slotFaceOf(2901, 3)).toBe(3);
        // 无面分组的建筑（火力发电厂 2204）返回 -1
        expect(slotFaceOf(2204, 0)).toBe(-1);
    });
});

describe('slot 标记显示坐标', () => {
    test('真实坐标重合的角 slot 在显示时被分开，12 个点两两可分辨', () => {
        // 电弧熔炉：slot 2/3、5/6、8/9、11/0 真实坐标逐位相同
        for (const [a, b] of [
            [2, 3],
            [5, 6],
            [8, 9],
            [11, 0],
        ]) {
            const ra = getBuildingSlots(2302)[a]!;
            const rb = getBuildingSlots(2302)[b]!;
            // 表里的成对 slot 来自两份蓝图的反推值，残差 ≤ 0.0001（同一物理点）
            expect(ra.x).toBeCloseTo(rb.x, 3);
            expect(ra.y).toBeCloseTo(rb.y, 3);
            const da = slotDisplayPos(2302, a)!;
            const db = slotDisplayPos(2302, b)!;
            expect(Math.hypot(da.x - db.x, da.y - db.y)).toBeGreaterThan(
                SLOT_MARKER_FACE_INSET * 0.9
            );
        }
        const pts = [];
        for (let i = 0; i < 12; i++) pts.push(slotDisplayPos(2302, i)!);
        for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++)
                expect(
                    Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
                ).toBeGreaterThan(0.1);
    });

    test('中间 slot 位置不变；未标定 slot 返回 null', () => {
        // 中间 slot 的横向坐标 ≈ 0（沿面收缩量可忽略）
        const mid = slotDisplayPos(2302, 4)!;
        expect(mid.x).toBeCloseTo(getBuildingSlots(2302)[4]!.x, 4);
        expect(mid.y).toBeCloseTo(0, 3);
        expect(slotDisplayPos(2302, 1)).toEqual(getBuildingSlots(2302)[1]);
        expect(slotDisplayPos(2308, 0)).toBeNull(); // 原油精炼厂未标定 slot
    });
});

describe('游戏蓝图 slot 复现（角 slot 编号）', () => {
    const data = fromStr(
        fs
            .readFileSync(
                'tests/unit/blueprint/fixtures/slot_face_game_sample.txt',
                'utf-8'
            )
            .trim()
    );
    const byIndex = new Map<number, BlueprintBuilding>();
    for (const b of data.buildings) byIndex.set(b.index, b);

    test('工具为每根分拣器选的建筑端 slot 与游戏写死的编号一致', () => {
        const mismatches: string[] = [];
        let checked = 0;
        for (const s of data.buildings) {
            if (!isInserter(s.itemId)) continue;
            for (const [bldIdx, slot] of [
                [s.outputObjIdx, s.outputToSlot],
                [s.inputObjIdx, s.inputFromSlot],
            ] as [number, number][]) {
                const bld = byIndex.get(bldIdx);
                if (!bld || slot < 0) continue;
                // 只检查有显式面分组的建筑（其余建筑的 slot 标定另有任务）
                if (slotFaceOf(bld.itemId, slot) < 0) continue;
                const otherIdx =
                    s.outputObjIdx === bldIdx ? s.inputObjIdx : s.outputObjIdx;
                const other = byIndex.get(otherIdx);
                if (!other) continue;
                const isSrc = s.inputObjIdx === bldIdx;
                const src = isSrc ? bld : other;
                const dst = isSrc ? other : bld;
                const made = createSorterBetween(
                    src,
                    dst,
                    s.itemId,
                    s.modelIndex,
                    [src, dst],
                    { src: s.localOffset[0], dst: s.localOffset[1] }
                );
                if (made === null) {
                    mismatches.push(
                        `${bld.itemId}#${bldIdx} slot${slot}: 工具判定不可放置`
                    );
                    continue;
                }
                checked++;
                const got =
                    made.outputObjIdx === bldIdx
                        ? made.outputToSlot
                        : made.inputFromSlot;
                if (got !== slot)
                    mismatches.push(
                        `${bld.itemId}#${bldIdx}: 游戏 slot ${slot} → 工具 slot ${got}`
                    );
            }
        }
        // 样本是 14 种建筑 × 全部 slot 的分拣器环，面分组建筑贡献 ≥ 24 条
        expect(checked).toBeGreaterThanOrEqual(24);
        expect(mismatches).toEqual([]);
    });
});
