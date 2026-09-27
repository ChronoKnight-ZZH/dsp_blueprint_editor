import { BlueprintBuilding, BlueprintData } from "./parser";
import { Command } from "@/command";
import { ensureAreaFor } from "./area";
import { createBuilding } from "./create";

/**
 * 整数网格上的 Bresenham 栅格化：返回从 (p0) 到 (p1) 的相邻格点，
 * 每步仅沿 x 或 y 移动一格，拐角自然产生，符合 DSP 传送带只能走 cardinal 方向的约束。
 */
export function rasterizeLine(
    x0: number, y0: number, x1: number, y1: number,
): { x: number, y: number }[] {
    const pts: { x: number, y: number }[] = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;
    pts.push({ x, y });
    while (x !== x1 || y !== y1) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
        pts.push({ x, y });
    }
    return pts;
}

/** 下游相对方向 (dx,dy) → 传送带 yaw（由真实蓝图标定） */
const DIR_YAW = new Map<string, number>([
    ["0,1", 0],    // +y
    ["1,0", 90],   // +x
    ["0,-1", 180], // -y
    ["-1,0", 270], // -x
]);

/**
 * 由拖拽起止网格点构造一条传送带（尚未入库）。
 * 每格朝向其下游；末格延续最后一段方向，单点时退回 @param fallbackYaw。
 * 相邻格之间的 outputObjIdx/inputObjIdx 在命令执行、index 分配后建立。
 */
export function buildBeltLine(
    itemId: number,
    modelIndex: number,
    p0: { x: number, y: number },
    p1: { x: number, y: number },
    fallbackYaw: number,
): BlueprintBuilding[] {
    const pts = rasterizeLine(p0.x, p0.y, p1.x, p1.y);
    const belts = pts.map(p => createBuilding(itemId, modelIndex, p, 0));
    for (let i = 0; i < belts.length; i++) {
        let yaw: number;
        if (i < pts.length - 1) {
            yaw = DIR_YAW.get(`${pts[i + 1].x - pts[i].x},${pts[i + 1].y - pts[i].y}`)!;
        } else if (pts.length >= 2) {
            yaw = DIR_YAW.get(`${pts[i].x - pts[i - 1].x},${pts[i].y - pts[i - 1].y}`)!;
        } else {
            yaw = fallbackYaw;
        }
        belts[i].yaw = [yaw, yaw];
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
        // 路径内部连接：当前格输出到下一格，下一格输入来自当前格（传送带单通道，slot 全 0）
        for (let i = 0; i < this.belts.length - 1; i++) {
            const b = this.belts[i], next = this.belts[i + 1];
            b.outputObjIdx = next.index;
            next.inputObjIdx = b.index;
        }
    }

    undo(data: BlueprintData): void {
        for (let i = 0; i < this.belts.length; i++)
            data.buildings.pop();
        data.areas[0].size.x = this.prevSizeX;
    }

    merge() { return false; }
}
