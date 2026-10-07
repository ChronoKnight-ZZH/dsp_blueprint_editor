import type { BlueprintBuilding, LabParamerters } from "@/blueprint/parser";
import { ResearchMode } from "@/blueprint/parser";
import { getBuildingSlots } from "./buildingSlots";
import { buildingBoxes } from "./building";
import { isLab } from "./items";

/**
 * 建筑堆叠 / 箱顶放置规则（游戏 0.10.35 实测）。
 *
 * 样本：tests/tools/特殊用法建筑.txt（同一格逐层叠放，含基线 z=0 与上层 z>0 两组）、
 * tests/tools/特殊用法_生成.txt（14 种建筑 × 全部 slot 的分拣器环）。
 *
 * 游戏 wire 字段规律（逐字段核对样本得到）：
 * - 堆叠端口：底座顶面 = slot 15，上层底面 = slot 14。上层建筑写
 *   `inputObjIdx = 底座index`、`inputFromSlot = 15`、`inputToSlot = 14`、`inputOffset = 0`；
 *   底座侧不改（outputObjIdx 仍为 -1，outputToSlot/outputFromSlot 保持默认 14/15）。
 * - 可堆叠建筑即使**没有**堆叠，端口字段也是 `out=-1/14/15/0`、`in=-1/15/14/0`
 *   （储物仓 / 储液罐 / 矩阵研究站 / 四向分流器都是如此；熔炉、制造台等不可堆叠建筑写 0）。
 * - 堆叠高度是每建筑固定的一层高度（实测 z 差），不是选择盒高度：
 *   储物仓·小 / 四向分流器 = 2，储物仓·大 / 储液罐 / 矩阵研究站 = 3。
 * - 物流配送器 (2107) 不属于"堆叠"：它只能放在储物仓**箱盖**上，写
 *   `inputFromSlot = 13`（箱盖接口）、`inputToSlot = 0`，落位高度是箱盖高度
 *   （储物仓·小 1.875、储物仓·大 2.981），与储物仓自身的堆叠层高不同。
 */

/** 堆叠端口编号：底座顶面 */
export const STACK_TOP_SLOT = 15;
/** 堆叠端口编号：上层底面 */
export const STACK_BOTTOM_SLOT = 14;
/** 储物仓箱盖接口编号（物流配送器专用） */
export const BOX_TOP_SLOT = 13;

/** 可作堆叠底座（可向上叠一层）的建筑 → 每层高度（格） */
const stackHeight = new Map<number, number>([
    [2020, 2], // 四向分流器
    [2101, 2], // 储物仓·小
    [2102, 3], // 储物仓·大
    [2106, 3], // 储液罐
    [2901, 3], // 矩阵研究站
    [2902, 3], // 矩阵研究站 Mk.II
]);

/**
 * 允许的"底座 → 上层"组合（游戏 0.10.35 样本实测；同类箱体之间做了同族推广）。
 * 刻意保持保守：游戏不接受的组合宁可让用户放不下去，也不要写进蓝图里让游戏报错。
 */
const stackCompat = new Map<number, number[]>([
    [2020, [2101]], // 分流器上叠储物仓·小
    [2101, [2101, 2102, 2107]], // 箱子上叠箱子 / 物流配送器（配送器只能放箱盖）
    [2102, [2101, 2102, 2107]],
    [2106, [2106]], // 储液罐只与储液罐互叠
    [2901, [2901, 2902]], // 研究站之间互叠（含 Mk.I/Mk.II 交叉）
    [2902, [2901, 2902]],
]);

/** 只能放在底座"顶面"上的建筑 → 允许的底座 itemId → 落位高度（格） */
const onTopOf = new Map<number, Map<number, number>>([
    [
        2107, // 物流配送器：只能放在箱子（含大箱子）上方
        new Map([
            [2101, 1.875], // 箱盖高度（样本实测 1.8750001）
            [2102, 2.9812432788294245], // 样本实测原值（≠ 堆叠层高 3）
        ]),
    ],
]);

/**
 * 子建筑放在 parentItemId 上时的 z 偏移（相对底座原点）。
 * @returns null = 不允许这样叠放
 */
export function stackOffsetFor(
    parentItemId: number,
    childItemId: number
): number | null {
    const allowed = stackCompat.get(parentItemId);
    if (!allowed || allowed.indexOf(childItemId) < 0) return null;
    const restricted = onTopOf.get(childItemId);
    if (restricted) return restricted.get(parentItemId) ?? null;
    return stackHeight.get(parentItemId) ?? null;
}

/** 该建筑是否可以放在别的建筑之上（子建筑身份，能否叠取决于底座，见 stackOffsetFor） */
export function isStackChild(itemId: number): boolean {
    return stackHeight.has(itemId) || onTopOf.has(itemId);
}

/** 该建筑是否可以作为堆叠底座 */
export function isStackBase(itemId: number): boolean {
    return stackHeight.has(itemId);
}

/** 该建筑是否只能放在别的建筑上方（无底座即不可放置） */
export function requiresBase(itemId: number): boolean {
    return onTopOf.has(itemId);
}

/**
 * 可堆叠建筑的端口字段默认值（未连接时游戏也这么写）。
 * @returns null = 该建筑没有堆叠端口（保持 0）
 */
export function stackPortDefaults(itemId: number):
    | {
          outputToSlot: number;
          outputFromSlot: number;
          inputFromSlot: number;
          inputToSlot: number;
      }
    | undefined {
    if (!stackHeight.has(itemId)) return undefined;
    return {
        outputToSlot: STACK_BOTTOM_SLOT,
        outputFromSlot: STACK_TOP_SLOT,
        inputFromSlot: STACK_TOP_SLOT,
        inputToSlot: STACK_BOTTOM_SLOT,
    };
}

/** 子建筑与底座之间是否是"堆叠端口"连接（inputToSlot = 底层端口） */
export function isStackLink(child: BlueprintBuilding): boolean {
    return child.inputObjIdx >= 0 && child.inputToSlot === STACK_BOTTOM_SLOT;
}

/**
 * 堆叠落位 z：底座顶面高度（= 底座 z + 一层高度）；平地放置为 0。
 * @returns 0 = 不堆叠
 */
export function stackedZ(
    parent: BlueprintBuilding | null,
    childItemId: number
): number {
    if (parent === null) return 0;
    return (
        parent.localOffset[0].z +
        (stackOffsetFor(parent.itemId, childItemId) ?? 0)
    );
}

/**
 * 堆叠时继承研究模式：底座也是矩阵研究站、且底座处于**研究模式**时，
 * 叠上去的研究站默认为相同模式（游戏行为）。
 * 其余模式（选择模式 / 矩阵合成）不继承。
 */
export function inheritLabMode(
    child: BlueprintBuilding,
    parent: BlueprintBuilding
): void {
    if (!isLab(child.itemId) || !isLab(parent.itemId)) return;
    const p = parent.parameters as LabParamerters | null;
    if (!p || p.researchMode !== ResearchMode.Research) return;
    const c = child.parameters as LabParamerters | null;
    if (!c) return;
    c.researchMode = ResearchMode.Research;
}

/** 写入堆叠连接字段（与游戏蓝图逐字段一致） */
export function linkStack(
    child: BlueprintBuilding,
    parent: BlueprintBuilding
): void {
    child.inputObjIdx = parent.index;
    child.inputOffset = 0;
    if (requiresBase(child.itemId)) {
        child.inputFromSlot = BOX_TOP_SLOT;
        child.inputToSlot = 0;
    } else {
        child.inputFromSlot = STACK_TOP_SLOT;
        child.inputToSlot = STACK_BOTTOM_SLOT;
    }
}

/** 同格判定：建筑中心取整后相同（游戏放置吸附到整格） */
function sameCell(a: BlueprintBuilding, x: number, y: number): boolean {
    return (
        Math.floor(a.localOffset[0].x) === Math.floor(x) &&
        Math.floor(a.localOffset[0].y) === Math.floor(y)
    );
}

/** 落座半径封顶（格）：无 slot 表的建筑（四向分流器等）用 */
const STACK_FOOTPRINT_CAP = 0.9;
/** 落座判定容差（格）：光标落在建筑边缘外半格内也算"放在它上面" */
const STACK_FOOTPRINT_TOL = 0.5;

/**
 * 建筑在 yaw=0 局部系的落座半径（x / y 半尺寸，格）。
 * 有 slot 表时取 slot 环的极值（≈ 模型外圈，实测与游戏数据一致），
 * 否则退回选择盒的一半（封顶 {@link STACK_FOOTPRINT_CAP}）。
 */
function footprintHalf(itemId: number, modelIndex: number): [number, number] {
    const slots = getBuildingSlots(itemId);
    let hx = 0;
    let hy = 0;
    for (const s of slots) {
        if (s === null) continue;
        hx = Math.max(hx, Math.abs(s.x));
        hy = Math.max(hy, Math.abs(s.y));
    }
    if (hx > 0 && hy > 0) return [hx, hy];
    const box = buildingBoxes.get(modelIndex);
    if (!box) return [STACK_FOOTPRINT_CAP, STACK_FOOTPRINT_CAP];
    return [
        Math.min(box[0] / 2, STACK_FOOTPRINT_CAP),
        Math.min(box[2] / 2, STACK_FOOTPRINT_CAP),
    ];
}

/** 网格点是否落在建筑落座范围内（建筑 yaw=0 局部系，容差半格） */
function containsPoint(
    b: BlueprintBuilding,
    x: number,
    y: number
): boolean {
    if (sameCell(b, x, y)) return true;
    const c = b.localOffset[0];
    const rad = (b.yaw[0] * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const [hx, hy] = footprintHalf(b.itemId, b.modelIndex);
    return (
        Math.abs(lx) <= hx + STACK_FOOTPRINT_TOL &&
        Math.abs(ly) <= hy + STACK_FOOTPRINT_TOL
    );
}

/**
 * 放置时求"堆叠底座"：鼠标所指建筑优先（与游戏一致——光标在建筑上就是往上叠），
 * 否则在该格内取能承载 childItemId 的**最高**建筑（已有堆叠列时叠到顶）。
 * @param picked 光标所指建筑（pickBuilding 的结果，可为 null）
 * @returns null = 该处不能堆叠（平地放置或不允许的组合）
 */
export function stackBaseFor(
    buildings: readonly BlueprintBuilding[],
    picked: BlueprintBuilding | null,
    x: number,
    y: number,
    childItemId: number
): BlueprintBuilding | null {
    if (
        picked &&
        stackOffsetFor(picked.itemId, childItemId) !== null &&
        containsPoint(picked, x, y)
    )
        return picked;
    let best: BlueprintBuilding | null = null;
    for (const b of buildings) {
        if (stackOffsetFor(b.itemId, childItemId) === null) continue;
        if (!containsPoint(b, x, y)) continue;
        if (best === null || b.localOffset[0].z > best.localOffset[0].z)
            best = b;
    }
    return best;
}

/**
 * 堆叠列：同一格、沿堆叠端口（inputToSlot=14）相连的一串建筑，**自下而上**返回。
 * 只跟随堆叠端口，不会把分拣器连接（inputToSlot=1）误当成堆叠。
 */
export function stackColumn(
    buildings: readonly BlueprintBuilding[],
    building: BlueprintBuilding
): BlueprintBuilding[] {
    const byIndex = new Map<number, BlueprintBuilding>();
    for (const b of buildings) byIndex.set(b.index, b);

    // 先沿 inputObjIdx 一路向下找底座
    let bottom = building;
    const downSeen = new Set<BlueprintBuilding>([building]);
    for (;;) {
        if (!isStackLink(bottom)) break;
        const parent = byIndex.get(bottom.inputObjIdx);
        if (!parent || downSeen.has(parent)) break;
        downSeen.add(parent);
        bottom = parent;
    }
    // 再自底向上收集。注意用独立的 visited：起始建筑本身就在列里，
    // 若复用一个 visited 会立刻停在起始建筑上（只剩底座一段）。
    const column: BlueprintBuilding[] = [bottom];
    const upSeen = new Set<BlueprintBuilding>([bottom]);
    for (;;) {
        const top = column[column.length - 1];
        let next: BlueprintBuilding | null = null;
        for (const b of buildings) {
            if (isStackLink(b) && b.inputObjIdx === top.index) {
                next = b;
                break;
            }
        }
        if (!next || upSeen.has(next)) break;
        upSeen.add(next);
        column.push(next);
    }
    return column;
}
