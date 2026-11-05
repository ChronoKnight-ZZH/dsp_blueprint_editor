import fs from 'fs';
import path from 'path';
import { PreviewLayer } from '@/lib/preview/PreviewLayer';
import type { PreviewDeltaEvent } from '@/lib/preview/types';

/**
 * `scripts/lib-build/preview-fixture.json` 的可用性护栏。
 *
 * 这份 fixture 是 `node scripts/preview/build-fixture.mjs` 把真实抓包改造成
 * 「当前需求格式」的结果（`areas` 嵌套 + `isTemporary` + 去掉恒 0 的姿态字段），
 * `preview-test.html` 直接回放它。这里离线回放一遍，保证：
 * 1. 改造后的格式仍被预览层完整接收（嵌套 areas、缺 `yaw2`/`tilt` 都不影响）；
 * 2. 末态存活 / 峰值 / 坐标切换与 fixture 里记录的统计**一致**（否则页面会误报失败）。
 */

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

const FIXTURE = path.resolve(
    __dirname,
    '../../../scripts/lib-build/preview-fixture.json'
);

interface PreviewFixture {
    version: number;
    source: string;
    stats: {
        events: number;
        operations: number;
        expectedAlive: number;
        expectedPeak: number;
        unknownRemoves: number;
        unknownReplaces: number;
        switchSequences: number[];
    };
    events: PreviewDeltaEvent[];
}

const maybe = fs.existsSync(FIXTURE) ? describe : describe.skip;

maybe('preview-fixture.json（改造后的需求格式）', () => {
    const fixture = JSON.parse(
        fs.readFileSync(FIXTURE, 'utf8')
    ) as PreviewFixture;

    it('改造结果保留全部事件与操作', () => {
        expect(fixture.version).toBe(2);
        expect(fixture.events.length).toBe(fixture.stats.events);
        const ops = fixture.events.reduce(
            (n, e) => n + (e.operations?.length ?? 0),
            0
        );
        expect(ops).toBe(fixture.stats.operations);
        // 新格式：areas 必须是嵌套形态，building 必须带 isTemporary
        const areaEvent = fixture.events.find(
            (e) => Array.isArray(e.areas) && e.areas.length > 0
        );
        expect(areaEvent).toBeDefined();
        expect(areaEvent!.areas![0].anchorLocalOffset).toBeDefined();
        expect(areaEvent!.areas![0].size).toBeDefined();
        expect(areaEvent!.areas![0].anchorLocalOffsetX).toBeUndefined();
        const building = fixture.events
            .flatMap((e) => e.operations ?? [])
            .find((op) => op.type !== 'remove');
        expect(building && 'building' in building && building.building.isTemporary).toBeDefined();
    });

    it('离线回放结果与 fixture 统计一致', () => {
        const layer = new PreviewLayer({ enterDelayMs: 120, minLifeMs: 120 });
        let now = 0;
        for (const event of fixture.events) {
            layer.apply(event, now);
            now += 20;
            layer.tick(now);
        }
        for (let i = 0; i < 60; i++) {
            now += 16.7;
            layer.tick(now);
        }
        const stats = layer.stats;
        expect(stats.events).toBe(fixture.stats.events);
        expect(stats.operations).toBe(fixture.stats.operations);
        expect(stats.alive).toBe(fixture.stats.expectedAlive);
        expect(stats.peakAlive).toBe(fixture.stats.expectedPeak);
        expect(stats.unknownRemoves).toBe(fixture.stats.unknownRemoves);
        expect(stats.unknownReplaces).toBe(fixture.stats.unknownReplaces);
        expect(stats.moving).toBe(0);
        expect(stats.coordinateSystem).toBe('blueprint-area-local-v1');
        layer.discard();
    });
});
