import { BlueprintBuilding, BlueprintData, IODir } from "./parser";
import { Command } from "@/render/command";
import { ROOT_GRID_SIZE } from "./globe";
import { createBuilding } from "./create";

/** 传送带路径走法模式（R 键循环切换） */
export type BeltPathMode =
    | "latFirst" // 默认：先走纬度线（x/东西），后走经度线（y/南北）
    | "lonFirst" // 先走经度线（y/南北），后走纬度线（x/东西）
    | "straight"; // 两点之间直线等分（自由角度，见 `freePath`）

/** 经向短弧位移：把 x1-x0 归一化到 (-gridSize/2, gridSize/2]；`gridSize` = 该区域一整圈的经向格数 */
function shortArcDelta(x0: number, x1: number, gridSize = ROOT_GRID_SIZE): number {
    let dx = x1 - x0;
    dx =
        ((((dx + gridSize / 2) % gridSize) + gridSize) % gridSize) -
        gridSize / 2;
    return dx;
}

/** L 形路径：先走 x 方向 stepsX 步，再走 y 方向 stepsY 步 */
function lShape(
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    xFirst: boolean,
    gridSize = ROOT_GRID_SIZE
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
                  x = (x + sx + gridSize) % gridSize;
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
                  x = (x + sx + gridSize) % gridSize;
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

/**
 * 自由角度直线：两端点之间按 `round(欧氏距离)` 等分，节点可以是分数格。
 *
 * 游戏真实蓝图（`data/不同斜角传送带.json`）即如此：端点是整格点，段数
 * = round(直线长度)，中间节点 = 起点到终点的等分点，每段约 1 格。
 * x 为经向环形坐标，逐点按短弧回绕。
 */
function freePath(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    gridSize = ROOT_GRID_SIZE
): { x: number; y: number }[] {
    const dx = shortArcDelta(x0, x1, gridSize);
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [{ x: wrapX(x0, gridSize), y: y0 }];
    const n = Math.max(1, Math.round(len));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
        // 末点直接用目标值，避免 x0 + dx 的浮点尾巴
        if (i === n) pts.push({ x: wrapX(x1, gridSize), y: y1 });
        else
            pts.push({
                x: wrapX(x0 + (dx * i) / n, gridSize),
                y: y0 + (dy * i) / n,
            });
    }
    return pts;
}

/**
 * 传送带路径：返回从 (p0) 到 (p1) 的节点序列。
 * - `latFirst` / `lonFirst`：整数格 L 形，每步仅沿 x 或 y 移动一格；
 * - `straight`：自由角度直线，节点可为分数（{@link freePath}）。
 * x 方向为经向环形坐标（0 ~ gridSize），自动取短弧。
 * @param mode 路径走法：latFirst / lonFirst / straight
 */
export function rasterizeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    mode: BeltPathMode = "latFirst",
    gridSize = ROOT_GRID_SIZE
): { x: number; y: number }[] {
    if (mode === "straight") return freePath(x0, y0, x1, y1, gridSize);
    const dx = shortArcDelta(x0, x1, gridSize);
    const dy = y1 - y0;
    return lShape(x0, y0, dx, dy, mode === "latFirst", gridSize);
}

/**
 * 下游方向 (a→b) → 传送带 yaw（0° = +y，90° = +x）。
 * 支持分数坐标，并经向按短弧计算，因此任意斜率的直线/拐角都可用。
 */
function directionYaw(
    a: { x: number; y: number },
    b: { x: number; y: number },
    gridSize = ROOT_GRID_SIZE
): number {
    const rad = Math.PI / 180;
    const dx = shortArcDelta(a.x, b.x, gridSize);
    const dy = b.y - a.y;
    return (Math.atan2(dx, dy) / rad + 360) % 360;
}

/** 相邻两节点 (a→b) 的方向 yaw；两点重合返回 null */
function stepYaw(
    a: { x: number; y: number },
    b: { x: number; y: number },
    gridSize = ROOT_GRID_SIZE
): number | null {
    const dx = shortArcDelta(a.x, b.x, gridSize);
    const dy = b.y - a.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
    return directionYaw(a, b, gridSize);
}

/**
 * 单元格 yaw = **进入方向与离开方向的平分角**（游戏真实蓝图实测）。
 * 直格两者相同 → 就是行进方向；拐角格两者相差 90° → 得到 45° 的斜角
 * （例如东进南出 → 135°，南进西出 → 225°），游戏里的转弯格正是这么存的；
 * 只写"离开方向"会让传送带在拐角处缺失 45° 过渡。
 *
 * 方向按连续坐标计算，所以自由角度直线/任意角度拐角的平分角也走同一套公式。
 */
function cellYaw(
    prev: { x: number; y: number } | null,
    next: { x: number; y: number } | null,
    self: { x: number; y: number },
    fallbackYaw: number,
    gridSize = ROOT_GRID_SIZE
): number {
    const dirIn = prev === null ? null : stepYaw(prev, self, gridSize);
    const dirOut = next === null ? null : stepYaw(self, next, gridSize);
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
 * 传送带坡度剖面：**起点/终点的单元格与首末两段都保持水平**，爬坡夹在中间。
 *
 * 结构：`z[0] = z[1] = z0`（第一个点水平建造，首段不爬坡）→ 爬坡段 →
 * 剩余节点全部平铺在 `z1`（**最后一段永远水平**，终点格只放一条 z1 的带）。
 *
 * 爬坡写法按"可用水平爬升段数"选择（样本 `data/三种坡度上升的高度1.json`）：
 * - 可用段 ≥ 2×剩余层数 → 缓坡：两段各升 0.5 层（样本链 1：z = 0,0,0.5,1,1）；
 * - 否则 → 陡坡：一段升 1 层（样本链 2：z = 0,0,1,1）；
 * - 层数超出可用段 → 先在**起点后第一格**原地垂直堆叠补层（样本链 3 的写法）。
 * 可用段 = 总段数 − 2（首段与末段固定水平）。
 *
 * 特殊长度：
 * - 单格路径（A=B）：只能原地堆叠；
 * - 两节点路径（L=1）：首段水平到终点格，再在该格原地垂直升层
 *   （用户规则"一格的爬升只能通过垂直爬升实现"）。
 *
 * 同一格的重复节点（垂直/堆叠）共用一个平面下标：yaw 由调用方按平面路径取，
 * 因此原地升层的带仍朝行进方向（与样本链 3 一致，不会退回 fallbackYaw）。
 */
function slopeProfile(
    pointCount: number,
    z0: number,
    z1: number
): { idx: number; z: number }[] {
    const nodes: { idx: number; z: number }[] = [{ idx: 0, z: z0 }];
    const dir = Math.sign(z1 - z0);
    const EPS = 1e-6;
    if (dir === 0) {
        for (let i = 1; i < pointCount; i++) nodes.push({ idx: i, z: z0 });
        return nodes;
    }
    if (pointCount === 1) {
        // 单格路径：只能原地堆叠
        let z = z0;
        while (Math.abs(z1 - z) > EPS) {
            z += dir * Math.min(1, Math.abs(z1 - z));
            nodes.push({ idx: 0, z });
        }
        return nodes;
    }
    // 第一个点水平建造：首段固定平铺
    nodes.push({ idx: 1, z: z0 });
    if (pointCount === 2) {
        // L=1 没有水平爬升空间：到终点格后原地垂直升层
        let z = z0;
        while (Math.abs(z1 - z) > EPS) {
            z += dir * Math.min(1, Math.abs(z1 - z));
            nodes.push({ idx: 1, z });
        }
        return nodes;
    }
    let i = 1;
    let z = z0;
    // 可用水平爬升段 = 总段数 − 首段 − 末段
    const climbGaps = pointCount - 3;
    // 层数超出水平爬升能力：先在起点后第一格垂直堆叠补层
    let excess = Math.abs(z1 - z0) - climbGaps;
    while (excess > EPS) {
        const step = Math.min(1, excess);
        z += dir * step;
        excess -= step;
        nodes.push({ idx: 1, z });
    }
    while (Math.abs(z1 - z) > EPS) {
        const remaining = pointCount - 2 - i;
        const levelsLeft = Math.abs(z1 - z);
        if (
            remaining >= 2 &&
            levelsLeft >= 1 - EPS &&
            remaining >= 2 * Math.ceil(levelsLeft - EPS)
        ) {
            // 缓坡：两段各升 0.5 层
            nodes.push({ idx: i + 1, z: z + dir * 0.5 });
            nodes.push({ idx: i + 2, z: z + dir });
            i += 2;
            z += dir;
        } else if (remaining >= 1 && levelsLeft >= 1 - EPS) {
            // 陡坡：一段升 1 层
            nodes.push({ idx: i + 1, z: z + dir });
            i += 1;
            z += dir;
        } else if (remaining >= 1) {
            // 只剩 0.5 层：一段收口
            nodes.push({ idx: i + 1, z: z1 });
            i += 1;
            z = z1;
        } else {
            // 兜底：段位用尽时在当前格堆叠（正常不会走到这里，excess 已提前处理）
            z += dir * Math.min(1, levelsLeft);
            nodes.push({ idx: i, z });
        }
    }
    for (let j = i + 1; j < pointCount; j++) nodes.push({ idx: j, z: z1 });
    return nodes;
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
function portCell(
    point: { x: number; y: number },
    gridSize = ROOT_GRID_SIZE
): { x: number; y: number } {
    return {
        x: wrapX(Math.round(point.x), gridSize),
        y: Math.round(point.y),
    };
}

/** 经向回绕到 0..gridSize-1（gridSize = 该区域一整圈的经向格数） */
function wrapX(x: number, gridSize = ROOT_GRID_SIZE): number {
    return ((x % gridSize) + gridSize) % gridSize;
}

/** 口格的**记录位置**写成口的精确坐标（游戏即如此：带端贴在建筑口上，位置是分数） */
function placeAtPort(
    belt: BlueprintBuilding,
    point: { x: number; y: number; z: number },
    gridSize = ROOT_GRID_SIZE
): void {
    const x = wrapX(point.x, gridSize);
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
function cellKey(b: BlueprintBuilding, gridSize = ROOT_GRID_SIZE): string {
    return `${b.areaIndex}:${wrapX(
        Math.round(b.localOffset[0].x),
        gridSize
    )},${Math.round(b.localOffset[0].y)},${zLayer(b.localOffset[0].z)}`;
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
    return `${b.areaIndex}:${isInput ? "in" : "out"}:${idx}:${slot}:${zLayer(
        b.localOffset[0].z
    )}`;
}

/** 自由角度带的"位置身份"：经向回绕后把 x/y 量化到 1e-3 格 + 高度层 */
function freePointKey(
    b: BlueprintBuilding,
    gridSize = ROOT_GRID_SIZE
): string {
    const p = b.localOffset[0];
    const q = (v: number) => Math.round(v * 1000) / 1000;
    return `${b.areaIndex}:pt:${q(wrapX(p.x, gridSize))},${q(
        p.y
    )},${zLayer(p.z)}`;
}

/** 坐标是否不在整格上（自由角度带的中间节点/口带端点是分数坐标） */
function isFractional(p: { x: number; y: number }): boolean {
    return (
        Math.abs(p.x - Math.round(p.x)) > 1e-4 ||
        Math.abs(p.y - Math.round(p.y)) > 1e-4
    );
}

/**
 * 传送带在占用表里的键：
 * - 口带 → 口身份（见 {@link portKey}）；
 * - 自由角度带的分数节点 → 位置身份（{@link freePointKey}）；
 * - 其余整格节点 → 格身份（{@link cellKey}）。
 *
 * 不能对所有带都 round 成格：自由角度线按比例等分，两个相邻节点
 * 可能四舍五入到同一格（样本 `data/不同斜角传送带.json` 的 #3/#4、#7/#8），
 * 按格判重会把后一条带误判成"该格已有带"而截断。
 * 端点仍吸整格，所以自由线和已有 cardinal 线路仍能在整格节点处复用/截断。
 */
function occupancyKey(
    b: BlueprintBuilding,
    byIndex: ReadonlyMap<number, BlueprintBuilding>,
    gridSize = ROOT_GRID_SIZE
): string {
    return (
        portKey(b, byIndex) ??
        (isFractional(b.localOffset[0])
            ? freePointKey(b, gridSize)
            : cellKey(b, gridSize))
    );
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
 * `straight` 模式是**自由角度直线**：端点仍是整格（或建筑口），中间节点按
 * `round(欧氏距离)` 等分，坐标可为分数；游戏真实样本见 `data/不同斜角传送带.json`。
 * `latFirst` / `lonFirst` 仍是每步一格的 L 形路径。
 *
 * 端点绑定建筑口时（@param startPort / @param endPort）：
 * - 口格的**身份**取 `round(口坐标)`，**记录位置**写成口的精确坐标；
 * - 口格的外侧一格固定为 `口格 + 口法线`，保证带沿口的面离开/进入（游戏要求）；
 * - 带的高度 = 从起点高度到终点高度自动生成坡度（见 {@link slopeProfile}）：
 *   起点绑口时取口高度，否则取 `startZ`；终点绑口时取口高度，否则取 `baseZ`；
 *   两端相同即整条同高（`data/阶梯高度传送带.json` 的做法）；
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
    endPort: BeltPortEnd | null = null,
    /** 该区域的经向格数（一整圈）：赤道带 1000、160 段带 800 ……；缺省按赤道带 */
    gridSize = ROOT_GRID_SIZE,
    /**
     * 终点高度（建造高度，↑/↓ 调整）：**省略 = 起点高度**（整条同高，兼容旧调用）。
     * 绑定时以口高度为准（口高度与起点不同 → 自动生成坡度）。
     */
    baseZ?: number,
    /**
     * 起点高度（A 点继承口/已有带的高度）：**省略 = baseZ**（整条同高，无坡度）。
     * 起点绑定 startPort 时以口高度为准。
     */
    startZ?: number
): BlueprintBuilding[] {
    const z0 = startPort?.point.z ?? startZ ?? baseZ ?? 0;
    const z1 = endPort?.point.z ?? baseZ ?? z0;
    const g0 = startPort ? portCell(startPort.point, gridSize) : { ...p0 };
    const g1 = endPort ? portCell(endPort.point, gridSize) : { ...p1 };
    const b0 = startPort
        ? { x: wrapX(g0.x + startPort.nx, gridSize), y: g0.y + startPort.ny }
        : g0;
    const b1 = endPort
        ? { x: wrapX(g1.x + endPort.nx, gridSize), y: g1.y + endPort.ny }
        : g1;
    const pts = rasterizeLine(b0.x, b0.y, b1.x, b1.y, pathMode, gridSize);
    if (startPort) pts.unshift(g0);
    if (endPort) pts.push(g1);
    // 每个平面节点的 yaw 只由平面路径决定：同格的重复节点（垂直/堆叠）沿用同一朝向
    const yaws = pts.map((p, i) =>
        cellYaw(
            pts[i - 1] ?? null,
            pts[i + 1] ?? null,
            p,
            fallbackYaw,
            gridSize
        )
    );
    const nodes = slopeProfile(pts.length, z0, z1);
    const belts = nodes.map((n) =>
        createBuilding(itemId, modelIndex, pts[n.idx], yaws[n.idx], n.z)
    );
    for (let i = 0; i < belts.length; i++) {
        // 传送带 slot 与游戏一致：inputToSlot 恒为 1；outputToSlot 为 1（有下游）或 0（末格）
        belts[i].inputToSlot = 1;
        belts[i].outputToSlot = i < belts.length - 1 ? 1 : 0;
    }
    // 口格：记录位置改成口的精确坐标 + 写连接字段
    if (startPort) {
        const first = belts[0];
        placeAtPort(first, startPort.point, gridSize);
        first.inputObjIdx = startPort.building.index;
        first.inputFromSlot = startPort.slot;
        first.inputToSlot = 1;
        first.inputOffset = 0;
    }
    if (endPort) {
        const last = belts[belts.length - 1];
        placeAtPort(last, endPort.point, gridSize);
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
 * 撤销时弹出新增格，并恢复被复用格的 yaw 与输出连接。
 *
 * `areaIndex` = 整条带所属区域（编辑器按起点所在纬度带选好；一条带只能在一个区域里，
 * 跨带的部分在编辑器侧就已按带边界截断）。`gridSize` = 该区域一整圈的经向格数。
 */
export class CreateBeltLineCommand implements Command {
    private prevSizeX = 0;
    /**
     * 复用的已有传送带：撤销时恢复其原 yaw 与输出连接。
     *
     * 复用格在 `do` 里会被重新接到本次新增的下一格；只恢复 yaw 不够——
     * 新增格撤销后 outputObjIdx 会指向已弹出的下标（悬空引用，导出即非法）。
     */
    private reused: {
        belt: BlueprintBuilding;
        yaw: [number, number];
        outputObjIdx: number;
        outputToSlot: number;
        outputFromSlot: number;
        outputOffset: number;
    }[] = [];
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
        private readonly endPort: BeltPortEnd | null = null,
        /** 整条带所属区域（缺省 0 = 根区域） */
        private readonly areaIndex = 0,
        /** 该区域一整圈的经向格数（缺省按赤道带 1000） */
        private readonly gridSize = ROOT_GRID_SIZE
    ) {}

    do(data: BlueprintData): void {
        this.reused = [];
        this.added = 0;
        this.path = [];
        this.portDirChanges = [];
        this.connectedStart = false;
        this.connectedEnd = false;
        if (this.belts.length === 0) return;
        const area = data.areas[this.areaIndex];
        if (area === undefined) throw new Error("Placement area not found on canvas");
        this.prevSizeX = area.size.x;

        const existing = new Map<string, BlueprintBuilding>();
        /** index → 建筑（判断"带接的是建筑还是带"用） */
        const byIndex = new Map<number, BlueprintBuilding>();
        for (const b of data.buildings) byIndex.set(b.index, b);
        for (const b of data.buildings) {
            if (isBelt(b)) existing.set(occupancyKey(b, byIndex, this.gridSize), b);
        }

        for (let i = 0; i < this.belts.length; i++) {
            const b = this.belts[i];
            // 占用键里带区域号：先归到本条带的区域，再查占用表（否则跨区域的同格会误判）
            b.areaIndex = this.areaIndex;
            const portBound =
                (i === 0 && this.startPort !== null) ||
                (i === this.belts.length - 1 && this.endPort !== null);
            const hit = existing.get(occupancyKey(b, byIndex, this.gridSize));
            if (hit !== undefined) {
                // 口已被占用：该口已经有带（游戏里一个口只能接一条），本次拖拽截断
                if (portBound) break;
                // 该格已在某条线路**中间**（已有下游）：再接入会形成两个上游，游戏不支持
                // （需要分流器/集装机）。此时截断本次拖拽：不改动已有格、也不再新建后续格，
                // 保证老线路完整且不产生非法数据。
                if (hit.outputObjIdx >= 0) break;
                // 复用它（常见于"接着上一段继续画"：上一段末格没有下游）
                this.reused.push({
                    belt: hit,
                    yaw: [hit.yaw[0], hit.yaw[1]],
                    outputObjIdx: hit.outputObjIdx,
                    outputToSlot: hit.outputToSlot,
                    outputFromSlot: hit.outputFromSlot,
                    outputOffset: hit.outputOffset,
                });
                this.path.push(hit);
                continue;
            }
            if (b.localOffset[0].y < 0 || b.localOffset[0].y >= area.size.y)
                throw new Error("Placement outside the latitude band");
            b.index = data.buildings.length;
            data.buildings.push(b);
            byIndex.set(b.index, b);
            existing.set(occupancyKey(b, byIndex, this.gridSize), b);
            this.path.push(b);
            this.added++;
            if (b.localOffset[0].x < 0 || b.localOffset[0].x >= area.size.x)
                area.size.x = Math.floor(b.localOffset[0].x) + 1;
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
                cell.yaw[0],
                this.gridSize
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
        const bindings: {
            building: BlueprintBuilding;
            slot: number;
            dir: number;
        }[] = [];
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
            const params = b.building.parameters as {
                slots?: { dir: number }[];
            } | null;
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
            const params = c.building.parameters as {
                slots?: { dir: number }[];
            } | null;
            const slot = params?.slots?.[c.slot];
            if (slot) slot.dir = c.prev;
        }
        this.portDirChanges = [];
        for (let i = 0; i < this.added; i++) data.buildings.pop();
        for (const r of this.reused) {
            r.belt.yaw = [r.yaw[0], r.yaw[1]];
            r.belt.outputObjIdx = r.outputObjIdx;
            r.belt.outputToSlot = r.outputToSlot;
            r.belt.outputFromSlot = r.outputFromSlot;
            r.belt.outputOffset = r.outputOffset;
        }
        const area = data.areas[this.areaIndex];
        if (area !== undefined) area.size.x = this.prevSizeX;
    }

    merge() {
        return false;
    }
}
