/// <reference types="node" />

import { fromStr } from "./blueprint/parser";
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import * as path from "path";

function readStdin() {
    return new Promise<string>((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin
            .on("readable", () => {
                let chunk;
                while ((chunk = process.stdin.read())) {
                    data += chunk;
                }
            })
            .on("end", () => {
                resolve(data);
            });
    });
}

function parseArgs(args: string[]) {
    let inputPath: string | undefined;
    let outFile: string | undefined;
    let outFlag = false;
    let recursive = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--out" || arg === "-o") {
            outFlag = true;
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                outFile = next;
                i++;
            }
        } else if (arg === "--recursive" || arg === "-r") {
            recursive = true;
        } else if (!arg.startsWith("-")) {
            inputPath = arg;
        }
    }
    return { inputPath, outFile, outFlag, recursive };
}

// 递归收集目录下所有文件（可排除 .json 输出文件避免重复处理）
function collectFiles(dir: string, recursive: boolean): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            if (recursive) {
                results.push(...collectFiles(full, recursive));
            }
        } else if (stat.isFile()) {
            // 跳过已生成的 .json 文件，避免把输出当输入
            if (path.extname(full).toLowerCase() === ".json") continue;
            results.push(full);
        }
    }
    return results;
}

function deriveOutputPath(inputFile: string): string {
    const abs = path.resolve(inputFile);
    const dir = path.dirname(abs);
    const base = path.basename(abs, path.extname(abs));
    return path.join(dir, base + ".json");
}

function processOne(inputFile: string): { ok: boolean; target?: string; error?: string } {
    try {
        const raw = readFileSync(path.resolve(inputFile), "utf8");
        const input = raw.replace(/^\uFEFF/, "").trim();
        const result = JSON.stringify(fromStr(input));
        const target = deriveOutputPath(inputFile);
        writeFileSync(target, result, "utf8");
        return { ok: true, target };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

async function main() {
    const { inputPath, outFile, outFlag, recursive } = parseArgs(process.argv.slice(2));

    // 情形一：输入路径是目录 —— 批量处理目录下所有文件，输出保存到同目录
    if (inputPath) {
        const abs = path.resolve(inputPath);
        const stat = statSync(abs);
        if (stat.isDirectory()) {
            const files = collectFiles(abs, recursive);
            if (files.length === 0) {
                process.stderr.write(`目录 ${abs} 下没有可处理的文件。\n`);
                process.exit(0);
            }
            let okCount = 0;
            let failCount = 0;
            for (const file of files) {
                const res = processOne(file);
                if (res.ok) {
                    okCount++;
                    process.stderr.write(`Saved to ${res.target}\n`);
                } else {
                    failCount++;
                    process.stderr.write(`处理失败：${file} -> ${res.error}\n`);
                }
            }
            process.stderr.write(
                `\n完成：成功 ${okCount} 个，失败 ${failCount} 个，共 ${files.length} 个。\n`
            );
            if (failCount > 0) process.exit(1);
            return;
        }

        // 情形二：输入是单个文件（兼容原有行为）
        const raw = readFileSync(abs, "utf8");
        const input = raw.replace(/^\uFEFF/, "").trim();
        const result = JSON.stringify(fromStr(input));

        if (outFlag) {
            let target: string;
            if (outFile) {
                target = path.resolve(outFile);
            } else {
                target = deriveOutputPath(inputPath);
            }
            writeFileSync(target, result, "utf8");
            process.stderr.write(`Saved to ${target}\n`);
        } else {
            process.stdout.write(result);
        }
        return;
    }

    // 情形三：无输入路径，从 stdin 读取
    const raw = await readStdin();
    const input = raw.replace(/^\uFEFF/, "").trim();
    const result = JSON.stringify(fromStr(input));

    if (outFlag) {
        if (!outFile) {
            process.stderr.write(
                "错误：从 stdin 输入时，-o/--out 必须显式指定输出文件名。\n"
            );
            process.exit(1);
        }
        const target = path.resolve(outFile);
        writeFileSync(target, result, "utf8");
        process.stderr.write(`Saved to ${target}\n`);
    } else {
        process.stdout.write(result);
    }
}

main();