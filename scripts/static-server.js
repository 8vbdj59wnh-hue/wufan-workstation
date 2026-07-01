import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "0.0.0.0";

const app = express();

function setNoCacheHeaders(response) {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("Surrogate-Control", "no-store");
}

app.use(
  express.static(projectRoot, {
    etag: false,
    lastModified: false,
    setHeaders: setNoCacheHeaders,
  }),
);

app.use((request, response, next) => {
  if (!request.accepts("html")) {
    next();
    return;
  }
  setNoCacheHeaders(response);
  response.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Static client server running at http://${host}:${port}`);
});
