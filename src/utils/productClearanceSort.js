export const clearanceSortOptions = [
  ['default', '默认'], ['salesAmount', '销售额'], ['salesQuantity', '销量'],
  ['inventory', '库存'], ['inventoryAmount', '库存金额'], ['progress', '清仓进度'],
];

export function sortClearancePlans(items, key = 'default', direction = 'desc') {
  const getters = {
    salesAmount: item => item.sales?.periodAmount,
    salesQuantity: item => item.sales?.periodQuantity,
    inventory: item => item.currentInventoryQuantity,
    inventoryAmount: item => item.currentInventoryAmount,
    progress: item => item.inventoryProgress,
  };
  const get = getters[key];
  if (!get) return [...items];
  const value = item => {
    const raw = get(item);
    return raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
  };
  return [...items].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (left - right) * (direction === 'asc' ? 1 : -1);
  });
}
