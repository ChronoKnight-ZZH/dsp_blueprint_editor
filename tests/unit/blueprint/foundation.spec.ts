import { fromStr, toStr } from '@/blueprint/parser';
import * as fs from 'fs';
import * as path from 'path';
import pako from 'pako';

const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(file: string): string {
    return fs.readFileSync(path.join(fixturesDir, file), 'utf8').trim();
}

function extractBody(strData: string): Uint8Array {
    const p1 = strData.indexOf('"', 'BLUEPRINT:'.length) + 1;
    const p2 = strData.length - 33;
    return pako.ungzip(Buffer.from(strData.substring(p1, p2), 'base64'));
}

describe('reform data (地基) support', () => {
    test('parses foundation-only blueprint (0 buildings, 1 rect)', () => {
        const bp = fromStr(readFixture('foundation_only_99.txt'));
        expect(bp.version).toBe(2);
        expect(bp.buildings.length).toBe(0);
        expect(bp.patch).toBe(1);
        expect(bp.reformData).not.toBeNull();
        expect(bp.reformData!.rects.length).toBe(1);
        const rect = bp.reformData!.rects[0];
        expect(rect).toMatchObject({ x: 0, y: 0, w: 9, h: 11, type: 1, color: 0, areaIndex: 0 });
        expect(bp.reformData!.customReformColorMask).toBe(0);
        expect(bp.reformData!.customReformColors).toEqual([]);
        expect(bp.tailExtraBytes).toBeUndefined();
    });

    test('parses facilities + foundation blueprint without losing buildings', () => {
        const bp = fromStr(readFixture('facilities_with_foundation_320.txt'));
        expect(bp.version).toBe(2);
        expect(bp.buildings.length).toBe(16);
        expect(bp.patch).toBe(1);
        expect(bp.reformData).not.toBeNull();
        expect(bp.reformData!.rects.length).toBe(1);
        const rect = bp.reformData!.rects[0];
        expect(rect).toMatchObject({ x: 0, y: 0, w: 20, h: 16, type: 1, color: 0, areaIndex: 0 });
    });

    test.each([
        'foundation_only_99.txt',
        'facilities_with_foundation_320.txt',
    ])('v2 byte-level round trip with foundation: %s', (file) => {
        const raw = readFixture(file);
        const bp = fromStr(raw);
        const regenerated = toStr(bp);

        // 解压后的 body 必须与原蓝图逐字节一致（含 patch / reformData）
        expect(extractBody(regenerated)).toEqual(extractBody(raw));

        // 再次解析后数据结构一致（时间戳允许 1ms 误差）
        const bp2 = fromStr(regenerated);
        expect(Math.abs(bp2.header.time.getTime() - bp.header.time.getTime())).toBeLessThanOrEqual(1);
        bp2.header.time = bp.header.time;
        expect(bp2).toEqual(bp);
    });

    test('preserves 0.10.33 opaque tail bytes (dense_splitters)', () => {
        const raw = readFixture('dense_splitters_v1.txt');
        const bp = fromStr(raw);
        expect(bp.buildings.length).toBe(438);
        expect(bp.patch).toBe(1);
        expect(bp.reformData).toBeNull();
        // 0.10.33.27026 在 flag=0 之后仍有 5 个语义未知的预留字节，必须原样保留
        expect(bp.tailExtraBytes).toBeDefined();
        expect(Array.from(bp.tailExtraBytes!)).toEqual([0x04, 0x00, 0x00, 0x00, 0x00]);

        const bp2 = fromStr(toStr(bp));
        expect(bp2.buildings.length).toBe(438);
        expect(Array.from(bp2.tailExtraBytes!)).toEqual([0x04, 0x00, 0x00, 0x00, 0x00]);
    });

    test('v2 blueprints without foundation still parse (flag=0)', () => {
        const bp = fromStr(readFixture('same_buildings_v2.txt'));
        expect(bp.patch).toBe(1);
        expect(bp.reformData).toBeNull();
        expect(bp.tailExtraBytes).toBeUndefined();
    });
});
