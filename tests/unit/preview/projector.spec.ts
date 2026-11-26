import { Matrix4, Vector3 } from 'three';
import { PreviewProjector, toBlueprintAreas } from '@/lib/preview/projector';
import { calcBuildingTrans, findPosForAreas } from '@/planet/planet';
import type { BlueprintBuilding } from '@/blueprint/parser';
import { PLANET_RADIUS, PLANET_SEGMENT, HEIGHT_GRID_SIZE } from '@/planet/planetConstants';

/**
 * 预览投影器。
 *
 * 关键回归点（都来自真实样本，见 `data/4. 多份源文件体检报告与契约问题清单.md`）：
 * 1. `layout-grid-v1` 的跨度实测最大 320 格（≈115°）——固定赤道锚点会穿极点，
 *    所以必须按 bbox 自动缩放，把跨度压到 `maxSpanDeg` 以内；
 * 2. `areas` 存在扁平/嵌套两种历史形态，两种都必须解析成 `BlueprintArea`；
 * 3. area-local 的投影必须与 `calcBuildingTrans` 同数学（-lat, lon, -yaw 的 YXZ）。
 */

const DEG = 180 / Math.PI;

describe('PreviewProjector · layout 期自适应', () => {
    it('320 格的跨度会被缩放，不会越过极点', () => {
        const p = new PreviewProjector({ kind: 'sphere', maxSpanDeg: 63 });
        for (let y = 0; y <= 320; y += 8) p.observeGrid(0, y);
        p.observeGrid(110, 0);

        const snapshot = p.snapshot();
        expect(snapshot.scale).toBeLessThan(1);
        expect(snapshot.mode).toBe('layout');

        // 锚点在 +Z 方向：算「相对锚点的球面角距」才是真正的跨度
        const anchor = new Vector3(0, 0, 1);
        const m = new Matrix4();
        const pos = new Vector3();
        let maxAngle = 0;
        for (const y of [0, 320]) {
            p.writeMatrix(m, 0, y, 0, 0, 0);
            pos.setFromMatrixPosition(m);
            expect(pos.length()).toBeCloseTo(PLANET_RADIUS, 3);
            const angle = (pos.clone().normalize().angleTo(anchor) * DEG);
            maxAngle = Math.max(maxAngle, angle);
            expect(angle).toBeLessThan(89);
        }
        // 320 格原本是 115°，缩放后总跨度应被压到 maxSpanDeg 附近
        expect(maxAngle * 2).toBeLessThan(70);
    });

    it('小跨度不缩放（保持与正式场景 1:1 的格宽）', () => {
        const p = new PreviewProjector();
        for (let x = 0; x <= 30; x += 3) p.observeGrid(x, 0);
        expect(p.snapshot().scale).toBe(1);
    });

    it('bbox 缓慢增长时重投影次数远少于事件数（避免画面持续蠕动）', () => {
        const p = new PreviewProjector();
        for (let x = 0; x < 400; x++) p.observeGrid(x, x % 7);
        // 400 次观察里最多容忍 ~1/8 的重投影（每次重投影都是一次硬跳）
        expect(p.currentVersion).toBeLessThanOrEqual(50);
    });

    it('高度按 HEIGHT_GRID_SIZE 抬升', () => {
        const p = new PreviewProjector();
        p.observeGrid(0, 0);
        const m = new Matrix4();
        p.writeMatrix(m, 0, 0, 3, 0, 0);
        const pos = new Vector3().setFromMatrixPosition(m);
        expect(pos.length()).toBeCloseTo(
            PLANET_RADIUS + 3 * HEIGHT_GRID_SIZE,
            3
        );
    });

    it('plane 模式不绕球：贴在世界 XY 平面上', () => {
        const p = new PreviewProjector({ kind: 'plane' });
        p.observeGrid(0, 0);
        p.observeGrid(10, 10);
        const m = new Matrix4();
        p.writeMatrix(m, 10, 10, 0, 0, 0);
        const pos = new Vector3().setFromMatrixPosition(m);
        expect(pos.z).toBeCloseTo(PLANET_RADIUS, 3);
        expect(Math.abs(pos.x)).toBeGreaterThan(0);
    });
});

describe('PreviewProjector · area-local 期', () => {
    const flatArea = {
        index: 0,
        parentIndex: -1,
        tropicAnchor: 0,
        areaSegments: PLANET_SEGMENT,
        anchorLocalOffsetX: 0,
        anchorLocalOffsetY: 0,
        width: 27,
        height: 22,
    };

    it('扁平字段与嵌套字段都解析成 BlueprintArea', () => {
        const flat = toBlueprintAreas([flatArea]);
        expect(flat[0].anchorLocalOffset).toEqual({ x: 0, y: 0 });
        expect(flat[0].size).toEqual({ x: 27, y: 22 });

        const nested = toBlueprintAreas([
            {
                index: 0,
                areaSegments: PLANET_SEGMENT,
                anchorLocalOffset: { x: 1, y: 2 },
                size: { x: 5, y: 6 },
            },
        ]);
        expect(nested[0].anchorLocalOffset).toEqual({ x: 1, y: 2 });
        expect(nested[0].size).toEqual({ x: 5, y: 6 });
        expect(nested[0].parentIndex).toBe(-1);
    });

    it('切换坐标语义会 bump version（调用方据此硬重投影）', () => {
        const p = new PreviewProjector();
        p.observeGrid(0, 0);
        const before = p.currentVersion;
        expect(p.setCoordinateSystem('blueprint-area-local-v1')).toBe(true);
        expect(p.currentVersion).toBeGreaterThan(before);
        expect(p.currentMode).toBe('area');
        // 同一个坐标语义重复上报不算切换
        expect(p.setCoordinateSystem('blueprint-area-local-v1')).toBe(false);
    });

    it('area-local 投影与 calcBuildingTrans 逐位一致', () => {
        const p = new PreviewProjector();
        p.setCoordinateSystem('blueprint-area-local-v1');
        expect(p.setAreas([flatArea])).toBe(true);

        const m = new Matrix4();
        p.writeMatrix(m, 3, 4, 1, 90, 0);

        // 以正式场景的同一套函数为基准：预览层不能出现"预览位置和正式结果不一样"
        const pos = findPosForAreas(toBlueprintAreas([flatArea]), PLANET_SEGMENT);
        const expected = calcBuildingTrans(PLANET_RADIUS, pos, {
            areaIndex: 0,
            localOffset: [
                { x: 3, y: 4, z: 1 },
                { x: 3, y: 4, z: 1 },
            ],
            yaw: [90, 90],
        } as unknown as BlueprintBuilding)[0];

        expect(m.elements).toEqual(
            expected.elements.map((v) => expect.closeTo(v, 6))
        );
    });

    it('没有 areas 时不抛错（退化为 layout 同款投影）', () => {
        const p = new PreviewProjector();
        p.setCoordinateSystem('blueprint-area-local-v1');
        expect(p.setAreas(undefined)).toBe(false);
        const m = new Matrix4();
        expect(() => p.writeMatrix(m, 1, 1, 0, 0, 0)).not.toThrow();
    });
});
