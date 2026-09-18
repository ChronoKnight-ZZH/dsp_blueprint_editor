import { AcceleratorMode, AssembleParamerters, BlueprintBuilding, BlueprintData, LabParamerters } from "./parser";
import { Command, Updater } from "@/command";

/**
 * 一键设置“生产加速 / 额外产出”的过滤条件。
 *
 * @typedef {object} SetAcceleratorParams
 * @property {AcceleratorMode} mode 目标模式（Accelerate / ExtraOutput）
 * @property {number[]} [buildingIndexes] 只作用于这些建筑；省略则对全蓝图生效
 * @property {boolean}  [labOnly]         只作用于研究站（2901 / 2902）
 */
export interface SetAcceleratorParams {
    mode: AcceleratorMode;
    buildingIndexes?: number[];
    labOnly?: boolean;
}

/**
 * 一键设置“生产加速 / 额外产出”的撤销命令。
 *
 * 作用范围：所有带 `acceleratorMode` 字段的参数，即由 {@link assembleParamParser}
 * 与 {@link labParamParser} 解析的建筑（制造台/熔炉/精炼厂/化工厂/对撞机/研究站）。
 *
 * 构造时快照每个建筑的原始模式，`do` 统一设为目标模式，
 * `undo` 逐建筑精确恢复——混合模式场景下撤销也不会错乱。
 *
 * @class SetAcceleratorCommand
 * @implements {Command}
 * @example
 * ```ts
 * import { AcceleratorMode } from '@/blueprint/parser';
 * // 全蓝图设为“生产加速”
 * queue.push(new SetAcceleratorCommand(bp, { mode: AcceleratorMode.Accelerate }));
 * // 只把被替换到的建筑设为“额外产出”
 * queue.push(new SetAcceleratorCommand(bp, {
 *   mode: AcceleratorMode.ExtraOutput,
 *   buildingIndexes: [3, 7, 9],
 * }));
 * ```
 */
export class SetAcceleratorCommand implements Command {
    /** 只改 acceleratorMode 字段，几何不变 → 局部刷新 */
    readonly silent = true;

    /** 目标模式 @type {AcceleratorMode} */
    targetMode: AcceleratorMode;

    /** 命中的建筑列表 @type {BlueprintBuilding[]} */
    buildings: BlueprintBuilding[] = [];

    /** 与 `buildings` 一一对应的原始加速模式 @type {AcceleratorMode[]} */
    originalModes: AcceleratorMode[] = [];

    /**
     * 构造命令，收集目标建筑并快照原始模式。
     *
     * @param {BlueprintData} bp 蓝图数据
     * @param {SetAcceleratorParams} params 目标模式 + 过滤条件
     */
    constructor(bp: BlueprintData, params: SetAcceleratorParams) {
        this.targetMode = params.mode;

        const indexSet = params.buildingIndexes ? new Set(params.buildingIndexes) : null;
        for (const b of bp.buildings) {
            if (indexSet && !indexSet.has(b.index))
                continue;
            if (params.labOnly && b.itemId !== 2901 && b.itemId !== 2902)
                continue;

            const p = b.parameters as AssembleParamerters | LabParamerters | null;
            if (!p || !('acceleratorMode' in p))
                continue;

            this.buildings.push(b);
            this.originalModes.push(p.acceleratorMode);
        }
    }

    /**
     * 把每个建筑的加速模式写成给定数组，并派发增量刷新。
     *
     * @param {AcceleratorMode[]} modes 与 `buildings` 等长的模式数组
     * @param {Updater} updater 增量更新通道
     * @internal
     */
    private apply(modes: AcceleratorMode[], updater: Updater) {
        for (let i = 0; i < this.buildings.length; i++) {
            const b = this.buildings[i];
            (b.parameters as AssembleParamerters).acceleratorMode = modes[i];
            updater.updateBuildingIcon.dispatch(b);
        }
    }

    /**
     * 执行：把所有目标建筑统一设为目标模式。
     *
     * @param {BlueprintData} _data 未使用（满足 {@link Command} 接口）
     * @param {Updater} updater 增量更新通道
     */
    do(_data: BlueprintData, updater: Updater) {
        this.apply(this.buildings.map(() => this.targetMode), updater);
    }

    /**
     * 撤销：逐建筑恢复原始模式。
     *
     * @param {BlueprintData} _data 未使用
     * @param {Updater} updater 增量更新通道
     */
    undo(_data: BlueprintData, updater: Updater) {
        this.apply(this.originalModes, updater);
    }

    /**
     * 不与上一条命令合并。
     * @returns {boolean} 恒为 `false`
     */
    merge() { return false; }
}