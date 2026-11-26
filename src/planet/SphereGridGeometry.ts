import { BufferGeometry } from "three";
import { Float32BufferAttribute } from "three";

/**
 * 球面网格几何体参数，语义与 three.js 的 SphereGeometry 一致。
 * phi 为经度方向（绕 y 轴），theta 为纬度方向（从北极向南极）。
 */
interface SphereGeometryParameters {
    radius: number; // 球半径
    widthSegments: number; // 经度方向分段数
    heightSegments: number; // 纬度方向分段数
    phiStart?: number; // 经度起始角，默认 0
    phiLength?: number; // 经度覆盖弧长，默认 2π（整圈）
    thetaStart?: number; // 纬度起始角，默认 0（北极）
    thetaLength?: number; // 纬度覆盖弧长，默认 π（直到南极）
}

/**
 * 球面网格几何体基类：只负责生成顶点，不生成三角面。
 * 子类各自通过这些顶点构建线段（索引成对出现），用于绘制经纬线。
 */
class SphereBaseGridGeometry extends BufferGeometry {
    type = "SphereBaseGridGeometry";
    constructor({
        radius,
        widthSegments,
        heightSegments,
        phiStart = 0,
        phiLength = Math.PI * 2,
        thetaStart = 0,
        thetaLength = Math.PI,
    }: SphereGeometryParameters) {
        super();

        const vertices = [];

        // 按 (纬度, 经度) 双层循环生成顶点网格，
        // 每行有 widthSegments + 1 个点（首尾经度重合，便于索引配对）
        for (let iy = 0; iy <= heightSegments; iy++) {
            const v = iy / heightSegments; // 纬度归一化参数 [0, 1]

            for (let ix = 0; ix <= widthSegments; ix++) {
                const u = ix / widthSegments; // 经度归一化参数 [0, 1]

                // 由球坐标转换到直角坐标系
                const x =
                    -radius *
                    Math.cos(phiStart + u * phiLength) *
                    Math.sin(thetaStart + v * thetaLength);
                const y = radius * Math.cos(thetaStart + v * thetaLength);
                const z =
                    radius *
                    Math.sin(phiStart + u * phiLength) *
                    Math.sin(thetaStart + v * thetaLength);

                vertices.push(x, y, z);
            }
        }

        this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    }
}

/**
 * 纬线网格几何体：只连接同一纬度行内相邻的两个顶点，形成一条条水平纬线。
 */
export class SphereLatitudeGridGeometry extends SphereBaseGridGeometry {
    type = "SphereLatitudeGridGeometry";
    constructor(params: SphereGeometryParameters) {
        super(params);
        const { widthSegments, heightSegments, thetaStart = 0 } = params;

        const indices = [];

        const w = widthSegments + 1; // 每行顶点数
        for (let iy = 0; iy < heightSegments; iy++) {
            for (let ix = 0; ix < widthSegments; ix++) {
                const a = iy * w + ix + 1; // 当前行右侧顶点
                const b = iy * w + ix; // 当前行左侧顶点

                // 最顶行在 thetaStart 为 0 时退化为一个极点，跳过该段以免产生零长度线段
                if (iy !== 0 || thetaStart > 0) indices.push(a, b);
            }
        }

        this.setIndex(indices);
    }
}

/**
 * 经线网格几何体：连接上下相邻行的同列顶点，形成一条条竖直经线。
 */
export class SphereLongitudeGridGeometry extends SphereBaseGridGeometry {
    type = "SphereLongitudeGridGeometry";
    constructor(params: SphereGeometryParameters) {
        super(params);
        const { widthSegments, heightSegments } = params;

        const indices = [];

        const w = widthSegments + 1; // 每行顶点数
        for (let iy = 0; iy < heightSegments; iy++) {
            for (let ix = 0; ix < widthSegments; ix++) {
                const b = iy * w + ix; // 当前行顶点
                const c = (iy + 1) * w + ix; // 下一行同列顶点

                indices.push(b, c); // 由两点组成一段经线
            }
        }

        this.setIndex(indices);
    }
}
