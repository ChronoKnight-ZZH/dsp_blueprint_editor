import type { SlotPos } from "./buildingSlots";

/**
 * 四向分流器（2020）的口几何。
 *
 * 口编号与 `sorter.ts` / `SpitterInfo.vue` 完全一致（分流器 yaw=0 局部系）：
 * 0=+y、1=+x、2=-y、3=-x。
 * - 十字形（modelIndex 38/40）：四口全开
 * - 一字形（modelIndex 39）：只有长轴两端 0/2 开口
 *
 * 口的交互（优先输入/输出、筛选）在侧栏 `SpitterInfo` 面板里，见 `@/blueprint/splitterPorts`。
 *
 * 样本依据：tests/unit/blueprint/fixtures/sample_throughput.txt（游戏自己写的
 * 传送带直连分流器记录里，口编号就写在传送带的 outputToSlot / inputFromSlot）。
 */

/** 口的局部坐标半径（格）：分流器占 1 格，四个口在四条边的中点 */
export const SPLITTER_PORT_HALF = 0.5;

export interface SplitterPort {
    /** 口编号 0..3 */
    port: number;
    /** 面法线方向（建筑 yaw=0 局部系） */
    dir: SlotPos;
}

/** 该形态分流器的可用口（十字形 4 个 / 一字形 2 个） */
export function splitterPorts(modelIndex: number): SplitterPort[] {
    const all: SplitterPort[] = [
        { port: 0, dir: { x: 0, y: 1 } },
        { port: 1, dir: { x: 1, y: 0 } },
        { port: 2, dir: { x: 0, y: -1 } },
        { port: 3, dir: { x: -1, y: 0 } },
    ];
    if (modelIndex === 39) return all.filter((p) => p.port === 0 || p.port === 2);
    return all;
}

/** 口在建筑 yaw=0 局部系的坐标（格） */
export function splitterPortPos(port: number): SlotPos {
    switch (port) {
        case 0:
            return { x: 0, y: SPLITTER_PORT_HALF };
        case 1:
            return { x: SPLITTER_PORT_HALF, y: 0 };
        case 2:
            return { x: 0, y: -SPLITTER_PORT_HALF };
        default:
            return { x: -SPLITTER_PORT_HALF, y: 0 };
    }
}
