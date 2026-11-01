import {
    Color, Matrix3, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector3,
    type BufferGeometry, type Camera,
} from 'three';

/**
 * 渐变天光 + 星空 + 大气层。
 *
 * 旧版是纯黑底，平视时上半屏就是一块黑；这里补上三层东西：
 *
 * 1. **大气雾带**：以地平线（视线与当地法线的夹角 = 0）为中心的蓝色雾带，
 *    加一条更窄更亮的辉光，做出「贴着地平线那层大气」的厚度感。
 * 2. **星空**：在方向向量的 3D 网格里哈希撒星（两层不同密度），星星固定在世界空间、
 *    不随相机转动漂移；再叠一层极淡的星云噪点。
 * 3. **星球边缘光**：解析算出视线到球心的最近距离，在球体轮廓（limb ≈ 1）处加一圈辉光。
 *    相机贴近地面时由雾带负责，退远时由这圈光负责，两者用相机高度平滑交接。
 *
 * 渐变方向取**相机自身的 up**（≈ 锚点处的球面法线），见 PlanetMapControls.update。
 * 所以：俯瞰且贴近时星球铺满画面看不见天光；拉远时星球变成一颗带大气光环的小球；
 * 平视时地平线上一条雾带，抬头是星空。
 *
 * 实现：全屏四边形直接写 NDC，不经过相机/模型矩阵，与 FOV、宽高比无关；
 * 片元里反投影出视线方向，所有效果都是「视线方向 + 相机位置」的解析函数。
 * 颜色按 sRGB 直接写（不做线性转换），想调色直接改 hex。
 */

export interface SkyGradientOptions {
    /** 星球半径，用于算边缘光的轮廓位置 */
    planetRadius?: number;
    /**
     * 大气层高度（世界单位：地表到大气顶）。
     *
     * 默认 `0.02 × planetRadius`（R=200.2 时约 4.0），即沿用旧观感（光环在 1.02R 处）。
     * 调大 = 大气层更厚：星球边缘光环离地表更远、扩散更宽，地平线雾带/亮边也更宽。
     */
    atmosphereHeight?: number;
    /** 天顶颜色（默认纯黑 = 太空） */
    zenith?: Color | number;
    /** 地平线雾带颜色 */
    horizon?: Color | number;
    /** 地平线以下的颜色 */
    nadir?: Color | number;
    /** 大气辉光颜色（窄带 + 星球边缘光共用） */
    glow?: Color | number;
    /** 星云颜色 */
    nebula?: Color | number;
    /** 星星亮度（0 = 关掉星空） */
    starBrightness?: number;
    /** 大气强度（雾带窄带 + 边缘光） */
    atmosphereStrength?: number;
    /** 星云强度 */
    nebulaStrength?: number;
}

/** 默认大气层高度占星球半径的比例（旧行为里边缘光环位于 1.02R） */
const DEFAULT_ATMOSPHERE_RATIO = 0.05;
const vertexShader = /* glsl */`
varying vec2 vNdc;
void main() {
    vNdc = position.xy;
    // 直接写 NDC：不经过任何相机 / 模型矩阵，永远铺满全屏
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
const fragmentShader = /* glsl */`
uniform mat4 uProjectionInverse;
uniform mat3 uCameraRotation;
uniform vec3 uCameraPosition;
uniform vec3 uUp;
uniform float uPlanetRadius;
uniform float uAtmosphereHeight;   // 归一化大气层高度：atmosphereHeight / planetRadius
uniform float uAtmosphereScale;    // 相对默认高度（0.02R）的倍数，1 = 旧观感

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNadir;
uniform vec3 uGlow;
uniform vec3 uNebula;
uniform float uStar;
uniform float uAtmosphere;
uniform float uNebulaStrength;

varying vec2 vNdc;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z);
}

// 一层星：按方向向量切 3D 格子，哈希命中阈值的格子放一颗星
float starLayer(vec3 dir, float scale, float threshold, float size) {
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h < threshold)
        return 0.0;
    vec3 jitter = vec3(hash13(cell + 11.0), hash13(cell + 23.0), hash13(cell + 37.0)) - 0.5;
    float d = length(fract(p) - 0.5 - jitter * 0.55);
    return smoothstep(size, 0.0, d) * ((h - threshold) / max(1.0 - threshold, 0.001));
}

void main() {
    // 反投影出视线方向（世界空间）
    vec4 farPoint = uProjectionInverse * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize(uCameraRotation * normalize(farPoint.xyz / farPoint.w));

    // 与当地法线的夹角：1 = 天顶，0 = 地平线，-1 = 天底
    float elevation = dot(dir, uUp);

    // ---- 大气：宽雾带 + 窄辉光 ----
    // 注意：这里一律用 x*x 而不是 pow(x, 2.0) —— elevation 会是负数，
    // GLSL 的 pow 在底数为负时是未定义行为（部分驱动会给出 NaN）
    // 宽度反向随大气层高度缩放：hScale=1（默认 0.02R）时等价于旧的 6.76 / 81.0
    float hScale = uAtmosphereScale;
    float hazeWidth = 6.76 / (hScale * hScale);        // 约 ±40° 的宽带（默认高度）
    float rimWidth = 81.0 / (hScale * hScale);         // 约 ±12° 的亮边（默认高度）
    float haze = exp(-elevation * elevation * hazeWidth);
    float rim = exp(-elevation * elevation * rimWidth);

    vec3 color = mix(uZenith, uHorizon, haze);
    color += uGlow * rim * 0.45 * uAtmosphere;
    color = mix(uNadir, color, smoothstep(-0.30, 0.0, elevation));

    // ---- 星空 ----
    float stars = starLayer(dir, 45.0, 0.965, 0.12)
                + starLayer(dir, 90.0, 0.982, 0.14) * 0.6;
    // 雾带里星星被吃掉（俯瞰时 haze≈0，星空不受影响）
    color += vec3(0.95, 0.97, 1.00) * stars * uStar * (1.0 - haze * 0.85);

    // ---- 星云：极淡的噪声团 ----
    float nebula = noise3(dir * 2.4) * 0.6 + noise3(dir * 5.7) * 0.4;
    float nebulaMask = max(nebula - 0.35, 0.0);
    color += uNebula * nebulaMask * nebulaMask * uNebulaStrength * (1.0 - haze);

    // ---- 星球大气边缘光：视线到球心最近距离 ≈ 半径时最亮 ----
    // 相机在球心外侧，oc = 球心 → 相机
    vec3 oc = uCameraPosition;
    float tca = -dot(dir, oc);
    float closest = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
    float limb = closest / uPlanetRadius;
    // 只有相机确实拉远才画这圈光（贴着地面时由上面的雾带负责）
    float outside = smoothstep(1.15, 1.9, length(oc) / uPlanetRadius);
    // 光环中心落在大气顶：limb = 1 + 归一化大气层高度（默认 1 + 0.02 = 旧值 1.02）；
    // 再按高度缩放扩散宽度，让光环随大气层一起变厚/变薄
    float ringDelta = (limb - (1.0 + uAtmosphereHeight)) / hScale;
    // 内圈：贴着轮廓的一道亮边；外圈：往外柔和扩散的薄雾
    float ring = exp(-ringDelta * ringDelta * 100.0);
    float halo = exp(-ringDelta * ringDelta * 10.0);
    color += uGlow * (ring + halo * 0.22) * outside * uAtmosphere;

    // 这里不做线性→sRGB 转换，写进去的值就是最终显示值，按 sRGB 直觉调色即可
    gl_FragColor = vec4(color, 1.0);
}
`;

export interface SkyGradient {
    mesh: Mesh<BufferGeometry, ShaderMaterial>;
    dispose(): void;
}

/**
 * 创建一个铺满屏幕的天光/星空背景。挂到 scene 上即可，无需每帧手动更新
 * （uniform 在 onBeforeRender 里从相机同步）。
 */
export function createSkyGradient(options: SkyGradientOptions = {}): SkyGradient {
    const planetRadius = options.planetRadius ?? 200.2;
    // 大气层高度：世界单位（地表到大气顶），默认 0.02 × 半径 = 旧观感
    const atmosphereHeight = options.atmosphereHeight !== undefined && options.atmosphereHeight > 0
        ? options.atmosphereHeight
        : planetRadius * DEFAULT_ATMOSPHERE_RATIO;

    const zenith = new Color(options.zenith ?? 0x000000);
    const horizon = new Color(options.horizon ?? 0x14324a);
    const nadir = new Color(options.nadir ?? 0x03060b);
    const glow = new Color(options.glow ?? 0x3f8fbd);
    const nebula = new Color(options.nebula ?? 0x2a1d4a);

    const material = new ShaderMaterial({
        uniforms: {
            uProjectionInverse: { value: new Matrix4() },
            uCameraRotation: { value: new Matrix3() },
            uCameraPosition: { value: new Vector3() },
            uUp: { value: new Vector3(0, 1, 0) },
            uPlanetRadius: { value: planetRadius },
            uAtmosphereHeight: { value: atmosphereHeight / planetRadius },
            uAtmosphereScale: { value: atmosphereHeight / (planetRadius * DEFAULT_ATMOSPHERE_RATIO) },
            uZenith: { value: zenith },
            uHorizon: { value: horizon },
            uNadir: { value: nadir },
            uGlow: { value: glow },
            uNebula: { value: nebula },
            uStar: { value: options.starBrightness ?? 2.0 },
            uAtmosphere: { value: options.atmosphereStrength ?? 0.3 },
            uNebulaStrength: { value: options.nebulaStrength ?? 2 },
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });

    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, material);
    // 顶点着色器直接写 NDC，模型矩阵不参与；也不需要视锥裁剪
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;

    const uProjectionInverse = material.uniforms.uProjectionInverse.value as Matrix4;
    const uCameraRotation = material.uniforms.uCameraRotation.value as Matrix3;
    const uCameraPosition = material.uniforms.uCameraPosition.value as Vector3;
    const uUp = material.uniforms.uUp.value as Vector3;

    mesh.onBeforeRender = (_renderer, _scene, camera: Camera) => {
        uProjectionInverse.copy(camera.projectionMatrixInverse);
        uCameraRotation.setFromMatrix4(camera.matrixWorld);
        uCameraPosition.setFromMatrixPosition(camera.matrixWorld);
        uUp.copy(camera.up);
        if (uUp.lengthSq() < 1e-8)
            uUp.set(0, 1, 0);
        uUp.normalize();
    };

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
