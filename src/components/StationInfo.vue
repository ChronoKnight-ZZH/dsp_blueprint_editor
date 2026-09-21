<template>
    <template v-for="(s, i) in storageList" :key="i">
        <div class="station-storage">
            <ItemSelect :item-id="s.itemId > 0 ? s.itemId : null"
                @update:item-id="itemId => setItemId(i, itemId)"/>
            <template v-if="s.itemId > 0">
                <!-- 现有数量固定 0，进度条占位；滑块控制上限 -->
                <div class="num">
                    <div class="progress">
                        <div class="progress-track">
                            <div class="progress-fill" style="width: 0%"></div>
                        </div>
                        <span class="progress-text">0 / {{ s.max.toLocaleString() }}</span>
                    </div>
                    <ParamSlider :label="t('货物上限')"
                        :value="s.max"
                        :steps="maxSteps"
                        :format="v => v.toLocaleString()"
                        @change="v => setStorageMax(i, v)" />
                </div>
                <!-- 本地/星际物流状态：带颜色区分的下拉框 -->
                <div class="roles">
                    <select class="role" :class="roleClass(s.localLogic)" :value="s.localLogic"
                        @change="e => setStorageLogic(i, 'localLogic', Number((e.target as HTMLSelectElement).value))">
                        <option :value="LogisticRole.Supply">{{ t('本地供应') }}</option>
                        <option :value="LogisticRole.None">{{ t('本地仓储') }}</option>
                        <option :value="LogisticRole.Demand">{{ t('本地需求') }}</option>
                    </select>
                    <select v-if="inter" class="role" :class="roleClass(s.remoteLogic)" :value="s.remoteLogic"
                        @change="e => setStorageLogic(i, 'remoteLogic', Number((e.target as HTMLSelectElement).value))">
                        <option :value="LogisticRole.Supply">{{ t('星际供应') }}</option>
                        <option :value="LogisticRole.None">{{ t('星际仓储') }}</option>
                        <option :value="LogisticRole.Demand">{{ t('星际需求') }}</option>
                    </select>
                </div>
            </template>
            <div class="placeholder" v-else>{{ t('空栏位') }}</div>
        </div>
    </template>

    <!-- 自动补充 -->
    <div class="building-params" v-if="!collector">
        <h3>{{ t('自动补充提示') }}</h3>
        <div class="switch-row">
            <label>{{ t('物流运输机') }}</label>
            <input type="checkbox" :checked="p.droneAutoReplenish"
                @change="e => setParam('droneAutoReplenish', (e.target as HTMLInputElement).checked)" />
        </div>
        <div class="switch-row" v-if="inter">
            <label>{{ t('星际物流运输船') }}</label>
            <input type="checkbox" :checked="p.shipAutoReplenish"
                @change="e => setParam('shipAutoReplenish', (e.target as HTMLInputElement).checked)" />
        </div>
    </div>

    <div class="building-params">
        <!-- 最大充能功率 -->
        <ParamSlider v-if="!collector"
            :label="t('最大充能功率')"
            :value="energyToMw(p.workEnergyPerTick)"
            :steps="energySteps"
            :format="v => v.toLocaleString([], { maximumFractionDigits: 0 }) + ' MW'"
            @change="v => setParam('workEnergyPerTick', mwToEnergy(v))" />

        <!-- 运输机最远路程 -->
        <ParamSlider v-if="!collector"
            :label="t('运输机最远路程')"
            :value="droneRangeToDeg(p.tripRangeOfDrones)"
            :steps="droneRangeSteps"
            :format="v => v.toLocaleString([], { maximumFractionDigits: 0 }) + '°'"
            @change="v => setParam('tripRangeOfDrones', degToDroneRange(v))" />

        <!-- 运输船最远路程 -->
        <ParamSlider v-if="inter"
            :label="t('运输船最远路程')"
            :value="shipRangeToLy(p.tripRangeOfShips)"
            :steps="shipRangeSteps"
            :format="v => v >= 10000 ? '∞' : v.toLocaleString([], { maximumFractionDigits: 0 }) + ' ly'"
            @change="v => setParam('tripRangeOfShips', v >= 10000 ? lyToShipRange(10000) : lyToShipRange(v))" />

        <!-- 轨道采集器开关 -->
        <div class="switch-row" v-if="inter">
            <label>{{ t('轨道采集器') }}</label>
            <input type="checkbox" :checked="p.includeOrbitCollector"
                @change="e => setParam('includeOrbitCollector', (e.target as HTMLInputElement).checked)" />
        </div>

        <!-- 曲速启用路程 -->
        <ParamSlider v-if="inter"
            :label="t('曲速启用路程')"
            :value="warpToAu(p.warpEnableDistance)"
            :steps="warpSteps"
            :format="v => v + ' AU'"
            @change="v => setParam('warpEnableDistance', auToWarp(v))" />

        <!-- 翘曲器必要性开关 -->
        <div class="switch-row" v-if="inter">
            <label>{{ t('翘曲器必要性') }}</label>
            <input type="checkbox" :checked="p.warperNecessary"
                @change="e => setParam('warperNecessary', (e.target as HTMLInputElement).checked)" />
        </div>

        <!-- 运输机起送量 -->
        <ParamSlider v-if="!collector"
            :label="t('运输机起送量')"
            :value="p.deliveryAmountOfDrones"
            :steps="deliverySteps"
            :format="v => v + '%'"
            @change="v => setParam('deliveryAmountOfDrones', v)" />

        <!-- 运输船起送量 -->
        <ParamSlider v-if="inter"
            :label="t('运输船起送量')"
            :value="p.deliveryAmountOfShips"
            :steps="deliverySteps"
            :format="v => v + '%'"
            @change="v => setParam('deliveryAmountOfShips', v)" />

        <!-- 采集速度 -->
        <ParamSlider v-if="collector"
            :label="t('采集速度')"
            :value="pc.miningSpeed"
            :steps="miningSteps"
            :format="v => (v / 100).toLocaleString([], { maximumFractionDigits: 0 }) + '%'"
            @change="v => setMiningSpeed(v)" />

        <!-- 货物集装数量 -->
        <ParamSlider
            :label="t('货物集装数量')"
            :value="p.pilerCount"
            :steps="pilerSteps"
            :format="v => v === 0 ? t('集装使用科技上限') : String(v)"
            @change="v => setParam('pilerCount', v)" />
    </div>
</template>

<script lang="ts">
import { LogisticRole, BlueprintBuilding, StationParameters, BlueprintData } from '@/blueprint/parser';
import { Command, Updater } from '@/command';
import { BuildingInfo } from '@/blueprint/buildingInfo';
import { itemIconId } from '@/data/icons';

class SetStationStorageItemCommand implements Command {
    public readonly previousItemId;
    public readonly previousLocalLogic;
    public readonly previousRemoteLogic;
    public readonly previousMax;
    public readonly belts: BlueprintBuilding[];

    constructor(
        public readonly building: BlueprintBuilding,
        buildingInfo: BuildingInfo,
        public readonly storageIndex: number,
        public readonly newItemId: number,
    ) {
        const p = building.parameters as StationParameters;
        const s = p.storage[storageIndex];
        this.previousItemId = s.itemId;
        this.previousLocalLogic = s.localLogic;
        this.previousRemoteLogic = s.remoteLogic;
        this.previousMax = s.max;

        this.belts = [];
        const adj = buildingInfo.adjacency[this.building.index];
        for (let i = 0; i < p.slots.length; i++) {
            if (p.slots[i].storageIdx - 1 === storageIndex) {
                const belt = adj[i];
                if (belt) {
                    this.belts.push(belt);
                }
            }
        }
    }
    private setItemId(itemId: number, updater: Updater) {
        const p = this.building.parameters as StationParameters;
        const s = p.storage[this.storageIndex];

        s.itemId = itemId;
        updater.updateStationInfo.dispatch(this.building);
        for (const belt of this.belts) {
            if (itemId === null)
                belt.parameters = null;
            else
                belt.parameters = { iconId: itemIconId(itemId), count: 0 };
            updater.updateBeltIcon.dispatch(belt);
        }
    }
    do(data: BlueprintData, updater: Updater): void {
        // 每次设置物品时，强制重置为默认值：本地供应 + 星际供应，上限 20000
        if (this.newItemId !== 0) {
            const s = (this.building.parameters as StationParameters).storage[this.storageIndex];
            s.localLogic = LogisticRole.Supply;
            s.remoteLogic = LogisticRole.Supply;
            s.max = 20000;
        }
        this.setItemId(this.newItemId, updater);
    }
    undo(data: BlueprintData, updater: Updater): void {
        const s = (this.building.parameters as StationParameters).storage[this.storageIndex];
        s.localLogic = this.previousLocalLogic;
        s.remoteLogic = this.previousRemoteLogic;
        s.max = this.previousMax;
        this.setItemId(this.previousItemId, updater);
    }
    merge() { return false; }
    /** 只改 storage 数据，不改几何/拓扑 → 局部刷新，不重建 3D 场景 */
    readonly silent = true;
}

/**
 * 通用物流塔参数修改命令。
 * 只改 storage / 标量数据，不改几何/拓扑 → silent，只触发 stateVersion++。
 */
class SetStationParamCommand implements Command {
    constructor(
        public readonly building: BlueprintBuilding,
        private readonly applyFn: (p: StationParameters) => void,
        private readonly revertFn: (p: StationParameters) => void,
    ) {}
    do(data: BlueprintData, updater: Updater): void {
        this.applyFn(this.building.parameters as StationParameters);
        updater.updateStationInfo.dispatch(this.building);
    }
    undo(data: BlueprintData, updater: Updater): void {
        this.revertFn(this.building.parameters as StationParameters);
        updater.updateStationInfo.dispatch(this.building);
    }
    merge() { return false; }
    /** 只改数据 → 局部刷新，不重建 3D 场景 */
    readonly silent = true;
}
</script>

<script lang="ts" setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdvancedMiningMachineParameters } from '@/blueprint/parser';
import { isAdvancedMiningMachine, isInterstellarStation } from '@/data/items';
import { buildingInfoKey, commandQueueKey } from '@/define';
import ItemSelect from './ItemSelect.vue';
import ParamSlider from './ParamSlider.vue';

const { t } = useI18n();

const props = defineProps<{
    building: BlueprintBuilding,
}>();

const buildingInfo = inject(buildingInfoKey)!.value!;
const commandQueue = inject(commandQueueKey)!.value!;
const stateVersion = commandQueue.stateVersion;

// 关键改动：返回浅拷贝，保证 silent 命令后标量参数也能刷新模板
const p = computed(() => {
    stateVersion.value;
    return { ...(props.building.parameters as StationParameters) };
});
const pc = computed(() => {
    stateVersion.value;
    return { ...(props.building.parameters as AdvancedMiningMachineParameters) };
});

const storageList = computed(() => {
    stateVersion.value;
    return [...p.value.storage];
});

const inter = computed(() => isInterstellarStation(props.building.itemId));
const collector = computed(() => isAdvancedMiningMachine(props.building.itemId));

// 物流状态颜色：供应=蓝、需求=橙、仓储=灰
const roleClass = (role: LogisticRole) =>
    role === LogisticRole.Supply ? 'role-supply'
    : role === LogisticRole.Demand ? 'role-demand'
    : 'role-none';

// ---------- 通用 setter ----------
function pushParam(applyFn: (p: StationParameters) => void, revertFn: (p: StationParameters) => void) {
    commandQueue.push(new SetStationParamCommand(props.building, applyFn, revertFn));
}

const setParam = <K extends keyof StationParameters>(key: K, value: StationParameters[K]) => {
    const bp = props.building.parameters as StationParameters;
    if (bp[key] === value) return;
    const old = bp[key];
    pushParam(
        (p) => { p[key] = value; },
        (p) => { p[key] = old; },
    );
};

// 采集速度属于 AdvancedMiningMachineParameters（StationParameters 的子类型），单独处理
const setMiningSpeed = (value: number) => {
    const bp = props.building.parameters as AdvancedMiningMachineParameters;
    if (bp.miningSpeed === value) return;
    const old = bp.miningSpeed;
    pushParam(
        (p) => { (p as AdvancedMiningMachineParameters).miningSpeed = value; },
        (p) => { (p as AdvancedMiningMachineParameters).miningSpeed = old; },
    );
};

const setStorageMax = (i: number, value: number) => {
    const s = (props.building.parameters as StationParameters).storage[i];
    if (s.max === value) return;
    const old = s.max;
    pushParam(
        (p) => { p.storage[i].max = value; },
        (p) => { p.storage[i].max = old; },
    );
};

const setStorageLogic = (i: number, which: 'localLogic' | 'remoteLogic', value: LogisticRole) => {
    const s = (props.building.parameters as StationParameters).storage[i];
    if (s[which] === value) return;
    const old = s[which];
    pushParam(
        (p) => { p.storage[i][which] = value; },
        (p) => { p.storage[i][which] = old; },
    );
};

const setItemId = (storageIndex: number, itemId: number | null) => {
    const s = p.value.storage[storageIndex];
    const newItemId = itemId === null ? 0 : itemId;
    if (s.itemId === newItemId) return;
    commandQueue.push(new SetStationStorageItemCommand(props.building, buildingInfo, storageIndex, newItemId));
};

// ---------- 刻度生成 ----------
const range = (min: number, max: number, step: number) => {
    const arr: number[] = [];
    for (let v = min; v <= max + 1e-9; v += step) arr.push(Math.round(v * 1e6) / 1e6);
    return arr;
};

const energySteps   = computed(() => range(inter.value ? 30 : 12, inter.value ? 300 : 60, 3));   // MW
const droneRangeSteps = range(10, 180, 10);                                                     // 角度
const shipRangeSteps = [...range(1, 60, 1), 10000];                                             // ly，10000 = ∞
const warpSteps     = [0.5, ...range(1, 60, 1)];                                                // AU
const deliverySteps = [1, ...range(10, 100, 10)];                                               // %
const maxSteps      = computed(() => range(0, inter.value ? 20000 : 10000, 100));               // 上限
const miningSteps   = range(10000, 30000, 1000);                                                        // 采集速度
const pilerSteps    = [1, 2, 3, 4, 0];                                                          // 0 = 科技上限

// ---------- 单位换算 ----------
const MW_PER_TICK = 60 / 1_000_000;              // perTick * MW_PER_TICK = MW
const ENERGY_TO_TICK = 1 / MW_PER_TICK;          // MW * ENERGY_TO_TICK = perTick

const energyToMw = (perTick: number) => Math.round(perTick * MW_PER_TICK * 1000) / 1000;
const mwToEnergy = (mw: number) => Math.round(mw * ENERGY_TO_TICK);

const droneRangeToDeg = (v: number) => Math.acos(Math.max(-1, Math.min(1, v))) / Math.PI * 180;
const degToDroneRange = (deg: number) => Math.cos(deg * Math.PI / 180);

const shipRangeToLy = (v: number) => v / 2400000;
const lyToShipRange = (ly: number) => ly * 2400000;

const warpToAu = (v: number) => v / 40000;
const auToWarp = (au: number) => Math.round(au * 40000);
</script>

<style lang="scss">
.station-storage {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    margin: 10px 0;
    gap: 10px;

    .num {
        flex: auto;
        min-width: 0;
    }

    .progress {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;

        .progress-track {
            flex: auto;
            height: 8px;
            background: #e4e4e4;
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: #4A8BA8;
            transition: width .15s;
        }
        .progress-text {
            font-size: 0.85em;
            white-space: nowrap;
        }
    }

    .roles {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .role {
            padding: 2px 2px;
            margin: 2px 0;
            font-size: 0.8em;
            text-align: center;
            min-width: 8em;
            border: none;
            color: #fff;
            cursor: pointer;
        }
        .role-none {
            background: #B2B2B2;
        }
        .role-demand {
            background: #D98A59;
        }
        .role-supply {
            background: #4A8BA8;
        }
    }

    .icon-placeholder {
        border-radius: 50%;
        background: #e4e4e4;
    }
    .placeholder {
        opacity: 0.3;
        font-size: 1.8em;
        text-align: center;
        flex: auto;
    }
}

.building-params {
    .switch-row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        margin: 4px 0;
    }
}
</style>
