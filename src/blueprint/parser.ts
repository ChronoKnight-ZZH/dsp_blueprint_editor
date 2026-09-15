import { allAssemblers } from '@/data/items';
import pako from 'pako';
import { digest } from './md5';

export interface BlueprintArea {
    index: number;
    parentIndex: number;
    tropicAnchor: number;
    areaSegments: number;
    anchorLocalOffset: {
        x: number;
        y: number;
    };
    size: {
        x: number;
        y: number;
    };
}

interface XYZ {
    x: number, y: number, z: number,
}
export interface BlueprintBuilding {
    index: number,
    areaIndex: number,
    localOffset: [ XYZ, XYZ ],
    yaw: [ number, number ],
    tilt: number,
    itemId: number,
    modelIndex: number,
    outputObjIdx: number,
    inputObjIdx: number,
    outputToSlot: number,
    inputFromSlot: number,
    outputFromSlot: number,
    inputToSlot: number,
    outputOffset: number,
    inputOffset: number,
    recipeId: number,
    filterId: number,
    parameters: null | AllParameters,
    /** v2 body：分拣器(2011-2014)在 yaw/tilt 之后附带的 7 个 float，语义未完全明确，字节级原样保留 */
    v2ExtraPose?: number[],
    /** v2 body（-102 记录，0.10.34+）：信标等建筑的自定义文本，空则不存在该语义字段 */
    content?: string,
    /** v2 body：已知字段（content 等）与下一记录起始标记之间的未知扩展字节，正常蓝图不存在，字节级原样保留 */
    extraBytes?: Uint8Array,
}

/** 地基（地形改造）矩形区域，每个 9 字节 */
export interface BlueprintReformRect {
    /** 预留字节，原值保留 */
    reserved: number,
    x: number,
    y: number,
    w: number,
    h: number,
    /** 地基装饰类型（data 高 3 位）：0 无地基 / 1 默认工字铺 / 2 直铺 / 7 无装饰；1、2 的小方格均为带金属光泽的金属板样式 */
    type: number,
    /** 颜色索引（data 低 5 位） */
    color: number,
    areaIndex: number,
}

/** v2 body 尾部的地基数据（reformData） */
export interface BlueprintReformData {
    /** 预留字节，原值保留 */
    reserved: number,
    rects: BlueprintReformRect[],
    customReformColorMask: number,
    customReformColors: number[],
}

export interface BlueprintData {
    header: {
        layout: number;
        icons: number[];
        time: Date;
        gameVersion: string;
        shortDesc: string;
        /** v2 头部新增：作者（旧蓝图为空字符串） */
        author: string;
        /** v2 头部新增：蓝图版本 */
        blueprintVersion: string;
        /** v2 头部新增：属性，原始字符串，形如 "名称:内容;名称:内容;" */
        properties: string;
        desc: string;
    };
    version: number;
    cursorOffset: { x: number, y: number };
    cursorTargetArea: number;
    dragBoxSize: { x: number, y: number };
    primaryAreaIdx: number;
    areas: BlueprintArea[];
    buildings: BlueprintBuilding[];
    /** v2 body：建筑数组之后的预留 int32（0.10.33+） */
    patch?: number;
    /** v2 body：地基数据（reformDataFlag=1 时存在，否则为 null） */
    reformData?: BlueprintReformData | null;
    /** v2 body：地基数据之后的未知尾部字节（如 0.10.33 的 5 字节预留），字节级原样保留 */
    tailExtraBytes?: Uint8Array;
}

abstract class BufferIO {
    protected pos = 0;
    constructor(protected view: DataView) { }

    getView(length: number) {
        if (length < 0 || this.pos + length > this.view.byteLength)
            throw new Error(
                `蓝图数据读取越界：位置 ${this.pos}，请求 ${length} 字节，`
                + `剩余 ${this.view.byteLength - this.pos} 字节`);
        const r = new DataView(this.view.buffer, this.view.byteOffset + this.pos, length);
        this.pos += length;
        return r;
    }
}

class BufferReader extends BufferIO {
    private check(n: number) {
        if (this.pos + n > this.view.byteLength)
            throw new Error(
                `蓝图数据读取越界：位置 ${this.pos}，请求 ${n} 字节，`
                + `剩余 ${this.view.byteLength - this.pos} 字节`);
    }
    getUint8() { this.check(1); const v = this.view.getUint8(this.pos);       this.pos += 1; return v }
    getInt8()  { this.check(1); const v = this.view.getInt8(this.pos);        this.pos += 1; return v }
    getInt16() { this.check(2); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v }
    getInt32() { this.check(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v }
    getUint32() { this.check(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v }

    getFloat32() { this.check(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v }

    get position() { return this.pos; }

    getBytes(length: number) {
        this.check(length);
        const start = this.view.byteOffset + this.pos;
        this.pos += length;
        return new Uint8Array(this.view.buffer.slice(start, start + length));
    }

    /** 读取 .NET BinaryWriter 风格的长度前缀字符串：7-bit encoded int 长度 + UTF-8 字节 */
    getString() {
        let len = 0;
        let shift = 0;
        for (;;) {
            const b = this.getUint8();
            len |= (b & 0x7F) << shift;
            if ((b & 0x80) === 0)
                break;
            shift += 7;
            if (shift > 35)
                throw new Error('字符串长度前缀解析错误');
        }
        if (len === 0)
            return '';
        return new TextDecoder('utf-8').decode(this.getView(len));
    }
}

class BufferWriter extends BufferIO {
    setUint8(value: number) { this.view.setUint8(this.pos, value);       this.pos += 1; }
    setInt8(value: number)  { this.view.setInt8(this.pos, value);        this.pos += 1; }
    setInt16(value: number) { this.view.setInt16(this.pos, value, true); this.pos += 2; }
    setInt32(value: number) { this.view.setInt32(this.pos, value, true); this.pos += 4; }
    setUint32(value: number) { this.view.setUint32(this.pos, value, true); this.pos += 4; }

    setFloat32(value: number) { this.view.setFloat32(this.pos, value, true); this.pos += 4; }

    setBytes(bytes: Uint8Array) {
        const start = this.view.byteOffset + this.pos;
        new Uint8Array(this.view.buffer).set(bytes, start);
        this.pos += bytes.length;
    }

    /** 写入 .NET BinaryWriter 风格的长度前缀字符串：7-bit encoded int 长度 + UTF-8 字节 */
    setString(value: string) {
        const bytes = new TextEncoder().encode(value);
        let len = bytes.length >>> 0;
        while (len >= 0x80) {
            this.setUint8((len & 0x7F) | 0x80);
            len >>>= 7;
        }
        this.setUint8(len & 0x7F);
        this.setBytes(bytes);
    }
}

/** 7-bit encoded int 编码后的字节数 */
function encoded7BitLength(value: number): number {
    let len = 1;
    let v = value >>> 0;
    while (v >= 0x80) {
        len++;
        v >>>= 7;
    }
    return len;
}

function btoUint8Array(b: string) {
    const arr = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) {
        arr[i] = b.charCodeAt(i);
    }
    return arr;
}

function Uint8ArrayTob(a: Uint8Array) {
    let out = '';
    for (let i = 0; i < a.length; i++) {
        out += String.fromCharCode(a[i]);
    }
    return out;
}

const uint8ToHex = new Array(0x100);
for (let i = 0; i < uint8ToHex.length; i++) {
    uint8ToHex[i] = i.toString(16).toUpperCase().padStart(2, '0');
}
function hex(buffer: ArrayBuffer) {
    const view = new Uint8Array(buffer);
    const hexBytes = new Array(view.length);
    for (let i = 0; i < view.length; i++) {
        hexBytes[i] = uint8ToHex[view[i]];
    }
    return hexBytes.join('');
}

function importArea(r: BufferReader): BlueprintArea {
    return {
        index: r.getInt8(),
        parentIndex: r.getInt8(),
        tropicAnchor: r.getInt16(),
        areaSegments: r.getInt16(),
        anchorLocalOffset: {
            x: r.getInt16(),
            y: r.getInt16(),
        },
        size: {
            x: r.getInt16(),
            y: r.getInt16(),
        },
    }
}

function exportArea(w: BufferWriter, area: BlueprintArea) {
    w.setInt8(area.index);
    w.setInt8(area.parentIndex);
    w.setInt16(area.tropicAnchor);
    w.setInt16(area.areaSegments);
    w.setInt16(area.anchorLocalOffset.x);
    w.setInt16(area.anchorLocalOffset.y);
    w.setInt16(area.size.x);
    w.setInt16(area.size.y);
}

interface ParamParser<TParam extends AllParameters> {
    encodedSize(p: TParam, version?: number): number;
    encode(p: TParam, a: DataView): void;
    decode(a: DataView): TParam;
}

function getParam(v: DataView, pos: number, defaultValue?: number) {
    const p = pos * Int32Array.BYTES_PER_ELEMENT;
    if (p >= v.byteLength) {
        if (defaultValue === undefined) {
            throw new Error('参数解析错误：数据段太短');
        } else {
            return defaultValue;
        }
    }
    return v.getInt32(p, true);
}
function setParam(v: DataView, pos: number, value: number) {
    v.setInt32(pos * Int32Array.BYTES_PER_ELEMENT, value, true);
}

const stationDesc = {
    maxItemKind: 4,
    numSlots: 12,
};
const interstellarStationDesc = {
    maxItemKind: 5,
    numSlots: 12,
};
const AdvancedMiningMachineDesc = {
    maxItemKind: 1,
    numSlots: 9,
};

export enum IODir { None, Output, Input, }
export enum LogisticRole { None, Supply, Demand, }
export interface StationParameters {
    storage: {
        itemId: number;
        max: number;
        localLogic: LogisticRole;
        remoteLogic: LogisticRole;
        // 0: 不锁定，否则将库存容量锁定为max/keepMode
        keepMode: number;
    }[];
    slots: {
        dir: IODir;
        /** Index into storage. Start from 1 */
        storageIdx: number;
    }[];

    workEnergyPerTick: number;
    tripRangeOfDrones: number;
    tripRangeOfShips: number;
    includeOrbitCollector: boolean;
    warpEnableDistance: number;
    warperNecessary: boolean;
    deliveryAmountOfDrones: number;
    deliveryAmountOfShips: number;
    pilerCount: number;
    droneAutoReplenish: boolean;
    shipAutoReplenish: boolean;
}
export interface AdvancedMiningMachineParameters extends StationParameters {
    miningSpeed: number;
}

const stationParamsMeta = {
    base: 320,
    storage: { base: 0, stride: 6 },
    slots: { base: 192, stride: 4 },
} as const;
function stationParamsParser(desc: typeof stationDesc): ParamParser<StationParameters> {
    return {
        encodedSize() { return 2048; },
        encode(p, a) {
            const base = stationParamsMeta.base;
            setParam(a, base + 0, p.workEnergyPerTick);
            setParam(a, base + 1, p.tripRangeOfDrones * 100000000.0);
            setParam(a, base + 2, p.tripRangeOfShips / 100.0);
            setParam(a, base + 3, p.includeOrbitCollector ? 1 : -1);
            setParam(a, base + 4, p.warpEnableDistance);
            setParam(a, base + 5, p.warperNecessary ? 1 : -1);
            setParam(a, base + 6, p.deliveryAmountOfDrones);
            setParam(a, base + 7, p.deliveryAmountOfShips);
            setParam(a, base + 8, p.pilerCount);
            setParam(a, base + 10, p.droneAutoReplenish ? 1 : 0);
            setParam(a, base + 11, p.shipAutoReplenish ? 1 : 0);
            {
                const {base, stride} = stationParamsMeta.storage;
                for (let i = 0; i < desc.maxItemKind; i++) {
                    const s = p.storage[i];
                    setParam(a, base + i * stride + 0, s.itemId);
                    setParam(a, base + i * stride + 1, s.localLogic);
                    setParam(a, base + i * stride + 2, s.remoteLogic);
                    setParam(a, base + i * stride + 3, s.max);
                    setParam(a, base + i * stride + 4, s.keepMode);
                }
            } {
                const {base, stride} = stationParamsMeta.slots;
                for (let i = 0; i < 12; i++) {
                    const s = p.slots[i];
                    setParam(a, base + i * stride + 0, s.dir);
                    setParam(a, base + i * stride + 1, s.storageIdx);
                }
            }
        },
        decode(a) {
            const base = stationParamsMeta.base;
            const result: StationParameters = {
                storage: [],
                slots: [],
                workEnergyPerTick:      getParam(a, base + 0),
                tripRangeOfDrones:      getParam(a, base + 1) / 100000000.0,
                tripRangeOfShips:       getParam(a, base + 2) * 100.0,
                includeOrbitCollector:  getParam(a, base + 3) > 0,
                warpEnableDistance:     getParam(a, base + 4),
                warperNecessary:        getParam(a, base + 5) > 0,
                deliveryAmountOfDrones: getParam(a, base + 6),
                deliveryAmountOfShips:  getParam(a, base + 7),
                pilerCount:             getParam(a, base + 8),
                droneAutoReplenish:     getParam(a, base + 10) > 0,
                shipAutoReplenish:      getParam(a, base + 11) > 0,
            };
            {
                const {base, stride} = stationParamsMeta.storage;
                for (let i = 0; i < desc.maxItemKind; i++) {
                    result.storage.push({
                        itemId:     getParam(a, base + i * stride + 0),
                        localLogic:  getParam(a, base + i * stride + 1),
                        remoteLogic: getParam(a, base + i * stride + 2),
                        max:        getParam(a, base + i * stride + 3),
                        keepMode:   getParam(a, base + i * stride + 4),
                    });
                }
            } {
                const {base, stride} = stationParamsMeta.slots;
                for (let i = 0; i < 12; i++) {
                    result.slots.push({
                        dir:        getParam(a, base + i * stride + 0),
                        storageIdx: getParam(a, base + i * stride + 1),
                    })
                }
            }
            return result;
        }
    }
}

function advancedMiningMachineParamParser(): ParamParser<AdvancedMiningMachineParameters> {
    const stationParser = stationParamsParser(AdvancedMiningMachineDesc);
    return {
        encodedSize: stationParser.encodedSize,
        encode(p, a) {
            stationParser.encode(p, a);
            const base = stationParamsMeta.base;
            setParam(a, base + 9, p.miningSpeed);
        },
        decode(a) {
            const p = stationParser.decode(a);
            const base = stationParamsMeta.base;
            return Object.assign(p, {
                miningSpeed: getParam(a, base + 9),
            });
        }
    }
}

export interface SplitterParameters {
    priority: boolean[];
    /** v2 body 在 4 个优先级布尔值之后新增的 2 个整型参数，语义未明确，字节级原样保留 */
    extra: number[];
}

const splitterParamParser: ParamParser<SplitterParameters> = {
    encodedSize(_p, version = 1) { return version >= 2 ? 6 : 4; },
    encode(p, a) {
        for (let i = 0; i < 4; i++) {
            setParam(a, i, p.priority[i] ? 1 : 0);
        }
        if (a.byteLength >= 6 * Int32Array.BYTES_PER_ELEMENT) {
            setParam(a, 4, p.extra?.[0] ?? 0);
            setParam(a, 5, p.extra?.[1] ?? 0);
        }
    },
    decode(a) {
        const result: SplitterParameters = {
            priority: [],
            extra: [getParam(a, 4, 0), getParam(a, 5, 0)],
        };
        for (let i = 0; i < 4; i++) {
            result.priority[i] = getParam(a, i) > 0;
        }
        return result;
    }
}

export enum AcceleratorMode { ExtraOutput, Accelerate }
export enum ResearchMode { None, Compose, Research }

export interface AssembleParamerters {
    acceleratorMode: AcceleratorMode,
}

export interface LabParamerters extends AssembleParamerters {
    researchMode: ResearchMode,
}

const labParamParser: ParamParser<LabParamerters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.researchMode);
        setParam(a, 1, p.acceleratorMode);
    },
    decode(a) {
        return {
            researchMode: getParam(a, 0),
            acceleratorMode: getParam(a, 1),
        }
    }
}

const assembleParamParser: ParamParser<AssembleParamerters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.acceleratorMode);
    },
    decode(a) {
        return {
            acceleratorMode: getParam(a, 0),
        };
    },
}

export interface BeltParameters {
    iconId: number;
    count: number;
}

const beltParamParser: ParamParser<BeltParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.iconId);
        setParam(a, 1, p.count);
    },
    decode(a) {
        return {
            iconId: getParam(a, 0),
            count: getParam(a, 1, 0),
        };
    },
}

export interface InserterParameters {
    length: number;
}

const inserterParamParser: ParamParser<InserterParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.length);
    },
    decode(a) {
        return {
            length: getParam(a, 0),
        };
    },
}

export interface TankParameters {
    input: boolean;
    output: boolean;
}

const tankParamParser: ParamParser<TankParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.output ? 1 : -1);
        setParam(a, 1, p.input ? 1 : -1);
    },
    decode(a) {
        return {
            output: getParam(a, 0) > 0,
            input: getParam(a, 1) > 0,
        };
    },
}

export enum StorageType {
    DEFAULT = 0,
    FILTERED = 9,
}
export interface StorageGrid {
    filter: number;
}
export interface StorageParameters {
    automationLimit: number;
    type: StorageType;
    grids: StorageGrid[];
}

function storageParamParser(size: number): ParamParser<StorageParameters>{
    return {
        encodedSize() {
            const s = 10 + size;
            if (s < 110)
                return 110;
            return s;
        },
        encode(p, a) {
            setParam(a, 0, p.automationLimit);
            setParam(a, 1, p.type);
            if (p.type === StorageType.FILTERED) {
                for (let i = 0; i < size; i++) {
                    setParam(a, 10 + i, p.grids[i].filter);
                }
            }
        },
        decode(a) {
            const type = getParam(a, 1, StorageType.DEFAULT)
            const grids: StorageGrid[] = [];
            if (type === StorageType.FILTERED) {
                for (let i = 0; i < size; i++) {
                    grids.push({
                        filter: getParam(a, 10 + i, 0),
                    });
                }
            }
            return {
                automationLimit: getParam(a, 0),
                type,
                grids,
            };
        },
    }
}

export enum BattleBaseDroneConstructPriority {
    REPARE = 0,
    BALANCE = 1,
    CONSTRUCT = 2,
}
export interface Fighter {
    itemId: number;
}
export interface BattleBaseParameters extends StorageParameters {
    workEnergyPerTick: number;
    autoPickEnabled: boolean;
    autoReplenishFleet: boolean;
    combatEnabled: boolean;
    autoReconstruct: boolean;
    constructionDroneEnabled: boolean;
    droneConstructPriority: BattleBaseDroneConstructPriority;
    fighters: Fighter[];
}

function battleBaseParamParser(): ParamParser<BattleBaseParameters> {
    const storageParser = storageParamParser(60);
    const getBase = (p: StorageParameters) => {
        switch (p.type) {
            case StorageType.DEFAULT:
                return 10;
            case StorageType.FILTERED:
                return 10 + 60;
            default:
                throw new Error('参数解析错误：未知的储存类型');
        }
    }
    return {
        encodedSize() {
            return 110;
        },
        encode(p, a) {
            storageParser.encode(p, a);
            const base = getBase(p);
            setParam(a, base + 0, p.workEnergyPerTick);
            setParam(a, base + 1, p.autoPickEnabled ? 1 : 0);
            setParam(a, base + 2, p.autoReplenishFleet ? 1 : 0);
            setParam(a, base + 3, p.combatEnabled ? 1 : 0);
            setParam(a, base + 4, p.autoReconstruct ? 1 : 0);
            setParam(a, base + 5, p.constructionDroneEnabled ? 1 : 0);
            setParam(a, base + 6, p.droneConstructPriority);
            for (let i = 0; i < p.fighters.length; i++) {
                setParam(a, base + 7 + i, p.fighters[i].itemId);
            }
        },
        decode(a) {
            const p = storageParser.decode(a);
            const base = getBase(p);
            const fighters: Fighter[] = [];
            for (let i = 0; i < 12; i++) {
                fighters.push({
                    itemId: getParam(a, base + 7 + i),
                });
            }
            return Object.assign(p, {
                workEnergyPerTick: getParam(a, base + 0),
                autoPickEnabled: getParam(a, base + 1) > 0,
                autoReplenishFleet: getParam(a, base + 2) > 0,
                combatEnabled: getParam(a, base + 3) > 0,
                autoReconstruct: getParam(a, base + 4) > 0,
                constructionDroneEnabled: getParam(a, base + 5) > 0,
                droneConstructPriority: getParam(a, base + 6),
                fighters,
            });
        },
    }
}

export interface EjectorParameters {
    orbitId: number;
    boost: boolean;
}

const ejectorParamParser: ParamParser<EjectorParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.orbitId);
        setParam(a, 1, p.boost ? 1 : 0);
    },
    decode(a) {
        return {
            orbitId: getParam(a, 0),
            boost: getParam(a, 1, 0) > 0,
        };
    },
}

export interface PowerGeneratorParameters {
    productId: number;
}

const powerGeneratorParamParser: ParamParser<PowerGeneratorParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.productId);
    },
    decode(a) {
        return {
            productId: getParam(a, 0),
        };
    },
}

export interface ArtifacialStarParameters {
    boost: boolean;
}

const artifacialStarParamParser: ParamParser<ArtifacialStarParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.boost ? 1 : 0);
    },
    decode(a) {
        return {
            boost: getParam(a, 0, 0) > 0,
        };
    },
}

export enum EnergyExchangerMode {
    Discharge = -1,
    StandBy = 0,
    Charge = 1,
}

export interface EnergyExchangerParameters {
    mode: EnergyExchangerMode;
}

const energyExchangerParamParser: ParamParser<EnergyExchangerParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.mode);
    },
    decode(a) {
        return {
            mode: getParam(a, 0),
        };
    },
}

export enum SpawnItemOperator {
    NONE = 0,
    GENERATE = 1,
    CONSUME = 2,
}
export interface MonitorParameters {
    targetBeltId: number;
    offset: number;
    targetCargoAmount: number;
    periodTicksCount: number;
    passColorId: number;
    failColorId: number;
    passOperator: number;
    alarmMode: number;
    cargoFilter: number;
    systemWarningMode: number;
    systemWarningIconId: number;
    tone: number;
    volume: number;
    pitch: number;
    repeat: boolean;
    length: number;
    falloffRadius: [number, number];
    spawnItemOperator: SpawnItemOperator;
}

const MonitorParamParser: ParamParser<MonitorParameters> = {
    encodedSize() { return 128; },
    encode(p, a) {
        setParam(a, 0, p.targetBeltId);
        setParam(a, 1, p.offset);
        setParam(a, 2, p.targetCargoAmount);
        setParam(a, 3, p.periodTicksCount);
        setParam(a, 4, p.passOperator);
        setParam(a, 5, p.passColorId);
        setParam(a, 6, p.failColorId);
        setParam(a, 14, p.cargoFilter);

        setParam(a, 7, p.tone);
        setParam(a, 8, p.volume);
        setParam(a, 9, p.pitch);
        setParam(a, 11, p.repeat ? 1 : 0);
        setParam(a, 13, p.length * 10000);
        setParam(a, 18, p.falloffRadius[0] * 10);
        setParam(a, 19, p.falloffRadius[1] * 10);

        setParam(a, 10, p.systemWarningMode);
        setParam(a, 17, p.systemWarningIconId);
        setParam(a, 12, p.alarmMode);

        setParam(a, 20, p.spawnItemOperator);
    },
    decode(a) {
        return {
            targetBeltId: getParam(a, 0),
            offset: getParam(a, 1),
            targetCargoAmount: getParam(a, 2),
            periodTicksCount: getParam(a, 3),
            passOperator: getParam(a, 4),
            passColorId: getParam(a, 5),
            failColorId: getParam(a, 6),
            cargoFilter: getParam(a, 14),

            tone: getParam(a, 7),
            volume: getParam(a, 8),
            pitch: getParam(a, 9),
            repeat: getParam(a, 11) > 0,
            length: getParam(a, 13) / 10000,
            falloffRadius: [getParam(a, 18) / 10, getParam(a, 19) / 10],

            systemWarningMode: getParam(a, 10),
            systemWarningIconId: getParam(a, 17),
            alarmMode: getParam(a, 12),

            spawnItemOperator: getParam(a, 20),
        }
    }
}

export enum DispenserPlayerMode {
    NONE = 0,
    RECYCLE = 1,
    BOTH = 2,
    SUPPLY = 3,
}
export enum DispenserStorageMode {
    NONE = 0,
    SUPPLY = 1,
    DEMAND = 2,
}
export interface DispenserParameters {
    playerMode: DispenserPlayerMode;
    storageMode: DispenserStorageMode;
    workEnergyPerTick: number;
    courierAutoReplenish: boolean;
}

const dispenserParamParser: ParamParser<DispenserParameters> = {
    encodedSize() { return 128; },
    encode(p, a) {
        setParam(a, 0, p.playerMode);
        setParam(a, 1, p.storageMode);
        setParam(a, 2, p.workEnergyPerTick);
        setParam(a, 3, p.courierAutoReplenish ? 1 : 0);
    },
    decode(a) {
        return {
            playerMode: getParam(a, 0),
            storageMode: getParam(a, 1),
            workEnergyPerTick: getParam(a, 2),
            courierAutoReplenish: getParam(a, 3) > 0,
        }
    }
}

interface UnknownParamerters {
    parameters: Int32Array,
}

const unknownParamParser: ParamParser<UnknownParamerters> = {
    encodedSize(p) { return p.parameters.length; },
    encode(p, a) {
        for (let i = 0; i < p.parameters.length; i++)
            setParam(a, i, p.parameters[i]);
    },
    decode(a) {
        const p: UnknownParamerters = {
            parameters: new Int32Array(a.byteLength / Int32Array.BYTES_PER_ELEMENT),
        };
        for (let i = 0; i < p.parameters.length; i++)
            p.parameters[i] = getParam(a, i);
        return p;
    },
}

type AllParameters = AssembleParamerters | StationParameters | AdvancedMiningMachineParameters |
    SplitterParameters | LabParamerters | BeltParameters | InserterParameters |
    TankParameters | StorageParameters | EjectorParameters |
    PowerGeneratorParameters | ArtifacialStarParameters | EnergyExchangerParameters |
    MonitorParameters | BattleBaseParameters | DispenserParameters | UnknownParamerters;

const parameterParsers = new Map<number, ParamParser<AllParameters>>([
    [2103, stationParamsParser(stationDesc)],
    [2104, stationParamsParser(interstellarStationDesc)],
    [2316, advancedMiningMachineParamParser()],
    [2020, splitterParamParser],
    [2901, labParamParser],
    [2902, labParamParser],
    [2001, beltParamParser],
    [2002, beltParamParser],
    [2003, beltParamParser],
    [2011, inserterParamParser],
    [2012, inserterParamParser],
    [2013, inserterParamParser],
    [2014, inserterParamParser],
    [2101, storageParamParser(30)],
    [2102, storageParamParser(60)],
    [2106, tankParamParser],
    [2311, ejectorParamParser],
    [2208, powerGeneratorParamParser],
    [2210, artifacialStarParamParser],
    [2209, energyExchangerParamParser],
    [2030, MonitorParamParser],
    [3009, battleBaseParamParser()],
    [2107, dispenserParamParser],
]);
for (const id of allAssemblers) {
    if (!parameterParsers.has(id))
        parameterParsers.set(id, assembleParamParser);
}

function parserFor(itemId: number) {
    const parser = parameterParsers.get(itemId);
    if (parser !== undefined)
        return parser;
    return unknownParamParser;
}

function importBuilding(r: BufferReader): BlueprintBuilding {
    function readXYZ() {
        return {
            x: r.getFloat32(),
            y: r.getFloat32(),
            z: r.getFloat32(),
        }
    }
    const index = r.getInt32();
    const v2 = index <= -100;
    const b: BlueprintBuilding = {
        index: v2 ? r.getInt32() : index,
        areaIndex: r.getInt8(),
        localOffset: [readXYZ(), readXYZ()],
        yaw: [r.getFloat32(), r.getFloat32()],
        tilt: v2 ? r.getFloat32() : 0.0,
        itemId: r.getInt16(),
        modelIndex: r.getInt16(),
        outputObjIdx: r.getInt32(),
        inputObjIdx: r.getInt32(),
        outputToSlot: r.getInt8(),
        inputFromSlot: r.getInt8(),
        outputFromSlot: r.getInt8(),
        inputToSlot: r.getInt8(),
        outputOffset: r.getInt8(),
        inputOffset: r.getInt8(),
        recipeId: r.getInt16(),
        filterId: r.getInt16(),
        parameters: null,
    };
    const length = r.getInt16();
    if (length > 0) {
        const p = r.getView(length * Int32Array.BYTES_PER_ELEMENT);
        b.parameters = parserFor(b.itemId).decode(p);
    }
    return b;
}

// ===== body version 2（游戏 0.10.34+）=====

const V2_RECORD_MARKER = -102;          // 导出时使用的记录起始标记（0.10.34 格式）
const V2_RECORD_MARKER_MIN = -100;      // 导入时接受的标记下限（0.10.33 用 -101，0.10.34 用 -102）
const V2_BELT_ITEM_IDS = new Set([2001, 2002, 2003]);
const V2_INSERTER_ITEM_IDS = new Set([2011, 2012, 2013, 2014]);

function isV2RecordMarkerAt(bytes: Uint8Array, off: number): boolean {
    if (off + 8 > bytes.length)
        return false;
    // 小端 int32：值 <= -100 即视为记录起始标记
    const marker = bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
    if (marker > V2_RECORD_MARKER_MIN)
        return false;
    // 随后的 index 为非负 int32（小端最高字节 < 0x80）
    return bytes[off + 7] < 0x80;
}

function importBuildingV2(r: BufferReader, bytes: Uint8Array, last: boolean): BlueprintBuilding {
    function readXYZ(): XYZ {
        return {
            x: r.getFloat32(),
            y: r.getFloat32(),
            z: r.getFloat32(),
        }
    }
    const marker = r.getInt32();
    if (marker > V2_RECORD_MARKER_MIN)
        throw new Error('v2 建筑记录起始标记错误');
    const index = r.getInt32();
    const itemId = r.getInt16();
    const modelIndex = r.getInt16();
    const areaIndex = r.getInt8();
    const p0 = readXYZ();
    const yaw0 = r.getFloat32();
    let tilt = 0.0;
    let p1: XYZ = { ...p0 };
    let yaw1 = yaw0;
    let v2ExtraPose: number[] | undefined;
    if (V2_BELT_ITEM_IDS.has(itemId) || V2_INSERTER_ITEM_IDS.has(itemId))
        tilt = r.getFloat32();
    if (V2_INSERTER_ITEM_IDS.has(itemId)) {
        const pose: number[] = [];
        for (let i = 0; i < 7; i++)
            pose.push(r.getFloat32());
        v2ExtraPose = pose;
        // 7 个浮点结构：[reserved, tip.x, tip.y, tip.z, rot.x, rot.y, tip.yaw]
        // 分拣器第二端（尖端）位置位于索引 1..3
        p1 = { x: pose[1], y: pose[2], z: pose[3] };
        yaw1 = pose[6];
    }
    const b: BlueprintBuilding = {
        index,
        areaIndex,
        localOffset: [p0, p1],
        yaw: [yaw0, yaw1],
        tilt,
        itemId,
        modelIndex,
        outputObjIdx: r.getInt32(),
        inputObjIdx: r.getInt32(),
        outputToSlot: r.getInt8(),
        inputFromSlot: r.getInt8(),
        outputFromSlot: r.getInt8(),
        inputToSlot: r.getInt8(),
        outputOffset: r.getInt8(),
        inputOffset: r.getInt8(),
        recipeId: r.getInt16(),
        filterId: r.getInt16(),
        parameters: null,
    };
    if (v2ExtraPose !== undefined)
        b.v2ExtraPose = v2ExtraPose;
    const length = r.getInt16();
    if (length > 0) {
        const p = r.getView(length * Int32Array.BYTES_PER_ELEMENT);
        b.parameters = parserFor(itemId).decode(p);
    }
    // -102 记录（0.10.34+）参数段之后为 content：int32 长度，>0 时再接 7-bit 前缀字符串（信标文本等）
    // -101/-100 记录（0.10.30-0.10.33）无此字段
    if (marker <= V2_RECORD_MARKER) {
        const contentLength = r.getInt32();
        if (contentLength > 0)
            b.content = r.getString();
    }
    // 非最后一条记录：已知字段结束后必须紧接下一记录的起始标记；
    // 若存在未知扩展间隙，则在有限范围内定位下一标记并把间隙作为不透明字节保留
    if (!last) {
        const pos = r.position;
        if (!isV2RecordMarkerAt(bytes, pos)) {
            let next = -1;
            for (let d = 1; d <= V2_RECORD_GAP_LIMIT; d++) {
                if (isV2RecordMarkerAt(bytes, pos + d)) {
                    next = pos + d;
                    break;
                }
            }
            if (next < 0)
                throw new Error('v2 建筑记录存在未知的尾部扩展');
            b.extraBytes = r.getBytes(next - pos);
        }
    }
    return b;
}

/** 非最后一条记录的未知扩展间隙最大搜索字节数 */
const V2_RECORD_GAP_LIMIT = 64;

function exportBuilding(w: BufferWriter, b: BlueprintBuilding) {
    function writeXYZ(v: {x: number, y: number, z: number}) {
        w.setFloat32(v.x);
        w.setFloat32(v.y);
        w.setFloat32(v.z);
    }
    w.setInt32(b.index);
    w.setInt8(b.areaIndex);
    writeXYZ(b.localOffset[0]); writeXYZ(b.localOffset[1]);
    w.setFloat32(b.yaw[0]); w.setFloat32(b.yaw[1]);
    w.setInt16(b.itemId);
    w.setInt16(b.modelIndex);
    w.setInt32(b.outputObjIdx);
    w.setInt32(b.inputObjIdx);
    w.setInt8(b.outputToSlot);
    w.setInt8(b.inputFromSlot);
    w.setInt8(b.outputFromSlot);
    w.setInt8(b.inputToSlot);
    w.setInt8(b.outputOffset);
    w.setInt8(b.inputOffset);
    w.setInt16(b.recipeId);
    w.setInt16(b.filterId);

    if (b.parameters !== null) {
        const parser = parserFor(b.itemId);
        const length = parser.encodedSize(b.parameters);
        w.setInt16(length);
        parser.encode(b.parameters, w.getView(length * Int32Array.BYTES_PER_ELEMENT));
    } else {
        w.setInt16(0);
    }
}

function v2BuildingSize(b: BlueprintBuilding): number {
    // marker4 + index4 + itemId2 + modelIndex2 + areaIndex1 + xyz/yaw 16
    let result = 29;
    if (V2_BELT_ITEM_IDS.has(b.itemId) || V2_INSERTER_ITEM_IDS.has(b.itemId))
        result += 4; // tilt
    if (V2_INSERTER_ITEM_IDS.has(b.itemId))
        result += 7 * 4; // 不透明的第二姿态浮点
    result += 20; // out/in 8 + slots 6 + recipe 2 + filter 2 + plen 2
    if (b.parameters !== null)
        result += parserFor(b.itemId).encodedSize(b.parameters, 2) * Int32Array.BYTES_PER_ELEMENT;
    result += v2ContentSize(b.content); // content 长度前缀（必有）+ 字符串
    if (b.extraBytes !== undefined)
        result += b.extraBytes.length;
    return result;
}

/** -102 记录 content 段大小：int32 长度，非空时再追加 7-bit 前缀 + UTF-8 字节 */
function v2ContentSize(content: string | undefined): number {
    if (content === undefined || content.length === 0)
        return 4;
    const byteLen = new TextEncoder().encode(content).length;
    return 4 + encoded7BitLength(byteLen) + byteLen;
}

function exportBuildingV2(w: BufferWriter, b: BlueprintBuilding) {
    function writeXYZ(v: {x: number, y: number, z: number}) {
        w.setFloat32(v.x);
        w.setFloat32(v.y);
        w.setFloat32(v.z);
    }
    w.setInt32(V2_RECORD_MARKER);
    w.setInt32(b.index);
    w.setInt16(b.itemId);
    w.setInt16(b.modelIndex);
    w.setInt8(b.areaIndex);
    writeXYZ(b.localOffset[0]);
    w.setFloat32(b.yaw[0]);
    if (V2_BELT_ITEM_IDS.has(b.itemId) || V2_INSERTER_ITEM_IDS.has(b.itemId))
        w.setFloat32(b.tilt);
    if (V2_INSERTER_ITEM_IDS.has(b.itemId)) {
        let pose = b.v2ExtraPose;
        if (!pose || pose.length !== 7)
            pose = [0, b.localOffset[1].x, b.localOffset[1].y, b.localOffset[1].z, 0, 0, b.yaw[1]];
        else {
            pose = pose.slice();
            pose[1] = b.localOffset[1].x;
            pose[2] = b.localOffset[1].y;
            pose[3] = b.localOffset[1].z;
            pose[6] = b.yaw[1];
        }
        for (const f of pose)
            w.setFloat32(f);
    }
    w.setInt32(b.outputObjIdx);
    w.setInt32(b.inputObjIdx);
    w.setInt8(b.outputToSlot);
    w.setInt8(b.inputFromSlot);
    w.setInt8(b.outputFromSlot);
    w.setInt8(b.inputToSlot);
    w.setInt8(b.outputOffset);
    w.setInt8(b.inputOffset);
    w.setInt16(b.recipeId);
    w.setInt16(b.filterId);

    if (b.parameters !== null) {
        const parser = parserFor(b.itemId);
        const length = parser.encodedSize(b.parameters, 2);
        w.setInt16(length);
        parser.encode(b.parameters, w.getView(length * Int32Array.BYTES_PER_ELEMENT));
    } else {
        w.setInt16(0);
    }
    // content：int32 写入字符数（与游戏一致），非空时再写 7-bit 前缀的 UTF-8 字符串
    if (b.content !== undefined && b.content.length > 0) {
        w.setInt32(b.content.length);
        w.setString(b.content);
    } else {
        w.setInt32(0);
    }
    if (b.extraBytes !== undefined)
        w.setBytes(b.extraBytes);
}

// ===== v2 body 尾部：patch(int32) + reformDataFlag(u8) + reformData（0.10.33+）=====

const REFORM_COUNT_LIMIT = 2930400; // 星球最大格点数量级，用于合理性校验

function hasReformData(bp: BlueprintData): bp is BlueprintData & { reformData: BlueprintReformData } {
    return bp.reformData != null && bp.reformData.rects.length > 0;
}

function importReformData(r: BufferReader): BlueprintReformData {
    const reserved = r.getUint8();
    const rectLen = r.getInt32();
    if (rectLen < 0 || rectLen > REFORM_COUNT_LIMIT)
        throw new Error('地基数据解析错误：rectLen 超出合法范围');
    const rects: BlueprintReformRect[] = [];
    for (let i = 0; i < rectLen; i++) {
        const rectReserved = r.getUint8();
        const x = r.getInt16();
        const y = r.getInt16();
        const w = r.getUint8();
        const h = r.getUint8();
        const data = r.getUint8();
        const areaIndex = r.getUint8();
        rects.push({
            reserved: rectReserved,
            x, y, w, h,
            // data 高 3 位为地基装饰类型，低 5 位为颜色索引
            type: data >> 5,
            color: data & 0x1F,
            areaIndex,
        });
    }
    const customReformColorMask = r.getUint32();
    const colorLen = r.getInt32();
    if (colorLen < 0 || colorLen > REFORM_COUNT_LIMIT)
        throw new Error('地基数据解析错误：customReformColors 长度超出合法范围');
    const customReformColors: number[] = [];
    for (let i = 0; i < colorLen; i++)
        customReformColors.push(r.getUint32());
    return { reserved, rects, customReformColorMask, customReformColors };
}

function exportReformData(w: BufferWriter, d: BlueprintReformData) {
    w.setUint8(d.reserved);
    w.setInt32(d.rects.length);
    for (const rect of d.rects) {
        w.setUint8(rect.reserved);
        w.setInt16(rect.x);
        w.setInt16(rect.y);
        w.setUint8(rect.w);
        w.setUint8(rect.h);
        w.setUint8(((rect.type & 0x07) << 5) | (rect.color & 0x1F));
        w.setUint8(rect.areaIndex);
    }
    w.setUint32(d.customReformColorMask >>> 0);
    w.setInt32(d.customReformColors.length);
    for (const color of d.customReformColors)
        w.setUint32(color >>> 0);
}

function reformDataSize(d: BlueprintReformData): number {
    // reserved 1 + rectLen 4 + 每 rect 9 + mask 4 + colorLen 4 + 每 color 4
    return 1 + 4 + d.rects.length * 9 + 4 + 4 + d.customReformColors.length * 4;
}

function importTailV2(r: BufferReader, bodyEnd: number) {
    const patch = r.getInt32();
    const reformDataFlag = r.getUint8();
    let reformData: BlueprintReformData | null = null;
    if (reformDataFlag !== 0)
        reformData = importReformData(r);
    const remain = bodyEnd - r.position;
    if (remain < 0)
        throw new Error('蓝图尾部数据解析错误：地基数据超出 body 范围');
    // 0.10.33 早期版本在 flag 之后仍有预留字节（实测 5 字节），语义未知，原样保留
    let tailExtraBytes: Uint8Array | undefined;
    if (remain > 0)
        tailExtraBytes = r.getBytes(remain);
    return { patch, reformData, tailExtraBytes };
}

const START = 'BLUEPRINT:';
const TIME_BASE = new Date(0).setUTCFullYear(1);

export function fromStr(strData: string): BlueprintData {
    if (!strData.startsWith(START))
        throw Error('Invalid start');

    const p1 = strData.indexOf('"', START.length);
    const cells = strData.substring(START.length, p1).split(',');
    // cells[0] 为头部格式标记：0=旧版 12 字段；1=新版 15 字段（短描述后增加作者/蓝图版本/属性）
    const headerFormatV2 = cells[0] === '1';
    if (headerFormatV2 ? cells.length < 15 : cells.length < 12)
        throw Error('Header too short');
    const header = {
        layout: parseInt(cells[1]),
        icons: cells.slice(2, 7).map(s => parseInt(s)),
        time: new Date(TIME_BASE + parseInt(cells[8]) / 10000),
        gameVersion: cells[9],
        shortDesc: decodeURIComponent(cells[10]),
        author: headerFormatV2 ? decodeURIComponent(cells[11]) : '',
        blueprintVersion: headerFormatV2 ? decodeURIComponent(cells[12]) : '',
        properties: headerFormatV2 ? decodeURIComponent(cells[13]) : '',
        desc: decodeURIComponent(headerFormatV2 ? cells[14] : cells[11]),
    }

    const p2 = strData.length - 33;
    if (strData[p2] !== '"')
        throw Error('Checksum not found')
    const d = hex(digest(btoUint8Array(strData.substring(0, p2)).buffer));
    const expectedD = strData.substring(p2 + 1);
    if (d !== expectedD)
        throw Error('Checksum mismatch')

    const encoded = strData.substring(p1 + 1, p2);
    const decoded = pako.ungzip(btoUint8Array(atob(encoded)));
    const reader = new BufferReader(new DataView(decoded.buffer));

    const meta = {
        version: reader.getInt32(),
        cursorOffset: {
            x: reader.getInt32(),
            y: reader.getInt32(),
        },
        cursorTargetArea: reader.getInt32(),
        dragBoxSize: {
            x: reader.getInt32(),
            y: reader.getInt32(),
        },
        primaryAreaIdx: reader.getInt32(),
    };

    const numAreas = reader.getUint8();
    const areas: Array<BlueprintArea> = [];
    for (let i = 0; i < numAreas; i++)
        areas.push(importArea(reader));

    const numBuildings = reader.getInt32();
    const buildings: Array<BlueprintBuilding> = [];
    let patch: number | undefined;
    let reformData: BlueprintReformData | null | undefined;
    let tailExtraBytes: Uint8Array | undefined;
    if (meta.version >= 2) {
        for (let i = 0; i < numBuildings; i++)
            buildings.push(importBuildingV2(reader, decoded, i === numBuildings - 1));
        // 建筑数组之后：patch + reformDataFlag + reformData（+ 0.10.33 预留尾部）
        const tail = importTailV2(reader, decoded.length);
        patch = tail.patch;
        reformData = tail.reformData;
        tailExtraBytes = tail.tailExtraBytes;
    } else {
        for (let i = 0; i < numBuildings; i++)
            buildings.push(importBuilding(reader));
    }

    return {
        header,
        ...meta,
        areas,
        buildings,
        patch,
        reformData,
        tailExtraBytes,
    };
}

function encodedSize(bp: BlueprintData): number {
    let result = 28 // meta
        + 1 // numAreas
        + 14 * bp.areas.length
        + 4; // numBuildings
    if (bp.version >= 2) {
        for (const b of bp.buildings)
            result += v2BuildingSize(b);
        result += 4; // patch
        result += 1; // reformDataFlag
        if (hasReformData(bp))
            result += reformDataSize(bp.reformData);
        if (bp.tailExtraBytes !== undefined)
            result += bp.tailExtraBytes.length;
        return result;
    }
    result += 61 * bp.buildings.length;
    for (const b of bp.buildings) {
        if (b.parameters === null)
            continue;
        const parser = parserFor(b.itemId);
        result += parser.encodedSize(b.parameters) * Int32Array.BYTES_PER_ELEMENT;
    }
    return result;
}

export function toStr(bp: BlueprintData): string {
    const headerFormatV2 = bp.version >= 2;
    let result = START;
    result += headerFormatV2 ? '1,' : '0,';
    result += bp.header.layout;
    result += ',';
    for (const i of bp.header.icons) {
        result += i;
        result += ',';
    }
    result += '0,';
    result += (bp.header.time.getTime() - TIME_BASE) * 10000;
    result += ',';
    result += bp.header.gameVersion;
    result += ',';
    result += encodeURIComponent(bp.header.shortDesc);
    if (headerFormatV2) {
        result += ',';
        result += encodeURIComponent(bp.header.author);
        result += ',';
        result += encodeURIComponent(bp.header.blueprintVersion);
        result += ',';
        result += encodeURIComponent(bp.header.properties);
    }
    result += ',';
    result += encodeURIComponent(bp.header.desc);
    result += '"';

    const decoded = new Uint8Array(encodedSize(bp));
    const writer = new BufferWriter(new DataView(decoded.buffer));
    writer.setInt32(bp.version);
    writer.setInt32(bp.cursorOffset.x);
    writer.setInt32(bp.cursorOffset.y);
    writer.setInt32(bp.cursorTargetArea);
    writer.setInt32(bp.dragBoxSize.x);
    writer.setInt32(bp.dragBoxSize.y);
    writer.setInt32(bp.primaryAreaIdx);

    writer.setUint8(bp.areas.length);
    for (const a of bp.areas)
        exportArea(writer, a);

    writer.setInt32(bp.buildings.length);
    for (const b of bp.buildings) {
        if (bp.version >= 2)
            exportBuildingV2(writer, b);
        else
            exportBuilding(writer, b);
    }

    if (bp.version >= 2) {
        // 预留 patch（游戏 0.10.33+ 实测写 1），随后为地基数据标记与内容
        writer.setInt32(bp.patch ?? 1);
        if (hasReformData(bp)) {
            writer.setUint8(1);
            exportReformData(writer, bp.reformData);
        } else {
            writer.setUint8(0);
        }
        if (bp.tailExtraBytes !== undefined)
            writer.setBytes(bp.tailExtraBytes);
    }

    result += btoa(Uint8ArrayTob(pako.gzip(decoded)));
    const d = hex(digest(btoUint8Array(result).buffer));

    result += '"'
    result += d;

    return result;
}