import { fromStr, toStr } from '@/blueprint/parser';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('extra blueprints', () => {
    it('parses dense_splitters (0.10.33, v1 header v2 body)', () => {
        const raw = fs.readFileSync(path.join(fixturesDir, 'dense_splitters_v1.txt'), 'utf8').trim();
        const bp = fromStr(raw);
        console.log('dense_splitters buildings:', bp.buildings.length);
        expect(bp.buildings.length).toBe(438);
    });

    it('round-trips dense_splitters', () => {
        const raw = fs.readFileSync(path.join(fixturesDir, 'dense_splitters_v1.txt'), 'utf8').trim();
        const bp = fromStr(raw);
        const exported = toStr(bp);
        const bp2 = fromStr(exported);
        expect(bp2.buildings.length).toBe(bp.buildings.length);
        // 检查分拣器第二端位置在往返后保持合理
        const inserters = bp.buildings.filter(b => b.itemId >= 2011 && b.itemId <= 2014);
        const inserters2 = bp2.buildings.filter(b => b.itemId >= 2011 && b.itemId <= 2014);
        expect(inserters2.length).toBe(inserters.length);
        for (let i = 0; i < inserters.length; i++) {
            const a = inserters[i].localOffset[1];
            const b = inserters2[i].localOffset[1];
            expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
            expect(Math.abs(a.y - b.y)).toBeLessThan(0.01);
            expect(Math.abs(a.z - b.z)).toBeLessThan(0.01);
        }
    });

    it('parses starting_base (0.10.29, v1)', () => {
        const raw = fs.readFileSync(path.join(fixturesDir, 'starting_base_01029.txt'), 'utf8').trim();
        const bp = fromStr(raw);
        console.log('starting_base buildings:', bp.buildings.length);
        expect(bp.buildings.length).toBeGreaterThan(0);
    });
});
