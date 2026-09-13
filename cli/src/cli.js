"use strict";
/// <reference types="node" />
Object.defineProperty(exports, "__esModule", { value: true });
const parser_1 = require("./blueprint/parser");
function readStdin() {
    return new Promise(resolve => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read())) {
                data += chunk;
            }
        }).on('end', () => {
            resolve(data);
        });
    });
}
async function main() {
    const input = await readStdin();
    process.stdout.write(JSON.stringify((0, parser_1.fromStr)(input)));
}
main();
//# sourceMappingURL=cli.js.map