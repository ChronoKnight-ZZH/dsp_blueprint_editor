<template>
	<div class="editor-root" ref="root" tabindex="-1"></div>
</template>

<script lang="ts">
import {
	Group, LineSegments, InstancedMesh, WebGLRenderer,
	LineBasicMaterial, MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial, CylinderGeometry, BoxGeometry,
	Matrix4, DirectionalLight, Vector3, Object3D, Color, Ray, Sphere, Vector2, Mesh,
} from 'three';
import { SphereLatitudeGridGeometry, SphereLongitudeGridGeometry } from '@/SphereGridGeometry';
import { findPosForAreas, gridAreas, calcBuildingTrans, PositionedBlueprint } from '@/blueprint/planet';
import { buildReforms } from '@/blueprint/reform';
import { buildingMeta, noIconBuildings } from '@/data/building';
import { itemIconId, recipeIconId } from '@/data/icons';
import { IconTexture } from '@/iconTexture';
import { IconGeometry, Icons } from '@/icons';
import { IconSubscript } from '@/iconSubscript';
import { Cargos, CargoGeometry, makeCargoGeometry } from '@/cargos';
import { BVH } from '@/bvh';
import { Updater } from '@/command';
import { RemoveBuildingCommand } from '@/blueprint/removeBuilding';
import { commandQueueKey } from '@/define';
import { BeltParameters, BlueprintBuilding, LabParamerters, ResearchMode } from '@/blueprint/parser';
import { isBelt, isInserter, isLab } from '@/data/items';
function buildPlanetGrid(radius = 1, segment = 200) {
	const allGrids = new Group();
	const material = new LineBasicMaterial( { color: 0xf0f0f0, depthWrite: false } );

	const latitudeGeometry = new SphereLatitudeGridGeometry({
		radius,
		widthSegments: segment,
		heightSegments: segment / 2
	});
	allGrids.add(new LineSegments(latitudeGeometry, material));

	const radPerSeg = 2 * Math.PI / segment;
	for (const {minLatitudeSeg, latitudeSeg, longitudeSeg} of gridAreas(segment)) {
		const geometry = new SphereLongitudeGridGeometry({
			radius,
			widthSegments: longitudeSeg, heightSegments: Math.abs(latitudeSeg),
			phiStart: 0, phiLength: Math.PI * 2,
			thetaStart: (minLatitudeSeg + segment / 4) * radPerSeg, thetaLength: latitudeSeg * radPerSeg,
		});
		allGrids.add(new LineSegments(geometry, material));
	}
	return { grids: allGrids, material };
}

class AllBuildings extends Object3D {
    constructor(
        objects: Object3D[],
        public readonly iconsMesh: Icons,
        public readonly iconTexture: IconTexture,
        public readonly cargos: Cargos[],
        public readonly modelRef: { mesh: InstancedMesh, instance: number }[],
        public readonly subscriptMesh: IconSubscript | null = null,
        /** 建筑 → 下标文本在 subscriptMesh 中的起始字符位置与长度；belt count 变化时用于局部刷新 */
        public readonly subscriptMap: Map<BlueprintBuilding, { startIdx: number; length: number }> = new Map(),
    ) {
        super();
        this.add(...objects);
        this.add(iconsMesh);
        for (const c of cargos)
            this.add(c);
        if (subscriptMesh)
            this.add(subscriptMesh);
    }

    public get icons() {
        return this.iconsMesh.geometry;
    }

    public dispose() {
        this.traverse(o => {
            if (o instanceof Mesh) {
                (o as Mesh).geometry.dispose();
            }
            if (o instanceof InstancedMesh) {
                o.dispose();
            }
        });
    }
}

const pos1 = new Vector3();
const pos2 = new Vector3();
const dir = new Vector3();
const inserterHeight = 0.3;
function inserterTrans(transforms: Matrix4[], trans: Matrix4) {
	pos1.setFromMatrixPosition(transforms[0]);
	dir.copy(pos1).normalize().multiplyScalar(inserterHeight);
	pos1.add(dir);

	pos2.setFromMatrixPosition(transforms[1]);
	dir.copy(pos2).normalize().multiplyScalar(inserterHeight);
	pos2.add(dir);

	trans.setPosition(pos1.x, pos1.y, pos1.z);
	trans.lookAt(pos1, pos2, pos1);
	return dir.subVectors(pos1, pos2).length();
}

function buildingIconId(b: BlueprintBuilding) {
    if (isLab(b.itemId)) {
        const mode = (b.parameters as LabParamerters | null)?.researchMode;
        // 矩阵合成：有配方显示配方图标，无配方退回研究站自身图标
        if (mode === ResearchMode.Compose && b.recipeId > 0) {
            return recipeIconId(b.recipeId);
        }
        // 科研模式 / 选择模式 / 合成但未选配方：显示研究站自身图标
        return itemIconId(b.itemId);
    }
    return b.recipeId > 0 ? recipeIconId(b.recipeId) : itemIconId(b.itemId);
}

const scale3 = new Vector3();
const trans = new Matrix4();
function buildingIconPos(b: BlueprintBuilding, buildingTrans: Matrix4, pos: Vector3, scale: Vector2) {
    const meta = buildingMeta.get(b.modelIndex);
    if (meta === undefined)
        return false;  // TODO: unknown building, print warning
    trans.multiplyMatrices(buildingTrans, meta.iconTrans);
    scale3.setFromMatrixScale(trans);
    scale.set(scale3.x, scale3.y);
    pos.setFromMatrixPosition(trans);
    return true;
}

const beltIconScale = new Vector2(1.1, 1.1);
const beltIconTrans = new Matrix4().makeTranslation(0., 0., 0.5);
function beltIconPos(b: BlueprintBuilding, buildingTrans: Matrix4, pos: Vector3) {
    trans.multiplyMatrices(buildingTrans, beltIconTrans);
    pos.setFromMatrixPosition(trans);
}

const sorterIconScale = new Vector2(0.8, 0.8);
const sorterIconTrans = new Matrix4().makeTranslation(0., 0., inserterHeight);
function sorterIconPos(b: BlueprintBuilding, buildingTrans: Matrix4, pos: Vector3) {
    trans.multiplyMatrices(buildingTrans, sorterIconTrans);
    pos.setFromMatrixPosition(trans);
}

/** 传送带货物：正六棱柱，外接圆半径 0.15，长 0.4，轴向沿 z CylinderGeometry */
function createBeltCargoGeometry(count: number): CargoGeometry {
	const geo = new BoxGeometry(0.4, 0.4, 0.4);
	geo.rotateX(Math.PI / 2); // 圆柱轴向从 y 转到 z
	return makeCargoGeometry(geo, count);
}

/** 分拣器货物：正四棱柱，正方形截面 0.15 × 0.15，长 0.4（沿 z）BoxGeometry */
function createInserterCargoGeometry(count: number): CargoGeometry {
	const geo = new BoxGeometry(0.4, 0.4, 0.6);
	return makeCargoGeometry(geo, count);
}

function buildBuildings(transforms: Matrix4[][], buildings: BlueprintBuilding[], renderer: WebGLRenderer) {
	const buildBelts = (belts: BlueprintBuilding[]) => {
		const thickness = 0.1;
		const material = new MeshLambertMaterial();
		const objects: Object3D[] = [];
		{
			const geometry = new CylinderGeometry(0.32, 0.32, thickness, 6);
			const mesh = new InstancedMesh(geometry, material, belts.length);
			const offset = new Matrix4().makeRotationX(Math.PI / 2);
			offset.premultiply(new Matrix4().makeTranslation(0, 0, thickness / 2));
			const trans = new Matrix4();
			for (let i = 0; i < belts.length; i++) {
				const b = belts[i];
				trans.copy(transforms[b.index][0]);
				trans.multiply(offset);
				mesh.setMatrixAt(i, trans);
				mesh.setColorAt(i, buildingMeta.get(b.modelIndex)!.color);
				modelRef[b.index] = { mesh, instance: i };
			}
			mesh.instanceMatrix.needsUpdate = true;
			mesh.instanceColor!.needsUpdate = true;
			objects.push(mesh);
		}
		const linkThickness = 0.6 * thickness;
		{ // links
			const geometry = new BoxGeometry(0.15, linkThickness, 1.0);
			const mesh = new InstancedMesh(geometry, material, belts.length);
			let numLinks = 0;
			const offset = new Matrix4().makeTranslation(0, linkThickness / 2, -0.5);
			const pos1 = new Vector3();
			const pos2 = new Vector3();
			const dir = new Vector3();
			const temp = new Matrix4();
			const trans = new Matrix4();
			for (let i = 0; i < belts.length; i++) {
				const b1 = belts[i];
				if (b1.outputObjIdx < 0)
					continue;
				pos1.setFromMatrixPosition(transforms[b1.index][0]);
				pos2.setFromMatrixPosition(transforms[b1.outputObjIdx][0]);
				const len = dir.subVectors(pos1, pos2).length();
				trans.identity();
				trans.lookAt(pos1, pos2, pos1);
				trans.premultiply(temp.makeTranslation(pos1.x, pos1.y, pos1.z));

				const color = buildingMeta.get(b1.modelIndex)!.color;
				addBeltCargo(trans, color, len);

				trans.multiply(temp.makeScale(1., 1., len));
				trans.multiply(offset);
				mesh.setMatrixAt(numLinks, trans);
				mesh.setColorAt(numLinks, color);
				numLinks++;
			}
			if (numLinks) {
				mesh.count = numLinks;
				mesh.instanceMatrix.needsUpdate = true;
				mesh.instanceColor!.needsUpdate = true;
				objects.push(mesh);
			}
		}
		return objects;
	}
	const buildInserters = (inserters: BlueprintBuilding[]) => {
		const geometry = new BoxGeometry(0.1, 0.1, 1.0);
		const material = new MeshLambertMaterial();
		const mesh = new InstancedMesh(geometry, material, inserters.length);
		const offset = new Matrix4().makeTranslation(0, 0, -0.5);
		const temp = new Matrix4();
		const trans = new Matrix4();
		for (let i = 0; i < inserters.length; i++) {
			const b = inserters[i];

			const len = inserterTrans(transforms[b.index], trans);
			const color = buildingMeta.get(b.modelIndex)!.color;
			addInserterCargo(trans, color, len);

			trans.multiply(temp.makeScale(1., 1., len));
			trans.multiply(offset);
			mesh.setMatrixAt(i, trans);
			mesh.setColorAt(i, color);
			modelRef[b.index] = { mesh, instance: i };
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.instanceColor!.needsUpdate = true;
		return [mesh];
	}
	const buildBoxes = (boxes: BlueprintBuilding[]) => {
		const geometry = new BoxGeometry(1.0, 1.0, 1.0);
		const material = new MeshLambertMaterial();
		const mesh = new InstancedMesh(geometry, material, boxes.length);
		const trans = new Matrix4();
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i];
			const meta = buildingMeta.get(b.modelIndex);
			if (meta === undefined)
				continue
			trans.multiplyMatrices(transforms[b.index][0], meta.unitBoxTrans);
			mesh.setMatrixAt(i, trans);
			mesh.setColorAt(i, meta.color);
			modelRef[b.index] = { mesh, instance: i };
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.instanceColor!.needsUpdate = true;
		return [mesh];
	}
	const buildIcons = (iconBuildings: BlueprintBuilding[], iconBelts: BlueprintBuilding[], iconInsterters: BlueprintBuilding[]) => {
		const subscripts = new Map<BlueprintBuilding, string>();
		for (const b of iconBelts) {
			if (b.parameters === null)
				continue;
			const p = b.parameters as BeltParameters;
			if (p.count === 0)
				continue;
			let s;
			if (p.count >= 100000)
				s = Math.floor(p.count / 1000).toFixed(0) + 'k';
			else
				s = p.count.toFixed(0);
			subscripts.set(b, s);
		}

		const count = iconBuildings.length + iconBelts.length + iconInsterters.length;
		const icons = new IconGeometry(count);

		let subscriptsMesh: null | IconSubscript = null;
		const subscriptMap = new Map<BlueprintBuilding, { startIdx: number; length: number }>();
		if (subscripts.size > 0) {
			let numChars = 0;
			for (const s of subscripts.values()) {
				numChars += s.length;
			}
			subscriptsMesh = new IconSubscript(numChars);
		}
		const pos = new Vector3();

		let subscriptIdx = 0;
		for (let i = 0; i < iconBelts.length; i++) {
            const b = iconBelts[i];
            beltIconPos(b, transforms[b.index][0], pos);
			const iconId = iconTexture.requestIcon((b.parameters as BeltParameters).iconId);
			icons.addIcon(b, iconId, pos, beltIconScale);

			const sub = subscripts.get(b);
			if (sub !== undefined) {
				subscriptsMesh!.setText(subscriptIdx, pos, beltIconScale, sub);
				subscriptMap.set(b, { startIdx: subscriptIdx, length: sub.length });
				subscriptIdx += sub.length;
			}
		}

		for (let i = 0; i < iconInsterters.length; i++) {
			const b = iconInsterters[i];
            sorterIconPos(b, transforms[b.index][0], pos);
            const iconId = iconTexture.requestIcon(itemIconId(b.filterId));
			icons.addIcon(b, iconId, pos, sorterIconScale);
		}

		const buildingIconScale = new Vector2();
		for (let i = 0; i < iconBuildings.length; i++) {
            const b = iconBuildings[i];
			if (!buildingIconPos(b, transforms[b.index][0], pos, buildingIconScale))
				continue
			const iconId = iconTexture.requestIcon(buildingIconId(b));
			icons.addIcon(b, iconId, pos, buildingIconScale);
		}

		if (subscriptsMesh !== null) {
			subscriptsMesh.needsUpdate();
		}
		return [icons, subscriptsMesh, subscriptMap] as const;
	}

	const belts = buildings.filter(b => isBelt(b.itemId));
    const inserters = buildings.filter(b => isInserter(b.itemId));

	const boxes = buildings.filter(b => !isInserter(b.itemId) && !isBelt(b.itemId));

    const iconBuildings = boxes.filter(b => !noIconBuildings.has(b.itemId));
	const iconBelts = belts.filter(b => b.parameters && (b.parameters as BeltParameters).iconId > 0);
	const iconInsterters = inserters.filter(b => b.filterId > 0);

	const modelRef = new Array<{ mesh: InstancedMesh, instance: number }>(buildings.length);
	const beltCargosMesh = new Cargos(createBeltCargoGeometry(belts.length), belts.length);
	const inserterCargosMesh = new Cargos(createInserterCargoGeometry(inserters.length), inserters.length);
	let numBeltCargos = 0;
	let numInserterCargos = 0;
	const addBeltCargo = (trans: Matrix4, color: Color, distance: number) => {
		beltCargosMesh.setMatrixAt(numBeltCargos, trans);
		beltCargosMesh.setColorAt(numBeltCargos, color);
		beltCargosMesh.setCargoDistanceAt(numBeltCargos, distance);
		numBeltCargos++;
	};
	const addInserterCargo = (trans: Matrix4, color: Color, distance: number) => {
		inserterCargosMesh.setMatrixAt(numInserterCargos, trans);
		inserterCargosMesh.setColorAt(numInserterCargos, color);
		inserterCargosMesh.setCargoDistanceAt(numInserterCargos, distance);
		numInserterCargos++;
	};

    const meshes: Object3D[] = [];
	if (belts.length)
		meshes.push(...buildBelts(belts));

	if (inserters.length)
		meshes.push(...buildInserters(inserters));

	if (numBeltCargos) {
		beltCargosMesh.count = numBeltCargos;
		beltCargosMesh.instanceMatrix.needsUpdate = true;
		beltCargosMesh.instanceColor!.needsUpdate = true;
		beltCargosMesh.geometry.cargoDistance.needsUpdate = true;
	}
	if (numInserterCargos) {
		inserterCargosMesh.count = numInserterCargos;
		inserterCargosMesh.instanceMatrix.needsUpdate = true;
		inserterCargosMesh.instanceColor!.needsUpdate = true;
		inserterCargosMesh.geometry.cargoDistance.needsUpdate = true;
	}

	if (boxes.length)
		meshes.push(...buildBoxes(boxes));

    const iconTexture = new IconTexture(renderer);
	const [icons, subscriptsMesh, subscriptMap] = buildIcons(iconBuildings, iconBelts, iconInsterters)
    if (subscriptsMesh) {
        subscriptsMesh.renderOrder = 11;
    }

    const iconMesh = new Icons(iconTexture.texture, icons);
    iconMesh.renderOrder = 10;

	return new AllBuildings(meshes, iconMesh, iconTexture, [beltCargosMesh, inserterCargosMesh], modelRef, subscriptsMesh, subscriptMap);
}

function buildBVH(transforms: Matrix4[][], buildings: BlueprintBuilding[]) {
	const temp = new Matrix4();
	const inserterOffset = new Matrix4().makeTranslation(0, 0, -0.5);

	const selectBoxes = buildings.map((b, i) => {
		const meta = buildingMeta.get(b.modelIndex)!;
		const box = new Matrix4();
		if (isInserter(b.itemId)) {
			const len = inserterTrans(transforms[i], box);
			box.multiply(temp.makeScale(0.5, 0.5, len));
			box.multiply(inserterOffset);
		} else {
			box.multiplyMatrices(transforms[i][0], meta.selectUnitBoxTrans);
		}
		return box;
	});
	return new BVH(selectBoxes);
}

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
            const trans = calcBuildingTrans(R, posBP, b);
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
        const trans = calcBuildingTrans(R, posBP, b);
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
            const trans = calcBuildingTrans(R, posBP, b);
            sorterIconPos(b, trans[0], pos);
            icons.addIcon(b, iconId, pos, sorterIconScale, true);
        }
    });

    // updateStationInfo：当前物流塔面板自己响应式刷新即可；
    // 若未来要按库存首物品染色，在这里改颜色 attribute。
}

const R = 200.2;
const SEGMENT = 200;

</script>

<script setup lang="ts">
import { ref, onMounted, Ref, onUnmounted, watchEffect, computed, inject } from 'vue'
import { Scene, PerspectiveCamera, SphereGeometry, AmbientLight } from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { attachCamera, attachRenderer } from '@/utils';
import { usePlacement, resetToIdle } from '@/editor/placementState';
import { planetToLocal } from '@/blueprint/area';
import { createBuilding, CreateBuildingCommand } from '@/blueprint/create';
import { buildBeltLine, CreateBeltLineCommand, rasterizeLine } from '@/blueprint/beltLine';
import { createSorterBetween } from '@/blueprint/sorter';

const props = defineProps<{
  selectedBuildingIndex: number | null,
}>();

const emit = defineEmits<{
  (e: 'update:selectedBuildingIndex', index: number | null): void,
  (e: 'clickEmpty'): void,
}>()

const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 0.3));
const dirLight = new DirectionalLight(0xffffff, 2);
scene.add(dirLight);
{
	const geometry = new SphereGeometry(R, SEGMENT, SEGMENT / 2);
	const material = new MeshStandardMaterial( { color: 0xb0b0b0 } );
	const planet = new Mesh(geometry, material);
	scene.add(planet);
}
const { grids: planetGrid, material: gridMaterial } = buildPlanetGrid(R * 1.0001, SEGMENT);
scene.add(planetGrid);

const placement = usePlacement();
// 网格线随模式变色：预览原色 / 编辑绿 / 删除红
watchEffect(() => {
	if (placement.appMode === 'edit')
		gridMaterial.color.set(placement.mode === 'deleting' ? 0xff5050 : 0x50fa50);
	else
		gridMaterial.color.set(0xf0f0f0);
});

const root: Ref<HTMLDivElement | null> = ref(null);
const renderer = new WebGLRenderer({ antialias: true });
attachRenderer(root, renderer);

const camera = new PerspectiveCamera(50);
camera.near = 0.5;
camera.far = 3000;
camera.position.z = 2 * R;
attachCamera(root, camera);

const commandQueue = inject(commandQueueKey)!;

let controls: PlanetMapControls | null = null;

const b = computed(() => {
	// 任意命令（剔除建筑 / 撤销 / 重做）后整体重建场景
	commandQueue.value?.execVersion.value;
	if (!commandQueue.value)
		return null;
    const d = commandQueue.value.data;
	const pos = findPosForAreas(d.areas, SEGMENT);
	const transforms = d.buildings.map(b => calcBuildingTrans(R, pos, b));
	const buildings = buildBuildings(transforms, d.buildings, renderer)
    const bvh = buildBVH(transforms, d.buildings);
    const reforms = buildReforms(R, pos, d.reformData);
    registerUpdater(commandQueue.value.updater, buildings, pos);
	return { buildings, bvh, reforms, pos };
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

// 放置预览：半透明绿盒，编辑模式 placing 时跟随鼠标吸附网格（单个 Mesh 复用）
const previewVisible = ref(false);
const previewMesh = new Mesh(
	new BoxGeometry(1., 1., 1.),
	new MeshBasicMaterial({
		color: 0x50fa50,
		opacity: 0.4,
		transparent: true,
		depthWrite: false,
	}),
);
previewMesh.matrixAutoUpdate = false;
previewMesh.renderOrder = 9;
watchEffect(() => {
	const show = placement.appMode === 'edit' && placement.mode === 'placing' && previewVisible.value;
	if (show)
		scene.add(previewMesh);
	else
		scene.remove(previewMesh);
});

// ---- 传送带拖拽铺线 / 分拣器两点架接 ----
const isPlacingBelt = () => placement.appMode === 'edit' && placement.mode === 'placing'
    && placement.selectedItemId !== null && isBelt(placement.selectedItemId);
const isPlacingSorter = () => placement.appMode === 'edit' && placement.mode === 'placing'
    && placement.selectedItemId !== null && isInserter(placement.selectedItemId);

let beltStart: { x: number, y: number } | null = null;
const sorterSource = ref<number | null>(null);

// 整条传送带的拖拽预览（复用实例网格，count 随路径变化）
const BELT_PREVIEW_CAP = 1024;
const beltPreviewMesh = new InstancedMesh(
    new BoxGeometry(0.6, 0.6, 0.1),
    new MeshBasicMaterial({ color: 0x50fa50, opacity: 0.45, transparent: true, depthWrite: false }),
    BELT_PREVIEW_CAP,
);
beltPreviewMesh.matrixAutoUpdate = false;
beltPreviewMesh.count = 0;
beltPreviewMesh.renderOrder = 9;
const beltPreviewVisible = ref(false);
watchEffect(() => {
    if (isPlacingBelt() && beltPreviewVisible.value)
        scene.add(beltPreviewMesh);
    else
        scene.remove(beltPreviewMesh);
});
function hideBeltPreview() {
    beltPreviewMesh.count = 0;
    beltPreviewVisible.value = false;
}

// 分拣器第一点（源建筑）高亮
const sorterSrcBox = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ color: 0x50fa50, opacity: 0.3, transparent: true, depthWrite: false }),
);
sorterSrcBox.matrixAutoUpdate = false;
watchEffect(() => {
    if (b.value !== null && isPlacingSorter() && sorterSource.value !== null) {
        sorterSrcBox.matrix.copy(b.value.bvh.boxes[sorterSource.value]);
        scene.add(sorterSrcBox);
    } else {
        scene.remove(sorterSrcBox);
    }
});

// 退出 placing / 切换建筑时清理中途状态
watchEffect(() => {
    placement.mode; placement.selectedItemId;
    if (!isPlacingBelt()) {
        beltStart = null;
        hideBeltPreview();
    }
    if (!isPlacingSorter())
        sorterSource.value = null;
});

onMounted(() => {
	const rootEl = root.value!;

	controls = new PlanetMapControls(camera, renderer.domElement);
	const c = controls;
	c.listenToKeyEvents(rootEl);
	c.minDistance = R * 1.04;
	c.maxDistance = R * 4;
	c.targetRadius = R;
	onUnmounted(() => c.dispose());
	c.update();

	const ray = new Ray();
	const planetSphere = new Sphere(new Vector3(), R);
	const v = new Vector3();
	const GRID_SIZE = 1000; // 200 segments * 5 grids/segment
	const RAD_TO_GRID = GRID_SIZE / (2 * Math.PI);

	const setupRay = (e: MouseEvent) => {
		ray.origin.setFromMatrixPosition(camera.matrixWorld);
		const rect = renderer.domElement.getBoundingClientRect();
		ray.direction.x = ((e.clientX - rect.left) / rect.width ) * 2 - 1;
		ray.direction.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
		ray.direction.z = .5;
		ray.direction.unproject(camera).sub(ray.origin).normalize();
	}
	const pickBuilding = (e: MouseEvent) => {
		if (b.value === null)
			return null;
		setupRay(e);
		const intersects = b.value.bvh.raycast(ray)
		if (intersects.length === 0)
			return null;

		const intersectPlanet = ray.intersectSphere(planetSphere, v);
		if (intersectPlanet !== null && intersectPlanet.distanceToSquared(ray.origin) < intersects[0].distanceSquared)
			intersects.length = 0;

		return intersects.length === 0 ? null : intersects[0].index
	}
	/** Raycast to planet sphere, return 3D hit point or null */
	const screenToPlanet = (e: MouseEvent): Vector3 | null => {
		setupRay(e);
		return ray.intersectSphere(planetSphere, v);
	}
	/** 屏幕点击 → 吸附后的网格偏移（placeBuilding 与预览共用，保证坐标逻辑一致） */
	const placementOffset = (e: MouseEvent) => {
		const hit = screenToPlanet(e);
		if (hit === null)
			return null;
		const latGrid = Math.asin(hit.y / R) * RAD_TO_GRID;
		const lonGrid = Math.atan2(hit.x, hit.z) * RAD_TO_GRID;
		const offset = planetToLocal(latGrid, lonGrid);
		if (!placement.freePlacement) {
			offset.x = Math.floor(offset.x);
			offset.y = Math.floor(offset.y);
		}
		return { x: offset.x, y: offset.y };
	}
	/** Place building at clicked planet position */
	const placeBuilding = (e: MouseEvent) => {
		const queue = commandQueue.value;
		if (!queue || placement.selectedItemId === null || placement.selectedModelIndex === null)
			return;
		const offset = placementOffset(e);
		if (offset === null)
			return;
		const building = createBuilding(
			placement.selectedItemId,
			placement.selectedModelIndex,
			offset,
			placement.yaw,
		);
		try {
			queue.push(new CreateBuildingCommand(building));
		} catch {
			// Outside equator band — ignore
		}
	}
	/** 鼠标跟随预览：placing 模式下更新半透明绿盒的位置与朝向 */
	let lastMouseEvent: MouseEvent | null = null;
	const updatePreview = (e: MouseEvent) => {
		if (placement.appMode !== 'edit' || placement.mode !== 'placing') {
			if (previewVisible.value)
				previewVisible.value = false;
			return;
		}
		const offset = placementOffset(e);
		if (offset === null || b.value === null
			|| placement.selectedItemId === null || placement.selectedModelIndex === null) {
			previewVisible.value = false;
			return;
		}
		const meta = buildingMeta.get(placement.selectedModelIndex);
		if (!meta) {
			previewVisible.value = false;
			return;
		}
		const fake = createBuilding(placement.selectedItemId, placement.selectedModelIndex, offset, placement.yaw);
		const trans = calcBuildingTrans(R, b.value.pos, fake)[0];
		previewMesh.matrix.multiplyMatrices(trans, meta.unitBoxTrans);
		previewVisible.value = true;
	}
	// 传送带拖拽预览：把起点到当前点的栅格化路径写入实例网格
	const beltPreviewM = new Matrix4();
	const beltLift = new Matrix4().makeTranslation(0, 0, 0.05);
	const updateBeltPreview = (p0: { x: number, y: number }, e: MouseEvent) => {
		if (b.value === null || placement.selectedItemId === null || placement.selectedModelIndex === null)
			return;
		const cur = placementOffset(e);
		if (cur === null)
			return;
		const pts = rasterizeLine(p0.x, p0.y, cur.x, cur.y);
		const n = Math.min(pts.length, BELT_PREVIEW_CAP);
		for (let i = 0; i < n; i++) {
			const fake = createBuilding(placement.selectedItemId, placement.selectedModelIndex, pts[i], 0);
			const t = calcBuildingTrans(R, b.value.pos, fake)[0];
			beltPreviewM.multiplyMatrices(t, beltLift);
			beltPreviewMesh.setMatrixAt(i, beltPreviewM);
		}
		beltPreviewMesh.count = n;
		beltPreviewMesh.instanceMatrix.needsUpdate = true;
		beltPreviewVisible.value = n > 0;
	}
	/** 松开鼠标：提交整条传送带（一次撤销） */
	const commitBeltLine = (e: MouseEvent) => {
		const queue = commandQueue.value;
		const start = beltStart;
		beltStart = null;
		hideBeltPreview();
		if (!queue || !start || placement.selectedItemId === null || placement.selectedModelIndex === null)
			return;
		const end = placementOffset(e);
		if (end === null)
			return;
		const belts = buildBeltLine(placement.selectedItemId, placement.selectedModelIndex, start, end, placement.yaw);
		if (belts.length === 0)
			return;
		try {
			queue.push(new CreateBeltLineCommand(belts));
		} catch {
			// Outside equator band — ignore
		}
	}
	/** 分拣器两点架接 */
	const pickSorterPoint = (e: MouseEvent) => {
		const queue = commandQueue.value;
		if (!queue)
			return;
		const index = pickBuilding(e);
		if (sorterSource.value === null) {
			if (index !== null)
				sorterSource.value = index;
			return;
		}
		const src = sorterSource.value;
		sorterSource.value = null;
		if (index === null || index === src || placement.selectedItemId === null || placement.selectedModelIndex === null)
			return;
		const sorter = createSorterBetween(
			queue.data.buildings[src], queue.data.buildings[index],
			placement.selectedItemId, placement.selectedModelIndex,
		);
		if (sorter)
			queue.push(new CreateBuildingCommand(sorter));
	}
	const onMouseUp = (e: MouseEvent) => {
		if (isPlacingBelt() && beltStart !== null)
			commitBeltLine(e);
	}
	const onPointerMove = (e: MouseEvent) => {
		lastMouseEvent = e;
		if (isPlacingBelt() && beltStart !== null)
			updateBeltPreview(beltStart, e);
		else
			updatePreview(e);
	}
	const onMouseLeave = () => { lastMouseEvent = null; previewVisible.value = false; };
	// 鼠标静止时，键盘切换建筑 / R 旋转 / Shift 吸附变化也要刷新预览
	watchEffect(() => {
		if (lastMouseEvent)
			updatePreview(lastMouseEvent);
	});
	/** Delete building at clicked position */
	const deleteBuilding = (e: MouseEvent) => {
		const index = pickBuilding(e);
		if (index === null)
			return;
		const queue = commandQueue.value;
		if (!queue)
			return;
		queue.push(new RemoveBuildingCommand(index, queue.data));
		emit('update:selectedBuildingIndex', null);
	}

	// Drag threshold: distinguish click from drag.
	// Listen on rootEl (parent div) — events bubble from canvas, unaffected by
	// PlanetMapControls' setPointerCapture which only captures pointer events.
	const DRAG_THRESHOLD = 4;
	let downPos: { x: number, y: number } | null = null;
	const onMouseDown = (e: MouseEvent) => {
		downPos = { x: e.clientX, y: e.clientY };
		if (isPlacingBelt())
			beltStart = placementOffset(e);
	}
	const onClick = (e: MouseEvent) => {
		if (downPos === null)
			return;
		const dx = e.clientX - downPos.x;
		const dy = e.clientY - downPos.y;
		downPos = null;
		// 传送带在 mouseup 已整条提交，click 忽略（拖拽位移也合法）
		if (isPlacingBelt())
			return;
		if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD)
			return; // was a drag, not a click
		// Left click: place / delete / select
		if (placement.mode === 'placing') {
			if (isPlacingSorter())
				pickSorterPoint(e);
			else
				placeBuilding(e);
		}
		else if (placement.mode === 'deleting')
			deleteBuilding(e);
		else {
			const index = pickBuilding(e);
			if (index === null)
				emit('clickEmpty');
			emit('update:selectedBuildingIndex', index);
		}
	}
	const onContextMenu = (e: MouseEvent) => {
		// Right click: exit placement/deleting mode (PlanetMapControls already
		// preventDefault on canvas; this fires via bubbling)
		// 预览模式：右键直接删除鼠标所指建筑
    if (placement.appMode === 'preview') {
        e.preventDefault();
        deleteBuilding(e);         // 内部已 emit(selectedBuildingIndex, null)
        return;
    }
    // 编辑模式：原行为 —— 退出 placing/deleting
    if (placement.mode !== 'idle') {
        e.preventDefault();
        resetToIdle();
    }
	}
	rootEl.addEventListener('mousedown', onMouseDown);
	rootEl.addEventListener('mouseup', onMouseUp);
	rootEl.addEventListener('click', onClick);
	rootEl.addEventListener('contextmenu', onContextMenu);
	rootEl.addEventListener('pointermove', onPointerMove);
	rootEl.addEventListener('mouseleave', onMouseLeave);
	onUnmounted(() => {
		rootEl.removeEventListener('mousedown', onMouseDown);
		rootEl.removeEventListener('mouseup', onMouseUp);
		rootEl.removeEventListener('click', onClick);
		rootEl.removeEventListener('contextmenu', onContextMenu);
		rootEl.removeEventListener('pointermove', onPointerMove);
		rootEl.removeEventListener('mouseleave', onMouseLeave);
	});

	let mounted = true;
	onUnmounted(() => { mounted = false; });
	let lastTimeStamp : number | null = null
	function animate(time: number) {
		if (!mounted)
			return;
		if (lastTimeStamp) {
			c.updateTimeDelta((time - lastTimeStamp) / 1000);
		}
		if (b.value?.buildings.cargos) {
			const move = (time % 1000) / 1000;
			for (const c of b.value.buildings.cargos)
				c.cargoMove = move;
		}
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
});

const selectBoxes = computed(() => b.value?.bvh.boxes);
const cameraPosVersion = ref(0);
const getModel = (index: number) => {
	if (b.value === null)
		return null
	const ref = b.value.buildings.modelRef[index]
	const m = new Matrix4();
	ref.mesh.getMatrixAt(ref.instance, m)
	return m;
}
/** 重置相机视角到默认位置（星球正上方默认距离） */
const resetCamera = () => {
	controls?.reset(2 * R);
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
