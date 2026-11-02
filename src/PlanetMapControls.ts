import {
    EventDispatcher,
    MOUSE,
    PerspectiveCamera,
    Quaternion,
    TOUCH,
    Vector2,
    Vector3,
} from "three";

enum STATE {
    NONE,
    ROTATE,
    PAN,
    DOLLY,
    TOUCH_ROTATE,
    TOUCH_PAN,
    TOUCH_DOLLY_PAN,
    TOUCH_DOLLY_ROTATE,
}

const EPS = 0.000001;
const DEG2RAD = Math.PI / 180;

/** 入场姿态：由外部通过 setHome() 给出，reset() / N 键回到这里 */
export interface CameraHome {
    /** 球面上的单位方向向量（锚点 / 当地法线） */
    anchor: Vector3;
    /** 切平面内由锚点指向相机的单位向量 */
    viewDir: Vector3;
    /** 仰角（弧度）：0 = 平视，maxTilt = 俯瞰 */
    tilt: number;
    /** 相机到锚点的距离 */
    distance: number;
}

/**
 * 星球地图相机（高德地图网页版那一套）。
 *
 * 与旧版「绕球心轨道」的根本区别：**视线的锚点从球心挪到了球面上的一点**，
 * 于是一定会出现真正的俯仰 —— 旧版因为永远盯着球心，屏幕中心的视线永远垂直于
 * 球面，所以只能是一张俯视图，拖拽只是让星球在画面里滚。
 *
 *   tilt = 0        → 平视：相机贴在离地 minHeight 处，视线擦着球面，看得到建筑立面
 *   tilt = maxTilt  → 俯瞰：几乎从正上方看下去，接近旧版的地图视角
 *
 * 操作（右键拖拽在旧版里是空着的，右键单击才剔除建筑，已有位移阈值区分）：
 *   右键左右拖 → 绕锚点转方位（锚点不动，星球在画面里转）
 *   右键上下拖 → 改仰角（向下 = 更俯瞰，向上 = 更平视）
 *   左键拖     → 沿球面平移锚点
 *   滚轮       → 改相机到锚点的距离（唯一的缩放入口，中键不承担任何操作）
 *   WASD       → 上下左右平移（与左键拖拽同一套换算）
 *
 * **不再固定 N 极朝上**：相机的 up 取锚点处的球面法线，这样地平线永远是水平的、
 * 建筑永远竖着，但 N 极在画面上的位置随锚点自然变化，不再往正北做吸附。
 *
 * 球面自带一条硬约束：站在球面上看不到地平线以外的目标。所以距离与仰角必须联动
 * （maxDistanceForTilt / minTiltForDistance）：拉远时自动抬高视角，压到平视时
 * 自动收缩距离 —— 否则视线会穿进球体，锚点被星球自己挡在后面。
 */
export class PlanetMapControls extends EventDispatcher<{
    change: object;
    start: object;
    end: object;
}> {
    static changeEvent = { type: "change" } as const;
    static startEvent = { type: "start" } as const;
    static endEvent = { type: "end" } as const;

    enabled = true;

    /** 星球半径（世界单位），挂载后由外部设置 */
    planetRadius = 200.2;

    /** 视线锚点：球面上的单位方向向量，同时也是该处的球面法线 */
    readonly anchor = new Vector3(0, 0, 1);
    /** 水平朝向：切平面内由锚点指向相机的单位向量（update 保证与 anchor 正交） */
    readonly viewDir = new Vector3(0, 1, 0);

    /** 仰角（弧度）：minTilt = 平视，maxTilt = 俯瞰 */
    tilt = 85 * DEG2RAD;
    minTilt = 0;
    /** 上限不取 90°：正上方时相机 up 与视线平行，lookAt 会退化 */
    maxTilt = 85 * DEG2RAD;

    /** 用户设定的相机到锚点距离（世界单位）；实际生效的见 effectiveDistance */
    distance = 150;
    minDistance = 3;
    maxDistance = 1200;

    /** 相机离球面的最低高度：平视时贴在离地 minHeight 处，不会钻进地面 */
    minHeight = 1.5;

    enableDolly = true;
    dollySpeed = 1.0;
    wheelDollyBase = 0.999;

    /** 右键拖拽的旋转开关与灵敏度 */
    enableRotate = true;
    rotateSpeed = 1.0;

    /**
     * 键盘平移：屏幕像素 / 秒（与拖拽同一套换算，所以看起来是「箭头键滚动地图」）。
     * 语义按拖拽算：W = 把内容往下推 = 视野上移，A = 把内容往右推 = 视野左移。
     */
    keys: Record<string, { pan: Vector2 }> = {
        KeyW: { pan: new Vector2(0, 1) },
        KeyS: { pan: new Vector2(0, -1) },
        KeyA: { pan: new Vector2(1, 0) },
        KeyD: { pan: new Vector2(-1, 0) },
    };
    keyPanSpeed = 240.0;

    /** 拖拽死区（css 像素）：位移小于它按点击处理，避免单击时抖一下视角 */
    dragThreshold = 3;

    /** 左键平移、右键旋转；中键不承担任何操作（缩放只走滚轮） */
    mouseButtons = {
        LEFT: MOUSE.PAN,
        MIDDLE: -1 as MOUSE,
        RIGHT: MOUSE.ROTATE,
    };

    touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };

    constructor(
        public object: PerspectiveCamera,
        public domElement: HTMLElement
    ) {
        super();
        domElement.style.touchAction = "none";

        this.onContextMenu = this.onContextMenu.bind(this);
        this.domElement.addEventListener("contextmenu", this.onContextMenu);

        this.domElement.addEventListener("pointerdown", this.onPointerDown);
        this.domElement.addEventListener("pointercancel", this.onPointerCancel);
        this.domElement.addEventListener("wheel", this.onMouseWheel, {
            passive: false,
        });

        // force an update at start
        this.update();
    }

    private domElementKeyEvents: GlobalEventHandlers | null = null;
    listenToKeyEvents(domElement: GlobalEventHandlers) {
        domElement.addEventListener("keydown", this.onKeyDown);
        domElement.addEventListener("keyup", this.onKeyUp);
        this.domElementKeyEvents = domElement;
    }

    /** 入场姿态；null 时 reset() 不做事 */
    home: CameraHome | null = null;

    setHome(anchor: Vector3, viewDir: Vector3, tilt: number, distance: number) {
        this.home = {
            anchor: anchor.clone(),
            viewDir: viewDir.clone(),
            tilt,
            distance,
        };
    }

    /** 相机绕球心的方位角（本控件用「锚点 + 仰角 + 视距」，方位由锚点决定） */
    getAzimuthalAngle() {
        return Math.atan2(this.anchor.x, this.anchor.z);
    }

    /** 相机到锚点（视线落点）的实际距离 */
    getDistance() {
        return this.targetDistance();
    }

    /**
     * [库侧兼容] OrbitControls 风格的「环绕目标点」。
     *
     * 本控件的轨道中心恒为球心，所以它**始终是零向量**：
     * `RenderCore` 与单元测试都按「target 留在球心」来断言，聚焦不会把它挪到建筑上
     * （那正是旧实现「聚焦后镜头锁死」的根因）。
     */
    readonly target = new Vector3(0, 0, 0);

    /** [库侧兼容] `planetRadius` 的别名，供 `RenderCore` 按旧 API 设置星球半径 */
    get targetRadius() {
        return this.planetRadius;
    }

    set targetRadius(value: number) {
        this.planetRadius = value;
    }

    /**
     * 把「相机到**球心**的距离」换算成本模型的 `distance`（相机到锚点的距离）。
     *
     * 由 `hypot(R + minHeight + sin·d, cos·d) = D` 解出：
     * `d = −sin·(R+minHeight) + √(D² − cos²·(R+minHeight)²)`
     */
    private distanceForCameraRadius(cameraRadius: number) {
        const R = this.planetRadius + this.minHeight;
        const s = Math.sin(this.tilt);
        const c = Math.cos(this.tilt);
        const inner = cameraRadius * cameraRadius - c * c * R * R;
        if (inner <= 0) return this.minDistance;
        return Math.max(this.minDistance, -s * R + Math.sqrt(inner));
    }

    /**
     * 重置视角（合并后统一实现，两种模式共用）：
     *  - **编辑器**：调用过 `setHome` 时回到入场姿态（俯仰 + 锚在图纸质心），
     *    即「预览蓝图替换」/ 按 N 键的行为；
     *  - **库**：无 `home` 时按 `distance`（相机到**球心**的距离）回到正上方俯视，
     *    `RenderCore.reset(2 * PLANET_RADIUS)` 走这一支。
     */
    reset(distance?: number) {
        this.dragging = false;

        const home = this.home;
        if (home !== null) {
            this.anchor.copy(home.anchor).normalize();
            this.viewDir.copy(home.viewDir);
            this.tilt = home.tilt;
            this.distance = home.distance;
            this.update();
            return;
        }

        if (distance === undefined) return;

        this.anchor.set(0, 0, 1);
        this.viewDir.set(0, 1, 0);
        this.tilt = this.maxTilt;
        this.distance = this.distanceForCameraRadius(distance);
        this.update();
    }

    /**
     * 把镜头对准球面某点，**轨道中心保持在球心**。
     *
     * 合并说明：旧实现（BlueprintViewer）直接摆相机位置并依赖 OrbitControls 的
     * `target` / `spherical`；本文件的相机模型已改为「锚点 + 仰角 + 视距」，
     * 相机位置由 `update()` 每帧解算，因此改为设置这三个参数。
     *
     * - `anchor` 取目标点的法线 → `update()` 的 lookAt 目标正是 `anchor × R`，
     *   目标点依然**精确居中**；
     * - 轨道中心仍是球心 → 聚焦后滚轮缩放（= 改离地高度）、拖拽旋转、平移全部照常，
     *   不会再出现「聚焦后镜头锁死」；
     * - `distance` 是相机到目标点的眼距，内部换算成视距参数；
     * - 受 `maxTilt = 85°` 限制，相机会偏离法线约 `cos(85°) ≈ 8.7%` 的距离，
     *   这是「正上方 lookAt 会因 up 与视线平行而退化」的有意取舍。
     */
    focusSpherePoint(point: Vector3, distance: number) {
        const dir = point.clone().normalize();
        // 退化情形（目标点在球心）：回落到 +Z，避免零向量
        if (dir.lengthSq() === 0) dir.set(0, 0, 1);

        this.anchor.copy(dir);
        this.viewDir.set(0, 1, 0);
        this.tilt = this.maxTilt;
        this.dragging = false;
        this.distance = this.distanceForCameraRadius(point.length() + distance);
        this.update();
    }

    //
    // 角度 / 距离 / 可见性
    //

    /**
     * 实际生效的距离：压到平视时被地平线收到 maxDistanceForTilt 以内。
     * 与 distance 分开存，是为了「把仰角压下去再抬回来」时还能回到原来的缩放级别。
     */
    get effectiveDistance() {
        return Math.min(this.distance, this.maxDistanceForTilt(this.tilt));
    }

    /** 竖直方向满屏对应的竖直 FOV */
    private anglePerPixel() {
        const h = Math.max(1, this.domElement.clientHeight);
        return (this.object.fov * DEG2RAD) / h;
    }

    /** 相机到锚点的实际距离（含 minHeight 抬升） */
    private targetDistance() {
        const distance = this.effectiveDistance;
        const height = this.minHeight + Math.sin(this.tilt) * distance;
        const horizontal = Math.cos(this.tilt) * distance;
        return Math.hypot(height, horizontal);
    }

    /** 锚点处的地面尺度（世界单位 / 像素） */
    private worldPerPixel() {
        const h = Math.max(1, this.domElement.clientHeight);
        return (
            (2 *
                this.targetDistance() *
                Math.tan((this.object.fov * DEG2RAD) / 2)) /
            h
        );
    }

    /** 站在离地 h 高处的相机，能否看到球面上水平距离 horizontal 外的点 */
    private visibleAt(distance: number, tilt: number) {
        const R = this.planetRadius;
        const height = this.minHeight + Math.sin(tilt) * distance;
        const horizontal = Math.cos(tilt) * distance;
        // 地平线角：acos(R / (R + h))，乘 R 换成球面弧长
        return horizontal <= R * Math.acos(Math.min(1, R / (R + height)));
    }

    /** 给定仰角，锚点仍在地平线内的最大距离 */
    private maxDistanceForTilt(tilt: number) {
        let lo = 0;
        let hi = this.maxDistance * 4;
        for (let i = 0; i < 32; i++) {
            const mid = (lo + hi) / 2;
            if (this.visibleAt(mid, tilt)) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    /** 给定距离，锚点仍在地平线内所需的最小仰角 */
    private minTiltForDistance(distance: number) {
        if (!this.visibleAt(distance, this.maxTilt)) return this.maxTilt;
        let lo = this.minTilt;
        let hi = this.maxTilt;
        for (let i = 0; i < 32; i++) {
            const mid = (lo + hi) / 2;
            if (this.visibleAt(distance, mid)) hi = mid;
            else lo = mid;
        }
        return hi;
    }

    /** 改仰角：只夹范围，距离由 effectiveDistance 自动收缩（抬回来能复原） */
    setTilt(tilt: number) {
        this.tilt = Math.max(this.minTilt, Math.min(this.maxTilt, tilt));
    }

    /** 改距离：拉远到锚点会被地平线挡住时，自动抬高仰角（相当于视角往上漂） */
    setDistance(distance: number) {
        this.distance = Math.max(
            this.minDistance,
            Math.min(this.maxDistance, distance)
        );
        if (!this.visibleAt(this.distance, this.tilt))
            this.tilt = this.minTiltForDistance(this.distance);
    }

    //
    // 输入 → 状态
    //

    /** 方位：绕锚点转 */
    rotateAzimuth(angle: number) {
        this.viewDir.applyAxisAngle(this.anchor, angle);
        this.viewDir.addScaledVector(
            this.anchor,
            -this.viewDir.dot(this.anchor)
        );
        if (this.viewDir.lengthSq() < EPS) {
            // 退化兜底：随便取一个与 anchor 正交的方向
            this.viewDir.set(0, 1, 0);
            if (Math.abs(this.anchor.y) > 0.9) this.viewDir.set(1, 0, 0);
            this.viewDir.addScaledVector(
                this.anchor,
                -this.viewDir.dot(this.anchor)
            );
        }
        this.viewDir.normalize();
    }

    /** unit: css pixel。水平 → 方位，竖直 → 仰角 */
    rotate(deltaX: number, deltaY: number) {
        const k = this.anglePerPixel() * this.rotateSpeed;
        this.rotateAzimuth(-deltaX * k);
        this.setTilt(this.tilt + deltaY * k);
    }

    private basisForward = new Vector3();
    private basisUp = new Vector3();
    private basisRight = new Vector3();
    private basisTemp = new Vector3();
    private panStep = new Vector3();

    /** 相机基向量，与 update() 里的 lookAt 保持一致 */
    private updateBasis() {
        const R = this.planetRadius;
        const n = this.anchor;
        const distance = this.effectiveDistance;
        const height = this.minHeight + Math.sin(this.tilt) * distance;
        const horizontal = Math.cos(this.tilt) * distance;

        this.basisTemp
            .copy(n)
            .multiplyScalar(R + height)
            .addScaledVector(this.viewDir, horizontal);
        this.basisForward
            .copy(n)
            .multiplyScalar(R)
            .sub(this.basisTemp)
            .normalize();
        this.basisUp
            .copy(n)
            .addScaledVector(this.basisForward, -n.dot(this.basisForward))
            .normalize();
        this.basisRight
            .crossVectors(this.basisForward, this.basisUp)
            .normalize();
    }

    /** unit: css pixel。把锚点沿球面推走，让地面跟着光标走 */
    pan(deltaX: number, deltaY: number) {
        this.updateBasis();
        const scale = this.worldPerPixel();
        this.panStep
            .set(0, 0, 0)
            .addScaledVector(this.basisRight, -deltaX * scale)
            .addScaledVector(this.basisUp, deltaY * scale);
        // 弧长 → 角度：锚点沿切平面推 s 后归一化，等价于转 s/R
        this.anchor
            .addScaledVector(this.panStep, 1 / this.planetRadius)
            .normalize();
    }

    dollyOut(dollyScale: number) {
        this.setDistance(this.distance / dollyScale);
    }

    dollyIn(dollyScale: number) {
        this.setDistance(this.distance * dollyScale);
    }

    //
    // 每帧解算
    //

    private lastPosition = new Vector3();
    private lastQuaternion = new Quaternion();

    update() {
        this.anchor.normalize();

        // pan 之后 viewDir 会略微离开切平面，投影回去（等价于平行移动）
        this.viewDir.addScaledVector(
            this.anchor,
            -this.viewDir.dot(this.anchor)
        );
        if (this.viewDir.lengthSq() < EPS) {
            this.viewDir.set(0, 1, 0);
            if (Math.abs(this.anchor.y) > 0.9) this.viewDir.set(1, 0, 0);
            this.viewDir.addScaledVector(
                this.anchor,
                -this.viewDir.dot(this.anchor)
            );
        }
        this.viewDir.normalize();

        this.tilt = Math.max(this.minTilt, Math.min(this.maxTilt, this.tilt));
        this.distance = Math.max(
            this.minDistance,
            Math.min(this.maxDistance, this.distance)
        );

        const R = this.planetRadius;
        const distance = this.effectiveDistance;
        const height = this.minHeight + Math.sin(this.tilt) * distance;
        const horizontal = Math.cos(this.tilt) * distance;

        const position = this.object.position;
        position
            .copy(this.anchor)
            .multiplyScalar(R + height)
            .addScaledVector(this.viewDir, horizontal);

        // up 取当地法线：地平线水平、建筑竖着（不再吸附正北）
        this.object.up.copy(this.anchor);
        this.object.lookAt(
            this.anchor.x * R,
            this.anchor.y * R,
            this.anchor.z * R
        );

        // update condition is:
        // min(camera displacement, camera rotation in radians)^2 > EPS
        // using small-angle approximation cos(x/2) = 1 - x^2 / 8
        if (
            this.lastPosition.distanceToSquared(this.object.position) > EPS ||
            8 * (1 - this.lastQuaternion.dot(this.object.quaternion)) > EPS
        ) {
            this.lastPosition.copy(this.object.position);
            this.lastQuaternion.copy(this.object.quaternion);

            return true;
        }
        return false;
    }

    dispose() {
        this.domElement.removeEventListener("contextmenu", this.onContextMenu);

        this.domElement.removeEventListener("pointerdown", this.onPointerDown);
        this.domElement.removeEventListener(
            "pointercancel",
            this.onPointerCancel
        );
        this.domElement.removeEventListener("wheel", this.onMouseWheel);

        this.domElement.removeEventListener("pointermove", this.onPointerMove);
        this.domElement.removeEventListener("pointerup", this.onPointerUp);

        if (this.domElementKeyEvents !== null) {
            this.domElementKeyEvents.removeEventListener(
                "keydown",
                this.onKeyDown
            );
            this.domElementKeyEvents.removeEventListener("keyup", this.onKeyUp);
        }
    }

    private state = STATE.NONE;

    /** 已经越过拖拽死区，本次按下算拖拽而不是点击 */
    private dragging = false;

    private rotateStart = new Vector2();
    private rotateEnd = new Vector2();
    private rotateDelta = new Vector2();

    private panStart = new Vector2();
    private panEnd = new Vector2();
    private panDelta = new Vector2();

    private dollyStart = new Vector2();
    private dollyEnd = new Vector2();
    private dollyDelta = new Vector2();

    private pointers: PointerEvent[] = [];
    private pointerPositions: Record<number, Vector2> = {};

    //
    // event callbacks - update the object state
    //
    handleMouseDownRotate(event: PointerEvent) {
        this.rotateStart.set(event.clientX, event.clientY);
    }

    handleMouseDownPan(event: PointerEvent) {
        this.panStart.set(event.clientX, event.clientY);
    }

    handleMouseDownDolly(event: PointerEvent) {
        this.dollyStart.set(event.clientX, event.clientY);
    }

    handleMouseMoveRotate(event: PointerEvent) {
        this.rotateEnd.set(event.clientX, event.clientY);
        this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);
        if (!this.passDragThreshold(this.rotateDelta)) return;

        this.rotate(this.rotateDelta.x, this.rotateDelta.y);

        this.rotateStart.copy(this.rotateEnd);
    }

    handleMouseMovePan(event: PointerEvent) {
        this.panEnd.set(event.clientX, event.clientY);
        this.panDelta.subVectors(this.panEnd, this.panStart);
        if (!this.passDragThreshold(this.panDelta)) return;

        this.pan(this.panDelta.x, this.panDelta.y);

        this.panStart.copy(this.panEnd);
    }

    /** 死区判定：第一次越过阈值才放行，避免单击时抖一下视角 */
    private passDragThreshold(delta: Vector2) {
        if (this.dragging) return true;
        if (delta.length() < this.dragThreshold) return false;
        this.dragging = true;
        return true;
    }

    handleMouseWheel(event: WheelEvent) {
        this.dollyOut(Math.pow(this.wheelDollyBase, event.deltaY));
    }

    private downKeys = new Set<string>();

    protected handleKeyDown(event: KeyboardEvent) {
        if (event.code === "KeyN") {
            this.reset();
            event.preventDefault();
            return;
        }
        if (this.keys[event.code] !== undefined) {
            this.downKeys.add(event.code);
            event.preventDefault();
        }
    }

    protected handleKeyUp(event: KeyboardEvent) {
        this.downKeys.delete(event.code);
    }

    private keyPan = new Vector2();
    updateTimeDelta(deltaTimeInSeconds: number) {
        for (const code of this.downKeys) {
            const act = this.keys[code];
            if (act === undefined) continue;
            this.keyPan
                .copy(act.pan)
                .multiplyScalar(this.keyPanSpeed * deltaTimeInSeconds);
            this.pan(this.keyPan.x, this.keyPan.y);
        }
    }

    handleTouchStartRotate() {
        if (this.pointers.length === 1) {
            this.rotateStart.set(
                this.pointers[0].pageX,
                this.pointers[0].pageY
            );
        } else {
            const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
            const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
            this.rotateStart.set(x, y);
        }
    }

    handleTouchStartDolly() {
        const dx = this.pointers[0].pageX - this.pointers[1].pageX;
        const dy = this.pointers[0].pageY - this.pointers[1].pageY;

        const distance = Math.sqrt(dx * dx + dy * dy);

        this.dollyStart.set(0, distance);
    }

    handleTouchStartDollyRotate() {
        if (this.enableDolly) this.handleTouchStartDolly();

        if (this.enableRotate) this.handleTouchStartRotate();
    }

    handleTouchMoveRotate(event: PointerEvent) {
        if (this.pointers.length == 1) {
            this.rotateEnd.set(event.pageX, event.pageY);
        } else {
            const position = this.getSecondPointerPosition(event);

            const x = 0.5 * (event.pageX + position.x);
            const y = 0.5 * (event.pageY + position.y);

            this.rotateEnd.set(x, y);
        }
        this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);

        this.rotate(this.rotateDelta.x, this.rotateDelta.y);

        this.rotateStart.copy(this.rotateEnd);
    }

    handleTouchMoveDolly(event: PointerEvent) {
        const position = this.getSecondPointerPosition(event);

        const dx = event.pageX - position.x;
        const dy = event.pageY - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        this.dollyEnd.set(0, distance);
        this.dollyDelta.set(
            0,
            Math.pow(this.dollyEnd.y / this.dollyStart.y, this.dollySpeed)
        );

        this.dollyOut(this.dollyDelta.y);

        this.dollyStart.copy(this.dollyEnd);
    }

    handleTouchMoveDollyRotate(event: PointerEvent) {
        if (this.enableDolly) this.handleTouchMoveDolly(event);

        if (this.enableRotate) this.handleTouchMoveRotate(event);
    }

    //
    // event handlers - FSM: listen for events and reset state
    //
    onPointerDown = (event: PointerEvent) => {
        if (!this.enabled) return;

        if (this.pointers.length === 0) {
            this.dragging = false;
            this.domElement.setPointerCapture(event.pointerId);
            this.domElement.addEventListener("pointermove", this.onPointerMove);
            this.domElement.addEventListener("pointerup", this.onPointerUp);
        }

        this.addPointer(event);
        if (event.pointerType === "touch") this.onTouchStart(event);
        else this.onMouseDown(event);
    };

    onPointerMove = (event: PointerEvent) => {
        if (!this.enabled) return;

        if (event.pointerType === "touch") this.onTouchMove(event);
        else this.onMouseMove(event);
    };

    onPointerUp = (event: PointerEvent) => {
        this.removePointer(event);

        if (this.pointers.length === 0) {
            this.domElement.releasePointerCapture(event.pointerId);

            this.domElement.removeEventListener(
                "pointermove",
                this.onPointerMove
            );
            this.domElement.removeEventListener("pointerup", this.onPointerUp);
        }
        this.dispatchEvent(PlanetMapControls.endEvent);
        this.state = STATE.NONE;
        this.dragging = false;
    };

    onPointerCancel = (event: PointerEvent) => {
        this.removePointer(event);
    };

    onMouseDown(event: PointerEvent) {
        let mouseAction = -1;
        switch (event.button) {
            case 0:
                mouseAction = this.mouseButtons.LEFT;
                break;
            case 1:
                mouseAction = this.mouseButtons.MIDDLE;
                break;
            case 2:
                mouseAction = this.mouseButtons.RIGHT;
                break;
        }

        switch (mouseAction) {
            case MOUSE.DOLLY:
                if (!this.enableDolly) return;
                this.handleMouseDownDolly(event);
                this.state = STATE.DOLLY;
                break;

            case MOUSE.ROTATE:
                if (!this.enableRotate) return;
                this.handleMouseDownRotate(event);
                this.state = STATE.ROTATE;
                break;

            case MOUSE.PAN:
                this.handleMouseDownPan(event);
                this.state = STATE.PAN;
                break;

            default:
                this.state = STATE.NONE;
        }

        if (this.state !== STATE.NONE)
            this.dispatchEvent(PlanetMapControls.startEvent);
    }

    onMouseMove(event: PointerEvent) {
        if (!this.enabled) return;

        switch (this.state) {
            case STATE.ROTATE:
                if (!this.enableRotate) return;
                this.handleMouseMoveRotate(event);
                break;
            case STATE.PAN:
                this.handleMouseMovePan(event);
                break;
        }
    }

    onMouseWheel = (event: WheelEvent) => {
        if (!this.enabled || !this.enableDolly || this.state !== STATE.NONE)
            return;
        event.preventDefault();

        this.dispatchEvent(PlanetMapControls.startEvent);
        this.handleMouseWheel(event);
        this.dispatchEvent(PlanetMapControls.endEvent);
    };

    onKeyDown = (event: KeyboardEvent) => {
        if (!this.enabled) return;
        this.handleKeyDown(event);
    };

    onKeyUp = (event: KeyboardEvent) => {
        this.handleKeyUp(event);
    };

    onTouchStart(event: PointerEvent) {
        this.trackPointer(event);
        switch (this.pointers.length) {
            case 1:
                switch (this.touches.ONE) {
                    case TOUCH.ROTATE:
                        if (this.enableRotate === false) return;
                        this.handleTouchStartRotate();
                        this.state = STATE.TOUCH_ROTATE;
                        break;

                    default:
                        this.state = STATE.NONE;
                }
                break;
            case 2:
                switch (this.touches.TWO) {
                    case TOUCH.DOLLY_ROTATE:
                        if (!this.enableDolly && !this.enableRotate) return;
                        this.handleTouchStartDollyRotate();
                        this.state = STATE.TOUCH_DOLLY_ROTATE;
                        break;
                    default:
                        this.state = STATE.NONE;
                }
                break;
            default:
                this.state = STATE.NONE;
        }

        if (this.state !== STATE.NONE)
            this.dispatchEvent(PlanetMapControls.startEvent);
    }

    onTouchMove(event: PointerEvent) {
        this.trackPointer(event);
        switch (this.state) {
            case STATE.TOUCH_ROTATE:
                if (!this.enableRotate) return;
                this.handleTouchMoveRotate(event);
                break;
            case STATE.TOUCH_DOLLY_ROTATE:
                if (!this.enableDolly && !this.enableRotate) return;
                this.handleTouchMoveDollyRotate(event);
                break;
            default:
                this.state = STATE.NONE;
        }
    }

    onContextMenu = (event: Event) => {
        if (this.enabled === false) return;
        event.preventDefault();
    };

    protected addPointer(event: PointerEvent) {
        this.pointers.push(event);
    }

    protected removePointer(event: PointerEvent) {
        delete this.pointerPositions[event.pointerId];
        for (let i = 0; i < this.pointers.length; i++) {
            if (this.pointers[i].pointerId == event.pointerId) {
                this.pointers.splice(i, 1);
                return;
            }
        }
    }

    trackPointer(event: PointerEvent) {
        let position = this.pointerPositions[event.pointerId];
        if (position === undefined) {
            position = new Vector2();
            this.pointerPositions[event.pointerId] = position;
        }
        position.set(event.pageX, event.pageY);
    }

    getSecondPointerPosition(event: PointerEvent) {
        const pointer =
            event.pointerId === this.pointers[0].pointerId
                ? this.pointers[1]
                : this.pointers[0];
        return this.pointerPositions[pointer.pointerId];
    }
}
