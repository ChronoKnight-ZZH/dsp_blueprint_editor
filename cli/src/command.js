"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandQueue = exports.Updater = exports.EventDispatcher = void 0;
const vue_1 = require("vue");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class EventDispatcher {
    callbacks = new Set();
    on(callback) {
        this.callbacks.add(callback);
    }
    onMounted(callback) {
        (0, vue_1.onMounted)(() => this.callbacks.add(callback));
        (0, vue_1.onUnmounted)(() => this.callbacks.delete(callback));
    }
    dispatch(...args) {
        for (const cb of this.callbacks) {
            cb(...args);
        }
    }
}
exports.EventDispatcher = EventDispatcher;
class Updater {
    updateBuildingIcon = new EventDispatcher();
    updateBeltIcon = new EventDispatcher();
    updateBeltIconSubscript = new EventDispatcher();
    updateSorterIcon = new EventDispatcher();
    updateStationInfo = new EventDispatcher();
}
exports.Updater = Updater;
class CommandQueue {
    data;
    _maxSize = 256;
    get maxSize() {
        return this._maxSize;
    }
    set maxSize(value) {
        this._maxSize = value;
        this.trim();
    }
    stateVersion = (0, vue_1.ref)(0);
    execVersion = (0, vue_1.ref)(0);
    updater;
    constructor(data) {
        this.data = data;
        this.updater = new Updater();
    }
    // commands:         c1 c2 c3
    // currentPosition: 0  1  2  3
    commands = [];
    currentPosition = 0;
    trim() {
        if (this.maxSize < this.commands.length) {
            const n = Math.min(this.commands.length - this.maxSize, this.currentPosition);
            this.commands.splice(0, n);
            this.currentPosition -= n;
            this.stateVersion.value++;
        }
    }
    push(c) {
        this.commands.splice(this.currentPosition);
        c.do(this.data, this.updater);
        if (this.currentPosition > 0 && this.commands[this.currentPosition - 1].merge(c))
            return;
        this.commands.push(c);
        this.currentPosition++;
        this.trim();
        this.stateVersion.value++;
        this.execVersion.value++;
    }
    canUndo() {
        this.stateVersion.value;
        return this.currentPosition > 0;
    }
    undo() {
        if (!this.canUndo())
            return false;
        this.commands[--this.currentPosition].undo(this.data, this.updater);
        this.stateVersion.value++;
        this.execVersion.value++;
        return true;
    }
    canRedo() {
        this.stateVersion.value;
        return this.currentPosition < this.commands.length;
    }
    redo() {
        if (!this.canRedo())
            return false;
        this.commands[this.currentPosition++].do(this.data, this.updater);
        this.stateVersion.value++;
        this.execVersion.value++;
        return true;
    }
}
exports.CommandQueue = CommandQueue;
//# sourceMappingURL=command.js.map