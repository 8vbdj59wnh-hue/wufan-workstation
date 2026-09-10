import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "0.0.0.0";

const app = express();

function setHtmlNoCacheHeaders(response) {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("Surrogate-Control", "no-store");
}

// Private runtime data must never be served by the static frontend.
app.use((request, response, next) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { return response.sendStatus(400); }
  if (/^\/(data|backups?|logs|server|node_modules)(\/|$)/i.test(pathname) || /\.(sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|secret)$/i.test(pathname)) return response.sendStatus(404);
  next();
});

app.use(
  express.static(projectRoot, {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(response, filePath) {
      if (filePath.endsWith(".html")) setHtmlNoCacheHeaders(response);
      else response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    },
  }),
);

app.use((request, response, next) => {
  if (!request.accepts("html")) {
    next();
    return;
  }
  setHtmlNoCacheHeaders(response);
  response.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Static client server running at http://${host}:${port}`);
});
