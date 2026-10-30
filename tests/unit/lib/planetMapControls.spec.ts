import { PerspectiveCamera, Vector3 } from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { PLANET_RADIUS } from '@/planetConstants';

/**
 * `PlanetMapControls.focusSpherePoint` 的回归测试。
 *
 * 针对的是「聚焦建筑后镜头被锁死」这个缺陷：
 *   - 旧实现把 `controls.target` 挪到球面建筑上，而控件模型是「绕球心轨道 + 目标半径 = 星球半径」，
 *     于是半径（≈100）小于 `targetRadius`（≈200）→ `rotate()` 的 `(半径 − targetRadius)` 变负、
 *     滚轮公式 `radius = targetRadius + (radius − targetRadius) × scale` 反向，表现为动不了。
 *   - 新实现让 target 留在球心，相机沿法线摆放 —— 建筑仍精确居中，且缩放/旋转正常。
 *
 * 这里不构造 RenderCore（需要 WebGL），只测控件层的几何与自由度。
 */

/** 最小 domElement 替身：只实现控件真正用到的成员 */
function fakeDomElement(): HTMLElement {
    return {
        style: {} as CSSStyleDeclaration,
        clientWidth: 800,
        clientHeight: 600,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    } as unknown as HTMLElement;
}

function createControls() {
    const camera = new PerspectiveCamera(50, 4 / 3, 0.5, 3000);
    camera.position.set(0, 0, 2 * PLANET_RADIUS);
    const controls = new PlanetMapControls(camera, fakeDomElement());
    // 与 RenderCore 构造时一致的限位
    controls.minDistance = PLANET_RADIUS * 1.04;
    controls.maxDistance = PLANET_RADIUS * 4;
    controls.targetRadius = PLANET_RADIUS;
    controls.update();
    return { camera, controls };
}

/** 球面 +Z 上的一点，模拟一栋建筑 */
function surfacePoint(): Vector3 {
    return new Vector3(0, 0, PLANET_RADIUS);
}

describe('focusSpherePoint', () => {
    it('相机落在「目标点 + 法线 × distance」处，target 保持球心', () => {
        const { camera, controls } = createControls();
        const point = surfacePoint();

        controls.focusSpherePoint(point, 100);

        expect(camera.position.x).toBeCloseTo(0, 6);
        expect(camera.position.y).toBeCloseTo(0, 6);
        expect(camera.position.z).toBeCloseTo(PLANET_RADIUS + 100, 4);
        expect(controls.target.length()).toBeCloseTo(0, 10);
    });

    it('目标点在画面上精确居中（投影 ≈ 0,0）', () => {
        const { camera, controls } = createControls();
        // 换一个不在 +Z 上的点，确认不是靠「相机在 +Z」蒙对的
        const point = new Vector3(0, 0, 1)
            .applyAxisAngle(new Vector3(1, 0, 0), 0.7)
            .multiplyScalar(PLANET_RADIUS);

        controls.focusSpherePoint(point, 100);
        camera.updateMatrixWorld();

        const ndc = point.clone().project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
        expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
    });

    it('聚焦后滚轮缩放仍然可用（不会跳回 minDistance）', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(surfacePoint(), 100);

        const before = camera.position.length();
        controls.dollyIn(0.9);      // 拉近：scale *= 0.9
        controls.update();

        const after = camera.position.length();
        expect(after).toBeLessThan(before);
        // 控件按「离地高度」缩放：radius = R + (radius − R) × scale
        expect(after).toBeCloseTo(PLANET_RADIUS + (before - PLANET_RADIUS) * 0.9, 3);
    });

    it('聚焦后拖拽旋转仍然可用（角度变化符合 (半径 − R) 的比例）', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(surfacePoint(), 100);

        const before = camera.position.clone();
        controls.rotate(0, 100);    // 向下拖 100px
        controls.update();

        const moved = camera.position.distanceTo(before);
        // 半径 300.2、目标半径 200.2 → 高度 100，屏幕高 600px：
        // 单位角 = 100 * tan(25°) * 2 / 200.2 / 600 ≈ 7.76e-4 rad/px
        // 100px → φ 变化约 0.0776 rad → 位置移动 ≈ 300.2 * 0.0776 ≈ 23
        expect(moved).toBeGreaterThan(10);
        expect(controls.target.length()).toBeCloseTo(0, 10);
    });

    it('distance 过小时被抬到「贴地最近处」（|camera| = minDistance）', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(surfacePoint(), 1);

        expect(camera.position.length()).toBeCloseTo(PLANET_RADIUS * 1.04, 3);
    });
});
