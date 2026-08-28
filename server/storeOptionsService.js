function cleanText(value) {
  return String(value ?? "").trim();
}

export function buildActiveStoreOptions(stores = []) {
  return (Array.isArray(stores) ? stores : [])
    .filter((store) => cleanText(store?.status) === "active")
    .map((store) => ({
      id: cleanText(store.id),
      name: cleanText(store.name),
      platform: cleanText(store.platform),
      status: "active",
    }))
    .filter((store) => store.id !== "" && store.name !== "");
}
