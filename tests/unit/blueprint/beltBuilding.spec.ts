import { BlueprintBuilding, fromStr, toStr, IODir, StationParameters } from '@/blueprint/parser';
import {
    CreateBuildingCommand,
    createBuilding,
    createEmptyBlueprint,
} from '@/blueprint/create';
import {
    buildBeltLine,
    CreateBeltLineCommand,
    BeltPortEnd,
} from '@/blueprint/beltLine';
import { beltPortAt, portWorldNormal, portWorldOffset } from '@/data/beltPorts';
import { isBelt } from '@/data/items';

/**
 * 传送带 ↔ 建筑 直连（串联）与"建筑骑在带上"（并联）的回归测试。
 *
 * 数据依据：tests/tools/传送带连接建筑_串联.txt / 传送带连接建筑_并联.txt /
 * 物流塔连接传送带.txt（游戏 0.10.35 实测，见 CODE_WIKI §6.20）。
 */

/** 空画布根区域是 161 格高（原点纬度 -80）：放在 y=80 即赤道，cos(lat)=1 */
const Y0 = 80;

function addBuilding(
    bp: ReturnType<typeof createEmptyBlueprint>,
    itemId: number,
    modelIndex: number,
    x: number,
    y: number,
    yaw = 0,
    z = 0
): BlueprintBuilding {
    const b = createBuilding(itemId, modelIndex, { x, y }, yaw, z);
    new CreateBuildingCommand(b).do(bp);
    return b;
}

/** 建筑 → 带端绑定（与 BlueprintEditor 里的取值方式一致） */
function portEnd(
    building: BlueprintBuilding,
    slot: number,
    cosLat = 1
): BeltPortEnd {
    const port = beltPortAt(building.itemId, building.modelIndex, slot);
    if (!port) throw new Error(`no port ${building.itemId}#${slot}`);
    const off = portWorldOffset(port, building.yaw[0], cosLat);
    const n = portWorldNormal(port, building.yaw[0]);
    return {
        building,
        slot,
        point: {
            x: building.localOffset[0].x + off.x,
            y: building.localOffset[0].y + off.y,
            z: off.z,
        },
        nx: n.x,
        ny: n.y,
    };
}

describe('传送带直连建筑（串联）', () => {
    test('起点接建筑口 = 取出：写 inputObjIdx/inputFromSlot，带端位置取口的精确坐标', () => {
        const bp = createEmptyBlueprint();
        const tank = addBuilding(bp, 2106, 121, 5, Y0); // 储液罐：0=+y 口
        const start = portEnd(tank, 0);
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 5 }, 0, 'latFirst', start, null);
        new CreateBeltLineCommand(belts, start, null).do(bp);

        const first = belts[0];
        // 口格记录位置 = 口的精确坐标（1.11 格，非整格）
        expect(first.localOffset[0].x).toBeCloseTo(5, 6);
        expect(first.localOffset[0].y).toBeCloseTo(Y0 + 1.11, 2);
        expect(first.localOffset[1]).toEqual(first.localOffset[0]);
        expect(first.inputObjIdx).toBe(tank.index);
        expect(first.inputFromSlot).toBe(0);
        expect(first.inputToSlot).toBe(1);
        expect(first.inputOffset).toBe(0);
        // 出塔方向 = 口法线（+y → yaw 0）
        expect(first.yaw[0]).toBeCloseTo(0, 6);
        // 建筑自身不写反向引用
        expect(tank.outputObjIdx).toBe(-1);
        expect(tank.inputObjIdx).toBe(-1);
        // 串联：口格 → 后续格 → 末格终结
        expect(first.outputObjIdx).toBe(belts[1].index);
        expect(first.outputToSlot).toBe(1);
        const last = belts[belts.length - 1];
        expect(last.outputObjIdx).toBe(-1);
        expect(last.outputToSlot).toBe(0);
        // 口格外侧一格固定在口的法线方向
        expect(belts[1].localOffset[0].y).toBe(Y0 + 2);
        // 导出再解析后字段不变（导出会把根区域收缩、坐标整体平移，故比较相对位置）
        const back = fromStr(toStr(bp));
        const backFirst = back.buildings.find((b) => isBelt(b.itemId))!;
        const backTank = back.buildings.find((b) => b.itemId === 2106)!;
        expect(backFirst.inputObjIdx).toBe(
            back.buildings.indexOf(backTank)
        );
        expect(backFirst.inputFromSlot).toBe(0);
        expect(
            backFirst.localOffset[0].y - backTank.localOffset[0].y
        ).toBeCloseTo(1.11, 2);
    });

    test('终点接建筑口 = 送入：写 outputObjIdx/outputToSlot，带沿法线反向进入', () => {
        const bp = createEmptyBlueprint();
        const tank = addBuilding(bp, 2106, 121, 5, Y0);
        const end = portEnd(tank, 2); // -y 口
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 - 5 }, { x: 5, y: Y0 }, 0, 'latFirst', null, end);
        new CreateBeltLineCommand(belts, null, end).do(bp);

        const last = belts[belts.length - 1];
        expect(last.localOffset[0].y).toBeCloseTo(Y0 - 1.11, 2);
        expect(last.outputObjIdx).toBe(tank.index);
        expect(last.outputToSlot).toBe(2);
        expect(last.outputFromSlot).toBe(0);
        expect(last.outputOffset).toBe(0);
        expect(last.yaw[0]).toBeCloseTo(0, 6); // 进入口 = 法线反向（-y 口的反向是 +y）
        expect(tank.outputObjIdx).toBe(-1);
        // 末格外侧一格在法线方向
        expect(belts[belts.length - 2].localOffset[0].y).toBe(Y0 - 2);
    });

    test('四向分流器：接到 z=1 的高层口时整条带都在该层', () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 39, 5, Y0); // 一字形：1/3 口在 z=1
        const start = portEnd(splitter, 1);
        expect(start.point.z).toBe(1);
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 4 }, 0, 'latFirst', start, null);
        new CreateBeltLineCommand(belts, start, null).do(bp);
        for (const b of belts) expect(b.localOffset[0].z).toBe(1);
        expect(belts[0].inputObjIdx).toBe(splitter.index);
        expect(belts[0].inputFromSlot).toBe(1);
    });
});

describe('建筑骑在传送带上（并联）', () => {
    test('带从建筑所在格中间穿过：不写任何连接字段', () => {
        const bp = createEmptyBlueprint();
        const before = bp.buildings.length;
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 - 6 }, { x: 5, y: Y0 + 6 }, 0);
        new CreateBeltLineCommand(belts).do(bp);
        // 带贯通后，在带的中间格放一个建筑（喷涂机 / 流速器 / 防御塔都是这种用法）
        const spray = addBuilding(bp, 2313, 120, 5, Y0, 90);
        void before;
        // 建筑与带都没有任何连接字段
        expect(spray.outputObjIdx).toBe(-1);
        expect(spray.inputObjIdx).toBe(-1);
        const onCell = bp.buildings.filter(
            (b) => isBelt(b.itemId) && b.localOffset[0].y === Y0
        );
        expect(onCell).toHaveLength(1);
        expect(onCell[0].inputObjIdx).toBe(-1);
        // 带线仍然连贯（穿过建筑所在格，没有被截断）
        expect(onCell[0].outputObjIdx).not.toBe(-1);
        // 导出再解析后二者仍共存（导出会整体平移坐标，故比较同一格）
        const back = fromStr(toStr(bp));
        const backSpray = back.buildings.find((b) => b.itemId === 2313)!;
        const backBelt = back.buildings.find(
            (b) =>
                isBelt(b.itemId) &&
                b.localOffset[0].y === backSpray.localOffset[0].y &&
                b.localOffset[0].x === backSpray.localOffset[0].x
        )!;
        expect(backBelt).toBeDefined();
        expect(backBelt.inputObjIdx).toBe(-1);
    });

    test('建筑已经骑在带上时再在此格铺带：带照常穿过，不产生连接', () => {
        const bp = createEmptyBlueprint();
        const monitor = addBuilding(bp, 2030, 208, 5, Y0, 90);
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 - 4 }, { x: 5, y: Y0 + 4 }, 0);
        new CreateBeltLineCommand(belts).do(bp);
        expect(monitor.outputObjIdx).toBe(-1);
        expect(monitor.inputObjIdx).toBe(-1);
        const onCell = bp.buildings.find(
            (b) => isBelt(b.itemId) && b.localOffset[0].y === Y0
        )!;
        expect(onCell.outputObjIdx).not.toBe(-1); // 带继续往前走，没有被建筑挡住
    });
});

describe('物流站口方向随传送带连接同步', () => {
    test('带从站取出 → slots[i].dir=1（出塔）；撤销还原', () => {
        const bp = createEmptyBlueprint();
        const station = addBuilding(bp, 2104, 50, 5, Y0);
        const params = station.parameters as StationParameters;
        expect(params.slots[1].dir).toBe(IODir.None);

        const start = portEnd(station, 1);
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 6 }, 0, 'latFirst', start, null);
        const cmd = new CreateBeltLineCommand(belts, start, null);
        cmd.do(bp);
        expect(params.slots[1].dir).toBe(IODir.Output);
        // 其它口不受影响
        expect(params.slots[0].dir).toBe(IODir.None);
        cmd.undo(bp);
        expect(params.slots[1].dir).toBe(IODir.None);
        expect(bp.buildings).toHaveLength(1);
    });

    test('带送入站 → slots[i].dir=2（入塔）', () => {
        const bp = createEmptyBlueprint();
        const station = addBuilding(bp, 2103, 49, 5, Y0);
        const params = station.parameters as StationParameters;
        const end = portEnd(station, 7); // -y 口
        const belts = buildBeltLine(2001, 35, { x: 5, y: Y0 - 6 }, { x: 5, y: Y0 }, 0, 'latFirst', null, end);
        new CreateBeltLineCommand(belts, null, end).do(bp);
        expect(params.slots[7].dir).toBe(IODir.Input);
        const back = fromStr(toStr(bp));
        const st = back.buildings.find((b) => b.itemId === 2103)!;
        expect((st.parameters as StationParameters).slots[7].dir).toBe(IODir.Input);
    });

    test('口已被占用时不覆盖：新的带在口格前截断，站的口方向保持原值', () => {
        const bp = createEmptyBlueprint();
        const station = addBuilding(bp, 2104, 50, 5, Y0);
        const params = station.parameters as StationParameters;
        const start = portEnd(station, 1);
        const first = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 6 }, 0, 'latFirst', start, null);
        new CreateBeltLineCommand(first, start, null).do(bp);
        expect(params.slots[1].dir).toBe(IODir.Output);

        // 再从同一个口铺一条：口格已占用 → 截断（不新建任何格、不改口方向）
        const start2 = portEnd(station, 1);
        const second = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 8 }, 0, 'latFirst', start2, null);
        const countBefore = bp.buildings.length;
        new CreateBeltLineCommand(second, start2, null).do(bp);
        expect(bp.buildings).toHaveLength(countBefore);
        expect(params.slots[1].dir).toBe(IODir.Output);
    });
});

/**
 * 用户反馈："传送带接分流器没有连接"。
 * 根因：分流器四个口的记录位置都在 ±0.2 格（口贴在建筑上，游戏如此），`round()` 后
 * **全部落在分流器自己那一格**；旧实现按"格"判重，于是给第二个口接带时被判成
 * "该格已有带"而整条丢弃 → 看起来完全没反应。
 * 现在口带按**口身份**（取/送方向 + 建筑 + 口编号 + 高度层）判重，同一分流器的不同口互不冲突。
 * 字段形态与游戏样本 `splitter_6states_game_sample.txt` 一致：
 * 送入 = `out=<分流器>/<口>/0/0 in=-1/0/1/0`，取出 = `in=<分流器>/<口>/1/0 out=<下一格>/1/0/0`。
 */
describe('四向分流器：同一分流器的多个口各接一条带', () => {
    test('2 口送入 + 0 口取出 都能接上（旧实现第二条会被整条丢弃）', () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 38, 15, Y0);

        // 送入 2 口（-y）：带从南侧进来
        const end2 = portEnd(splitter, 2);
        expect(end2.point.z).toBe(0);
        expect(end2.point.y).toBeCloseTo(Y0 - 0.2, 6);
        const incoming = buildBeltLine(2001, 35, { x: 15, y: Y0 - 4 }, { x: 15, y: Y0 }, 0, 'latFirst', null, end2);
        new CreateBeltLineCommand(incoming, null, end2).do(bp);
        const lastIn = incoming[incoming.length - 1];
        expect(lastIn.outputObjIdx).toBe(splitter.index);
        expect(lastIn.outputToSlot).toBe(2);
        expect(lastIn.outputFromSlot).toBe(0);
        expect(lastIn.outputOffset).toBe(0);
        expect(lastIn.localOffset[0].y).toBeCloseTo(Y0 - 0.2, 2);
        expect(lastIn.inputObjIdx).toBe(-1);
        expect(lastIn.inputToSlot).toBe(1);

        // 取出 0 口（+y）：带向北离开 —— 关键回归点
        const start0 = portEnd(splitter, 0);
        expect(start0.point.y).toBeCloseTo(Y0 + 0.2, 6);
        const outgoing = buildBeltLine(2001, 35, { x: 15, y: Y0 }, { x: 15, y: Y0 + 4 }, 0, 'latFirst', start0, null);
        new CreateBeltLineCommand(outgoing, start0, null).do(bp);
        const firstOut = outgoing[0];
        expect(firstOut.inputObjIdx).toBe(splitter.index);
        expect(firstOut.inputFromSlot).toBe(0);
        expect(firstOut.inputToSlot).toBe(1);
        expect(firstOut.inputOffset).toBe(0);
        expect(firstOut.localOffset[0].y).toBeCloseTo(Y0 + 0.2, 2);
        // 取出带的链首仍要指向下一格（不能因为口绑定把链路写丢）
        expect(firstOut.outputObjIdx).toBe(outgoing[1].index);
        expect(firstOut.outputToSlot).toBe(1);

        // 导出再解析：两条口带都在、连接字段都在
        const back = fromStr(toStr(bp));
        const sp = back.buildings.find((b) => b.itemId === 2020)!;
        const belts = back.buildings.filter((b) => isBelt(b.itemId));
        expect(belts.some((b) => b.outputObjIdx === sp.index && b.outputToSlot === 2)).toBe(true);
        expect(belts.some((b) => b.inputObjIdx === sp.index && b.inputFromSlot === 0)).toBe(true);
    });

    test('同一个口再接第二条 → 在口格前截断，该口仍只有第一条带', () => {
        const bp = createEmptyBlueprint();
        const splitter = addBuilding(bp, 2020, 38, 15, Y0);
        const end2 = portEnd(splitter, 2);
        const first = buildBeltLine(2001, 35, { x: 15, y: Y0 - 4 }, { x: 15, y: Y0 }, 0, 'latFirst', null, end2);
        new CreateBeltLineCommand(first, null, end2).do(bp);

        const end2b = portEnd(splitter, 2);
        const again = buildBeltLine(2001, 35, { x: 15, y: Y0 - 6 }, { x: 15, y: Y0 }, 0, 'latFirst', null, end2b);
        new CreateBeltLineCommand(again, null, end2b).do(bp);
        // 口上仍只有第一条带（第二次拖拽在口格前截断，前缀格保留为普通带）
        const bound = bp.buildings.filter(
            (b) =>
                isBelt(b.itemId) &&
                b.outputObjIdx === splitter.index &&
                b.outputToSlot === 2
        );
        expect(bound).toHaveLength(1);
        expect(bound[0].localOffset[0].y).toBeCloseTo(Y0 - 0.2, 2);
    });

    test('同一格不同高度层是允许的（游戏里的桥接带）', () => {
        const bp = createEmptyBlueprint();
        // 地面层一条直带
        const ground = buildBeltLine(2001, 35, { x: 5, y: Y0 - 3 }, { x: 5, y: Y0 + 3 }, 0);
        new CreateBeltLineCommand(ground).do(bp);
        expect(bp.buildings.filter((b) => isBelt(b.itemId))).toHaveLength(7);
        // 同一格放一条 z=0.5 的带：不判重、照常新增
        const raised = buildBeltLine(2001, 35, { x: 5, y: Y0 }, { x: 5, y: Y0 + 2 }, 0);
        for (const b of raised) {
            for (const p of b.localOffset) p.z = 0.5;
        }
        new CreateBeltLineCommand(raised).do(bp);
        const atY0 = bp.buildings.filter(
            (b) => isBelt(b.itemId) && Math.round(b.localOffset[0].y) === Y0
        );
        expect(atY0).toHaveLength(2);
    });
});
