import {
    CanvasTexture, Color, Euler, Group, InstancedMesh,
    Matrix4, MeshLambertMaterial, MeshStandardMaterial,
    PlaneGeometry, SRGBColorSpace,
} from 'three';
import { BlueprintReformData } from './parser';
import { PositionedBlueprint } from './planet';

/** 无地基（未改造），不渲染 */
export const REFORM_TYPE_NONE = 0;
/** 默认工字铺地基（错缝铺设的金属板） */
export const REFORM_TYPE_IBEAM = 1;
/** 直铺地基（对齐铺设的金属板） */
export const REFORM_TYPE_GRID = 2;
/** 无装饰地基（纯色，无金属板） */
export const REFORM_TYPE_PLAIN = 7;

/** 地基相对星球表面的抬升量，介于地表与经纬网格线之间 */
const REFORM_LIFT = 0.015;
/** 单格地基板相对网格步距的缩放，略微内缩以避免相邻格共边闪烁 */
const TILE_SCALE = 0.985;

/**
 * 游戏内置地基默认色板（地形改造面板，索引 0..14）。
 * 游戏未在蓝图中导出该表，此处为与游戏内色板近似的混凝土色调；
 * 蓝图携带自定义颜色（customReformColorMask + customReformColors）时以蓝图实际颜色为准。
 */
const DEFAULT_REFORM_COLORS: readonly number[] = [
    0x94948F, // 0  默认灰
    0xD9D9D4, // 1  白
    0x4F4F4F, // 2  黑
    0xC05048, // 3  红
    0xD17C3E, // 4  橙
    0xD8B740, // 5  黄
    0x9EB34A, // 6  黄绿
    0x5EA85C, // 7  绿
    0x46A88E, // 8  青绿
    0x4A9FC2, // 9  青蓝
    0x4B78C2, // 10 蓝
    0x7B60C2, // 11 紫
    0xAF60B5, // 12 品红
    0xD2729A, // 13 粉
    0x8A5C3C, // 14 棕
];

interface ReformCell {
    areaIndex: number;
    gx: number;
    gy: number;
    type: number;
    colorIndex: number;
}

/**
 * 将地基矩形展开为逐格数据。
 * 同一格被多个矩形覆盖时以后出现的矩形为准（与游戏重复改造的效果一致）；
 * type 为 0（无地基）的格子不渲染。
 */
function expandReformCells(data: BlueprintReformData): ReformCell[] {
    // areaIndex(0..255) 与 int16 格坐标编码进一个 double 安全整数作为去重键
    const cells = new Map<number, ReformCell>();
    for (const rect of data.rects) {
        if (rect.type === REFORM_TYPE_NONE)
            continue;
        for (let dx = 0; dx < rect.w; dx++) {
            for (let dy = 0; dy < rect.h; dy++) {
                const gx = rect.x + dx;
                const gy = rect.y + dy;
                const key = rect.areaIndex * 0x100000000
                    + ((gx & 0xFFFF) << 16)
                    + (gy & 0xFFFF);
                cells.set(key, {
                    areaIndex: rect.areaIndex,
                    gx, gy,
                    type: rect.type,
                    colorIndex: rect.color & 0x1F,
                });
            }
        }
    }
    return [...cells.values()];
}

/**
 * 解析 32 个地基颜色槽位。
 * customReformColorMask 第 i 位置位时，该槽位使用自定义颜色；
 * customReformColors 按置位槽位升序紧凑存储。
 * uint32 为小端 Color32（0xRRGGBB），alpha 恒为 255。
 */
function resolveReformColors(data: BlueprintReformData): Color[] {
    const colors: Color[] = new Array(32);
    let rank = 0;
    for (let i = 0; i < 32; i++) {
        if (((data.customReformColorMask >>> i) & 1) !== 0) {
            const v = data.customReformColors[rank] ?? 0;
            colors[i] = new Color(v & 0xFFFFFF);
            rank++;
        } else {
            const hex = DEFAULT_REFORM_COLORS[i] ?? 0x808080;
            colors[i] = new Color(hex);
        }
    }
    return colors;
}

const TEXTURE_SIZE = 128;
const GROOVE_COLOR = 'rgb(96,96,96)';

/** 绘制单块金属板：底板渐变 + 边缘倒角高光/阴影 + 四角铆钉 */
function drawMetalPlate(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
) {
    const px = x + 2, py = y + 2, pw = w - 4, ph = h - 4;
    // 底色接近白色：纹理与实例地基色为相乘关系，浅灰纹理才能让自定义颜色准确显色
    const grad = ctx.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, 'rgb(232,232,232)');
    grad.addColorStop(0.5, 'rgb(220,220,220)');
    grad.addColorStop(1, 'rgb(206,206,206)');
    ctx.fillStyle = grad;
    ctx.fillRect(px, py, pw, ph);

    // 倒角：左上高光、右下阴影
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(px, py, pw, 2);
    ctx.fillRect(px, py, 2, ph);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(px, py + ph - 2, pw, 2);
    ctx.fillRect(px + pw - 2, py, 2, ph);

    // 四角铆钉
    for (const [rx, ry] of [[px + 6, py + 6], [px + pw - 9, py + 6], [px + 6, py + ph - 9], [px + pw - 9, py + ph - 9]] as const) {
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.fillRect(rx + 1, ry + 1, 3, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(rx, ry, 3, 2);
    }
}

/** 直铺：2×2 对齐金属板 */
function drawGridPattern(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = GROOVE_COLOR;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const plate = TEXTURE_SIZE / 2;
    for (let ox = 0; ox < TEXTURE_SIZE; ox += plate)
        for (let oy = 0; oy < TEXTURE_SIZE; oy += plate)
            drawMetalPlate(ctx, ox, oy, plate, plate);
}

/** 工字铺：错缝（跑砖）排列的金属板，纹理可向四周无缝拼接 */
function drawIBeamPattern(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = GROOVE_COLOR;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const brickW = TEXTURE_SIZE / 2;
    const rowH = TEXTURE_SIZE / 4;
    for (let row = 0; row < 4; row++) {
        const offset = (row % 2) * brickW / 2;
        for (let bx = -brickW; bx <= TEXTURE_SIZE; bx += brickW)
            drawMetalPlate(ctx, bx + offset, row * rowH, brickW, rowH);
    }
}

let plateGeometry: PlaneGeometry | null = null;
let baseMaterial: MeshLambertMaterial | null = null;
let ibeamTexture: CanvasTexture | null = null;
let gridTexture: CanvasTexture | null = null;
let ibeamMaterial: MeshStandardMaterial | null = null;
let gridMaterial: MeshStandardMaterial | null = null;

function createPlateTexture(pattern: 'ibeam' | 'grid'): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d')!;
    if (pattern === 'ibeam')
        drawIBeamPattern(ctx);
    else
        drawGridPattern(ctx);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/**
 * 地基图层（纯色底层 + 工字铺/直铺金属板覆盖层）。
 * 几何/材质/纹理为进程级共享资源，场景重建时仅从场景移除、不释放 GPU 资源。
 */
export class Reforms extends Group {}

function getSharedResources() {
    if (plateGeometry === null)
        plateGeometry = new PlaneGeometry(1, 1);
    if (baseMaterial === null)
        baseMaterial = new MeshLambertMaterial();
    if (ibeamTexture === null)
        ibeamTexture = createPlateTexture('ibeam');
    if (gridTexture === null)
        gridTexture = createPlateTexture('grid');
    if (ibeamMaterial === null)
        // 无环境贴图的场景下降低 metalness，保证金属板既有光泽又不会过暗
        ibeamMaterial = new MeshStandardMaterial({
            map: ibeamTexture,
            metalness: 0.5,
            roughness: 0.45,
        });
    if (gridMaterial === null)
        gridMaterial = new MeshStandardMaterial({
            map: gridTexture,
            metalness: 0.5,
            roughness: 0.45,
        });
    return { plateGeometry, baseMaterial, ibeamMaterial, gridMaterial };
}

const euler = new Euler();
const rotationMatrix = new Matrix4();
const tileMatrix = new Matrix4();
const scaleMatrix = new Matrix4();

/**
 * 构建地基图层：每个地基格一个位于星球表面的小方格，
 * 颜色取地基颜色槽位；工字铺/直铺类型额外覆盖带金属光泽的板纹。
 */
export function buildReforms(
    R: number,
    pos: PositionedBlueprint,
    reformData: BlueprintReformData | null | undefined,
): Reforms | null {
    if (reformData === null || reformData === undefined || reformData.rects.length === 0)
        return null;
    const cells = expandReformCells(reformData);
    if (cells.length === 0)
        return null;
    const colors = resolveReformColors(reformData);
    const { plateGeometry, baseMaterial, ibeamMaterial, gridMaterial } = getSharedResources();

    let numIBeam = 0;
    let numGrid = 0;
    for (const cell of cells) {
        if (cell.type === REFORM_TYPE_IBEAM)
            numIBeam++;
        else if (cell.type === REFORM_TYPE_GRID)
            numGrid++;
    }

    const baseMesh = new InstancedMesh(plateGeometry, baseMaterial, cells.length);
    const ibeamMesh = numIBeam > 0 ? new InstancedMesh(plateGeometry, ibeamMaterial, numIBeam) : null;
    const gridMesh = numGrid > 0 ? new InstancedMesh(plateGeometry, gridMaterial, numGrid) : null;

    // 包围球跨整个星球，关闭视锥剔除避免近处浏览时被错误剔除
    baseMesh.frustumCulled = false;
    if (ibeamMesh)
        ibeamMesh.frustumCulled = false;
    if (gridMesh)
        gridMesh.frustumCulled = false;

    let ibeamIdx = 0;
    let gridIdx = 0;
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const area = pos.areas[cell.areaIndex];
        const longitudeGridSize = 2 * Math.PI / area.segment / 5;
        const latitudeGridSize = 2 * Math.PI / pos.segment / 5;
        const longitude = (area.longitude + cell.gx) * longitudeGridSize;
        const latitude = (area.latitude + cell.gy) * latitudeGridSize;

        euler.set(-latitude, longitude, 0, 'YXZ');
        rotationMatrix.makeRotationFromEuler(euler);
        // 与 calcBuildingTrans 相同的定位约定：先绕到经纬朝向，再沿本地 z 抬到地表
        tileMatrix.makeTranslation(0, 0, R + REFORM_LIFT);
        tileMatrix.premultiply(rotationMatrix);
        // 高纬处经度方向按 cos(纬度) 收缩；贴花纹理层与底层完全重合
        scaleMatrix.makeScale(
            R * longitudeGridSize * Math.cos(latitude) * TILE_SCALE,
            R * latitudeGridSize * TILE_SCALE,
            1,
        );
        tileMatrix.multiply(scaleMatrix);

        baseMesh.setMatrixAt(i, tileMatrix);
        baseMesh.setColorAt(i, colors[cell.colorIndex]);

        if (cell.type === REFORM_TYPE_IBEAM && ibeamMesh) {
            ibeamMesh.setMatrixAt(ibeamIdx, tileMatrix);
            ibeamMesh.setColorAt(ibeamIdx, colors[cell.colorIndex]);
            ibeamIdx++;
        } else if (cell.type === REFORM_TYPE_GRID && gridMesh) {
            gridMesh.setMatrixAt(gridIdx, tileMatrix);
            gridMesh.setColorAt(gridIdx, colors[cell.colorIndex]);
            gridIdx++;
        }
    }

    baseMesh.instanceMatrix.needsUpdate = true;
    baseMesh.instanceColor!.needsUpdate = true;
    if (ibeamMesh) {
        ibeamMesh.instanceMatrix.needsUpdate = true;
        ibeamMesh.instanceColor!.needsUpdate = true;
    }
    if (gridMesh) {
        gridMesh.instanceMatrix.needsUpdate = true;
        gridMesh.instanceColor!.needsUpdate = true;
    }

    const reforms = new Reforms();
    reforms.add(baseMesh);
    if (ibeamMesh)
        reforms.add(ibeamMesh);
    if (gridMesh)
        reforms.add(gridMesh);
    return reforms;
}
