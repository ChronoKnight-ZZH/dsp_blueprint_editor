import { Box3, BoxGeometry, Matrix4, Ray, Vector3 } from "three";

interface BVHNode {
    children: BVHNode[];
    idx: Int32Array;
    bounding: Box3;
}

interface BVHOptions {
    maxDepth?: number;
    leafBoxes?: number;
}

const unitBox = new Box3(
    new Vector3(-0.5, -0.5, -0.5),
    new Vector3( 0.5,  0.5,  0.5),
)
const unitBoxTriangles = (function () {
    const geometry = new BoxGeometry(1., 1., 1.);
    const index = geometry.index!;
    const position = geometry.getAttribute('position');

    const tris: Vector3[][] = []
    for (let i = 0; i < index.count; i += 3) {
        const vs = new Array<Vector3>(3);
        for (let j = 0; j < 3; j++)
            vs[j] = new Vector3().fromBufferAttribute(position, index.getX(i + j))
        tris.push(vs);
    }
    return tris;
})()

function longestAxis(box: Box3) {
    let a: 'x' | 'y' | 'z' | null = null;
    let l = 0;
    for (const i of ['x', 'y', 'z'] as const) {
        const dist = box.max[i] - box.min[i];
        if (dist > l) {
            l = dist;
            a = i;
        }
    }
    return a;
}

function partition(arr: Int32Array, pred: (v: number) => boolean) {
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

interface IntersectionInfo {
    index: number;
    distanceSquared: number;
}

export class BVH {
    root
    constructor(public boxes: Matrix4[], { maxDepth = 32, leafBoxes = 1 }: BVHOptions = {}) {
        const v = new Vector3();

        const isFiniteBox = (b: Box3) =>
            Number.isFinite(b.min.x) && Number.isFinite(b.min.y) && Number.isFinite(b.min.z) &&
            Number.isFinite(b.max.x) && Number.isFinite(b.max.y) && Number.isFinite(b.max.z);

        const newNode = (idx: Int32Array): BVHNode => {
            const bounding = new Box3();
            for (const i of idx) {
                const b = boundings[i];
                // 跳过空盒或含 NaN 的盒（例如建筑引用了未定位的 area，导致变换矩阵含 NaN），
                // 避免单个坏盒污染整个节点的包围盒，进而触发 longestAxis 返回 null。
                if (b.isEmpty() || !isFiniteBox(b))
                    continue;
                bounding.union(b);
            }
            return { idx, bounding, children: [] };
        }

        const split = (node: BVHNode, depth = maxDepth) => {
            if (node.idx.length <= leafBoxes || depth == 0)
                return;
            const axis = longestAxis(node.bounding);
            // 包围盒退化（所有维度 ≤ 0，或全部为无效盒）时无法切分，
            // 直接将该节点作为叶子节点，由 raycast 遍历其中的盒。
            if (axis === null)
                return;

            let splitValue = 0.;
            let finiteCount = 0;
            const c = centers[axis];
            for (const i of node.idx) {
                if (Number.isFinite(c[i])) {
                    splitValue += c[i];
                    finiteCount++;
                }
            }
            // 若没有任何有限中心（全部为 NaN/空盒），无法切分，退化为叶子节点
            if (finiteCount === 0)
                return;
            splitValue /= finiteCount;

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
        }

        const idx = new Int32Array(boxes.length);
        for (let i = 0; i < idx.length; i++)
            idx[i] = i;

        const boundings = new Array<Box3>(boxes.length);
        const centers = {
            x: new Array<number>(boxes.length),
            y: new Array<number>(boxes.length),
            z: new Array<number>(boxes.length),
        }
        for (let i = 0; i < boxes.length; i++) {
            boundings[i] = new Box3().copy(unitBox).applyMatrix4(boxes[i]);
            v.setFromMatrixPosition(boxes[i]);
            centers.x[i] = v.x;
            centers.y[i] = v.y;
            centers.z[i] = v.z;
        }

        this.root = newNode(idx);
        split(this.root);
    }

    raycast(ray: Ray) {
        const intersects: IntersectionInfo[] = [];

        const v = new Vector3();
        const localRay = new Ray();
        const invertB = new Matrix4();

        const cast = (node: BVHNode) => {
            const intersect = ray.intersectBox(node.bounding, v);
            if (intersect === null)
                return;

            if (node.children.length) {
                for (const n of node.children)
                    cast(n);
            } else { // leaf
                for (const i of node.idx) {
                    const b = this.boxes[i];
                    invertB.copy(b).invert();
                    localRay.copy(ray).applyMatrix4(invertB);
                    for (const tri of unitBoxTriangles) {
                        const intersect = localRay.intersectTriangle(tri[0], tri[1], tri[2], true, v)
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
        }
        cast(this.root);
        intersects.sort((a, b) => a.distanceSquared - b.distanceSquared);
        return intersects;
    }
}

