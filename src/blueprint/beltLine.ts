import { BlueprintBuilding, BlueprintData, IODir } from "./parser";
import { Command } from "@/command";
import { ensureAreaFor, ROOT_GRID_SIZE } from "./area";
import { createBuilding } from "./create";

/** 传送带路径走法模式（R 键循环切换） */
export type BeltPathMode =
    | "latFirst" // 默认：先走纬度线（x/东西），后走经度线（y/南北）
    | "lonFirst" // 先走经度线（y/南北），后走纬度线（x/东西）
    | "straight"; // 两点之间直线（Bresenham 栅格化，每步仅一方向）

/** 经向短弧位移：把 x1-x0 归一化到 (-ROOT_GRID_SIZE/2, ROOT_GRID_SIZE/2] */
function shortArcDelta(x0: number, x1: number): number {
    let dx = x1 - x0;
    dx =
        ((((dx + ROOT_GRID_SIZE / 2) % ROOT_GRID_SIZE) + ROOT_GRID_SIZE) %
            ROOT_GRID_SIZE) -
        ROOT_GRID_SIZE / 2;
    return dx;
}

/** L 形路径：先走 x 方向 stepsX 步，再走 y 方向 stepsY 步 */
function lShape(
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    xFirst: boolean
): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    let x = x0,
        y = y0;
    pts.push({ x, y });

    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepsX = Math.abs(Math.round(dx));
    const stepsY = Math.abs(Math.round(dy));

    const first = xFirst
        ? {
              fn: () => {
                  x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
              },
              n: stepsX,
          }
        : {
              fn: () => {
                  y += sy;
              },
              n: stepsY,
          };
    const second = xFirst
        ? {
              fn: () => {
                  y += sy;
              },
              n: stepsY,
          }
        : {
              fn: () => {
                  x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
              },
              n: stepsX,
          };

    for (let i = 0; i < first.n; i++) {
        first.fn();
        pts.push({ x, y });
    }
    for (let i = 0; i < second.n; i++) {
        second.fn();
        pts.push({ x, y });
    }
    return pts;
}

/** 直线栅格化（Bresenham）：每步仅沿 x 或 y 移动一格，处理经向短弧 */
function bresenham(
    x0: number,
    y0: number,
    dx: number,
    dy: number
): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    const adx = Math.abs(dx),
        ady = Math.abs(dy);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    let err = adx - ady;
    let x = x0,
        y = y0;
    pts.push({ x, y });
    while (x !== (x0 + dx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE || y !== y0 + dy) {
        const e2 = 2 * err;
        if (e2 > -ady) {
            err -= ady;
            x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
        } else if (e2 < adx) {
            err += adx;
            y += sy;
        }
        pts.push({ x, y });
    }
    return pts;
}

/**
 * 整数网格上的传送带路径栅格化：返回从 (p0) 到 (p1) 的相邻格点，
 * 每步仅沿 x 或 y 移动一格，符合 DSP 传送带只能走 cardinal 方向的约束。
 * x 方向为经向环形坐标（0 ~ ROOT_GRID_SIZE），自动取短弧。
 * @param mode 路径走法：latFirst / lonFirst / straight
 */
export function rasterizeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    mode: BeltPathMode = "latFirst"
): { x: number; y: number }[] {
    const dx = shortArcDelta(x0, x1);
    const dy = y1 - y0;
    if (mode === "straight") return bresenham(x0, y0, dx, dy);
    return lShape(x0, y0, dx, dy, mode === "latFirst");
}

/** 下游相对方向 (dx,dy) → 传送带 yaw（由真实蓝图标定） */
const DIR_YAW = new Map<string, number>([
    ["0,1", 0], // +y
    ["1,0", 90], // +x
    ["0,-1", 180], // -y
    ["-1,0", 270], // -x
]);

/**
 * 计算经向环形坐标上相邻格点的方向差，归一化到 {-1, 0, 1}。
 * 处理跨越 0 经线的情况：如 999→0 实为 +x 方向，0→999 实为 -x 方向。
 */
function ringDelta(from: number, to: number): number {
    const d = to - from;
    if (d > 1) return -1;
    if (d < -1) return 1;
    return d;
}

/** 相邻两格 (a→b) 的方向 yaw；非相邻或重合返回 null */
function stepYaw(
    a: { x: number; y: number },
    b: { x: number; y: number }
): number | null {
    const ddx = ringDelta(a.x, b.x);
    const ddy = b.y - a.y;
    return DIR_YAW.get(`${ddx},${ddy}`) ?? null;
}

/**
 * 单元格 yaw = **进入方向与离开方向的平分角**（游戏真实蓝图实测）。
 * 直格两者相同 → 就是行进方向；拐角格两者相差 90° → 得到 45° 的斜角
 * （例如东进南出 → 135°，南进西出 → 225°），游戏里的转弯格正是这么存的；
 * 只写"离开方向"会让传送带在拐角处缺失 45° 过渡。
 */
function cellYaw(
    prev: { x: number; y: number } | null,
    next: { x: number; y: number } | null,
    self: { x: number; y: number },
    fallbackYaw: number
): number {
    const dirIn = prev === null ? null : stepYaw(prev, self);
    const dirOut = next === null ? null : stepYaw(self, next);
    if (dirIn === null) return dirOut ?? fallbackYaw;
    if (dirOut === null) return dirIn;
    const rad = Math.PI / 180;
    const vx = Math.sin(dirIn * rad) + Math.sin(dirOut * rad);
    const vy = Math.cos(dirIn * rad) + Math.cos(dirOut * rad);
    if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) return dirOut; // 180° 折返（不应出现）：退回离开方向
    const deg = Math.atan2(vx, vy) / rad;
    return (deg + 360) % 360;
}

/**
 * 传送带端点绑定的建筑口（起/止各一个，见 `@/data/beltPorts` 的标定表）。
 * 起点的口 = **取出**（建筑→带：`inputObjIdx/inputFromSlot`），
 * 终点的口 = **送入**（带→建筑：`outputObjIdx/outputToSlot`），与游戏一致；
 * 建筑自身不写反向引用（真实蓝图里建筑的 out/in 恒为 -1/0/0/0）。
 */
export interface BeltPortEnd {
    /** 目标建筑（其 `index` 必须是当前蓝图里的值） */
    building: BlueprintBuilding;
    /** 建筑上的口编号（游戏 slot） */
    slot: number;
    /** 口的网格坐标：可为分数（口不在整格上），z 为高度格 */
    point: { x: number; y: number; z: number };
    /** 口的朝外法线（网格轴向单位向量） */
    nx: number;
    /** 口的朝外法线（网格轴向单位向量） */
    ny: number;
}

/** 口所在格的**整数身份**（经向回绕到 0..ROOT_GRID_SIZE） */
function portCell(point: { x: number; y: number }): { x: number; y: number } {
    return {
        x: wrapX(Math.round(point.x)),
        y: Math.round(point.y),
    };
}

function wrapX(x: number): number {
    return ((x % ROOT_GRID_SIZE) + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
}

/** 口格的**记录位置**写成口的精确坐标（游戏即如此：带端贴在建筑口上，位置是分数） */
function placeAtPort(
    belt: BlueprintBuilding,
    point: { x: number; y: number; z: number }
): void {
    const x = wrapX(point.x);
    for (const p of belt.localOffset) {
        p.x = x;
        p.y = point.y;
        p.z = point.z;
    }
}

/** 高度层（0.1 格精度）：同一格不同高度是游戏允许的桥接（样本有同格 z=0 / z=0.5 两条带） */
function zLayer(z: number): number {
    return Math.round(z * 10) / 10;
}

/** 普通传送带的"格身份"：格 + 高度层 */
function cellKey(b: BlueprintBuilding): string {
    return `${wrapX(Math.round(b.localOffset[0].x))},${Math.round(
        b.localOffset[0].y
    )},${zLayer(b.localOffset[0].z)}`;
}

/**
 * 接在建筑口上的传送带的身份 = **口**（取/送方向 + 建筑 index + 口编号 + 高度层）。
 *
 * 为什么不能按格判重：口格的记录位置是口的**精确坐标**（游戏如此，见 {@link placeAtPort}），
 * 四向分流器四个口都在 ±0.2 格处 → `round()` 后全部落在**分流器自己那一格**。
 * 按格判重会把"给第二个口接带"误判成"该格已有带"而整条丢弃，
 * 表现为"传送带接分流器没反应 / 没有连接"（用户反馈，样本 `分流器6状态.txt` 里
 * 同一分流器的 0 口与 2 口各有一条带）。
 *
 * 注意：只有被连接的一端是**建筑**时才算"口带"；带↔带的串联仍是普通格身份
 * （否则每一条串联带都会变成"口带"，同格截断判定就失效了）。
 */
function portKey(
    b: BlueprintBuilding,
    byIndex: ReadonlyMap<number, BlueprintBuilding>
): string | null {
    const isInput = b.inputObjIdx >= 0;
    const idx = isInput ? b.inputObjIdx : b.outputObjIdx;
    if (idx < 0) return null;
    const other = byIndex.get(idx);
    if (!other || isBelt(other)) return null;
    const slot = isInput ? b.inputFromSlot : b.outputToSlot;
    return `${isInput ? "in" : "out"}:${idx}:${slot}:${zLayer(
        b.localOffset[0].z
    )}`;
}

/** 传送带在占用表里的键：口带按口身份，普通带按格身份 */
function occupancyKey(
    b: BlueprintBuilding,
    byIndex: ReadonlyMap<number, BlueprintBuilding>
): string {
    return portKey(b, byIndex) ?? cellKey(b);
}

/** 判断某格上是否已有传送带（同 itemId 家族：2001/2002/2003） */
function isBelt(b: BlueprintBuilding): boolean {
    return b.itemId >= 2001 && b.itemId <= 2003;
}

/**
 * 由拖拽起止网格点构造一条传送带（尚未入库）。
 * 每格 yaw = 进入/离开方向的平分角（拐角处为 45° 斜角，与游戏一致）；
 * 末格延续最后一段方向，单点时退回 @param fallbackYaw。
 * 相邻格之间的 outputObjIdx 在命令执行、index 分配后建立。
 *
 * 端点绑定建筑口时（@param startPort / @param endPort）：
 * - 口格的**身份**取 `round(口坐标)`，**记录位置**写成口的精确坐标；
 * - 口格的外侧一格固定为 `口格 + 口法线`，保证带沿口的面离开/进入（游戏要求）；
 * - 整条带的高度 = 口的高度（接到 z≠0 的口时整条带在该层，见 `@/data/beltPorts`）；
 * - 连接字段（out/in + slot + offset）在构造时就写好，由命令分配 index 后生效。
 * @param pathMode 路径走法模式
 */
export function buildBeltLine(
    itemId: number,
    modelIndex: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    fallbackYaw: number,
    pathMode: BeltPathMode = "latFirst",
    startPort: BeltPortEnd | null = null,
    endPort: BeltPortEnd | null = null
): BlueprintBuilding[] {
    const z = startPort ? startPort.point.z : endPort ? endPort.point.z : 0;
    const g0 = startPort ? portCell(startPort.point) : { ...p0 };
    const g1 = endPort ? portCell(endPort.point) : { ...p1 };
    const b0 = startPort
        ? { x: wrapX(g0.x + startPort.nx), y: g0.y + startPort.ny }
        : g0;
    const b1 = endPort
        ? { x: wrapX(g1.x + endPort.nx), y: g1.y + endPort.ny }
        : g1;
    const pts = rasterizeLine(b0.x, b0.y, b1.x, b1.y, pathMode);
    if (startPort) pts.unshift(g0);
    if (endPort) pts.push(g1);
    const belts = pts.map((p) => createBuilding(itemId, modelIndex, p, 0, z));
    for (let i = 0; i < belts.length; i++) {
        const yaw = cellYaw(
            pts[i - 1] ?? null,
            pts[i + 1] ?? null,
            pts[i],
            fallbackYaw
        );
        belts[i].yaw = [yaw, yaw];
        // 传送带 slot 与游戏一致：inputToSlot 恒为 1；outputToSlot 为 1（有下游）或 0（末格）
        belts[i].inputToSlot = 1;
        belts[i].outputToSlot = i < belts.length - 1 ? 1 : 0;
    }
    // 口格：记录位置改成口的精确坐标 + 写连接字段
    if (startPort) {
        const first = belts[0];
        placeAtPort(first, startPort.point);
        first.inputObjIdx = startPort.building.index;
        first.inputFromSlot = startPort.slot;
        first.inputToSlot = 1;
        first.inputOffset = 0;
    }
    if (endPort) {
        const last = belts[belts.length - 1];
        placeAtPort(last, endPort.point);
        last.outputObjIdx = endPort.building.index;
        last.outputToSlot = endPort.slot;
        last.outputFromSlot = 0;
        last.outputOffset = 0;
    }
    return belts;
}

/**
 * 批量铺设一条传送带：整条作为一个命令，一次撤销移除整段。
 *
 * 执行时统一分配 index/area，再按顺序串联相邻格（只写 outputObjIdx，与游戏一致；
 * 末格 outputObjIdx=-1、outputToSlot=0）。已存在传送带的格子处理规则：
 * - 该格是**已有线路的末格**（没有下游）→ 复用（含它的 index 与所有引用），
 *   常见于"接着上一段继续画"；并用实际上下游重算它的 yaw（跨拖拽拼接处进入方向
 *   来自上一次拖拽）。
 * - 该格在**已有线路中间**（已有下游）→ 再接入会形成两个上游，游戏不支持
 *   （需要分流器/集装机），因此本次拖拽在冲突格**之前**截断：冲突格与其后的格都不新建，
 *   已建的前缀保留并正常终结，老线路逐字段不变。
 *
 * 这样多次拖拽拼接不会出现"同一格两条传送带"（游戏里一格只能有一条）。
 * 撤销时弹出新增格并恢复被复用格的 yaw。
 */
export class CreateBeltLineCommand implements Command {
    private prevSizeX = 0;
    /** 复用的已有传送带：撤销时恢复其原 yaw */
    private reused: { belt: BlueprintBuilding; yaw: [number, number] }[] = [];
    /** 本次实际新增的传送带数量（undo 时按此弹出） */
    private added = 0;
    /** 本次建立的路径（新建 + 复用的对象，按路径顺序） */
    private path: BlueprintBuilding[] = [];
    /** 物流站口方向改动（撤销时逐口还原） */
    private portDirChanges: {
        building: BlueprintBuilding;
        slot: number;
        prev: number;
    }[] = [];
    /** 起点/终点是否真的接上了建筑口（被截断时不算） */
    private connectedStart = false;
    private connectedEnd = false;

    constructor(
        private readonly belts: BlueprintBuilding[],
        /** 起点绑定的建筑口（取出：建筑→带） */
        private readonly startPort: BeltPortEnd | null = null,
        /** 终点绑定的建筑口（送入：带→建筑） */
        private readonly endPort: BeltPortEnd | null = null
    ) {}

    do(data: BlueprintData): void {
        this.reused = [];
        this.added = 0;
        this.path = [];
        this.portDirChanges = [];
        this.connectedStart = false;
        this.connectedEnd = false;
        if (this.belts.length === 0) return;
        const root = data.areas[0];
        this.prevSizeX = root.size.x;

        const existing = new Map<string, BlueprintBuilding>();
        /** index → 建筑（判断"带接的是建筑还是带"用） */
        const byIndex = new Map<number, BlueprintBuilding>();
        for (const b of data.buildings) byIndex.set(b.index, b);
        for (const b of data.buildings) {
            if (isBelt(b)) existing.set(occupancyKey(b, byIndex), b);
        }

        for (let i = 0; i < this.belts.length; i++) {
            const b = this.belts[i];
            const portBound =
                (i === 0 && this.startPort !== null) ||
                (i === this.belts.length - 1 && this.endPort !== null);
            const hit = existing.get(occupancyKey(b, byIndex));
            if (hit !== undefined) {
                // 口已被占用：该口已经有带（游戏里一个口只能接一条），本次拖拽截断
                if (portBound) break;
                // 该格已在某条线路**中间**（已有下游）：再接入会形成两个上游，游戏不支持
                // （需要分流器/集装机）。此时截断本次拖拽：不改动已有格、也不再新建后续格，
                // 保证老线路完整且不产生非法数据。
                if (hit.outputObjIdx >= 0) break;
                // 复用它（常见于"接着上一段继续画"：上一段末格没有下游）
                this.reused.push({ belt: hit, yaw: [hit.yaw[0], hit.yaw[1]] });
                this.path.push(hit);
                continue;
            }
            const areaIndex = ensureAreaFor(data, b.localOffset[0]);
            if (areaIndex < 0)
                throw new Error("Placement outside equator band");
            b.areaIndex = areaIndex;
            b.index = data.buildings.length;
            data.buildings.push(b);
            byIndex.set(b.index, b);
            existing.set(occupancyKey(b, byIndex), b);
            this.path.push(b);
            this.added++;
        }
        if (this.path.length === 0) return;

        // 路径内部连接：仅通过 outputObjIdx 串联（与游戏一致，inputObjIdx 恒为 -1）。
        for (let i = 0; i < this.path.length - 1; i++) {
            const cur = this.path[i];
            cur.outputObjIdx = this.path[i + 1].index;
            cur.outputToSlot = 1;
        }
        // 末格终结：与游戏一致 outputObjIdx=-1、outputToSlot=0
        // （复用格必无下游，见上面的截断规则）
        const last = this.path[this.path.length - 1];
        const lastIsEndPort =
            this.endPort !== null &&
            this.belts.length > 0 &&
            last === this.belts[this.belts.length - 1];
        if (lastIsEndPort) {
            // 送入建筑口：连接字段由 buildBeltLine 写好，这里保留（不能清成 -1）
            last.outputObjIdx = this.endPort!.building.index;
            last.outputToSlot = this.endPort!.slot;
            last.outputFromSlot = 0;
            last.outputOffset = 0;
            this.connectedEnd = true;
        } else {
            last.outputObjIdx = -1;
            last.outputToSlot = 0;
        }
        // 起点绑定建筑口：buildBeltLine 已写好 inputObjIdx/inputFromSlot
        const firstIsStartPort =
            this.startPort !== null &&
            this.path[0] === this.belts[0] &&
            this.belts[0].inputObjIdx >= 0;
        if (firstIsStartPort) this.connectedStart = true;
        if (this.connectedStart || this.connectedEnd)
            this.syncStationPorts(data);

        // 复用格：yaw 按**实际**上下游重算（多次拖拽拼接时进入方向来自上一次拖拽）
        for (const r of this.reused) {
            const cell = r.belt;
            const succ =
                cell.outputObjIdx >= 0
                    ? byIndex.get(cell.outputObjIdx) ?? null
                    : null;
            const pred =
                cell.index >= 0
                    ? data.buildings.find(
                          (b) =>
                              b !== cell &&
                              isBelt(b) &&
                              b.outputObjIdx === cell.index
                      ) ?? null
                    : null;
            const yaw = cellYaw(
                pred?.localOffset[0] ?? null,
                succ?.localOffset[0] ?? null,
                cell.localOffset[0],
                cell.yaw[0]
            );
            cell.yaw = [yaw, yaw];
        }
    }

    /**
     * 传送带接到物流站口时，站自己的口配置要同步方向：
     * 出塔（带从站取出）= `dir 1`，入塔（带送入站）= `dir 2`；撤销时逐口还原。
     * 只有参数里带 `slots` 的建筑（物流站）需要，其余建筑不写反向引用。
     */
    private syncStationPorts(data: BlueprintData): void {
        const bindings: { building: BlueprintBuilding; slot: number; dir: number }[] =
            [];
        if (this.connectedStart && this.startPort)
            bindings.push({
                building: this.startPort.building,
                slot: this.startPort.slot,
                dir: IODir.Output,
            });
        if (this.connectedEnd && this.endPort)
            bindings.push({
                building: this.endPort.building,
                slot: this.endPort.slot,
                dir: IODir.Input,
            });
        const live = new Set(data.buildings);
        for (const b of bindings) {
            if (!live.has(b.building)) continue;
            const params = b.building.parameters as
                | { slots?: { dir: number }[] }
                | null;
            const slot = params?.slots?.[b.slot];
            if (!slot) continue;
            this.portDirChanges.push({
                building: b.building,
                slot: b.slot,
                prev: slot.dir,
            });
            slot.dir = b.dir;
        }
    }

    undo(data: BlueprintData): void {
        for (const c of this.portDirChanges) {
            const params = c.building.parameters as
                | { slots?: { dir: number }[] }
                | null;
            const slot = params?.slots?.[c.slot];
            if (slot) slot.dir = c.prev;
        }
        this.portDirChanges = [];
        for (let i = 0; i < this.added; i++) data.buildings.pop();
        for (const r of this.reused) r.belt.yaw = [r.yaw[0], r.yaw[1]];
        data.areas[0].size.x = this.prevSizeX;
    }

    merge() {
        return false;
    }
}
