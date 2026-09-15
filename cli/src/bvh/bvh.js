"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BVH = void 0;
const three_1 = require("three");
const unitBox = new three_1.Box3(new three_1.Vector3(-0.5, -0.5, -0.5), new three_1.Vector3(0.5, 0.5, 0.5));
const unitBoxTriangles = (function () {
    const geometry = new three_1.BoxGeometry(1., 1., 1.);
    const index = geometry.index;
    const position = geometry.getAttribute('position');
    const tris = [];
    for (let i = 0; i < index.count; i += 3) {
        const vs = new Array(3);
        for (let j = 0; j < 3; j++)
            vs[j] = new three_1.Vector3().fromBufferAttribute(position, index.getX(i + j));
        tris.push(vs);
    }
    return tris;
})();
function longestAxis(box) {
    let a = null;
    let l = 0;
    for (const i of ['x', 'y', 'z']) {
        const dist = box.max[i] - box.min[i];
        if (dist > l) {
            l = dist;
            a = i;
        }
    }
    return a;
}
function partition(arr, pred) {
    let first = 0;
    for (; first < arr.length; first++) {
        if (!pred(arr[first]))
            break;
    }
    for (let i = first + 1; i < arr.length; i++) {
        if (pred(arr[i])) {
            const tmp = arr[i];
            arr[i] = arr[first];
            arr[first] = tmp;
            first++;
        }
    }
    return first;
}
class BVH {
    boxes;
    root;
    constructor(boxes, { maxDepth = 32, leafBoxes = 1 } = {}) {
        this.boxes = boxes;
        const v = new three_1.Vector3();
        const newNode = (idx) => {
            const bounding = new three_1.Box3();
            for (const i of idx)
                bounding.union(boundings[i]);
            return { idx, bounding, children: [] };
        };
        const split = (node, depth = maxDepth) => {
            if (node.idx.length <= leafBoxes || depth == 0)
                return;
            const axis = longestAxis(node.bounding);
            if (axis === null)
                throw new Error('Unexpected empty box');
            let splitValue = 0.;
            const c = centers[axis];
            for (const i of node.idx) {
                splitValue += c[i];
            }
            splitValue /= node.idx.length;
            const splitPos = partition(node.idx, i => c[i] < splitValue);
            if (splitPos == 0 || splitPos == node.idx.length)
                return;
            node.children = [
                newNode(node.idx.subarray(0, splitPos)),
                newNode(node.idx.subarray(splitPos)),
            ];
            depth--;
            for (const n of node.children) {
                split(n, depth);
            }
        };
        const idx = new Int32Array(boxes.length);
        for (let i = 0; i < idx.length; i++)
            idx[i] = i;
        const boundings = new Array(boxes.length);
        const centers = {
            x: new Array(boxes.length),
            y: new Array(boxes.length),
            z: new Array(boxes.length),
        };
        for (let i = 0; i < boxes.length; i++) {
            boundings[i] = new three_1.Box3().copy(unitBox).applyMatrix4(boxes[i]);
            v.setFromMatrixPosition(boxes[i]);
            centers.x[i] = v.x;
            centers.y[i] = v.y;
            centers.z[i] = v.z;
        }
        this.root = newNode(idx);
        split(this.root);
    }
    raycast(ray) {
        const intersects = [];
        const v = new three_1.Vector3();
        const localRay = new three_1.Ray();
        const invertB = new three_1.Matrix4();
        const cast = (node) => {
            const intersect = ray.intersectBox(node.bounding, v);
            if (intersect === null)
                return;
            if (node.children.length) {
                for (const n of node.children)
                    cast(n);
            }
            else { // leaf
                for (const i of node.idx) {
                    const b = this.boxes[i];
                    invertB.copy(b).invert();
                    localRay.copy(ray).applyMatrix4(invertB);
                    for (const tri of unitBoxTriangles) {
                        const intersect = localRay.intersectTriangle(tri[0], tri[1], tri[2], true, v);
                        if (intersect !== null) {
                            v.applyMatrix4(b);
                            intersects.push({
                                index: i,
                                distanceSquared: ray.origin.distanceToSquared(v),
                            });
                            break;
                        }
                    }
                }
            }
        };
        cast(this.root);
        intersects.sort((a, b) => a.distanceSquared - b.distanceSquared);
        return intersects;
    }
}
exports.BVH = BVH;
//# sourceMappingURL=bvh.js.map