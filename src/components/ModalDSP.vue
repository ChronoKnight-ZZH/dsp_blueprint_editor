<template>
    <Teleport to="body">
        <dialog class="modal" ref="dialog" @close="onclose" @click="onclick">
            <div class="modal-window">
                <slot></slot>
            </div>
        </dialog>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue';

const props = defineProps<{
    open?: boolean;
}>();

const dialog = ref<HTMLDialogElement | null>(null);

watchEffect(() => {
    if (props.open) {
        dialog.value?.showModal();
    } else {
        dialog.value?.close();
    }
});

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void,
}>();

const onclose = () => {
    if (props.open)
        emit('update:open', false);
}

const onclick = (e: MouseEvent) => {
    // Enable clicking outside the dialog to close it
    if (e.target === dialog.value)
        emit('update:open', false);
}
</script>

<style>
.modal {
    padding: 0;
    border: #FFFA solid 1px;
    display: flex; /* 弹性布局 */
}
.modal-text {
/* text-align: center;  */
}

.modal-window {
    color: white;
    background: black;
    padding: 10px;
    max-height: 90vh;
    min-width: max(30vw, 150px);
    max-width: 90vw;
    display: flex; /* 弹性布局 */
    justify-content: center; /* 水平居中 */
    align-items: center; /* 垂直居中 */
    flex-direction: column;
    flex-wrap: wrap;
    gap: 10px;
    width: 100%;
    height: 100%;
    overflow: auto;
    box-sizing: border-box;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
}

.modal::backdrop {
    opacity: 0.7;
    background: black;
}
</style>
