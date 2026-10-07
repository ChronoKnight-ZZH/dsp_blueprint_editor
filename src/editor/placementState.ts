import { reactive } from "vue";
import { variantsOf } from "@/data/buildingCategories";

export type EditorMode = "idle" | "placing" | "deleting" | "reforming";

export type AppMode = "preview" | "edit";

export interface PlacementState {
    appMode: AppMode;
    mode: EditorMode;
    categoryIndex: number; // 1-9
    selectedItemId: number | null;
    selectedModelIndex: number | null;
    yaw: number; // rotation in degrees (0, 90, 180, 270)
    freePlacement: boolean; // Shift held
    /** 地基模式当前使用的颜色槽位（0..31，16..31 为自定义色） */
    reformColorSlot: number;
}

const state = reactive<PlacementState>({
    appMode: "preview",
    mode: "idle",
    categoryIndex: 1,
    selectedItemId: null,
    selectedModelIndex: null,
    yaw: 0,
    freePlacement: false,
    reformColorSlot: 0,
});

export function enterEditMode() {
    state.appMode = "edit";
    state.mode = "idle";
    state.selectedItemId = null;
    state.selectedModelIndex = null;
}

export function exitEditMode() {
    state.appMode = "preview";
    state.mode = "idle";
    state.selectedItemId = null;
    state.selectedModelIndex = null;
    state.yaw = 0;
    state.freePlacement = false;
}
export function usePlacement() {
    return state;
}

export function resetToIdle() {
    state.mode = "idle";
    state.selectedItemId = null;
    state.selectedModelIndex = null;
}

export function selectBuilding(itemId: number, modelIndex: number) {
    state.mode = "placing";
    state.selectedItemId = itemId;
    state.selectedModelIndex = modelIndex;
    state.yaw = 0;
}

/** 选择地基：进入地基模式（铺/涂一格），不做建筑放置 */
export function selectFoundation() {
    state.mode = "reforming";
    state.selectedItemId = 1131; // 地基 itemId
    state.selectedModelIndex = null;
    state.yaw = 0;
}

export function enterDeleteMode() {
    state.mode = "deleting";
    state.selectedItemId = null;
    state.selectedModelIndex = null;
}

export function rotateBuilding() {
    state.yaw = (state.yaw + 90) % 360;
}

/**
 * 切换到下一个"变形样式"（四向分流器的三种形态等）。
 * 形态就是模型序号，直接改 selectedModelIndex，预览与放置都会用新模型。
 * @returns 切换后的模型序号；该建筑没有变形（或未选建筑）返回 null
 */
export function cycleBuildingVariant(): number | null {
    if (state.selectedItemId === null) return null;
    const variants = variantsOf(state.selectedItemId);
    if (variants.length === 0) return null;
    const i = variants.indexOf(state.selectedModelIndex ?? -1);
    const next = variants[(i + 1) % variants.length];
    state.selectedModelIndex = next;
    return next;
}
