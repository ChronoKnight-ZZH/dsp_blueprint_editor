/**
 * 预览层：增量事件的**同步摄入 + 每帧跟随**。
 *
 * 为什么不是"逐条播放队列"：实测 250 条事件 ≈ 5 秒到达（≈50 条/秒，20ms 一条），
 * 而"每条事件播一段动画"在 20ms 的间隔里物理上无法呈现。指南也明确允许
 * "动画可以跳过中间视觉过渡，但对象的新增、更新、删除顺序必须保持正确"。
 *
 * 于是拆成两段（对应 `data/3.` 的 §3.1）：
 * 1. **摄入 ingest**：`onProgress` 回调内同步完成（目标 ≤2ms/事件/128 op）——
 *    只改内存状态（SoA 数组），不碰 GPU；
 * 2. **呈现 present**：每帧一次，把"目标值"向"当前值"指数收敛，只把脏槽写进
 *    `instanceMatrix` / `aOpacity`，并用 `addUpdateRange` 局部上传。
 *
 * 关键健壮性（全部来自真实样本，见 `data/4.`）：
 * - `sequence` 用 `>` 去重（跳号是常态，最多连跳 18）；
 * - `remove` 不存在的对象 → 静默忽略（中途订阅时实测 2.4 万次）；
 * - `replace` 不存在的对象 → 按 add 处理（否则对象永久丢失）；
 * - 抖动抑制：存活 <120ms 即被撤销的对象不出场（实测 77%~92% 的 add 会被撤）；
 * - 坐标系切换 → 硬重投影（不插值），因为那是语义跳变不是运动。
 */

import { Group, Matrix4, Vector3 } from "three";
import type { Object3D } from "three";
import { isBelt, isInserter } from "@/data/items";
import { INSERTER_HEIGHT } from "@/lib/core/geometryHelpers";
import {
    SLOT_ALIVE,
    SLOT_DYING,
    SLOT_FREE,
    SlotPool,
    buildPoolSpec,
    glbAvailable,
} from "./pools";
import type { PoolKind } from "./pools";
import { PreviewProjector } from "./projector";
import type { PreviewProjectorOptions, PreviewProjectorSnapshot } from "./projector";
import type {
    PreviewAlignedObject,
    PreviewAlignedSnapshot,
    PreviewBeginOptions,
    PreviewBuildingLike,
    PreviewCoordinateSystem,
    PreviewDeltaEvent,
    PreviewOperation,
    PreviewStats,
} from "./types";

const DEFAULT_SETTLE_MS = 100;
const DEFAULT_ENTER_DELAY_MS = 120;
const DEFAULT_MIN_LIFE_MS = 120;

/** 单池初始容量（按需翻倍） */
const INITIAL_CAPACITY: Record<PoolKind, number> = {
    belt: 4096,
    inserter: 512,
    glb: 512,
    box: 512,
};
/** 单池容量上限（防御性；实测单模型峰值 29,679） */
const MAX_CAPACITY = 1 << 18;

interface PoolEntry {
    readonly key: string;
    readonly kind: PoolKind;
    readonly modelIndex: number;
    readonly tint: number | null;
    pool: SlotPool;
}

interface ObjRecord {
    readonly entry: PoolEntry;
    slot: number;
    /** 首选输出目标（传送带连线用） */
    outputId: string | null;
    itemId: number;
}

const _m1 = new Matrix4();
const _m2 = new Matrix4();
const _p1 = new Vector3();
const _p2 = new Vector3();
const _p3 = new Vector3();

/** 预览层本体：一个 `Group` + 若干槽池 */
export class PreviewLayer {
    readonly group = new Group();

    private readonly projector: PreviewProjector;
    private readonly settleMs: number;
    private readonly enterDelayMs: number;
    private readonly minLifeMs: number;
    /** `false` = 不做插值（直接跳到目标），用于排障/低端设备 */
    private animate = true;

    private readonly entries = new Map<string, PoolEntry>();
    private readonly objects = new Map<string, ObjRecord>();

    private lastSequence = -1;
    private coordinateSystem: PreviewCoordinateSystem | null = null;
    private lastVersion = -1;
    private lastFrameTs: number | null = null;
    private disposed = false;

    private droppedEvents = 0;
    private unknownRemoves = 0;
    private unknownReplaces = 0;
    private filteredByThrash = 0;
    private ingestEvents = 0;
    private ingestOps = 0;
    /** 逻辑存活数（不含正在淡出的槽）——统计与验收都以它为准 */
    private logicalAlive = 0;
    private peakAlive = 0;
    private lastIngestMs = 0;
    private maxIngestMs = 0;

    constructor(
        options: PreviewBeginOptions & {
            projectorOptions?: PreviewProjectorOptions;
        } = {}
    ) {
        this.projector = new PreviewProjector({
            kind: options.projector ?? "sphere",
            ...(options.projectorOptions ?? {}),
        });
        this.settleMs = Math.max(16, options.settleMs ?? DEFAULT_SETTLE_MS);
        this.enterDelayMs = Math.max(
            0,
            options.enterDelayMs ?? DEFAULT_ENTER_DELAY_MS
        );
        this.minLifeMs = Math.max(0, options.minLifeMs ?? DEFAULT_MIN_LIFE_MS);
        this.group.name = "dsp:preview";
    }

    get object3d(): Object3D {
        return this.group;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /** 是否允许插值（`previewAnimation: 'off'` 时为 false） */
    setAnimate(value: boolean): void {
        this.animate = value;
    }

    projectorSnapshot(): PreviewProjectorSnapshot {
        return this.projector.snapshot();
    }

    /**
     * 导出「收敛后骨架」快照：每个逻辑存活对象的第一/第二端世界矩阵与骨架字段。
     *
     * 语义：只导出 `SLOT_ALIVE`（正在淡出 / 已释放的不算骨架）；矩阵取自
     * `curX/curY/curZ/curYaw` 与 `curX2/curY2/curZ2`，与 `writeSlot` 同一数据源，
     * 因此与画面逐像素一致。键为 `building-N` 解析出的建筑 ID。
     */
    exportAlignedSnapshot(): PreviewAlignedSnapshot | null {
        if (this.disposed) return null;
        const out = new Map<number, PreviewAlignedObject>();
        for (const [id, rec] of this.objects) {
            const pool = rec.entry.pool;
            const slot = rec.slot;
            if (pool.state[slot] !== SLOT_ALIVE) continue;
            const buildingIndex = parseBuildingIndex(id);
            if (buildingIndex === null) continue;

            const m1 = new Matrix4();
            this.projector.writeMatrix(
                m1,
                pool.curX[slot],
                pool.curY[slot],
                pool.curZ[slot],
                pool.curYaw[slot],
                pool.areaIndex[slot]
            );
            const m2 = new Matrix4();
            this.projector.writeMatrix(
                m2,
                pool.curX2[slot],
                pool.curY2[slot],
                pool.curZ2[slot],
                0,
                pool.areaIndex[slot]
            );

            out.set(buildingIndex, {
                objectId: id,
                buildingIndex,
                kind: rec.entry.kind,
                itemId: rec.itemId,
                modelIndex: rec.entry.modelIndex,
                areaIndex: pool.areaIndex[slot],
                x: pool.curX[slot],
                y: pool.curY[slot],
                z: pool.curZ[slot],
                yaw: pool.curYaw[slot],
                x2: pool.curX2[slot],
                y2: pool.curY2[slot],
                z2: pool.curZ2[slot],
                matrix: m1,
                matrix2: m2,
                outputBuildingIndex:
                    rec.outputId === null
                        ? null
                        : parseBuildingIndex(rec.outputId),
            });
        }
        return {
            objects: out,
            count: out.size,
            coordinateSystem: this.coordinateSystem,
        };
    }

    get stats(): PreviewStats {
        let slotsInUse = 0;
        let slots = 0;
        let moving = 0;
        for (const entry of this.entries.values()) {
            slotsInUse += entry.pool.alive;
            slots += entry.pool.highWater;
            moving += entry.pool.moving.size;
        }
        const alive = this.logicalAlive;
        return {
            events: this.ingestEvents,
            operations: this.ingestOps,
            droppedEvents: this.droppedEvents,
            unknownRemoves: this.unknownRemoves,
            unknownReplaces: this.unknownReplaces,
            alive,
            // 逻辑存活之外还有"正在淡出"的槽，占用显存但不属于逻辑对象
            fading: Math.max(0, slotsInUse - alive),
            peakAlive: this.peakAlive,
            moving,
            slots,
            filteredByThrash: this.filteredByThrash,
            coordinateSystem: this.coordinateSystem,
            lastIngestMs: this.lastIngestMs,
            maxIngestMs: this.maxIngestMs,
            disposed: this.disposed,
        };
    }

    // ------------------------------------------------------------ 摄入

    /**
     * 摄入一条事件。**同步执行、绝不抛错**（指南要求渲染异常在模块内部吞掉）。
     * 返回是否应用了内容（`preview-delta` 且序号新鲜）。
     */
    apply(event: PreviewDeltaEvent, now = nowMs()): boolean {
        if (this.disposed) return false;
        const started = perfNow();
        try {
            const applied = this.ingest(event, now);
            const cost = perfNow() - started;
            this.lastIngestMs = cost;
            if (cost > this.maxIngestMs) this.maxIngestMs = cost;
            return applied;
        } catch (e) {
            console.warn("[preview] 事件摄入异常（已忽略该事件）", e);
            return false;
        }
    }

    private ingest(event: PreviewDeltaEvent, now: number): boolean {
        // 只处理差量；阶段/完成事件由宿主管文案，这里不参与几何
        if (event.kind !== undefined && event.kind !== "preview-delta")
            return false;
        const ops = event.operations;
        if (ops === undefined || ops.length === 0) return false;

        if (typeof event.sequence === "number") {
            if (event.sequence <= this.lastSequence) {
                this.droppedEvents++;
                return false;
            }
            this.lastSequence = event.sequence;
        }

        if (event.coordinateSystem !== undefined)
            this.coordinateSystem = event.coordinateSystem;
        this.projector.setCoordinateSystem(event.coordinateSystem);
        if (event.areas !== undefined) this.projector.setAreas(event.areas);
        // 语义/投影变化 → 硬重投影（不插值），否则全场会"蠕动"
        if (this.projector.currentVersion !== this.lastVersion) {
            this.lastVersion = this.projector.currentVersion;
            this.reprojectAll();
        }

        let applied = 0;
        for (let i = 0; i < ops.length; i++) {
            if (this.applyOperation(ops[i], now)) applied++;
        }
        if (applied > 0) {
            this.ingestEvents++;
            this.ingestOps += ops.length;
            const alive = this.currentAlive();
            if (alive > this.peakAlive) this.peakAlive = alive;
        }
        return applied > 0;
    }

    private applyOperation(op: PreviewOperation, now: number): boolean {
        const id = op.objectId;
        if (typeof id !== "string") return false;

        if (op.type === "remove") return this.applyRemove(id, now);

        const building = op.building as PreviewBuildingLike | undefined;
        if (building === undefined || building.localOffset === undefined)
            return false;
        return this.applyAddOrReplace(op.type, id, building, now);
    }

    private applyRemove(id: string, now: number): boolean {
        const rec = this.objects.get(id);
        if (rec === undefined) {
            this.unknownRemoves++;
            return false;
        }
        const pool = rec.entry.pool;
        const slot = rec.slot;
        if (pool.state[slot] === SLOT_FREE) {
            this.objects.delete(id);
            return false;
        }
        const lived = now - pool.bornAt[slot];
        const wasDying = pool.state[slot] === SLOT_DYING;
        if (!wasDying) this.logicalAlive--;
        // 还活着且从未露面 → 直接回收，不产生"闪一下"
        if (pool.curOpacity[slot] <= 0 && lived < this.minLifeMs) {
            pool.release(slot);
            this.objects.delete(id);
            this.filteredByThrash++;
            return true;
        }
        pool.state[slot] = SLOT_DYING;
        pool.tgtOpacity[slot] = 0;
        pool.moving.add(slot);
        return true;
    }

    private applyAddOrReplace(
        type: "add" | "replace",
        id: string,
        b: PreviewBuildingLike,
        now: number
    ): boolean {
        const x = b.localOffset?.x ?? 0;
        const y = b.localOffset?.y ?? 0;
        const z = b.localOffset?.z ?? 0;
        const yaw = b.yaw ?? 0;
        const x2 = b.localOffset2?.x ?? x;
        const y2 = b.localOffset2?.y ?? y;
        const z2 = b.localOffset2?.z ?? z;
        const areaIndex = b.areaIndex ?? 0;
        const outputId =
            typeof b.outputObjectId === "string" ? b.outputObjectId : null;

        // layout 期喂 bbox（决定自适应 X/Y 缩放与居中）
        if (this.projector.observeGrid(x, y)) {
            this.lastVersion = this.projector.currentVersion;
            this.reprojectAll();
        }

        const existing = this.objects.get(id);
        if (existing !== undefined) {
            const pool = existing.entry.pool;
            const slot = existing.slot;
            pool.tgtX[slot] = x;
            pool.tgtY[slot] = y;
            pool.tgtZ[slot] = z;
            pool.tgtYaw[slot] = yaw;
            pool.tgtX2[slot] = x2;
            pool.tgtY2[slot] = y2;
            pool.tgtZ2[slot] = z2;
            pool.areaIndex[slot] = areaIndex;
            existing.outputId = outputId;
            existing.itemId = b.itemId;
            if (pool.state[slot] === SLOT_DYING) {
                // 撤销后又回来 → 复活，不重新淡入
                pool.state[slot] = SLOT_ALIVE;
                pool.tgtOpacity[slot] = 1;
                this.logicalAlive++;
            }
            pool.moving.add(slot);
            return true;
        }

        if (type === "replace") this.unknownReplaces++;

        const kind = this.kindOf(b.itemId, b.modelIndex);
        const entry = this.ensureEntry(kind, b.modelIndex);
        let slot = entry.pool.alloc();
        if (slot < 0) {
            this.growEntry(entry);
            slot = entry.pool.alloc();
            // 容量到顶：宁可这一帧不显示，也不在回调里分配 GPU 缓冲
            if (slot < 0) return false;
        }

        const pool = entry.pool;
        pool.ids[slot] = id;
        pool.bornAt[slot] = now;
        pool.curX[slot] = x;
        pool.curY[slot] = y;
        pool.curZ[slot] = z;
        pool.curYaw[slot] = yaw;
        pool.curX2[slot] = x2;
        pool.curY2[slot] = y2;
        pool.curZ2[slot] = z2;
        pool.tgtX[slot] = x;
        pool.tgtY[slot] = y;
        pool.tgtZ[slot] = z;
        pool.tgtYaw[slot] = yaw;
        pool.tgtX2[slot] = x2;
        pool.tgtY2[slot] = y2;
        pool.tgtZ2[slot] = z2;
        pool.areaIndex[slot] = areaIndex;
        pool.curOpacity[slot] = 0;
        // 抖动抑制：先不可见，满 `enterDelayMs` 后再淡入（见 `tick`）
        pool.tgtOpacity[slot] = this.enterDelayMs > 0 ? 0 : 1;
        this.objects.set(id, { entry, slot, outputId, itemId: b.itemId });
        pool.moving.add(slot);
        this.logicalAlive++;
        return true;
    }

    private currentAlive(): number {
        return this.logicalAlive;
    }

    private kindOf(itemId: number, modelIndex: number): PoolKind {
        if (isBelt(itemId)) return "belt";
        if (isInserter(itemId)) return "inserter";
        if (glbAvailable(modelIndex)) return "glb";
        return "box";
    }

    private ensureEntry(kind: PoolKind, modelIndex: number): PoolEntry {
        const key = `${kind}:${modelIndex}`;
        const found = this.entries.get(key);
        if (found !== undefined) return found;

        const spec = buildPoolSpec(kind, modelIndex, INITIAL_CAPACITY[kind], null);
        const pool = new SlotPool(spec);
        for (const mesh of pool.meshes) this.group.add(mesh);
        const entry: PoolEntry = {
            key,
            kind,
            modelIndex,
            tint: spec.tint ?? null,
            pool,
        };
        this.entries.set(key, entry);
        return entry;
    }

    /** 池满 → 容量翻倍并搬迁状态（对象表存的是 entry，槽号语义不变） */
    private growEntry(entry: PoolEntry): void {
        const old = entry.pool;
        const capacity = Math.min(MAX_CAPACITY, old.capacity * 2);
        if (capacity <= old.capacity) return;
        const spec = buildPoolSpec(entry.kind, entry.modelIndex, capacity, entry.tint);
        const next = new SlotPool(spec);
        const kept = Math.min(old.capacity, capacity);
        for (let i = 0; i < kept; i++) {
            next.state[i] = old.state[i];
            next.ids[i] = old.ids[i];
            next.curX[i] = old.curX[i];
            next.curY[i] = old.curY[i];
            next.curZ[i] = old.curZ[i];
            next.curYaw[i] = old.curYaw[i];
            next.tgtX[i] = old.tgtX[i];
            next.tgtY[i] = old.tgtY[i];
            next.tgtZ[i] = old.tgtZ[i];
            next.tgtYaw[i] = old.tgtYaw[i];
            next.curX2[i] = old.curX2[i];
            next.curY2[i] = old.curY2[i];
            next.curZ2[i] = old.curZ2[i];
            next.tgtX2[i] = old.tgtX2[i];
            next.tgtY2[i] = old.tgtY2[i];
            next.tgtZ2[i] = old.tgtZ2[i];
            next.areaIndex[i] = old.areaIndex[i];
            next.curOpacity[i] = old.curOpacity[i];
            next.tgtOpacity[i] = old.tgtOpacity[i];
            next.bornAt[i] = old.bornAt[i];
            if (old.state[i] !== SLOT_FREE) next.moving.add(i);
        }
        next.highWater = Math.min(old.highWater, capacity);
        next.alive = old.alive;
        rebuildFreeList(next, kept, old);

        this.swapPool(entry, next);
    }

    /**
     * GLB 模型加载完成后把对应池换成真模型（盒 → GLB）。
     * 由 `RenderCore` 的"模型到达"节流回调触发。
     */
    resyncModels(): void {
        if (this.disposed) return;
        for (const entry of this.entries.values()) {
            if (entry.kind !== "glb" || entry.pool.kind === "glb") continue;
            if (!glbAvailable(entry.modelIndex)) continue;
            const capacity = entry.pool.capacity;
            const spec = buildPoolSpec(entry.kind, entry.modelIndex, capacity, entry.tint);
            if (spec.kind !== "glb" || spec.parts === undefined) continue;
            const old = entry.pool;
            const next = new SlotPool(spec);
            const kept = Math.min(old.capacity, next.capacity);
            for (let i = 0; i < kept; i++) {
                next.state[i] = old.state[i];
                next.ids[i] = old.ids[i];
                next.curX[i] = old.curX[i];
                next.curY[i] = old.curY[i];
                next.curZ[i] = old.curZ[i];
                next.curYaw[i] = old.curYaw[i];
                next.tgtX[i] = old.tgtX[i];
                next.tgtY[i] = old.tgtY[i];
                next.tgtZ[i] = old.tgtZ[i];
                next.tgtYaw[i] = old.tgtYaw[i];
                next.curX2[i] = old.curX2[i];
                next.curY2[i] = old.curY2[i];
                next.curZ2[i] = old.curZ2[i];
                next.tgtX2[i] = old.tgtX2[i];
                next.tgtY2[i] = old.tgtY2[i];
                next.tgtZ2[i] = old.tgtZ2[i];
                next.areaIndex[i] = old.areaIndex[i];
                next.curOpacity[i] = old.curOpacity[i];
                next.tgtOpacity[i] = old.tgtOpacity[i];
                next.bornAt[i] = old.bornAt[i];
                if (old.state[i] !== SLOT_FREE) next.moving.add(i);
            }
            next.highWater = old.highWater;
            next.alive = old.alive;
            rebuildFreeList(next, kept, old);
            this.swapPool(entry, next);
        }
    }

    private swapPool(entry: PoolEntry, next: SlotPool): void {
        const old = entry.pool;
        for (const mesh of old.meshes) mesh.removeFromParent();
        old.dispose();
        for (const mesh of next.meshes) this.group.add(mesh);
        entry.pool = next;
    }

    /** 硬重投影：所有存活槽的当前值 = 目标值（不插值），并整片标脏 */
    private reprojectAll(): void {
        for (const entry of this.entries.values()) {
            const pool = entry.pool;
            for (let slot = 0; slot < pool.highWater; slot++) {
                if (pool.state[slot] === SLOT_FREE) continue;
                pool.curX[slot] = pool.tgtX[slot];
                pool.curY[slot] = pool.tgtY[slot];
                pool.curZ[slot] = pool.tgtZ[slot];
                pool.curYaw[slot] = pool.tgtYaw[slot];
                pool.curX2[slot] = pool.tgtX2[slot];
                pool.curY2[slot] = pool.tgtY2[slot];
                pool.curZ2[slot] = pool.tgtZ2[slot];
                pool.moving.add(slot);
            }
        }
    }

    // ------------------------------------------------------------ 呈现

    /** 每帧调用一次（在 rAF 循环里） */
    tick(now = nowMs()): void {
        if (this.disposed) return;
        const dt =
            this.lastFrameTs === null
                ? 16.7
                : Math.min(100, Math.max(0, now - this.lastFrameTs));
        this.lastFrameTs = now;
        const alpha = this.animate ? 1 - Math.exp(-dt / this.settleMs) : 1;

        for (const entry of this.entries.values()) {
            const pool = entry.pool;
            if (pool.moving.size > 0) {
                for (const slot of pool.moving) {
                    if (pool.state[slot] === SLOT_FREE) {
                        pool.moving.delete(slot);
                        continue;
                    }
                    // 抖动抑制：延迟窗口到期后才开始淡入
                    if (
                        pool.state[slot] === SLOT_ALIVE &&
                        pool.tgtOpacity[slot] === 0 &&
                        this.enterDelayMs > 0 &&
                        now - pool.bornAt[slot] >= this.enterDelayMs
                    )
                        pool.tgtOpacity[slot] = 1;

                    const converged = this.advance(pool, slot, alpha);
                    this.writeSlot(entry, slot);
                    pool.markDirty(slot);
                    if (!converged) continue;

                    if (
                        pool.state[slot] === SLOT_DYING &&
                        pool.curOpacity[slot] <= 0.02
                    ) {
                        // 先取 id：`release()` 会把 `pool.ids[slot]` 清空，
                        // 之后再查对象表就找不到了（曾经因此泄漏 2,500+ 条记录）
                        const id = pool.ids[slot];
                        pool.release(slot);
                        this.forget(id, slot, pool);
                    } else {
                        pool.moving.delete(slot);
                    }
                }
                pool.flushDirty();
            }
            pool.syncCount();
        }
    }

    private advance(pool: SlotPool, slot: number, alpha: number): boolean {
        const dx = pool.tgtX[slot] - pool.curX[slot];
        const dy = pool.tgtY[slot] - pool.curY[slot];
        const dz = pool.tgtZ[slot] - pool.curZ[slot];
        const yawDelta = pool.tgtYaw[slot] - pool.curYaw[slot];
        const dw = (((yawDelta + 180) % 360) + 360) % 360 - 180;

        pool.curX[slot] += dx * alpha;
        pool.curY[slot] += dy * alpha;
        pool.curZ[slot] += dz * alpha;
        pool.curYaw[slot] += dw * alpha;
        pool.curX2[slot] += (pool.tgtX2[slot] - pool.curX2[slot]) * alpha;
        pool.curY2[slot] += (pool.tgtY2[slot] - pool.curY2[slot]) * alpha;
        pool.curZ2[slot] += (pool.tgtZ2[slot] - pool.curZ2[slot]) * alpha;
        pool.curOpacity[slot] +=
            (pool.tgtOpacity[slot] - pool.curOpacity[slot]) * alpha;

        // 1e-2 格 = 约 1% 个建筑格，视觉上已经不可分辨；再小会让 3 万槽长期留在
        // `moving` 里白算（实测 10 格位移要 55 帧才能压到 1e-3）
        const settled =
            Math.abs(dx) < 1e-2 &&
            Math.abs(dy) < 1e-2 &&
            Math.abs(dz) < 1e-2 &&
            Math.abs(dw) < 0.05 &&
            Math.abs(pool.tgtOpacity[slot] - pool.curOpacity[slot]) < 2e-3;
        if (!settled) return false;
        // 目标仍为 0 而状态是存活 = 还在等淡入窗口，不能移出 moving
        if (pool.state[slot] === SLOT_ALIVE && pool.tgtOpacity[slot] === 0)
            return false;
        // 收敛后吸附到目标值，避免"永远差一点点"的累积误差
        pool.curX[slot] = pool.tgtX[slot];
        pool.curY[slot] = pool.tgtY[slot];
        pool.curZ[slot] = pool.tgtZ[slot];
        pool.curYaw[slot] = pool.tgtYaw[slot];
        pool.curX2[slot] = pool.tgtX2[slot];
        pool.curY2[slot] = pool.tgtY2[slot];
        pool.curZ2[slot] = pool.tgtZ2[slot];
        pool.curOpacity[slot] = pool.tgtOpacity[slot];
        return true;
    }

    /** 释放槽之后同步对象表（槽被复用后旧 id 不能再指向它） */
    private forget(id: string | null, slot: number, pool: SlotPool): void {
        if (id === null) return;
        const rec = this.objects.get(id);
        if (rec !== undefined && rec.slot === slot && rec.entry.pool === pool)
            this.objects.delete(id);
    }

    /** 写一个槽的矩阵（含传送带连线、分拣器两端） */
    private writeSlot(entry: PoolEntry, slot: number): void {
        const pool = entry.pool;
        const areaIndex = pool.areaIndex[slot];
        (pool.opacity.array as Float32Array)[slot] = pool.curOpacity[slot];

        this.projector.writeMatrix(
            _m1,
            pool.curX[slot],
            pool.curY[slot],
            pool.curZ[slot],
            pool.curYaw[slot],
            areaIndex
        );

        if (entry.kind === "belt") {
            _m2.multiplyMatrices(_m1, pool.pre[0]);
            pool.meshes[0].setMatrixAt(slot, _m2);
            this.writeBeltLink(pool, slot);
            return;
        }
        if (entry.kind === "inserter") {
            this.writeInserter(pool, slot);
            return;
        }
        for (let i = 0; i < pool.meshes.length; i++) {
            _m2.multiplyMatrices(_m1, pool.pre[i]);
            pool.meshes[i].setMatrixAt(slot, _m2);
        }
    }

    /** 传送带连线：从本槽指向输出对象的**当前视觉位置** */
    private writeBeltLink(pool: SlotPool, slot: number): void {
        const linkMesh = pool.meshes[1];
        if (linkMesh === undefined) return;
        const selfId = pool.ids[slot];
        const self = selfId === null ? undefined : this.objects.get(selfId);
        const targetId = self?.outputId ?? null;
        const target = targetId === null ? undefined : this.objects.get(targetId);
        if (
            target === undefined ||
            target.entry.pool.state[target.slot] === SLOT_FREE
        ) {
            linkMesh.setMatrixAt(slot, pool.hidden);
            return;
        }
        const targetPool = target.entry.pool;
        this.projector.writeMatrix(
            _m2,
            targetPool.curX[target.slot],
            targetPool.curY[target.slot],
            targetPool.curZ[target.slot],
            0,
            targetPool.areaIndex[target.slot]
        );
        _p1.setFromMatrixPosition(_m1);
        _p2.setFromMatrixPosition(_m2);
        const len = _p1.distanceTo(_p2);
        if (len < 1e-3 || len > 8) {
            linkMesh.setMatrixAt(slot, pool.hidden);
            return;
        }
        _m2.identity().lookAt(_p1, _p2, _p1);
        _m2.setPosition(_p1);
        _m2.multiply(_m1.makeScale(1, 1, len));
        _m2.multiply(_m1.makeTranslation(0, 0.03, -0.5));
        linkMesh.setMatrixAt(slot, _m2);
    }

    private writeInserter(pool: SlotPool, slot: number): void {
        const areaIndex = pool.areaIndex[slot];
        this.projector.writeMatrix(_m1, pool.curX[slot], pool.curY[slot], pool.curZ[slot], 0, areaIndex);
        this.projector.writeMatrix(_m2, pool.curX2[slot], pool.curY2[slot], pool.curZ2[slot], 0, areaIndex);
        _p1.setFromMatrixPosition(_m1);
        _p2.setFromMatrixPosition(_m2);
        // 沿法线抬起（与 `buildBuildings` 的 inserterTrans 同语义）
        _p3.copy(_p1).normalize();
        _p1.addScaledVector(_p3, INSERTER_HEIGHT);
        _p3.copy(_p2).normalize();
        _p2.addScaledVector(_p3, INSERTER_HEIGHT);
        const len = Math.max(_p1.distanceTo(_p2), 1e-3);
        _m2.identity().lookAt(_p1, _p2, _p1);
        _m2.setPosition(_p1);
        _m2.multiply(_m1.makeScale(1, 1, len));
        _m2.multiply(_m1.makeTranslation(0, 0, -0.5));
        pool.meshes[0].setMatrixAt(slot, _m2);
    }

    /** 释放全部 GPU 资源并从场景移除 */
    discard(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const entry of this.entries.values()) entry.pool.dispose();
        this.entries.clear();
        this.objects.clear();
        this.group.clear();
        if (this.group.parent !== null) this.group.parent.remove(this.group);
    }
}

/** 依赖 `pool` 的旧状态重建自由链表（新池里未被占用的槽都可以复用） */
function rebuildFreeList(next: SlotPool, kept: number, old: SlotPool): void {
    next.free.length = 0;
    for (let i = next.capacity - 1; i >= 0; i--) {
        if (i < kept && old.state[i] !== SLOT_FREE) continue;
        next.free.push(i);
    }
}

function perfNow(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function nowMs(): number {
    return perfNow();
}

const BUILDING_ID_PREFIX = "building-";

/**
 * 解析后端 `objectId = "building-N"` 中的 N（建筑 ID）。
 *
 * 约定：N 是 `BlueprintBuilding.index`（建筑 ID），不是数组下标。
 * 若后端改用其他命名，只需替换本函数；`compareSkeleton` 会因 `missing` 自动走强制刷新，不会静默错配。
 */
function parseBuildingIndex(id: string): number | null {
    if (!id.startsWith(BUILDING_ID_PREFIX)) return null;
    const n = Number(id.slice(BUILDING_ID_PREFIX.length));
    return Number.isInteger(n) && n >= 0 ? n : null;
}
