"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cargos = void 0;
const three_1 = require("three");
class CargoGeometry extends three_1.BoxGeometry {
    cargoDistance;
    constructor(count) {
        super(0.3, 0.15, 0.4);
        this.cargoDistance = new three_1.InstancedBufferAttribute(new Float32Array(count), 1);
        this.setAttribute('cargoDistance', this.cargoDistance);
    }
}
class CargoMaterial extends three_1.MeshLambertMaterial {
    cargoMoveUniform = { value: 0. };
    // this overrides base class method
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBeforeCompile(parameters, renderer) {
        parameters.vertexShader = parameters.vertexShader
            .replace('#include <common>', `attribute float cargoDistance;
uniform float cargoMove;

#include <common>`)
            .replace('#include <skinning_vertex>', `#include <skinning_vertex>
transformed.z -= cargoMove * cargoDistance;
`);
        parameters.uniforms.cargoMove = this.cargoMoveUniform;
    }
}
class Cargos extends three_1.InstancedMesh {
    geometry;
    material;
    constructor(count) {
        const geometry = new CargoGeometry(count);
        const material = new CargoMaterial();
        super(geometry, material, count);
        this.geometry = geometry;
        this.material = material;
    }
    setCargoDistanceAt(i, d) {
        this.geometry.cargoDistance.array[i] = d;
    }
    get cargoMove() {
        return this.material.cargoMoveUniform.value;
    }
    set cargoMove(v) {
        this.material.cargoMoveUniform.value = v;
    }
}
exports.Cargos = Cargos;
//# sourceMappingURL=cargos.js.map