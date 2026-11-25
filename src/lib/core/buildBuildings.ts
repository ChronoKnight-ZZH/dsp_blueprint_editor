import {
    InstancedMesh,
    BufferGeometry,
    Float32BufferAttribute,
    Mesh,
    DoubleSide,
    Matrix4,
    Vector3,
    Vector2,
    Color,
    Object3D,
    BoxGeometry,
    CylinderGeometry,
    MeshLambertMaterial,
} from "three";
import type { TextureSink } from "@/icon/iconTexture";
import { IconTexture } from "@/icon/iconTexture";
import { IconGeometry, Icons } from "@/icon/icons";
import { IconSubscript } from "@/icon/iconSubscript";
import type { TextStyle } from "@/icon/iconSubscript";
import { CARGO_COLOR, Cargos } from "@/Animation/cargos";
import { buildingMeta, noIconBuildings } from "@/data/building";
import { isBelt, isInserter } from "@/data/items";
import { itemIconId } from "@/data/icons";
import type { BeltParameters, BlueprintBuilding } from "@/blueprint/parser";
import {
    resolveBuildingModel,
    requestBuildingModel,
} from "@/models/buildingModel";
import type { ResolvedBuildingModel } from "@/models/buildingModel";
import { GlbModelInstances } from "@/models/glbInstances";
import { reapplyLoadedModelMaterials } from "@/models/glbLoader";
import type {
    TextureSettings,
    ViewerRenderSettings,
} from "@/render/renderSettingsTypes";
import { AllBuildings } from "./AllBuildings";
import type { BuildStats, BuildingModelRef } from "./types";
import {
    buildingIconId,
    buildingIconPos,
    beltIconPos,
    beltIconScale,
    sorterIconPos,
    sorterIconScale,
} from "./iconHelpers";
import { inserterTrans } from "./geometryHelpers";
import { Inserters } from "@/Animation/inserter";

/** 未知建筑（没有 buildingMeta）时使用的占位颜色，与旧 `buildBoxes` 兜底一致 */
const UNKNOWN_BUILDING_COLOR = new Color(0xdddddd);

/** 取建筑元数据颜色；未知建筑回退占位色（修复：旧代码用 `!` 断言，未知模型会抛错白屏） */
function colorOf(modelIndex: number): Color {
    return buildingMeta.get(modelIndex)?.color ?? UNKNOWN_BUILDING_COLOR;
}

export interface BuildBuildingsOptions {
    /** 渲染设置：`showRealModels` / `maxInstancesPerModel` 决定 GLB 与白模的划分 */
    settings: ViewerRenderSettings;
    /** 图标图集 sink（真实 renderer 或测试 stub） */
    textureSink: TextureSink;
    /**
     * 可复用的图标图集。省略时新建一个（调用方负责 dispose）。
     * RenderCore 会跨重建复用它，避免每次重建都重新分配 1920×1920 纹理并重发图标请求。
     */
    iconTexture?: IconTexture;
    /** 是否为图集补挂通道贴图（reapply）。默认 true */
    reapplyMaterials?: boolean;
    /** 完整贴图设置（含 7 通道开关）；省略时由 glbLoader 的 provider 决定 */
    textureSettings?: TextureSettings;
    /** 角标文字配色（来自主题）；省略时用旧版硬编码的白色 + 深灰描边 */
    textStyle?: TextStyle;
}

export interface BuildBuildingsResult {
    buildings: AllBuildings;
    stats: BuildStats;
    /** 本次构建实际使用的图标图集（可能是传入的，也可能是新建的） */
    iconTexture: IconTexture;
}

/**
 * 按建筑列表装配一个完整的 `AllBuildings`。
 *
 * 从 `BlueprintEditor.vue` 的 `buildBuildings` 下沉，**不依赖 Vue**。
 * 相对原实现的行为修正（方案 D4 / D7）：
 *   1. 未知 `modelIndex` 的配色改用占位色，不再因 `!` 断言抛错（白屏修复）
 *   2. `maxInstancesPerModel` 的计数口径改为「存在 glbName 的实例数」，
 *      不再依赖 GLB 是否已加载 → 同一蓝图同一设置的渲染结果变得确定
 */
export function buildBuildings(
    transforms: Matrix4[][],
    buildings: BlueprintBuilding[],
    options: BuildBuildingsOptions
): BuildBuildingsResult {
    const { settings } = options;

    // 设置变更（texturesEnabled）后重挂通道贴图；材质是共享对象，原地生效。
    // 传入完整贴图设置，避免依赖 glbLoader 的全局 provider（Viewer 场景下没有注入）。
    if (options.reapplyMaterials !== false)
        reapplyLoadedModelMaterials(options.textureSettings);
    // 传送带
    const buildBelts = (belts: BlueprintBuilding[]) => {
        // 端点圆柱属于传送带节点装饰，保留原有尺寸；linkThickness 才是带状网格的挤出厚度。
        const thickness = 0.1;
        const material = new MeshLambertMaterial();
        const objects: Object3D[] = [];
        {
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 8);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            const offset = new Matrix4().makeRotationX(Math.PI / 2);
            offset.premultiply(
                new Matrix4().makeTranslation(0, 0, thickness / 2)
            );
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b = belts[i];
                trans.copy(transforms[b.index][0]);
                trans.multiply(offset);
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, colorOf(b.modelIndex));
                modelRef[b.index] = { mesh, instance: i };
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            objects.push(mesh);
        }

        const linkThickness = 0.05;
        {
            // 带宽 0.15（halfWidth 为半宽）。每个连接节点共用同一截面，
            // 并从节点 Matrix4 读取实际带面朝向，包含 planet.ts 中应用的 roll。
            const halfWidth = 0.35;
            const miterLimit = 4;
            const p1 = new Vector3();
            const p2 = new Vector3();
            const direction = new Vector3();
            const trans = new Matrix4();
            const temp = new Matrix4();
            const axisX = new Vector3();
            const axisY = new Vector3();
            const axisZ = new Vector3();

            type EndpointFrame = {
                side: Vector3;
                normal: Vector3;
            };
            type BeltLink = {
                source: number;
                target: number;
                start: Vector3;
                end: Vector3;
                tangent: Vector3;
                startFrame: EndpointFrame;
                endFrame: EndpointFrame;
                color: Color;
            };
            type BeltNodeFrame = { sideOffset: Vector3; normal: Vector3 };

            const getEndpointFrame = (
                matrix: Matrix4,
                tangent: Vector3
            ): EndpointFrame => {
                matrix.extractBasis(axisX, axisY, axisZ);

                // 局部 +Z 是 Matrix4 中的实际带面法线（已包含 roll）。
                // 投影到垂直于连接切线的平面，保证截面与带段相接。
                const normal = axisZ.clone().addScaledVector(
                    tangent,
                    -axisZ.dot(tangent)
                );
                if (normal.lengthSq() < 1e-8) {
                    // 极端姿态下法线与切线近乎平行，改用矩阵局部 +X 恢复框架。
                    const side = axisX.clone().addScaledVector(
                        tangent,
                        -axisX.dot(tangent)
                    );
                    if (side.lengthSq() < 1e-8) {
                        side.set(1, 0, 0).addScaledVector(
                            tangent,
                            -tangent.x
                        );
                    }
                    side.normalize();
                    normal.crossVectors(side, tangent).normalize();
                    return { side, normal };
                }
                normal.normalize();
                const side = new Vector3()
                    .crossVectors(tangent, normal)
                    .normalize();
                // 保持与矩阵局部 +X 的符号一致，避免截面左右翻转。
                if (side.dot(axisX) < 0) {
                    side.negate();
                    normal.negate();
                }
                return { side, normal };
            };

            const links: BeltLink[] = [];
            const incoming = new Map<number, BeltLink[]>();
            const outgoing = new Map<number, BeltLink[]>();

            // 先收集连接图。带段起点和终点分别读取两端节点的最终矩阵姿态。
            for (const belt of belts) {
                if (belt.outputObjIdx < 0) continue;
                const target = transforms[belt.outputObjIdx];
                if (target === undefined || target[0] === undefined) continue;

                p1.setFromMatrixPosition(transforms[belt.index][0]);
                p2.setFromMatrixPosition(target[0]);
                direction.subVectors(p2, p1);
                const len = direction.length();
                if (len < 1e-6) continue;

                const tangent = direction.multiplyScalar(1 / len).clone();
                const edge: BeltLink = {
                    source: belt.index,
                    target: belt.outputObjIdx,
                    start: p1.clone(),
                    end: p2.clone(),
                    tangent,
                    startFrame: getEndpointFrame(
                        transforms[belt.index][0],
                        tangent
                    ),
                    endFrame: getEndpointFrame(target[0], tangent),
                    color: colorOf(belt.modelIndex),
                };
                links.push(edge);

                const out = outgoing.get(edge.source) ?? [];
                out.push(edge);
                outgoing.set(edge.source, out);
                const inc = incoming.get(edge.target) ?? [];
                inc.push(edge);
                incoming.set(edge.target, inc);

                // 货物仍沿原连接方向生成；up 使用该段起点矩阵的实际带面法线。
                trans.identity();
                trans.lookAt(
                    edge.start,
                    edge.end,
                    edge.startFrame.normal
                );
                trans.premultiply(
                    temp.makeTranslation(
                        edge.start.x,
                        edge.start.y,
                        edge.start.z
                    )
                );
                addCargo(trans, edge.color, len);
            }

            if (links.length) {
                const nodeFrames = new Map<number, BeltNodeFrame>();
                const nodeIds = new Set<number>();
                for (const edge of links) {
                    nodeIds.add(edge.source);
                    nodeIds.add(edge.target);
                }

                for (const nodeId of nodeIds) {
                    const ins = incoming.get(nodeId) ?? [];
                    const outs = outgoing.get(nodeId) ?? [];
                    const incidentFrames: EndpointFrame[] = [
                        ...ins.map((edge) => edge.endFrame),
                        ...outs.map((edge) => edge.startFrame),
                    ];
                    if (!incidentFrames.length) continue;

                    // 以该节点自身矩阵的 +Z 轴作为实际带面法线基准，
                    // 再结合相邻段姿态做符号一致的平均，兼容节点处的 roll 变化。
                    transforms[nodeId][0].extractBasis(axisX, axisY, axisZ);
                    const normal = axisZ.clone();
                    for (const frame of incidentFrames) {
                        const n = frame.normal.clone();
                        if (normal.dot(n) < 0) n.negate();
                        normal.add(n);
                    }
                    if (normal.lengthSq() < 1e-8) {
                        normal.copy(axisZ);
                    }
                    normal.normalize();

                    // 转弯节点对入/出边侧向量做 miter 平均，形成共享的截面边界。
                    const referenceSide = incidentFrames[0].side.clone();
                    const sideSum = new Vector3();
                    for (const frame of incidentFrames) {
                        const side = frame.side.clone();
                        if (side.dot(referenceSide) < 0) side.negate();
                        sideSum.add(side);
                    }
                    if (sideSum.lengthSq() < 1e-8) {
                        sideSum.copy(referenceSide);
                    }
                    sideSum.normalize();

                    // 保持截面宽度方向与实际带面法线正交。
                    sideSum.addScaledVector(
                        normal,
                        -sideSum.dot(normal)
                    );
                    if (sideSum.lengthSq() < 1e-8) {
                        sideSum.copy(referenceSide);
                        sideSum.addScaledVector(
                            normal,
                            -sideSum.dot(normal)
                        );
                    }
                    sideSum.normalize();

                    const sideProjections = incidentFrames.map((frame) =>
                        Math.abs(sideSum.dot(frame.side))
                    );
                    const denom = Math.max(
                        0.25,
                        Math.min(...sideProjections)
                    );
                    const miterLength = Math.min(
                        halfWidth / denom,
                        halfWidth * miterLimit
                    );
                    const sideOffset = sideSum.multiplyScalar(miterLength);
                    // 再正交化一次，确保 0.05 厚度沿节点局部带面法线挤出。
                    normal.addScaledVector(
                        sideSum,
                        -normal.dot(sideSum) / sideSum.lengthSq()
                    ).normalize();

                    nodeFrames.set(nodeId, { sideOffset, normal });
                }

                const positions: number[] = [];
                const colors: number[] = [];
                const addVertex = (v: Vector3, color: Color) => {
                    positions.push(v.x, v.y, v.z);
                    colors.push(color.r, color.g, color.b);
                };
                const addTriangle = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    color: Color
                ) => {
                    addVertex(a, color);
                    addVertex(b, color);
                    addVertex(c, color);
                };
                const addQuad = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    d: Vector3,
                    color: Color,
                    reverse = false
                ) => {
                    if (reverse) {
                        addTriangle(a, c, b, color);
                        addTriangle(a, d, c, color);
                    } else {
                        addTriangle(a, b, c, color);
                        addTriangle(a, c, d, color);
                    }
                };

                const getEdgeSideOffset = (
                    nodeId: number,
                    frame: EndpointFrame,
                    nodeFrame: BeltNodeFrame
                ): Vector3 => {
                    const degree =
                        (incoming.get(nodeId)?.length ?? 0) +
                        (outgoing.get(nodeId)?.length ?? 0);

                    // 普通两段式连接继续使用原来的 Miter 算法。
                    if (degree < 3) {
                        return nodeFrame.sideOffset.clone();
                    }

                    // T 字及多分支节点：
                    // 每条传送带独立使用自己的截面方向，
                    // 不再强制共用平均后的斜向截面。
                    const side = frame.side.clone();

                    // 保证宽度方向与节点带面法线正交。
                    side.addScaledVector(
                        nodeFrame.normal,
                        -side.dot(nodeFrame.normal)
                    );

                    if (side.lengthSq() < 1e-8) {
                        return nodeFrame.sideOffset.clone();
                    }

                    return side.normalize().multiplyScalar(halfWidth);
                };


                for (const edge of links) {
                    const startFrame = nodeFrames.get(edge.source);
                    const endFrame = nodeFrames.get(edge.target);
                    if (startFrame === undefined || endFrame === undefined)
                        continue;

                    const startSideOffset = getEdgeSideOffset(
                        edge.source,
                        edge.startFrame,
                        startFrame
                    );

                    const endSideOffset = getEdgeSideOffset(
                        edge.target,
                        edge.endFrame,
                        endFrame
                    );

                    const startLeft = edge.start.clone().add(
                        startSideOffset
                    );
                    const startRight = edge.start.clone().sub(
                        startSideOffset
                    );
                    const endLeft = edge.end.clone().add(
                        endSideOffset
                    );
                    const endRight = edge.end.clone().sub(
                        endSideOffset
                    );
                    const startTopLeft = startLeft.clone().addScaledVector(
                        startFrame.normal,
                        linkThickness
                    );
                    const startTopRight = startRight.clone().addScaledVector(
                        startFrame.normal,
                        linkThickness
                    );
                    const endTopLeft = endLeft.clone().addScaledVector(
                        endFrame.normal,
                        linkThickness
                    );
                    const endTopRight = endRight.clone().addScaledVector(
                        endFrame.normal,
                        linkThickness
                    );


                    // 顶面
                    addQuad(
                        startTopLeft,
                        endTopLeft,
                        endTopRight,
                        startTopRight,
                        edge.color
                    );

                    // 底面
                    addQuad(
                        startLeft,
                        endLeft,
                        endRight,
                        startRight,
                        edge.color,
                        true
                    );

                    // 左侧面
                    addQuad(
                        startLeft,
                        endLeft,
                        endTopLeft,
                        startTopLeft,
                        edge.color
                    );

                    // 右侧面
                    addQuad(
                        startRight,
                        endRight,
                        endTopRight,
                        startTopRight,
                        edge.color,
                        true
                    );

                }

                // ============================================================
// 多分支交会节点补面
//
// 关键修复：
// 1. 交会面边界直接复用带段实际端点。
// 2. 顶面边界使用各带段自己的端点法线。
// 3. 不再生成交会面外围侧壁，避免与带段端面重叠。
// ============================================================

type JunctionBoundaryPoint = {
    bottom: Vector3;
    top: Vector3;
    angle: number;
};

for (const [nodeId, nodeFrame] of nodeFrames) {
    const ins = incoming.get(nodeId) ?? [];
    const outs = outgoing.get(nodeId) ?? [];

    const degree = ins.length + outs.length;

    if (degree < 3) continue;

    const center = new Vector3().setFromMatrixPosition(
        transforms[nodeId][0]
    );

    const normal = nodeFrame.normal.clone().normalize();

    // 交会面内的二维坐标系。
    const axisX = nodeFrame.sideOffset.clone().normalize();

    const axisY = new Vector3()
        .crossVectors(normal, axisX)
        .normalize();

    const boundary: JunctionBoundaryPoint[] = [];

    const addBoundary = (
        edge: BeltLink,
        frame: EndpointFrame,
        isStart: boolean
    ) => {
        const endpoint = isStart ? edge.start : edge.end;

        // 与普通带段完全共用同一套截面计算。
        const sideOffset = getEdgeSideOffset(
            nodeId,
            frame,
            nodeFrame
        );

        const left = endpoint.clone().add(sideOffset);
        const right = endpoint.clone().sub(sideOffset);

        // 这里使用带段自身的端点法线。
        // 必须与普通带段生成顶面的计算方式一致。
        const leftTop = left.clone().addScaledVector(
            frame.normal,
            linkThickness
        );

        const rightTop = right.clone().addScaledVector(
            frame.normal,
            linkThickness
        );

        const leftDir = left.clone().sub(center);
        const rightDir = right.clone().sub(center);

        boundary.push({
            bottom: left,
            top: leftTop,
            angle: Math.atan2(
                leftDir.dot(axisY),
                leftDir.dot(axisX)
            ),
        });

        boundary.push({
            bottom: right,
            top: rightTop,
            angle: Math.atan2(
                rightDir.dot(axisY),
                rightDir.dot(axisX)
            ),
        });
    };

    for (const edge of ins) {
        addBoundary(edge, edge.endFrame, false);
    }

    for (const edge of outs) {
        addBoundary(edge, edge.startFrame, true);
    }

    // 统一按照节点中心的极角排序。
    boundary.sort((a, b) => a.angle - b.angle);

    // 去除重合点时，必须同时保留对应的顶面和底面顶点。
    const uniqueBoundary: JunctionBoundaryPoint[] = [];

    for (const point of boundary) {
        const duplicated = uniqueBoundary.some(
            (other) =>
                other.bottom.distanceToSquared(point.bottom) < 1e-8
        );

        if (!duplicated) {
            uniqueBoundary.push(point);
        }
    }

    if (uniqueBoundary.length < 3) continue;

    // 交会区域中心。
    // 底面和顶面中心分别使用节点实际带面法线。
    const bottomCenter = center.clone();

    const topCenter = center.clone().addScaledVector(
        normal,
        linkThickness
    );

    const color = (ins[0] ?? outs[0]).color;

    // 顶面：边界顶点与普通带段端点完全一致。
    for (let i = 0; i < uniqueBoundary.length; i++) {
        const next = (i + 1) % uniqueBoundary.length;

        addTriangle(
            topCenter,
            uniqueBoundary[i].top,
            uniqueBoundary[next].top,
            color
        );
    }

    // 底面。
    for (let i = 0; i < uniqueBoundary.length; i++) {
        const next = (i + 1) % uniqueBoundary.length;

        addTriangle(
            bottomCenter,
            uniqueBoundary[next].bottom,
            uniqueBoundary[i].bottom,
            color
        );
    }
}

                const geometry = new BufferGeometry();
                geometry.setAttribute(
                    "position",
                    new Float32BufferAttribute(positions, 3)
                );
                geometry.setAttribute(
                    "color",
                    new Float32BufferAttribute(colors, 3)
                );
                geometry.computeVertexNormals();
                const ribbonMaterial = new MeshLambertMaterial({
                    vertexColors: true,
                    side: DoubleSide,
                });
                const ribbonMesh = new Mesh(geometry, ribbonMaterial);
                objects.push(ribbonMesh);
            }
        }
        return objects;
    };

    // 分拣器
// 分拣器
const buildInserters = (inserters: BlueprintBuilding[]) => {
    /** 横梁在 INSERTER_HEIGHT 之上再抬高 */
    const BEAM_EXTRA_LIFT = 0.1;

    /** 货物相对基础姿态下移 */
    const CARGO_DROP = 0.1;

    /** 货物末端淡出宽度，占整个运输行程的比例 */
    const CARGO_FADE = 0.15;

    const mesh = new Inserters(inserters.length);

    const offset = new Matrix4().makeTranslation(0, 0, -0.5);
    const temp = new Matrix4();
    const trans = new Matrix4();
    const cargoTrans = new Matrix4();

    for (let i = 0; i < inserters.length; i++) {
        const b = inserters[i];

        // 获取分拣器基础姿态与横梁长度
        const len = inserterTrans(
            transforms[b.index],
            trans
        );

        // ① 货物：使用基础姿态，避免横梁缩放污染货物矩阵
        cargoTrans.copy(trans);

        // 货物沿横梁方向移动，保持原有下移量
        cargoTrans.multiply(
            temp.makeTranslation(
                0,
                -CARGO_DROP,
                0
            )
        );

        // 货物使用独立颜色，并设置末端淡出宽度
        // addCargo 需要增加第四个 fade 参数
        addCargo(
            cargoTrans,
            CARGO_COLOR,
            len,
            CARGO_FADE
        );

        // ② 横梁：基础姿态抬高 + 缩放 + 前推半梁长
        trans.multiply(
            temp.makeTranslation(
                0,
                BEAM_EXTRA_LIFT,
                0
            )
        );

        trans.multiply(
            temp.makeScale(
                1,
                1,
                len
            )
        );

        trans.multiply(offset);

        mesh.setMatrixAt(i, trans);
        mesh.setColorAt(i, colorOf(b.modelIndex));

        modelRef[b.index] = {
            mesh,
            instance: i,
        };
    }

    mesh.instanceMatrix.needsUpdate = true;

    if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
    }

    return mesh;
};

    // 建筑分类：带子 / 分拣器 / 其余（元数据盒或 GLB）
    const belts = buildings.filter((b) => isBelt(b.itemId));
    const inserters = buildings.filter((b) => isInserter(b.itemId));
    const boxes = buildings.filter(
        (b) => !isInserter(b.itemId) && !isBelt(b.itemId)
    );

    const modelRef = new Array<BuildingModelRef>(buildings.length);
    // 容量沿用旧实现：只有带子与分拣器会产生货物
    const cargosMesh = new Cargos(belts.length + inserters.length);
    let numCargos = 0;
    const addCargo = (
    trans: Matrix4,
    color: Color,
    distance: number,
    fade = 0
) => {
    cargosMesh.setMatrixAt(numCargos, trans);
    cargosMesh.setColorAt(numCargos, color);
    cargosMesh.setCargoDistanceAt(numCargos, distance);

    // 设置货物淡出宽度
    (cargosMesh.geometry.cargoFade.array as Float32Array)[numCargos] =
        fade;

    numCargos++;
};

    // 其他建筑（元数据盒或 GLB）
    const buildBoxes = (boxes: BlueprintBuilding[]) => {
        const objects: Object3D[] = [];
        const unknownModelIndexes = new Set<number>();

        // 1) 解析每个建筑的模型来源：已加载的外部 GLB 优先，其余回退元数据表
        const resolved: (ResolvedBuildingModel | null)[] = boxes.map((b) => {
            try {
                return resolveBuildingModel(b.modelIndex);
            } catch {
                return null; // resolver 内部已兜底，这里只是双保险
            }
        });

        // 2) 同一模型的实例数过多时整组回退（高模 × 上千实例会明显掉帧）。
        //    **计数口径（方案 D7）**：按「存在 glbName 的建筑数」而不是「已加载 GLB 的建筑数」，
        //    这样 GLB 未到达时不会先把整组判成白模，加载完成后再整组跳回 GLB，
        //    同一蓝图同一设置的渲染结果因此与加载时序无关。
        const glbInstanceCounts = new Map<number, number>();
        if (settings.showRealModels) {
            for (const r of resolved) {
                if (r !== null && r.glbName !== null && r.meta !== undefined)
                    glbInstanceCounts.set(
                        r.modelIndex,
                        (glbInstanceCounts.get(r.modelIndex) ?? 0) + 1
                    );
            }
        }

        // 3) 分组：外部 GLB 组 / 元数据盒回退组
        const glbGroups = new Map<
            number,
            {
                model: NonNullable<ResolvedBuildingModel["glb"]>;
                placement: Matrix4;
                tint: number | null;
                buildings: BlueprintBuilding[];
            }
        >();
        const fallback: BlueprintBuilding[] = [];
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const r = resolved[i];
            if (r !== null && r.meta === undefined) {
                // 未知建筑：既定位不了也画不了，更不该下载 GLB
                unknownModelIndexes.add(r.modelIndex);
                fallback.push(b);
                continue;
            }
            const withinLimit =
                r !== null &&
                (glbInstanceCounts.get(r.modelIndex) ?? 0) <=
                settings.maxInstancesPerModel;
            if (
                settings.showRealModels &&
                withinLimit &&
                r.glb !== null &&
                r.meta !== undefined
            ) {
                let group = glbGroups.get(r.modelIndex);
                if (group === undefined) {
                    group = {
                        model: r.glb,
                        placement: r.placement,
                        tint: r.tint,
                        buildings: [],
                    };
                    glbGroups.set(r.modelIndex, group);
                }
                group.buildings.push(b);
                continue;
            }
            fallback.push(b);
            // 有外部模型但还没加载 → 按需触发懒加载（加载器内部并发去重 + 缓存 + 超时）
            // 没有元数据就既定位不了也画不了，因此不为它下载 GLB
            if (
                r !== null &&
                r.glbName !== null &&
                r.glb === null &&
                r.meta !== undefined
            )
                requestBuildingModel(b.modelIndex);
        }

        // 4) GLB 实例化渲染；任一环节出错都整组退回元数据盒，不影响其余建筑
        const anchor = new Matrix4();
        const anchorPos = new Vector3();
        const anchorTrans = new Matrix4();
        const perModelGlbCounts: Record<number, number> = {};
        for (const [modelIndex, group] of glbGroups) {
            let instances: GlbModelInstances | null = null;
            try {
                instances = new GlbModelInstances(
                    group.model,
                    group.placement,
                    group.buildings.map((b) => transforms[b.index][0]),
                    group.tint
                );
            } catch (e) {
                console.warn("[glb] 实例化渲染失败，该模型组回退元数据表", e);
                instances = null;
            }
            if (instances === null || instances.meshes.length === 0) {
                fallback.push(...group.buildings);
                continue;
            }
            objects.push(instances);
            perModelGlbCounts[modelIndex] = group.buildings.length;
            for (const b of group.buildings) {
                // modelRef 沿用旧语义：建筑中心的世界矩阵（供 SpitterInfo 等做投影）
                anchor.copy(transforms[b.index][0]);
                const meta = buildingMeta.get(b.modelIndex);
                if (meta !== undefined) {
                    anchorPos.setFromMatrixPosition(meta.selectUnitBoxTrans);
                    anchor.multiply(
                        anchorTrans.makeTranslation(
                            anchorPos.x,
                            anchorPos.y,
                            anchorPos.z
                        )
                    );
                }
                modelRef[b.index] = { matrix: anchor.clone() };
            }
        }

        // 5) 元数据盒回退：与改动前一致的渲染方式
        if (fallback.length) {
            const geometry = new BoxGeometry(1.0, 1.0, 1.0);
            const material = new MeshLambertMaterial();
            const mesh = new InstancedMesh(geometry, material, fallback.length);
            const trans = new Matrix4();
            const hidden = new Matrix4().makeScale(0, 0, 0);
            for (let i = 0; i < fallback.length; i++) {
                const b = fallback[i];
                const meta = buildingMeta.get(b.modelIndex);
                if (meta === undefined) {
                    // 未知建筑：放退化矩阵占位（不可见），保持「不抛错、不白屏」的旧行为
                    mesh.setMatrixAt(i, hidden);
                    mesh.setColorAt(i, UNKNOWN_BUILDING_COLOR);
                    continue;
                }
                trans.multiplyMatrices(
                    transforms[b.index][0],
                    meta.unitBoxTrans
                );
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, meta.color);
                modelRef[b.index] = { mesh, instance: i };
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            objects.push(mesh);
        }

        return {
            objects,
            perModelGlbCounts,
            unknownModelIndexes,
            fallbackCount: fallback.length,
        };
    };

    // 图标
    const buildIcons = (
        iconBuildings: BlueprintBuilding[],
        iconBelts: BlueprintBuilding[],
        iconInserters: BlueprintBuilding[],
        iconTexture: IconTexture
    ) => {
        const subscripts = new Map<BlueprintBuilding, string>();
        for (const b of iconBelts) {
            if (b.parameters === null) continue;
            const p = b.parameters as BeltParameters;
            if (p.count === 0) continue;
            let s;
            if (p.count >= 100000)
                s = Math.floor(p.count / 1000).toFixed(0) + "k";
            else s = p.count.toFixed(0);
            subscripts.set(b, s);
        }

        const count =
            iconBuildings.length + iconBelts.length + iconInserters.length;
        const icons = new IconGeometry(count);

        let subscriptsMesh: null | IconSubscript = null;
        const subscriptMap = new Map<
            BlueprintBuilding,
            { startIdx: number; length: number }
        >();
        if (subscripts.size > 0) {
            let numChars = 0;
            for (const s of subscripts.values()) {
                numChars += s.length;
            }
            subscriptsMesh = new IconSubscript(numChars, options.textStyle);
        }
        const pos = new Vector3();

        let subscriptIdx = 0;
        for (let i = 0; i < iconBelts.length; i++) {
            const b = iconBelts[i];
            beltIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon(
                (b.parameters as BeltParameters).iconId
            );
            icons.addIcon(b, iconId, pos, beltIconScale);

            const sub = subscripts.get(b);
            if (sub !== undefined) {
                subscriptsMesh!.setText(subscriptIdx, pos, beltIconScale, sub);
                subscriptMap.set(b, {
                    startIdx: subscriptIdx,
                    length: sub.length,
                });
                subscriptIdx += sub.length;
            }
        }

        for (let i = 0; i < iconInserters.length; i++) {
            const b = iconInserters[i];
            sorterIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon(itemIconId(b.filterId));
            icons.addIcon(b, iconId, pos, sorterIconScale);
        }

        const buildingIconScale = new Vector2();
        for (let i = 0; i < iconBuildings.length; i++) {
            const b = iconBuildings[i];
            if (
                !buildingIconPos(
                    b,
                    transforms[b.index][0],
                    pos,
                    buildingIconScale
                )
            )
                continue;
            const iconId = iconTexture.requestIcon(buildingIconId(b));
            icons.addIcon(b, iconId, pos, buildingIconScale);
        }

        if (subscriptsMesh !== null) {
            subscriptsMesh.needsUpdate();
        }
        return {
            icons,
            subscriptsMesh,
            subscriptMap,
            iconCount: count,
            subscriptCount: subscriptIdx,
        };
    };

    // 图标建筑
    const iconBuildings = boxes.filter((b) => !noIconBuildings.has(b.itemId));
    // 图标带
    const iconBelts = belts.filter(
        (b) => b.parameters && (b.parameters as BeltParameters).iconId > 0
    );
    // 图标排序器
    const iconInserters = inserters.filter((b) => b.filterId > 0);


    const meshes: Object3D[] = [];
    const built = buildBoxes(boxes);


    if (belts.length) meshes.push(...buildBelts(belts));

    if (inserters.length) meshes.push(buildInserters(inserters));

    if (numCargos) {
        cargosMesh.count = numCargos;
        cargosMesh.instanceMatrix.needsUpdate = true;
        cargosMesh.instanceColor!.needsUpdate = true;
        cargosMesh.geometry.cargoDistance.needsUpdate = true;
        cargosMesh.geometry.cargoFade.needsUpdate = true;
    }

    if (built.objects.length) meshes.push(...built.objects);

    // 未传入时新建一个图集；**释放责任交给调用方**（结果里的 `iconTexture` 字段
    // 就是实际使用的这一个，调用方在场景销毁时调它的 `dispose()`）。
    const iconTexture =
        options.iconTexture ?? new IconTexture(options.textureSink);
    const iconBuilt = buildIcons(
        iconBuildings,
        iconBelts,
        iconInserters,
        iconTexture
    );
    if (iconBuilt.subscriptsMesh) {
        iconBuilt.subscriptsMesh.renderOrder = 11;
    }

    const iconMesh = new Icons(iconTexture.texture, iconBuilt.icons);
    iconMesh.renderOrder = 10;

    const buildings3d = new AllBuildings(
        meshes,
        iconMesh,
        iconTexture,
        cargosMesh,
        modelRef,
        iconBuilt.subscriptsMesh,
        iconBuilt.subscriptMap
    );

    const glbInstanceCount = Object.values(built.perModelGlbCounts).reduce(
        (a, b) => a + b,
        0
    );
    const stats: BuildStats = {
        buildingCount: buildings.length,
        glbGroupCount: Object.keys(built.perModelGlbCounts).length,
        glbInstanceCount,
        fallbackBoxCount: built.fallbackCount,
        hiddenCount: built.unknownModelIndexes.size,
        unknownModelIndexes: Array.from(built.unknownModelIndexes).sort(
            (a, b) => a - b
        ),
        iconCount: iconBuilt.iconCount,
        subscriptCount: iconBuilt.subscriptCount,
        cargoCount: numCargos,
        perModelGlbCounts: built.perModelGlbCounts,
    };

    return { buildings: buildings3d, stats, iconTexture };
}
