/// <reference types="node" />

import { fromStr } from "./blueprint/parser";
import { readFileSync, writeFileSync } from "fs";
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
    let inputFile: string | undefined;
    let outFile: string | undefined;
    let outFlag = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--out" || arg === "-o") {
            outFlag = true;
            // 看下一个参数是不是文件名（不是以 - 开头，且没越界）
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                outFile = next;
                i++;
            }
        } else if (!arg.startsWith("-")) {
            inputFile = arg;
        }
    }
    return { inputFile, outFile, outFlag };
}

async function main() {
    const { inputFile, outFile, outFlag } = parseArgs(process.argv.slice(2));

    // 有输入文件参数则读文件，否则从 stdin 读取
    const raw = inputFile
        ? readFileSync(path.resolve(inputFile), "utf8")
        : await readStdin();
    const input = raw.replace(/^\uFEFF/, "").trim();

    const result = JSON.stringify(fromStr(input));

    // 指定了 --out/-o 则写入文件，否则输出到 stdout
    if (outFlag) {
        let target: string;
        if (outFile) {
            // 用户显式给了文件名
            target = path.resolve(outFile);
        } else if (inputFile) {
            // -o 无值，推导输出路径：同目录、同名、.json 后缀
            const abs = path.resolve(inputFile);
            const dir = path.dirname(abs);
            const base = path.basename(abs, path.extname(abs));
            target = path.join(dir, base + ".json");
        } else {
            // stdin 输入但 -o 无值，无法推导文件名
            process.stderr.write(
                "错误：从 stdin 输入时，-o/--out 必须显式指定输出文件名。\n"
            );
            process.exit(1);
        }
        writeFileSync(target, result, "utf8");
        process.stderr.write(`Saved to ${target}\n`);
    } else {
        process.stdout.write(result);
    }
}

main();
