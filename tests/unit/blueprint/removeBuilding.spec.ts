import { fromStr, BlueprintData } from '@/blueprint/parser';
import { RemoveBuildingCommand, RemoveBuildingsCommand, RemoveBuildingsByItemCommand } from '@/blueprint/removeBuilding';
import { CommandQueue } from '@/command';
import * as fs from 'fs';
import * as path from 'path';

function load(file: string): BlueprintData {
    const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8').trim();
    return fromStr(raw);
}

/** index 必须等于数组位置，所有连接引用必须为 -1 或指向有效建筑 */
function checkConsistency(data: BlueprintData) {
    const n = data.buildings.length;
    data.buildings.forEach((b, i) => {
        expect(b.index).toBe(i);
        for (const ref of [b.outputObjIdx, b.inputObjIdx])
            expect(ref === -1 || (ref >= 0 && ref < n)).toBe(true);
    });
}

describe.each([
    'dense_splitters_v1.txt',
    'starting_base_01029.txt',
    'sample_throughput.txt',
])('RemoveBuildingCommand: %s', (file) => {
    test('remove / remap / undo at head, middle and tail', () => {
        for (const k of [0, 3, 99999]) {
            const data = load(file);
            const n = data.buildings.length;
            const removedAt = Math.min(k, n - 1);

            // 记录原本指向被删建筑的连接
            const danglingOutput = data.buildings
                .filter(b => b !== data.buildings[removedAt] && b.outputObjIdx === removedAt)
                .map(b => b.index);
            const danglingInput = data.buildings
                .filter(b => b !== data.buildings[removedAt] && b.inputObjIdx === removedAt)
                .map(b => b.index);
            const before = JSON.stringify(data.buildings);

            const cmd = new RemoveBuildingCommand(removedAt, data);
            cmd.do(data);

            expect(data.buildings.length).toBe(n - 1);
            checkConsistency(data);
            // 指向被删建筑的连接断开
            for (const i of danglingOutput)
                expect(data.buildings[i > removedAt ? i - 1 : i].outputObjIdx).toBe(-1);
            for (const i of danglingInput)
                expect(data.buildings[i > removedAt ? i - 1 : i].inputObjIdx).toBe(-1);

            cmd.undo(data);
            expect(data.buildings.length).toBe(n);
            checkConsistency(data);
            // 撤销后建筑数组（含参数与扩展字节）完全还原
            expect(JSON.stringify(data.buildings)).toBe(before);
        }
    });

    test('CommandQueue push/undo/redo restores data', () => {
        const data = load(file);
        if (data.buildings.length === 0)
            return;
        const before = JSON.stringify(data.buildings);
        const countBefore = data.buildings.length;
        const queue = new CommandQueue(data);
        const k = Math.floor(data.buildings.length / 2);

        queue.push(new RemoveBuildingCommand(k, data));
        expect(data.buildings.length).toBe(countBefore - 1);
        checkConsistency(data);

        expect(queue.undo()).toBe(true);
        expect(JSON.stringify(data.buildings)).toBe(before);

        expect(queue.redo()).toBe(true);
        checkConsistency(data);
        expect(JSON.stringify(data.buildings)).not.toBe(before);
    });
});

describe.each([
    'dense_splitters_v1.txt',
    'starting_base_01029.txt',
    'sample_throughput.txt',
])('RemoveBuildingsCommand (multi): %s', (file) => {
    test('remove scattered indices, remap refs, undo restores exactly', () => {
        const data = load(file);
        const n = data.buildings.length;
        // 头、中、尾 + 连续两个，覆盖各种相对位置
        const indices = [0, 1, Math.floor(n / 3), Math.floor(n * 2 / 3), n - 1]
            .filter((v, i, arr) => arr.indexOf(v) === i && v >= 0 && v < n);
        const before = JSON.stringify(data.buildings);

        const cmd = new RemoveBuildingsCommand(indices, data);
        cmd.do(data);

        expect(data.buildings.length).toBe(n - indices.length);
        checkConsistency(data);

        cmd.undo(data);
        expect(data.buildings.length).toBe(n);
        checkConsistency(data);
        expect(JSON.stringify(data.buildings)).toBe(before);
    });

    test('remove all buildings leaves an empty blueprint and undo restores all', () => {
        const data = load(file);
        const n = data.buildings.length;
        const before = JSON.stringify(data.buildings);
        const cmd = new RemoveBuildingsCommand(data.buildings.map((_, i) => i), data);

        cmd.do(data);
        expect(data.buildings.length).toBe(0);

        cmd.undo(data);
        expect(data.buildings.length).toBe(n);
        expect(JSON.stringify(data.buildings)).toBe(before);
    });
});

describe.each([
    'dense_splitters_v1.txt',
    'starting_base_01029.txt',
])('RemoveBuildingsByItemCommand: %s', (file) => {
    test('removes every building of one itemId in a single undoable step', () => {
        const data = load(file);
        if (data.buildings.length === 0)
            return;
        const before = JSON.stringify(data.buildings);

        // 选取数量最多的一类
        const counter = new Map<number, number>();
        for (const b of data.buildings)
            counter.set(b.itemId, (counter.get(b.itemId) ?? 0) + 1);
        const [itemId, groupSize] = [...counter.entries()].sort((a, b) => b[1] - a[1])[0];

        const countBefore = JSON.parse(before).length;
        const queue = new CommandQueue(data);
        queue.push(new RemoveBuildingsByItemCommand(itemId, data));

        expect(data.buildings.length).toBe(countBefore - groupSize);
        expect(data.buildings.some(b => b.itemId === itemId)).toBe(false);
        checkConsistency(data);

        // 一步撤销全部恢复
        expect(queue.undo()).toBe(true);
        expect(JSON.stringify(data.buildings)).toBe(before);

        // 重做仍然删净
        expect(queue.redo()).toBe(true);
        expect(data.buildings.some(b => b.itemId === itemId)).toBe(false);
        checkConsistency(data);
    });
});
