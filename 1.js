const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'dist');
const PORT = 3000;
const PREFIX = '/dsp_blueprint_editor';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);

  // 去掉 publicPath 前缀
  if (url.startsWith(PREFIX)) url = url.slice(PREFIX.length);
  if (url === '' || url === '/') url = '/index.html';

  const filePath = path.join(ROOT, url);

  // 防目录穿越
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(ROOT, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found: ' + url);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ 打开: http://localhost:${PORT}${PREFIX}/`);
});