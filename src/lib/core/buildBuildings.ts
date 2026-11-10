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
import { CARGO_COLOR, CARGO_FADE, Cargos } from "@/Animation/cargos";
import type { CargoArcShape } from "@/Animation/cargos";
import {
    BELT_ELBOW_LIFT,
    BELT_ELBOW_STUB,
    BELT_LEN,
    BELT_LIFT,
    CARGO_LIFT,
    Belts,
    BeltMaterial,
} from "@/Animation/belt";
import type { BeltMesh } from "@/Animation/belt";
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
        const { shapes, issues } = computeBeltShapes(buildings);
        if (issues.length) console.warn(`[belt] ${issues.join("；")}`);
        const shapeOf = (b: BlueprintBuilding) => shapes.get(b.index);
        const byIndex = new Map(buildings.map((b) => [b.index, b]));
        // 三态 + 转角：直段走条带（方条），转角走圆环（倒圆棱柱）；两者共用一份材质
        const strips = belts.filter((b) => shapeOf(b)?.kind === "straight");
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

        /**
         * 本格的**渲染坐标系** = `base`，但把 yaw 换成由连线推导的朝向。
         *
         * `base = Ry(lon)·Rx(-lat)·Rz(-yaw数据)`，而 `base·Rz(yaw数据 − yaw连线)`
         * 正好等于 `Ry(lon)·Rx(-lat)·Rz(-yaw连线)` —— 即绕本格法线（局部 +z）转一个差值。
         * 这样即使蓝图里的 yaw 与连线不符（编辑器重排 / 侧口 / 手改），相邻格的端面
         * 仍然严格对齐；数据自洽时差值为 0，是**零改动**。
         */
        const frameOf = (
            b: BlueprintBuilding,
            shape: BeltShape,
            out: Matrix4
        ): Matrix4 => {
            const delta = ((b.yaw[0] - shape.yawDeg) / 180) * Math.PI;
            out.copy(transforms[b.index][0]);
            if (Math.abs(delta) > 1e-9) {
                out.multiply(frameFix.makeRotationZ(delta));
            }
            return out;
        };

        /**
         * 条带 / 圆环共同的基础姿态 = frame · Rx(π/2) · T(0, BELT_LIFT + slope/2 + extra, 0)
         *
         * `extra` 只有圆环用（`BELT_ELBOW_LIFT`）：转角厚度与直段一致后两者顶面共面，
         * 需要按厚度比例的极小抬升避免 z-fighting。
         */
        const poseOf = (b: BlueprintBuilding, shape: BeltShape, extra = 0) => {
            frameOf(b, shape, trans).multiply(rot);
            return trans.multiply(
                temp.makeTranslation(0, BELT_LIFT + shape.slope / 2 + extra, 0)
            );
        };

        // 货物：**必须从 base 重新 copy**（不能复用 trans，否则继承抬升，方案 §6.6-S3）；
        // +z 是本格后缘（逆流向），货物从后缘滑到前缘正好走过一格 = 一个周期。
        // 抬升不加 slope/2：坡度由货物着色器对 transformed.z 的剪切项补上（§3.6）。
        const addCellCargo = (b: BlueprintBuilding, shape: BeltShape) => {
            frameOf(b, shape, cargoTrans).multiply(rot);
            cargoTrans.multiply(
                temp.makeTranslation(0, CARGO_LIFT, BELT_LEN / 2)
            );
            // 线尾格（前端是端帽）的货物滑到端帽尖点就缩没：行程少 `BELT_CAP_TIP_INSET`，
            // 否则货物的终点仍在端帽尖点之外 5cm（条带端面已被端帽向内收掉）。
            // 起点不变（仍在本格后缘），与前一格的货物在接缝处照常一收一放。
            const distance = shape.capFront
                ? BELT_LEN - BELT_CAP_TIP_INSET
                : BELT_LEN;
            addCargo(cargoTrans, CARGO_COLOR, distance, shape, CARGO_FADE);
        };

        const beltMaterial = new BeltMaterial();
        /** 供帧循环写 `cargoMove` 的 mesh：条带与圆环共用材质，返回任意一个即可 */
        let beltMesh: BeltMesh | null = null;

        /** 端帽实例：姿态在这里拼好，独立 InstancedMesh 承载（见 beltCaps.ts） */
        const capEntries: { matrix: Matrix4; color: Color }[] = [];
        const capTrans = new Matrix4();
        const shear = new Matrix4();

        // ── ① 直段条带 ──
        if (strips.length) {
            const mesh = new Belts(strips.length, beltMaterial);
            // 顶点是被着色器**弯折**的，几何包围球只覆盖"未弯折的方条"（半径约 0.79），
            // 弯折后实际范围到 1.1 —— 按包围球做视锥剔除会让贴边的条带整段消失。
            mesh.frustumCulled = false;
            for (let i = 0; i < strips.length; i++) {
                const b = strips[i];
                const shape = shapeOf(b);
                if (shape === undefined) continue; // 不可达：strips 就是按 shapes 过滤出来的
                const { slope } = shape;

                // 无 scale：BELT_LEN 已烘进几何（否则圆弧被压成椭圆，§3.6）
                mesh.setMatrixAt(i, poseOf(b, shape));
                // 条带取元数据色（方案 §9.1-E-3 / G5）：材质色保持默认白，避免二次相乘
                mesh.setColorAt(i, colorOf(b.modelIndex));
                // 逐实例形状参数：CPU 算好的圆弧 + 坡度 + 贴边外延
                mesh.setArcAt(i, shape);
                // 端头内收：端帽压住的那一端把条带端面收进去（正=伸出 / 负=内收）
                mesh.setEndsAt(
                    i,
                    shape.capBack ? -BELT_CAP_SHORTEN : 0,
                    shape.capFront ? -BELT_CAP_SHORTEN : 0
                );
                // modelRef 只能用 base：指向条带 mesh 会让 getBuildingModel 返回被拉伸的矩阵
                modelRef[b.index] = { matrix: transforms[b.index][0] };

                // 每格都有货物：线尾格（无后继、前端是端帽）同样挂一件，
                // 否则最后一段永远看不到货物滑动（addCellCargo 会把行程收到端帽尖点）
                addCellCargo(b, shape);

                // 端帽：半圆的尖点落在格边界内侧 `BELT_CAP_TIP_INSET`，直径面压进条带
                // `BELT_CAP_OVERLAP`（终端因此比 v5 短了 R+inset，不再向格外鼓出）。
                // 乘序 base·Rx·S·Tlift·Tend·Rflip：Rflip 最先作用，S（坡度剪切）最后 ——
                // 这样端帽和条带顶面在坡道上也是同一张斜面。
                for (const front of [false, true]) {
                    if (front ? !shape.capFront : !shape.capBack) continue;
                    capTrans.copy(transforms[b.index][0]);
                    frameOf(b, shape, capTrans).multiply(rot);
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
                mesh.setArcAt(i, shape);
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
