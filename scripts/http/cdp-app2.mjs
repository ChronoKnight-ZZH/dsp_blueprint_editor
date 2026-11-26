/**
 * 诊断版：跑构建产物，抓全部 console + 全部资源 + 未处理拒绝原因。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9335;
const ROOT = resolve(import.meta.dirname, "..");
const APP_URL = "http://127.0.0.1:5055/dsp_blueprint_editor/";
const BP_FILE = resolve(ROOT, "dist/demo/sample_throughput.txt");
const SHOT = resolve(ROOT, "temp/app-shot2.png");

const child = spawn(EDGE, [
    "--headless=new", `--remote-debugging-port=${PORT}`,
    "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--disable-gpu-sandbox", "--hide-scrollbars", "--window-size=1600,1000",
    `--user-data-dir=${resolve(ROOT, "temp/edge-app-" + Date.now())}`,
    "--no-first-run", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const p = list.find((t) => t.type === "page");
            if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
        } catch {}
        await sleep(500);
    }
    throw new Error("no cdp");
}

const ws = new WebSocket(await target(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); });

let seq = 0;
const pending = new Map();
const consoleAll = [];
const net = [];

ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        return;
    }
    if (m.method === "Runtime.consoleAPICalled") {
        const t = (m.params.args ?? [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
            .join(" ");
        consoleAll.push(`[${m.params.type}] ${t}`.slice(0, 600));
    }
    if (m.method === "Runtime.exceptionThrown") {
        consoleAll.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`.slice(0, 600));
    }
    if (m.method === "Network.responseReceived") {
        net.push({ url: m.params.response.url, status: m.params.response.status, type: m.params.type });
    }
});

function send(method, params = {}) {
    const id = ++seq;
    return new Promise((ok, no) => {
        pending.set(id, { resolve: ok, reject: no });
        ws.send(JSON.stringify({ id, method, params }));
    });
}
const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? `<<exc>> ${r.exceptionDetails.text}` : r.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("DOM.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__errs = []; addEventListener('unhandledrejection', e => window.__errs.push('REJECT: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
             (function(){const ce=console.error; console.error=function(...a){window.__errs.push('console.error: '+a.map(x=>x&&x.stack?x.stack:String(x)).join(' ')); return ce.apply(console,a)};})();`,
});
await send("Page.navigate", { url: APP_URL });
await sleep(6000);

const doc = await send("DOM.getDocument", { depth: -1 });
const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#blueprint-file" });
if (q.nodeId) await send("DOM.setFileInputFiles", { files: [BP_FILE], nodeId: q.nodeId });
await sleep(20000);

console.log("=== __errs ===");
console.log(JSON.stringify(await evaluate("window.__errs.slice(0,6)"), null, 1));
console.log("\n=== console (all) ===");
for (const l of consoleAll) console.log(l);
console.log("\n=== network non-200 or ktx-related ===");
for (const r of net) {
    if (r.status >= 400 || /basis|\.glb/.test(r.url)) console.log(`${r.status} ${r.type} ${r.url}`);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
console.log("\nshot:", SHOT);
ws.close();
child.kill("SIGKILL");
