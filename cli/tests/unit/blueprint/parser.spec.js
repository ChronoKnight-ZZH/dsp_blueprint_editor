"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const parser_1 = require("@/blueprint/parser");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pako_1 = __importDefault(require("pako"));
const V1_BLUEPRINT = 'BLUEPRINT:0,10,401,0,0,0,0,0,637818182165693716,0.9.24.11286,test,test%20desc"H4sIAAAAAAAAC+2aP0wUQRTG3+4dt+uBt5ioySUml0hxIdHmlgDhiDvsFhYSCy0MoYBEhRYsLfxXa+IVFhbiNVrYGMMFEAuprKXCxBAawIAxFAiCiYz7dmeWF24bG2neL3mzX2bve29mdu+aewYAtISRgZjWMHJKGyAB6mo6B+1qGpZf3Zv9Iz1hLBRnqNb3V60ySEXBcQrxbFbfDvOS67qUwoUHHiagWn/4uX0hSQYEE4dvB1K8KZd6Hrpr75+dPT0wvPFifnLs4ofHfQ1/6fW0/9XqjHaGtfMy3hDWNfSOf8rSQDQ1MTZLta5yYF86Uj2TbCCrl69NVL+rNnyMRauDJtBbj848Osgrc4PCqHzvpXpdugEGmpGj5pw2L9x4JGrF0SrVO6FxR5lblNkgZkubs1BPzFrvh8Z9Zc6lmG0cataUGO+667k35/qp/nyqEmCguTXFfEJXXrrsJnvWWoZVparcpl8Q89Ccx+GTvC+2wjCeFnuo3v5ypxuj166kvSz2ZiZeBkZ7GRiG+Y/o7x5zPAjfASjlf8O5q4XoOVy3oueBP6q3jndpDMMwDMMwDMMwDMMwDMMwDMMwDPPPYDcCrMqXAq/YnkH1rxkzwMDOg5PQ3LYQdSNgq8J2fderDY1Uqd6TbrCn2hbS+jwwIazJj0k1qq9Bw8dAs9NU2YRN1ZUTddA8OT8lxs0f3u3uM/1Uv+3rCjAwCbZn4H96ht2cxIlXskJWcqjn5bSPgUmyKWfwF3VXFSMnJAAA"A7DF4C8BFFFC74EA6F1C5C2F8CA778BB';
function extractBody(strData) {
    const p1 = strData.indexOf('"', 'BLUEPRINT:'.length) + 1;
    const p2 = strData.length - 33;
    return pako_1.default.ungzip(Buffer.from(strData.substring(p1, p2), 'base64'));
}
function headerCells(strData) {
    const p1 = strData.indexOf('"', 'BLUEPRINT:'.length);
    return strData.substring('BLUEPRINT:'.length, p1).split(',');
}
describe('blueprint parser', () => {
    test('v1 round trip', () => {
        const bp = (0, parser_1.fromStr)(V1_BLUEPRINT);
        expect(bp.version).toBe(1);
        expect(bp.header.author).toBe('');
        expect((0, parser_1.fromStr)((0, parser_1.toStr)(bp))).toEqual(bp);
    });
    test.each([
        'same_buildings_v2.txt',
        'sample_outpost_ils.txt',
        'sample_throughput.txt',
    ])('v2 byte-level round trip: %s', (file) => {
        const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8').trim();
        const bp = (0, parser_1.fromStr)(raw);
        expect(bp.version).toBe(2);
        // 重新序列化后再次解析，数据结构完全一致（时间戳受毫秒精度限制，允许 1ms 误差）
        const regenerated = (0, parser_1.toStr)(bp);
        const bp2 = (0, parser_1.fromStr)(regenerated);
        expect(Math.abs(bp2.header.time.getTime() - bp.header.time.getTime())).toBeLessThanOrEqual(1);
        bp2.header.time = bp.header.time;
        expect(bp2).toEqual(bp);
        // 解压后的 body 必须与原蓝图逐字节一致
        expect(extractBody(regenerated)).toEqual(extractBody(raw));
        // 头部除时间字段（毫秒精度会取整）外逐格一致
        const oldCells = headerCells(raw);
        const newCells = headerCells(regenerated);
        expect(newCells.length).toBe(oldCells.length);
        const dropTime = (cells) => cells.filter((_, i) => i !== 8);
        // encodeURIComponent 不转义括号而游戏会转义（%28/%29），二者解码后等价，故比较解码值
        expect(dropTime(newCells).map(decodeURIComponent))
            .toEqual(dropTime(oldCells).map(decodeURIComponent));
    });
});
//# sourceMappingURL=parser.spec.js.map