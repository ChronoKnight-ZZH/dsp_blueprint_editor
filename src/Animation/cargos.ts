import {
    BoxGeometry,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
    Vector3,
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

/**
 * 条带货物的端点淡出宽度（`cargoMove` 单位，0..0.5）。
 *
 * 立方体在 `cargoMove ∈ [0, FADE]`（刚在端点"生成"）和 `[1−FADE, 1]`（到达端点"消失"）
 * 两段里缩到 0，因此货物**不会被画到条带端点之外**；相邻格子的货物会在接缝处一收一放，
 * 正好接上。0.06 ≈ 一格的 6%（默认约 7.5cm 行程），肉眼看是"在端点出现/消失"。
 */
export const CARGO_FADE = 0.06;

/**
 * 货物底面与承托面（条带顶面 / 分拣器横梁底面）之间的视觉间隙（世界单位）。
 *
 * 单点定义：`belt.ts` 的盒式条带抬升、`cargos.ts` 的 `CARGO_LIFT_ABOVE_SURFACE`
 * 都从这里推导，两种条带实现与分拣器的垂直预算因此不会各写一份。
 */
export const CARGO_GAP = 0.02;

/**
 * 货物中心相对「承托面顶面」的抬升（世界单位）= 立方体半高 + 视觉间隙。
 *
 * 承托面高度由调用方决定（ribbon 条带 = 挤出厚度，分拣器 = 横梁高度），
 * 这里只提供与货物自身尺寸相关的那一半，避免 `cargos.ts` 反向依赖条带几何。
 */
export const CARGO_LIFT_ABOVE_SURFACE = CARGO_SIZE / 2 + CARGO_GAP;

/**
 * 一个完整动画周期（毫秒）：一条传送带格 / 一根分拣器横梁走完一次。
 *
 * 相位由 `Cargos.tick()` 自持，条带与横梁的箭头复用同一个返回值，
 * 因此「箭头与货物同向同速」不依赖调用方各自乘一遍时间。
 */
export const CARGO_PERIOD_MS = 1000;

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

    /**
     * 逐实例两端淡入 / 淡出宽度 `(fadeIn, fadeOut)`（`cargoMove` 单位，0..0.5；0 = 该端不淡出）。
     *
     * **必须按端点给，不能两端同时给**：所有货物共用一个 `cargoMove`，若每段两端都缩到 0，
     * 整条线上的货物会每秒同时消失再长回来（闪烁）。条带只在「链条断掉」的端点淡出：
     * 线路起点（无入边）淡入、线路终点（无出边）淡出，中段两端都是 0 —— 相邻段的货物在
     * 节点处交接，本来就无缝。分拣器是单件抓放，两端都给 0.15。
     */
    cargoFade: InstancedBufferAttribute;

    /**
     * 逐实例垂直抬升（世界单位，沿货物局部 `+y` = 承托面法线）。
     *
     * 条带给「ribbon 顶面 + `CARGO_LIFT_ABOVE_SURFACE`」，分拣器给 0 —— 它的
     * 高度预算已经写进实例矩阵，不能再抬一次。
     *
     * 与段长 / 淡出 / 圆弧一样是**逐实例静态参数**：实例矩阵保持纯姿态，
     * 帧循环只改一个 uniform；转角分支只改 x/z，抬升在任何姿态下都沿承托面法线。
     */
    cargoLift: InstancedBufferAttribute;

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
        this.cargoFade = new InstancedBufferAttribute(
            new Float32Array(count * 2),
            2
        );
        this.setAttribute("aCargoFade", this.cargoFade);
        this.cargoLift = new InstancedBufferAttribute(
            new Float32Array(count),
            1
        );
        this.setAttribute("aCargoLift", this.cargoLift);
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
attribute vec2 aCargoFade;  // (fadeIn, fadeOut)：两端各自的淡出宽度，0 = 该端不淡出
attribute float aCargoLift; // 垂直抬升（沿局部 +y：条带贴承托面顶，分拣器 0）
uniform float cargoMove;

#include <common>`
            )
            .replace(
                "#include <skinning_vertex>",
                `#include <skinning_vertex>
// 端点「生成 / 消失」：只在**该端确实断链**时缩放（条带线路的起点淡入、终点淡出），
// 中段两端都是 0 → sizeScale 恒为 1，相邻段的货物在节点处交接，不会出现整场闪烁。
// 分拣器是单件抓放，两端都给 0.15。
float scaleIn = aCargoFade.x > 0.0
    ? smoothstep(0.0, aCargoFade.x, cargoMove)
    : 1.0;
float scaleOut = aCargoFade.y > 0.0
    ? 1.0 - smoothstep(1.0 - aCargoFade.y, 1.0, cargoMove)
    : 1.0;
float sizeScale = scaleIn * scaleOut;

// 直段滑动（转角分支里会重写 transformed.x/z，这里只是先算好坡度用的 z）
transformed.x = position.x * sizeScale;
transformed.y = position.y * sizeScale;
transformed.z = position.z * sizeScale - cargoMove * cargoDistance;

// 坡度：对 transformed.z 做剪切，同时给出「中心抬升 m·slope」与「沿坡面的倾斜」，
// 使立方体底面与条带顶面严格平行（用 position.z 只会平移不倾斜 → 一角插进条带）
transformed.y -= (transformed.z / cargoDistance) * aCargoSlope;

// 垂直抬升：把立方体托到承托面之上。转角分支只改 x/z，所以抬升在任何姿态下
// 都保持「沿承托面法线」，不会被绕开。
transformed.y += aCargoLift;

// 转角：货物**不能逐顶点弯折**（立方体跨 27° 会扭歪），改为
// 「中心沿圆弧平移 + 整块绕 y 刚性旋转」（GL12 / S14）
float sweep = aCargoArc.y - aCargoArc.x;
if (abs(sweep) > 1e-4) {
    float R = cargoDistance * 0.5;              // 条带货物 = 段长，半径 = 半段长（网格转角唯一解）
    float th = aCargoArc.x + sweep * cargoMove; // 与条带顶点同一相位：u = cargoMove
    float beta = th - aCargoArc.x - sweep * 0.5; // 与 v3 的 h·(π/2)·(m − 0.5) 等价
    float cb = cos(beta);
    float sb = sin(beta);

    // 先存再写：边写边读 transformed 会读到已改写的值（S14）；局部尺寸已乘 sizeScale
    float lx = position.x * sizeScale;
    float lz = position.z * sizeScale;
    // 货物实例矩阵比条带多一个 +z 位移 R（见 buildBelts 的 cargoTrans），这里减回去
    transformed.x = aCargoArc.z + R * cos(th) + lx * cb - lz * sb;
    transformed.z = aCargoArc.w + R * sin(th) - R + lx * sb + lz * cb;
}
`
            );
        parameters.uniforms.cargoMove = this.cargoMoveUniform;
    }
}

/** `lookAt` 缺少 up 时的兜底；条带调用方总会给带面法线 */
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * 一条货物轨迹：调用方只提供几何事实，姿态 / 参数由 `Cargos.addTrack` 落地。
 *
 * 二选一的姿态来源：
 *   - 条带：`start` + `end`（+ `up` = 带面法线，含 roll）；
 *   - 分拣器：`matrix`（横梁朝向与货物下移已在矩阵里）。
 */
export interface CargoTrack {
    /** 条带：段起点（世界坐标） */
    start?: Vector3;
    /** 条带：段终点（世界坐标） */
    end?: Vector3;
    /** 条带：`lookAt` 的 up = 带面法线；省略时退回世界 +Y */
    up?: Vector3;
    /** 分拣器：已算好的姿态矩阵，与 `start`/`end` 二选一 */
    matrix?: Matrix4;
    /** 滑行距离：条带 = 段长，分拣器 = 臂长 */
    distance: number;
    /** 逐实例颜色；省略 = `CARGO_COLOR`（统一米白） */
    color?: Color;
    /**
     * 起点淡入宽度（`cargoMove` 单位）；省略 = 0。
     *
     * 只有「线路起点」（该节点没有入边、没有前一段货物接班）才该给非 0。
     */
    fadeIn?: number;
    /**
     * 终点淡出宽度（`cargoMove` 单位）；省略 = 0。
     *
     * 只有「线路终点」（该节点没有出边、没有后一段货物接班）才该给非 0。
     */
    fadeOut?: number;
    /** 垂直抬升（沿承托面法线）；省略 = 0 */
    lift?: number;
    /** 圆弧 / 坡度，与条带同源；省略 = 直段平地 */
    arc?: CargoArcShape | null;
}

export class Cargos extends InstancedMesh {
    declare geometry: CargoGeometry;
    declare material: CargoMaterial;

    /** 构造时给的容量上限；`addTrack` 超出直接报错，避免静默丢货物 */
    private readonly capacity: number;

    /** 已写入的轨迹数（`finish()` 用它裁 `count`） */
    private trackCount = 0;

    /** `addTrack` 复用，避免逐轨迹 new */
    private readonly trackMatrix = new Matrix4();

    constructor(count: number) {
        super(new CargoGeometry(count), new CargoMaterial(), count);
        this.capacity = count;
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

    /**
     * 写第 i 个货物两端的淡入 / 淡出宽度（`cargoMove` 单位；0 = 该端不淡出）。
     *
     * 条带只在断链端点给值（线路起点 / 终点），中段两端都是 0；分拣器两端都给 0.15。
     */
    setCargoFadeAt(i: number, fadeIn: number, fadeOut: number) {
        const a = this.geometry.cargoFade.array as Float32Array;
        a[i * 2] = fadeIn;
        a[i * 2 + 1] = fadeOut;
    }

    /**
     * 写第 i 个货物的垂直抬升（沿承托面法线，世界单位；0 = 不抬升）。
     *
     * 条带给「承托面顶面 + `CARGO_LIFT_ABOVE_SURFACE`」，分拣器给 0。
     */
    setCargoLiftAt(i: number, lift: number) {
        (this.geometry.cargoLift.array as Float32Array)[i] = lift;
    }

    /**
     * 追加一条货物轨迹：**货物动画自己的入口**，调用方只给几何事实。
     *
     * - 条带：给 `start` / `end` / `up`，内部用 `lookAt` 求姿态（局部 -z 指向终点，
     *   与着色器的 `transformed.z -= cargoMove * distance` 一致）；
     * - 分拣器：给 `matrix`，姿态（横梁朝向、货物下移）由调用方算好，
     *   本方法只写逐实例参数。
     *
     * 其余参数都有默认值：颜色 = `CARGO_COLOR`、淡出 / 抬升 / 圆弧 = 0，
     * 因此「条带货物是米白色」这类视觉约定不再散落在建筑装配代码里。
     */
    addTrack(track: CargoTrack): void {
        if (this.trackCount >= this.capacity) {
            throw new Error(
                `Cargos 容量不足：capacity=${this.capacity}，` +
                    "容量必须按「可能产生货物的建筑数」预留"
            );
        }

        const i = this.trackCount;

        if (track.matrix !== undefined) {
            this.setMatrixAt(i, track.matrix);
        } else if (track.start !== undefined && track.end !== undefined) {
            // 先求朝向再补平移：Matrix4.lookAt 只写旋转部分，平移要单独落位
            const m = this.trackMatrix
                .identity()
                .lookAt(track.start, track.end, track.up ?? WORLD_UP);
            m.setPosition(track.start);
            this.setMatrixAt(i, m);
        } else {
            throw new Error(
                "addTrack 需要 matrix，或同时给 start + end（可选 up）"
            );
        }

        this.setColorAt(i, track.color ?? CARGO_COLOR);
        this.setCargoDistanceAt(i, track.distance);
        this.setCargoFadeAt(i, track.fadeIn ?? 0, track.fadeOut ?? 0);
        this.setCargoLiftAt(i, track.lift ?? 0);
        this.setCargoShapeAt(i, track.arc ?? null);

        this.trackCount += 1;
    }

    /**
     * 构建期收尾：裁到实际写入数，并标记所有逐实例属性需要上传。
     *
     * 没有货物时把 `count` 置 0（而不是保留容量），否则全零矩阵的实例会堆在原点。
     */
    finish(): void {
        this.count = this.trackCount;
        this.instanceMatrix.needsUpdate = true;
        if (this.instanceColor !== null) this.instanceColor.needsUpdate = true;
        this.geometry.cargoDistance.needsUpdate = true;
        this.geometry.cargoFade.needsUpdate = true;
        this.geometry.cargoLift.needsUpdate = true;
        this.geometry.cargoSlope.needsUpdate = true;
        this.geometry.cargoArc.needsUpdate = true;
    }

    /** 实际货物数量（`finish()` 之后的 `count` 同值，供 stats 使用） */
    public get cargoCount(): number {
        return this.trackCount;
    }

    /**
     * 推进相位并写 uniform，返回 0..1 的相位。
     *
     * 相位是**货物系统的单一来源**：条带 / 横梁的箭头直接复用返回值，
     * 因此「箭头与货物同向同速」不依赖调用方各自再算一遍时间。
     */
    tick(timeMs: number, periodMs: number = CARGO_PERIOD_MS): number {
        const progress = periodMs > 0 ? (timeMs % periodMs) / periodMs : 0;
        this.cargoMove = progress;
        return progress;
    }

    public get cargoMove() {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v) {
        this.material.cargoMoveUniform.value = v;
    }
}
