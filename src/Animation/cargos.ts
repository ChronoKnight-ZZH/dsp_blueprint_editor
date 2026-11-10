import {
    BoxGeometry,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshLambertMaterial,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from "three";
import type { BeltArcParams } from "./belt";

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

/** 货物需要的圆弧子集（不含支线贴边的外延信息） */
export type CargoArcShape = Pick<
    BeltArcParams,
    "theta0" | "theta1" | "centerX" | "centerZ" | "slope"
>;

class CargoGeometry extends BoxGeometry {
    /** 逐实例滑动距离（条带 = 段长，分拣器 = 臂长） */
    cargoDistance: InstancedBufferAttribute;
    /** 逐实例坡度（世界单位）；直段平地为 0 */
    cargoSlope: InstancedBufferAttribute;
    /**
     * 逐实例圆弧参数 `(theta0, theta1, cx, cz)`，与条带的 `aBeltArc` **同源同值**。
     *
     * 分拣器不弯折 → 全 0（`sweep = 0` 直接跳过转角分支）。
     */
    cargoArc: InstancedBufferAttribute;

    constructor(count: number) {
        super(CARGO_SIZE, CARGO_SIZE, CARGO_SIZE);
        this.cargoDistance = new InstancedBufferAttribute(
            new Float32Array(count),
            1
        );
        this.setAttribute("cargoDistance", this.cargoDistance);
        this.cargoSlope = new InstancedBufferAttribute(
            new Float32Array(count),
            1
        );
        this.setAttribute("aCargoSlope", this.cargoSlope);
        this.cargoArc = new InstancedBufferAttribute(
            new Float32Array(count * 4),
            4
        );
        this.setAttribute("aCargoArc", this.cargoArc);
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
attribute float aCargoSlope;
attribute vec4 aCargoArc;   // (theta0, theta1, cx, cz)：与条带同一份圆弧参数
uniform float cargoMove;

#include <common>`
            )
            .replace(
                "#include <skinning_vertex>",
                `#include <skinning_vertex>
// 直段滑动（转角分支里会重写 transformed.z，这里只是先算好坡度用的 z）
transformed.z -= cargoMove * cargoDistance;

// 坡度：对 transformed.z 做剪切，同时给出「中心抬升 m·slope」与「沿坡面的倾斜」，
// 使立方体底面与条带顶面严格平行（用 position.z 只会平移不倾斜 → 一角插进条带）
transformed.y -= (transformed.z / cargoDistance) * aCargoSlope;

// 转角：货物**不能逐顶点弯折**（立方体跨 27° 会扭歪），改为
// 「中心沿圆弧平移 + 整块绕 y 刚性旋转」（GL12 / S14）
float sweep = aCargoArc.y - aCargoArc.x;
if (abs(sweep) > 1e-4) {
    float R = cargoDistance * 0.5;              // 条带货物 = 段长，半径 = 半段长（网格转角唯一解）
    float th = aCargoArc.x + sweep * cargoMove; // 与条带顶点同一相位：u = cargoMove
    float beta = th - aCargoArc.x - sweep * 0.5; // 与 v3 的 h·(π/2)·(m − 0.5) 等价
    float cb = cos(beta);
    float sb = sin(beta);

    // 先存再写：边写边读 transformed 会读到已改写的值（S14）
    float lx = position.x;
    float lz = position.z;
    // 货物实例矩阵比条带多一个 +z 位移 R（见 buildBelts 的 cargoTrans），这里减回去
    transformed.x = aCargoArc.z + R * cos(th) + lx * cb - lz * sb;
    transformed.z = aCargoArc.w + R * sin(th) - R + lx * sb + lz * cb;
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

    /**
     * 写第 i 个货物的形状参数；必须与条带用**同一组** `BeltArcParams`，否则货物会走出条带。
     *
     * 省略 / 传 `null` 表示直段平地（分拣器走这里）。
     */
    setCargoShapeAt(i: number, arc: CargoArcShape | null) {
        const a = this.geometry.cargoArc.array as Float32Array;
        a[i * 4] = arc?.theta0 ?? 0;
        a[i * 4 + 1] = arc?.theta1 ?? 0;
        a[i * 4 + 2] = arc?.centerX ?? 0;
        a[i * 4 + 3] = arc?.centerZ ?? 0;
        (this.geometry.cargoSlope.array as Float32Array)[i] = arc?.slope ?? 0;
    }

    public get cargoMove() {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v) {
        this.material.cargoMoveUniform.value = v;
    }
}
