#!/usr/bin/env node
/**
 * 阶段 1/3：把外置通道贴图（-n / -e / -s）合进 GLB。
 *
 * 产物仍是 **PNG 内嵌**的 GLB（`temp/ktx2/01-embedded/*.glb`），交给阶段 2 做 KTX2 编码。
 * 这样拆开的原因见 README：
 *   1. `gltf-transform etc1s/uastc` 只能处理「已经挂在正确槽位上」的贴图，它不认识
 *      `<建筑>/<文件>.png` 这套外置约定；
 *   2. 色彩空间是**按槽位推导**的，必须先挂槽位再编码，否则得到发灰的贴图；
 *   3. `-s` 是 Unity spec-gloss，要在编码前重打包成 ORM（G=粗糙度、B=金属度）。
 *
 * 关键设计：
 * - **只读 `src/`**：原始 GLB 与 PNG 一律不动，产物全在 `temp/`，随时可丢。
 * - **清单即真相**：材质 → 贴图的对应关系来自 `tests/unit/scripts/texture-mapping.json`
 *   （由 `gen-texture-manifest.mjs` 用 MD5 锚定生成，是唯一可靠来源）；
 *   文件名后缀识别（-a/-e/-n/-s）作为**旁证**，与清单冲突时打警告，防止图贴错槽。
 * - **同图去重**：同一模型内多个材质引用同一张 PNG 时只生成一个 Texture 节点。
 * - **emissiveFactor 归零**：见 `attachEmissive` 的注释（配合运行期开关语义）。
 *
 * 用法：
 *   node scripts/glb-ktx2/01-embed-textures.mjs
 *   node scripts/glb-ktx2/01-embed-textures.mjs --only accumulator     # 单个模型试跑
 *   node scripts/glb-ktx2/01-embed-textures.mjs --concurrency 2        # 限制并发
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";

// ---------------------------------------------------------------- 路径

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
/** 模型与贴图所在目录（清单里的相对路径都以它为根） */
const MODELS_DIR = join(ROOT, "src", "assets", "icons", "models");
const MAPPING_FILE = join(ROOT, "tests", "unit", "scripts", "texture-mapping.json");
const OUT_DIR = join(ROOT, "temp", "ktx2", "01-embedded");

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);

function argValue(name, fallback) {
    const i = argv.findIndex(
        (a) => a === `--${name}` || a.startsWith(`--${name}=`)
    );
    if (i < 0) return fallback;
    const current = argv[i];
    if (current.includes("=")) return current.slice(current.indexOf("=") + 1);
    return argv[i + 1] ?? fallback;
}

/** 只处理模型名匹配此正则的模型（调试用，全量时留空） */
const ONLY = argValue("only", null);
const CONCURRENCY = Math.max(1, Number(argValue("concurrency", 4)) || 4);

// ---------------------------------------------------------------- 文件名后缀识别

/** 后缀字母 → 贴图语义（`-a` 是锚点/底色，GLB 里本来就有，这里只用于校验） */
const KIND_BY_LETTER = {
    a: "albedo",
    e: "emissive",
    n: "normal",
    s: "spec",
};

/**
 * 从文件名猜贴图语义：`accumulator-n.png` → normal，`tesla-tower-1n.png` → normal，
 * `smelter-n-lod0.png` → normal。
 *
 * 规则：从右往左找**长度 ≤3、以 a/e/n/s 结尾**的 token（`n` / `1n` / `h` 之类），
 * 长度限制是为了避免把 `glass`（结尾是 s）误判成 spec。
 * 猜不出来就返回 null —— 本函数只做校验，真正的挂载依据是清单。
 */
function guessKind(fileName) {
    const base = basename(fileName).replace(/\.(png|jpe?g)$/i, "").toLowerCase();
    const tokens = base.split(/[-_\s]+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.length === 0 || token.length > 3) continue;
        const hit = token.match(/([aens])$/);
        if (hit) return KIND_BY_LETTER[hit[1]];
    }
    return null;
}

// ---------------------------------------------------------------- 图像处理

/**
 * Unity spec-gloss → three 认的 ORM，逐像素等价于
 * `src/models/textureMaps.ts` 的 `packOrm()`：
 *
 *   R = 255（占位，three 不用）
 *   G = 粗糙度 = 1 − A（A 是光滑度）
 *   B = 金属度 = 高光色亮度（0.299R + 0.587G + 0.114B）
 *
 * 必须在编码前做：KTX2 压缩后的像素没法再做逐像素运算（会解压成 RGBA 再压回去，
 * 既慢又掉质量）。
 */
async function packOrm(specPath) {
    const { data, info } = await sharp(specPath)
        .ensureAlpha() // 没有 alpha 通道的 spec 图补成不透明
        .raw()
        .toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels; // ensureAlpha 后恒为 4

    const packed = Buffer.alloc(width * height * 4);
    for (let i = 0; i < data.length; i += channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gloss = (channels === 4 ? data[i + 3] : 255) / 255;
        packed[i] = 255;
        packed[i + 1] = Math.round((1 - gloss) * 255);
        packed[i + 2] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        packed[i + 3] = 255;
    }

    return sharp(packed, { raw: { width, height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
}

async function fileSize(path) {
    try {
        return (await stat(path)).size;
    } catch {
        return 0;
    }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ---------------------------------------------------------------- 单模型处理

/** 全量警告收集（跑完统一打印，避免刷屏） */
const warnings = [];

async function embedModel(model, entries) {
    const glbPath = join(MODELS_DIR, `${model}.glb`);
    const outPath = join(OUT_DIR, `${model}.glb`);

    const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
    const doc = await io.read(glbPath);

    const materials = new Map();
    for (const material of doc.getRoot().listMaterials())
        materials.set(material.getName(), material);

    /** 同一模型内按文件路径去重，避免同一张 PNG 生成多个 Texture 节点 */
    const textureByKey = new Map();

    async function pngTexture(relPath, nameOverride) {
        const key = `png:${relPath}`;
        const cached = textureByKey.get(key);
        if (cached !== undefined) return cached;

        const bytes = await readFile(join(MODELS_DIR, relPath));
        const texture = doc
            .createTexture(nameOverride ?? basename(relPath))
            .setImage(new Uint8Array(bytes))
            .setMimeType("image/png");
        textureByKey.set(key, texture);
        return texture;
    }

    async function ormTexture(relPath) {
        const key = `orm:${relPath}`;
        const cached = textureByKey.get(key);
        if (cached !== undefined) return cached;

        const png = await packOrm(join(MODELS_DIR, relPath));
        const texture = doc
            .createTexture(basename(relPath).replace(/\.png$/i, "-orm.png"))
            .setImage(new Uint8Array(png))
            .setMimeType("image/png");
        textureByKey.set(key, texture);
        return texture;
    }

    const attached = { normal: 0, emissive: 0, orm: 0 };
    const unmatchedMaterials = [];

    for (const entry of entries) {
        const material = materials.get(entry.material);
        if (material === undefined) {
            unmatchedMaterials.push(entry.material);
            continue;
        }
        const label = `${model}::${entry.material}`;

        // ---- 法线：切线空间法线图，槽位 normalTexture（UASTC 编码）
        if (entry.normal) {
            checkKind(label, entry.normal, "normal");
            // 默认 normalTextureInfo.scale = 1、texCoord = 0，正是要的值；
            // 注意 gltf-transform 4.x 的 setXxxTexture() 返回的是 Material 本身
            // （不是 TextureInfo），所以不能链式 .setScale()
            material.setNormalTexture(await pngTexture(entry.normal));
            attached.normal++;
        }

        // ---- 自发光：槽位 emissiveTexture（ETC1S 编码）
        if (entry.emissive) {
            checkKind(label, entry.emissive, "emissive");
            material.setEmissiveTexture(await pngTexture(entry.emissive));
            // emissiveFactor 必须是 (0,0,0)：three 里 emissive = factor × emissiveMap，
            // 而运行期开关（materialTextures.ts）开启时会把 factor 改成白色、
            // 关闭时恢复 GLB 原值。若这里烘成 1，关闭自发光后会整块材质白到发光。
            const factor = material.getEmissiveFactor();
            if (factor[0] !== 0 || factor[1] !== 0 || factor[2] !== 0) {
                warnings.push(
                    `${label}: emissiveFactor 原为 [${factor.join(",")}]，已归零（配合运行期开关）`
                );
                material.setEmissiveFactor([0, 0, 0]);
            }
            attached.emissive++;
        }

        // ---- spec-gloss → ORM：槽位 metallicRoughnessTexture（UASTC 编码）
        if (entry.spec) {
            checkKind(label, entry.spec, "spec");
            material.setMetallicRoughnessTexture(await ormTexture(entry.spec));
            // 因子交给运行期（tuning.metalness 当乘数用），这里烘 1 保持「贴图说了算」
            material.setMetallicFactor(1);
            material.setRoughnessFactor(1);
            attached.orm++;
        }
    }

    if (unmatchedMaterials.length > 0) {
        warnings.push(
            `${model}: 清单里的材质在 GLB 中不存在 → ${unmatchedMaterials.join(", ")}`
        );
    }

    const total = attached.normal + attached.emissive + attached.orm;
    // 没有通道贴图的模型（电梯 / 传送带 / 纯特效）也照常输出：
    // 阶段 2 对它只是把已有的底色图转成 KTX2，流程保持不变。
    await io.write(outPath, doc);

    return {
        model,
        attached,
        before: await fileSize(glbPath),
        after: await fileSize(outPath),
        textures: doc.getRoot().listTextures().length,
        skipped: total === 0,
    };
}

/** 文件名后缀与清单语义不一致时只告警：清单（MD5 锚定）才是权威 */
function checkKind(label, relPath, expected) {
    const guessed = guessKind(relPath);
    if (guessed !== null && guessed !== expected) {
        warnings.push(
            `${label}: 文件名 ${basename(relPath)} 看起来是 ${guessed}，清单说是 ${expected}（按清单执行）`
        );
    }
}

// ---------------------------------------------------------------- 主流程

async function main() {
    if (!existsSync(MODELS_DIR)) {
        throw new Error(`找不到模型目录：${MODELS_DIR}`);
    }
    if (!existsSync(MAPPING_FILE)) {
        throw new Error(
            `找不到映射表：${MAPPING_FILE}\n先跑 node tests/unit/scripts/gen-texture-manifest.mjs`
        );
    }

    const mapping = JSON.parse(await readFile(MAPPING_FILE, "utf8"));
    const byModel = new Map();
    for (const entry of mapping.entries ?? []) {
        if (!byModel.has(entry.glb)) byModel.set(entry.glb, []);
        byModel.get(entry.glb).push(entry);
    }

    const filter = ONLY === null ? null : new RegExp(ONLY, "i");
    // 以**磁盘上的 GLB 为准**：清单里没有通道图的模型（电梯、传送带、纯特效等）
    // 也要走一遍，否则它们的底色图还是 PNG —— 那些模型同样吃得到 ETC1S 的收益。
    let models = (await readdir(MODELS_DIR))
        .filter((name) => /\.glb$/i.test(name))
        .map((name) => name.replace(/\.glb$/i, ""))
        .sort();
    if (filter !== null) models = models.filter((m) => filter.test(m));
    if (models.length === 0) throw new Error(`--only ${ONLY} 没有匹配到任何模型`);

    await mkdir(OUT_DIR, { recursive: true });
    console.log(
        `\n[01] 合体：${models.length} 个模型 → ${OUT_DIR}\n` +
            `     并发 ${CONCURRENCY}，清单 ${MAPPING_FILE.replace(ROOT, ".")}\n`
    );

    const results = [];
    const failures = [];
    let cursor = 0;
    let done = 0;

    async function worker() {
        while (cursor < models.length) {
            const model = models[cursor++];
            try {
                const result = await embedModel(model, byModel.get(model) ?? []);
                results.push(result);
                done++;
                const { normal, emissive, orm } = result.attached;
                console.log(
                    `[${String(done).padStart(3)}/${models.length}] ${model.padEnd(34)} ` +
                        `n×${normal} e×${emissive} orm×${orm}  ` +
                        `${mb(result.before)} → ${mb(result.after)}`
                );
            } catch (e) {
                failures.push({ model, message: e?.message ?? String(e) });
                console.error(`[${model}] 失败：${e?.message ?? e}`);
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, models.length) }, () =>
            worker()
        )
    );

    results.sort((a, b) => a.model.localeCompare(b.model));
    const sumBefore = results.reduce((s, r) => s + r.before, 0);
    const sumAfter = results.reduce((s, r) => s + r.after, 0);

    const report = {
        generatedAt: new Date().toISOString(),
        stage: "01-embed-textures",
        models: results.length,
        failed: failures,
        warnings,
        totals: { before: sumBefore, after: sumAfter },
        results,
    };
    await writeFile(
        join(OUT_DIR, "_report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
    );

    console.log(
        `\n[01] 完成 ${results.length} 个，失败 ${failures.length} 个\n` +
            `     GLB 合计 ${mb(sumBefore)} → ${mb(sumAfter)}（含外置贴图后才是最终体积）\n` +
            `     报告：${join(OUT_DIR, "_report.json").replace(ROOT, ".")}\n`
    );

    if (warnings.length > 0) {
        console.log(`[01] 警告 ${warnings.length} 条（前 20 条）：`);
        for (const w of warnings.slice(0, 20)) console.log(`  - ${w}`);
        if (warnings.length > 20) console.log(`  ... 其余见 _report.json`);
        console.log("");
    }
    if (failures.length > 0) {
        console.error(`[01] 有 ${failures.length} 个模型失败，先修完再做阶段 2`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error("[01] 致命错误：", e);
    process.exitCode = 1;
});
