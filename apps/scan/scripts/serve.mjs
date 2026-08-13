import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "0.0.0.0";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    // The app is mounted at /d/ behind the proxy: /d/main.js is the bundle,
    // while /d/<slug> is a collar code with no file behind it and falls through
    // to the shell below. Strip the prefix before resolving against dist/.
    if (pathname.startsWith("/d/")) pathname = pathname.slice(2);
    if (pathname === "/d" || pathname === "/") pathname = "/index.html";
    const file = normalize(join(ROOT, pathname));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    let data;
    let contentType = MIME[extname(file)] ?? "application/octet-stream";
    try {
      data = await readFile(file);
    } catch {
      // SPA fallback. Collar URLs (/d/<slug>) have no file on disk, and the
      // requested path has no extension -- deriving the type from it labelled
      // the app shell application/octet-stream, so browsers downloaded the
      // scan page instead of rendering it. The shell is always HTML.
      data = await readFile(join(ROOT, "index.html"));
      contentType = MIME[".html"];
    }
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`@hetja/scan → http://${HOST}:${PORT}/d/<slug>?s=<sig>`);
});
