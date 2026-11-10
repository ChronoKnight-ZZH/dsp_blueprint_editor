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
    cargoDistance;
    constructor(count: number) {
        super(CARGO_SIZE, CARGO_SIZE, CARGO_SIZE);
        this.cargoDistance = new InstancedBufferAttribute(
            new Float32Array(count),
            1
        );
        this.setAttribute("cargoDistance", this.cargoDistance);
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
uniform float cargoMove;

#include <common>`
            )
            .replace(
                "#include <skinning_vertex>",
                `#include <skinning_vertex>
transformed.z -= cargoMove * cargoDistance;
`
            );
        parameters.uniforms.cargoMove = this.cargoMoveUniform;
    }
}

export class Cargos extends InstancedMesh {
    geometry;
    material;
    constructor(count: number) {
        const geometry = new CargoGeometry(count);
        const material = new CargoMaterial();
        super(geometry, material, count);
        this.geometry = geometry;
        this.material = material;
    }

    setCargoDistanceAt(i: number, d: number) {
        (this.geometry.cargoDistance.array as Float32Array)[i] = d;
    }

    public get cargoMove() {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v) {
        this.material.cargoMoveUniform.value = v;
    }
}
