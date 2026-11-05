/** 通用 E2E：塞入指定蓝图，统计 glb 请求/贴图错误，截图。 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ROOT = resolve(import.meta.dirname, "..");
const PORT = 9400 + Math.floor(Math.random() * 90);
const BP = resolve(ROOT, process.argv[2] ?? "dist/demo/sample_throughput.txt");
const SHOT = resolve(ROOT, process.argv[3] ?? "temp/e2e-shot.png");
const APP = "http://127.0.0.1:5055/dsp_blueprint_editor/";

const child = spawn(EDGE, [
    "--headless=new", `--remote-debugging-port=${PORT}`,
    "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--disable-gpu-sandbox", "--hide-scrollbars", "--window-size=1600,1000",
    `--user-data-dir=${resolve(ROOT, "temp/edge-" + Date.now())}`,
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
        await sleep(400);
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
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        return;
    }
    if (m.method === "Runtime.consoleAPICalled") {
        consoleAll.push(`[${m.params.type}] ` + (m.params.args ?? [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
        consoleAll.push("[exception] " + (m.params.exceptionDetails.exception?.description ?? "").slice(0, 200));
    }
    if (m.method === "Network.responseReceived") net.push(`${m.params.response.status} ${m.params.response.url}`);
});
const send = (method, params = {}) => {
    const id = ++seq;
    return new Promise((ok, no) => { pending.set(id, { resolve: ok, reject: no }); ws.send(JSON.stringify({ id, method, params })); });
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("DOM.enable");
await send("Page.navigate", { url: APP });
await sleep(6000);
const doc = await send("DOM.getDocument", { depth: -1 });
const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#blueprint-file" });
if (q.nodeId) await send("DOM.setFileInputFiles", { files: [BP], nodeId: q.nodeId });
await sleep(22000);

const glbs = net.filter((l) => /\.glb$/.test(l));
const basis = net.filter((l) => /basis_transcoder/.test(l));
const texErrors = consoleAll.filter((l) => /Couldn't load texture/.test(l)).length;
const glbWarn = consoleAll.filter((l) => /\[glb\]/.test(l)).length;
const ktxWarn = consoleAll.filter((l) => /\[ktx2\]/.test(l)).length;

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(SHOT, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({
    blueprint: BP.split(/[\\/]/).pop(),
    glbRequests: glbs.length,
    glbStatus: [...new Set(glbs.map((l) => l.split(" ")[0]))],
    basis, texErrors, glbWarn, ktxWarn,
    consoleTotal: consoleAll.length,
    shot: SHOT,
}, null, 1));
if (glbWarn || ktxWarn || texErrors) {
    console.log("--- problematic console ---");
    for (const l of consoleAll.filter((l) => /\[glb\]|\[ktx2\]|Couldn't load|exception/.test(l)).slice(0, 8)) console.log(l.slice(0, 200));
}
ws.close();
child.kill("SIGKILL");
