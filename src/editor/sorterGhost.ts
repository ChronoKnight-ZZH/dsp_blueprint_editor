import {
    BoxGeometry,
    Color,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Vector3,
} from "three";
import {
    INSERTER_ARM_END_EXTEND,
    INSERTER_ARM_END_INSET,
    INSERTER_BEAM_EXTRA_LIFT,
    INSERTER_BEAM_THICKNESS,
    INSERTER_BEAM_WIDTH,
    INSERTER_FRAME_HEIGHT,
    INSERTER_FRAME_WIDTH,
} from "@/Animation/inserter";
import { InserterSupports } from "@/Animation/InserterSupports";
import { INSERTER_HEIGHT, inserterTrans } from "@/lib/core/geometryHelpers";

/**
 * 分拣器实体幽灵预览。
 *
 * 职责：在「已选起点、鼠标悬停终点」阶段，用半透明分拣器模型显示**将建成的样子**：
 * - 蓝色 = `createSorterBetween` 预演成功（可建造）；
 * - 红色 = 预演失败（距离过远 / slot 占满 / 重复 / 重叠 / 跨纬度带 …）。
 *
 * 造型与正式模型同源：横梁、两侧侧框、两端门形支架的尺寸与偏移全部取自
 * `@/Animation/inserter` 的导出常量，布局步骤照抄 `buildInserters`
 * （`src/lib/core/buildBuildings.ts`）。只换材质为半透明纯色，不参与
 * `modelRef` / BVH / 货物动画——它只活在编辑器的预览层里。
 *
 * 使用：`BlueprintEditor.vue` 构造一个实例，鼠标移动时调 `setPose`；
 * 不可见时调 `hide`（保留实例，避免每次悬停都重新分配几何）。
 *
 * 边界：姿态矩阵（世界空间）由调用方用 `calcBuildingTrans` + `inserterTrans`
 * 的同款语义给出；本类不读蓝图数据、不做任何合法性判断。
 */

/** 可建造预览色（蓝）：与游戏内建造幽灵一致 */
export const SORTER_GHOST_VALID_COLOR = 0x2f7bff;

/** 不可建造预览色（红）：与槽位占用标记同色系 */
export const SORTER_GHOST_INVALID_COLOR = 0xff3b30;

/** 幽灵不透明度：能看穿到下方带面，又能看清横梁/支架轮廓 */
const SORTER_GHOST_OPACITY = 0.55;

/** 横梁侧框顶部相对梁顶再抬起的量（照抄 `buildInserters` 的 0.025） */
const FRAME_LIFT = 0.025;

export class SorterGhost {
    /** 挂进场景的根节点；内部三件套都在世界空间里写矩阵，根节点恒为单位阵 */
    readonly group = new Group();

    /**
     * 三个部件共用一个材质：切换有效/无效只需改一次颜色，
     * 也保证三者的透明度、深度写入行为完全一致。
     */
    private readonly material = new MeshBasicMaterial({
        transparent: true,
        opacity: SORTER_GHOST_OPACITY,
        depthWrite: false,
    });

    private readonly beam: InstancedMesh;
    private readonly frames: InstancedMesh;
    private readonly supports: InserterSupports;

    // ---- 复用临时对象，避免鼠标移动时每帧分配 ----
    private readonly pose = new Matrix4();
    private readonly temp = new Matrix4();
    /** 右侧乘数单独一份：`Matrix4.multiply` 的入参若与被乘对象是同一实例会被提前覆盖 */
    private readonly local = new Matrix4();
    private readonly scale = new Vector3();
    private readonly supportTop = new Vector3();
    private readonly supportAxis = new Vector3(0, 0, -1);
    /** 支架逐实例色保持白色，实际颜色由材质决定（instanceColor × material.color） */
    private readonly supportColor = new Color(0xffffff);

    constructor() {
        this.beam = new InstancedMesh(
            new BoxGeometry(
                INSERTER_BEAM_WIDTH,
                INSERTER_BEAM_THICKNESS,
                1.0
            ),
            this.material,
            1
        );
        // 几何/矩阵每帧变化，实例包围球不会自动更新 → 关闭视锥剔除，
        // 否则相机拉近后幽灵会整体消失（与其它预览层同样的处理）。
        this.beam.frustumCulled = false;
        this.beam.renderOrder = 9;
        this.beam.count = 0;

        this.frames = new InstancedMesh(
            new BoxGeometry(1, 1, 1),
            this.material,
            2
        );
        this.frames.frustumCulled = false;
        this.frames.renderOrder = 9;
        this.frames.count = 0;

        // `InserterSupports` 自带白色实体材质；替换成幽灵材质，
        // 支架的逐实例色（白）× 材质色 = 当前有效/无效色。
        this.supports = new InserterSupports(1);
        const supportMaterial = this.supports.material;
        this.supports.material = this.material;
        if (Array.isArray(supportMaterial)) {
            supportMaterial.forEach((m) => m.dispose());
        } else {
            supportMaterial.dispose();
        }
        this.supports.renderOrder = 9;

        this.group.add(this.beam, this.frames, this.supports);
        this.group.visible = false;
    }

    /**
     * 按两端点的世界矩阵摆出分拣器幽灵。
     *
     * @param start 起点（分拣器 `localOffset[0]`）的世界矩阵
     * @param end 终点（分拣器 `localOffset[1]`）的世界矩阵
     * @param valid 是否可建造（决定蓝/红）
     * @returns 是否成功显示；两端重合等退化情况返回 false（调用方据此回退到连线提示）
     */
    setPose(start: Matrix4, end: Matrix4, valid: boolean): boolean {
        // 与正式模型完全同一套姿态换算（抬升 + 沿两端连线定向）
        const len = inserterTrans([start, end], this.pose);
        if (!Number.isFinite(len) || len < 1e-4) {
            this.hide();
            return false;
        }

        this.material.color.setHex(
            valid ? SORTER_GHOST_VALID_COLOR : SORTER_GHOST_INVALID_COLOR
        );

        // 视觉长度比端点中心距多出两端延伸量（同 `buildInserters`）
        const armLen = len + INSERTER_ARM_END_EXTEND * 2;

        // ① 横梁：抬高 → 向起点外补 → 沿局部 z 拉伸臂长 → 平移半个单位
        this.temp.copy(this.pose);
        this.temp.multiply(
            this.local.makeTranslation(0, INSERTER_BEAM_EXTRA_LIFT, 0)
        );
        this.temp.multiply(
            this.local.makeTranslation(0, 0, INSERTER_ARM_END_EXTEND)
        );
        this.temp.multiply(this.local.makeScale(1, 1, armLen));
        this.temp.multiply(this.local.makeTranslation(0, 0, -0.5));
        this.beam.setMatrixAt(0, this.temp);
        this.beam.instanceMatrix.needsUpdate = true;
        this.beam.count = 1;

        // ② 横梁两侧深色轮廓：贴梁外沿，坐在梁顶面上
        const frameX =
            INSERTER_BEAM_WIDTH * 0.5 - INSERTER_FRAME_WIDTH * 0.5;
        const frameY =
            INSERTER_BEAM_EXTRA_LIFT +
            INSERTER_BEAM_THICKNESS * 0.5 +
            FRAME_LIFT;
        for (let side = 0; side < 2; side++) {
            this.temp.makeTranslation(
                side === 0 ? -frameX : frameX,
                frameY,
                -len * 0.5
            );
            this.temp.scale(
                this.scale.set(
                    INSERTER_FRAME_WIDTH,
                    INSERTER_FRAME_HEIGHT,
                    armLen
                )
            );
            this.temp.premultiply(this.pose);
            this.frames.setMatrixAt(side, this.temp);
        }
        this.frames.instanceMatrix.needsUpdate = true;
        this.frames.count = 2;

        // ③ 两端门形支架：先按局部空间写实例，再整体右乘分拣器姿态
        const supportTopY =
            INSERTER_BEAM_EXTRA_LIFT + INSERTER_BEAM_THICKNESS * 0.5;
        const groundY = -INSERTER_HEIGHT;
        const supportZ = [
            INSERTER_ARM_END_EXTEND - INSERTER_ARM_END_INSET,
            -(len + INSERTER_ARM_END_EXTEND - INSERTER_ARM_END_INSET),
        ];
        this.supports.reset();
        for (const z of supportZ) {
            this.supportTop.set(0, supportTopY, z);
            this.supports.addSupport(
                this.supportTop,
                this.supportAxis,
                this.supportColor,
                groundY
            );
        }
        this.supports.update();
        for (let k = 0; k < this.supports.count; k++) {
            this.supports.getMatrixAt(k, this.temp);
            this.temp.premultiply(this.pose);
            this.supports.setMatrixAt(k, this.temp);
        }
        this.supports.instanceMatrix.needsUpdate = true;

        this.group.visible = true;
        return true;
    }

    /** 隐藏幽灵（保留实例与几何，下一次 `setPose` 直接复用） */
    hide(): void {
        this.group.visible = false;
        this.beam.count = 0;
        this.frames.count = 0;
        this.supports.count = 0;
    }

    /** 释放本类独占的几何/材质；支架实例色等缓冲随对象被 GC */
    dispose(): void {
        this.beam.geometry.dispose();
        this.frames.geometry.dispose();
        this.supports.geometry.dispose();
        this.material.dispose();
    }
}