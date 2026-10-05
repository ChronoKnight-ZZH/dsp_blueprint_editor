import {
    BufferGeometry,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshLambertMaterial,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from "three";

/** 带 cargoDistance 实例属性的货物几何体 */
export interface CargoGeometry extends BufferGeometry {
    cargoDistance: InstancedBufferAttribute;
}

/**
 * 为几何体附加 cargoDistance 实例属性并返回类型化的 CargoGeometry。
 * @param geo      货物几何体（长度方向需沿局部 z 轴）
 * @param count    实例数量上限
 */
export function makeCargoGeometry(
    geo: BufferGeometry,
    count: number
): CargoGeometry {
    const cargoDistance = new InstancedBufferAttribute(
        new Float32Array(count),
        1
    );
    geo.setAttribute("cargoDistance", cargoDistance);
    return Object.assign(geo, { cargoDistance });
}

class CargoMaterial extends MeshLambertMaterial {
    cargoMoveUniform = { value: 0 };

    // this overrides base class method
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBeforeCompile(
        parameters: WebGLProgramParametersWithUniforms,
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
    geometry: CargoGeometry;
    material: CargoMaterial;

    constructor(geometry: CargoGeometry, count: number) {
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
