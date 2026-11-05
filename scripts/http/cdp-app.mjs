/**
 * 真·端到端：用 CDP 打开构建产物（dist，挂在 /dsp_blueprint_editor/），
 * 通过页面里的 #blueprint-file 输入框塞入示例蓝图，等模型加载完，收集控制台/网络错误并截图。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9334;
const ROOT = resolve(import.meta.dirname, "..");
const APP_URL = "http://127.0.0.1:5055/dsp_blueprint_editor/";
const BP_FILE = resolve(ROOT, "dist/demo/sample_throughput.txt");
const SHOT = resolve(ROOT, "temp/app-shot.png");

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
        "--window-size=1600,1000",
        `--user-data-dir=${resolve(ROOT, "temp/edge-app")}`,
        "--no-first-run",
        "--disable-features=Translate",
        "about:blank",
    ],
    { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find((t) => t.type === "page");
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch {}
        await sleep(500);
    }
    throw new Error("CDP 没起来");
}

const ws = new WebSocket(await target(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, no) => { ws.on("open", ok); ws.on("error", no); });

let seq = 0;
const pending = new Map();
const consoleLines = [];
const netFails = [];

ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params.args ?? [])
            .map((a) => (a.value !== undefined ? a.value : a.description ?? a.type))
            .join(" ");
        consoleLines.push(`[${msg.params.type}] ${text}`.slice(0, 300));
    }
    if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        consoleLines.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`.slice(0, 400));
    }
    if (msg.method === "Log.entryAdded") {
        const e = msg.params.entry;
        consoleLines.push(`[log:${e.level}] ${e.text} ${e.url ?? ""}`.slice(0, 300));
    }
    if (msg.method === "Network.loadingFailed") {
        netFails.push(`${msg.params.type} ${msg.params.errorText} ${msg.params.blockedReason ?? ""}`.trim());
    }
});

function send(method, params = {}) {
    const id = ++seq;
    return new Promise((ok, no) => {
        pending.set(id, { resolve: ok, reject: no });
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(expression) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return `<<exception>> ${r.exceptionDetails.text}`;
    return r.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("DOM.enable");
await send("Page.navigate", { url: APP_URL });
await sleep(6000);

// 1) 页面是否有 canvas（渲染器起来了）
console.log("canvas:", await evaluate("document.querySelectorAll('canvas').length"));
console.log("app mounted:", await evaluate("!!document.getElementById('app')?.children.length"));

// 2) 通过 DOM.setFileInputFiles 塞示例蓝图
const doc = await send("DOM.getDocument", { depth: -1 });
const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#blueprint-file" });
console.log("file input nodeId:", q.nodeId);
if (q.nodeId) {
    await send("DOM.setFileInputFiles", { files: [BP_FILE], nodeId: q.nodeId });
    console.log("blueprint injected:", BP_FILE);
}

// 3) 等模型加载（并发 3，蓝图里建筑数未知，给足时间）
for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const glbRequests = await evaluate(
        "performance.getEntriesByType('resource').filter(e=>/\\.glb$/.test(e.name)).length"
    );
    console.log(`t+${(i + 1) * 5}s glb requests:`, glbRequests);
    if (i >= 5 && glbRequests === 0) break;
}

// 4) 统计
const stats = await evaluate(`(() => {
  const res = performance.getEntriesByType('resource');
  const glbs = res.filter(e => /\\.glb$/.test(e.name));
  const basis = res.filter(e => /basis_transcoder/.test(e.name));
  return {
    glbCount: glbs.length,
    glbBytes: glbs.reduce((s,e)=>s+(e.transferSize||e.encodedBodySize||0),0),
    basisCount: basis.length,
    basisBytes: basis.reduce((s,e)=>s+(e.transferSize||e.encodedBodySize||0),0),
    totalRequests: res.length,
    domText: (document.body.innerText||'').slice(0, 200)
  };
})()`);
console.log("\n--- resource stats ---");
console.log(JSON.stringify(stats, null, 1));

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(SHOT, Buffer.from(shot.data, "base64"));

const bad = consoleLines.filter((l) => /\[(error|exception)\]|加载失败|失败|ERROR|Uncaught/.test(l));
console.log("\n--- console (fails first) ---");
for (const l of bad.slice(0, 15)) console.log(l);
console.log(`\nconsole lines: ${consoleLines.length}（其中疑似失败 ${bad.length}）`);
console.log(`network failures: ${netFails.length}`);
for (const f of netFails.slice(0, 10)) console.log("  " + f);
console.log("\nscreenshot:", SHOT);

ws.close();
child.kill("SIGKILL");
