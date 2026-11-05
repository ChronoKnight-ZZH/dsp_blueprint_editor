/**
 * 用 CDP 驱动无头 Edge，真正等到页面里的模型加载 + 渲染完成，再截图 + 取日志。
 * 只用于本地自检，不进源码。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const URL = process.argv[2] ?? "http://127.0.0.1:5055/dsp_blueprint_editor/__ktx2-test.html";
const SHOT = process.argv[3] ?? resolve("temp/cdp-shot.png");
const ROOT = resolve(import.meta.dirname, "..");

const child = spawn(
    EDGE,
    [
        "--headless=new",
        `--remote-debugging-port=${PORT}`,
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-gpu-sandbox",
        "--hide-scrollbars",
        "--window-size=1400,860",
        `--user-data-dir=${resolve(ROOT, "temp/edge-cdp")}`,
        "--no-first-run",
        "about:blank",
    ],
    { stdio: "ignore", detached: false }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const list = await res.json();
            const page = list.find((t) => t.type === "page");
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch {
            /* 还没起来 */
        }
        await sleep(500);
    }
    throw new Error("CDP 端点没起来");
}

const wsUrl = await getTarget();
const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
});

let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
    }
});

function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((ok, reject) => {
        pending.set(msgId, { resolve: ok, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}

async function evaluate(expression) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });

const started = Date.now();
let done = false;
while (Date.now() - started < 180000) {
    try {
        done = await evaluate("window.__done === true");
    } catch {
        done = false;
    }
    if (done) break;
    await sleep(1000);
}

const logText = await evaluate(
    "(document.getElementById('log')?.textContent ?? '') + (document.getElementById('err')?.textContent ? '\\n--- ERR ---' + document.getElementById('err').textContent : '')"
);
const title = await evaluate("document.title");

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(SHOT, Buffer.from(shot.data, "base64"));

console.log("title:", title);
console.log("elapsed:", ((Date.now() - started) / 1000).toFixed(1), "s", "done:", done);
console.log("---- page log ----");
console.log(logText);
console.log("---- screenshot:", SHOT, "----");

ws.close();
child.kill("SIGKILL");
process.exit(done ? 0 : 2);
