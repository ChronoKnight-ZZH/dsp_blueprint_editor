import { reactive } from "vue";

export type EditorMode = "idle" | "placing" | "deleting";

export type AppMode = "preview" | "edit";

export interface PlacementState {
    appMode: AppMode;
    mode: EditorMode;
    categoryIndex: number; // 1-9
    selectedItemId: number | null;
    selectedModelIndex: number | null;
    yaw: number; // rotation in degrees (0, 90, 180, 270)
    freePlacement: boolean; // Shift held
}

const state = reactive<PlacementState>({
    appMode: "preview",
    mode: "idle",
    categoryIndex: 1,
    selectedItemId: null,
    selectedModelIndex: null,
    yaw: 0,
    freePlacement: false,
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

export function enterDeleteMode() {
    state.mode = "deleting";
    state.selectedItemId = null;
    state.selectedModelIndex = null;
}

export function rotateBuilding() {
    state.yaw = (state.yaw + 90) % 360;
}
