import {
    Group,
    LineSegments,
    Mesh,
    MeshStandardMaterial,
    LineBasicMaterial,
    SphereGeometry,
    AmbientLight,
    DirectionalLight,
} from "three";
import {
    SphereLatitudeGridGeometry,
    SphereLongitudeGridGeometry,
} from "@/SphereGridGeometry";
import { gridAreas } from "@/blueprint/planet";
import {
    PLANET_RADIUS,
    PLANET_SEGMENT,
    GRID_PER_SEGMENT,
} from "@/planetConstants";

/**
 * 细线网格 LOD 阈值（相机到星球球心的距离，单位：世界单位）。
 *
 * 使用**双阈值 + 迟滞**避免用户在边界附近缩放时细线频繁闪烁：
 * - 相机距离 < {@link FINE_GRID_DISTANCE_IN}  → 显示细线（LOD 升档）
 * - 相机距离 > {@link FINE_GRID_DISTANCE_OUT} → 隐藏细线（LOD 降档）
 * - 中间区间 → 保持当前状态
 *
 * 数值基于相机实际可达范围推导：
 *   - 相机贴球面时 ≈ 1.04R（minDistance 约束）
 *   - 相机看整星时 ≈ 2R ~ 3R（默认 z = 2R）
 *   - 最远拉到 ≈ 4R（maxDistance 约束）
 *   因此把升档阈值设在 1.0R（近距离才能看清细节），降档阈值设在 2.0R（远观不需要）。
 */
const FINE_GRID_DISTANCE_IN = PLANET_RADIUS * 1.2;
const FINE_GRID_DISTANCE_OUT = PLANET_RADIUS * 1.5;

/** 构建结果：粗+细网格整体 Group，以及可选的细线子 Group（供 LOD 切换） */
export interface PlanetGridResult {
    /** 所有网格线的父 Group（粗线 + 可选细线） */
    allGrids: Group;
    /** 细线子 Group（addFineGrid=false 时为 undefined） */
    fineGridGroup?: Group;
}

/**
 * 构建星球的经纬网格（粗线 + 可选细线）。
 *
 * 粗线逻辑：
 * 1. 一个覆盖整个球面的纬线网格：经度方向每 `segment` 段一个顶点（即每 5 格一条），
 *    纬度方向从北极到南极分 `segment/2` 行；
 * 2. 按星球分区（{@link gridAreas}）切分出的若干组经线弧，每个纬度带一组。
 *
 * 细线逻辑（addFineGrid=true 时启用）：
 * - 密度是粗线的 {@link GRID_PER_SEGMENT} 倍（从"每段一条"→"每格一条"）；
 * - 经线仍按纬度带生成，保持跨极区的密度差异；
 * - 用更浅的颜色 + 半透明模拟"细"的视觉效果（Three.js WebGL 不支持可变 linewidth）；
 * - 放入单独子 Group，供 LOD 按相机距离切换 visible。
 *
 * @param radius 网格半径（调用方通常传入略大于球体半径的值，避免与球面 z-fighting）
 * @param segment 赤道方向一整圈的段数，即经度分辨率（默认为星球常量）
 * @param coarseMaterial 粗线材质（可选，默认白色实色）
 * @param fineMaterial 细线材质（可选，默认浅灰半透）
 * @param addFineGrid 是否添加细线网格（默认 true）
 */
export function buildPlanetGrid(
    radius = 1,
    segment = PLANET_SEGMENT,
    coarseMaterial?: LineBasicMaterial,
    fineMaterial?: LineBasicMaterial,
    addFineGrid = true
): PlanetGridResult {
    const allGrids = new Group();

    // 粗线材质：主题换色可通过外部传入控制
    const coarseMat =
        coarseMaterial ??
        new LineBasicMaterial({ color: 0xf0f0f0, depthWrite: false });

    // 1) 粗纬线：widthSegments = 一整圈的段数；heightSegments 取一半
    const coarseLatitude = new SphereLatitudeGridGeometry({
        radius,
        widthSegments: segment,
        heightSegments: segment / 2,
    });
    allGrids.add(new LineSegments(coarseLatitude, coarseMat));

    // 2) 粗经线：按纬度带生成，保持跨极区密度差异
    const radPerSeg = (2 * Math.PI) / segment;
    for (const { minLatitudeSeg, latitudeSeg, longitudeSeg } of gridAreas(
        segment
    )) {
        const geometry = new SphereLongitudeGridGeometry({
            radius,
            widthSegments: longitudeSeg,
            heightSegments: Math.abs(latitudeSeg),
            phiStart: 0,
            phiLength: Math.PI * 2,
            thetaStart: (minLatitudeSeg + segment / 4) * radPerSeg,
            thetaLength: latitudeSeg * radPerSeg,
        });
        allGrids.add(new LineSegments(geometry, coarseMat));
    }

    // 3) 细线网格：密度 × GRID_PER_SEGMENT（每格一条），材质更浅 + 半透明
    //    放进带名称的子 Group，便于 LOD 切换时快速定位
    let fineGridGroup: Group | undefined;
    if (addFineGrid) {
        fineGridGroup = new Group();
        fineGridGroup.name = "__planet_fine_grid__";

        const fineMat =
            fineMaterial ??
            new LineBasicMaterial({
                color: 0x555555,
                opacity: 0.4,
                transparent: true,
                depthWrite: false,
            });

        // 3a) 细纬线：段数 × GRID_PER_SEGMENT
        const fineLatitude = new SphereLatitudeGridGeometry({
            radius,
            widthSegments: segment * GRID_PER_SEGMENT,
            heightSegments: (segment / 2) * GRID_PER_SEGMENT,
        });
        fineGridGroup.add(new LineSegments(fineLatitude, fineMat));

        // 3b) 细经线：每个纬度带的段数 × GRID_PER_SEGMENT
        for (const {
            minLatitudeSeg,
            latitudeSeg,
            longitudeSeg,
        } of gridAreas(segment)) {
            const geometry = new SphereLongitudeGridGeometry({
                radius,
                widthSegments: longitudeSeg * GRID_PER_SEGMENT,
                heightSegments: Math.abs(latitudeSeg) * GRID_PER_SEGMENT,
                phiStart: 0,
                phiLength: Math.PI * 2,
                thetaStart: (minLatitudeSeg + segment / 4) * radPerSeg,
                thetaLength: latitudeSeg * radPerSeg,
            });
            fineGridGroup.add(new LineSegments(geometry, fineMat));
        }

        allGrids.add(fineGridGroup);
    }

    return { allGrids, fineGridGroup };
}

export interface PlanetSceneParts {
    /** 星球球体（与网格合并成一组，便于统一 add/remove/dispose） */
    root: Group;
    /** 主平行光：RenderCore 每帧把它移到相机位置，保证建筑朝向相机的一面永远受光 */
    dirLight: DirectionalLight;
    /** 球体材质（主题换色用） */
    sphereMaterial: MeshStandardMaterial;
    /** 粗网格线材质（主题换色用） */
    gridMaterial: LineBasicMaterial;
    /** 细网格线材质（主题换色用，未启用细线时为 undefined） */
    fineGridMaterial?: LineBasicMaterial;
    /** 更新细线 LOD（相机距离越近越显示细节），在渲染循环中每帧调用 */
    updateGridLOD(cameraDistanceFromCenter: number): void;
    /** 星球球体与网格的释放函数（geometry + material） */
    dispose(): void;
}

/**
 * 创建星球球体 + 经纬网格 + 灯光。
 *
 * 从 `BlueprintEditor.vue` 下沉。数值与原实现一致：
 * AmbientLight 0.3、DirectionalLight 2、球体 `(R, SEGMENT, SEGMENT/2)`、颜色 0xb0b0b0，
 * 网格半径 `R * 1.0001`（略微抬升避免与球面 z-fighting）。
 *
 * @param radius 星球半径（默认 PLANET_RADIUS）
 * @param segment 星球球面细分段数（默认 PLANET_SEGMENT）
 * @param addFineGrid 是否添加细线网格（默认 true）
 */
export function createPlanetScene(
    radius = PLANET_RADIUS,
    segment = PLANET_SEGMENT,
    addFineGrid = true
): PlanetSceneParts {
    const root = new Group();

    const ambient = new AmbientLight(0xffffff, 0.3);
    root.add(ambient);

    const dirLight = new DirectionalLight(0xffffff, 2);
    root.add(dirLight);

    const sphereGeometry = new SphereGeometry(radius, segment, segment / 2);
    const sphereMaterial = new MeshStandardMaterial({ color: 0xb0b0b0 });
    const planet = new Mesh(sphereGeometry, sphereMaterial);
    root.add(planet);

    // 粗线材质：白色实色
    const gridMaterial = new LineBasicMaterial({
        color: 0xf0f0f0,
        depthWrite: false,
    });
    // 细线材质：浅灰半透明（模拟"细"的视觉效果，Three.js WebGL 不支持可变 linewidth）
    const fineGridMaterial = addFineGrid
        ? new LineBasicMaterial({
              color: 0xf0f0f0,
              opacity: 0.4,
              transparent: true,
              depthWrite: false,
          })
        : undefined;

    const { allGrids: grid, fineGridGroup } = buildPlanetGrid(
        radius * 1.0001,
        segment,
        gridMaterial,
        fineGridMaterial,
        addFineGrid
    );
    root.add(grid);

    // LOD 状态机：初始显示细线（相机距离默认 2R，落在中间区间，默认值不影响首帧体验）
    let fineVisible = true;

    return {
        root,
        dirLight,
        sphereMaterial,
        gridMaterial,
        fineGridMaterial,
        updateGridLOD(cameraDistanceFromCenter: number) {
            if (!fineGridGroup) return; // 未启用细线则跳过
            // 双阈值迟滞：边界附近保持上一状态，避免抖动
            if (cameraDistanceFromCenter < FINE_GRID_DISTANCE_IN) {
                fineVisible = true;
            } else if (cameraDistanceFromCenter > FINE_GRID_DISTANCE_OUT) {
                fineVisible = false;
            }
            // 只有实际变化时才写 visible（减少 Three.js 内部标记）
            if (fineGridGroup.visible !== fineVisible) {
                fineGridGroup.visible = fineVisible;
            }
        },
        dispose() {
            sphereGeometry.dispose();
            sphereMaterial.dispose();
            // 所有网格线的 geometry 统一释放（粗+细 LineSegments 都在 grid 里）
            grid.traverse((o) => {
                if (o instanceof LineSegments) {
                    o.geometry.dispose();
                }
            });
            // 粗线材质
            gridMaterial.dispose();
            // 细线材质（若启用）
            fineGridMaterial?.dispose();
        },
    };
}
