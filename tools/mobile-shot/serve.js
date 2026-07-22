"use strict";
/* Serve the working-tree static/ dir, but proxy /api/* (and anything not on disk) to a
   running gamedex — so a headless browser renders YOUR uncommitted CSS/JS against the
   live spreadsheet data, no deploy required.

   Point it at the app with GAMEDEX_API (host:port of a `kubectl port-forward svc/gamedex`,
   or any running instance). Listens on PORT (default 18090). shot.sh wires both up. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.GAMEDEX_STATIC || path.resolve(__dirname, "../../static");
const [POD_HOST, POD_PORT] = (process.env.GAMEDEX_API || "localhost:18080").split(":");
const PORT = Number(process.env.PORT || 18090);

const CT = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const rel = url === "/" ? "index.html" : url.replace(/^\//, "");
  const local = path.join(ROOT, rel);
  // A real file under static/ wins; the /api guard keeps a stray file from shadowing the API.
  if (!url.startsWith("/api") && local.startsWith(ROOT) && fs.existsSync(local) && fs.statSync(local).isFile()) {
    res.writeHead(200, { "content-type": CT[path.extname(local)] || "application/octet-stream" });
    fs.createReadStream(local).pipe(res);
    return;
  }
  const p = http.request(
    { host: POD_HOST, port: POD_PORT, path: req.url, method: req.method,
      headers: { ...req.headers, host: `${POD_HOST}:${POD_PORT}` } },
    (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(PORT, () => console.log(`serving ${ROOT} + proxied /api → ${POD_HOST}:${POD_PORT} on http://localhost:${PORT}`));
