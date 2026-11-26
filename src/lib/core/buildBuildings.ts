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
    MeshLambertMaterial,
} from "three";
import type { TextureSink } from "@/icon/iconTexture";
import { IconTexture } from "@/icon/iconTexture";
import { IconGeometry, Icons } from "@/icon/icons";
import { IconSubscript } from "@/icon/iconSubscript";
import type { TextStyle } from "@/icon/iconSubscript";
import {
    CARGO_FADE,
    CARGO_LIFT_ABOVE_SURFACE,
    Cargos,
} from "@/Animation/cargos";
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
import { INSERTER_HEIGHT, inserterTrans } from "./geometryHelpers";
import {
    Inserters,
    INSERTER_BEAM_THICKNESS,
    INSERTER_BEAM_WIDTH,
    INSERTER_FRAME_COLOR,
    INSERTER_FRAME_HEIGHT,
    INSERTER_FRAME_WIDTH,
} from "@/Animation/inserter";
import { InserterSupports } from "@/Animation/InserterSupports";

/** 未知建筑（没有 buildingMeta）时使用的占位颜色，与旧 `buildBoxes` 兜底一致 */
const UNKNOWN_BUILDING_COLOR = new Color(0xdddddd);

/** 取建筑元数据颜色；未知建筑回退占位色（修复：旧代码用 `!` 断言，未知模型会抛错白屏） */
function colorOf(modelIndex: number): Color {
    return buildingMeta.get(modelIndex)?.color ?? UNKNOWN_BUILDING_COLOR;
}

/**
 * 条带 ribbon 的挤出厚度（世界单位）：带状网格的顶面 = 节点平面 + 该值。
 *
 * 带身、半圆端帽与弧形护栏共用这一个厚度，避免各部件之间出现台阶或缝隙。
 */
const BELT_RIBBON_THICKNESS = 0.05;

/**
 * 条带货物中心相对节点平面的抬升（沿带面法线）。
 *
 * ribbon 顶面（`BELT_RIBBON_THICKNESS`）之上再留「货半高 + 间隙」，那半份由
 * `cargos.ts` 的 `CARGO_LIFT_ABOVE_SURFACE` 单点定义；旧的盒式条带抬升常量
 * 是按盒式厚度反推的，不能直接套用到 ribbon。
 */
const BELT_CARGO_LIFT = BELT_RIBBON_THICKNESS + CARGO_LIFT_ABOVE_SURFACE;

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
        const objects: Object3D[] = [];

        const linkThickness = BELT_RIBBON_THICKNESS;
        {
            // 带宽 0.7（halfWidth 为半宽）。每个连接节点共用同一截面，
            // 并从节点 Matrix4 读取实际带面朝向，包含 planet.ts 中应用的 roll。
            const halfWidth = 0.35;
            const beltSurfaceColor = new Color(0x4a4744);
            const beltBottomColor = new Color(0x4a4744);
            const miterLimit = 4;
            const capSegments = 12;
            const railCapSegments = 8;
            const railWidth = 0.045;
            const railHeight = 0.032;
            const railSurfaceLift = 0.0015;
            const junctionRailInset = 0.16;
            const p1 = new Vector3();
            const p2 = new Vector3();
            const direction = new Vector3();
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
                const normal = axisZ
                    .clone()
                    .addScaledVector(tangent, -axisZ.dot(tangent));
                if (normal.lengthSq() < 1e-8) {
                    // 极端姿态下法线与切线近乎平行，改用矩阵局部 +X 恢复框架。
                    const side = axisX
                        .clone()
                        .addScaledVector(tangent, -axisX.dot(tangent));
                    if (side.lengthSq() < 1e-8) {
                        side.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
                    }
                    side.normalize();
                    normal.crossVectors(side, tangent).normalize();
                    return { side, normal };
                }
                normal.normalize();
                const side = new Vector3()
                    .crossVectors(tangent, normal)
                    .normalize();

                return { normal, side };
            };

            /**
             * 滚转支撑抬升：按滚转后的带面截面（含两侧护栏外扩）求最低点，
             * 把节点沿球面径向外移，使最低边缘刚好落在球面上。
             *
             * tilt = 0 时最低点就在节点平面上，返回 0，保持原有高度不变。
             */
            const getSupportLift = (
                center: Vector3,
                side: Vector3,
                normal: Vector3,
                halfSpan: number
            ): number => {
                const radial = center.clone().normalize();
                if (radial.lengthSq() < 1e-8) return 0;

                const sideUnit = side.clone().normalize();
                const normalUnit = normal.clone().normalize();
                if (
                    sideUnit.lengthSq() < 1e-8 ||
                    normalUnit.lengthSq() < 1e-8
                )
                    return 0;

                const railOuter = halfSpan + railWidth;
                const railBase = linkThickness + railSurfaceLift;
                // 截面四角 + 低侧护栏外沿：足以覆盖带面、侧壁和护栏的最低点。
                const samples: Array<[number, number]> = [
                    [-halfSpan, 0],
                    [halfSpan, 0],
                    [-halfSpan, linkThickness],
                    [halfSpan, linkThickness],
                    [-railOuter, railBase],
                    [railOuter, railBase],
                ];

                let minOffset = Infinity;
                for (const [lateral, height] of samples) {
                    const offset = sideUnit
                        .clone()
                        .multiplyScalar(lateral)
                        .addScaledVector(normalUnit, height)
                        .dot(radial);
                    minOffset = Math.min(minOffset, offset);
                }

                // 只有真正低于球面时才抬升；+2mm 避免与地面网格 z-fighting。
                return minOffset < 0 ? -minOffset + 0.002 : 0;
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
            }

            // 孤立带子格由两个半圆端帽合成传送带半径的整圆；有连接的格由
            // 跑道形条带端帽覆盖，不再需要端点圆柱。
            const linkedBelts = new Set<number>();
            for (const edge of links) {
                linkedBelts.add(edge.source);
                linkedBelts.add(edge.target);
            }
            const isolatedBelts = belts.filter((b) => !linkedBelts.has(b.index));
            for (const b of belts) {
                // 带子不再依赖 InstancedMesh 实例做 modelRef，
                // 返回节点 base 矩阵即可满足 getBuildingModel 与定位需求。
                modelRef[b.index] = { matrix: transforms[b.index][0].clone() };
            }

            // 连接图收齐后再建货物：淡出必须按端点拓扑决定，不能只看单条边。
            //
            // 所有货物共用一个 `cargoMove`，相邻段的货物在节点处是「一件停住、下一件接力」的
            // 交接关系，所以中段两端都不该缩放；只有链条真的断掉的地方才淡：
            //   - 起点淡入：该节点没有入边 → 没有前一段货物接班，否则会看到段尾瞬移回段首；
            //   - 终点淡出：该节点没有出边 → 没有后一段货物接班。
            // （实际 addTrack 放在滚转支撑抬升之后，保证货物与带面共用同一组端点。）

            if (links.length || isolatedBelts.length) {
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
                        // side 已经由运输方向 × 带面法线确定方向。
                        // 不再根据 side 点积决定是否翻转。
                        sideSum.add(frame.side);
                    }
                    if (sideSum.lengthSq() < 1e-8) {
                        sideSum.copy(referenceSide);
                    }
                    sideSum.normalize();

                    // 保持截面宽度方向与实际带面法线正交。
                    sideSum.addScaledVector(normal, -sideSum.dot(normal));
                    if (sideSum.lengthSq() < 1e-8) {
                        sideSum.copy(referenceSide);
                        sideSum.addScaledVector(normal, -sideSum.dot(normal));
                    }
                    sideSum.normalize();

                    const sideProjections = incidentFrames.map((frame) =>
                        Math.abs(sideSum.dot(frame.side))
                    );
                    const denom = Math.max(0.25, Math.min(...sideProjections));
                    const miterLength = Math.min(
                        halfWidth / denom,
                        halfWidth * miterLimit
                    );
                    const sideOffset = sideSum.multiplyScalar(miterLength);
                    // 再正交化一次，确保 0.05 厚度沿节点局部带面法线挤出。
                    normal
                        .addScaledVector(
                            sideSum,
                            -normal.dot(sideSum) / sideSum.lengthSq()
                        )
                        .normalize();

                    nodeFrames.set(nodeId, { sideOffset, normal });
                }

                // ============================================================
                // 滚转支撑抬升
                //
                // 带面法线保留 blueprint tilt 的 roll，但整条带子要沿球面径向外移：
                // 每个节点按“滚转后的截面最低点（含护栏外扩）”求位移，再取所有
                // 相邻段的包络最大值，保证任一入射/出射方向都不会切入球面。
                // ============================================================
                const nodeLift = new Map<number, number>();
                const nodeCenter = new Vector3();

                for (const [nodeId, nodeFrame] of nodeFrames) {
                    nodeCenter.setFromMatrixPosition(transforms[nodeId][0]);
                    const halfSpan = Math.max(
                        halfWidth,
                        nodeFrame.sideOffset.length()
                    );
                    const ins = incoming.get(nodeId) ?? [];
                    const outs = outgoing.get(nodeId) ?? [];

                    let lift = getSupportLift(
                        nodeCenter,
                        nodeFrame.sideOffset,
                        nodeFrame.normal,
                        halfSpan
                    );
                    // 相邻段各自的滚转截面取最大值：交界处任一侧都不允许穿地。
                    for (const edge of ins) {
                        lift = Math.max(
                            lift,
                            getSupportLift(
                                nodeCenter,
                                edge.endFrame.side,
                                edge.endFrame.normal,
                                halfSpan
                            )
                        );
                    }
                    for (const edge of outs) {
                        lift = Math.max(
                            lift,
                            getSupportLift(
                                nodeCenter,
                                edge.startFrame.side,
                                edge.startFrame.normal,
                                halfSpan
                            )
                        );
                    }
                    if (lift > 0) nodeLift.set(nodeId, lift);
                }

                // 孤立格没有连接边，用它自身矩阵的滚转截面计算。
                for (const b of isolatedBelts) {
                    transforms[b.index][0].extractBasis(axisX, axisY, axisZ);
                    nodeCenter.setFromMatrixPosition(transforms[b.index][0]);
                    const lift = getSupportLift(
                        nodeCenter,
                        axisY,
                        axisZ,
                        halfWidth
                    );
                    if (lift > 0) nodeLift.set(b.index, lift);
                }

                // 把支撑位移写回带段端点，并按抬升后的弦重新求切线与端点 frame，
                // 避免端帽朝向与带身实际方向错开。
                for (const edge of links) {
                    const startLift = nodeLift.get(edge.source) ?? 0;
                    if (startLift > 0) {
                        edge.start.addScaledVector(
                            edge.start.clone().normalize(),
                            startLift
                        );
                    }
                    const endLift = nodeLift.get(edge.target) ?? 0;
                    if (endLift > 0) {
                        edge.end.addScaledVector(
                            edge.end.clone().normalize(),
                            endLift
                        );
                    }

                    direction.subVectors(edge.end, edge.start);
                    const len = direction.length();
                    if (len < 1e-6) continue;
                    edge.tangent = direction.multiplyScalar(1 / len).clone();
                    edge.startFrame = getEndpointFrame(
                        transforms[edge.source][0],
                        edge.tangent
                    );
                    edge.endFrame = getEndpointFrame(
                        transforms[edge.target][0],
                        edge.tangent
                    );
                }

                // 货物在抬升/重定向之后再加：start / end / up 与带面完全同源。
                for (const edge of links) {
                    cargosMesh.addTrack({
                        start: edge.start,
                        end: edge.end,
                        up: edge.startFrame.normal,
                        distance: edge.start.distanceTo(edge.end),
                        fadeIn: incoming.has(edge.source) ? 0 : CARGO_FADE,
                        fadeOut: outgoing.has(edge.target) ? 0 : CARGO_FADE,
                        lift: BELT_CARGO_LIFT,
                    });
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

                // ============================================================
                // 双侧类型色边框：低矮、窄幅，明确传送带边缘但不再形成高护栏。
                // 边框颜色继承当前传送带类型色，T 字节点附近仍会收短避让。
                // ============================================================
                const railPositions: number[] = [];
                const railColors: number[] = [];

                type RailSection = {
                    innerBottom: Vector3;
                    outerBottom: Vector3;
                    innerTop: Vector3;
                    outerTop: Vector3;
                };

                const addRailTriangle = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    color: Color
                ) => {
                    railPositions.push(
                        a.x,
                        a.y,
                        a.z,
                        b.x,
                        b.y,
                        b.z,
                        c.x,
                        c.y,
                        c.z
                    );
                    for (let i = 0; i < 3; i++) {
                        railColors.push(color.r, color.g, color.b);
                    }
                };

                const addRailQuad = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    d: Vector3,
                    color: Color
                ) => {
                    addRailTriangle(a, b, c, color);
                    addRailTriangle(a, c, d, color);
                };

                const makeRailSection = (
                    base: Vector3,
                    normal: Vector3,
                    outward: Vector3
                ): RailSection => {
                    const innerBottom = base
                        .clone()
                        .addScaledVector(normal, railSurfaceLift);
                    const outerBottom = innerBottom
                        .clone()
                        .addScaledVector(outward, railWidth);
                    const innerTop = innerBottom
                        .clone()
                        .addScaledVector(normal, railHeight);
                    const outerTop = outerBottom
                        .clone()
                        .addScaledVector(normal, railHeight);

                    return { innerBottom, outerBottom, innerTop, outerTop };
                };

                const lerpRailSection = (
                    a: RailSection,
                    b: RailSection,
                    t: number
                ): RailSection => ({
                    innerBottom: a.innerBottom.clone().lerp(b.innerBottom, t),
                    outerBottom: a.outerBottom.clone().lerp(b.outerBottom, t),
                    innerTop: a.innerTop.clone().lerp(b.innerTop, t),
                    outerTop: a.outerTop.clone().lerp(b.outerTop, t),
                });

                const addGuardRail = (
                    startBase: Vector3,
                    endBase: Vector3,
                    startNormal: Vector3,
                    endNormal: Vector3,
                    startOutward: Vector3,
                    endOutward: Vector3,
                    startTrim: number,
                    endTrim: number,
                    edgeLength: number,
                    color: Color
                ) => {
                    if (edgeLength < 1e-6) return;

                    const startSection = makeRailSection(
                        startBase,
                        startNormal,
                        startOutward
                    );
                    const endSection = makeRailSection(
                        endBase,
                        endNormal,
                        endOutward
                    );

                    // 在 T 字/多分支节点附近收短护栏，并封闭收口端面。
                    const tStart = Math.min(0.2, startTrim / edgeLength);
                    const tEnd = Math.max(0.8, 1 - endTrim / edgeLength);
                    if (tStart >= tEnd) return;

                    const a = lerpRailSection(startSection, endSection, tStart);
                    const b = lerpRailSection(startSection, endSection, tEnd);

                    // 顶面、内外侧壁、首尾端盖和底面，构成闭合的金属护栏截面。
                    addRailQuad(
                        a.innerTop,
                        b.innerTop,
                        b.outerTop,
                        a.outerTop,
                        color
                    );
                    addRailQuad(
                        a.innerBottom,
                        b.innerBottom,
                        b.innerTop,
                        a.innerTop,
                        color
                    );
                    addRailQuad(
                        a.outerBottom,
                        a.outerTop,
                        b.outerTop,
                        b.outerBottom,
                        color
                    );
                    addRailQuad(
                        a.innerBottom,
                        a.outerBottom,
                        a.outerTop,
                        a.innerTop,
                        color
                    );
                    addRailQuad(
                        b.innerBottom,
                        b.innerTop,
                        b.outerTop,
                        b.outerBottom,
                        color
                    );
                    addRailQuad(
                        a.innerBottom,
                        b.innerBottom,
                        b.outerBottom,
                        a.outerBottom,
                        color
                    );
                };

                /**
                 * 在带段端点生成半圆端帽：圆心落在节点中心，半径等于该端实际半宽，
                 * 半圆朝向带段外侧（起点向后、终点向前），与矩形带身拼成跑道形。
                 */
                const addHalfDiscCap = (
                    center: Vector3,
                    normal: Vector3,
                    sideDir: Vector3,
                    forwardDir: Vector3,
                    radius: number,
                    color: Color
                ) => {
                    if (radius < 1e-6) return;

                    const bottomCenter = center.clone();
                    const topCenter = center
                        .clone()
                        .addScaledVector(normal, linkThickness);
                    const arcBottom: Vector3[] = [];
                    const arcTop: Vector3[] = [];

                    for (let i = 0; i <= capSegments; i++) {
                        const theta = -Math.PI / 2 + (Math.PI * i) / capSegments;
                        const u = Math.cos(theta);
                        const v = Math.sin(theta);
                        const radial = forwardDir
                            .clone()
                            .multiplyScalar(u)
                            .add(sideDir.clone().multiplyScalar(v));
                        const p = center
                            .clone()
                            .addScaledVector(radial, radius);
                        arcBottom.push(p);
                        arcTop.push(
                            p.clone().addScaledVector(normal, linkThickness)
                        );
                    }

                    // 弧形侧壁
                    for (let i = 0; i < capSegments; i++) {
                        addQuad(
                            arcBottom[i],
                            arcBottom[i + 1],
                            arcTop[i + 1],
                            arcTop[i],
                            color
                        );
                    }

                    // 顶面半圆（扇形）
                    for (let i = 0; i < capSegments; i++) {
                        addTriangle(
                            topCenter,
                            arcTop[i + 1],
                            arcTop[i],
                            color
                        );
                    }

                    // 底面半圆（扇形，法线朝下）
                    for (let i = 0; i < capSegments; i++) {
                        addTriangle(
                            bottomCenter,
                            arcBottom[i],
                            arcBottom[i + 1],
                            color
                        );
                    }
                };

                /**
                 * 沿半圆路径挤出护栏截面，连接矩形带身两端的护栏端点，形成闭合边框。
                 */
                const addCurvedRail = (
                    center: Vector3,
                    normal: Vector3,
                    sideDir: Vector3,
                    forwardDir: Vector3,
                    radius: number,
                    color: Color
                ) => {
                    if (radius < 1e-6) return;

                    const sections: RailSection[] = [];
                    for (let i = 0; i <= railCapSegments; i++) {
                        const theta =
                            -Math.PI / 2 + (Math.PI * i) / railCapSegments;
                        const u = Math.cos(theta);
                        const v = Math.sin(theta);
                        const outward = forwardDir
                            .clone()
                            .multiplyScalar(u)
                            .add(sideDir.clone().multiplyScalar(v));
                        const base = center
                            .clone()
                            .addScaledVector(outward, radius);
                        sections.push(makeRailSection(base, normal, outward));
                    }

                    for (let i = 0; i < railCapSegments; i++) {
                        const a = sections[i];
                        const b = sections[i + 1];
                        // 顶面
                        addRailQuad(
                            a.innerTop,
                            b.innerTop,
                            b.outerTop,
                            a.outerTop,
                            color
                        );
                        // 外侧壁
                        addRailQuad(
                            a.outerBottom,
                            b.outerBottom,
                            b.outerTop,
                            a.outerTop,
                            color
                        );
                        // 内侧壁
                        addRailQuad(
                            a.innerBottom,
                            a.innerTop,
                            b.innerTop,
                            b.innerBottom,
                            color
                        );
                        // 底面
                        addRailQuad(
                            a.innerBottom,
                            b.innerBottom,
                            b.outerBottom,
                            a.outerBottom,
                            color
                        );
                    }
                };

                // 孤立带子格：两个半圆端帽朝相反方向合成传送带半径的整圆，
                // 并用同款弧形边框围一圈，与有连接格的跑道形端帽保持同一视觉语言。
                for (const b of isolatedBelts) {
                    transforms[b.index][0].extractBasis(axisX, axisY, axisZ);
                    const center = new Vector3().setFromMatrixPosition(
                        transforms[b.index][0]
                    );
                    const isolatedLift = nodeLift.get(b.index) ?? 0;
                    if (isolatedLift > 0) {
                        center.addScaledVector(
                            center.clone().normalize(),
                            isolatedLift
                        );
                    }
                    const normal = axisZ.clone().normalize();
                    const sideDir = axisY.clone().normalize();
                    const forwardDir = axisX.clone().normalize();
                    const radius = halfWidth;

                    addHalfDiscCap(
                        center,
                        normal,
                        sideDir,
                        forwardDir,
                        radius,
                        beltSurfaceColor
                    );
                    addHalfDiscCap(
                        center,
                        normal,
                        sideDir,
                        forwardDir.clone().negate(),
                        radius,
                        beltSurfaceColor
                    );

                    addCurvedRail(
                        center,
                        normal,
                        sideDir,
                        forwardDir,
                        radius,
                        colorOf(b.modelIndex)
                    );
                    addCurvedRail(
                        center,
                        normal,
                        sideDir,
                        forwardDir.clone().negate(),
                        radius,
                        colorOf(b.modelIndex)
                    );
                }

                const getNodeDegree = (nodeId: number) =>
                    (incoming.get(nodeId)?.length ?? 0) +
                    (outgoing.get(nodeId)?.length ?? 0);

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

                // ============================================================
                // 深灰色带面上的类型色边缘线 + 运输方向箭头
                // 横向凸棱已移除，避免带面产生地毯/踏板感；改为清晰的双侧窄边框。
                // ============================================================
                const surfacePositions: number[] = [];
                const surfaceColors: number[] = [];
                const arrowLighten = new Color(0xc8d0c8);

                const addSurfaceTriangle = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    color: Color
                ) => {
                    for (const vertex of [a, b, c]) {
                        surfacePositions.push(vertex.x, vertex.y, vertex.z);
                        surfaceColors.push(color.r, color.g, color.b);
                    }
                };

                const addSurfaceQuad = (
                    a: Vector3,
                    b: Vector3,
                    c: Vector3,
                    d: Vector3,
                    color: Color
                ) => {
                    addSurfaceTriangle(a, b, c, color);
                    addSurfaceTriangle(a, c, d, color);
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

                    const surfaceEdgeLength = edge.start.distanceTo(edge.end);

                    // 在带段任意位置采样带面中心、宽度方向和实际法线。
                    // 使用节点已计算好的截面偏移，确保纹理贴合 Miter 转角与 roll。
                    const sampleSurface = (
                        distance: number,
                        halfSpan: number
                    ) => {
                        const t = Math.max(
                            0,
                            Math.min(1, distance / surfaceEdgeLength)
                        );
                        const center = edge.start.clone().lerp(edge.end, t);
                        const normal = edge.startFrame.normal
                            .clone()
                            .lerp(edge.endFrame.normal, t);
                        if (normal.lengthSq() < 1e-8) {
                            normal.copy(edge.startFrame.normal);
                        }
                        normal.normalize();

                        const side = startSideOffset
                            .clone()
                            .lerp(endSideOffset, t);
                        side.addScaledVector(normal, -side.dot(normal));
                        if (side.lengthSq() < 1e-8) {
                            side.copy(edge.startFrame.side);
                            side.addScaledVector(normal, -side.dot(normal));
                        }
                        side.normalize().multiplyScalar(halfSpan);
                        return { center, normal, side };
                    };

                    // 端帽半径取该端实际半宽；带身始终从节点中心铺到节点中心，
                    // 端帽朝带段外侧延伸，嘴部正好与带身端面重合，不再留缝。
                    const startCap =
                        (incoming.get(edge.source)?.length ?? 0) === 0;
                    const endCap =
                        (outgoing.get(edge.target)?.length ?? 0) === 0;
                    const startRadius = startSideOffset.length();
                    const endRadius = endSideOffset.length();

                    // 顶面两侧各铺一条窄类型色饰边，形成图示中的彩色轮廓线。
                    const borderStartInset = startCap
                        ? 0.02
                        : getNodeDegree(edge.source) >= 3
                        ? 0.22
                        : 0.015;
                    const borderEndInset = endCap
                        ? 0.02
                        : getNodeDegree(edge.target) >= 3
                        ? 0.22
                        : 0.015;
                    const borderLength =
                        surfaceEdgeLength - borderStartInset - borderEndInset;
                    const borderOuterSpan = halfWidth - 0.006;
                    const borderInnerSpan = halfWidth - 0.034;
                    const borderLift = 0.003;

                    if (borderLength > 0.04) {
                        const aOuter = sampleSurface(
                            borderStartInset,
                            borderOuterSpan
                        );
                        const aInner = sampleSurface(
                            borderStartInset,
                            borderInnerSpan
                        );
                        const bOuter = sampleSurface(
                            surfaceEdgeLength - borderEndInset,
                            borderOuterSpan
                        );
                        const bInner = sampleSurface(
                            surfaceEdgeLength - borderEndInset,
                            borderInnerSpan
                        );

                        const liftPoint = (
                            frame: typeof aOuter,
                            sign: number
                        ) =>
                            frame.center
                                .clone()
                                .addScaledVector(
                                    frame.side.clone().normalize(),
                                    sign * frame.side.length()
                                )
                                .addScaledVector(
                                    frame.normal,
                                    linkThickness + borderLift
                                );

                        // +side 一侧
                        addSurfaceQuad(
                            liftPoint(aInner, 1),
                            liftPoint(bInner, 1),
                            liftPoint(bOuter, 1),
                            liftPoint(aOuter, 1),
                            edge.color
                        );
                        // -side 一侧
                        addSurfaceQuad(
                            liftPoint(aOuter, -1),
                            liftPoint(bOuter, -1),
                            liftPoint(bInner, -1),
                            liftPoint(aInner, -1),
                            edge.color
                        );
                    }

                    // 方向箭头沿 edge.start -> edge.end 排列。
                    // 短模块尽量放一个居中箭头，长模块则按约 1.6 单位的节奏重复。
                    // 端帽区域不排箭头，让箭头完整落在矩形带身上。
                    const arrowStartInset = startCap
                        ? 0.05
                        : getNodeDegree(edge.source) >= 3
                        ? 0.28
                        : 0.18;
                    const arrowEndInset = endCap
                        ? 0.05
                        : getNodeDegree(edge.target) >= 3
                        ? 0.28
                        : 0.18;
                    const arrowAvailable =
                        surfaceEdgeLength - arrowStartInset - arrowEndInset;
                    if (arrowAvailable >= 0.42) {
                        const arrowSpacing = 1.6;
                        const arrowCount = Math.max(
                            1,
                            Math.round(arrowAvailable / arrowSpacing)
                        );
                        const arrowHalfWidth = 0.072;
                        const arrowLift = 0.006;
                        const arrowTint = edge.color
                            .clone()
                            .lerp(arrowLighten, 0.48);
                        const arrowShape: Array<[number, number]> = [
                            [0.112, 0],
                            [0.018, 0.072],
                            [0.018, 0.026],
                            [-0.102, 0.026],
                            [-0.102, -0.026],
                            [0.018, -0.026],
                            [0.018, -0.072],
                        ];

                        for (let i = 0; i < arrowCount; i++) {
                            const distance =
                                arrowStartInset +
                                ((i + 0.5) / arrowCount) * arrowAvailable;
                            const frame = sampleSurface(
                                distance,
                                arrowHalfWidth
                            );
                            const arrowCenter = frame.center
                                .clone()
                                .addScaledVector(
                                    frame.normal,
                                    linkThickness + arrowLift
                                );
                            const arrowVertices = arrowShape.map(
                                ([forward, lateral]) =>
                                    arrowCenter
                                        .clone()
                                        .addScaledVector(edge.tangent, forward)
                                        .addScaledVector(
                                            frame.side.clone().normalize(),
                                            lateral
                                        )
                            );

                            // 三角扇填充箭头轮廓，尖端始终朝向输出节点。
                            for (let j = 0; j < arrowVertices.length; j++) {
                                const next = (j + 1) % arrowVertices.length;
                                addSurfaceTriangle(
                                    arrowCenter,
                                    arrowVertices[j],
                                    arrowVertices[next],
                                    arrowTint
                                );
                            }
                        }
                    }

                    // 跑道形带身：矩形中段 + 两端半圆端帽。
                    const startBody = edge.start.clone();
                    const endBody = edge.end.clone();

                    const bodyStartLeft = startBody.clone().add(startSideOffset);
                    const bodyStartRight = startBody.clone().sub(
                        startSideOffset
                    );
                    const bodyEndLeft = endBody.clone().add(endSideOffset);
                    const bodyEndRight = endBody.clone().sub(endSideOffset);

                    const bodyStartTopLeft = bodyStartLeft
                        .clone()
                        .addScaledVector(startFrame.normal, linkThickness);
                    const bodyStartTopRight = bodyStartRight
                        .clone()
                        .addScaledVector(startFrame.normal, linkThickness);
                    const bodyEndTopLeft = bodyEndLeft
                        .clone()
                        .addScaledVector(endFrame.normal, linkThickness);
                    const bodyEndTopRight = bodyEndRight
                        .clone()
                        .addScaledVector(endFrame.normal, linkThickness);

                    // 护栏内侧贴合带面边缘，向带面外侧延伸，不侵占有效运输宽度。
                    // 多分支节点收短 0.16，避免 T 字中心出现护栏交叉和重叠。
                    const bodyLength = startBody.distanceTo(endBody);
                    const startTrim = startCap
                        ? 0
                        : Math.min(junctionRailInset, bodyLength * 0.2);
                    const endTrim = endCap
                        ? 0
                        : Math.min(junctionRailInset, bodyLength * 0.2);
                    const startOutward = startSideOffset.clone().normalize();
                    const endOutward = endSideOffset.clone().normalize();

                    if (bodyLength > 1e-6) {
                        addGuardRail(
                            bodyStartTopLeft,
                            bodyEndTopLeft,
                            startFrame.normal,
                            endFrame.normal,
                            startOutward,
                            endOutward,
                            startTrim,
                            endTrim,
                            bodyLength,
                            edge.color
                        );
                        addGuardRail(
                            bodyStartTopRight,
                            bodyEndTopRight,
                            startFrame.normal,
                            endFrame.normal,
                            startOutward.clone().negate(),
                            endOutward.clone().negate(),
                            startTrim,
                            endTrim,
                            bodyLength,
                            edge.color
                        );
                    }

                    // 两端半圆端帽 + 弧形边框
                    const startSideDir = startOutward;
                    const endSideDir = endOutward;

                    if (startCap && startRadius > 1e-6) {
                        addCurvedRail(
                            edge.start,
                            startFrame.normal,
                            startSideDir,
                            edge.tangent.clone().negate(),
                            startRadius,
                            edge.color
                        );
                        addHalfDiscCap(
                            edge.start,
                            startFrame.normal,
                            startSideDir,
                            edge.tangent.clone().negate(),
                            startRadius,
                            beltSurfaceColor
                        );
                    }

                    if (endCap && endRadius > 1e-6) {
                        addCurvedRail(
                            edge.end,
                            endFrame.normal,
                            endSideDir,
                            edge.tangent,
                            endRadius,
                            edge.color
                        );
                        addHalfDiscCap(
                            edge.end,
                            endFrame.normal,
                            endSideDir,
                            edge.tangent,
                            endRadius,
                            beltSurfaceColor
                        );
                    }

                    // 矩形带身
                    if (bodyLength > 1e-6) {
                        // 顶面
                        addQuad(
                            bodyStartTopLeft,
                            bodyEndTopLeft,
                            bodyEndTopRight,
                            bodyStartTopRight,
                            beltSurfaceColor
                        );

                        // 底面
                        addQuad(
                            bodyStartLeft,
                            bodyEndLeft,
                            bodyEndRight,
                            bodyStartRight,
                            beltBottomColor,
                            true
                        );

                        // 左侧面
                        addQuad(
                            bodyStartLeft,
                            bodyEndLeft,
                            bodyEndTopLeft,
                            bodyStartTopLeft,
                            beltSurfaceColor
                        );

                        // 右侧面
                        addQuad(
                            bodyStartRight,
                            bodyEndRight,
                            bodyEndTopRight,
                            bodyStartTopRight,
                            beltSurfaceColor,
                            true
                        );
                    }
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
                    const junctionLift = nodeLift.get(nodeId) ?? 0;
                    if (junctionLift > 0) {
                        center.addScaledVector(
                            center.clone().normalize(),
                            junctionLift
                        );
                    }

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
                        const leftTop = left
                            .clone()
                            .addScaledVector(frame.normal, linkThickness);

                        const rightTop = right
                            .clone()
                            .addScaledVector(frame.normal, linkThickness);

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
                                other.bottom.distanceToSquared(point.bottom) <
                                1e-8
                        );

                        if (!duplicated) {
                            uniqueBoundary.push(point);
                        }
                    }

                    if (uniqueBoundary.length < 3) continue;

                    // 交会区域中心。
                    // 底面和顶面中心分别使用节点实际带面法线。
                    const bottomCenter = center.clone();

                    const topCenter = center
                        .clone()
                        .addScaledVector(normal, linkThickness);

                    const color = beltSurfaceColor;

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

                // 类型色边框单独成批，避免影响深灰带面和连接补面。
                if (railPositions.length > 0) {
                    const railGeometry = new BufferGeometry();
                    railGeometry.setAttribute(
                        "position",
                        new Float32BufferAttribute(railPositions, 3)
                    );
                    railGeometry.setAttribute(
                        "color",
                        new Float32BufferAttribute(railColors, 3)
                    );
                    railGeometry.computeVertexNormals();
                    const railMaterial = new MeshLambertMaterial({
                        vertexColors: true,
                        side: DoubleSide,
                    });
                    const railMesh = new Mesh(railGeometry, railMaterial);
                    objects.push(railMesh);
                }

                // 类型色边缘线与方向箭头共用一份独立顶面装饰网格。
                if (surfacePositions.length > 0) {
                    const surfaceGeometry = new BufferGeometry();
                    surfaceGeometry.setAttribute(
                        "position",
                        new Float32BufferAttribute(surfacePositions, 3)
                    );
                    surfaceGeometry.setAttribute(
                        "color",
                        new Float32BufferAttribute(surfaceColors, 3)
                    );
                    surfaceGeometry.computeVertexNormals();
                    const surfaceMaterial = new MeshLambertMaterial({
                        vertexColors: true,
                        side: DoubleSide,
                    });
                    objects.push(new Mesh(surfaceGeometry, surfaceMaterial));
                }
            }
        }
        return objects;
    };

    // 分拣器
    const buildInserters = (
        inserters: BlueprintBuilding[]
    ): [Inserters, InserterSupports, InstancedMesh] => {
        /**
         * 横梁在 `inserterTrans` 的姿态原点（`INSERTER_HEIGHT`）之上再抬高。
         *
         * 梁厚 0.08 时抬到 0.11，梁底仍在径向 0.37，与货物顶面（0.35）
         * 保持约 0.02 的间隙；改梁厚时必须同步复核这个预算。
         */
        const BEAM_EXTRA_LIFT = 0.11;

        /** 货物相对基础姿态下移 */
        const CARGO_DROP = 0.1;

        /** 货物末端淡出宽度，占整个运输行程的比例 */
        const INSERTER_CARGO_FADE = 0.15;

        const beamMesh = new Inserters(inserters.length);

        /**
         * 门形支架：每个分拣器两端各一个，由两根立柱、两个底座和一根顶部横梁组成。
         *
         * `InserterSupports` 只在「端点局部空间」里写矩阵（+Y = 球面法线，
         * -Z = 臂轴）。这里传入局部端点后再右乘 `trans`，而不是直接传世界坐标：
         * 球面上不同经/纬度的「上」并不等于世界 +Y，按世界坐标生成会让支架
         * 偏离球面法线。两端都固定生成，不读取 `inputObjIdx` / `outputObjIdx`。
         */
        const supportMesh = new InserterSupports(inserters.length);

        // 横梁两侧轮廓：单位盒 + 逐实例缩放。
        const frameMesh = new InstancedMesh(
            new BoxGeometry(1, 1, 1),
            new MeshLambertMaterial({ color: INSERTER_FRAME_COLOR }),
            inserters.length * 2
        );

        // 命名便于场景调试与单测定位（不影响渲染）
        frameMesh.name = "inserterFrames";
        supportMesh.name = "inserterSupports";

        const trans = new Matrix4();
        const temp = new Matrix4();
        const cargoTrans = new Matrix4();
        const beamTrans = new Matrix4();
        const local = new Matrix4();
        const localScale = new Vector3();
        const supportEndpoint = new Vector3();
        const supportAxis = new Vector3(0, 0, -1);

        /**
         * 在分拣器局部空间里放一个盒子：
         * `base * T(x,y,z) * S(sx,sy,sz)`。
         *
         * 所有结构都从 `inserterTrans` 的原始矩阵派生，
         * 四个朝向共用同一套局部坐标，不写死世界 X/Z。
         */
        const setLocalBox = (
            mesh: InstancedMesh,
            index: number,
            base: Matrix4,
            x: number,
            y: number,
            z: number,
            sx: number,
            sy: number,
            sz: number
        ) => {
            local.makeTranslation(x, y, z);
            local.scale(localScale.set(sx, sy, sz));
            local.premultiply(base);
            mesh.setMatrixAt(index, local);
        };

        // 门形支架顶部横梁与主横梁同中心；`trans` 原点已抬到 `INSERTER_HEIGHT`，
        // 所以地面在局部 Y = -INSERTER_HEIGHT。
        const supportTopY = BEAM_EXTRA_LIFT + INSERTER_BEAM_THICKNESS * 0.5;
        const groundY = -INSERTER_HEIGHT;

        /**
         * 横梁 / 两侧框架 / 门形支架相对分拣器两端再向外延伸的距离。
         *
         * `len` 是两端建筑中心之间的距离；带面宽度约 0.7，中心到外缘是 0.35。
         * 向外补这一截后，最外侧的梁端与支架正好压在带面外缘（截图里的红线）上，
         * 而不是停在带子中心。所有分拣器统一延伸，端点的相对关系保持不变。
         */
        const ARM_END_EXTEND = 0.35;

        for (let i = 0; i < inserters.length; i++) {
            const b = inserters[i];

            // 原始姿态与臂长；后续所有结构都只在这个局部空间里偏移
            const len = inserterTrans(transforms[b.index], trans);
            // 视觉长度比端点中心距多出两端延伸量，用来顶到相邻带面外缘
            const armLen = len + ARM_END_EXTEND * 2;
            const color = colorOf(b.modelIndex);

            // ① 货物：基础姿态下移，横梁缩放不污染货物
            cargoTrans.copy(trans);
            cargoTrans.multiply(temp.makeTranslation(0, -CARGO_DROP, 0));
            cargosMesh.addTrack({
                matrix: cargoTrans,
                distance: len,
                // 分拣器是单件抓放：抓取点淡入、投放点淡出
                fadeIn: INSERTER_CARGO_FADE,
                fadeOut: INSERTER_CARGO_FADE,
            });

            // ② 横梁：抬高 + 沿局部 Z 缩放 + 前推半梁长
            // 几何局部 z ∈ [-0.5, 0.5]；最终覆盖 z ∈ [ARM_END_EXTEND, -(len + ARM_END_EXTEND)]
            beamTrans.copy(trans); // 以分拣器基础姿态为基准，避免复用上一条记录残留的变换
            beamTrans.multiply(temp.makeTranslation(0, BEAM_EXTRA_LIFT, 0)); // 沿局部法线再抬高，与货物拉开垂直间隙
            beamTrans.multiply(temp.makeTranslation(0, 0, ARM_END_EXTEND)); // 先向起点外侧补出延伸量，缩放后两端各多一截
            beamTrans.multiply(temp.makeScale(1, 1, armLen)); // 只在局部 Z（臂轴）拉伸到臂长 + 两端余量，X/Y 不缩放
            beamTrans.multiply(temp.makeTranslation(0, 0, -0.5)); // 平移半个单位，让几何中心从 [-0.5,0.5] 移到 [-1,0]，与臂起点对齐

            beamMesh.setMatrixAt(i, beamTrans); // 写入第 i 个横梁实例的世界矩阵
            beamMesh.setColorAt(i, color); // 写入该实例的逐实例颜色（分拣器元数据色）

            // ③ 两端门形支架：随横梁一起向外延伸，端部仍内缩 0.04
            // 不依据 inputObjIdx / outputObjIdx 判断是否生成。
            const supportZ = [
                ARM_END_EXTEND - 0.04,
                -(len + ARM_END_EXTEND - 0.04),
            ];

            for (let j = 0; j < 2; j++) {
                supportEndpoint.set(0, supportTopY, supportZ[j]);
                supportMesh.addSupport(
                    supportEndpoint,
                    supportAxis,
                    color,
                    groundY
                );
            }

            // `addSupport` 写的是端点局部矩阵（每个端点 5 个实例：2 立柱 +
            // 2 底座 + 1 顶梁），再统一右乘分拣器姿态落回世界空间。
            const supportStart = i * 10;
            for (let k = 0; k < 10; k++) {
                supportMesh.getMatrixAt(supportStart + k, temp);
                temp.premultiply(trans);
                supportMesh.setMatrixAt(supportStart + k, temp);
            }

            // ④ 横梁两侧深色轮廓：贴着梁的 ±X 外沿，坐在梁顶面上
            const frameX =
                INSERTER_BEAM_WIDTH * 0.5 - INSERTER_FRAME_WIDTH * 0.5;
            const frameY =
                BEAM_EXTRA_LIFT + INSERTER_BEAM_THICKNESS * 0.5 + 0.025;

            for (let side = 0; side < 2; side++) {
                setLocalBox(
                    frameMesh,
                    i * 2 + side,
                    trans,
                    side === 0 ? -frameX : frameX,
                    frameY,
                    -len * 0.5,
                    INSERTER_FRAME_WIDTH,
                    INSERTER_FRAME_HEIGHT,
                    armLen
                );
            }

            // 原有拾取引用仍指向横梁
            modelRef[b.index] = {
                mesh: beamMesh,
                instance: i,
            };
        }

        beamMesh.instanceMatrix.needsUpdate = true;
        if (beamMesh.instanceColor !== null) {
            beamMesh.instanceColor.needsUpdate = true;
        }

        frameMesh.instanceMatrix.needsUpdate = true;
        supportMesh.update();

        // 首元素是横梁：调用方用它驱动 `cargoMove`，其余是纯视觉结构
        return [beamMesh, supportMesh, frameMesh];
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

    // 横梁 mesh 还要交给 `AllBuildings`，帧循环才能每帧写 `cargoMove`
    let insertersMesh: Inserters | null = null;

    if (inserters.length) {
        const [beam, ...parts] = buildInserters(inserters);
        insertersMesh = beam;
        meshes.push(beam, ...parts);
    }

    // 货物提交（裁 count + 属性上传）由 `Cargos` 自己收口，装配代码不再逐属性置位
    cargosMesh.finish();

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
        iconBuilt.subscriptMap,
        // 条带没有独立的箭头驱动者（相位由 `Cargos` 自持），这里只把横梁接上
        insertersMesh
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
        cargoCount: cargosMesh.cargoCount,
        perModelGlbCounts: built.perModelGlbCounts,
    };

    return { buildings: buildings3d, stats, iconTexture };
}
