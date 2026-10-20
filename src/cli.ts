/// <reference types="node" />

import { fromStr } from "./blueprint/parser";
import { writeFileSync } from "fs";
import { resolve } from "path";

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

async function main() {
    const input = (await readStdin()).trim();
    const result = JSON.stringify(fromStr(input));

    // 如果命令行传了额外参数，将结果保存到该文件
    const outFile = process.argv[2];
    if (outFile) {
        writeFileSync(resolve(outFile), result, "utf8");
        process.stderr.write(`Saved to ${outFile}\n`);
    } else {
        process.stdout.write(result);
    }
}

main();
