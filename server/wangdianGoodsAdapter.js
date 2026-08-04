function value(raw) {
  return String(raw ?? "").trim();
}
function normalizeImageUrls(specification) {
  return [specification?.img_url, ...(Array.isArray(specification?.img_more_url) ? specification.img_more_url : [])]
    .map(value)
    .filter((item, index, all) => /^https?:\/\//iu.test(item) && all.indexOf(item) === index);
}

function normalizeErpStatus(goods, specification) {
  if (Number(specification?.deleted ?? goods?.deleted ?? 0) > 0) return "inactive";
  return "active";
}

export function adaptWangdianGoodsResponse(payload) {
  const goodsList = Array.isArray(payload?.data?.goods_list) ? payload.data.goods_list : [];
  const records = [];
  for (const goods of goodsList) {
    const specifications = Array.isArray(goods?.spec_list) && goods.spec_list.length ? goods.spec_list : [{}];
    for (const specification of specifications) {
      const canonical = {
        goodsCode: value(goods?.goods_no),
        goodsName: value(goods?.goods_name),
        shortName: value(goods?.short_name),
        brand: value(goods?.brand_name),
        category: value(goods?.class_name),
        productType: value(goods?.goods_type),
        sourceCreatedAt: value(goods?.goods_created),
        sourceUpdatedAt: value(specification?.spec_modified) || value(goods?.modified) || value(goods?.goods_modified),
        goodsDeleted: Number(goods?.deleted ?? 0) > 0,
        merchantSkuCode: value(specification?.spec_no),
        specificationName: value(specification?.spec_name),
        barcode: value(specification?.barcode),
        unit: value(specification?.spec_unit_name) || value(goods?.unit_name),
        erpStatus: normalizeErpStatus(goods, specification),
        imageUrls: normalizeImageUrls(specification),
        rawGoods: goods,
        rawSpecification: specification,
      };
      records.push(canonical);
    }
  }
  return records;
}

export function canonicalGoodsRecordsToStaging(records) {
  return records.map((canonical, index) => ({
    rowNumber: index + 1,
    imageUrls: canonical.imageUrls,
    canonical,
    record: {
      "货品编号": canonical.goodsCode,
      "商家编码": canonical.merchantSkuCode,
      "货品名称": canonical.goodsName,
      "简称": canonical.shortName,
      "品牌": canonical.brand,
      "分类": canonical.category,
      "品类": canonical.productType,
      "创建时间": canonical.sourceCreatedAt,
      "源修改时间": canonical.sourceUpdatedAt,
      "货品删除状态": canonical.goodsDeleted ? "deleted" : "active",
      "规格名称": canonical.specificationName,
      "主条码": canonical.barcode,
      "基本单位": canonical.unit,
      "单品状态": canonical.erpStatus,
      "图片链接": canonical.imageUrls[0] ?? "",
      "旺店通货品原文": JSON.stringify(canonical.rawGoods ?? {}),
      "旺店通SKU原文": JSON.stringify(canonical.rawSpecification ?? {}),
    },
  }));
}
