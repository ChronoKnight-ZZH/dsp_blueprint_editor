/**
 * 材质贴图清单（**自动生成，请勿手改**）
 *
 * 由 `node scripts/gen-texture-manifest.mjs` 从 `scripts/texture-mapping.json` 生成：
 * GLB 的底色图（内嵌）与磁盘 PNG 做 MD5 比对，锚定材质 → 再由文件名词干找同组
 * `-n`（法线）/ `-e`（自发光）/ `-s`（spec-gloss）三张贴图。
 *
 * 键格式：`<模型名>::<材质名>`，与 GLTFLoader 赋给材质的 `name` 一致。
 *
 * 这里只保留**文件路径**（相对仓库 `src/`）；真正的 URL 由 `@lib/asset-resolver`
 * 在模块初始化时解析（编辑器：webpack 的 publicPath URL；库：assetBaseUrl 拼接）。
 * 这样同一份清单既能喂给编辑器构建，也能喂给「资产外置」的 UMD/ESM 构建。
 */

import { assetResolver } from '@lib/asset-resolver';
import { currentAssetBaseUrl } from '@/lib/assets/assetBaseUrl';

/** 单个材质可用的外部通道贴图（解析后的 URL） */
export interface MaterialMapUrls {
    /** 法线图（切线空间，绿通道朝上） */
    readonly normal?: string;
    /** 自发光图 */
    readonly emissive?: string;
    /** Unity spec-gloss：RGB=高光色，A=光滑度 */
    readonly spec?: string;
}

/** 单个材质用到的贴图文件（`src/` 相对路径） */
export interface MaterialMapFiles {
    readonly normal?: string;
    readonly emissive?: string;
    readonly spec?: string;
}

export const materialTextureFiles: Readonly<Record<string, MaterialMapFiles>> = {
    "accumulator::accumulator": {
        normal: 'assets/icons/models/accumulator/accumulator-n.png',
        emissive: 'assets/icons/models/accumulator/accumulator-e.png',
        spec: 'assets/icons/models/accumulator/accumulator-s.png',
    },
    "assembler-1::assembler-mk-1": {
        normal: 'assets/icons/models/assembler/assembler-mk-n.png',
        emissive: 'assets/icons/models/assembler/assembler-mk-e.png',
        spec: 'assets/icons/models/assembler/assembler-mk-s.png',
    },
    "assembler-2::assembler-mk-2": {
        normal: 'assets/icons/models/assembler/assembler-mk-n.png',
        emissive: 'assets/icons/models/assembler/assembler-mk-e.png',
        spec: 'assets/icons/models/assembler/assembler-mk-s.png',
    },
    "assembler-3::assembler-mk-3": {
        normal: 'assets/icons/models/assembler/assembler-mk-n.png',
        emissive: 'assets/icons/models/assembler/assembler-mk-e.png',
        spec: 'assets/icons/models/assembler/assembler-mk-s.png',
    },
    "assembler-4::assembler-mk-4": {
        normal: 'assets/icons/models/assembler/assembler-mk-4-n.png',
        emissive: 'assets/icons/models/assembler/assembler-mk-4-e.png',
        spec: 'assets/icons/models/assembler/assembler-mk-4-s.png',
    },
    "battle-base::battle-base": {
        normal: 'assets/icons/models/battle base/battle-base-n.png',
        emissive: 'assets/icons/models/battle base/battle-base-e.png',
        spec: 'assets/icons/models/battle base/battle-base-s.png',
    },
    "charging-pole::charging-pole": {
        normal: 'assets/icons/models/charging pole/charging-pole-n.png',
        emissive: 'assets/icons/models/charging pole/charging-pole-e.png',
        spec: 'assets/icons/models/charging pole/charging-pole-s.png',
    },
    "chemical-plant-2::chemical-plant-2": {
        normal: 'assets/icons/models/chemical plant 2/chemical-plant-2-n.png',
        emissive: 'assets/icons/models/chemical plant 2/chemical-plant-2-e.png',
        spec: 'assets/icons/models/chemical plant 2/chemical-plant-2-s.png',
    },
    "chemical-plant::chemical-plant": {
        normal: 'assets/icons/models/chemical plant/chemical-plant-n.png',
        emissive: 'assets/icons/models/chemical plant/chemical-plant-e.png',
        spec: 'assets/icons/models/chemical plant/chemical-plant-s.png',
    },
    "construction-drone::player-drone": {
        normal: 'assets/icons/models/construction drone/construction-drone-n.png',
        emissive: 'assets/icons/models/construction drone/construction-drone-e.png',
        spec: 'assets/icons/models/construction drone/construction-drone-s.png',
    },
    "delivery-drone::delivery-drone": {
        normal: 'assets/icons/models/delivery courier/delivery-drone-lod0-n.png',
        emissive: 'assets/icons/models/delivery courier/delivery-drone-lod0-e.png',
        spec: 'assets/icons/models/delivery courier/delivery-drone-lod0-s.png',
    },
    "delivery-machine::delivery-machine": {
        normal: 'assets/icons/models/delivery machine/delivery-machine-n.png',
        emissive: 'assets/icons/models/delivery machine/delivery-machine-e.png',
        spec: 'assets/icons/models/delivery machine/delivery-machine-s.png',
    },
    "em-rail-ejector::em-rail-ejector": {
        normal: 'assets/icons/models/em rail ejector/em-rail-ejector-n.png',
        emissive: 'assets/icons/models/em rail ejector/em-rail-ejector-e.png',
        spec: 'assets/icons/models/em rail ejector/em-rail-ejector-s.png',
    },
    "energy-exchanger::energy-exchanger": {
        normal: 'assets/icons/models/energy exchanger/energy-exchanger-n.png',
        emissive: 'assets/icons/models/energy exchanger/energy-exchanger-e.png',
        spec: 'assets/icons/models/energy exchanger/energy-exchanger-s.png',
    },
    "fractionator::fractionator": {
        normal: 'assets/icons/models/fractionator/fractionator-n.png',
        emissive: 'assets/icons/models/fractionator/fractionator-e.png',
        spec: 'assets/icons/models/fractionator/fractionator-s.png',
    },
    "fuel-plant::power-generator-thermal": {
        normal: 'assets/icons/models/power generator/power-generator-n.png',
        emissive: 'assets/icons/models/power generator/power-generator-e.png',
        spec: 'assets/icons/models/power generator/power-generator-s.png',
    },
    "fusion-power-station::power-generator-fusion": {
        normal: 'assets/icons/models/fusion power station/fusion-power-station-n.png',
        emissive: 'assets/icons/models/fusion power station/fusion-power-station-e.png',
        spec: 'assets/icons/models/fusion power station/fusion-power-station-s.png',
    },
    "fusion-reactor::fusion-reactor": {
        normal: 'assets/icons/models/fusion reactor/fusion-reactor-n.png',
        emissive: 'assets/icons/models/fusion reactor/fusion-reactor-e.png',
        spec: 'assets/icons/models/fusion reactor/fusion-reactor-s.png',
    },
    "geothermal-power-station::geothermal-power-station": {
        normal: 'assets/icons/models/geothermal power station/geothermal-power-station-n.png',
        emissive: 'assets/icons/models/geothermal power station/geothermal-power-station-e.png',
        spec: 'assets/icons/models/geothermal power station/geothermal-power-station-s.png',
    },
    "hadron-collider::hadron-collider": {
        normal: 'assets/icons/models/hadron collider/hadron-collider-n.png',
        emissive: 'assets/icons/models/hadron collider/hadron-collider-e.png',
        spec: 'assets/icons/models/hadron collider/hadron-collider-s.png',
    },
    "inserter-1::inserter-1": {
        normal: 'assets/icons/models/inserter/inserter-n.png',
        spec: 'assets/icons/models/inserter/inserter-s.png',
    },
    "inserter-2::inserter-2": {
        normal: 'assets/icons/models/inserter/inserter-n.png',
        spec: 'assets/icons/models/inserter/inserter-s.png',
    },
    "inserter-3::inserter-3": {
        normal: 'assets/icons/models/inserter/inserter-n.png',
        spec: 'assets/icons/models/inserter/inserter-s.png',
    },
    "inserter-4::inserter-4": {
        normal: 'assets/icons/models/inserter/inserter-n.png',
        spec: 'assets/icons/models/inserter/inserter-s.png',
    },
    "interstellar-logistic-station::interstellar-logistic-station": {
        normal: 'assets/icons/models/logistic station/logistic-station-n.png',
        emissive: 'assets/icons/models/logistic station/logistic-station-e.png',
        spec: 'assets/icons/models/logistic station/logistic-station-s.png',
    },
    "lab-2::science-academy-2": {
        normal: 'assets/icons/models/science academy/science-academy-2-n.png',
        emissive: 'assets/icons/models/science academy/science-academy-2-e.png',
        spec: 'assets/icons/models/science academy/science-academy-2-s.png',
    },
    "lab::science-academy-1": {
        normal: 'assets/icons/models/science academy/science-academy-n-1.png',
        emissive: 'assets/icons/models/science academy/science-academy-e-1.png',
        spec: 'assets/icons/models/science academy/science-academy-s-1.png',
    },
    "lighthouse::lighthouse": {
        normal: 'assets/icons/models/lighthouse/lighthouse-n.png',
        emissive: 'assets/icons/models/lighthouse/lighthouse-e.png',
        spec: 'assets/icons/models/lighthouse/lighthouse-s.png',
    },
    "logistic-drone::logistic-drone-body": {
        normal: 'assets/icons/models/logistic station/logistic-vessel-n.png',
        emissive: 'assets/icons/models/logistic station/logistic-vessel-e.png',
        spec: 'assets/icons/models/logistic station/logistic-vessel-s.png',
    },
    "logistic-station::interstellar-logistic-station": {
        normal: 'assets/icons/models/logistic station/logistic-station-n.png',
        emissive: 'assets/icons/models/logistic station/logistic-station-e.png',
        spec: 'assets/icons/models/logistic station/logistic-station-s.png',
    },
    "logistic-vessel::logistic-vessel-body": {
        normal: 'assets/icons/models/logistic station/logistic-vessel-n.png',
        emissive: 'assets/icons/models/logistic station/logistic-vessel-e.png',
        spec: 'assets/icons/models/logistic station/logistic-vessel-s.png',
    },
    "mining-drill-mk2::mining-drill-mk2": {
        normal: 'assets/icons/models/mining drill mk2/mining-drill-mk2-n.png',
        emissive: 'assets/icons/models/mining drill mk2/mining-drill-mk2-e.png',
        spec: 'assets/icons/models/mining drill mk2/mining-drill-mk2-s.png',
    },
    "mining-drill::mining-drill": {
        normal: 'assets/icons/models/mining drill/mining-drill-n.png',
        emissive: 'assets/icons/models/mining drill/mining-drill-e.png',
        spec: 'assets/icons/models/mining drill/mining-drill-s.png',
    },
    "monitor::monitor": {
        normal: 'assets/icons/models/monitor/monitor-n.png',
        spec: 'assets/icons/models/monitor/monitor-s.png',
    },
    "oil-extractor::oil-extractor": {
        normal: 'assets/icons/models/oil extractor/oil-extractor-n.png',
        emissive: 'assets/icons/models/oil extractor/oil-extractor-e.png',
        spec: 'assets/icons/models/oil extractor/oil-extractor-s.png',
    },
    "oil-refinery::oil-refinery": {
        normal: 'assets/icons/models/oil refinery/oil-refinery-n.png',
        emissive: 'assets/icons/models/oil refinery/oil-refinery-e.png',
        spec: 'assets/icons/models/oil refinery/oil-refinery-s.png',
    },
    "orbital-collector::orbital-collector": {
        normal: 'assets/icons/models/orbital collector/orbital-collector-n.png',
        emissive: 'assets/icons/models/orbital collector/orbital-collector-e.png',
        spec: 'assets/icons/models/orbital collector/orbital-collector-s.png',
    },
    "orbital-substation::orbital-substation": {
        normal: 'assets/icons/models/orbital substation/orbital-substation-n.png',
        emissive: 'assets/icons/models/orbital substation/orbital-substation-e.png',
        spec: 'assets/icons/models/orbital substation/orbital-substation-s.png',
    },
    "piler::piler": {
        normal: 'assets/icons/models/piler/piler-n.png',
        emissive: 'assets/icons/models/piler/piler-e.png',
        spec: 'assets/icons/models/piler/piler-s.png',
    },
    "ray-receiver::ray-receiver": {
        normal: 'assets/icons/models/ray receiver/ray-receiver-n.png',
        emissive: 'assets/icons/models/ray receiver/ray-receiver-e.png',
        spec: 'assets/icons/models/ray receiver/ray-receiver-s.png',
    },
    "rocket::rocket": {
        normal: 'assets/icons/models/vertical launching silo/vl-silo-n.png',
        emissive: 'assets/icons/models/vertical launching silo/vl-silo-e.png',
        spec: 'assets/icons/models/vertical launching silo/vl-silo-s.png',
    },
    "smelter-2::smelter-2-lod0": {
        normal: 'assets/icons/models/smelter 2/smelter-2-lod0-n.png',
        emissive: 'assets/icons/models/smelter 2/smelter-2-lod0-e.png',
        spec: 'assets/icons/models/smelter 2/smelter-2-lod0-s.png',
    },
    "smelter-2::smelter-2-glass-1": {
        emissive: 'assets/icons/models/smelter 2/smelter-2-glass-e.png',
        spec: 'assets/icons/models/smelter 2/smelter-2-glass-s.png',
    },
    "smelter-2::smelter-2-glass-2": {
        emissive: 'assets/icons/models/smelter 2/smelter-2-glass-e.png',
        spec: 'assets/icons/models/smelter 2/smelter-2-glass-s.png',
    },
    "smelter-3::smelter-3-lod0": {
        normal: 'assets/icons/models/smelter 3/smelter-3-lod0-n.png',
        emissive: 'assets/icons/models/smelter 3/smelter-3-lod0-e.png',
        spec: 'assets/icons/models/smelter 3/smelter-3-lod0-s.png',
    },
    "smelter::smelter-lod0": {
        normal: 'assets/icons/models/smelter/smelter-n-lod0.png',
        emissive: 'assets/icons/models/smelter/smelter-e.png',
        spec: 'assets/icons/models/smelter/smelter-s-lod0.png',
    },
    "solar-panel::solar-panel": {
        normal: 'assets/icons/models/solar panel/solar-panel-n.png',
        emissive: 'assets/icons/models/solar panel/solar-panel-e.png',
        spec: 'assets/icons/models/solar panel/solar-panel-s.png',
    },
    "splitter-a::splitter": {
        normal: 'assets/icons/models/splitter/splitter-n.png',
        spec: 'assets/icons/models/splitter/splitter-s.png',
    },
    "splitter-b::splitter": {
        normal: 'assets/icons/models/splitter/splitter-n.png',
        spec: 'assets/icons/models/splitter/splitter-s.png',
    },
    "splitter-c::splitter": {
        normal: 'assets/icons/models/splitter/splitter-n.png',
        spec: 'assets/icons/models/splitter/splitter-s.png',
    },
    "spray-coater::spray-coater-lod0": {
        normal: 'assets/icons/models/spray coater/spray-coater-n-lod0.png',
        emissive: 'assets/icons/models/spray coater/spray-coater-e-lod0.png',
        spec: 'assets/icons/models/spray coater/spray-coater-s-lod0.png',
    },
    "storage-1::storage": {
        normal: 'assets/icons/models/storage/storage-n.png',
        emissive: 'assets/icons/models/storage/storage-e.png',
        spec: 'assets/icons/models/storage/storage-s.png',
    },
    "storage-2::storage": {
        normal: 'assets/icons/models/storage/storage-n.png',
        emissive: 'assets/icons/models/storage/storage-e.png',
        spec: 'assets/icons/models/storage/storage-s.png',
    },
    "storage-tank::storage-tank": {
        normal: 'assets/icons/models/storage tank/storage-tank-n.png',
        emissive: 'assets/icons/models/storage tank/storage-tank-e.png',
        spec: 'assets/icons/models/storage tank/storage-tank-s.png',
    },
    "tesla-coil::tesla-tower-1": {
        normal: 'assets/icons/models/tesla tower/tesla-tower-1n.png',
        emissive: 'assets/icons/models/tesla tower/tesla-tower-1e.png',
        spec: 'assets/icons/models/tesla tower/tesla-tower-1s.png',
    },
    "turret-cannon::turret-cannon": {
        normal: 'assets/icons/models/turret cannon/turret-cannon-n.png',
        emissive: 'assets/icons/models/turret cannon/turret-cannon-e.png',
        spec: 'assets/icons/models/turret cannon/turret-cannon-s.png',
    },
    "turret-disturb::turret-disturb": {
        normal: 'assets/icons/models/turret disturb/turret-disturb-n.png',
        emissive: 'assets/icons/models/turret disturb/turret-disturb-e.png',
        spec: 'assets/icons/models/turret disturb/turret-disturb-s.png',
    },
    "turret-gauss::turret-gauss-lod0": {
        normal: 'assets/icons/models/turret gauss/turret-gauss-lod0-n.png',
        emissive: 'assets/icons/models/turret gauss/turret-gauss-lod0-e.png',
        spec: 'assets/icons/models/turret gauss/turret-gauss-lod0-s.png',
    },
    "turret-laser::turret-laser-lod0": {
        normal: 'assets/icons/models/turret laser/turret-laser-lod0-n.png',
        emissive: 'assets/icons/models/turret laser/turret-laser-lod0-e.png',
        spec: 'assets/icons/models/turret laser/turret-laser-lod0-s.png',
    },
    "turret-missile::turret-missile": {
        normal: 'assets/icons/models/turret missile/turret-missile-n.png',
        emissive: 'assets/icons/models/turret missile/turret-missile-e.png',
        spec: 'assets/icons/models/turret missile/turret-missile-s.png',
    },
    "turret-plasma-ground::turret-plasma-ground": {
        normal: 'assets/icons/models/turret plasma ground/turret-plasma-ground-n.png',
        emissive: 'assets/icons/models/turret plasma ground/turret-plasma-ground-e.png',
        spec: 'assets/icons/models/turret plasma ground/turret-plasma-ground-s.png',
    },
    "turret-plasma::turret-plasma-lod0": {
        normal: 'assets/icons/models/turret plasma/turret-plasma-lod0-n.png',
        emissive: 'assets/icons/models/turret plasma/turret-plasma-lod0-e.png',
        spec: 'assets/icons/models/turret plasma/turret-plasma-lod0-s.png',
    },
    "turret-shield::turret-shield": {
        normal: 'assets/icons/models/turret shield/turret-shield-n.png',
        emissive: 'assets/icons/models/turret shield/turret-shield-e.png',
        spec: 'assets/icons/models/turret shield/turret-shield-s.png',
    },
    "turret-signal::turret-signal-lod0": {
        normal: 'assets/icons/models/turret signal/turret-signal-lod0-n.png',
        emissive: 'assets/icons/models/turret signal/turret-signal-lod0-e.png',
        spec: 'assets/icons/models/turret signal/turret-signal-lod0-s.png',
    },
    "vertical-launching-silo::vl-silo": {
        normal: 'assets/icons/models/vertical launching silo/vl-silo-n.png',
        emissive: 'assets/icons/models/vertical launching silo/vl-silo-e.png',
        spec: 'assets/icons/models/vertical launching silo/vl-silo-s.png',
    },
    "water-pump::water-pump": {
        normal: 'assets/icons/models/water pump/water-pump-n.png',
        emissive: 'assets/icons/models/water pump/water-pump-e.png',
        spec: 'assets/icons/models/water pump/water-pump-s.png',
    },
    "wind-turbine::wind-turbine-mat": {
        normal: 'assets/icons/models/wind turbine/wind-turbine-n.png',
        emissive: 'assets/icons/models/wind turbine/wind-turbine-e.png',
        spec: 'assets/icons/models/wind turbine/wind-turbine-s.png',
    },
};

/** 文件路径 → 最终 URL（由资产解析器决定具体形态） */
function toUrls(files: MaterialMapFiles): MaterialMapUrls {
    return {
        normal: files.normal === undefined ? undefined : assetResolver.modelTextureUrl(files.normal) ?? undefined,
        emissive: files.emissive === undefined ? undefined : assetResolver.modelTextureUrl(files.emissive) ?? undefined,
        spec: files.spec === undefined ? undefined : assetResolver.modelTextureUrl(files.spec) ?? undefined,
    };
}

function buildUrlMap(): Record<string, MaterialMapUrls> {
    const map: Record<string, MaterialMapUrls> = {};
    for (const [key, files] of Object.entries(materialTextureFiles))
        map[key] = toUrls(files);
    return map;
}

/**
 * 按当前资产根地址缓存的 URL 表。
 *
 * 为什么不在模块初始化时一次性算死：宿主可以在**加载库之后**才调
 * `configureAssetBaseUrl(...)`（UMD 场景的常见顺序），若 URL 在此刻就被固化成字符串，
 * 贴图会全部指到自动探测的目录上。这里按 base 缓存，base 变了就重建一次。
 */
const urlMapsByBase = new Map<string, Record<string, MaterialMapUrls>>();

function urlMapForCurrentBase(): Record<string, MaterialMapUrls> {
    const base = currentAssetBaseUrl();
    let map = urlMapsByBase.get(base);
    if (map === undefined) {
        map = buildUrlMap();
        urlMapsByBase.set(base, map);
    }
    return map;
}

/**
 * 材质 → 通道贴图 URL（渲染时按 `<模型名>::<材质名>` 查）。
 *
 * 用 Proxy 包一层，保证每次读取/枚举都取「当前生效的资产根地址」，同时对
 * `materialMapUrls[key]`、`Object.entries(...)`、`key in materialMapUrls` 都保持普通对象语义。
 */
export const materialMapUrls: Readonly<Record<string, MaterialMapUrls>> =
    new Proxy({} as Record<string, MaterialMapUrls>, {
        get(_target, property) {
            return typeof property === 'string' ? urlMapForCurrentBase()[property] : undefined;
        },
        has(_target, property) {
            return typeof property === 'string' && property in urlMapForCurrentBase();
        },
        ownKeys() {
            return Reflect.ownKeys(urlMapForCurrentBase());
        },
        getOwnPropertyDescriptor(_target, property) {
            if (typeof property !== 'string')
                return undefined;
            const map = urlMapForCurrentBase();
            if (!(property in map))
                return undefined;
            return { configurable: true, enumerable: true, value: map[property], writable: false };
        },
    });

/** 清单中全部会加载的贴图（供测试与清理脚本核对），去重后按字典序排列 */
export const manifestTextureFiles: readonly string[] = Array.from(new Set(
    Object.values(materialTextureFiles)
        .flatMap(files => [files.normal, files.emissive, files.spec])
        .filter((path): path is string => path !== undefined),
)).sort();
