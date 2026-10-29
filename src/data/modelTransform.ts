/**
 * 建筑模型变换表：逐模型设置「偏移 + 旋转」。
 *
 * 与 `@/data/building` 的 `buildingMeta` **同键**（modelIndex），一条建筑一行，
 * 默认全部为 0 = 不做任何额外变换（模型按元数据盒自动居中、按高度等比缩放）。
 *
 * ── 单位 ────────────────────────────────────────────────────────────────
 * 偏移 x/y/z 的单位是**格子**，不是世界单位。渲染时会换算：
 *   x、y：× 1.2579  （水平格：2π / 200 / 5 × R(200.2)，见 planet.ts 与 BlueprintEditor 的 R / SEGMENT）
 *   z   ：× 4/3     （垂直格：planet.ts 的 HEIGHT_GRID_SIZE）
 * 旋转 pitch/yaw/roll 的单位是**角度（度）**，渲染时内部转弧度。
 *
 * ── 轴方向（建筑局部坐标系，z 轴朝上指向星球法线）──────────────────────────
 *   偏移 x = 左右（+x 向右），y = 前后（+y 向前），z = 上下（+z 向上）
 *   pitch = 俯仰，绕 X 轴（左右轴）
 *   yaw   = 水平旋转，绕 Z 轴（竖直轴）
 *   roll  = 侧倾，绕 Y 轴（前后轴）
 *
 * ── 应用顺序 ────────────────────────────────────────────────────────────
 *   按元数据高度等比缩放 → 旋转（Roll → Pitch → Yaw）→ 平移到元数据盒中心 → 叠加偏移
 * 即偏移**不受旋转影响**，永远沿建筑格子的 x/y/z 走（`z: -10` 就是往下 10 格）。
 *
 * ── 可选高级字段 ─────────────────────────────────────────────────────────
 *   upAxis：GLB 的「上」方向轴，glTF 标准是 'y'（默认），个别模型可能是 'z'
 *   align ：'height'（默认，按元数据盒高度等比缩放）| 'none'（保持原始比例）
 *   scale ：在自动缩放之后再乘一个系数
 */

export type ModelUpAxis = 'y' | 'z';
export type ModelAlign = 'height' | 'none';

export interface ModelTransform {
    /** 左右偏移，单位：格（+x 向右） */
    x: number;
    /** 前后偏移，单位：格（+y 向前） */
    y: number;
    /** 上下偏移，单位：格（+z 向上；负数 = 往下沉） */
    z: number;
    /** 俯仰，单位：度，绕 X 轴 */
    pitch: number;
    /** 水平旋转，单位：度，绕 Z 轴（竖直轴） */
    yaw: number;
    /** 侧倾，单位：度，绕 Y 轴 */
    roll: number;

    /** 高级：GLB 的“上”方向轴，默认 'y' */
    upAxis?: ModelUpAxis;
    /** 高级：'height' 按元数据盒高度等比缩放（默认）| 'none' 保持原始比例 */
    align?: ModelAlign;
    /** 高级：在自动缩放之后额外相乘的缩放系数 */
    scale?: number;
}

/** 全 0 变换：表里没有登记的 modelIndex 一律用它（行为与未接入本表时完全一致） */
export const ZERO_MODEL_TRANSFORM: Readonly<ModelTransform> = Object.freeze({
    x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0,
});

/**
 * 逐建筑模型变换表（62 条，与 `buildingMeta` 一一对应）。
 *
 * **本表只作用于真实加载成功的 GLB 模型**：`buildModelPlacement` 只有在模型已经
 * 加载完成时才会被调用，因此这里的任何数值都不会影响元数据表（`building.ts`）以及
 * 它渲染出的彩色方块——GLB 缺失/加载失败时，回退渲染与未接入本表时完全一致。
 *
 * 每行注释里的 `· xxx.glb` 是该建筑当前实际匹配到的模型文件；
 * `tests/unit/models/modelTransform.spec.ts` 会校验「表里每一行都确实有 .glb 对应」，
 * 没有模型的建筑不应该出现在这张表里。
 */
export const modelTransform: Readonly<Record<number, ModelTransform>> = {
    // ── 传送带 / 分拣器 ────────────────────────────────────────────────
    35: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 低速传送带 · belt-1.glb
    36: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 高速传送带 · belt-2.glb
    37: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 极速传送带 · belt-3.glb
    41: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 低速分拣器 · inserter-1.glb
    42: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 高速分拣器 · inserter-2.glb
    43: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 极速分拣器 · inserter-3.glb
    483: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 集装分拣器 · inserter-4.glb

    // ── 四向分流器（三种变形共用 icon，模型按变形下标区分）───────────────
    38: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 四向分流器 a · splitter-1.glb
    39: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 四向分流器 b · splitter-2.glb
    40: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 四向分流器 c · splitter-3.glb

    // ── 物流设备 ──────────────────────────────────────────────────────
    257: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 自动集装机 · piler.glb
    208: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 流速监测器 · monitor.glb
    120: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 喷涂机 · spray-coater.glb
    371: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 物流配送器 · delivery-machine.glb
    49: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 物流运输站 · logistic-station.glb
    50: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 星际物流运输站 · interstellar-logistic-station.glb

    // ── 仓储 ─────────────────────────────────────────────────────────
    51: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 小型储物仓 · storage-1.glb
    52: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 大型储物仓 · storage-2.glb
    121: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 储液罐 · storage-tank.glb

    // ── 制造台 ───────────────────────────────────────────────────────
    65: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 制造台 Mk.I · assembler-1.glb
    66: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 制造台 Mk.II · assembler-2.glb
    67: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 制造台 Mk.III · assembler-3.glb
    456: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 制造台 Mk.IV · assembler-4.glb

    // ── 电力 ─────────────────────────────────────────────────────────
    44: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 电力感应塔 · tesla-coil.glb
    71: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 无线输电塔 · charging-pole.glb
    68: { x: 0, y: 0, z: -8, pitch: 0, yaw: 0, roll: 0 }, // 卫星配电站 · orbital-substation.glb
    53: { x: 0, y: 0, z: -3, pitch: 0, yaw: 0, roll: 0 }, // 风力涡轮机 · wind-turbine.glb
    54: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 火力发电厂 · fuel-plant.glb
    118: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 微型聚变发电站 · fusion-power-station.glb
    255: { x: 0, y: 0, z: -8, pitch: 0, yaw: 0, roll: 0 }, // 地热发电站 · geothermal-power-station.glb
    45: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 能量枢纽 · energy-exchanger.glb
    46: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 蓄电器 · accumulator.glb
    55: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 太阳能板 · solar-panel.glb
    72: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 电磁轨道弹射器 · em-rail-ejector.glb
    73: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 射线接收站 · ray-receiver.glb
    74: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 垂直发射井 · vertical-launching-silo.glb
    56: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 人造恒星 · fusion-reactor.glb

    // ── 采集 / 冶炼 / 化工 ─────────────────────────────────────────────
    57: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 采矿机 · mining-drill.glb
    256: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 大型采矿机 · mining-drill-mk2.glb
    60: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 抽水站 · water-pump.glb
    61: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 原油萃取站 · oil-extractor.glb
    63: { x: 0, y: 0, z: 0, pitch: 0, yaw: -180, roll: 0 }, // 原油精炼厂 · oil-refinery.glb
    62: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 电弧熔炉 · smelter.glb
    194: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 位面熔炉 · smelter-2.glb
    457: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 熔炉 Mk.III · smelter-3.glb
    64: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 化工厂 · chemical-plant.glb
    376: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 化工厂 Mk.II · chemical-plant-2.glb
    119: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 分馏塔 · fractionator.glb

    // ── 研究 / 大型设施 ───────────────────────────────────────────────
    69: { x: 0, y: 0, z: 0, pitch: 0, yaw: 180, roll: 0 }, // 微型粒子对撞机 · hadron-collider.glb
    70: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 矩阵研究站 · lab.glb
    455: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 矩阵研究站 Mk.II · lab-2.glb

    // ── 防御 ─────────────────────────────────────────────────────────
    374: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 高斯机枪塔 · turret-gauss.glb
    373: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 高频激光塔 · turret-laser.glb
    375: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 聚爆加农炮 · turret-cannon.glb
    408: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 磁化电浆炮 · turret-plasma.glb
    407: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 导弹防御塔 · turret-missile.glb
    403: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 信标 · turret-signal.glb
    402: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 护盾发生器 · turret-shield.glb
    482: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 地面电浆炮 · turret-plasma-ground.glb
    422: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 干扰塔 · turret-disturb.glb

    // ── 战场 / 其他 ───────────────────────────────────────────────────
    453: { x: 0, y: 0, z: 0, pitch: 0, yaw: -180, roll: 0 }, // 战场分析基站 · battle-base.glb
    664: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // 全息信标 · lighthouse.glb
};

/** 取某个建筑模型的变换；未登记时返回全 0（不抛错） */
export function modelTransformOf(modelIndex: number): Readonly<ModelTransform> {
    return modelTransform[modelIndex] ?? ZERO_MODEL_TRANSFORM;
}
