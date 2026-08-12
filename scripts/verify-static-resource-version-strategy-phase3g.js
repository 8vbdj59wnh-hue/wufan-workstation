import fs from "node:fs";
import path from "node:path";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const files = [
  "index.html",
  ...fs.readdirSync("src", { recursive: true }).filter((file) => file.endsWith(".js")).map((file) => path.join("src", file)),
];
const references = new Map();
let versionedReferenceCount = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/["']([^"']+\.(?:js|css))(\?v=[^"']+)?["']/g)) {
    const resourcePath = path.normalize(path.resolve(path.dirname(file), match[1]));
    const urls = references.get(resourcePath) ?? new Set();
    urls.add(resourcePath);
    references.set(resourcePath, urls);
    if (match[2]) versionedReferenceCount += 1;
  }
}

const duplicateResources = [...references]
  .filter(([, urls]) => urls.size > 1)
  .map(([file, urls]) => ({ file: path.relative(process.cwd(), file), urls: [...urls] }));

assert(versionedReferenceCount === 0, `仍存在${versionedReferenceCount}处业务文件自定义?v参数。`);
assert(duplicateResources.length === 0, `仍存在${duplicateResources.length}个资源使用不同URL。`);

const mainSource = fs.readFileSync("src/main.js", "utf8");
const loaderSource = fs.readFileSync("src/moduleLoader.js", "utf8");
assert(mainSource.includes('from "./moduleLoader.js"'), "main.js未使用规范化moduleLoader URL。");
assert(loaderSource.includes('import("./pages/tasksPage.js")'), "任务动态模块URL未规范化。");
assert(loaderSource.includes('import("./pages/connectionCenterPage.js")'), "链接动态模块URL未规范化。");
assert(loaderSource.includes('import("./pages/productCenterPage.js")'), "产品动态模块URL未规范化。");

const serverSource = fs.readFileSync("scripts/static-server.js", "utf8");
assert(serverSource.includes('etag: true'), "静态服务未启用ETag。");
assert(serverSource.includes('public, max-age=0, must-revalidate'), "静态资源未启用协商缓存。");
assert(serverSource.includes('no-store, no-cache'), "HTML入口未保持不缓存策略。");

console.log(JSON.stringify({
  strategy: "canonical-url-with-http-revalidation",
  scannedFiles: files.length,
  resourceReferences: [...references.values()].reduce((sum, urls) => sum + urls.size, 0),
  versionedReferences: versionedReferenceCount,
  duplicateResources: duplicateResources.length,
  dynamicRoutes: ["tasks", "connectionCenter", "products"],
  assetCache: "ETag + must-revalidate",
  htmlCache: "no-store",
}, null, 2));
