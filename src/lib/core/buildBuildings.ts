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
import { CARGO_COLOR, Cargos } from "@/Animation/cargos";
import {
    BELT_LEN,
    BELT_LIFT,
    BELT_SLOPE_EPS,
    CARGO_LIFT,
    Belts,
} from "@/Animation/belt";
import { Inserters } from "@/Animation/inserter";
import { HEIGHT_GRID_SIZE } from "@/planet/planetConstants";
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
     * 传送带：**有输出的格**画条带（每格一段），**孤立段**画圆点。
     *
     * 条带姿态 = `base × Rx(π/2) × T(0, BELT_LIFT + slope/2, 0)`，乘序不可换：
     *   - `base`（`transforms[i][0]`）**已经包含建筑 yaw**：`Ry(lon)·Rx(-lat)·Rz(-yaw)·T`，
     *     其局部 +y 轴就是本格流向（与方案 §3.4-F5 的 `dir=(sin yaw, cos yaw)` 一致）；
     *   - `Rx(π/2)` 把「建筑局部 +y＝流向」映射到「条带局部 -z＝流向」（货物着色器也向 -z 走）；
     *   - `T` 只负责抬升：`slope/2` 让后缘落在 `h_i`、前缘落在 `h_{i+1}`（§3.6）；
     *   - **没有缩放**：`BELT_LEN` 已烘进几何，非等比实例缩放会把圆弧压成椭圆（§3.6 / GL10）。
     *
     * 转角与坡度是逐实例形状参数 `(bend, slope)`，由 `shapeOf` 求出后写进 `aBeltCurve`，
     * 条带与货物共用同一组值，弯折/剪切都在顶点着色器完成（§3.6 / §6.5）。
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

        // ── ⓪ 形状参数：只对「输出是带子且正好一格」的格计算（§3.6 / S11） ──
        const byIndex = new Map(buildings.map((b) => [b.index, b]));
        const shapeOf = (b: BlueprintBuilding) => {
            const out = byIndex.get(b.outputObjIdx);
            if (!out || !isBelt(out.itemId)) return { bend: 0, slope: 0 };

            const o = b.localOffset[0];
            const p = out.localOffset[0];
            const dx = p.x - o.x;
            const dy = p.y - o.y;
            const oneGrid =
                (Math.abs(Math.abs(dx) - 1) < 1e-3 && Math.abs(dy) < 1e-3) ||
                (Math.abs(Math.abs(dy) - 1) < 1e-3 && Math.abs(dx) < 1e-3);
            if (!oneGrid) return { bend: 0, slope: 0 }; // 侧口 0.2 / 隔格 2.4 → 不猜

            const raw = (p.z - o.z) * HEIGHT_GRID_SIZE; // 世界单位
            const slope = Math.abs(raw) < BELT_SLOPE_EPS ? 0 : raw;

            // 自身 yaw 是入/出方向的角平分线（F7）：出格方向与之差 ±45° → 左右转，差 0 → 直段
            const yaw = (b.yaw[0] / 180) * Math.PI;
            const turn = Math.atan2(
                Math.sin(yaw) * dy - Math.cos(yaw) * dx,
                Math.sin(yaw) * dx + Math.cos(yaw) * dy
            );
            const bend =
                Math.abs(turn) > 0.1 ? Math.sign(turn) * (Math.PI / 2) : 0;
            return { bend, slope };
        };

        // ── ① 条带：只给有输出的格（每格一段） ──
        const withOutput = belts.filter((b) => b.outputObjIdx >= 0);
        let beltMesh: Belts | null = null;
        if (withOutput.length) {
            beltMesh = new Belts(withOutput.length);
            // Rx(π/2) 对所有带子相同，构造一次即可（yaw 已在 base 内）
            const rot = new Matrix4().makeRotationX(Math.PI / 2);
            const trans = new Matrix4();
            const cargoTrans = new Matrix4();
            const temp = new Matrix4();

            for (let i = 0; i < withOutput.length; i++) {
                const b = withOutput[i];
                const base = transforms[b.index][0];
                const { bend, slope } = shapeOf(b);

                // 无 scale：BELT_LEN 已烘进几何（否则圆弧被压成椭圆，§3.6）
                trans.copy(base).multiply(rot);
                trans.multiply(
                    temp.makeTranslation(0, BELT_LIFT + slope / 2, 0)
                );

                beltMesh.setMatrixAt(i, trans);
                // 条带取元数据色（方案 §9.1-E-3 / G5）：材质色保持默认白，避免二次相乘
                beltMesh.setColorAt(i, colorOf(b.modelIndex));
                // 逐实例形状参数：顶点着色器据此弯折 / 剪切
                beltMesh.setCurveAt(i, bend, slope);
                // modelRef 只能用 base：指向条带 mesh 会让 getBuildingModel 返回被拉伸的矩阵
                modelRef[b.index] = { matrix: base };

                // 货物：**必须从 base 重新 copy**（不能复用 trans，否则继承抬升，方案 §6.6-S3）；
                // +z 是本格后缘（逆流向），货物从后缘滑到前缘正好走过一格 = 一个周期。
                // 抬升不加 slope/2：坡度由货物着色器对 transformed.z 的剪切项补上（§3.6）。
                cargoTrans.copy(base).multiply(rot);
                cargoTrans.multiply(
                    temp.makeTranslation(0, CARGO_LIFT, BELT_LEN / 2)
                );
                addCargo(cargoTrans, CARGO_COLOR, BELT_LEN, bend, slope);
            }
            beltMesh.instanceMatrix.needsUpdate = true;
            if (beltMesh.instanceColor !== null)
                beltMesh.instanceColor.needsUpdate = true;
            beltMesh.geometry.beltCurve.needsUpdate = true;
            objects.push(beltMesh);
        }

        // ── ② 孤立段：沿用现有圆盘（无输出就没有可靠方向，方案 §6.3-P0-3） ──
        const isolated = belts.filter((b) => b.outputObjIdx < 0);
        if (isolated.length) {
            const thickness = 0.1;
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 8);
            const material = new MeshLambertMaterial();
            const dots = new InstancedMesh(geometry, material, isolated.length);
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
            if (dots.instanceColor !== null) dots.instanceColor.needsUpdate = true;
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
        bend = 0,
        slope = 0
    ) => {
        cargosMesh.setMatrixAt(numCargos, trans);
        cargosMesh.setColorAt(numCargos, color);
        cargosMesh.setCargoDistanceAt(numCargos, distance);
        cargosMesh.setCargoCurveAt(numCargos, bend, slope);
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

    /** 条带 mesh 引用（只给帧循环写 `cargoMove`）；没有条带时为 null */
    let beltMesh: Belts | null = null;
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
        cargosMesh.geometry.cargoCurve.needsUpdate = true;
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
