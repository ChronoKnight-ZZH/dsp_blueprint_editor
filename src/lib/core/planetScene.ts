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
import { PLANET_RADIUS, PLANET_SEGMENT } from "@/planetConstants";

/** 经纬网格（一个 Group，含纬线 + 各区域的经线） */
export function buildPlanetGrid(
    radius = 1,
    segment = PLANET_SEGMENT,
    sharedMaterial?: LineBasicMaterial
) {
    const allGrids = new Group();
    // 网格线共用一个材质：主题换色只改这一处（外部可通过 createPlanetScene 的返回值拿到它）
    const material =
        sharedMaterial ??
        new LineBasicMaterial({ color: 0xf0f0f0, depthWrite: false });

    const latitudeGeometry = new SphereLatitudeGridGeometry({
        radius,
        widthSegments: segment,
        heightSegments: segment / 2,
    });
    allGrids.add(new LineSegments(latitudeGeometry, material));

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
        allGrids.add(new LineSegments(geometry, material));
    }
    return allGrids;
}

export interface PlanetSceneParts {
    /** 星球球体（与网格合并成一组，便于统一 add/remove/dispose） */
    root: Group;
    /** 主平行光：RenderCore 每帧把它移到相机位置，保证建筑朝向相机的一面永远受光 */
    dirLight: DirectionalLight;
    /** 球体材质（主题换色用） */
    sphereMaterial: MeshStandardMaterial;
    /** 网格线共用材质（主题换色用） */
    gridMaterial: LineBasicMaterial;
    /** 星球球体与网格的释放函数（geometry + material） */
    dispose(): void;
}

/**
 * 创建星球球体 + 经纬网格 + 灯光。
 *
 * 从 `BlueprintEditor.vue` 下沉。数值与原实现一致：
 * AmbientLight 0.3、DirectionalLight 2、球体 `(R, SEGMENT, SEGMENT/2)`、颜色 0xb0b0b0，
 * 网格半径 `R * 1.0001`（略微抬升避免与球面 z-fighting）。
 */
export function createPlanetScene(
    radius = PLANET_RADIUS,
    segment = PLANET_SEGMENT
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

    const gridMaterial = new LineBasicMaterial({
        color: 0xf0f0f0,
        depthWrite: false,
    });
    const grid = buildPlanetGrid(radius * 1.0001, segment, gridMaterial);
    root.add(grid);

    return {
        root,
        dirLight,
        sphereMaterial,
        gridMaterial,
        dispose() {
            sphereGeometry.dispose();
            sphereMaterial.dispose();
            grid.traverse((o) => {
                if (o instanceof LineSegments) {
                    o.geometry.dispose();
                }
            });
            // 网格线共用同一个 LineBasicMaterial，单独释放一次
            gridMaterial.dispose();
        },
    };
}
