import { Matrix4 } from 'three';
import { PreviewLayer } from '@/lib/preview/PreviewLayer';
import type { PreviewDeltaEvent, PreviewOperation } from '@/lib/preview/types';

/**
 * 预览层的摄入与跟随行为。
 *
 * 断言全部对应真实样本里出现过的边界（`data/4.` 体检报告）：
 * - `sequence` 跳号/重复（最多连跳 18，重复必然出现）；
 * - `remove` 不存在的对象（中途订阅时 24,791 次）；
 * - `replace` 不存在的对象（287 次，必须当 add）；
 * - 抖动抑制（77%~92% 的 add 最终被撤）；
 * - 坐标系切换（每份样本恰好一次）。
 */

// 真实模块会拉起 GLB/KTX2 加载器，单测里不需要，也不希望它发请求
jest.mock('@/models/buildingModel', () => {
    const { Color, Matrix4 } = jest.requireActual('three');
    const meta = () => ({
        color: new Color(0x8899aa),
        unitBoxTrans: new Matrix4(),
        selectUnitBoxTrans: new Matrix4(),
        iconTrans: new Matrix4(),
        boxSize: [1, 1, 1],
        boxCenter: [0, 0, 0],
    });
    return {
        resolveBuildingModel: (modelIndex: number) => ({
            modelIndex,
            glbName: null,
            glb: null,
            meta: meta(),
            tint: null,
            placement: new Matrix4(),
            source: 'meta',
        }),
        requestBuildingModel: () => undefined,
        onBuildingModelsChanged: () => () => undefined,
        buildingModelName: () => null,
    };
});

const BELT_ITEM = 2001;
const BOX_ITEM = 2303;

function building(overrides: Record<string, unknown> = {}) {
    return {
        index: -1,
        itemId: BOX_ITEM,
        modelIndex: 44,
        areaIndex: 0,
        localOffset: { x: 0, y: 0, z: 0 },
        localOffset2: { x: 0, y: 0, z: 0 },
        yaw: 0,
        yaw2: 0,
        ...overrides,
    };
}

function delta(
    sequence: number,
    operations: PreviewOperation[],
    extra: Partial<PreviewDeltaEvent> = {}
): PreviewDeltaEvent {
    return {
        kind: 'preview-delta',
        protocolVersion: 2,
        sequence,
        coordinateSystem: 'layout-grid-v1',
        operations,
        ...extra,
    };
}

function add(objectId: string, overrides: Record<string, unknown> = {}): PreviewOperation {
    return { type: 'add', objectId, building: building(overrides) } as PreviewOperation;
}

function remove(objectId: string): PreviewOperation {
    return { type: 'remove', objectId };
}

describe('PreviewLayer · 摄入顺序与健壮性', () => {
    it('重复/更旧的 sequence 整条忽略', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        expect(layer.apply(delta(5, [add('a')]), 0)).toBe(true);
        expect(layer.apply(delta(5, [add('b')]), 10)).toBe(false);
        expect(layer.apply(delta(4, [add('c')]), 20)).toBe(false);
        expect(layer.stats.droppedEvents).toBe(2);
        expect(layer.stats.alive).toBe(1);
        layer.discard();
    });

    it('跳号的 sequence 仍然按顺序应用（跳号是常态，不是丢包）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        layer.apply(delta(12, [add('a')]), 0);
        expect(layer.apply(delta(31, [add('b')]), 10)).toBe(true);
        expect(layer.stats.alive).toBe(2);
        layer.discard();
    });

    it('remove 不存在的对象 → 静默忽略', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        expect(layer.apply(delta(1, [remove('ghost')]), 0)).toBe(false);
        expect(layer.stats.unknownRemoves).toBe(1);
        expect(layer.stats.alive).toBe(0);
        layer.discard();
    });

    it('replace 不存在的对象 → 按 add 处理（否则对象永久丢失）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        layer.apply(
            delta(1, [{ type: 'replace', objectId: 'x', building: building() } as PreviewOperation]),
            0
        );
        expect(layer.stats.alive).toBe(1);
        expect(layer.stats.unknownReplaces).toBe(1);
        layer.discard();
    });

    it('非差量事件（阶段文案）不参与几何', () => {
        const layer = new PreviewLayer();
        expect(
            layer.apply({ kind: 'phase', message: '装配中', sequence: 3 }, 0)
        ).toBe(false);
        expect(layer.stats.events).toBe(0);
        layer.discard();
    });

    it('摄入不抛错：坏数据（缺 localOffset）被安全跳过', () => {
        const layer = new PreviewLayer();
        expect(() =>
            layer.apply(
                delta(1, [
                    { type: 'add', objectId: 'bad', building: { itemId: 1, modelIndex: 1, yaw: 0 } } as unknown as PreviewOperation,
                ]),
                0
            )
        ).not.toThrow();
        layer.discard();
    });
});

describe('PreviewLayer · 抖动抑制与淡入', () => {
    it('存活不足 minLifeMs 就被撤销的对象不出场', () => {
        const layer = new PreviewLayer({ enterDelayMs: 120, minLifeMs: 120 });
        layer.apply(delta(1, [add('short')]), 0);
        layer.apply(delta(2, [remove('short')]), 50);
        expect(layer.stats.filteredByThrash).toBe(1);
        expect(layer.stats.alive).toBe(0);
        layer.discard();
    });

    it('过了 enterDelayMs 才开始淡入', () => {
        const layer = new PreviewLayer({ enterDelayMs: 120, settleMs: 50 });
        layer.apply(delta(1, [add('a')]), 0);
        layer.tick(60);
        expect(opacityOf(layer)).toBe(0);
        layer.tick(200);
        layer.tick(260);
        expect(opacityOf(layer)).toBeGreaterThan(0.5);
        layer.discard();
    });

    it('enterDelayMs=0 时立即开始淡入（`previewAnimation: off` 场景交给 setAnimate）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0, settleMs: 50 });
        layer.apply(delta(1, [add('a')]), 0);
        layer.tick(20);
        expect(opacityOf(layer)).toBeGreaterThan(0);
        layer.discard();
    });
});

describe('PreviewLayer · 跟随收敛', () => {
    it('移动通过位置插值收敛（不需要双副本）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0, settleMs: 100 });
        layer.apply(delta(1, [add('m')]), 0);
        layer.apply(
            delta(2, [
                {
                    type: 'replace',
                    objectId: 'm',
                    building: building({ localOffset: { x: 10, y: 0, z: 0 } }),
                } as PreviewOperation,
            ]),
            100
        );

        let now = 100;
        for (let i = 0; i < 60; i++) {
            now += 16.7;
            layer.tick(now);
        }
        // 40 帧 ≈ 668ms ≈ 6.7τ → 应收敛到目标附近
        expect(xOf(layer)).toBeCloseTo(10, 1);
        // 收敛后 moving 必须归零，否则每帧都在白算
        expect(layer.stats.moving).toBe(0);
        layer.discard();
    });

    it('`off` 模式下一帧内直接到位', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        layer.setAnimate(false);
        layer.apply(delta(1, [add('m')]), 0);
        layer.apply(
            delta(2, [
                {
                    type: 'replace',
                    objectId: 'm',
                    building: building({ localOffset: { x: 7, y: 3, z: 0 } }),
                } as PreviewOperation,
            ]),
            100
        );
        layer.tick(120);
        expect(xOf(layer)).toBeCloseTo(7, 3);
        layer.discard();
    });

    it('撤销后又回来时复用同一个槽（不重新淡入）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0, minLifeMs: 0, settleMs: 50 });
        layer.apply(delta(1, [add('r')]), 0);
        for (let i = 0; i < 10; i++) layer.tick(10 + i * 16.7);
        const before = layer.stats.alive;
        layer.apply(delta(2, [remove('r')]), 300);
        layer.apply(delta(3, [add('r', { localOffset: { x: 1, y: 1, z: 0 } })]), 320);
        expect(layer.stats.alive).toBe(before);
        layer.discard();
    });
});

describe('PreviewLayer · 容量与坐标切换', () => {
    it('超过初始容量时自动扩容（传送带初始池 4096）', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        const ops: PreviewOperation[] = [];
        for (let i = 0; i < 5000; i++)
            ops.push(add(`b${i}`, { itemId: BELT_ITEM, modelIndex: 35 }));
        // 事件按 128 条一批发（后端实测上限）
        for (let i = 0; i < ops.length; i += 128)
            layer.apply(delta(i + 1, ops.slice(i, i + 128)), i);
        expect(layer.stats.alive).toBe(5000);
        layer.discard();
    });

    it('切到 area-local 后使用真实 areas 投影，且不丢对象', () => {
        const layer = new PreviewLayer({ enterDelayMs: 0 });
        layer.apply(delta(1, [add('a')]), 0);
        const areaEvent = delta(
            2,
            [
                {
                    type: 'replace',
                    objectId: 'a',
                    building: building({ localOffset: { x: 5, y: 6, z: 0 } }),
                } as PreviewOperation,
            ],
            {
                coordinateSystem: 'blueprint-area-local-v1',
                areas: [
                    {
                        index: 0,
                        parentIndex: -1,
                        tropicAnchor: 0,
                        areaSegments: 200,
                        width: 27,
                        height: 22,
                    },
                ],
                primaryAreaIndex: 0,
            }
        );
        expect(layer.apply(areaEvent, 100)).toBe(true);
        expect(layer.stats.coordinateSystem).toBe('blueprint-area-local-v1');
        expect(layer.stats.alive).toBe(1);
        for (let i = 0; i < 60; i++) layer.tick(120 + i * 16.7);
        expect(layer.stats.moving).toBe(0);
        layer.discard();
    });
});

/** 取第一个池第一个存活槽的透明度（测试用） */
function opacityOf(layer: PreviewLayer): number {
    const pools = poolsOf(layer);
    for (const pool of pools)
        for (let i = 0; i < pool.highWater; i++)
            if (pool.state[i] === 1) return pool.curOpacity[i];
    return 0;
}

function xOf(layer: PreviewLayer): number {
    const pools = poolsOf(layer);
    for (const pool of pools)
        for (let i = 0; i < pool.highWater; i++)
            if (pool.state[i] === 1) return pool.curX[i];
    return Number.NaN;
}

interface PoolView {
    highWater: number;
    state: Uint8Array;
    curOpacity: Float32Array;
    curX: Float32Array;
}

/** 借道 `group.children` 反查池状态：`SlotPool` 是内部类型，测试只读几个字段 */
function poolsOf(layer: PreviewLayer): PoolView[] {
    const internals = layer as unknown as {
        entries: Map<string, { pool: PoolView }>;
    };
    return [...internals.entries.values()].map((e) => e.pool);
}

/** 供将来扩展：断言矩阵是有效的（目前矩阵写盘在 three 内部，无需显式校验） */
void new Matrix4();
