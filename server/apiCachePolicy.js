export const apiNoStoreHeaders = Object.freeze({
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
});

export function applyApiNoStoreHeaders(_request, response, next) {
  Object.entries(apiNoStoreHeaders).forEach(([name, value]) => {
    response.setHeader(name, value);
  });
  next();
}

export function configureApiCachePolicy(app) {
  app.disable("etag");
  app.use("/api", applyApiNoStoreHeaders);
}
