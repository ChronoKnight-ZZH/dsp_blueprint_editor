#!/usr/bin/env node
/**
 * 阶段 2/3：PNG → KTX2（Basis Universal），分两遍编码。
 *
 * 为什么两遍：`gltf-transform etc1s` / `uastc` 都是**整文件**命令，靠 `--slots` 决定
 * 哪些槽位的贴图参与。颜色图和数据图要用的编码器、质量参数完全不同，所以：
 *
 *   第 1 遍 ETC1S：--slots "{baseColorTexture,emissiveTexture}"
 *                 --quality 128 --compression 2
 *   第 2 遍 UASTC：--slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}"
 *                 --level 2 --rdo --rdo-lambda 4 --zstd 18
 *
 * 第 2 遍不会碰到第 1 遍的产物：`toktx` 遇到已经 `image/ktx2` 的贴图直接跳过
 * （`logger.debug('Skipping, already KTX.')`），双保险。
 *
 * ⚠️ 法线图不会吃到 RDO：`toktx.ts` 里 `isNormalMap` 命中就整段跳过
 * `--uastc-rdo`（KTX-Software #600，RDO 会伤法线方向精度）。这是**期望行为**。
 *
 * 子进程输出写日志文件（`temp/ktx2/logs/*.log`）而不是管道：既避免几十 MB 日志
 * 塞满内存，也避免受限环境里 `stdio: 'pipe'` 的 EPERM 问题。
 *
 * 用法：
 *   node scripts/glb-ktx2/02-encode-ktx2.mjs
 *   node scripts/glb-ktx2/02-encode-ktx2.mjs --only accumulator
 *   node scripts/glb-ktx2/02-encode-ktx2.mjs --concurrency 1 --jobs 2
 *   node scripts/glb-ktx2/02-encode-ktx2.mjs --force          # 重编已有产物
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- 路径

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const IN_DIR = join(ROOT, "temp", "ktx2", "01-embedded");
const OUT_DIR = join(ROOT, "temp", "ktx2", "02-ktx2");
const LOG_DIR = join(ROOT, "temp", "ktx2", "logs");
const TMP_DIR = join(ROOT, "temp", "ktx2", "_tmp");

/** 本地安装的 CLI 入口（优先用它，避免每次 npx 的解析开销与网络）
 *  注意文件名是 `cli.js`（package.json 的 bin 指向它），不是 `cli.mjs`。
 *  写成 cli.mjs 会让 existsSync 失败并回退到 npx.cmd，
 *  Windows 上以无 shell 方式 spawn .cmd 会抛 EINVAL。 */
const CLI_LOCAL = join(
    ROOT,
    "node_modules",
    "@gltf-transform",
    "cli",
    "bin",
    "cli.js"
);

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
function hasFlag(name) {
    return argv.includes(`--${name}`);
}

const ONLY = argValue("only", null);
const CONCURRENCY = Math.max(1, Number(argValue("concurrency", 2)) || 2);
/** 单个文件内 ktx 的并发线程数（每个线程会 spawn 一个 ktx 进程） */
const JOBS = Math.max(1, Number(argValue("jobs", 4)) || 4);
const FORCE = hasFlag("force");

// ---------------------------------------------------------------- 编码参数（唯一手调入口）

/** 颜色贴图（baseColor / emissive）：ETC1S */
const ETC1S_ARGS = [
    "--quality", "128", // → ktx create --qlevel 128（默认值，写出来自证）
    "--compression", "2", // → ktx create --clevel 2（默认 1，2 更慢但更细）
    "--mipmaps",
];

/** 数据贴图（normal / metallicRoughness / occlusion）：UASTC */
const UASTC_ARGS = [
    "--level", "2", // → --uastc-quality 2（0~4，2 为默认）
    "--rdo", // → --uastc-rdo（法线图会被 gltf-transform 自动跳过）
    "--rdo-lambda", "4", // → --uastc-rdo-l 4
    "--zstd", "18", // → --zstd 18（双遍超压缩，默认值；0 可关闭）
    "--mipmaps",
];

const COLOR_SLOTS = "{baseColorTexture,emissiveTexture}";
const DATA_SLOTS = "{normalTexture,metallicRoughnessTexture,occlusionTexture}";

// ---------------------------------------------------------------- 子进程

/**
 * 跑一条命令，stdout/stderr 直接落到 `logPath`（文件描述符，不走管道）。
 * @returns {Promise<number>} 退出码
 */
async function run(cmd, args, logPath, shell = false) {
    const handle = await open(logPath, "w");
    try {
        return await new Promise((resolvePromise, reject) => {
            const child = spawn(cmd, args, {
                cwd: ROOT,
                stdio: ["ignore", handle.fd, handle.fd],
                windowsHide: true,
                shell,
            });
            child.on("error", reject);
            child.on("close", (code) => resolvePromise(code ?? -1));
        });
    } finally {
        await handle.close();
    }
}

function cliCommand() {
    if (existsSync(CLI_LOCAL)) {
        return { cmd: process.execPath, prefix: [CLI_LOCAL], shell: false };
    }
    // 兜底：找 PATH 里的 npx（Windows 上是 npx.cmd）
    const isWin = process.platform === "win32";
    return {
        cmd: isWin ? "npx.cmd" : "npx",
        prefix: ["--no-install", "gltf-transform"],
        shell: isWin,
    };
}

async function tail(logPath, lines = 12) {
    try {
        const text = await readFile(logPath, "utf8");
        return text.trimEnd().split(/\r?\n/).slice(-lines).join("\n");
    } catch {
        return "(无日志)";
    }
}

async function fileSize(path) {
    try {
        return (await stat(path)).size;
    } catch {
        return 0;
    }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const pct = (from, to) =>
    from > 0 ? `${((1 - to / from) * 100).toFixed(1)}%` : "-";

// ---------------------------------------------------------------- 预检

async function preflight(cli) {
    // 1) ktx 是否存在且 ≥ 4.4（gltf-transform 4.4+ 硬性要求）
    const log = join(LOG_DIR, "_preflight-ktx.log");
    let code;
    try {
        code = await run("ktx", ["--version"], log);
    } catch (e) {
        code = -1;
        await writeFile(log, String(e), "utf8");
    }
    const text = await readFile(log, "utf8").catch(() => "");
    if (code !== 0 || !/ktx version/i.test(text)) {
        throw new Error(
            `找不到可用的 ktx（KTX-Software ≥ 4.4.0）。\n` +
                `  输出：${text.trim() || "(空)"}\n` +
                `  修法：下载 https://github.com/KhronosGroup/KTX-Software/releases ` +
                `的 Windows x64 包，把 bin\\ 加入 PATH，然后确认 ktx --version 可用。`
        );
    }
    console.log(`[02] ktx: ${text.trim().split(/\r?\n/).pop()}`);

    // 2) gltf-transform CLI 是否可用
    const cliLog = join(LOG_DIR, "_preflight-cli.log");
    const cliCode = await run(
        cli.cmd,
        [...cli.prefix, "--version"],
        cliLog,
        cli.shell
    );
    const cliText = (await readFile(cliLog, "utf8").catch(() => "")).trim();
    if (cliCode !== 0) {
        throw new Error(
            `gltf-transform CLI 不可用（${cli.cmd}）。\n${cliText}\n` +
                `  修法：npm i -D @gltf-transform/cli@^4.5.0`
        );
    }
    console.log(`[02] gltf-transform: ${cliText.split(/\r?\n/).pop()}`);
}

// ---------------------------------------------------------------- 单模型

async function encodeModel(cli, model) {
    const input = join(IN_DIR, `${model}.glb`);
    const mid = join(TMP_DIR, `${model}.etc1s.glb`);
    const output = join(OUT_DIR, `${model}.glb`);
    const logPath = join(LOG_DIR, `${model}.log`);
    const before = await fileSize(input);

    if (!FORCE && (await fileSize(output)) > 0) {
        return { model, before, after: await fileSize(output), cached: true };
    }

    // 第 1 遍：颜色 → ETC1S
    const code1 = await run(
        cli.cmd,
        [
            ...cli.prefix,
            "etc1s",
            input,
            mid,
            "--slots",
            COLOR_SLOTS,
            ...ETC1S_ARGS,
            "--jobs",
            String(JOBS),
        ],
        logPath,
        cli.shell
    );
    if (code1 !== 0) {
        throw new Error(`etc1s 失败（exit ${code1}）\n${await tail(logPath)}`);
    }
    const midSize = await fileSize(mid);

    // 第 2 遍：数据 → UASTC（append 到同一份日志）
    const logHandle = await open(logPath, "a");
    const code2 = await new Promise((resolvePromise, reject) => {
        const child = spawn(
            cli.cmd,
            [
                ...cli.prefix,
                "uastc",
                mid,
                output,
                "--slots",
                DATA_SLOTS,
                ...UASTC_ARGS,
                "--jobs",
                String(JOBS),
            ],
            {
                cwd: ROOT,
                stdio: ["ignore", logHandle.fd, logHandle.fd],
                windowsHide: true,
                shell: cli.shell,
            }
        );
        child.on("error", reject);
        child.on("close", (code) => resolvePromise(code ?? -1));
    });
    await logHandle.close();
    await rm(mid, { force: true });

    if (code2 !== 0) {
        throw new Error(`uastc 失败（exit ${code2}）\n${await tail(logPath)}`);
    }

    const after = await fileSize(output);
    return { model, before, mid: midSize, after, cached: false };
}

// ---------------------------------------------------------------- 主流程

async function main() {
    if (!existsSync(IN_DIR)) {
        throw new Error(
            `找不到阶段 1 的产物：${IN_DIR}\n先跑 node scripts/glb-ktx2/01-embed-textures.mjs`
        );
    }
    for (const dir of [OUT_DIR, LOG_DIR, TMP_DIR]) {
        await mkdir(dir, { recursive: true });
    }

    const cli = cliCommand();
    await preflight(cli);

    const filter = ONLY === null ? null : new RegExp(ONLY, "i");
    let models = (await readdir(IN_DIR))
        .filter((f) => /\.glb$/i.test(f))
        .map((f) => f.replace(/\.glb$/i, ""))
        .sort();
    if (filter !== null) models = models.filter((m) => filter.test(m));
    if (models.length === 0) throw new Error("没有待处理的 GLB");

    console.log(
        `\n[02] 编码：${models.length} 个 GLB\n` +
            `     颜色 slots ${COLOR_SLOTS} → ETC1S ${ETC1S_ARGS.join(" ")}\n` +
            `     数据 slots ${DATA_SLOTS} → UASTC ${UASTC_ARGS.join(" ")}\n` +
            `     并发 ${CONCURRENCY} × ktx jobs ${JOBS}\n`
    );

    const started = Date.now();
    const results = [];
    const failures = [];
    let cursor = 0;
    let done = 0;

    async function worker() {
        while (cursor < models.length) {
            const model = models[cursor++];
            try {
                const result = await encodeModel(cli, model);
                results.push(result);
                done++;
                const tag = result.cached ? "（跳过：已有产物）" : "";
                console.log(
                    `[${String(done).padStart(3)}/${models.length}] ${model.padEnd(34)} ` +
                        `${mb(result.before)} → ${mb(result.after)}  ` +
                        `省 ${pct(result.before, result.after)}${tag}`
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
        stage: "02-encode-ktx2",
        params: { etc1s: ETC1S_ARGS, uastc: UASTC_ARGS, colorSlots: COLOR_SLOTS, dataSlots: DATA_SLOTS },
        elapsedMs: Date.now() - started,
        models: results.length,
        failed: failures,
        totals: { before: sumBefore, after: sumAfter, ratio: sumBefore > 0 ? sumAfter / sumBefore : 0 },
        results,
    };
    await writeFile(
        join(OUT_DIR, "_report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
    );

    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(
        `\n[02] 完成 ${results.length} 个，失败 ${failures.length} 个，耗时 ${minutes} 分钟\n` +
            `     GLB 合计 ${mb(sumBefore)} → ${mb(sumAfter)}（省 ${pct(sumBefore, sumAfter)}）\n` +
            `     报告：${join(OUT_DIR, "_report.json").replace(ROOT, ".")}\n`
    );
    if (failures.length > 0) {
        console.error(`[02] 有 ${failures.length} 个失败，日志在 ${LOG_DIR.replace(ROOT, ".")}`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error("[02] 致命错误：", e?.message ?? e);
    process.exitCode = 1;
});
