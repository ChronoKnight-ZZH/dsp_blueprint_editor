<template>
	<div class="editor-root" ref="root" tabindex="-1"></div>
</template>

<script lang="ts">
/**
 * 蓝图编辑器。
 *
 * 渲染构建（场景装配、GLB/白模、图标、货物、下标、BVH）已下沉到 `src/lib/core/`，
 * 与 `BlueprintViewer` 共用同一套实现（见 docs/BlueprintViewer-实施计划.md 阶段 A）。
 * 本文件只保留 Vue 交互：放置 / 删除 / 预览 / 选中 / 快捷键 / 侧栏联动。
 */
import { BeltParameters } from '@/blueprint/parser';
import { calcBuildingTrans, PositionedBlueprint } from '@/blueprint/planet';
import { Vector3 } from 'three';
import { itemIconId } from '@/data/icons';
import { Updater } from '@/command';
import { PLANET_RADIUS } from '@/planetConstants';
import { AllBuildings } from '@/lib/core/AllBuildings';
import {
	buildingIconId, beltIconPos, beltIconScale,
	sorterIconPos, sorterIconScale,
} from '@/lib/core/iconHelpers';

/**
 * 注册编辑器的增量刷新回调（图标 / 下标局部更新）。
 *
 * **留在 Vue 层**（方案 §5 第 7 行）：它依赖 `Updater`（`@/command`，import vue），
 * 放进 `lib/core` 会破坏「core 不依赖 Vue」的约束。core 只提供 `AllBuildings`
 * 的公开面（`icons` / `iconTexture` / `subscriptMesh` / `subscriptMap`）。
 */
function registerUpdater(updater: Updater, buildings: AllBuildings, posBP: PositionedBlueprint) {
    // 先清空所有旧回调，防止场景重建时重复注册导致陈旧回调引用已销毁的 AllBuildings
    updater.clearAll();

    updater.updateBuildingIcon.on(b => {
        const icons = buildings.icons;
        // hasIcon 守卫：跳过 noIconBuildings（分流器/监测器等）与从未被渲染的建筑
        if (!icons.hasIcon(b))
            return;
        const rawIconId = buildingIconId(b);
        const iconId = rawIconId > 0 ? buildings.iconTexture.requestIcon(rawIconId) : 0;
        icons.updateIconId(b, iconId);
    });

    updater.updateBeltIcon.on(b => {
        const icons = buildings.icons;
        const params = b.parameters as BeltParameters | null;
        const rawIconId = params ? params.iconId : 0;
        const iconId = rawIconId > 0 ? buildings.iconTexture.requestIcon(rawIconId) : 0;

        if (icons.hasIcon(b)) {
            // 已有图标 → 直接更新 UV（包括 iconId=0 清空图标的情况）
            icons.updateIconId(b, iconId);
        } else if (iconId !== 0) {
            // 之前无图标，现在有了 → 动态添加
            const pos = new Vector3();
            const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
            beltIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, beltIconScale, true);
        }
    });

    updater.updateBeltIconSubscript.on(b => {
        const subEntry = buildings.subscriptMap.get(b);
        if (!subEntry || !buildings.subscriptMesh)
            return;
        const params = b.parameters as BeltParameters | null;
        if (!params)
            return;
        // 重算 count 文本并更新 subscriptMesh 的 iconId / iconPos 属性
        let s: string;
        if (params.count >= 100000)
            s = Math.floor(params.count / 1000).toFixed(0) + 'k';
        else
            s = params.count.toFixed(0);
        // 保护：若新文本长度与初始构建时不同，跳过本次局部刷新（下一非 silent 命令会重建场景）
        // 原因：subscriptMesh 是连续字符池，长度变化会覆盖/遗漏后续 belt 的下标
        if (s.length !== subEntry.length)
            return;
        const pos = new Vector3();
        const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
        beltIconPos(b, trans[0], pos);
        buildings.subscriptMesh.setText(subEntry.startIdx, pos, beltIconScale, s);
        buildings.subscriptMesh.needsUpdate();
    });

    updater.updateSorterIcon.on(b => {
        const icons = buildings.icons;
        const rawIconId = b.filterId;
        const iconId = rawIconId > 0 ? buildings.iconTexture.requestIcon(itemIconId(rawIconId)) : 0;

        if (icons.hasIcon(b)) {
            icons.updateIconId(b, iconId);
        } else if (iconId !== 0) {
            // 之前无图标，现在有了 → 动态添加
            const pos = new Vector3();
            const trans = calcBuildingTrans(PLANET_RADIUS, posBP, b);
            sorterIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, sorterIconScale, true);
        }
    });

    // updateStationInfo：当前物流塔面板自己响应式刷新即可；
    // 若未来要按库存首物品染色，在这里改颜色 attribute。
}
</script>

<script setup lang="ts">
import { ref, onMounted, Ref, onUnmounted, watchEffect, computed, inject } from 'vue'
import {
	Scene, PerspectiveCamera, WebGLRenderer, Matrix4, Ray, Sphere, Mesh,
	BoxGeometry, MeshStandardMaterial,
} from 'three';
import { RemoveBuildingCommand } from '@/blueprint/removeBuilding';
import { commandQueueKey } from '@/define';
import { findPosForAreas } from '@/blueprint/planet';
import { buildReforms } from '@/blueprint/reform';
import { onBuildingModelsChanged } from '@/models/buildingModel';
import { PlanetMapControls } from '@/PlanetMapControls';
import { attachCamera, attachRenderer } from '@/utils';
import { createNeutralEnvironment, setBuildingEnvironment } from '@/models/envMap';
import { setTextureMaxAnisotropy } from '@/models/textureMaps';
import { renderSettings } from '@/renderSettings';
import { setSettingsProvider } from '@/models/glbLoader';
import { IconTexture } from '@/iconTexture';
import { PLANET_SEGMENT } from '@/planetConstants';
import { buildBuildings } from '@/lib/core/buildBuildings';
import { buildBVH } from '@/lib/core/buildBVH';
import { createPlanetScene } from '@/lib/core/planetScene';
import type { BuildBuildingsResult } from '@/lib/core/buildBuildings';
import type { BuildingModelRef } from '@/lib/core/types';

// 加载器需要在「GLB 到达」与「设置变更重挂贴图」时读取当前贴图设置。
// 注入 reactive 单例的读取函数，保持设置面板的响应式驱动（方案 D2）。
setSettingsProvider(() => renderSettings);

const props = defineProps<{
  selectedBuildingIndex: number | null,
}>();

const emit = defineEmits<{
  (e: 'update:selectedBuildingIndex', index: number | null): void
}>()

const scene = new Scene();
const planetScene = createPlanetScene(PLANET_RADIUS, PLANET_SEGMENT);
const dirLight = planetScene.dirLight;
scene.add(planetScene.root);

const root: Ref<HTMLDivElement | null> = ref(null);
const renderer = new WebGLRenderer({ antialias: true });
attachRenderer(root, renderer);

// 建筑材质：贴图各向异性过滤 + 程序化中性环境反射。
// 环境反射只挂到建筑材质（material.envMap），不设 scene.environment，
// 免得行星本体、网格线跟着泛白。
setTextureMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
setBuildingEnvironment(createNeutralEnvironment(renderer));

const camera = new PerspectiveCamera(50);
camera.near = 0.5;
camera.far = 3000;
camera.position.z = 2 * PLANET_RADIUS;
attachCamera(root, camera);

const commandQueue = inject(commandQueueKey)!;

let controls: PlanetMapControls | null = null;

/** 外部 GLB 模型到达时自增，触发场景按“GLB 优先”重建 */
const modelVersion = ref(0);

/**
 * 图标图集跨重建复用：每次重建都 new 一个会重新分配 1920×1920 纹理，
 * 并重发全部图标请求（方案 §5 第 9 行的配套修正）。
 */
const editorIconTexture = new IconTexture(renderer);
onUnmounted(() => editorIconTexture.dispose());

const b = computed(() => {
	// 任意命令（剔除建筑 / 撤销 / 重做）后整体重建场景
	commandQueue.value?.execVersion.value;
	// 外部 GLB 模型加载完成 → 重建场景，让新模型接管渲染（旧场景由下面的 watchEffect 回收）
	modelVersion.value;
	if (!commandQueue.value)
		return null;
    const d = commandQueue.value.data;
	const pos = findPosForAreas(d.areas, PLANET_SEGMENT);
	const transforms = d.buildings.map(building => calcBuildingTrans(PLANET_RADIUS, pos, building));
	const built: BuildBuildingsResult = buildBuildings(transforms, d.buildings, {
		settings: renderSettings,
		textureSink: renderer,
		iconTexture: editorIconTexture,
		textureSettings: renderSettings,
	});
	const { bvh } = buildBVH(transforms, d.buildings);
    const reforms = buildReforms(PLANET_RADIUS, pos, d.reformData);
    registerUpdater(commandQueue.value.updater, built.buildings, pos);
	return { buildings: built.buildings, bvh, reforms };
});

watchEffect(onCleanUp => {
	if (b.value !== null) {
		const buildings = b.value.buildings
		const reforms = b.value.reforms
		scene.add(buildings);
		if (reforms)
			scene.add(reforms);
		onCleanUp(() => {
            scene.remove(buildings);
            buildings.dispose();
			if (reforms)
				scene.remove(reforms);
        });
	}
});

{
	const geometry = new BoxGeometry(1., 1., 1.);
	const material = new MeshStandardMaterial({
		color: 0x0074E8,
		opacity: 0.5,
		transparent: true,
		depthWrite: false,
	});
	const selectBox = new Mesh(geometry, material);
	selectBox.matrixAutoUpdate = false;
	watchEffect(() => {
		if (b.value === null || props.selectedBuildingIndex === null) {
			scene.remove(selectBox);
			return;
		}
		selectBox.matrix.copy(b.value.bvh.boxes[props.selectedBuildingIndex]);
		scene.add(selectBox);
	})
}

onMounted(() => {
	const rootEl = root.value!;

	controls = new PlanetMapControls(camera, renderer.domElement);
	const c = controls;
	c.listenToKeyEvents(rootEl);
	c.minDistance = PLANET_RADIUS * 1.04;
	c.maxDistance = PLANET_RADIUS * 4;
	c.targetRadius = PLANET_RADIUS;
	onUnmounted(() => c.dispose());
	c.update();

	const ray = new Ray();
	const planetSphere = new Sphere(new Vector3(), PLANET_RADIUS);
	const v = new Vector3();
	const pickBuilding = (e: MouseEvent) => {
		if (b.value === null)
			return null;
		ray.origin.setFromMatrixPosition(camera.matrixWorld);
		const rect = renderer.domElement.getBoundingClientRect();
		ray.direction.x = ((e.clientX - rect.left) / rect.width ) * 2 - 1;
		ray.direction.y = -((e.clientY - rect.top) / rect.height ) * 2 + 1;
		ray.direction.z = .5;
		ray.direction.unproject(camera).sub(ray.origin).normalize();
		const intersects = b.value.bvh.raycast(ray)
		if (intersects.length === 0)
			return null;

		const intersectPlanet = ray.intersectSphere(planetSphere, v);
		if (intersectPlanet !== null && intersectPlanet.distanceToSquared(ray.origin) < intersects[0].distanceSquared)
			intersects.length = 0;

		return intersects.length === 0 ? null : intersects[0].index
	}
	const onClick = (e: MouseEvent) => {
		emit('update:selectedBuildingIndex', pickBuilding(e));
	}
	renderer.domElement.addEventListener('click', onClick);
	onUnmounted(() => renderer.domElement.removeEventListener('click', onClick));

	// 右键点击剔除建筑：记录右键按下位置，避免把右键拖拽误判为点击
	let rightDownPos: {x: number, y: number} | null = null;
	const onMouseDown = (e: MouseEvent) => {
		if (e.button === 2)
			rightDownPos = { x: e.clientX, y: e.clientY };
	}
	const onContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		if (rightDownPos !== null
			&& Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y) > 6)
			return;
		const index = pickBuilding(e);
		if (index === null)
			return;
		const queue = commandQueue.value;
		if (!queue)
			return;
		queue.push(new RemoveBuildingCommand(index, queue.data));
		emit('update:selectedBuildingIndex', null);
	}
	renderer.domElement.addEventListener('mousedown', onMouseDown);
	renderer.domElement.addEventListener('contextmenu', onContextMenu);
	onUnmounted(() => renderer.domElement.removeEventListener('mousedown', onMouseDown));
	onUnmounted(() => renderer.domElement.removeEventListener('contextmenu', onContextMenu));

	let mounted = true;
	onUnmounted(() => { mounted = false; });
	let lastTimeStamp : number | null = null
	function animate(time: number) {
		if (!mounted)
			return;
		if (lastTimeStamp) {
			c.updateTimeDelta((time - lastTimeStamp) / 1000);
		}
		if (b.value?.buildings.cargos)
			b.value.buildings.cargos.cargoMove = (time % 1000) / 1000;
		lastTimeStamp = time;
		requestAnimationFrame(animate);
		const cameraUpdated = c.update();
		dirLight.position.copy(camera.position);
		renderer.render(scene, camera);
		if (cameraUpdated) {
			cameraPosVersion.value++;
		}
	}
	requestAnimationFrame(animate);

	// 外部 GLB 模型到达：合并成一次重建，避免几十个模型各触发一次整场景重建
	let modelRefreshTimer: number | null = null;
	const offModelsChanged = onBuildingModelsChanged(() => {
		if (modelRefreshTimer !== null)
			return;
		modelRefreshTimer = window.setTimeout(() => {
			modelRefreshTimer = null;
			modelVersion.value++;
		}, 150);
	});
	onUnmounted(() => {
		offModelsChanged();
		if (modelRefreshTimer !== null) {
			window.clearTimeout(modelRefreshTimer);
			modelRefreshTimer = null;
		}
	});
});

const selectBoxes = computed(() => b.value?.bvh.boxes);
const cameraPosVersion = ref(0);
const getModel = (index: number) => {
	if (b.value === null)
		return null
	const ref = b.value.buildings.modelRef[index] as BuildingModelRef | undefined
	if (ref === undefined)
		return null
	if ('mesh' in ref) {
		const m = new Matrix4()
		ref.mesh.getMatrixAt(ref.instance, m)
		return m;
	}
	return ref.matrix
}
/** 重置相机视角到默认位置（星球正上方默认距离） */
const resetCamera = () => {
	controls?.reset(2 * PLANET_RADIUS);
};
defineExpose({
	selectBoxes,
	camera,
	cameraPosVersion,
    getModel,
	resetCamera,
});
</script>

<style lang="scss">
.editor-root {
	width: 100%;
	height: 100%;
}
</style>
