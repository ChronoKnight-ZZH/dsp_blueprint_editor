/// <reference types="node" />

import { fromStr } from "./blueprint/parser";
import { readFileSync, writeFileSync } from "fs";
import { resolve as resolvePath } from "path";

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
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--out" || arg === "-o") {
            outFile = args[++i];
        } else if (!arg.startsWith("-")) {
            inputFile = arg;
        }
    }
    return { inputFile, outFile };
}

async function main() {
    const { inputFile, outFile } = parseArgs(process.argv.slice(2));

    // 有输入文件参数则读文件，否则从 stdin 读取
    const raw = inputFile
        ? readFileSync(resolvePath(inputFile), "utf8")
        : await readStdin();
    const input = raw.replace(/^\uFEFF/, "").trim();

    const result = JSON.stringify(fromStr(input));

    // 指定了 --out 则写入文件，否则输出到 stdout
    if (outFile) {
        writeFileSync(resolvePath(outFile), result, "utf8");
        process.stderr.write(`Saved to ${outFile}\n`);
    } else {
        process.stdout.write(result);
    }
}

main();
