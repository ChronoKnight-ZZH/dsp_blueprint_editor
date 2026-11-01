import { PerspectiveCamera, Vector3 } from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { PLANET_RADIUS } from '@/planetConstants';

/**
 * `PlanetMapControls.focusSpherePoint` / `reset` 的回归测试。
 *
 * 针对的是「聚焦建筑后镜头被锁死」这个缺陷（BlueprintViewer 侧发现）：
 *   - 旧实现把 `controls.target` 挪到球面建筑上，而控件模型是「绕球心轨道 + 目标半径 = 星球半径」，
 *     于是半径小于 `targetRadius` → `rotate()` 与滚轮公式反向，表现为动不了。
 *   - 修法让轨道中心留在球心，相机沿法线摆放 —— 建筑仍精确居中，且缩放/旋转正常。
 *
 * ⚠️ 合并说明（分支合并时改写）：
 * 「建筑模型」分支把本控件重写成了「锚点 anchor + 仰角 tilt + 视距 distance」模型
 * （相机位置由 `update()` 每帧解算，不再有 `spherical` / `panOffset` / `scale`），
 * 因此本文件按新模型重写断言，但**保留原来 5 条行为**：
 *   1) 相机落在「目标点 + 法线 × distance」方向上，|camera| = R + distance，target 恒为球心；
 *   2) 目标点投影精确居中；
 *   3) 聚焦后滚轮缩放仍然可用（不会跳回去）；
 *   4) 聚焦后拖拽旋转仍然可用；
 *   5) distance 过小时被抬到最近处（不会钻进地面）。
 *
 * 新模型下的取舍：`maxTilt = 85°`（正上方 lookAt 会因 up 与视线平行而退化），
 * 所以相机相对「目标点法线」会有 `cos(85°) ≈ 8.7% × distance` 的切向偏移，
 * 目标点仍由 `lookAt` 精确居中，第 1 条因此断言的是相机**半径**而不是某条轴上的坐标。
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
    // 与 RenderCore 构造时一致的限位。新模型的 min/maxDistance 是「相机到锚点的距离」，
    // 库侧想要的「相机到球心 1.04R ~ 4R」换算过来就是 0.04R ~ 3R。
    controls.minDistance = PLANET_RADIUS * 0.04;
    controls.maxDistance = PLANET_RADIUS * 3;
    controls.targetRadius = PLANET_RADIUS;
    controls.update();
    return { camera, controls };
}

/** 球面 +Z 上的一点，模拟一栋建筑 */
function surfacePoint(): Vector3 {
    return new Vector3(0, 0, PLANET_RADIUS);
}

describe('focusSpherePoint', () => {
    it('相机落在「目标点 + 法线 × distance」方向上，target 保持球心', () => {
        const { camera, controls } = createControls();
        const point = surfacePoint();

        controls.focusSpherePoint(point, 100);

        // 相机到球心的距离 = 目标点到球心的距离 + 眼距
        expect(camera.position.length()).toBeCloseTo(PLANET_RADIUS + 100, 4);
        // 目标点在 +Z：相机仍在 x=0 的包含 Z 轴的竖直平面内（切向偏移只发生在 y）
        expect(camera.position.x).toBeCloseTo(0, 6);
        expect(camera.position.z).toBeGreaterThan(0);
        // 轨道中心仍是球心
        expect(controls.target.length()).toBeCloseTo(0, 10);
        expect(controls.planetRadius).toBeCloseTo(PLANET_RADIUS, 10);
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
        controls.dollyIn(0.9);      // 拉近：视距 × 0.9
        controls.update();

        const after = camera.position.length();
        expect(after).toBeLessThan(before);
        expect(after).toBeGreaterThan(PLANET_RADIUS);
    });

    it('聚焦后拖拽旋转仍然可用（相机确实绕着球心转）', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(surfacePoint(), 100);

        const before = camera.position.clone();
        controls.rotate(100, 0);    // 水平拖 100px → 改变方位角
        controls.update();

        const moved = camera.position.distanceTo(before);
        expect(moved).toBeGreaterThan(1);
        // 旋转不改变视距：仍在同一半径的球面上
        expect(camera.position.length()).toBeCloseTo(before.length(), 4);
        expect(controls.target.length()).toBeCloseTo(0, 10);
    });

    it('distance 过小时被抬到「贴地最近处」（不会钻进地面）', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(surfacePoint(), 1);

        // 视距被夹到 minDistance：相机半径 = hypot(R + minHeight + sin(tilt)·min, cos(tilt)·min)
        const min = controls.minDistance;
        const tilt = controls.tilt;
        const expected = Math.hypot(
            PLANET_RADIUS + controls.minHeight + Math.sin(tilt) * min,
            Math.cos(tilt) * min,
        );
        expect(camera.position.length()).toBeCloseTo(expected, 3);
        expect(camera.position.length()).toBeGreaterThan(PLANET_RADIUS * 1.04);
    });
});

describe('reset', () => {
    it('库模式（未 setHome）按「相机到球心距离」回到正上方俯视', () => {
        const { camera, controls } = createControls();
        controls.focusSpherePoint(
            new Vector3(0, 0, 1).applyAxisAngle(new Vector3(1, 0, 0), 0.7).multiplyScalar(PLANET_RADIUS),
            100,
        );

        controls.reset(2 * PLANET_RADIUS);

        expect(camera.position.length()).toBeCloseTo(2 * PLANET_RADIUS, 4);
        expect(camera.position.x).toBeCloseTo(0, 6);
        expect(controls.target.length()).toBeCloseTo(0, 10);
    });

    it('编辑器模式（已 setHome）回到入场姿态', () => {
        const { camera, controls } = createControls();
        const anchor = new Vector3(0, 0, 1);
        const viewDir = new Vector3(0, 1, 0);
        controls.setHome(anchor, viewDir, 85 * Math.PI / 180, 150);

        controls.rotate(120, 0);
        controls.update();
        const before = camera.position.clone();
        expect(before.distanceTo(new Vector3())).toBeGreaterThan(0);

        controls.reset();
        expect(controls.anchor.z).toBeCloseTo(1, 6);
        expect(controls.tilt).toBeCloseTo(85 * Math.PI / 180, 10);
        expect(controls.distance).toBeCloseTo(150, 10);
        // 入场姿态可重复：再 reset 一次位置不变
        const once = camera.position.clone();
        controls.reset();
        expect(camera.position.distanceTo(once)).toBeCloseTo(0, 6);
    });
});
