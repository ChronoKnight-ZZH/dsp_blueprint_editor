import { PerspectiveCamera, Vector3 } from 'three';
import { PlanetMapControls } from '@/planet/PlanetMapControls';

const R = 200.2;
const DEG = Math.PI / 180;

/** 单测里只需要一个够用的假 canvas：构造函数只用 style / clientHeight / 事件绑定 */
function fakeDomElement(clientHeight = 900) {
    return {
        style: {} as CSSStyleDeclaration,
        clientHeight,
        addEventListener() { /* noop */ },
        removeEventListener() { /* noop */ },
        setPointerCapture() { /* noop */ },
        releasePointerCapture() { /* noop */ },
    } as unknown as HTMLElement;
}

function createControls() {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 3000);
    const controls = new PlanetMapControls(camera, fakeDomElement());
    controls.planetRadius = R;
    controls.minDistance = 3;
    controls.maxDistance = 1200;
    controls.minHeight = 1.5;
    controls.minTilt = 0;
    controls.maxTilt = 85 * DEG;
    return { camera, controls };
}

const anchor = (v: Vector3, x: number, y: number, z: number) => v.set(x, y, z).normalize();

describe('PlanetMapControls（星球地图相机）', () => {
    it('锚点在球面上：相机高度 = R + minHeight + sin(tilt)·距离，切向偏移 = cos(tilt)·距离', () => {
        const { camera, controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.tilt = 85 * DEG;
        controls.distance = 150;

        controls.update();

        const radial = camera.position.dot(controls.anchor);
        const tangential = camera.position.dot(controls.viewDir);
        expect(radial).toBeCloseTo(R + 1.5 + 150 * Math.sin(85 * DEG), 6);
        expect(tangential).toBeCloseTo(150 * Math.cos(85 * DEG), 6);
    });

    it('永远看向球面上的锚点（不是球心）', () => {
        const { camera, controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.tilt = 60 * DEG;
        controls.distance = 150;
        controls.update();

        const target = controls.anchor.clone().multiplyScalar(R);
        const expected = target.sub(camera.position).normalize();
        const dir = camera.getWorldDirection(new Vector3());
        expect(dir.angleTo(expected)).toBeLessThan(1e-6);
    });

    it('相机 up 取当地法线（不再是世界 +Y）', () => {
        const { camera, controls } = createControls();
        // 挑一个不在极点上、也不在赤道上的锚点
        anchor(controls.anchor, 0.5, 0.5, 0.7);
        controls.viewDir.set(1, -1, 0);
        controls.tilt = 30 * DEG;
        controls.distance = 80;
        controls.update();

        expect(camera.up.angleTo(controls.anchor)).toBeLessThan(1e-6);
        // 视线的「上」被 rol 出去后仍是法线方向的主导分量
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        expect(up.dot(controls.anchor)).toBeGreaterThan(0);
    });

    it('压到平视时距离被地平线收住，但抬回仰角能复原缩放级别', () => {
        const { controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.tilt = 85 * DEG;
        controls.distance = 150;
        controls.update();
        expect(controls.effectiveDistance).toBeCloseTo(150, 6);

        controls.setTilt(0);
        // 离地 1.5 处的地平线 ≈ R·acos(R/(R+1.5)) ≈ 24.5
        expect(controls.effectiveDistance).toBeGreaterThan(20);
        expect(controls.effectiveDistance).toBeLessThan(30);
        // 用户设定的距离没有被改写
        expect(controls.distance).toBeCloseTo(150, 6);

        controls.setTilt(85 * DEG);
        expect(controls.effectiveDistance).toBeCloseTo(150, 6);
    });

    it('平视拉远时自动抬高仰角（避免视线穿进球体）', () => {
        const { controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.setTilt(0);
        controls.setDistance(600);

        expect(controls.tilt).toBeGreaterThan(0);
        // 抬到刚好可见之后，设定的距离能真正生效
        expect(controls.effectiveDistance).toBeCloseTo(600, 3);
    });

    it('平移：锚点始终在单位球面上，绕球心转过接近「位移 / R」的角度', () => {
        const { controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.tilt = 85 * DEG;
        controls.distance = 150;
        controls.update();

        const before = controls.anchor.clone();
        controls.pan(120, 0);
        controls.update();

        expect(controls.anchor.length()).toBeCloseTo(1, 9);
        // 目标点处的地面尺度：2·151.5·tan(25°)/900 ≈ 0.157 世界单位/像素
        const angle = before.angleTo(controls.anchor);
        expect(angle).toBeGreaterThan(0.08);
        expect(angle).toBeLessThan(0.11);
        // 平移后水平朝向仍应该落在切平面里
        expect(controls.viewDir.dot(controls.anchor)).toBeCloseTo(0, 9);
    });

    it('旋转：水平只改方位、竖直只改仰角', () => {
        const { controls } = createControls();
        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.tilt = 45 * DEG;
        controls.distance = 150;

        const anchorBefore = controls.anchor.clone();
        const tiltBefore = controls.tilt;

        controls.rotate(200, 0);
        expect(controls.anchor.angleTo(anchorBefore)).toBeLessThan(1e-9);
        expect(controls.tilt).toBeCloseTo(tiltBefore, 9);
        expect(controls.viewDir.dot(controls.anchor)).toBeCloseTo(0, 9);

        controls.rotate(0, 200);
        expect(controls.tilt).toBeGreaterThan(tiltBefore);
        expect(controls.tilt).toBeCloseTo(tiltBefore + 200 * (50 * DEG) / 900, 9);
    });

    it('仰角夹在 [minTilt, maxTilt]', () => {
        const { controls } = createControls();
        controls.setTilt(-1);
        expect(controls.tilt).toBe(0);
        controls.setTilt(2);
        expect(controls.tilt).toBeCloseTo(85 * DEG, 9);
    });

    it('中键不承担任何操作（缩放只走滚轮）', () => {
        const { controls } = createControls();
        // -1 表示「没有绑定动作」，按下时状态机落到 NONE
        expect(controls.mouseButtons.MIDDLE as unknown as number).toBe(-1);
        expect(controls.mouseButtons.LEFT).not.toBe(-1);
        expect(controls.mouseButtons.RIGHT).not.toBe(-1);
    });

    it('WASD 是平移：W 让视野上移、A 让视野左移（锚点朝屏幕对应方向走）', () => {
        const press = (controls: ReturnType<typeof createControls>['controls'], code: string) => {
            (controls as unknown as { handleKeyDown(e: KeyboardEvent): void })
                .handleKeyDown({ code, preventDefault() { /* noop */ } } as KeyboardEvent);
            controls.updateTimeDelta(0.25);
        };

        // W：位移应该落在屏幕上方向（相机局部 Y，不是 anchor 法线本身）
        {
            const { camera, controls } = createControls();
            anchor(controls.anchor, 0, 0, 1);
            controls.viewDir.set(0, 1, 0);
            controls.tilt = 60 * DEG;
            controls.distance = 150;
            controls.update();

            const before = controls.anchor.clone();
            const screenUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            press(controls, 'KeyW');

            const moved = controls.anchor.clone().sub(before);
            expect(moved.length()).toBeGreaterThan(0);
            expect(moved.dot(screenUp)).toBeGreaterThan(0);
        }

        // A：位移应该落在屏幕左方向（即 −right）
        {
            const { camera, controls } = createControls();
            anchor(controls.anchor, 0, 0, 1);
            controls.viewDir.set(0, 1, 0);
            controls.tilt = 60 * DEG;
            controls.distance = 150;
            controls.update();

            const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const before = controls.anchor.clone();
            press(controls, 'KeyA');

            const moved = controls.anchor.clone().sub(before);
            expect(moved.length()).toBeGreaterThan(0);
            expect(moved.dot(right)).toBeLessThan(0);
        }
    });

    it('reset() 回到 setHome() 给的入场姿态', () => {
        const { camera, controls } = createControls();
        const home = new Vector3(1, 0, 0);
        const dir = new Vector3(0, 0, 1);
        controls.setHome(home, dir, 85 * DEG, 240);

        anchor(controls.anchor, 0, 0, 1);
        controls.viewDir.set(0, 1, 0);
        controls.setTilt(0);
        controls.setDistance(10);
        controls.update();

        controls.reset();
        expect(controls.anchor.angleTo(home)).toBeLessThan(1e-9);
        expect(controls.tilt).toBeCloseTo(85 * DEG, 9);
        expect(controls.distance).toBeCloseTo(240, 9);
        expect(camera.position.dot(controls.anchor))
            .toBeCloseTo(R + 1.5 + 240 * Math.sin(85 * DEG), 6);
    });
});
