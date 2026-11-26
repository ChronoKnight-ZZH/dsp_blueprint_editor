import { fromStr, toStr } from "@/blueprint/parser";
import * as fs from "fs";
import * as path from "path";
import pako from "pako";

const V1_BLUEPRINT = 'BLUEPRINT:0,10,401,0,0,0,0,0,637818182165693716,0.9.24.11286,test,test%20desc"H4sIAAAAAAAAC+2aP0wUQRTG3+4dt+uBt5ioySUml0hxIdHmlgDhiDvsFhYSCy0MoYBEhRYsLfxXa+IVFhbiNVrYGMMFEAuprKXCxBAawIAxFAiCiYz7dmeWF24bG2neL3mzX2bve29mdu+aewYAtISRgZjWMHJKGyAB6mo6B+1qGpZf3Zv9Iz1hLBRnqNb3V60ySEXBcQrxbFbfDvOS67qUwoUHHiagWn/4uX0hSQYEE4dvB1K8KZd6Hrpr75+dPT0wvPFifnLs4ofHfQ1/6fW0/9XqjHaGtfMy3hDWNfSOf8rSQDQ1MTZLta5yYF86Uj2TbCCrl69NVL+rNnyMRauDJtBbj848Osgrc4PCqHzvpXpdugEGmpGj5pw2L9x4JGrF0SrVO6FxR5lblNkgZkubs1BPzFrvh8Z9Zc6lmG0cataUGO+667k35/qp/nyqEmCguTXFfEJXXrrsJnvWWoZVparcpl8Q89Ccx+GTvC+2wjCeFnuo3v5ypxuj166kvSz2ZiZeBkZ7GRiG+Y/o7x5zPAjfASjlf8O5q4XoOVy3oueBP6q3jndpDMMwDMMwDMMwDMMwDMMwDMMwDPPPYDcCrMqXAq/YnkH1rxkzwMDOg5PQ3LYQdSNgq8J2fderDY1Uqd6TbrCn2hbS+jwwIazJj0k1qq9Bw8dAs9NU2YRN1ZUTddA8OT8lxs0f3u3uM/1Uv+3rCjAwCbZn4H96ht2cxIlXskJWcqjn5bSPgUmyKWfwF3VXFSMnJAAA"A7DF4C8BFFFC74EA6F1C5C2F8CA778BB'

function extractBody(strData: string): Uint8Array {
    const p1 = strData.indexOf('"', 'BLUEPRINT:'.length) + 1;
    const p2 = strData.length - 33;
    console.log(pako.ungzip(new Uint8Array(Buffer.from(strData.substring(p1, p2), 'base64'))))
    return pako.ungzip(new Uint8Array(Buffer.from(strData.substring(p1, p2), 'base64')));
}

function headerCells(strData: string): string[] {
    const p1 = strData.indexOf('"', 'BLUEPRINT:'.length);
    return strData.substring('BLUEPRINT:'.length, p1).split(',');
}

describe('blueprint parser', () => {
    test('v1 round trip', () => {
        const bp = fromStr(V1_BLUEPRINT);
        expect(bp.version).toBe(1);
        expect(bp.header.author).toBe('');
        expect(fromStr(toStr(bp))).toEqual(bp);
    });

    test.each([
        'same_buildings_v2.txt',
        'sample_outpost_ils.txt',
        'sample_throughput.txt',
    ])('v2 byte-level round trip: %s', (file) => {
        const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8').trim();
        const bp = fromStr(raw);
        expect(bp.version).toBe(2);

        // 重新序列化后再次解析，数据结构完全一致。
        // 时间戳允许 1ms 误差：游戏存的是 100ns tick，样本的 tick 不是毫秒整数倍，
        // 而 `Date` 只有毫秒精度，取整后必然丢掉不足 1ms 的那部分。
        // （注意别把这里的容差当成"tick 换算本身有误差"——见下面 ms 精确回环的用例。）
        const regenerated = toStr(bp);
        const bp2 = fromStr(regenerated);
        expect(Math.abs(bp2.header.time.getTime() - bp.header.time.getTime())).toBeLessThanOrEqual(1);
        bp2.header.time = bp.header.time;
        expect(bp2).toEqual(bp);

        // 解压后的 body 必须与原蓝图逐字节一致
        expect(extractBody(regenerated)).toEqual(extractBody(raw));

        // 头部除时间字段（毫秒精度会取整）外逐格一致
        const oldCells = headerCells(raw);
        const newCells = headerCells(regenerated);
        expect(newCells.length).toBe(oldCells.length);
        const dropTime = (cells: string[]) => cells.filter((_, i) => i !== 8);
        // encodeURIComponent 不转义括号而游戏会转义（%28/%29），二者解码后等价，故比较解码值
        expect(dropTime(newCells).map(decodeURIComponent))
            .toEqual(dropTime(oldCells).map(decodeURIComponent));
    });

    test('毫秒对齐的时间戳逐毫秒精确回环（tick 数超过 2^53 也不能漂）', () => {
        // 头部 tick 数 ≈ 6.4e17 已越过 double 的精确整数范围；旧实现用 Number
        // 做 tick ↔ 毫秒换算，2026-11-26 这类时间戳导出后会稳定漂 -1ms，
        // 于是 `toStr → fromStr` 不再是恒等（reformImage 的 round-trip 用例因此偶发失败）。
        const bp = fromStr(V1_BLUEPRINT);
        for (const iso of [
            '2026-11-26T16:39:25.907Z',
            '2026-11-26T16:39:25.908Z',
            '2026-01-01T00:00:00.001Z',
            '2024-02-29T23:59:59.999Z',
        ]) {
            const time = new Date(iso);
            bp.header.time = time;
            expect(fromStr(toStr(bp)).header.time.getTime()).toBe(
                time.getTime()
            );
        }
    });
});
