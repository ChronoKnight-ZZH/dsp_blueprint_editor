import * as fs from 'fs';
import { fromStr, BlueprintBuilding } from '@/blueprint/parser';
import { createSorterBetween } from '@/blueprint/sorter';
import { isInserter, isBelt } from '@/data/items';

/**
 * 用真实蓝图（0.10.35，12 皮带 + 3 分拣器，皮带↔皮带）做全量复现验证。
 * 解析蓝图 → 对每个分拣器用 createSorterBetween 重算 → 逐字段比对。
 *
 * 已知微差（功能等价）：
 * - yaw：游戏存球面浮点精确值（如 180.044°），复现用整 90° → 容差 0.5°
 * - 皮带端 offset：蓝图记录玩家点击的原始微偏（~0.0002 格），复现端点在中心
 *   → mainOffset 符号可能差 1 档（0 vs -1）→ 容差 1
 */
test('replay blueprint: reproduce sorter params via createSorterBetween', () => {
    const text = fs.readFileSync(
        'tests/unit/blueprint/fixtures/sorter_belt_replay.txt', 'utf-8',
    ).trim();
    const data = fromStr(text);
    const bs = data.buildings;

    const sorters = bs.filter(b => isInserter(b.itemId));
    expect(sorters.length).toBe(3);

    let pass = 0, fail = 0;
    for (const s of sorters) {
        const src = bs[s.inputObjIdx];
        const dst = bs[s.outputObjIdx];
        // 该分拣器之前已入库的建筑（用于占用检测）
        const before = bs.slice(0, s.index);

        const replay = createSorterBetween(
            src, dst, s.itemId, s.modelIndex, before,
        );

        const diffs: string[] = [];
        if (!replay) {
            diffs.push('replay returned null');
        } else {
            const rl = (replay.parameters as { length: number }).length;
            const sl = (s.parameters as { length: number }).length;
            if (rl !== sl) diffs.push(`length ${rl} != ${sl}`);
            if (replay.inputFromSlot !== s.inputFromSlot)
                diffs.push(`inputFromSlot ${replay.inputFromSlot} != ${s.inputFromSlot}`);
            if (replay.outputToSlot !== s.outputToSlot)
                diffs.push(`outputToSlot ${replay.outputToSlot} != ${s.outputToSlot}`);
            // 皮带端 offset 容差 1 档（蓝图含点击微偏）
            if (Math.abs(replay.inputOffset - s.inputOffset) > 1)
                diffs.push(`inputOffset ${replay.inputOffset} vs ${s.inputOffset}`);
            if (Math.abs(replay.outputOffset - s.outputOffset) > 1)
                diffs.push(`outputOffset ${replay.outputOffset} vs ${s.outputOffset}`);
            // 端点容差 0.01 格（蓝图端点含玩家点击的浮点微偏）
            for (const i of [0, 1] as const) {
                const dx = Math.abs(replay.localOffset[i].x - s.localOffset[i].x);
                const dy = Math.abs(replay.localOffset[i].y - s.localOffset[i].y);
                if (dx > 0.01 || dy > 0.01)
                    diffs.push(`p${i} (${replay.localOffset[i].x.toFixed(3)},${replay.localOffset[i].y.toFixed(3)}) vs (${s.localOffset[i].x.toFixed(3)},${s.localOffset[i].y.toFixed(3)})`);
            }
            // yaw 容差 0.5°（球面浮点）
            if (Math.abs(replay.yaw[0] - s.yaw[0]) > 0.5)
                diffs.push(`yaw[0] ${replay.yaw[0]} vs ${s.yaw[0]}`);
            if (Math.abs(replay.yaw[1] - s.yaw[1]) > 0.5)
                diffs.push(`yaw[1] ${replay.yaw[1]} vs ${s.yaw[1]}`);
        }

        if (diffs.length === 0) { pass++; continue; }
        fail++;
        console.log(`#${s.index} 不匹配: ${diffs.join('; ')}`);
        console.log(`  src: ${src.itemId}@(${src.localOffset[0].x.toFixed(2)},${src.localOffset[0].y.toFixed(2)})yaw${src.yaw[0].toFixed(2)} belt=${isBelt(src.itemId)}`);
        console.log(`  dst: ${dst.itemId}@(${dst.localOffset[0].x.toFixed(2)},${dst.localOffset[0].y.toFixed(2)})yaw${dst.yaw[0].toFixed(2)} belt=${isBelt(dst.itemId)}`);
    }

    console.log(`复现结果: ${pass} 通过, ${fail} 失败`);
    expect(fail).toBe(0);
});
