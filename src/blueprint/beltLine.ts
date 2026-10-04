import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command } from "@/command";
import { ensureAreaFor, ROOT_GRID_SIZE } from "./area";
import { createBuilding } from "./create";

/** 传送带路径走法模式（R 键循环切换） */
export type BeltPathMode =
    | 'latFirst'   // 默认：先走纬度线（x/东西），后走经度线（y/南北）
    | 'lonFirst'   // 先走经度线（y/南北），后走纬度线（x/东西）
    | 'straight';  // 两点之间直线（Bresenham 栅格化，每步仅一方向）

/** 经向短弧位移：把 x1-x0 归一化到 (-ROOT_GRID_SIZE/2, ROOT_GRID_SIZE/2] */
function shortArcDelta(x0: number, x1: number): number {
    let dx = x1 - x0;
    dx = ((dx + ROOT_GRID_SIZE / 2) % ROOT_GRID_SIZE + ROOT_GRID_SIZE) % ROOT_GRID_SIZE
        - ROOT_GRID_SIZE / 2;
    return dx;
}

/** L 形路径：先走 x 方向 stepsX 步，再走 y 方向 stepsY 步 */
function lShape(
    x0: number, y0: number,
    dx: number, dy: number,
    xFirst: boolean,
): { x: number, y: number }[] {
    const pts: { x: number, y: number }[] = [];
    let x = x0, y = y0;
    pts.push({ x, y });

    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepsX = Math.abs(Math.round(dx));
    const stepsY = Math.abs(Math.round(dy));

    const first = xFirst
        ? { fn: () => { x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE; }, n: stepsX }
        : { fn: () => { y += sy; }, n: stepsY };
    const second = xFirst
        ? { fn: () => { y += sy; }, n: stepsY }
        : { fn: () => { x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE; }, n: stepsX };

    for (let i = 0; i < first.n; i++) { first.fn(); pts.push({ x, y }); }
    for (let i = 0; i < second.n; i++) { second.fn(); pts.push({ x, y }); }
    return pts;
}

/** 直线栅格化（Bresenham）：每步仅沿 x 或 y 移动一格，处理经向短弧 */
function bresenham(
    x0: number, y0: number,
    dx: number, dy: number,
): { x: number, y: number }[] {
    const pts: { x: number, y: number }[] = [];
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    let err = adx - ady;
    let x = x0, y = y0;
    pts.push({ x, y });
    while (x !== ((x0 + dx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE) || y !== y0 + dy) {
        const e2 = 2 * err;
        if (e2 > -ady) { err -= ady; x = (x + sx + ROOT_GRID_SIZE) % ROOT_GRID_SIZE; }
        else if (e2 < adx) { err += adx; y += sy; }
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
    x0: number, y0: number, x1: number, y1: number,
    mode: BeltPathMode = 'latFirst',
): { x: number, y: number }[] {
    const dx = shortArcDelta(x0, x1);
    const dy = y1 - y0;
    if (mode === 'straight')
        return bresenham(x0, y0, dx, dy);
    return lShape(x0, y0, dx, dy, mode === 'latFirst');
}

/** 下游相对方向 (dx,dy) → 传送带 yaw（由真实蓝图标定） */
const DIR_YAW = new Map<string, number>([
    ["0,1", 0],    // +y
    ["1,0", 90],   // +x
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

/**
 * 由拖拽起止网格点构造一条传送带（尚未入库）。
 * 每格朝向其下游；末格延续最后一段方向，单点时退回 @param fallbackYaw。
 * 相邻格之间的 outputObjIdx/inputObjIdx 在命令执行、index 分配后建立。
 * @param pathMode 路径走法模式
 */
export function buildBeltLine(
    itemId: number,
    modelIndex: number,
    p0: { x: number, y: number },
    p1: { x: number, y: number },
    fallbackYaw: number,
    pathMode: BeltPathMode = 'latFirst',
): BlueprintBuilding[] {
    const pts = rasterizeLine(p0.x, p0.y, p1.x, p1.y, pathMode);
    const belts = pts.map(p => createBuilding(itemId, modelIndex, p, 0));
    for (let i = 0; i < belts.length; i++) {
        let yaw: number;
        if (i < pts.length - 1) {
            const ddx = ringDelta(pts[i].x, pts[i + 1].x);
            const ddy = pts[i + 1].y - pts[i].y;
            yaw = DIR_YAW.get(`${ddx},${ddy}`)!;
        } else if (pts.length >= 2) {
            const ddx = ringDelta(pts[i - 1].x, pts[i].x);
            const ddy = pts[i].y - pts[i - 1].y;
            yaw = DIR_YAW.get(`${ddx},${ddy}`)!;
        } else {
            yaw = fallbackYaw;
        }
        belts[i].yaw = [yaw, yaw];
        // 传送带 slot 与游戏一致：inputToSlot 恒为 1；outputToSlot 为 1（有下游）或 0（末格）
        belts[i].inputToSlot = 1;
        belts[i].outputToSlot = i < belts.length - 1 ? 1 : 0;
    }
    return belts;
}

/**
 * 批量铺设一条传送带：整条作为一个命令，一次撤销移除整段。
 * 执行时统一分配 index/area，再按顺序串联相邻格（outputObjIdx/inputObjIdx）。
 */
export class CreateBeltLineCommand implements Command {
    private prevSizeX = 0;

    constructor(private readonly belts: BlueprintBuilding[]) {}

    do(data: BlueprintData): void {
        if (this.belts.length === 0)
            return;
        const root = data.areas[0];
        this.prevSizeX = root.size.x;

        for (const b of this.belts) {
            const areaIndex = ensureAreaFor(data, b.localOffset[0]);
            if (areaIndex < 0)
                throw new Error('Placement outside equator band');
            b.areaIndex = areaIndex;
            b.index = data.buildings.length;
            data.buildings.push(b);
        }
        // 路径内部连接：仅通过 outputObjIdx 串联（与游戏一致，inputObjIdx 恒为 -1）。
        // slot 已在 buildBeltLine 中设置：outputToSlot=1（非末格），inputToSlot=1（全部）。
        for (let i = 0; i < this.belts.length - 1; i++) {
            const b = this.belts[i], next = this.belts[i + 1];
            b.outputObjIdx = next.index;
        }
    }

    undo(data: BlueprintData): void {
        for (let i = 0; i < this.belts.length; i++)
            data.buildings.pop();
        data.areas[0].size.x = this.prevSizeX;
    }

    merge() { return false; }
}
