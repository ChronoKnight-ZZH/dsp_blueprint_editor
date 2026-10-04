import { createEmptyBlueprint } from '@/blueprint/create';
import { buildBeltLine, CreateBeltLineCommand } from '@/blueprint/beltLine';
import { fromStr, toStr } from '@/blueprint/parser';

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
});
