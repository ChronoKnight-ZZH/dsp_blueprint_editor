import {
    BoxGeometry,
    Color,
    InstancedMesh,
    MeshLambertMaterial,
} from "three";
import type { WebGLProgramParametersWithUniforms } from "three";
import { GRID_HORIZONTAL } from "@/planetConstants";
import { CARGO_SIZE } from "@/cargos";

/**
 * 传送带条带（Belt）。
 *
 * 职责：为「有输出的传送带格」提供一段可实例化渲染的条带几何，并在片元阶段
 * 画出随 `cargoMove` 滚动的箭头图案（箭头逻辑见 `BeltMaterial`）。
 *
 * 使用：只被 `lib/core/buildBuildings.ts` 的 `buildBelts` 构造；条带 mesh 随
 * `AllBuildings` 一起挂进场景，渲染循环每帧只写一个 uniform（`cargoMove`）。
 *
 * 边界：
 *   - 坐标约定是**条带局部 -z 为流动方向、局部 +y 为球面法线**，由调用方的
 *     `base × Rz(-yaw) × Rx(π/2)` 保证；本文件不做任何朝向推导。
 *   - 段长恒为「一格」（DSP 蓝图里一条传送带记录只代表 1 格，见方案 §3.4-F1/F2），
 *     不支持可变段长；跨格连续由「每格一段、段长=格长」自然成立。
 *   - 含 GLSL 注入，Jest/CI 无 WebGL 无法验证编译，只能人工冒烟（方案 §3.5）。
 */

/** 条带宽度（世界单位）：一格 1.2578，两侧各留约 0.15 间隙 */
export const BELT_WIDTH = 0.95;

/** 条带厚度（世界单位）；同时决定条带顶面高度 */
export const BELT_HEIGHT = 0.08;

/** 条带中心抬升：盒体以原点为中心，抬升半个厚度后底面正好贴球面（方案 §3.4-F3） */
export const BELT_LIFT = BELT_HEIGHT / 2;

/** 段长 = 一格的水平弧长（方案 §3.4-F2）；条带沿局部 z 拉伸到这个长度 */
export const BELT_LEN = GRID_HORIZONTAL;

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
 * 条带材质：在 `MeshLambertMaterial` 上挂一个 0..1 的相位 uniform。
 *
 * 边界：本阶段只提供 uniform 与存取器，箭头图案在 P2 阶段注入；`customProgramCacheKey`
 * 会在 P2 一并实现（必须与 `CargoMaterial` 区分，否则 three 会复用错 program）。
 */
/** 注入版本号；改了注入逻辑必须同步改它，否则 three 会复用旧 program（方案 §6.5-GL6） */
const BELT_PROGRAM_KEY = "dsp-belt-arrow-v1";

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
 */
const ARROW_FRAGMENT = `
    float topMask = step(0.5, vBeltNY);
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
 * 使用：由 `Belts` 构造，与 `Belts` 同生命周期。
 *
 * 边界：
 *   - `customProgramCacheKey` 必须与 `CargoMaterial` 不同，否则 three 会复用错 program，
 *     把货物的 `cargoDistance` 逻辑串到条带上（方案 §6.5-GL6 / §6.6-S2）；
 *   - 箭头颜色走独立的 `uArrowColor` uniform，且在 `#include <color_fragment>` 之后覆写，
 *     因此不会被每实例元数据色相乘染暗（§6.5-GL7）；
 *   - 材质不设 `color`（默认白），条带颜色完全由 `setColorAt` 提供（§6.6-S9）；
 *   - GLSL 无法在 Jest/CI 编译验证，只能人工冒烟（方案 §3.5）。
 */
class BeltMaterial extends MeshLambertMaterial {
    /** 0..1 相位；每帧由渲染循环写入，GPU 侧据此滚动箭头（无需每实例属性） */
    readonly cargoMoveUniform = { value: 0 };
    /** 箭头色；独立 uniform，避免被每实例条带色影响（§6.5-GL7） */
    readonly arrowColorUniform = { value: BELT_ARROW_COLOR };

    // 覆写基类方法；只需第一个参数（注入点全部在 shader 里）
    onBeforeCompile(parameters: WebGLProgramParametersWithUniforms): void {
        parameters.vertexShader = parameters.vertexShader
            .replace(
                "#include <common>",
                `uniform float cargoMove;
varying float vBeltPhase;
varying float vBeltX;
varying float vBeltNY;

#include <common>`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
vBeltPhase = position.z + 0.5;
vBeltX = position.x;
vBeltNY = normal.y;
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
 * 传送带条带实例化网格。
 *
 * 职责：承载「每格一段」的条带几何与每实例颜色（元数据色），并对外暴露
 * `cargoMove` 存取器供帧循环驱动。
 *
 * 使用：由 `buildBelts` 构造，数量 = 有输出的传送带格数；每实例矩阵由调用方写入。
 *
 * 边界：几何固定为 `BoxGeometry(BELT_WIDTH, BELT_HEIGHT, 1)`，长度方向由实例矩阵的
 * `scale(1, 1, BELT_LEN)` 拉伸，因此顶点局部 z ∈ [-0.5, 0.5]（箭头相位归一化的前提）。
 * 释放责任归 `AllBuildings.dispose()`（`traverse` 会释放几何，材质维持现状不释放）。
 */
export class Belts extends InstancedMesh {
    declare geometry: BoxGeometry;
    declare material: BeltMaterial;

    constructor(count: number) {
        super(
            new BoxGeometry(BELT_WIDTH, BELT_HEIGHT, 1),
            new BeltMaterial(),
            count
        );
    }

    public get cargoMove(): number {
        return this.material.cargoMoveUniform.value;
    }
    public set cargoMove(v: number) {
        this.material.cargoMoveUniform.value = v;
    }
}
