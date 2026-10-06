import { BlueprintBuilding, BlueprintData } from "./parser";
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
 * 由拖拽起止网格点构造一条传送带（尚未入库）。
 * 每格 yaw = 进入/离开方向的平分角（拐角处为 45° 斜角，与游戏一致）；
 * 末格延续最后一段方向，单点时退回 @param fallbackYaw。
 * 相邻格之间的 outputObjIdx 在命令执行、index 分配后建立。
 * @param pathMode 路径走法模式
 */
export function buildBeltLine(
    itemId: number,
    modelIndex: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    fallbackYaw: number,
    pathMode: BeltPathMode = "latFirst"
): BlueprintBuilding[] {
    const pts = rasterizeLine(p0.x, p0.y, p1.x, p1.y, pathMode);
    const belts = pts.map((p) => createBuilding(itemId, modelIndex, p, 0));
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
    return belts;
}

/** 判断某格上是否已有传送带（同 itemId 家族：2001/2002/2003） */
function isBelt(b: BlueprintBuilding): boolean {
    return b.itemId >= 2001 && b.itemId <= 2003;
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

    constructor(private readonly belts: BlueprintBuilding[]) {}

    do(data: BlueprintData): void {
        this.reused = [];
        this.added = 0;
        this.path = [];
        if (this.belts.length === 0) return;
        const root = data.areas[0];
        this.prevSizeX = root.size.x;

        const key = (b: BlueprintBuilding) =>
            `${b.localOffset[0].x},${b.localOffset[0].y}`;
        const existing = new Map<string, BlueprintBuilding>();
        for (const b of data.buildings) {
            if (isBelt(b)) existing.set(key(b), b);
        }

        for (const b of this.belts) {
            const hit = existing.get(key(b));
            if (hit !== undefined) {
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
            existing.set(key(b), b);
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
        last.outputObjIdx = -1;
        last.outputToSlot = 0;

        // 复用格：yaw 按**实际**上下游重算（多次拖拽拼接时进入方向来自上一次拖拽）
        const byIndex = new Map<number, BlueprintBuilding>();
        for (const b of data.buildings) byIndex.set(b.index, b);
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

    undo(data: BlueprintData): void {
        for (let i = 0; i < this.added; i++) data.buildings.pop();
        for (const r of this.reused) r.belt.yaw = [r.yaw[0], r.yaw[1]];
        data.areas[0].size.x = this.prevSizeX;
    }

    merge() {
        return false;
    }
}
