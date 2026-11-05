import fs from 'fs';
import path from 'path';
import { PreviewLayer } from '@/lib/preview/PreviewLayer';
import type { PreviewDeltaEvent } from '@/lib/preview/types';

/**
 * 真实样本回放（离屏，无 WebGL）。
 *
 * 默认跳过——它要读 `data/preview-delta-*.json`（最大 26 MB / 500 事件 / 60,799 op），
 * 日常单测不该拖这么慢。需要跑时：
 *
 * ```bash
 * PREVIEW_REPLAY=1 npx jest tests/unit/preview/replay.spec.ts
 * ```
 *
 * 它验证的是"实施口径"而不是渲染结果：
 * 1. **摄入同步且够快**：单事件（≤128 op）摄入耗时必须远低于 50ms 预算；
 * 2. **不丢对象**：回放完整事件流后，存活对象数与净增量完全一致；
 * 3. **能收敛**：事件停后 `moving` 必须回落到 0（否则每帧都在白算）；
 * 4. **中途开始的窗口不炸**：`remove`/`replace` 遇到从未见过的对象按契约容错。
 */

// 真实模块会拉起 GLB/KTX2 加载器；回放只关心调度与槽位
jest.mock('@/models/buildingModel', () => {
    const { Color, Matrix4 } = jest.requireActual('three');
    return {
        resolveBuildingModel: (modelIndex: number) => ({
            modelIndex,
            glbName: null,
            glb: null,
            meta: {
                color: new Color(0x8899aa),
                unitBoxTrans: new Matrix4(),
                selectUnitBoxTrans: new Matrix4(),
                iconTrans: new Matrix4(),
                boxSize: [1, 1, 1],
                boxCenter: [0, 0, 0],
            },
            tint: null,
            placement: new Matrix4(),
            source: 'meta',
        }),
        requestBuildingModel: () => undefined,
        onBuildingModelsChanged: () => () => undefined,
        buildingModelName: () => null,
    };
});

const DATA_DIR = path.resolve(__dirname, '../../../data');

function sampleFiles(): string[] {
    if (!fs.existsSync(DATA_DIR)) return [];
    const all = fs
        .readdirSync(DATA_DIR)
        .filter((f) => f.startsWith('preview-delta-') && f.endsWith('.json'));
    // 指定单个文件：PREVIEW_REPLAY_FILE=preview-delta-xxx.json
    const only = process.env.PREVIEW_REPLAY_FILE;
    if (only !== undefined && only !== '') return all.filter((f) => f === only);
    // 默认只取中小样本（大样本 26 MB 在 CI 上太贵）
    return all
        .filter((f) => fs.statSync(path.join(DATA_DIR, f)).size < 20 * 1024 * 1024)
        .sort(
            (a, b) =>
                fs.statSync(path.join(DATA_DIR, a)).size -
                fs.statSync(path.join(DATA_DIR, b)).size
        )
        .slice(0, 2);
}

/** 净增量（不看视觉，只看逻辑成员） */
function netAlive(events: PreviewDeltaEvent[]): { alive: number; peak: number } {
    const alive = new Set<string>();
    let peak = 0;
    for (const event of events) {
        for (const op of event.operations ?? []) {
            if (op.type === 'remove') alive.delete(op.objectId);
            else alive.add(op.objectId);
        }
        if (alive.size > peak) peak = alive.size;
    }
    return { alive: alive.size, peak };
}

const run = process.env.PREVIEW_REPLAY === '1' ? describe : describe.skip;

run('真实样本回放', () => {
    const files = sampleFiles();
    it('至少存在一份样本', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
        it(`${file}：摄入够快、对象不丢、能收敛`, () => {
            const events = JSON.parse(
                fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
            ) as PreviewDeltaEvent[];
            const expected = netAlive(events);

            const layer = new PreviewLayer({
                projector: 'sphere',
                enterDelayMs: 120,
                minLifeMs: 120,
                settleMs: 100,
            });

            // 按实测节拍喂：250 条 ≈ 5s → 20ms/条；每 16.7ms 跑一帧
            let now = 0;
            let worstIngest = 0;
            for (const event of events) {
                const before = performance.now();
                layer.apply(event, now);
                worstIngest = Math.max(worstIngest, performance.now() - before);
                layer.tick(now);
                now += 20;
                layer.tick(now);
            }

            // 事件停后继续跑 60 帧（≈1s），必须全部收敛
            for (let i = 0; i < 60; i++) {
                now += 16.7;
                layer.tick(now);
            }

            const stats = layer.stats;
            if (process.env.PREVIEW_REPLAY_VERBOSE === '1')
                // eslint-disable-next-line no-console
                console.log(file, JSON.stringify(stats));
            expect(stats.alive).toBe(expected.alive);
            expect(stats.peakAlive).toBe(expected.peak);
            expect(stats.moving).toBe(0);
            expect(worstIngest).toBeLessThan(50);
            expect(stats.maxIngestMs).toBeLessThan(50);
            expect(stats.slots).toBeGreaterThan(0);

            layer.discard();
        }, 120000);
    }
});
