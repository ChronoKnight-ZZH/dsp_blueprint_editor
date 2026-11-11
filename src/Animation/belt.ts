import {
    BoxGeometry,
    Color,
    InstancedBufferAttribute,
    InstancedMesh,
    MeshLambertMaterial,
} from "three";
import type { WebGLProgramParametersWithUniforms } from "three";
import { GRID_HORIZONTAL } from "@/planet/planetConstants";
import { CARGO_SIZE } from "./cargos";

/**
 * 传送带条带（Belt）。
 *
 * 职责：为「有连接的传送带格」提供一段可实例化渲染的条带几何，并在片元阶段
 * 画出随 `cargoMove` 滚动的箭头图案（箭头逻辑见 `BeltMaterial`）。
 *
 * 使用：只被 `lib/core/buildBuildings.ts` 的 `buildBelts` 构造；条带 mesh 随
 * `AllBuildings` 一起挂进场景，渲染循环每帧只写一个 uniform（`cargoMove`）。
 *
 * 边界：
 *   - 坐标约定是**条带局部 -z 为流动方向、局部 +y 为球面法线**，由调用方的
 *     `base × Rx(π/2)` 保证（`base` 已含 yaw，不可再乘一次 yaw）；本文件不做朝向推导。
 *   - 段长恒为「一格」（DSP 蓝图里一条传送带记录只代表 1 格，见方案 §3.4-F1/F2），
 *     不支持可变段长；跨格连续由「每格一段、段长=格长」自然成立。
 *   - 几何形状（直段 / 转角圆弧 / 支线贴边外延）**全部由 CPU 算好**，以逐实例属性
 *     `aBeltArc` / `aBeltAux` 传入；着色器只做一次 `mix(theta0, theta1, u)` 和一次
 *     三角函数。圆心、半径、θ 范围都不再写死在 GLSL 里（v4，见 `beltArc.ts`）。
 *   - 含 GLSL 注入，Jest/CI 无 WebGL 无法验证编译，只能人工冒烟（方案 §3.5）；
 *     但几何本身已经搬到 CPU（`beltArc.ts`），**可以**被单测覆盖。
 */

/**
 * 条带宽度（世界单位）：一格 1.2578，两侧各留约 0.15 间隙（方案 P1-2）。
 *
 * 转角内圈半径 = `BELT_ARC_RADIUS - BELT_WIDTH/2`，必须 > 0，否则圆弧翻面（§3.6）。
 * 当前 0.629 - 0.475 = 0.154，余量很紧，**不要**再加大。
 */
export const BELT_WIDTH = 0.64;

/** 条带厚度（世界单位）；同时决定条带顶面高度 */
export const BELT_HEIGHT = 0.08;

/** 条带中心抬升：盒体以原点为中心，抬升半个厚度后底面正好贴球面（方案 §3.4-F3 / P1-1） */
export const BELT_LIFT = BELT_HEIGHT / 2;

/** 段长 = 一格的水平弧长（方案 §3.4-F2）；**必须烘进几何**，实例矩阵不再缩放（§3.6） */
export const BELT_LEN = GRID_HORIZONTAL;

/**
 * 坡度阈值（世界单位）：`abs(h_{i+1} - h_i)` 小于该值视为平地。
 *
 * 实测数据里除真实台阶（Δz = ±0.5 格 → 0.667 世界单位）外，还有 ±0.01/0.02 格的
 * 亚台阶噪声（→ 0.013/0.027 世界单位）。阈值取 0.1 才能真的把它们滤掉；
 * 早期写的 1e-3 比噪声小两个量级，等于不过滤（方案 §3.4-F9 / S12）。
 */
export const BELT_SLOPE_EPS = 0.1;

/**
 * 直段保护：`abs(theta1 - theta0)`（弧度）小于该值时跳过弯折。
 *
 * 弧退化成点时整段会被压成一个点，且法线归一化会得到 NaN（方案 §3.6 / GL11）。
 * CPU 侧已经保证「只有直段（sweep = 0）和 90° 弧（sweep = ±π/2）」两种取值，
 * 这里只是着色器侧的兜底。
 */
export const BELT_ARC_EPS = 1e-4;

/**
 * 转角圆弧半径 = 半段长。
 *
 * 这不是可调参数：正方形格里「入射边中点 → 出射边中点」的切向连续解唯一——
 * 圆心必落在两边共享的角点上，半径必然是半格长（`beltArc.ts` 里有推导）。
 */
export const BELT_ARC_RADIUS = BELT_LEN / 2;

/** 圆弧中心线长度（世界单位）：`u ∈ [0, 1]` 对应的弧长 = `R·π/2` = 0.785L */
export const BELT_ARC_LENGTH = (BELT_ARC_RADIUS * Math.PI) / 2;

/**
 * 圆环弯头（转角格）截面相对条带轮廓的**外扩量**（每侧，世界单位）。
 *
 * 圆环是「压在接缝上」的一件套环：外扩 4mm 后它的轮廓完整包住条带的矩形端面，
 * 于是端面被埋进环里、顶面也不会与条带共面（共面会 z-fighting）。
 */
export const BELT_ELBOW_COVER = 0.004;

/** 圆环弯头截面四角的倒圆半径（世界单位；实际使用时还会被半高/半宽夹住，见 `beltElbow.ts`） */
export const BELT_ELBOW_ROUND = 0.03;

/**
 * 圆环弯头整体的额外抬升（世界单位），按厚度的比例给。
 *
 * 转角厚度和直段完全一致（都是 `BELT_HEIGHT`），所以圆环与条带伸进彼此的那一小段顶面
 * **共面**；不抬一点就会 z-fighting。1.6mm（默认厚度下）肉眼不可见，但改 `BELT_HEIGHT`
 * 时它会一起缩放，不会变成固定 bug。
 */
export const BELT_ELBOW_LIFT = BELT_HEIGHT * 0.02;

/**
 * 圆环弯头两端伸入邻格的**直线段**长度（世界单位）。
 *
 * 取 `(格长 − 弧长)/2` ≈ 0.1349（即"约 0.12"），有两个作用：
 *   1. 把「弯头 ↔ 直段」的接缝埋进圆环里，接缝不再暴露在格边界上；
 *   2. 弯头的总路径长度 = 弧 0.785L + 两端 stub 0.215L = **一格**，所以圆环在格子
 *      里的占地仍然是一格，不会挤到第三格去。
 *
 * 注意：箭头相位仍是 `position.z / L`（与直段完全同一套），所以转角弧上箭头会随
 * 弧长被压密一些 —— 这是 v3 以来就有的既存观感，本改动不改变它。
 */
export const BELT_ELBOW_STUB = (BELT_LEN - BELT_ARC_LENGTH) / 2;

/**
 * 支线贴边外延量（世界单位）= 半格长 − 半条带宽。
 *
 * 条带比格子窄，所以「垂直支线的端面」离「主线侧边」总差这么一截；支线末端
 * 沿出口切线加长这么多才能真的贴上主线。主线一侧一个像素都不动。
 */
export const BELT_EDGE_GAP = (BELT_LEN - BELT_WIDTH) / 2;

/**
 * 逐实例的几何形状参数，全部已在**几何空间**（实例矩阵之前）算好。
 *
 * 由 `beltArc.computeBeltShapes` 产出、`buildBelts` 写入；直段取全 0（默认值）。
 */
export interface BeltArcParams {
    /** 弧的起始角（弧度）：`u = 0`（后缘 / 入射端）落在 `center + R·(cos, sin)` */
    theta0: number;
    /** 弧的结束角（弧度）：`u = 1`（前缘 / 出射端）；直段时等于 theta0 */
    theta1: number;
    /** 圆心（几何空间的 x，世界单位） */
    centerX: number;
    /** 圆心（几何空间的 z，世界单位） */
    centerZ: number;
    /** 后端 → 前端的坡度（世界单位，平地 0） */
    slope: number;
    /** 前缘沿出口切线外延的长度（世界单位，无需外延为 0） */
    extend: number;
    /** 出口切线方向（几何空间单位向量，xz 分量） */
    exitX: number;
    exitZ: number;
}

/** 箭头颜色（方案 §10.2-Q4）；只经 `uArrowColor` uniform 生效，不参与元数据色相乘 */
export const BELT_ARROW_COLOR = new Color(0x9aa0a6);

/** 货物底面与条带顶面之间的视觉间隙（世界单位），与分拣器横梁/货物的 0.02 同语义 */
const CARGO_GAP = 0.02;

/**
 * 传送带货物的中心抬升（世界单位，沿法线）。
 *
 * 由方案 §9.1-D-3 反推：货物底面 = 条带顶面 + `CARGO_GAP`，即
 * `BELT_LIFT + BELT_HEIGHT/2 + CARGO_SIZE/2 + CARGO_GAP` = 0.25。
 * 货物几何本身不缩放，因此这个常量必须等于「立方体半高 + 条带顶面 + 间隙」。
 */
export const CARGO_LIFT =
    BELT_LIFT + BELT_HEIGHT / 2 + CARGO_SIZE / 2 + CARGO_GAP;

/**
 * 垂直段（riser）板心的基础抬升 = `BELT_LIFT`（世界单位）。
 *
 * 水平条带的**中面**就在 `BELT_LIFT`（底面贴地板、厚 `BELT_HEIGHT`），所以垂直段的
 * 两端面都对齐到邻格的**中面**：下端面 = `BELT_LIFT`、上端面 = `BELT_LIFT + rise`
 * （= 上层条带的中面）。两端都埋在上下层条带的**体内**，于是：
 *   - 不留缝（端面被邻格的条带盖住）；
 *   - 也不会与邻格的**顶面**共面 —— 若对齐到顶面（`BELT_LIFT + BELT_HEIGHT/2`），
 *     板端面会与上层条带顶面重叠成一片 0.64×0.08 的共面区域，从上看会 z-fighting。
 */
export const BELT_RISER_BASE = BELT_LIFT;

/**
 * 垂直段货物的横向偏移（沿板面法线，世界单位）：板半厚 + 货物半边长 + 视觉间隙。
 *
 * 垂直段的板面法线是**水平**的（板是竖起来的一根），所以货物不能像水平条带那样沿
 * 局部 +y 抬 `CARGO_LIFT`（那会横着飘出板外 0.25），只能用这个侧向偏移贴在板外侧。
 */
export const RISER_CARGO_SIDE = BELT_HEIGHT / 2 + CARGO_SIZE / 2 + CARGO_GAP;

/**
 * 注入版本号；改了注入逻辑必须同步改它，否则 three 会复用旧 program（方案 §6.5-GL6）。
 *
 * 必须与 `CargoMaterial` 不同（后者靠默认的 `onBeforeCompile.toString()` 区分），
 * 否则两份注入会串味。
 */
const BELT_PROGRAM_KEY = "dsp-belt-arrow-v4";

/**
 * 箭头图案：条带顶面的人字形斜纹，随 `cargoMove` 向条带局部 -z（流动方向）滚动。
 *
 * 三个坐标来源（方案 §6.5-GL1/GL2/GL3）：`position.z` 归一化成相位、`position.x` 给宽度方向、
 * 顶点法线 y 做顶面 mask —— 全部来自顶点属性，**不引用 `uv`**（Lambert 无贴图时 `USE_UV`
 * 未定义，引用会编译失败）。
 *
 * 相位符号必须是 `+ cargoMove`（§6.5-GL3）：货物着色器是 `transformed.z -= cargoMove * d`，
 * 写 `-` 会让箭头逆流向滚动。
 *
 * `smoothstep` 用 `1 - smoothstep(升序参数)` 而不是降序参数：GLSL 规范规定
 * `edge0 ≥ edge1` 时结果未定义，这里换取等价且良定义的写法（视觉完全一致）。
 *
 * 顶面判定用 `step(0.9, ...)` 而不是 0.5：圆环弯头的截面四角倒了圆，肩部法线的 y 分量
 * 落在 0.5~0.9 之间；用 0.5 会把箭头色（`0x9aa0a6`，灰蓝）糊到肩部，转角看着比直段
 * 灰一大截（"颜色不一致"）。0.9 让箭头只落在**平坦顶面**，与方条带的行为一致。
 */
const ARROW_FRAGMENT = `
    float topMask = step(0.9, vBeltNY);
    float phase = fract(vBeltPhase + cargoMove);
    float across = abs(vBeltX) / (${BELT_WIDTH} * 0.5);
    float slant = 0.10 + across * 0.26;
    float band = 1.0 - smoothstep(0.0, 0.055, abs(phase - slant));
    float edgeFade = 1.0 - smoothstep(0.38, 0.60, across);
    float mask = topMask * band * edgeFade;
    diffuseColor.rgb = mix(diffuseColor.rgb, uArrowColor, mask * 0.9);
`;

/**
 * 条带材质：在 `MeshLambertMaterial` 上注入箭头图案，只靠两个 uniform 驱动。
 *
 * 职责：条带顶面的流动箭头；每帧 CPU 只写 `cargoMove` 一个 float，图案在片元着色器里算，
 * 因此每实例零 CPU 开销、零额外属性（方案 §3.2）。
 *
 * 使用：由 `buildBuildings` 构造**一份**，条带（`Belts`）与圆环（`BeltElbows`）共用，
 * 因此每帧写一次 `cargoMove` 两边的箭头就同步滚动。
 *
 * 边界：
 *   - `customProgramCacheKey` 必须与 `CargoMaterial` 不同，否则 three 会复用错 program，
 *     把货物的 `cargoDistance` 逻辑串到条带上（方案 §6.5-GL6 / §6.6-S2）；
 *   - 箭头颜色走独立的 `uArrowColor` uniform，且在 `#include <color_fragment>` 之后覆写，
 *     因此不会被每实例元数据色相乘染暗（§6.5-GL7）；
 *   - 材质不设 `color`（默认白），条带颜色完全由 `setColorAt` 提供（§6.6-S9）；
 *   - GLSL 无法在 Jest/CI 编译验证，只能人工冒烟（方案 §3.5）。
 */
export class BeltMaterial extends MeshLambertMaterial {
    /** 0..1 相位；每帧由渲染循环写入，GPU 侧据此滚动箭头（无需每实例属性） */
    readonly cargoMoveUniform = { value: 0 };
    /** 箭头色；独立 uniform，避免被每实例条带色影响（§6.5-GL7） */
    readonly arrowColorUniform = { value: BELT_ARROW_COLOR };

    // 覆写基类方法；只需第一个参数（注入点全部在 shader 里）
    onBeforeCompile(parameters: WebGLProgramParametersWithUniforms): void {
        parameters.vertexShader = parameters.vertexShader
            .replace(
                "#include <common>",
                `attribute vec4 aBeltArc;   // (theta0, theta1, cx, cz)：几何空间的圆弧参数
attribute vec4 aBeltAux;   // (slope, extend, exitDirX, exitDirZ)
attribute vec2 aBeltEnds;  // (backEnd, frontEnd)：端面沿外向的位移，正=伸出、负=内收
uniform float cargoMove;
varying float vBeltPhase;
varying float vBeltX;
varying float vBeltNY;

#include <common>`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
float slope = aBeltAux.x;
float sweep = aBeltArc.y - aBeltArc.x;

vBeltPhase = position.z / ${BELT_LEN} + 0.5;
vBeltX = position.x;
vBeltNY = normal.y;

// ① 坡度：纵向剪切（只改 y）。后缘 +L/2 → -slope/2、前缘 -L/2 → +slope/2，
//    实例中心已抬 slope/2，因此后缘落在 h_i、前缘落在 h_{i+1}（§3.6）
transformed.y -= (position.z / ${BELT_LEN}) * slope;

// ② 转角：圆心 / 半径 / θ 范围都由 CPU 算好（beltArc.ts），这里只做一次插值
//    和一次三角函数。直段 sweep = 0，连分支都不进（GL11 的退化保护）
if (abs(sweep) > ${BELT_ARC_EPS}) {
    // u ∈ [0,1] 对应整段 90° 弧；超出部分是圆环伸进邻格的**直线段**（不跟着继续弯）
    float uRaw = 0.5 - position.z / ${BELT_LEN};
    float u = clamp(
        uRaw,
        -aBeltEnds.x / ${BELT_LEN},
        1.0 + aBeltEnds.y / ${BELT_LEN}
    );
    float uc = clamp(u, 0.0, 1.0);
    float th = aBeltArc.x + sweep * uc;
    float r = ${BELT_ARC_RADIUS} + position.x;
    float over = (u - uc) * ${BELT_LEN};          // 端头直线段长度（世界单位）
    float tn = sign(sweep);                       // 流向切向 = tn·(−sinθ, cosθ)
    transformed.x = aBeltArc.z + r * cos(th) - tn * over * sin(th);
    transformed.z = aBeltArc.w + r * sin(th) + tn * over * cos(th);
} else {
    // ②b 直段端头：正值 = 沿流向伸出格子；负值 = 内收（端帽压住的那一段，线因此变短）。
    //     只挪端面那一圈顶点，条带被"拉长/缩短"而不是整体平移，另一端仍与邻格贴合。
    if (position.z > 0.0) transformed.z += aBeltEnds.x;
    else transformed.z -= aBeltEnds.y;
}

// ③ 支线贴边：只把前缘顶点沿出口切线外推，后缘不动 —— 条带是被"拉长"而不是
//    整体平移，因此与前一格仍然首尾相接（BELT_EDGE_GAP）
if (aBeltAux.y > 0.0 && position.z < 0.0) {
    transformed.x += aBeltAux.y * aBeltAux.z;
    transformed.z += aBeltAux.y * aBeltAux.w;
}
`
            );
        // 片元同样必须声明 uniform 与全部 varying（§6.5-GL4）
        parameters.fragmentShader = parameters.fragmentShader
            .replace(
                "#include <common>",
                `uniform float cargoMove;
uniform vec3 uArrowColor;
varying float vBeltPhase;
varying float vBeltX;
varying float vBeltNY;

#include <common>`
            )
            .replace(
                "#include <normal_fragment_begin>",
                `#include <normal_fragment_begin>
${ARROW_FRAGMENT}`
            );
        parameters.uniforms.cargoMove = this.cargoMoveUniform;
        parameters.uniforms.uArrowColor = this.arrowColorUniform;
    }

    customProgramCacheKey(): string {
        return BELT_PROGRAM_KEY;
    }
}

/**
 * 条带几何：尺寸即最终尺寸（`BELT_LEN` 烘进几何），并挂两个逐实例形状属性。
 *
 * 边界：**不能**再用实例 `scale(1,1,BELT_LEN)`——非等比缩放会作用在顶点着色器输出上，
 * 把圆弧压成椭圆、端点对不上邻格（方案 §3.6 / GL10 / S13）。
 */
export class BeltGeometry extends BoxGeometry {
    /** 逐实例 `(theta0, theta1, cx, cz)`；默认全 0 = 直段平地 */
    readonly beltArc: InstancedBufferAttribute;
    /** 逐实例 `(slope, extend, exitX, exitZ)`；默认全 0 = 平地、不外延 */
    readonly beltAux: InstancedBufferAttribute;
    /**
     * 逐实例 `(backEnd, frontEnd)`：两端端面沿**外向**的位移（世界单位）。
     *
     * 正值 = 伸出格子（圆环的 stub，用来把接缝埋进环里）；
     * 负值 = 内收（端帽压住的那一段，让线变短）。
     */
    readonly beltEnds: InstancedBufferAttribute;

    constructor(count: number) {
        super(BELT_WIDTH, BELT_HEIGHT, BELT_LEN);
        this.beltArc = new InstancedBufferAttribute(
            new Float32Array(count * 4),
            4
        );
        this.beltAux = new InstancedBufferAttribute(
            new Float32Array(count * 4),
            4
        );
        this.beltEnds = new InstancedBufferAttribute(
            new Float32Array(count * 2),
            2
        );
        this.setAttribute("aBeltArc", this.beltArc);
        this.setAttribute("aBeltAux", this.beltAux);
        this.setAttribute("aBeltEnds", this.beltEnds);
    }
}

/** 逐实例写端头位移（条带与圆环共用） */
export function writeBeltEnds(
    geometry: { beltEnds: InstancedBufferAttribute },
    i: number,
    back: number,
    front: number
): void {
    const a = geometry.beltEnds.array as Float32Array;
    a[i * 2] = back;
    a[i * 2 + 1] = front;
}

/** 逐实例写弧参数（条带与圆环共用的属性布局） */
export function writeBeltArc(
    geometry: {
        beltArc: InstancedBufferAttribute;
        beltAux: InstancedBufferAttribute;
    },
    i: number,
    p: BeltArcParams
): void {
    const arc = geometry.beltArc.array as Float32Array;
    arc[i * 4] = p.theta0;
    arc[i * 4 + 1] = p.theta1;
    arc[i * 4 + 2] = p.centerX;
    arc[i * 4 + 3] = p.centerZ;
    const aux = geometry.beltAux.array as Float32Array;
    aux[i * 4] = p.slope;
    aux[i * 4 + 1] = p.extend;
    aux[i * 4 + 2] = p.exitX;
    aux[i * 4 + 3] = p.exitZ;
}

/**
 * 条带 / 圆环共同的基类：只负责 `cargoMove`。
 *
 * 两者共用同一个 `BeltMaterial` 实例（同一份 GLSL、同一个 uniform），所以帧循环
 * 只需要写其中任意一个，两边的箭头就同步滚动。
 */
export abstract class BeltMesh extends InstancedMesh {
    declare material: BeltMaterial;

    public get cargoMove(): number {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v: number) {
        this.material.cargoMoveUniform.value = v;
    }
}

/**
 * 传送带条带实例化网格（直段格）。
 *
 * 职责：承载「每格一段」的条带几何与每实例颜色（元数据色），并对外暴露
 * `cargoMove` 存取器供帧循环驱动。
 *
 * 使用：由 `buildBelts` 构造，数量 = 直段格数；**转角格不在这里**，它们走
 * `BeltElbows`（圆环弯头，见 `beltElbow.ts`）。
 *
 * 边界：顶点局部 z ∈ [-BELT_LEN/2, +BELT_LEN/2]（箭头相位归一化的前提），局部
 * `+z` 是本格后缘（逆流向）。释放责任归 `AllBuildings.dispose()`。
 */
export class Belts extends BeltMesh {
    declare geometry: BeltGeometry;

    constructor(count: number, material: BeltMaterial = new BeltMaterial()) {
        super(new BeltGeometry(count), material, count);
        this.name = "belts";
    }

    /**
     * 写第 i 个实例的形状参数（构建期一次性调用）。
     *
     * 不调用则默认全 0 = 直段平地：`(theta0, theta1, 0, 0)` + `(0, 0, 0, 0)`。
     */
    public setArcAt(i: number, p: BeltArcParams): void {
        writeBeltArc(this.geometry, i, p);
    }

    /**
     * 写第 i 个条带两端的端面位移（世界单位，外向为正）。
     *
     * 端帽压住的那一端给负值（内收，线变短）；分拣器式的外延给正值。
     */
    public setEndsAt(i: number, back: number, front: number): void {
        writeBeltEnds(this.geometry, i, back, front);
    }
}
