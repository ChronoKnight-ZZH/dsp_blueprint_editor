import { InstancedMesh, Matrix4, Quaternion, Vector3, BoxGeometry, MeshLambertMaterial, Color } from "three";
import { INSERTER_BEAM_WIDTH, INSERTER_FOOT_HEIGHT, INSERTER_BEAM_THICKNESS, INSERTER_SUPPORT_WIDTH, INSERTER_FOOT_WIDTH } from "./inserter";


/**
 * 分拣器门形支架。
 *
 * 每个门形支架由两根立柱、两个底座和一根顶部横梁组成。
 * 支架使用独立的 InstancedMesh，不参与横梁箭头动画。
 *
 * 端点位置由 buildInserters 提供，支架方向与分拣器臂轴一致。
 */
export class InserterSupports extends InstancedMesh {
    private readonly dummy = new Matrix4();
    /** 不能用 `rotation`：与 `Object3D.rotation`（Euler）冲突 */
    private readonly quat = new Quaternion();
    private readonly pos = new Vector3();
    private readonly axis = new Vector3();
    private readonly side = new Vector3();
    private readonly scl = new Vector3();

    private instanceCount = 0;

    constructor(count: number) {
        super(
            new BoxGeometry(1, 1, 1),
            new MeshLambertMaterial({
                color: 0xffffff,
            }),
            count * 10,
        );

        this.count = 0;
        this.frustumCulled = false;
    }

    /**
     * 在分拣器的一个端点添加门形支架。
     *
     * @param endpoint 支架顶部中心的世界坐标
     * @param direction 分拣器从 p0 指向 p1 的方向
     * @param color 分拣器颜色
     * @param groundY 支架底部所在的世界 Y 坐标
     */
    addSupport(
        endpoint: Vector3,
        direction: Vector3,
        color: Color,
        groundY: number,
    ): void {
        this.axis.copy(direction);
        this.axis.y = 0;

        if (this.axis.lengthSq() < 1e-8) {
            return;
        }

        this.axis.normalize();

        // 门形支架横跨分拣器臂轴。
        this.side.set(
            -this.axis.z,
            0,
            this.axis.x,
        ).normalize();

        const halfSpan = INSERTER_BEAM_WIDTH * 0.5;

        const footY = groundY + INSERTER_FOOT_HEIGHT * 0.5;
        const postBottomY = groundY + INSERTER_FOOT_HEIGHT;
        const postTopY = endpoint.y - INSERTER_BEAM_THICKNESS * 0.5;
        const postHeight = postTopY - postBottomY;

        if (postHeight <= 0) {
            return;
        }

        // 门形支架的两个立柱中心。
        for (const side of [-1, 1]) {
            this.pos.copy(endpoint);
            this.pos.addScaledVector(
                this.side,
                halfSpan * side,
            );

            this.pos.y = (postBottomY + postTopY) * 0.5;

            this.scl.set(
                INSERTER_SUPPORT_WIDTH,
                postHeight,
                INSERTER_SUPPORT_WIDTH,
            );

            this.dummy.compose(
                this.pos,
                this.quat,
                this.scl,
            );

            this.setMatrixAt(
                this.instanceCount,
                this.dummy,
            );
            this.setColorAt(
                this.instanceCount,
                color,
            );
            this.instanceCount++;

            // 立柱底部的底座。
            this.pos.y = footY;

            this.scl.set(
                INSERTER_FOOT_WIDTH,
                INSERTER_FOOT_HEIGHT,
                INSERTER_FOOT_WIDTH,
            );

            this.dummy.compose(
                this.pos,
                this.quat,
                this.scl,
            );

            this.setMatrixAt(
                this.instanceCount,
                this.dummy,
            );
            this.setColorAt(
                this.instanceCount,
                color,
            );
            this.instanceCount++;
        }

        // 顶部横梁：沿 side 方向跨过两根立柱。
        this.pos.copy(endpoint);
        this.pos.y -= INSERTER_BEAM_THICKNESS * 0.5;

        this.quat.setFromUnitVectors(
            new Vector3(1, 0, 0),
            this.side,
        );

        this.scl.set(
            INSERTER_BEAM_WIDTH,
            INSERTER_BEAM_THICKNESS,
            INSERTER_SUPPORT_WIDTH,
        );

        this.dummy.compose(
            this.pos,
            this.quat,
            this.scl,
        );

        this.setMatrixAt(
            this.instanceCount,
            this.dummy,
        );
        this.setColorAt(
            this.instanceCount,
            color,
        );
        this.instanceCount++;
    }

    update(): void {
        this.count = this.instanceCount;
        this.instanceMatrix.needsUpdate = true;

        if (this.instanceColor !== null) {
            this.instanceColor.needsUpdate = true;
        }
    }
}