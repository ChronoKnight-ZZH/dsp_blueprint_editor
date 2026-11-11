import {
    InstancedMesh,
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
import { CARGO_COLOR, CARGO_FADE, CARGO_SIZE, Cargos } from "@/Animation/cargos";
import type { CargoArcShape } from "@/Animation/cargos";
import {
    BELT_ELBOW_LIFT,
    BELT_ELBOW_STUB,
    BELT_HEIGHT,
    BELT_LEN,
    BELT_LIFT,
    BELT_RISER_BASE,
    BELT_SLOPE_EPS,
    CARGO_LIFT,
    RISER_CARGO_SIDE,
    Belts,
    BeltMaterial,
} from "@/Animation/belt";
import type { BeltMesh, BeltArcParams } from "@/Animation/belt";
import { computeBeltShapes } from "@/Animation/beltArc";
import type { BeltShape } from "@/Animation/beltArc";
import { BeltCaps } from "@/Animation/beltCaps";
import {
    BELT_CAP_DIAMETER,
    BELT_CAP_LIFT,
    BELT_CAP_SHORTEN,
    BELT_CAP_TIP_INSET,
} from "@/Animation/beltCaps";
import { BeltElbows } from "@/Animation/beltElbow";
import { Inserters } from "@/Animation/inserter";
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
import { HEIGHT_GRID_SIZE } from "@/planet/planetConstants";
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

    /**
     * 传送带：按「连接数」决定形状（v4 三态）
     *
     *   - 0 个连接（无前驱也无后继）→ 圆点；
     *   - 1 个连接 → 直段 + 开放端半圆帽。**线头 / 线尾格也是条带**：v3 用
     *     `outputObjIdx < 0` 判「孤立段」，把每条线的最后一格画成了圆点，
     *     条带永远比线短一格（实测 data/T字路口.json 的 `#7(0,5)` 就是这种格）；
     *   - 2 个连接 → 直段或 90° 转角，由 `beltArc.computeBeltShapes` 判定。
     *
     * 第 4 态是**垂直段**（`riser`）：出线指向「同一格的上/下一层」时，本格不转弯、
     * 也不斜坡（90° 的坡度剪切无解），而是整根刚性竖起来 —— 局部 -z 沿法线、
     * 局部 +y 是板面朝向（水平）。板立在**本格格心**（X/Y 居中），长度 = |rise|，
     * 下端面贴下层条带顶面、上端面贴上层条带顶面（见 `BELT_RISER_BASE`）。
     * 几何仍复用 `Belts` 方条（同一份几何与材质），只是姿态不同。
     *
     * 条带姿态 = `base × Rx(π/2) × T(0, BELT_LIFT + slope/2, 0)`，乘序不可换：
     *   - `base`（`transforms[i][0]`）**已经包含建筑 yaw**：`Ry(lon)·Rx(-lat)·Rz(-yaw)·T`，
     *     其局部 +y 轴就是本格流向（与方案 §3.4-F5 的 `dir=(sin yaw, cos yaw)` 一致）；
     *   - `Rx(π/2)` 把「建筑局部 +y＝流向」映射到「条带局部 -z＝流向」（货物着色器也向 -z 走）；
     *   - `T` 只负责抬升：`slope/2` 让后缘落在 `h_i`、前缘落在 `h_{i+1}`（§3.6）；
     *   - **没有缩放**：`BELT_LEN` 已烘进几何，非等比实例缩放会把圆弧压成椭圆（§3.6 / GL10）。
     *
     * 转角与坡度是逐实例形状参数，但**几何在 CPU 端算**（`beltArc.ts`）：条带写
     * `aBeltArc (θ0, θ1, cx, cz)` + `aBeltAux (slope, extend, exitX, exitZ)`，货物写
     * `aCargoArc` + `aCargoSlope`，两边**同源同值**（否则货物会走出条带）。着色器里
     * 只剩一次 `mix(θ0, θ1, u)` 和一次三角函数，圆心 / 半径 / 符号都不再写死在 GLSL 里。
     *
     * ⚠️ 与方案 §3.4 的差异（已实测确认，方案文字笔误）：方案写 `base × Rz(-yaw) × Rx(π/2)`，
     * 但 `base` 已含 `Rz(-yaw)`，再乘一次等于 `-2·yaw`。用 4 个 fixture 比对「本格 → 输出格」
     * 位移方向：按方案公式 yaw=90/180/270 的带子同向率 **0%**；去掉该 `Rz` 后为
     * 328/333、312/350、69/71、8/8（余下的是分流器侧口 / 非 90° 整数 yaw，本就不指向输出格）。
     * 若以后要恢复方案写法，必须先让 base 不含 yaw。
     *
     * **不读 `transforms[b.index][1]`**：DSP 蓝图里一条传送带记录只代表 1 格，
     * 段长与方向都取自 `yaw[0]` 与 `BELT_LEN`（方案 §3.4-F1/F2/F4）。
     *
     * 返回条带 mesh（可能为 null：没有带子或全部是孤立段），供 `AllBuildings.belts`
     * 在帧循环里写 `cargoMove`；条带/圆点 mesh 已放进 `objects`，释放由 `AllBuildings.dispose` 覆盖。
     */
    const buildBelts = (belts: BlueprintBuilding[]) => {
        const objects: Object3D[] = [];

        // ── ⓪ 形状：CPU 一次算完（连接 → 圆点 / 直段 / 转角 + 弧参数 + 端帽需求） ──
        // 纯函数、无 three 依赖 → Jest 可直接覆盖（tests/unit/animation/beltArc.spec.ts）
        const { shapes, issues, issueCount } = computeBeltShapes(buildings);
        if (issues.length) {
            // 明细已在 `computeBeltShapes` 里按类别限流（`ISSUE_SAMPLE_LIMIT`），这里只补总数
            console.warn(
                `[belt] 连接问题 ${issueCount} 条（明细已限流）：` +
                    issues.join("；")
            );
        }

        const shapeOf = (b: BlueprintBuilding) => shapes.get(b.index);
        const byIndex = new Map(buildings.map((b) => [b.index, b]));
        // 直段 + 垂直段共用条带（方条）；转角走圆环（倒圆棱柱）—— 三者共用一份材质
        const strips = belts.filter((b) => {
            const kind = shapeOf(b)?.kind;
            return kind === "straight" || kind === "riser";
        });
        const corners = belts.filter((b) => shapeOf(b)?.kind === "corner");
        const isolated = belts.filter(
            (b) => (shapeOf(b)?.kind ?? "dot") === "dot"
        );

        // Rx(π/2) 对所有带子相同，构造一次即可（yaw 已在 base 内）
        const rot = new Matrix4().makeRotationX(Math.PI / 2);
        const trans = new Matrix4();
        const cargoTrans = new Matrix4();
        const temp = new Matrix4();
        const frameFix = new Matrix4();
        const oldMatrix = new Matrix4();
        // lookAt 临时向量（直段 + 转角朝向推导）
        const lookSelf = new Vector3();
        const lookTarget = new Vector3();
        const lookUp = new Vector3();
        const lookDir = new Vector3();
        const lookProjected = new Vector3();
        // 转角专用：前驱位置、角平分线、旧帧方向、叉积
        const lookPred = new Vector3();
        const dirIn = new Vector3();
        const dirOut = new Vector3();
        const bisector = new Vector3();
        const oldDir = new Vector3();
        const phiCross = new Vector3();
        // 垂直段专用：法线、板面朝向（水平）、板心、三个基向量
        const riserUp = new Vector3();
        const riserSide = new Vector3();
        const riserCenter = new Vector3();
        const riserX = new Vector3();
        const riserY = new Vector3();
        const riserZ = new Vector3();

        /**
         * 转角弧参数修正角（弧度）：lookAt 平分线 vs CPU yawDeg 的差值。
         *
         * 非 0 时，弧的圆心和 θ 范围需要按 phi 旋转补偿，否则弧会偏转。
         * key = building index（`BlueprintBuilding.index`）。
         */
        const cornerPhi = new Map<number, number>();

        /**
         * 直段世界距离（本格 → 后继格的切面投影距离）。
         *
         * 用于 scale 和货物行程：条带几何仍为 BELT_LEN，实例矩阵按 dist/BELT_LEN 缩放。
         * key = building index。
         */
        const beltDist = new Map<number, number>();

        /**
         * 取本格的世界法线（base 矩阵的局部 +z 轴）。
         *
         * **不能**用 `position.normalize()`：那只在球面模式下等于法线；切平面模式下
         * base = `Rz(yaw)` + 平移 `(gx·cell, gy·cell, radius + z·HG)`，位置矢量的水平
         * 分量会把它拉斜（蓝图跨度越大越斜），lookAt 的 up 一斜，条带就绕流向滚转，
         * 表现为"同位置多出一条垂直/倾斜的条带"。base 的 +z 轴在两种模式下都严格是法线。
         */
        const normalOf = (b: BlueprintBuilding, out: Vector3) =>
            out.setFromMatrixColumn(transforms[b.index][0], 2).normalize();

        /** 尺度安全钳制：防止退化连线（同格 / 极近目标）把实例矩阵压成 0 或炸开 */
        const clampScale = (s: number) => Math.min(2, Math.max(0.5, s));

        /**
         * 该格的后继是否是一条**真正相邻的传送带**（`computeBeltShapes` 用整数格判定过）。
         *
         * 相邻格用 lookAt + scale；**非一格但仍是一条带去**（侧口 / 隔格 / 异尺度数据的
         * 半格偏移）另走 `chordOf` 的两点连线兜底，两者都拿不到时回落到网格帧 + 固定段长。
         */
        const isChained = (shape: BeltShape) => shape.outIndex !== null;

        /**
         * 用「本格 → 目标格」的世界弦摆一个条带帧（原版两点连线公式的正确用法）。
         *
         * 与原版的差别只有两处：up 用 `normalOf`（base 的 +z 列）而不是位置矢量 —— 位置矢量
         * 只在球面模式下等于法线；方向先做**切面投影**，于是高度差不会把条带整体旋转，
         * 而是交给 `slope` 去剪切（端面仍然竖直）。
         *
         * 返回 null 表示弦退化（近同格 / 侧口的方向是噪声），调用方继续走回退帧。
         */
        const chordFrame = (
            b: BlueprintBuilding,
            target: number,
            out: Matrix4
        ): Matrix4 | null => {
            if (target < 0 || target >= transforms.length) return null;
            lookSelf.setFromMatrixPosition(transforms[b.index][0]);
            lookTarget.setFromMatrixPosition(transforms[target][0]);
            normalOf(b, lookUp);
            lookDir.subVectors(lookTarget, lookSelf);
            lookDir.addScaledVector(lookUp, -lookDir.dot(lookUp));
            // 方向必须有「半格的量级」才算可靠；退化连线（近同格 / 侧口）
            // 的归一化方向是噪声，会让条带随机转 90° → 回退网格帧
            if (lookDir.lengthSq() <= (BELT_LEN * 0.5) ** 2) return null;
            lookProjected.copy(lookSelf).add(lookDir);
            out.lookAt(lookSelf, lookProjected, lookUp);
            out.setPosition(lookSelf);
            return out;
        };

        /**
         * 两点连线兜底的**适用区间**（相对 BELT_LEN）：弦长必须与一格同量级。
         *
         * - 太短（< 0.5 格）＝侧口 / 分流器侧面：条带本来就该占满自己那一格，
         *   把它缩成一截 0.2 格的短桩反而会在接头上挖出缝；
         * - 太长（> 2 格）＝隔格 / 异岛连线：拉一根长条会横穿中间那一格。
         */
        const CHORD_MIN = 0.5;
        const CHORD_MAX = 2;

        // 预计算：一格相邻的格记「世界距离」，非一格的后继记「世界弦长 + 高度差」
        // 标准格邻接时世界距离 ≈ BELT_LEN（浮点误差 ±1e-5），snap 到 BELT_LEN 保持精度
        const snapLen = (d: number) =>
            Math.abs(d - BELT_LEN) < 1e-4 ? BELT_LEN : d;
        /** 两点连线兜底的格：切面弦长 + 沿法线的高度差（两者都取世界单位） */
        const chordOf = new Map<number, { len: number; slope: number }>();

        /**
         * 「来料格 → 上升格」的补接量（世界单位）：来料格中心到上升格**格心**的切面距离。
         *
         * 上升格立在自己那一格的格心（见 `beltFrame` 的 riser 分支），而来料条带只铺到自己
         * 那一格的边界，于是两者之间空着一截（标准一格 ≈ 0.59 世界单位：半格 0.629 减去
         * 板半厚 0.04）。这里**不缩放条带**（缩放以条带中心为原点、两端对称，会把后端压进前一格），
         * 而是用 `extend` 只把**前缘顶点**沿流向拉过去，并给货物行程补上同样的量 ——
         * 货一路滑到贴着板面，两端仍靠 `CARGO_FADE` 淡出。
         *
         * key = 来料格 index；value = 到上升格中心的切面距离。
         */
        const riserFeed = new Map<number, number>();

        /** 后继若是传送带，返回它的 index；否则 null（输出到机器 / 悬空都算 null） */
        const beltTargetOf = (b: BlueprintBuilding): number | null => {
            if (b.outputObjIdx < 0 || b.outputObjIdx >= transforms.length)
                return null;
            const t = byIndex.get(b.outputObjIdx);
            return t !== undefined && isBelt(t.itemId) ? t.index : null;
        };

        for (const b of belts) {
            const shape = shapes.get(b.index);
            if (shape === undefined || shape.kind === "riser") continue;
            const target = beltTargetOf(b);
            if (target === null) continue;
            const targetB = byIndex.get(target);
            if (targetB === undefined) continue;
            lookSelf.setFromMatrixPosition(transforms[b.index][0]);
            lookTarget.setFromMatrixPosition(transforms[target][0]);
            normalOf(b, lookUp);
            lookDir.subVectors(lookTarget, lookSelf);
            // 高度差取 `localOffset.z`（与 `beltArc` 里的坡度同源），**不能**用弦的法线分量：
            // 球面上两个水平隔开的格心，弦的径向分量还含 −d²/2R 的弦高（1.1 格 ≈ 4.8mm）。
            const slope =
                (targetB.localOffset[0].z - b.localOffset[0].z) *
                HEIGHT_GRID_SIZE;
            lookDir.addScaledVector(lookUp, -lookDir.dot(lookUp)); // 切面投影
            const len = lookDir.length();
            // 后继是上升格（同格上下层）：记「来料 → 格心」距离，后面用 extend 补到板面
            if (shape.kind === "straight") {
                const targetShape = shapes.get(target);
                if (targetShape !== undefined && targetShape.kind === "riser")
                    riserFeed.set(b.index, len);
            }
            if (isChained(shape)) {
                beltDist.set(b.index, snapLen(len));
                continue;
            }
            // 区间与 `chordFrame` 的「半格」门槛保持一致（严格大于 0.5 格才认）
            if (len <= BELT_LEN * CHORD_MIN || len > BELT_LEN * CHORD_MAX)
                continue;
            beltDist.set(b.index, len);
            chordOf.set(b.index, {
                len,
                slope: Math.abs(slope) < BELT_SLOPE_EPS ? 0 : slope,
            });
        }

        /**
         * 统一姿态帧（返回"条带约定"：局部 -z = 流向、+y = 法线）。
         *
         * - **直段**：lookAt(self → 后继带)，弦取自世界坐标（`chordFrame`）；
         * - **非一格后继但弦长与一格同量级**（侧口外的半格 / 异尺度数据）：
         *   同一套两点连线（`chordOf`），长度 = 世界弦长、坡度 = 世界高度差；
         * - **转角**：lookAt(世界空间角平分线)，与直段同约定 → 接缝对齐。
         *   弧参数由 CPU 算好（grid-step yaw），帧旋转了 phi → 写 mesh 时用 `arcOf` 补偿。
         *   补偿后 `F_new · Ry(−phi)` 恒等于旧帧，所以转角的**世界几何与改动前完全一致**。
         * - **垂直段**：不用 lookAt（弦与 up 平行会退化 → 随机滚转），手工 `makeBasis`
         *   组一个**刚性帧**：-z = 行进方向（法线方向）、+y = 板面朝向（水平，指向来料侧）；
         *   位置固定在本格**格心**（X/Y 居中，垂直段占满自己那一格的正中间）。
         * - **圆点 / 开放端 / 太短或太长的连线 / 输出到机器**：
         *   回退 base × Rz(yaw修正) × Rx(π/2)，段长固定为 BELT_LEN。
         */
        const beltFrame = (
            b: BlueprintBuilding,
            shape: BeltShape,
            out: Matrix4
        ): Matrix4 => {
            // 垂直段：刚性帧（不能用 lookAt，也不能用坡度剪切）
            if (shape.kind === "riser") {
                const rise = shape.rise;
                normalOf(b, riserUp);
                lookSelf.setFromMatrixPosition(transforms[b.index][0]);
                riserCenter.copy(lookSelf);

                // 板面朝向：优先「指向来料侧」——这样货物的外侧正对着线来的那一面，
                // 与 DSP 里上升段的观感一致；没有水平前驱时退回本格流向。
                let sideLen = 0;
                if (shape.inIndex !== null) {
                    lookPred.setFromMatrixPosition(
                        transforms[shape.inIndex][0]
                    );
                    riserSide.subVectors(lookPred, lookSelf);
                    riserSide.addScaledVector(
                        riserUp,
                        -riserSide.dot(riserUp)
                    );
                    sideLen = riserSide.length();
                }
                // 前驱必须「有个半格的量级」才算可信（斜向/同格前驱的方向是噪声）
                if (sideLen > BELT_LEN * 0.2 && sideLen < BELT_LEN * 3) {
                    riserSide.divideScalar(sideLen);
                    // 板**只转不挪**：位置固定在本格格心（X/Y 居中），`riserSide` 只用来
                    // 定板面朝向 —— 这样上升段正好立在自己那一格的正中间，不会压到邻格。
                } else {
                    riserSide.set(0, 1, 0).transformDirection(
                        transforms[b.index][0]
                    );
                    riserSide.addScaledVector(
                        riserUp,
                        -riserSide.dot(riserUp)
                    );
                    if (riserSide.lengthSq() < 1e-6) riserSide.set(1, 0, 0);
                    riserSide.normalize();
                }

                // 局部 -z = 行进方向（rise > 0 时向上）；x = y × z 保证右手系
                riserZ.copy(riserUp).multiplyScalar(rise > 0 ? -1 : 1);
                riserX.crossVectors(riserSide, riserZ);
                if (riserX.lengthSq() < 1e-12) riserX.set(1, 0, 0);
                riserX.normalize();
                riserY.crossVectors(riserZ, riserX);
                out.makeBasis(riserX, riserY, riserZ);
                // 板心 = 场地基点 + (BELT_RISER_BASE + rise/2) × 法线：
                // 下端面贴本层条带顶面、上端面贴上层条带顶面（belt.ts 有推导）
                riserCenter.addScaledVector(
                    riserUp,
                    BELT_RISER_BASE + rise / 2
                );
                out.setPosition(riserCenter);
                return out;
            }

            // 直段：两点连线（本格 → 后继带）。
            // 一格相邻（`isChained`）与「非一格但弦长同量级」（`chordOf`）走同一条路：
            // 位置、朝向、长度全部取自真实世界弦，不再用网格帧 + 固定段长硬摆。
            if (
                shape.kind === "straight" &&
                (isChained(shape) || chordOf.has(b.index))
            ) {
                const frame = chordFrame(b, b.outputObjIdx, out);
                if (frame !== null) return frame;
            }

            // 转角：lookAt(世界空间角平分线)
            if (shape.kind === "corner" && shape.inIndex !== null && isChained(shape)) {
                lookSelf.setFromMatrixPosition(transforms[b.index][0]);
                lookPred.setFromMatrixPosition(
                    transforms[shape.inIndex][0]
                );
                lookTarget.setFromMatrixPosition(
                    transforms[b.outputObjIdx][0]
                );
                normalOf(b, lookUp);
                // 切面投影：去掉径向分量
                dirIn.subVectors(lookSelf, lookPred);
                dirIn.addScaledVector(lookUp, -dirIn.dot(lookUp));
                dirOut.subVectors(lookTarget, lookSelf);
                dirOut.addScaledVector(lookUp, -dirOut.dot(lookUp));
                bisector.copy(dirIn).add(dirOut);
                const minLen = BELT_LEN * 0.5;
                if (
                    dirIn.lengthSq() > minLen * minLen &&
                    dirOut.lengthSq() > minLen * minLen &&
                    bisector.lengthSq() > (minLen * 0.2) ** 2
                ) {
                    bisector.normalize();
                    // 旧帧的 -z 方向（CPU yawDeg 平分线在世界空间中的指向）
                    const delta =
                        ((b.yaw[0] - shape.yawDeg) / 180) * Math.PI;
                    oldMatrix.copy(transforms[b.index][0]);
                    if (Math.abs(delta) > 1e-9) {
                        oldMatrix.multiply(frameFix.makeRotationZ(delta));
                    }
                    oldMatrix.multiply(rot);
                    oldDir.set(0, 0, -1).transformDirection(oldMatrix);
                    // phi = 旧帧 → 新帧的旋转角（绕法线）
                    phiCross.crossVectors(oldDir, bisector);
                    const phi = Math.atan2(
                        phiCross.dot(lookUp),
                        oldDir.dot(bisector)
                    );
                    cornerPhi.set(b.index, phi);
                    // 用 lookAt 平分线作为帧方向
                    lookProjected.copy(lookSelf).add(bisector);
                    out.lookAt(lookSelf, lookProjected, lookUp);
                    out.setPosition(lookSelf);
                    return out;
                }
            }

            // 回退：圆点 / 开放端 / 退化方向
            const delta = ((b.yaw[0] - shape.yawDeg) / 180) * Math.PI;
            out.copy(transforms[b.index][0]);
            if (Math.abs(delta) > 1e-9) {
                out.multiply(frameFix.makeRotationZ(delta));
            }
            return out.multiply(rot);
        };

        /**
         * 逐格的**流向缩放系数**（相对 BELT_LEN）。
         *
         * 只有直段按世界距离缩放；垂直段按高度差缩放（板长 = |rise|）；
         * 转角 / 圆点的弧半径已烘死为半格长，恒为 1。
         */
        const scaleOf = (b: BlueprintBuilding, shape: BeltShape): number =>
            shape.kind === "riser"
                ? clampScale(Math.abs(shape.rise) / BELT_LEN)
                : shape.kind === "straight"
                ? clampScale((beltDist.get(b.index) ?? BELT_LEN) / BELT_LEN)
                : 1;

        /**
         * 逐格的**最终弧参数**：转角按 `cornerPhi` 补偿帧旋转，直段原样返回。
         *
         * 条带（圆环）与货物必须用**同一份**返回值，否则货物会走出圆环。
         * 依赖 `beltFrame` 已经对该格跑过一次（phi 在那里计算并写入 `cornerPhi`）。
         */
        const arcOf = (b: BlueprintBuilding, shape: BeltShape): BeltArcParams => {
            if (shape.kind !== "corner") return shape;
            const phi = cornerPhi.get(b.index) ?? 0;
            if (Math.abs(phi) <= 1e-9) return shape;
            const c = Math.cos(phi);
            const s = Math.sin(phi);
            return {
                theta0: shape.theta0 + phi,
                theta1: shape.theta1 + phi,
                centerX: c * shape.centerX - s * shape.centerZ,
                centerZ: s * shape.centerX + c * shape.centerZ,
                slope: shape.slope,
                extend: shape.extend,
                exitX: c * shape.exitX - s * shape.exitZ,
                exitZ: s * shape.exitX + c * shape.exitZ,
            };
        };

        /**
         * 逐格的**有效坡度**（世界单位，后端 → 前端）。
         *
         * 默认取 `shape.slope`（一格之间的坡度，`beltArc` 里算好）；**两点连线兜底**的格改用
         * 世界弦的高度差 —— 这类格的 Δxy 不是整数格，`beltArc` 按设计不给坡度，
         * 但两端确实差着高度，不补就在竖直方向断开（只在异尺度 / 半格数据里出现）。
         */
        const slopeOf = (b: BlueprintBuilding, shape: BeltShape): number =>
            chordOf.get(b.index)?.slope ?? shape.slope;

        /**
         * 来料条带前沿 → 上升格板近面的水平缺口（世界单位；不是来料格时为 0）。
         *
         *   缺口 = 到上升格中心的距离 − 板半厚 − 本条带半长
         *
         * 标准一格 ≈ 0.59。用 `Math.max(0, …)` 兜底：若某份数据里来料条带已经够长
         * （例如它本身走了两点连线、长度就等于格距），就不再多伸。
         */
        const riserGapOf = (b: BlueprintBuilding, shape: BeltShape): number => {
            const feed = riserFeed.get(b.index);
            if (feed === undefined) return 0;
            const halfStrip = (BELT_LEN * scaleOf(b, shape)) / 2;
            return Math.max(0, feed - BELT_HEIGHT / 2 - halfStrip);
        };

        /**
         * 写进实例属性（`aBeltArc` / `aBeltAux` / `aCargoSlope`）的形状参数。
         *
         * **必须以 `arcOf(b, shape)` 为底**：转角的弧要叠加 `cornerPhi` 补偿，圆环与货物
         * 拿到的必须是**同一份**值，否则货物会走出圆环（把 `arcOf` 换成 `shape` 就正好踩这个坑，
         * 表现为转角上的货物跑到弧外）。两点连线兜底改写的坡度、上升格来料的 `extend`
         * 作为覆盖层叠上去。
         *
         * 只有真的被改写时才产生新对象，其余情况原样返回，避免每条带子多一次分配。
         */
        const arcParamsOf = (b: BlueprintBuilding, shape: BeltShape) => {
            const arc = arcOf(b, shape);
            const slope = slopeOf(b, shape);
            const gap = riserGapOf(b, shape);
            if (slope === arc.slope && gap === 0) return arc;
            const merged = { ...arc, slope };
            if (gap > 0) {
                // `extend` 在**几何空间**里加（之后实例再乘 S），所以缺口要除以 s。
                // 出口切线写成本格流向：帧的局部 -z（上升格就在正前方，方向恒为 (0,−1)）。
                merged.extend = arc.extend + gap / scaleOf(b, shape);
                merged.exitX = 0;
                merged.exitZ = -1;
            }
            return merged;
        };

        /**
         * 条带 / 圆环共同的基础姿态 = beltFrame · [S(1,1,s)] · T(0, lift + slope/2 + extra, 0)
         *
         * 直段按世界距离缩放（BELT_LEN 烘进几何，实例矩阵补差）；
         * 转角 / 圆点不缩放（弧几何固定为 BELT_LEN）。
         *
         * **垂直段的抬升已经烘进帧位置**（沿世界法线，见 `beltFrame`），这里不能再沿
         * 局部 +y 抬一次 —— 垂直段的局部 +y 是水平的板面朝向，抬了就横着飞出去。
         */
        const poseOf = (b: BlueprintBuilding, shape: BeltShape, extra = 0) => {
            beltFrame(b, shape, trans);
            const s = scaleOf(b, shape);
            if (s !== 1) trans.multiply(temp.makeScale(1, 1, s));
            if (shape.kind === "riser") return trans;
            return trans.multiply(
                temp.makeTranslation(
                    0,
                    BELT_LIFT + slopeOf(b, shape) / 2 + extra,
                    0
                )
            );
        };

        // 货物：**必须从 base 重新 copy**（不能复用 trans，否则继承抬升，方案 §6.6-S3）；
        // 直段同样按 s 缩放，行程改为世界距离（弧段的 R = distance/2 必须等于 BELT_LEN/2）
        const addCellCargo = (b: BlueprintBuilding, shape: BeltShape) => {
            beltFrame(b, shape, cargoTrans);
            // 与条带**同源同值**的弧参数（含两点连线兜底改写过的坡度），否则货物会走出条带
            const arc = arcParamsOf(b, shape);
            if (shape.kind === "riser") {
                // 垂直段：货物贴在**板的外侧**（局部 +y 是水平的板面法线），从下端滑到上端。
                // 偏移与行程都用**世界单位** —— 板长本身就是 |rise|，实例矩阵这里不乘 S，
                // 所以不会像条带那样被缩放两次（条带那条路的 s 恒 ≈ 1，误差看不见）。
                const rise = Math.abs(shape.rise);
                cargoTrans.multiply(
                    temp.makeTranslation(0, RISER_CARGO_SIDE, rise / 2)
                );
                addCargo(cargoTrans, CARGO_COLOR, rise, arc, CARGO_FADE);
                return;
            }
            const s = scaleOf(b, shape);
            if (s !== 1) cargoTrans.multiply(temp.makeScale(1, 1, s));
            cargoTrans.multiply(
                temp.makeTranslation(0, CARGO_LIFT, BELT_LEN / 2)
            );
            // 线尾格（前端是端帽）的货物滑到端帽尖点就缩没：行程少 `BELT_CAP_TIP_INSET`
            const len = BELT_LEN * s;
            const feed = riserFeed.get(b.index);
            let distance: number;
            if (feed !== undefined) {
                // 来料 → 上升格：货一路滑到**贴着板面**为止（板半厚 + 半个货，不插进板里）。
                // 行程在几何空间，实例矩阵还要乘 s，所以按世界量换算回去。
                distance =
                    BELT_LEN / 2 +
                    (feed - BELT_HEIGHT / 2 - CARGO_SIZE / 2) / s;
            } else {
                distance = shape.capFront ? len - BELT_CAP_TIP_INSET : len;
            }
            addCargo(cargoTrans, CARGO_COLOR, distance, arc, CARGO_FADE);
        };

        const beltMaterial = new BeltMaterial();
        /** 供帧循环写 `cargoMove` 的 mesh：条带与圆环共用材质，返回任意一个即可 */
        let beltMesh: BeltMesh | null = null;

        /** 端帽实例：姿态在这里拼好，独立 InstancedMesh 承载（见 beltCaps.ts） */
        const capEntries: { matrix: Matrix4; color: Color }[] = [];
        const capTrans = new Matrix4();
        const shear = new Matrix4();

        // ── ① 直段条带（含垂直段：同一份几何，姿态不同）──
        if (strips.length) {
            const mesh = new Belts(strips.length, beltMaterial);
            // 顶点是被着色器**弯折**的，几何包围球只覆盖"未弯折的方条"（半径约 0.79），
            // 弯折后实际范围到 1.1 —— 按包围球做视锥剔除会让贴边的条带整段消失。
            mesh.frustumCulled = false;
            for (let i = 0; i < strips.length; i++) {
                const b = strips[i];
                const shape = shapeOf(b);
                if (shape === undefined) continue;
                // 有效坡度（两点连线兜底的格改用世界弦的高度差）
                const slope = slopeOf(b, shape);
                const s = scaleOf(b, shape);
                /**
                 * 垂直段：不加端帽、不内收端面。
                 *
                 * 端帽的几何预算是按「水平条带 + 局部 +y 抬升」做的，套到竖起来的板上会
                 * 横着跑；而且垂直段的两端本来就被上下层条带盖住，**没有可见的开放端**。
                 */
                const isRiser = shape.kind === "riser";

                mesh.setMatrixAt(i, poseOf(b, shape));
                mesh.setColorAt(i, colorOf(b.modelIndex));
                mesh.setArcAt(i, arcParamsOf(b, shape));
                // 端头内收（几何空间，会被 S 放大 → 除以 s 补偿）
                mesh.setEndsAt(
                    i,
                    !isRiser && shape.capBack ? -BELT_CAP_SHORTEN / s : 0,
                    !isRiser && shape.capFront ? -BELT_CAP_SHORTEN / s : 0
                );
                modelRef[b.index] = { matrix: transforms[b.index][0] };

                addCellCargo(b, shape);

                if (isRiser) continue;

                // 端帽：乘序 beltFrame·S·shear·Tlift·Tdiameter·Rflip
                // shear 作用在**几何空间**（S 之前的局部 z），系数必须仍是 -slope/BELT_LEN
                for (const front of [false, true]) {
                    if (front ? !shape.capFront : !shape.capBack) continue;
                    beltFrame(b, shape, capTrans);
                    if (s !== 1) capTrans.multiply(temp.makeScale(1, 1, s));
                    capTrans.multiply(
                        shear.makeShear(0, 0, 0, 0, 0, -slope / BELT_LEN)
                    );
                    capTrans.multiply(
                        temp.makeTranslation(
                            0,
                            BELT_LIFT + slope / 2 + BELT_CAP_LIFT,
                            0
                        )
                    );
                    capTrans.multiply(
                        temp.makeTranslation(
                            0,
                            0,
                            front ? -BELT_CAP_DIAMETER : BELT_CAP_DIAMETER
                        )
                    );
                    if (front) capTrans.multiply(temp.makeRotationY(Math.PI));
                    capEntries.push({
                        matrix: capTrans.clone(),
                        color: colorOf(b.modelIndex),
                    });
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor !== null)
                mesh.instanceColor.needsUpdate = true;
            mesh.geometry.beltArc.needsUpdate = true;
            mesh.geometry.beltAux.needsUpdate = true;
            objects.push(mesh);
            beltMesh = mesh;
        }

        // ── ①b 圆环弯头：转角格（见 beltElbow.ts） ──
        if (corners.length) {
            const mesh = new BeltElbows(corners.length, beltMaterial);
            // 同上：圆环是被着色器弯出来的，未弯折棱柱的包围球（半径 ~1.0）远小于
            // 弯折后的真实范围（~2.0），必须关掉视锥剔除，否则转角会随机整块消失。
            mesh.frustumCulled = false;
            for (let i = 0; i < corners.length; i++) {
                const b = corners[i];
                const shape = shapeOf(b);
                if (shape === undefined) continue;
                mesh.setMatrixAt(i, poseOf(b, shape, BELT_ELBOW_LIFT));
                mesh.setColorAt(i, colorOf(b.modelIndex));
                // 弧参数与货物同源：`poseOf` 已写好 phi，这里取补偿后的弧（见 arcOf）
                mesh.setArcAt(i, arcOf(b, shape));
                // 邻格也是圆环的那一端不伸出：两个圆环的 stub 会互相穿插、顶面出重影
                const isElbow = (index: number | null) => {
                    const nb = index === null ? undefined : byIndex.get(index);
                    return nb !== undefined && shapeOf(nb)?.kind === "corner";
                };
                mesh.setEndsAt(
                    i,
                    isElbow(shape.inIndex) ? 0 : BELT_ELBOW_STUB,
                    isElbow(shape.outIndex) ? 0 : BELT_ELBOW_STUB
                );
                modelRef[b.index] = { matrix: transforms[b.index][0] };
                // 每格都有货物（含线尾格）
                addCellCargo(b, shape);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor !== null)
                mesh.instanceColor.needsUpdate = true;
            mesh.geometry.beltArc.needsUpdate = true;
            mesh.geometry.beltAux.needsUpdate = true;
            mesh.geometry.beltEnds.needsUpdate = true;
            objects.push(mesh);
            if (beltMesh === null) beltMesh = mesh;
        }

        // ── ①c 端帽：独立 InstancedMesh（半圆盘），数量 = 开放端数 ──
        if (capEntries.length) {
            const caps = new BeltCaps(capEntries.length);
            for (let i = 0; i < capEntries.length; i++) {
                caps.setMatrixAt(i, capEntries[i].matrix);
                caps.setColorAt(i, capEntries[i].color);
            }
            caps.instanceMatrix.needsUpdate = true;
            if (caps.instanceColor !== null)
                caps.instanceColor.needsUpdate = true;
            caps.computeBoundingSphere();
            objects.push(caps);
        }

        // ── ② 圆点：真正孤立的格（既无前驱也无后继）──
        // 有连接但只有一端的格现在是「直段 + 端帽」（①），不再是圆点
        if (isolated.length) {
            const thickness = 0.1;
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 8);
            const material = new MeshLambertMaterial();
            const dots = new InstancedMesh(geometry, material, isolated.length);
            dots.name = "beltDots";
            // 乘序不可换（方案 §6.6-S10）：先 Rx(π/2) 把圆柱轴放平，再沿 +z 抬半个厚度贴地
            const offset = new Matrix4().makeRotationX(Math.PI / 2);
            offset.premultiply(
                new Matrix4().makeTranslation(0, 0, thickness / 2)
            );
            const trans = new Matrix4();
            for (let i = 0; i < isolated.length; i++) {
                const b = isolated[i];
                const base = transforms[b.index][0];
                trans.copy(base).multiply(offset);
                dots.setMatrixAt(i, trans);
                dots.setColorAt(i, colorOf(b.modelIndex));
                modelRef[b.index] = { matrix: base };
            }
            dots.instanceMatrix.needsUpdate = true;
            if (dots.instanceColor !== null)
                dots.instanceColor.needsUpdate = true;
            objects.push(dots);
        }

        return { objects, beltMesh };
    };

    /**
     * 分拣器：横梁在上、货物在下，两者垂直分离（方案 §6.4）。
     *
     * 姿态仍由 `inserterTrans` 决定（**不改它**，拾取盒 `buildBVH` 与它共用几何，方案 §3.3）：
     *   - 货物：基础姿态**先 `copy` 再下移** `CARGO_DROP`（必须在 `trans` 被 multiply 之前，
     *     否则货物会被缩放/偏移污染，方案 §6.6-S3）；
     *   - 横梁：同一基础姿态再抬高 `BEAM_EXTRA_LIFT`、按 `len` 缩放并前推半个梁长。
     *
     * 横梁几何本身由 `Inserters` 提供（v3.1：宽度翻倍 + 半透明 + 顶面箭头），
     * 这里只负责写实例矩阵与元数据色；臂长仍由实例 `scale(1,1,len)` 表达，
     * 着色器从 `instanceMatrix[2]` 反推，因此逐实例臂长不同也能保持箭头密度一致。
     *
     * 垂直预算（局部法线方向，`INSERTER_HEIGHT = 0.3`）：
     *   横梁 [0.37, 0.43]、货物 [0.05, 0.35] → 间隙 0.02（方案 §6.4 / §9.1-D-1），
     *   半透明横梁下仍能透过梁体看到货物（v3.1 G13）。
     *
     * 边界：`modelRef` 仍指向横梁 mesh（其矩阵多了 +0.1 抬升），`SpitterInfo` 的投影位置
     * 同步偏移 0.1，视觉一致、不影响拾取。
     */
    const buildInserters = (inserters: BlueprintBuilding[]) => {
        /** 横梁在 `INSERTER_HEIGHT` 之上再抬高（方案 §10.2-Q7 默认值） */
        const BEAM_EXTRA_LIFT = 0.1;
        /** 货物相对基础姿态下移（方案 §10.2-Q7 默认值） */
        const CARGO_DROP = 0.1;

        const mesh = new Inserters(inserters.length);
        const offset = new Matrix4().makeTranslation(0, 0, -0.5);
        const temp = new Matrix4();
        const trans = new Matrix4();
        const cargoTrans = new Matrix4();
        for (let i = 0; i < inserters.length; i++) {
            const b = inserters[i];

            const len = inserterTrans(transforms[b.index], trans);

            // ① 货物：基础姿态下移；颜色与分拣器横梁（元数据色）区分开
            cargoTrans.copy(trans);
            cargoTrans.multiply(temp.makeTranslation(0, -CARGO_DROP, 0));
            addCargo(cargoTrans, CARGO_COLOR, len);

            // ② 横梁：基础姿态抬高 + 缩放 + 前推半梁长
            trans.multiply(temp.makeTranslation(0, BEAM_EXTRA_LIFT, 0));
            trans.multiply(temp.makeScale(1, 1, len));
            trans.multiply(offset);

            mesh.setMatrixAt(i, trans);
            mesh.setColorAt(i, colorOf(b.modelIndex));
            modelRef[b.index] = { mesh, instance: i };
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
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
        /** 条带的圆弧形状；省略 = 直段平地（分拣器走这里） */
        shape?: CargoArcShape,
        /** 端点淡出宽度；省略 = 不淡出（分拣器的货物整块出现/消失） */
        fade = 0
    ) => {
        cargosMesh.setMatrixAt(numCargos, trans);
        cargosMesh.setColorAt(numCargos, color);
        cargosMesh.setCargoDistanceAt(numCargos, distance);
        cargosMesh.setCargoShapeAt(numCargos, shape ?? null);
        cargosMesh.setCargoFadeAt(numCargos, fade);
        numCargos++;
    };

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

    const iconBuildings = boxes.filter((b) => !noIconBuildings.has(b.itemId));
    const iconBelts = belts.filter(
        (b) => b.parameters && (b.parameters as BeltParameters).iconId > 0
    );
    const iconInserters = inserters.filter((b) => b.filterId > 0);

    const meshes: Object3D[] = [];
    const built = buildBoxes(boxes);

    /** 条带 / 圆环 mesh 引用（只给帧循环写 `cargoMove`）；没有带子时为 null */
    let beltMesh: BeltMesh | null = null;
    if (belts.length) {
        const builtBelts = buildBelts(belts);
        meshes.push(...builtBelts.objects);
        beltMesh = builtBelts.beltMesh;
    }

    /** 横梁 mesh 引用（只给帧循环写 `cargoMove`）；没有分拣器时为 null */
    let inserterMesh: Inserters | null = null;
    if (inserters.length) {
        inserterMesh = buildInserters(inserters);
        meshes.push(inserterMesh);
    }

    if (numCargos) {
        cargosMesh.count = numCargos;
        cargosMesh.instanceMatrix.needsUpdate = true;
        if (cargosMesh.instanceColor !== null)
            cargosMesh.instanceColor.needsUpdate = true;
        // 每实例滑动距离 / 形状参数只在构建收尾标脏一次（方案 §6.5）
        cargosMesh.geometry.cargoDistance.needsUpdate = true;
        cargosMesh.geometry.cargoSlope.needsUpdate = true;
        cargosMesh.geometry.cargoArc.needsUpdate = true;
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
        iconBuilt.subscriptMap,
        // 条带 mesh（可能是 null）；帧循环据此写 cargoMove 让箭头滚动
        beltMesh,
        // 横梁 mesh（可能是 null）；帧循环据此写 cargoMove 让箭头滚动
        inserterMesh
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
