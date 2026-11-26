/** 极简静态服务器：把 dist 挂在 /dsp_blueprint_editor/ 下，模拟 GitHub Pages。 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.argv[2] ?? "dist";
const PREFIX = "/dsp_blueprint_editor/";
const PORT = Number(process.argv[3] ?? 5055);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".glb": "application/octet-stream",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
    try {
        let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (!path.startsWith(PREFIX)) {
            if (path === "/") { res.writeHead(302, { Location: PREFIX }); return res.end(); }
            res.writeHead(404).end("outside prefix");
            return;
        }
        path = path.slice(PREFIX.length) || "index.html";
        const file = join(ROOT, normalize(path).replace(/^([.][.][/\\])+/, ""));
        const info = await stat(file);
        if (!info.isFile()) { res.writeHead(404).end("not a file"); return; }
        const body = await readFile(file);
        res.writeHead(200, {
            "content-type": MIME[extname(file)] ?? "application/octet-stream",
            "content-length": body.length,
            "cache-control": "no-store",
        });
        res.end(body);
    } catch {
        res.writeHead(404).end("not found");
    }
}).listen(PORT, "127.0.0.1", () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${PREFIX}`));
