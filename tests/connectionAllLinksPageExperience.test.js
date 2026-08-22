import test from "node:test";
import assert from "node:assert/strict";

import { renderLinkBusinessToolbar } from "../src/uiModules/linkBusinessToolbar.js";
import { renderLinkBusinessTable } from "../src/uiModules/linkBusinessTable.js";
import { renderLinkSalesDistribution } from "../src/uiModules/linkSalesDistribution.js";

test("全部链接经营筛选始终展开并按平台展示店铺名称", () => {
  const html = renderLinkBusinessToolbar({
    filters: { shopId: "shop-tmall" },
    options: {
      shops: [
        { id: "shop-tmall", platform: "tmall", name: "点意旗舰店" },
        { id: "shop-xhs", platform: "xiaohongshu", name: "半然" },
      ],
    },
  });

  assert.match(html, /经营筛选/);
  assert.doesNotMatch(html, /<details|<summary/);
  assert.match(html, /value="shop-tmall" selected>天猫 · 点意旗舰店/);
  assert.match(html, /value="shop-xhs" >小红书 · 半然/);
});

test("全部链接主图保持原表格尺寸并启用桌面悬停预览", () => {
  const html = renderLinkBusinessTable({
    fields: ["image", "name"],
    items: [{ id: "link-1", name: "测试链接", imageUrl: "/uploads/link.jpg", platformGoodsId: "10001" }],
    pagination: { page: 1, totalPages: 1, total: 1 },
  });

  assert.match(html, /class="link-image-module is-compact/);
  assert.match(html, /data-link-image-preview/);
  assert.match(html, /data-preview-max-width="360"/);
});

test("销售结构仅在分段视图启用链接悬停卡片入口", () => {
  const input = {
    canViewCompany: true,
    globalRange: { startDate: "2026-07-19", endDate: "2026-08-17" },
    state: {
      scope: "company",
      summary: { hasData: true, totalLinks: 1, linksWithData: 1, linksWithoutData: 0, totalSalesAmount: 100 },
      items: [{ linkId: "link-1", linkName: "测试链接", mainImage: "/uploads/link.jpg", platform: "天猫", shopName: "点意旗舰店", rank: 1, groupIndex: 1, salesAmount: 100, salesPercentage: 1, hasData: true, noData: false }],
    },
  };
  const allHtml = renderLinkSalesDistribution(input);
  const groupHtml = renderLinkSalesDistribution({ ...input, state: { ...input.state, selectedGroup: 1 } });

  assert.match(allHtml, /data-distribution-group="1"/);
  assert.doesNotMatch(allHtml, /data-distribution-bar/);
  assert.doesNotMatch(allHtml, /data-open-connection="link-1"/);
  assert.match(groupHtml, /data-distribution-bar/);
  assert.match(groupHtml, /data-open-connection="link-1"/);
  assert.match(groupHtml, /data-link-name="测试链接"/);
  assert.match(groupHtml, /data-link-image="\/uploads\/link.jpg"/);
  assert.match(groupHtml, /data-link-platform="天猫"/);
  assert.match(groupHtml, /data-link-shop="点意旗舰店"/);
});
