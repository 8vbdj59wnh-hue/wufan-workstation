import test from "node:test";
import assert from "node:assert/strict";

import { renderLinkBusinessToolbar } from "../src/uiModules/linkBusinessToolbar.js";
import { renderLinkBusinessTable } from "../src/uiModules/linkBusinessTable.js";

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
