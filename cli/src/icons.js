"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Icons = exports.IconGeometry = exports.IconsMaterial = void 0;
const three_1 = require("three");
const iconTexture_1 = require("./iconTexture");
class IconsMaterial extends three_1.ShaderMaterial {
    sizeAttenuation = true;
    get map() { return this.uniforms.map.value; }
    set map(m) { this.uniforms.map.value = m; }
    get color() { return this.uniforms.diffuse.value; }
    set color(m) { this.uniforms.diffuse.value = m; }
    get iMapSize() { return this.uniforms.iMapSize.value; }
    set iMapSize(m) { this.uniforms.iMapSize.value = m; }
    constructor(map) {
        super({
            uniforms: three_1.UniformsUtils.merge([
                three_1.UniformsLib.common,
                {
                    iMapSize: {
                        value: new three_1.Vector2(iconTexture_1.IconTexture.WIDTH, iconTexture_1.IconTexture.HEIGHT),
                    },
                },
            ]),
            vertexShader: `
attribute vec3 iconPos;
attribute vec2 iconScale;

attribute int iconId;
attribute vec2 offset;

uniform ivec2 iMapSize;

#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>
	ivec2 iPosition = ivec2(iconId % iMapSize.x, iconId / iMapSize.x);
	vMapUv = (vMapUv + vec2(iPosition)) / vec2(iMapSize);

	vec4 mvPosition = modelViewMatrix * vec4(iconPos, 1.0);

	vec2 scale = iconScale;
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif

	mvPosition.xy += position.xy * scale + offset;

	vec4 depthPosition = mvPosition;
	depthPosition.z += 5.;

	vec4 glDepthPosition = projectionMatrix * depthPosition;
	gl_Position = projectionMatrix * mvPosition;
	gl_Position /= gl_Position.w;
	gl_Position.z = glDepthPosition.z / glDepthPosition.w;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,
            fragmentShader: three_1.ShaderLib.sprite.fragmentShader,
        });
        this.map = map;
        this.depthTest = true;
        this.depthWrite = false;
        this.transparent = true;
        this.fog = true;
        this.defaultAttributeValues.iconScale = Float32Array.of(1.0, 1.0);
    }
}
exports.IconsMaterial = IconsMaterial;
function updateAttr(attr, index) {
    const count = attr.itemSize;
    let start = index * count;
    let end = start + count;
    if (attr.updateRange.count === -1) {
        attr.needsUpdate = true;
    }
    else {
        start = Math.min(start, attr.updateRange.offset);
        end = Math.max(end, attr.updateRange.offset + attr.updateRange.count);
    }
    attr.updateRange.offset = start;
    attr.updateRange.count = end - start;
}
function extendAttr(attr, newLength) {
    const newArr = new attr.array.constructor(newLength * attr.itemSize);
    newArr.set(attr.array);
    attr.array = newArr;
}
class IconGeometry extends three_1.InstancedBufferGeometry {
    constructor(length, hasScale = true) {
        super();
        this.instanceCount = 0;
        const float32Array = new Float32Array([
            -0.5, -0.5, 0, 0, 0,
            -0.5, 0.5, 0, 0, 1,
            0.5, -0.5, 0, 1, 0,
            0.5, 0.5, 0, 1, 1,
        ]);
        const interleavedBuffer = new three_1.InterleavedBuffer(float32Array, 5);
        this.setIndex([0, 2, 1, 1, 2, 3]);
        this.setAttribute('position', new three_1.InterleavedBufferAttribute(interleavedBuffer, 3, 0, false));
        this.setAttribute('uv', new three_1.InterleavedBufferAttribute(interleavedBuffer, 2, 3, false));
        this.setAttribute('iconId', new three_1.InstancedBufferAttribute(new Int32Array(length), 1));
        this.setAttribute('iconPos', new three_1.InstancedBufferAttribute(new Float32Array(length * 3), 3));
        if (hasScale) // TODO: workaround for iconSubscript
            this.setAttribute('iconScale', new three_1.InstancedBufferAttribute(new Float32Array(length * 2), 2));
    }
    indexMap = new Map();
    nextIndex = 0;
    reserve(length) {
        this.dispose();
        extendAttr(this.getAttribute('iconId'), length);
        extendAttr(this.getAttribute('iconPos'), length);
        extendAttr(this.getAttribute('iconScale'), length);
    }
    hasIcon(b) {
        return this.indexMap.has(b);
    }
    addIcon(b, iconId, pos, scale, update = false) {
        const index = this.nextIndex++;
        if (index >= this.getAttribute('iconId').count) {
            this.reserve(Math.ceil(index * 1.5));
        }
        this.indexMap.set(b, index);
        const idAttr = this.getAttribute('iconId');
        const posAttr = this.getAttribute('iconPos');
        const scaleAttr = this.getAttribute('iconScale');
        idAttr.array[index] = iconId;
        pos.toArray(posAttr.array, index * 3);
        scale.toArray(scaleAttr.array, index * 2);
        if (update) {
            updateAttr(idAttr, index);
            updateAttr(posAttr, index);
            updateAttr(scaleAttr, index);
        }
        this.instanceCount = index + 1;
    }
    updateIconId(b, iconId) {
        const index = this.indexMap.get(b);
        if (index === undefined)
            throw new Error('No icon to update');
        const idAttr = this.getAttribute('iconId');
        idAttr.array[index] = iconId;
        updateAttr(idAttr, index);
    }
}
exports.IconGeometry = IconGeometry;
class Icons extends three_1.Mesh {
    constructor(map, geometry) {
        const material = new IconsMaterial(map);
        super(geometry, material);
    }
}
exports.Icons = Icons;
//# sourceMappingURL=icons.js.map