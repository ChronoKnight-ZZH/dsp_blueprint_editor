import { BoxGeometry, Color, InstancedMesh, MeshLambertMaterial } from "three";
import type { WebGLProgramParametersWithUniforms } from "three";

/**
 * 分拣器横梁（Inserter beam）。
 *
 * 职责：为分拣器提供「加宽 + 半透明 + 顶面流动箭头」的横梁几何，箭头图案随
 * `cargoMove` 滚动，与传送带条带（`belt.ts`）同一套视觉语言。
 *
 * 使用：只被 `lib/core/buildBuildings.ts` 的 `buildInserters` 构造；横梁 mesh 随
 * `AllBuildings` 一起挂进场景，渲染循环每帧只写一个 uniform（`cargoMove`）。
 *
 * 边界（方案 v3.1 §3）：
 *   - 几何深度恒为 1.0，臂长由实例矩阵 `scale(1,1,len)` 提供；因此箭头相位必须从
 *     `instanceMatrix[2]`（z 轴缩放）反推臂长，**不能**假设 `len` 恒定，否则长臂/短臂
 *     箭头密度不一致、跨实例相位跳变（S17）。
 *   - 宽度只改几何 `x`，实例矩阵没有 `x` 缩放，箭头 `across` 归一化才正确（S21）。
 *   - 透明用 `depthWrite: false`：同一 InstancedMesh 内实例不按距离排序，密集分拣器
 *     场景可能出现远近叠序瑕疵，`opacity` 较低时不显著（S18）。
 *   - 臂的端点语义、拾取盒（`inserterTrans` / `INSERTER_HEIGHT`）完全不受影响（S19）。
 *   - 含 GLSL 注入，Jest/CI 无 WebGL 无法验证编译，只能人工冒烟。
 */

/** 横梁宽度（世界单位）：原 0.15 翻倍，顶面才容得下可辨识箭头（G12 / Q16） */
export const INSERTER_BEAM_WIDTH = 0.45;

/** 横梁厚度（世界单位）：侧面过矮，不画箭头 */
export const INSERTER_BEAM_THICKNESS = 0.06;

/** 横梁不透明度：0.5 太淡、0.75 太实（G13 / Q17） */
export const INSERTER_OPACITY = 0.58;

/** 箭头滚动周期（世界单位）：1 格臂（约 1.2578）上约 2.5 个箭头（G14 / Q19） */
export const INSERTER_ARROW_PERIOD = 0.5;

/** 箭头颜色：深灰，在偏亮的半透明横梁上对比最稳（Q18）；只经 uniform 生效 */
export const INSERTER_ARROW_COLOR = new Color(0x2f3438);

/**
 * 注入版本号；改了注入逻辑必须同步改它，否则 three 会复用旧 program（S16）。
 *
 * 必须与 `BELT_PROGRAM_KEY`（`dsp-belt-arrow-v2`）和 `CargoMaterial` 的默认
 * key 都不同，否则两份注入会串味。
 */
const INSERTER_PROGRAM_KEY = "dsp-inserter-arrow-v1";

/**
 * 箭头图案：横梁顶面的人字形斜纹，随 `cargoMove` 向局部 -z（臂尖方向）滚动。
 *
 * 相位符号必须是 `+ cargoMove`：货物着色器是 `transformed.z -= cargoMove * d`，
 * 写 `-` 会让箭头逆流向滚动（G14）。
 *
 * `INSERTER_BEAM_WIDTH` 由模板字符串插值写入，改宽度时箭头不会按旧宽度计算（GL8 / S21）。
 *
 * `smoothstep` 一律用升序参数：GLSL 规范规定 `edge0 ≥ edge1` 时结果未定义，
 * 这里改写为等价且良定义的形式（与 `belt.ts` 一致）。
 */
const ARROW_FRAGMENT = `
    float topMask = step(0.5, vArmNY);
    float phase = fract(vArmPhase + cargoMove);
    float across = abs(vArmX) / (${INSERTER_BEAM_WIDTH} * 0.5);
    float slant = 0.10 + across * 0.26;
    float band = 1.0 - smoothstep(0.0, 0.06, abs(phase - slant));
    float edgeFade = 1.0 - smoothstep(0.62, 0.92, across);
    float mask = topMask * band * edgeFade;
    diffuseColor.rgb = mix(diffuseColor.rgb, uArrowColor, mask * 0.88);
    diffuseColor.a = mix(diffuseColor.a, 0.95, mask);
`;

/**
 * 横梁材质：半透明 `MeshLambertMaterial` + 顶面箭头注入。
 *
 * 边界：
 *   - 透明由 `diffuseColor.a`（`opacity`）与逐实例元数据色相乘自然得到，颜色变淡；
 *   - 箭头色走独立 `uArrowColor`，且在 `color_fragment` 之后 mix，不会被元数据色染色（S20）；
 *   - 箭头更实：mask 区域把 alpha 提到 0.95，0.62 透明梁上仍清晰。
 */
class InserterMaterial extends MeshLambertMaterial {
    /** 0..1 相位；每帧由渲染循环写入，GPU 侧据此滚动箭头 */
    readonly cargoMoveUniform = { value: 0 };
    /** 箭头色；独立 uniform，避免被逐实例横梁色影响 */
    readonly arrowColorUniform = { value: INSERTER_ARROW_COLOR };

    constructor() {
        super({
            transparent: true,
            opacity: INSERTER_OPACITY,
            depthWrite: false,
        });
    }

    // 覆写基类方法；只需第一个参数（注入点全部在 shader 里）
    onBeforeCompile(parameters: WebGLProgramParametersWithUniforms): void {
        parameters.vertexShader = parameters.vertexShader
            .replace(
                "#include <common>",
                `uniform float cargoMove;
varying float vArmPhase;
varying float vArmX;
varying float vArmNY;

#include <common>`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
// 臂长 = 实例矩阵 z 轴缩放（零额外 attribute，S17）
float armLen = 1.0;
#ifdef USE_INSTANCING
armLen = length(instanceMatrix[2].xyz);
#endif
// 0 = 臂根，1 = 臂尖；乘臂长后才是世界距离，保证跨实例箭头密度一致
vArmPhase = (position.z + 0.5) * armLen / ${INSERTER_ARROW_PERIOD};
vArmX = position.x;
vArmNY = normal.y;
`
            );
        // 片元同样必须声明 uniform 与全部 varying
        parameters.fragmentShader = parameters.fragmentShader
            .replace(
                "#include <common>",
                `uniform float cargoMove;
uniform vec3 uArrowColor;
varying float vArmPhase;
varying float vArmX;
varying float vArmNY;

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
        return INSERTER_PROGRAM_KEY;
    }
}

/**
 * 分拣器横梁实例化网格。
 *
 * 职责：承载加宽后的横梁几何与每实例颜色（元数据色），对外暴露 `cargoMove`
 * 存取器供帧循环驱动箭头。
 *
 * 使用：由 `buildInserters` 构造，数量 = 分拣器数；每实例矩阵由调用方写入，
 * 矩阵里带 `scale(1,1,len)` 与 `T(0,0,-0.5)` 端点偏移（与 v3 一致）。
 *
 * 边界：几何局部 z ∈ [-0.5, +0.5]（乘实例 z 缩放后即臂长），箭头相位的归一化前提。
 * 释放责任归 `AllBuildings.dispose()`。
 */
export class Inserters extends InstancedMesh {
    declare geometry: BoxGeometry;
    declare material: InserterMaterial;

    constructor(count: number) {
        super(
            new BoxGeometry(INSERTER_BEAM_WIDTH, INSERTER_BEAM_THICKNESS, 1.0),
            new InserterMaterial(),
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
