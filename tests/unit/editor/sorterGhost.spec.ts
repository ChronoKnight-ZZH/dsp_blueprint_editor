import { InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from "three";
import {
    SorterGhost,
    SORTER_GHOST_INVALID_COLOR,
    SORTER_GHOST_VALID_COLOR,
} from "@/editor/sorterGhost";
import { INSERTER_ARM_END_EXTEND } from "@/Animation/inserter";
import { INSERTER_HEIGHT } from "@/lib/core/geometryHelpers";

/**
 * 分拣器实体幽灵预览的几何回归。
 *
 * 覆盖在无 WebGL 环境下可确定性验证的部分：
 * - 两端点 → 姿态/臂长换算与正式模型同源（横梁 z 轴缩放 = len + 两端外延）；
 * - 有效/无效切换材质颜色（蓝/红）；
 * - 退化姿态（两端重合）返回 false 并隐藏，调用方据此回退到连线提示；
 * - 复用实例：反复 setPose 不会累积支架实例（每次 10 个，2 端 × 5 件）。
 *
 * 边界：Jest 无 WebGL，不验证观感与帧率；透明叠序靠人工冒烟。
 */

const R = 200.2;

/** 球面上一点的建筑变换（原点即建筑中心；幽灵只读位置） */
function at(x: number, y: number, z: number): Matrix4 {
    return new Matrix4().makeTranslation(x, y, z);
}

function beamMesh(ghost: SorterGhost): InstancedMesh {
    return ghost.group.children[0] as InstancedMesh;
}

function frameMesh(ghost: SorterGhost): InstancedMesh {
    return ghost.group.children[1] as InstancedMesh;
}

function supportMesh(ghost: SorterGhost): InstancedMesh {
    return ghost.group.children[2] as InstancedMesh;
}

/** 幽灵三件套共用同一份材质；数组形态属于装配错误，直接抛 */
function ghostMaterial(ghost: SorterGhost): MeshBasicMaterial {
    const material = beamMesh(ghost).material;
    if (Array.isArray(material))
        throw new Error("SorterGhost 不应使用材质数组");
    return material as MeshBasicMaterial;
}

describe("SorterGhost", () => {
    test("setPose 摆出完整分拣器结构：横梁/侧框/两端门形支架", () => {
        const ghost = new SorterGhost();
        // 同一纬度相邻一格（沿球面切向 z 方向）：端点世界距离约 1
        const start = at(0, R, 0);
        const end = at(0, R, 1);

        expect(ghost.setPose(start, end, true)).toBe(true);
        expect(ghost.group.visible).toBe(true);
        expect(beamMesh(ghost).count).toBe(1);
        expect(frameMesh(ghost).count).toBe(2);
        expect(supportMesh(ghost).count).toBe(10);

        // 所有实例矩阵必须有限（NaN 会让幽灵整体消失）
        for (const mesh of [beamMesh(ghost), frameMesh(ghost), supportMesh(ghost)]) {
            const m = new Matrix4();
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, m);
                for (const e of m.elements) expect(Number.isFinite(e)).toBe(true);
            }
        }

        // 横梁 z 轴缩放 = 视觉臂长 = 抬升后的端点距 + 两端外延
        const beamM = new Matrix4();
        beamMesh(ghost).getMatrixAt(0, beamM);
        const armLen = new Vector3().setFromMatrixColumn(beamM, 2).length();
        // `inserterTrans` 先把两端沿球面法线抬高 INSERTER_HEIGHT 再量距离
        const lifted = (m: Matrix4) =>
            new Vector3()
                .setFromMatrixPosition(m)
                .normalize()
                .multiplyScalar(R + INSERTER_HEIGHT);
        const span = lifted(start).distanceTo(lifted(end));
        expect(armLen).toBeCloseTo(
            span + INSERTER_ARM_END_EXTEND * 2,
            4
        );

        ghost.dispose();
    });

    test("有效=蓝、无效=红，复用实例不累积支架", () => {
        const ghost = new SorterGhost();
        const start = at(0, R, 0);
        const end = at(0, R, 1);

        ghost.setPose(start, end, true);
        expect(ghostMaterial(ghost).color.getHex()).toBe(
            SORTER_GHOST_VALID_COLOR
        );

        // 第二次（无效）复用同一批实例
        ghost.setPose(start, end, false);
        expect(ghostMaterial(ghost).color.getHex()).toBe(
            SORTER_GHOST_INVALID_COLOR
        );
        expect(supportMesh(ghost).count).toBe(10);

        ghost.dispose();
    });

    test("两端重合：返回 false 并隐藏（调用方回退到连线提示）", () => {
        const ghost = new SorterGhost();
        const p = at(0, R, 0);

        expect(ghost.setPose(p, p, true)).toBe(false);
        expect(ghost.group.visible).toBe(false);
        expect(beamMesh(ghost).count).toBe(0);
        expect(frameMesh(ghost).count).toBe(0);
        expect(supportMesh(ghost).count).toBe(0);

        ghost.dispose();
    });
});