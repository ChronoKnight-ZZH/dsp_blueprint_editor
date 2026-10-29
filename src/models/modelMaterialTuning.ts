/**
 * 建筑模型材质参数表（**唯一的手调入口**）
 *
 * 每个 GLB 模型一条，三个参数含义：
 *
 * - `emissiveIntensity`  自发光强度。只在模型带 `-e` 贴图时生效（无 `-e` 的模型该值被忽略）。
 *                        调大 → 夜间/暗部的灯带、炉火、屏幕更亮；调到 0 等于关掉自发光。
 * - `envMapIntensity`    环境反射强度（场景里那张程序化中性环境贴图的影响权重）。
 *                        调大 → 金属更亮更有反射；调小 → 更接近纯漫反射的哑光。
 * - `metalness`          金属度。有 `-s` 贴图时它是**乘数**（1 = 完全按贴图推导的金属度，
 *                        0.5 = 整体减半更偏塑料）；没有 `-s` 贴图时它按 `METALNESS_WITHOUT_SPEC_MAP`
 *                        缩放后作为固定金属度（避免无环境反射时发黑）。
 *
 * 调参建议：整批偏暗先动 `envMapIntensity`（0.6~1.2），发光过曝先动 `emissiveIntensity`（0.6~1.5），
 * 塑料感太强再动 `metalness`（0.4~1.0）。改完刷新页面即可，不需要重新生成清单。
 */

/** 单个模型的材质参数 */
export interface ModelMaterialTuning {
    /** 自发光强度（需要 `-e` 贴图才有意义） */
    readonly emissiveIntensity: number;
    /** 环境反射强度 */
    readonly envMapIntensity: number;
    /** 金属度（有 `-s` 贴图时作为乘数） */
    readonly metalness: number;
}

/** 没有单独配置的模型使用的默认值 */
export const DEFAULT_MODEL_MATERIAL_TUNING: ModelMaterialTuning = Object.freeze({
    emissiveIntensity: 1.0,
    envMapIntensity: 0.8,
    metalness: 1.0,
});

/** 没有 `-s` 贴图时，把 `metalness` 缩到这个基准值再套用，避免纯金属无反射发黑 */
export const METALNESS_WITHOUT_SPEC_MAP = 0.25;

/**
 * `模型名 → 参数`。键就是 `.glb` 文件名（不含扩展名）。
 *
 * 每条后面的注释标注了该模型实际可用的通道贴图，方便判断某个参数调了是否有效。
 */
export const modelMaterialTunings: Readonly<Record<string, Partial<ModelMaterialTuning>>> = {
    /** 蓄电器〔n+e+s〕 */
    'accumulator': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 制造台（旧模型，与 assembler-1 逐字节相同）〔n+e+s〕 */
    'assembler': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 制造台 Mk.I〔n+e+s〕 */
    'assembler-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 制造台 Mk.II〔n+e+s〕 */
    'assembler-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 制造台 Mk.III〔n+e+s〕 */
    'assembler-3': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 制造台 Mk.IV〔n+e+s〕 */
    'assembler-4': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 战场分析基站〔n+e+s〕 */
    'battle-base': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 低速传送带〔无通道图〕 */
    'belt-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 高速传送带〔无通道图〕 */
    'belt-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 极速传送带〔无通道图〕 */
    'belt-3': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 无线输电塔〔n+e+s〕 */
    'charging-pole': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 化工厂〔n+e+s〕 */
    'chemical-plant': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 化工厂 Mk.II〔n+e+s〕 */
    'chemical-plant-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 建设机〔n+e+s〕 */
    'construction-drone': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 配送机〔n+e+s〕 */
    'delivery-drone': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 物流配送器〔n+e+s〕 */
    'delivery-machine': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 电磁轨道弹射器〔n+e+s〕 */
    'em-rail-ejector': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 能量枢纽〔n+e+s〕 */
    'energy-exchanger': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 能量枢纽挂件 0〔无通道图〕 */
    'energy-exchanger-mcl-0': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 能量枢纽挂件 1〔无通道图〕 */
    'energy-exchanger-mcl-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 能量枢纽挂件 2〔无通道图〕 */
    'energy-exchanger-mcl-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 分馏塔〔n+e+s〕 */
    'fractionator': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 火力发电厂〔n+e+s〕 */
    'fuel-plant': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 微型聚变发电站〔n+e+s〕 */
    'fusion-power-station': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 人造恒星〔n+e+s〕 */
    'fusion-reactor': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 地热发电站〔n+e+s〕 */
    'geothermal-power-station': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 微型粒子对撞机〔n+e+s〕 */
    'hadron-collider': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 低速分拣器〔n+s〕 */
    'inserter-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 高速分拣器〔n+s〕 */
    'inserter-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 极速分拣器〔n+s〕 */
    'inserter-3': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 集装分拣器〔n+s〕 */
    'inserter-4': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 星际物流运输站〔n+e+s〕 */
    'interstellar-logistic-station': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 矩阵研究站〔n+e+s〕 */
    'lab': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 矩阵研究站 Mk.II〔n+e+s〕 */
    'lab-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 全息信标〔n+e+s〕 */
    'lighthouse': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 物流运输机〔n+e+s〕 */
    'logistic-drone': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 物流运输站〔n+e+s〕 */
    'logistic-station': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 运输船〔n+e+s〕 */
    'logistic-vessel': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 采矿机〔n+e+s〕 */
    'mining-drill': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 大型采矿机〔n+e+s〕 */
    'mining-drill-mk2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 流速监测器〔n+s〕 */
    'monitor': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 原油萃取站〔n+e+s〕 */
    'oil-extractor': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 原油精炼厂〔n+e+s〕 */
    'oil-refinery': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 轨道采集器〔n+e+s〕 */
    'orbital-collector': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 卫星配电站〔n+e+s〕 */
    'orbital-substation': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 自动集装机〔n+e+s〕 */
    'piler': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 发电设备（power-generator）〔n+e+s〕 */
    'power-generator': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 射线接收站〔n+e+s〕 */
    'ray-receiver': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 运载火箭〔n+e+s〕 */
    'rocket': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 电弧熔炉〔n+e+s〕 */
    'smelter': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 位面熔炉〔n+e+s〕 */
    'smelter-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 熔炉 Mk.III〔n+e+s〕 */
    'smelter-3': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 太阳能板〔n+e+s〕 */
    'solar-panel': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 太空舱〔无通道图〕 */
    'space-capsule': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 a〔无通道图〕 */
    'splitter-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 b〔无通道图〕 */
    'splitter-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 c〔无通道图〕 */
    'splitter-3': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 a〔n+s〕 */
    'splitter-a': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 b〔n+s〕 */
    'splitter-b': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 四向分流器 c〔n+s〕 */
    'splitter-c': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 喷涂机〔n+e+s〕 */
    'spray-coater': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 石墙〔无通道图〕 */
    'stone-wall': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 小型储物仓〔n+e+s〕 */
    'storage-1': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 大型储物仓〔n+e+s〕 */
    'storage-2': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 储液罐〔n+e+s〕 */
    'storage-tank': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 电力感应塔〔无通道图〕 */
    'tesla-coil': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 聚爆加农炮〔n+e+s〕 */
    'turret-cannon': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 干扰塔〔n+e+s〕 */
    'turret-disturb': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 高斯机枪塔〔n+e+s〕 */
    'turret-gauss': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 高频激光塔〔n+e+s〕 */
    'turret-laser': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 导弹防御塔〔n+e+s〕 */
    'turret-missile': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 磁化电浆炮〔n+e+s〕 */
    'turret-plasma': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 地面电浆炮〔n+e+s〕 */
    'turret-plasma-ground': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 护盾发生器〔n+e+s〕 */
    'turret-shield': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 信标〔n+e+s〕 */
    'turret-signal': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 垂直发射井〔n+e+s〕 */
    'vertical-launching-silo': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 抽水站〔n+e+s〕 */
    'water-pump': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
    /** 风力涡轮机〔n+e+s〕 */
    'wind-turbine': { emissiveIntensity: 1.0, envMapIntensity: 0.8, metalness: 1.0 },
};

/** 取某个模型的参数：优先表里的配置，缺字段用默认值补齐 */
export function resolveModelMaterialTuning(modelName: string): ModelMaterialTuning {
    const custom = modelMaterialTunings[modelName];
    if (custom === undefined)
        return DEFAULT_MODEL_MATERIAL_TUNING;
    return {
        emissiveIntensity: custom.emissiveIntensity ?? DEFAULT_MODEL_MATERIAL_TUNING.emissiveIntensity,
        envMapIntensity: custom.envMapIntensity ?? DEFAULT_MODEL_MATERIAL_TUNING.envMapIntensity,
        metalness: custom.metalness ?? DEFAULT_MODEL_MATERIAL_TUNING.metalness,
    };
}
