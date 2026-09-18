import { BlueprintBuilding, BlueprintData } from "@/blueprint/parser";
import { onUnmounted, onMounted, ref } from "vue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventDispatcher<TArgs extends Array<any>> {
    private callbacks = new Set<(...args: TArgs) => void>();
    on(callback: (...args: TArgs) => void) {
        this.callbacks.add(callback);
    }
    onMounted(callback: (...args: TArgs) => void) {
        onMounted(() => this.callbacks.add(callback));
        onUnmounted(() => this.callbacks.delete(callback));
    }
    dispatch(...args: TArgs) {
        for (const cb of this.callbacks) {
            cb(...args);
        }
    }
    /** 清空所有回调，防止 registerUpdater 在重建时重复注册 */
    clear() {
        this.callbacks.clear();
    }
}


export class Updater {
    updateBuildingIcon = new EventDispatcher<[b: BlueprintBuilding]>();
    updateBeltIcon = new EventDispatcher<[b: BlueprintBuilding]>();
    updateBeltIconSubscript = new EventDispatcher<[b: BlueprintBuilding]>();
    updateSorterIcon = new EventDispatcher<[b: BlueprintBuilding]>();

    updateStationInfo = new EventDispatcher<[b: BlueprintBuilding]>();

    /** 清空所有 dispatcher 的回调（场景重建前调用，避免陈旧回调引用已销毁的 AllBuildings） */
    clearAll() {
        this.updateBuildingIcon.clear();
        this.updateBeltIcon.clear();
        this.updateBeltIconSubscript.clear();
        this.updateSorterIcon.clear();
        this.updateStationInfo.clear();
    }
}

export interface Command {
    do(data: BlueprintData, updater: Updater): void;
    undo(data: BlueprintData, updater: Updater): void;
    merge(c: Command): boolean;
    /**
     * true  = 只改图标/颜色/文字/纯数据，不改变几何/拓扑 → 触发 stateVersion++，不触发 execVersion++
     * false = 改了几何/拓扑（模型/尺寸/位置/连接关系/数组增删） → 触发 execVersion++，3D 层重建
     * 省略等价于 false
     */
    readonly silent?: boolean;
}

export class CommandQueue {
    private _maxSize = 256;
    public get maxSize() {
        return this._maxSize;
    }
    public set maxSize(value) {
        this._maxSize = value;
        this.trim()
    }

    /**
     * 状态版本号：每次命令（无论 silent 与否）都递增。
     * 用于通知 App.vue 蓝图代码需要重新生成（codeExpired）。
     */
    public readonly stateVersion = ref(0);
    /**
     * 执行版本号：仅非 silent 命令递增。
     * 用于通知 BlueprintEditor 整体重建 3D 场景（几何/拓扑变更）。
     */
    public readonly execVersion = ref(0);
    public readonly updater;
    constructor(public readonly data: BlueprintData) {
        this.updater = new Updater();
    }

    // commands:         c1 c2 c3
    // currentPosition: 0  1  2  3
    private commands: Command[] = [];
    private currentPosition = 0;

    private trim() {
        if (this.maxSize < this.commands.length) {
            const n = Math.min(this.commands.length - this.maxSize, this.currentPosition);
            this.commands.splice(0, n);
            this.currentPosition -= n;
            this.stateVersion.value++;
        }
    }

    public push(c: Command) {
        this.commands.splice(this.currentPosition)
        c.do(this.data, this.updater);
        if (this.currentPosition > 0 && this.commands[this.currentPosition - 1].merge(c))
            return;
        this.commands.push(c);
        this.currentPosition++;
        this.trim();
        this.stateVersion.value++;
        if (!c.silent)
            this.execVersion.value++;
    }

    public canUndo() {
        this.stateVersion.value;
        return this.currentPosition > 0;
    }

    public undo() {
        if (!this.canUndo())
            return false;
        const cmd = this.commands[--this.currentPosition];
        cmd.undo(this.data, this.updater);
        this.stateVersion.value++;
        if (!cmd.silent)
            this.execVersion.value++;
        return true;
    }

    public canRedo() {
        this.stateVersion.value;
        return this.currentPosition < this.commands.length;
    }

    public redo() {
        if (!this.canRedo())
            return false;
        const cmd = this.commands[this.currentPosition++];
        cmd.do(this.data, this.updater);
        this.stateVersion.value++;
        if (!cmd.silent)
            this.execVersion.value++;
        return true;
    }
}
