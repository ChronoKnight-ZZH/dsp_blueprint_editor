import {
    Scene, PerspectiveCamera, WebGLRenderer, Matrix4, Vector3, Ray, Sphere,
    BoxGeometry, Mesh, MeshStandardMaterial,
} from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { findPosForAreas, calcBuildingTrans } from '@/blueprint/planet';
import type { BlueprintData } from '@/blueprint/parser';
import { onBuildingModelsChanged } from '@/models/buildingModel';
import { reapplyLoadedModelMaterials, setSettingsProvider } from '@/models/glbLoader';
import { IconTexture } from '@/iconTexture';
import type { TextureSink } from '@/iconTexture';
import type { TextureSettings, ViewerRenderSettings } from '@/renderSettingsTypes';
import { PLANET_RADIUS, PLANET_SEGMENT } from '@/planetConstants';
import { createPlanetScene } from './planetScene';
import type { PlanetSceneParts } from './planetScene';
import { buildBuildings } from './buildBuildings';
import { buildBVH } from './buildBVH';
import { AllBuildings } from './AllBuildings';

/** 渲染器最小接口：真实 `WebGLRenderer` 结构上满足，单测可注入 stub */
export interface WebGLRendererLike extends TextureSink {
    domElement: HTMLCanvasElement;
    capabilities: { getMaxAnisotropy(): number };
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    dispose(): void;
}

export interface RenderCoreOptions {
    container: HTMLElement;
    /** 构造期读取的设置快照；后续变更走 `setRenderSettings` */
    settings: ViewerRenderSettings;
    /** 交互能力开关。Viewer 默认 select=true / contextRemove=false */
    interactions?: { select?: boolean; contextRemove?: boolean };
    keyboardTarget?: HTMLElement | null;
    autoResize?: boolean;
    pixelRatio?: number;
    /** 测试注入：jsdom 无 WebGL */
    createRenderer?: (canvas: HTMLCanvasElement) => WebGLRendererLike;
    /** 测试注入：图标图集（默认 new IconTexture(renderer)） */
    createIconTexture?: (renderer: WebGLRendererLike) => IconTexture;
    /**
     * 完整的贴图设置提供者（含 7 个通道位）。
     *
     * `ViewerRenderSettings` 只有 `texturesEnabled` 总开关；而材质重挂需要完整设置。
     * 宿主（编辑器）注入 `() => renderSettings`；Viewer 缺省时由 Runner 用自身设置合成。
     */
    textureSettings?: () => TextureSettings;
    callbacks?: {
        onBuildingSelect?(index: number | null): void;
        onBuildingRemove?(index: number): void;
        onCameraChange?(): void;
        onRebuild?(info: { reason: RebuildReason; buildingCount: number; unknownModelIndexes: number[]; durationMs: number }): void;
    };
}

export type RebuildReason = 'load' | 'settings' | 'data' | 'models';

/**
 * 带上阶段的内部错误。
 *
 * 重建分「定位」（`findPosForAreas`）与「构建」（`buildBuildings` / `buildBVH`）两段，
 * 两者的失败含义完全不同：前者说明蓝图数据不自洽（用户可修），后者说明渲染内部缺陷。
 * Viewer 据此给出不同的 `ViewerError.phase`。
 */
export class RenderPhaseError extends Error {
    constructor(
        public readonly phase: 'position' | 'build',
        public readonly original: unknown,
    ) {
        super(original instanceof Error ? original.message : String(original));
        this.name = 'RenderPhaseError';
    }
}

/** 一次重建产出的场景包（`sceneModel` 的返回类型） */
export interface SceneBundle {
    buildings: AllBuildings;
    bvh: ReturnType<typeof buildBVH>['bvh'];
    transforms: Matrix4[][];
    unknownModelIndexes: number[];
}

const DEFAULT_PIXEL_RATIO_MAX = 2;

/**
 * 共享渲染内核：场景 / 相机 / renderer / controls / rAF 循环 / 重建 / dispose。
 *
 * **不依赖 Vue**（方案 D1），编辑器与 `BlueprintViewer` 共用。
 * 关键约定：
 *   - 重建走 `rebuildScene` 原子替换：构建成功才换场景，失败保留旧场景
 *   - 图标图集跨重建复用，避免每次重建重新分配 1920×1920 纹理并重发图标请求
 *   - 相机回调只在 `controls.update()` 返回 true 的帧合并触发一次
 */
export class RenderCore {
    private readonly container: HTMLElement;
    private readonly scene: Scene;
    /** 相机内部字段；对外经 `get camera()` 暴露（同名会触发 duplicate identifier） */
    private readonly _camera: PerspectiveCamera;
    private readonly renderer: WebGLRendererLike;
    private readonly controls: PlanetMapControls;
    private readonly planet: PlanetSceneParts;
    private readonly iconTexture: IconTexture;
    private resizeObserver: ResizeObserver | null = null;
    private readonly pixelRatio: number;

    private bundle: SceneBundle | null = null;
    private data: BlueprintData | null = null;

    private rafId: number | null = null;
    private disposed = false;
    private lastTimestamp: number | null = null;
    private _cameraVersion = 0;

    private settings: ViewerRenderSettings;
    private callbacks: NonNullable<RenderCoreOptions['callbacks']>;
    /** 模型到达 → 150ms 合并重建 */
    private modelTimer: number | null = null;
    private offModelsChanged: (() => void) | null = null;

    /** 拾取回调的 DOM 监听（dispose 时解除） */
    private readonly onClick: (e: MouseEvent) => void;
    private readonly onContextMenu: (e: MouseEvent) => void;
    private readonly onMouseDown: (e: MouseEvent) => void;
    private rightDownPos: { x: number; y: number } | null = null;

    private readonly interactions: { select: boolean; contextRemove: boolean };
    /** 完整贴图设置来源；缺省时按 ViewerRenderSettings.texturesEnabled + 全开通道位合成 */
    private textureSettingsProvider: () => TextureSettings;
    /** 是否由本实例创建了图标图集（`createIconTexture` 注入时为 false，dispose 不释放） */
    private readonly ownsIconTexture: boolean;
    /** 是否由本实例注册了全局 settingsProvider（dispose 时需要撤销） */
    private readonly ownsSettingsProvider: boolean;
    /** 选中高亮盒；`null` 表示当前无选中 */
    private readonly selectBox: Mesh;
    /** 选中下标（-1 = 无选中），与 `selectBox` 是否在场景中保持同步 */
    private selectBoxIndex = -1;

    constructor(options: RenderCoreOptions) {
        this.container = options.container;
        this.settings = { ...options.settings };
        this.callbacks = options.callbacks ?? {};
        this.interactions = {
            select: options.interactions?.select ?? true,
            contextRemove: options.interactions?.contextRemove ?? false,
        };

        const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
        this.pixelRatio = options.pixelRatio ?? Math.min(dpr, DEFAULT_PIXEL_RATIO_MAX);

        // 完整贴图设置：宿主给了就用宿主的（编辑器注入 reactive 单例），否则由本对象合成
        this.ownsSettingsProvider = options.textureSettings === undefined;
        this.textureSettingsProvider = options.textureSettings ?? (() => ({
            texturesEnabled: this.settings.texturesEnabled,
            textures: {
                albedo: true, normal: true, spec: true, emissive: true,
                effect: true, dirt: true, glass: true,
            },
        }));

        // renderer
        const canvas = document.createElement('canvas');
        this.renderer = options.createRenderer !== undefined
            ? options.createRenderer(canvas)
            : (new WebGLRenderer({ antialias: true, canvas }) as unknown as WebGLRendererLike);
        this.renderer.setPixelRatio(this.pixelRatio);

        // 场景 + 星球
        this.scene = new Scene();
        this.planet = createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT);
        this.scene.add(this.planet.root);

        // 相机
        this._camera = new PerspectiveCamera(50);
        this._camera.near = 0.5;
        this._camera.far = 3000;
        this._camera.position.z = 2 * PLANET_RADIUS;

        // 图标图集：跨重建复用
        this.ownsIconTexture = options.createIconTexture === undefined;
        this.iconTexture = options.createIconTexture !== undefined
            ? options.createIconTexture(this.renderer)
            : new IconTexture(this.renderer);

        // 控件
        this.controls = new PlanetMapControls(this._camera, this.renderer.domElement);
        this.controls.minDistance = PLANET_RADIUS * 1.04;
        this.controls.maxDistance = PLANET_RADIUS * 4;
        this.controls.targetRadius = PLANET_RADIUS;
        const keyTarget = options.keyboardTarget === undefined ? this.container : options.keyboardTarget;
        if (keyTarget !== null)
            this.controls.listenToKeyEvents(keyTarget);
        this.controls.update();

        // 挂载
        this.container.appendChild(this.renderer.domElement);
        this.syncSize();

        if (options.autoResize !== false && typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.syncSize());
            this.resizeObserver.observe(this.container);
        }

        // 选中高亮盒：与编辑器同款外观（半透明蓝、关深度写入，避免遮挡建筑本体）
        this.selectBox = new Mesh(
            new BoxGeometry(1, 1, 1),
            new MeshStandardMaterial({
                color: 0x0074E8, opacity: 0.5, transparent: true, depthWrite: false,
            }),
        );
        this.selectBox.matrixAutoUpdate = false;
        this.selectBox.visible = false;

        // 交互
        this.onClick = (e: MouseEvent) => {
            if (!this.interactions.select)
                return;
            const index = this.pick(e);
            // 点击即选中：内部先更新高亮，再通知宿主（宿主的日志与视觉同时变化）
            this.setSelectedIndex(index);
            this.callbacks.onBuildingSelect?.(index);
        };
        this.onMouseDown = (e: MouseEvent) => {
            if (e.button === 2)
                this.rightDownPos = { x: e.clientX, y: e.clientY };
        };
        this.onContextMenu = (e: MouseEvent) => {
            if (!this.interactions.contextRemove)
                return;
            e.preventDefault();
            // 避免把右键拖拽误判为点击
            if (this.rightDownPos !== null
                && Math.hypot(e.clientX - this.rightDownPos.x, e.clientY - this.rightDownPos.y) > 6)
                return;
            const index = this.pick(e);
            if (index === null)
                return;
            this.callbacks.onBuildingRemove?.(index);
        };
        if (this.interactions.select)
            this.renderer.domElement.addEventListener('click', this.onClick);
        if (this.interactions.contextRemove) {
            this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
            this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
        }

        // 模型懒加载完成 → 合并重建
        this.offModelsChanged = onBuildingModelsChanged(() => this.scheduleModelRebuild());

        // 让 glbLoader 在「模型加载完成」时也能读到正确的贴图设置。
        // 不注册的话它会回落到「七通道全开」的默认值，导致 Viewer 设了
        // texturesEnabled=false 之后新到达的模型仍然带贴图（方案 §4.2 / D2）。
        // 单实例约束下这个全局注册是安全的（方案 D6）。
        if (options.textureSettings === undefined)
            setSettingsProvider(() => this.textureSettingsProvider());
        this.startLoop();
    }

    // ------------------------------------------------------------ 公开 API

    /**
     * 注入蓝图数据并重建场景。
     *
     * 原子性：只有构建成功才提交为新数据并替换旧场景；
     * 抛错时 `this.data` 与场景都保持原状，调用方可以安全地重试或继续用旧数据。
     */
    setBlueprintData(data: BlueprintData | null): void {
        this.assertAlive();
        const previous = this.data;
        this.data = data;
        try {
            this.rebuildScene('load');
        }
        catch (e) {
            // 回滚，保证「失败保留旧场景」同时「失败不改数据」
            this.data = previous;
            throw e;
        }
    }

    /** 原地修改 data 后调用（阶段 C 的编辑器依赖它） */
    notifyDataChanged(): void {
        this.assertAlive();
        this.rebuildScene('data');
    }

    setRenderSettings(patch: Partial<ViewerRenderSettings>): void {
        this.assertAlive();
        const before = this.settings;
        this.settings = { ...before, ...patch };

        // 生效路径（方案 §4.1）：
        //   showRealModels / maxInstancesPerModel → 分组决策在构建期，必须重建
        //   texturesEnabled → 材质是共享对象，原地重挂即可，不重建（省掉纹理重分配与图标重请求）
        const needsRebuild = before.showRealModels !== this.settings.showRealModels
            || before.maxInstancesPerModel !== this.settings.maxInstancesPerModel;
        if (needsRebuild) {
            this.rebuildScene('settings');
            return;
        }
        if (before.texturesEnabled !== this.settings.texturesEnabled)
            reapplyLoadedModelMaterials(this.textureSettingsProvider());
    }

    /** 窗口/容器尺寸同步 */
    resize(): void {
        this.syncSize();
    }

    setCallbacks(cbs: NonNullable<RenderCoreOptions['callbacks']>): void {
        this.callbacks = { ...this.callbacks, ...cbs };
    }

    resetCamera(): void {
        if (this.disposed)
            return;
        this.controls.reset(2 * PLANET_RADIUS);
    }

    /**
     * 设置选中高亮（`null` 清除）。
     *
     * 只影响视觉，不触发 `onBuildingSelect`（避免「程序化选中」与「用户点击」
     * 在宿主侧形成回调环路）。越界或未加载时静默清零。
     */
    setSelectedIndex(index: number | null): void {
        if (this.disposed)
            return;
        const boxes = this.bundle?.bvh.boxes;
        const valid = index !== null && boxes !== undefined && boxes[index] !== undefined;
        if (!valid) {
            if (this.selectBoxIndex !== -1) {
                this.selectBoxIndex = -1;
                this.selectBox.visible = false;
                this.scene.remove(this.selectBox);
            }
            return;
        }
        const i = index as number;
        this.selectBox.matrix.copy(boxes[i]);
        this.selectBox.visible = true;
        if (this.selectBoxIndex === -1 || this.selectBox.parent === null)
            this.scene.add(this.selectBox);
        this.selectBoxIndex = i;
    }

    get selectedIndex(): number | null {
        return this.selectBoxIndex === -1 ? null : this.selectBoxIndex;
    }

    /**
     * 按蓝图里的建筑 `index` 字段（不是数组下标）查找并选中。
     *
     * 返回数组下标；找不到返回 null。`BlueprintBuilding.index` 与数组下标
     * 通常一致，但蓝图按区域分组存储，不保证顺序，所以必须真查一次。
     */
    selectByBuildingId(id: number): number | null {
        const data = this.data;
        if (data === null)
            return null;
        const i = data.buildings.findIndex(b => b.index === id);
        if (i === -1)
            return null;
        this.setSelectedIndex(i);
        return i;
    }

    /**
     * 把镜头推到指定数组下标的建筑。
     *
     * `distance` 省略时取 `PLANET_RADIUS * 0.35`（近景但不穿模）。
     * 返回是否成功；相机由 `controls.focusOn` 摆位，不需要额外取景。
     */
    focusBuilding(index: number, distance?: number): boolean {
        if (this.disposed)
            return false;
        const boxes = this.bundle?.bvh.boxes;
        const box = boxes?.[index];
        if (box === undefined)
            return false;
        const center = new Vector3().setFromMatrixPosition(box);
        this.controls.focusOn(center, distance ?? PLANET_RADIUS * 0.35);
        return true;
    }

    /** 最近一次成功构建的建筑总数；未加载时为 0 */
    get buildingCount(): number {
        return this.bundle?.buildings.modelRef.length ?? 0;
    }

    get camera(): PerspectiveCamera { return this._camera; }
    /** 控件实例（阶段 C 的编辑器交互需要） */
    get controlsRef(): PlanetMapControls { return this.controls; }
    get sceneRef(): Scene { return this.scene; }
    get rendererRef(): WebGLRendererLike { return this.renderer; }
    /** 当前场景模型（方案 §3.3 约定名）；未加载时为 null */
    get sceneModel(): SceneBundle | null { return this.bundle; }
    get cameraVersion(): number { return this._cameraVersion; }
    get isDisposed(): boolean { return this.disposed; }
    getSettings(): Readonly<ViewerRenderSettings> { return this.settings; }

    /** 建筑中心的世界矩阵（兼容旧 `getModel` 语义） */
    getBuildingModel(index: number): Matrix4 | null {
        const ref = this.bundle?.buildings.modelRef[index];
        if (ref === undefined)
            return null;
        if ('mesh' in ref) {
            const m = new Matrix4();
            ref.mesh.getMatrixAt(ref.instance, m);
            return m;
        }
        return ref.matrix;
    }

    /** 选择盒矩阵（阶段 C 的高亮盒用） */
    getSelectBoxMatrix(index: number): Matrix4 | null {
        const boxes = this.bundle?.bvh.boxes;
        if (boxes === undefined)
            return null;
        return boxes[index] ?? null;
    }

    /** 最近一次成功构建的统计信息（含 unknownModelIndexes） */
    lastBuildStats(): { buildingCount: number; unknownModelIndexes: number[] } | null {
        if (this.bundle === null)
            return null;
        return {
            buildingCount: this.bundle.buildings.modelRef.length,
            unknownModelIndexes: this.bundle.unknownModelIndexes,
        };
    }

    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.modelTimer !== null) {
            window.clearTimeout(this.modelTimer);
            this.modelTimer = null;
        }
        this.offModelsChanged?.();
        this.offModelsChanged = null;

        // 撤掉构造时注册的全局设置读取函数，避免它继续持有已销毁实例的闭包
        if (this.ownsSettingsProvider)
            setSettingsProvider(null);

        this.renderer.domElement.removeEventListener('click', this.onClick);
        this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);

        this.resizeObserver?.disconnect();
        this.controls.dispose();

        // 场景内容与图标图集
        if (this.bundle !== null) {
            this.scene.remove(this.bundle.buildings);
            this.bundle.buildings.dispose();
            this.bundle = null;
        }
        // 只释放自己创建的图集；宿主注入的由宿主负责（避免误销毁他人资源）
        if (this.ownsIconTexture)
            this.iconTexture.dispose();
        // 选中高亮盒用的是本实例自建的几何体与材质
        this.selectBox.removeFromParent();
        (this.selectBox.geometry as BoxGeometry).dispose();
        (this.selectBox.material as MeshStandardMaterial).dispose();
        this.planet.dispose();
        this.scene.clear();

        this.renderer.dispose();
        if (this.renderer.domElement.parentNode === this.container)
            this.container.removeChild(this.renderer.domElement);
    }

    // ------------------------------------------------------------ 内部

    private assertAlive(): void {
        if (this.disposed)
            throw new Error('RenderCore already disposed');
    }

    private scheduleModelRebuild(): void {
        if (this.disposed || this.modelTimer !== null)
            return;
        this.modelTimer = window.setTimeout(() => {
            this.modelTimer = null;
            if (this.disposed || this.data === null)
                return;
            try {
                this.rebuildScene('models');
            }
            catch (e) {
                // 定时器里的异常不能外抛，否则会变成未处理错误；保留旧场景即可
                console.warn('[core] 模型到达后的重建失败（保留旧场景）', e);
            }
        }, 150);
    }

    /**
     * 原子重建：先构建全部内容，成功后才移除并释放旧场景。
     * 失败时保留旧场景并把错误抛给调用方（Viewer 负责转成结构化错误）。
     */
    private rebuildScene(reason: RebuildReason): void {
        const started = Date.now();
        if (this.data === null) {
            this.replaceBundle(null);
            this.callbacks.onRebuild?.({
                reason, buildingCount: 0, unknownModelIndexes: [], durationMs: Date.now() - started,
            });
            return;
        }

        const d = this.data;

        // 定位阶段：findPosForAreas 会因蓝图数据不自洽抛错（无根区域 / 找不到经度 / 区域层级冲突）
        let pos: ReturnType<typeof findPosForAreas>;
        try {
            pos = findPosForAreas(d.areas, PLANET_SEGMENT);
        }
        catch (e) {
            throw new RenderPhaseError('position', e);
        }

        // 构建阶段
        try {
            const transforms = d.buildings.map(b => calcBuildingTrans(PLANET_RADIUS, pos, b));

            const built = buildBuildings(transforms, d.buildings, {
                settings: this.settings,
                textureSink: this.renderer,
                iconTexture: this.iconTexture,
                textureSettings: this.textureSettingsProvider(),
                // 重建时不重挂贴图：材质是共享对象，模型加载时已经套过；
                // 只有 texturesEnabled 变更才需要重挂（见 setRenderSettings），
                // 否则每次重建都会对全部已加载模型重复执行一遍贴图流程。
                reapplyMaterials: false,
            });
            const bvhResult = buildBVH(transforms, d.buildings);

            this.replaceBundle({
                buildings: built.buildings,
                bvh: bvhResult.bvh,
                transforms,
                unknownModelIndexes: bvhResult.unknownModelIndexes,
            });

            this.callbacks.onRebuild?.({
                reason,
                buildingCount: d.buildings.length,
                unknownModelIndexes: bvhResult.unknownModelIndexes,
                durationMs: Date.now() - started,
            });
        }
        catch (e) {
            if (e instanceof RenderPhaseError)
                throw e;
            throw new RenderPhaseError('build', e);
        }
    }

    private replaceBundle(next: SceneBundle | null): void {
        const previous = this.bundle;
        this.bundle = next;
        if (next !== null)
            this.scene.add(next.buildings);
        if (previous !== null) {
            this.scene.remove(previous.buildings);
            // 图标图集是跨重建复用的，AllBuildings.dispose 不会动它
            previous.buildings.dispose();
        }
        // 选择盒不在 bundle 内，重建后包围盒来源已换；按当前下标重新套用，
        // 越界则自动清除（避免高亮贴到错误的建筑上）
        if (this.selectBoxIndex !== -1)
            this.setSelectedIndex(this.selectBoxIndex);
    }

    private syncSize(): void {
        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(width, height);
        this._camera.aspect = width / height;
        this._camera.updateProjectionMatrix();
    }

    /** 屏幕坐标拾取：BVH + 星球遮挡判定（沿用编辑器语义） */
    private pick(e: MouseEvent): number | null {
        if (this.bundle === null)
            return null;
        const ray = new Ray();
        ray.origin.setFromMatrixPosition(this._camera.matrixWorld);
        const rect = this.renderer.domElement.getBoundingClientRect();
        ray.direction.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ray.direction.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.direction.z = .5;
        ray.direction.unproject(this._camera).sub(ray.origin).normalize();

        const intersects = this.bundle.bvh.raycast(ray);
        if (intersects.length === 0)
            return null;

        const planetSphere = new Sphere(new Vector3(), PLANET_RADIUS);
        const hit = ray.intersectSphere(planetSphere, new Vector3());
        if (hit !== null && hit.distanceToSquared(ray.origin) < intersects[0].distanceSquared)
            return null;

        return intersects[0].index;
    }

    private startLoop(): void {
        const animate = (time: number) => {
            if (this.disposed)
                return;
            this.rafId = requestAnimationFrame(animate);

            if (this.lastTimestamp !== null)
                this.controls.updateTimeDelta((time - this.lastTimestamp) / 1000);
            this.lastTimestamp = time;

            if (this.bundle !== null)
                this.bundle.buildings.cargos.cargoMove = (time % 1000) / 1000;

            const cameraUpdated = this.controls.update();
            this.planet.dirLight.position.copy(this._camera.position);
            this.renderer.render(this.scene, this._camera);
            if (cameraUpdated) {
                this._cameraVersion++;
                this.callbacks.onCameraChange?.();
            }
        };
        this.rafId = requestAnimationFrame(animate);
    }
}
