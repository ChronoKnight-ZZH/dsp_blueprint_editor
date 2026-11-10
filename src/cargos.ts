import {
    BoxGeometry,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshLambertMaterial,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from "three";

/**
 * 货物立方体的边长（世界单位）。
 *
 * 单点定义：`CargoGeometry` 用它构造几何，`belt.ts` 用它推导货物抬升高度
 * （`CARGO_LIFT` 需要立方体半高），两者必须一致，否则货物会压到条带上。
 */
export const CARGO_SIZE = 0.3;

/**
 * 货物颜色：高亮度暖色（浅米白）。
 *
 * 与三种带子元数据色（`0xe3a263` 橙 / `0x51a896` 青 / `0x61a5d7` 蓝）的明度差
 * 均 ≥ 0.2（方案 §10.2-Q5 / §9.1-E-1），因此货物与条带、横梁可以一眼区分。
 * 使用 Color 实例常量，避免在逐实例循环里反复 new（方案 §6.6-S8）。
 */
export const CARGO_COLOR = new Color(0xf5e6c8);

class CargoGeometry extends BoxGeometry {
    cargoDistance: InstancedBufferAttribute;
    /** 逐实例 `(bend, slope)`，与条带的 `aBeltCurve` 同源同值 */
    cargoCurve: InstancedBufferAttribute;
    constructor(count: number) {
        super(CARGO_SIZE, CARGO_SIZE, CARGO_SIZE);
        this.cargoDistance = new InstancedBufferAttribute(
            new Float32Array(count),
            1
        );
        this.setAttribute("cargoDistance", this.cargoDistance);
        this.cargoCurve = new InstancedBufferAttribute(
            new Float32Array(count * 2),
            2
        );
        this.setAttribute("aCargoCurve", this.cargoCurve);
    }
}

class CargoMaterial extends MeshLambertMaterial {
    cargoMoveUniform = { value: 0 };

    // this overrides base class method
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBeforeCompile(
        parameters: WebGLProgramParametersWithUniforms,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        renderer: WebGLRenderer
    ) {
        parameters.vertexShader = parameters.vertexShader
            .replace(
                "#include <common>",
                `attribute float cargoDistance;
attribute vec2 aCargoCurve;   // x = bend（0 / ±π/2），y = slope（世界单位）
uniform float cargoMove;

#include <common>`
            )
            .replace(
                "#include <skinning_vertex>",
                `#include <skinning_vertex>
float bend = aCargoCurve.x;
float slope = aCargoCurve.y;

// 直段滑动（转角分支里会重写 transformed.z，这里只是先算好坡度用的 z）
transformed.z -= cargoMove * cargoDistance;

// 坡度：对 transformed.z 做剪切，同时给出「中心抬升 m·slope」与「沿坡面的倾斜」，
// 使立方体底面与条带顶面严格平行（用 position.z 只会平移不倾斜 → 一角插进条带）
transformed.y -= (transformed.z / cargoDistance) * slope;

// 直段保护：bend = 0 时到此为止（§3.6「货物」表）
if (abs(bend) > 1e-4) {
    // 转角：货物**不能逐顶点弯折**（立方体跨 27° 会扭歪），改为
    // 「中心沿圆弧平移 + 整块绕 y 刚性旋转」（GL12 / S14）
    float len = cargoDistance;            // 条带货物 = 段长；分拣器 bend = 0 不进这里
    float h = -sign(bend);
    float ang = h * (PI * 0.5) * cargoMove;
    float ca = cos(ang);
    float sa = sin(ang);
    float c0 = -h * 0.7071067811865476;
    float s0 = 0.7071067811865476;
    float dx = c0 * ca - s0 * sa;         // 圆弧径向（后缘 = 0）
    float dz = c0 * sa + s0 * ca;

    float beta = h * (PI * 0.5) * (cargoMove - 0.5);   // 立方体随弧线转向
    float cb = cos(beta);
    float sb = sin(beta);

    // 先存再写：边写边读 transformed 会读到已改写的值（S14）
    float lx = position.x;
    float lz = position.z;
    transformed.x = h * len * 0.7071067811865476 + len * 0.5 * dx + lx * cb - lz * sb;
    transformed.z = len * 0.5 * dz - len * 0.5 + lx * sb + lz * cb;
}
`
            );
        parameters.uniforms.cargoMove = this.cargoMoveUniform;
    }
}

export class Cargos extends InstancedMesh {
    declare geometry: CargoGeometry;
    declare material: CargoMaterial;
    constructor(count: number) {
        super(new CargoGeometry(count), new CargoMaterial(), count);
    }

    setCargoDistanceAt(i: number, d: number) {
        (this.geometry.cargoDistance.array as Float32Array)[i] = d;
    }

    /** 写第 i 个货物的形状参数；与条带用同一组 `(bend, slope)`，不调用则默认直段平地 */
    setCargoCurveAt(i: number, bend: number, slope: number) {
        const a = this.geometry.cargoCurve.array as Float32Array;
        a[i * 2] = bend;
        a[i * 2 + 1] = slope;
    }

    public get cargoMove() {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v) {
        this.material.cargoMoveUniform.value = v;
    }
}
