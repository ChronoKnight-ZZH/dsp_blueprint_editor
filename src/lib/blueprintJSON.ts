import type { BlueprintData } from '@/blueprint/parser';

/**
 * `BlueprintData` 与 JSON 文本之间的转换。
 *
 * 为什么需要专门的 reviver：`BlueprintData` 里有两个字段**不能**经
 * `JSON.stringify` / `JSON.parse` 原样往返：
 *
 * 1. `header.time` 是 `Date` → 序列化成 ISO 字符串，直接 parse 回来是 string，
 *    而 `toStr()` 会调 `header.time.getTime()`，导出时抛 TypeError。
 * 2. `buildings[].extraBytes` 是 `Uint8Array` → 序列化成 `{"0":1,"1":2,…}` 对象，
 *    直接 parse 回来是普通对象，`toStr()` 取 `.length` 得到 undefined，字节数算错。
 *
 * 所以导入时按形状把这些字段还原成原类型（见 `reviveBlueprintData`）。
 * 其余字段都是纯 JSON 兼容的标量/数组/对象。
 */

/** 导入结果：成功给数据，失败给可上报的结构化原因 */
export type BlueprintJSONOutcome =
    | { ok: true; value: BlueprintData }
    | { ok: false; error: { code: 'json-syntax' | 'json-shape'; message: string } };

/** `Uint8Array` 经 JSON 往返后的形状 */
type BytesAsJSON = Record<string, number>;

function reviveBytes(value: unknown): Uint8Array | undefined {
    if (value === undefined || value === null)
        return undefined;
    if (value instanceof Uint8Array)
        return value;
    // JSON.stringify(Uint8Array) → {"0":n,"1":n,…}
    if (typeof value === 'object') {
        const obj = value as BytesAsJSON;
        const keys = Object.keys(obj);
        // 空对象（原字节数组为空）→ 长度 0 的数组
        const out = new Uint8Array(keys.length);
        for (const k of keys) {
            const i = Number(k);
            if (!Number.isInteger(i) || i < 0) {
                // 形状不认识：交给调用方当作非法数据
                throw new Error(`extraBytes 的键不是数组下标：${k}`);
            }
            out[i] = obj[k] & 0xff;
        }
        return out;
    }
    throw new Error('extraBytes 应为 Uint8Array 或 {"0":…} 形式的对象');
}

function reviveTime(value: unknown): Date {
    if (value instanceof Date)
        return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (Number.isNaN(d.getTime()))
            throw new Error(`header.time 不是合法时间：${String(value)}`);
        return d;
    }
    throw new Error('header.time 缺失或类型错误（需要 ISO 字符串或时间戳）');
}

/**
 * 把已 `JSON.parse` 的普通对象还原成 `BlueprintData`。
 *
 * 只做**必要的类型还原**与**最小形状校验**，不做字段级深校验：
 * 真正的自洽性检查交给 `findPosForAreas`（定位阶段）与 `buildBuildings`（构建阶段），
 * 它们给出的错误已经能被 `BlueprintViewer` 分类上报。
 */
export function reviveBlueprintData(raw: unknown): BlueprintData {
    if (typeof raw !== 'object' || raw === null)
        throw new Error('JSON 根节点不是对象');

    const data = raw as Partial<BlueprintData> & Record<string, unknown>;

    if (typeof data.header !== 'object' || data.header === null)
        throw new Error('缺少 header 对象');
    if (!Array.isArray(data.areas))
        throw new Error('缺少 areas 数组');
    if (!Array.isArray(data.buildings))
        throw new Error('缺少 buildings 数组');

    const header = data.header as BlueprintData['header'] & Record<string, unknown>;
    header.time = reviveTime(header.time);

    for (const b of data.buildings as unknown[]) {
        if (typeof b !== 'object' || b === null)
            throw new Error('buildings 里存在非对象元素');
        const rec = b as Record<string, unknown>;
        const bytes = reviveBytes(rec.extraBytes);
        if (bytes === undefined)
            delete rec.extraBytes;
        else
            rec.extraBytes = bytes;
    }

    return data as BlueprintData;
}

/** `JSON.parse` + 还原。抛错由调用方转成结构化错误 */
export function parseBlueprintJSON(text: string): BlueprintData {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    }
    catch (e) {
        throw new JSONImportError('json-syntax', e instanceof Error ? e.message : String(e));
    }
    try {
        return reviveBlueprintData(raw);
    }
    catch (e) {
        throw new JSONImportError('json-shape', e instanceof Error ? e.message : String(e));
    }
}

/** 带上 `json-syntax` / `json-shape` 区分的内部错误 */
export class JSONImportError extends Error {
    constructor(
        public readonly code: 'json-syntax' | 'json-shape',
        message: string,
    ) {
        super(message);
        this.name = 'JSONImportError';
    }
}

/**
 * 把蓝图数据序列化成**可读**的 JSON 文本（2 空格缩进）。
 *
 * 直接 `JSON.stringify(data, null, 2)` 即可：`Date` 走 `toJSON` 变 ISO 串，
 * `Uint8Array` 变 `{"0":…}` 对象，两者都能被 `parseBlueprintJSON` 还原。
 * 这里只是把这个约定固化成一个具名函数，避免调用的地方各自写。
 */
export function stringifyBlueprintJSON(data: BlueprintData): string {
    return JSON.stringify(data, null, 2);
}

/**
 * 校验/格式化用户粘贴的 JSON 文本。
 *
 * 网页端只能拿到 JSON 文本，所以需要一步「先格式化、再导入」：
 * 格式化同时充当校验——能格式化说明语法与关键字段都过得去。
 */
export function formatBlueprintJSON(text: string): BlueprintJSONOutcome {
    const trimmed = text.trim();
    if (trimmed === '') {
        return { ok: false, error: { code: 'json-shape', message: '输入为空' } };
    }
    try {
        const data = parseBlueprintJSON(trimmed);
        return { ok: true, value: data };
    }
    catch (e) {
        const code = e instanceof JSONImportError ? e.code : 'json-shape';
        return { ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } };
    }
}
