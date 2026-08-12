import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const display = (value) => String(value ?? "").trim() || "未维护";
const lines = (values) => (values?.length ? values : ["未维护"]).map((value) => `<span>${escapeHtml(typeof value === "string" ? value : value.text)}</span>`).join("");

function renderSummary({ asset, canEdit, notice }) {
  return `<section class="product-workspace-panel product-marketing-asset product-marketing-summary"><header><div><span>产品知识资产</span><h2>产品营销资产</h2></div><div class="product-marketing-actions">${canEdit ? `<button class="secondary-button" type="button" data-action="edit-product-marketing">编辑</button>` : ""}<button class="text-button" type="button" data-action="view-product-marketing">查看完整营销资产</button></div></header>
    ${notice ? `<div class="form-success">${escapeHtml(notice)}</div>` : ""}
    <div class="product-marketing-summary-grid">
      <article><small>产品定位</small><p>${escapeHtml(display(asset?.positioning))}</p></article>
      <article><small>目标人群</small><p>${escapeHtml(display(asset?.targetAudience))}</p></article>
      <article><small>使用场景</small><div class="product-marketing-tags">${lines(asset?.usageScenarios)}</div></article>
      <article><small>关键词</small><div class="product-marketing-tags">${lines(asset?.keywords)}</div></article>
      <article class="is-wide"><small>核心卖点</small><ol>${asset?.sellingPoints?.length ? asset.sellingPoints.map((point) => `<li>${escapeHtml(point.text)}</li>`).join("") : `<li>未维护</li>`}</ol></article>
      <article class="is-wide"><small>产品故事</small><p>${escapeHtml(display(asset?.productStory))}</p></article>
    </div>
  </section>`;
}

function renderRead({ asset, canEdit, notice }) {
  return `<section class="product-workspace-panel product-marketing-asset"><header><div><span>产品知识资产</span><h2>产品营销信息</h2></div><div class="product-marketing-actions">${canEdit ? `<button class="secondary-button" type="button" data-action="edit-product-marketing">编辑</button>` : ""}<button class="primary-button" type="button" data-action="copy-product-marketing"> 复制 AI 资料</button></div></header>
    ${notice ? `<div class="form-success">${escapeHtml(notice)}</div>` : ""}
    <div class="product-marketing-reading"><article><small>产品定位</small><p>${escapeHtml(display(asset?.positioning))}</p></article><article><small>目标人群</small><p>${escapeHtml(display(asset?.targetAudience))}</p></article>
      <article><small>使用场景</small><div class="product-marketing-tags">${lines(asset?.usageScenarios)}</div></article><article><small>关键词库</small><div class="product-marketing-tags">${lines(asset?.keywords)}</div></article>
      <article class="is-wide"><small>核心卖点</small><ol>${asset?.sellingPoints?.length ? asset.sellingPoints.map((point) => `<li>${escapeHtml(point.text)}</li>`).join("") : `<li>未维护</li>`}</ol></article>
      <article class="is-wide"><small>产品故事</small><p>${escapeHtml(display(asset?.productStory))}</p></article>
    </div></section>`;
}

function renderEdit({ asset }) {
  const join = (values, mapper = (item) => item) => (values || []).map(mapper).join("\n");
  return `<section class="product-workspace-panel product-marketing-asset"><header><div><span>产品知识资产</span><h2>编辑营销信息</h2></div></header><form class="product-marketing-form" data-product-marketing-form>
    <label><span>产品定位</span><textarea name="positioning" rows="3" placeholder="说明产品解决什么需求、与同类产品的差异">${escapeHtml(asset?.positioning || "")}</textarea></label>
    <label><span>目标人群</span><textarea name="targetAudience" rows="3" placeholder="说明核心用户特征和需求">${escapeHtml(asset?.targetAudience || "")}</textarea></label>
    <label><span>使用场景</span><textarea name="usageScenarios" rows="5" placeholder="每行一个场景">${escapeHtml(join(asset?.usageScenarios))}</textarea></label>
    <label><span>关键词库</span><textarea name="keywords" rows="5" placeholder="每行一个关键词">${escapeHtml(join(asset?.keywords))}</textarea></label>
    <label class="is-wide"><span>核心卖点</span><textarea name="sellingPoints" rows="7" placeholder="每行一条卖点，保存后按当前顺序展示">${escapeHtml(join(asset?.sellingPoints, (item) => item.text))}</textarea><small>每行保存为一条独立卖点，行顺序即卖点顺序。</small></label>
    <label class="is-wide"><span>产品故事</span><textarea name="productStory" rows="7" placeholder="记录产品背景、设计理念和情感价值">${escapeHtml(asset?.productStory || "")}</textarea></label>
    <footer><button class="secondary-button" type="button" data-action="cancel-product-marketing">取消</button><button class="primary-button" type="submit">保存营销信息</button></footer>
  </form></section>`;
}

registerUiModule({
  moduleKey: "product_marketing_asset",
  name: "ProductMarketingAsset",
  domain: "product",
  description: "产品定位、人群、场景、卖点、故事和关键词的标准阅读/编辑模块。",
  render: (context) => context.mode === "edit" ? renderEdit(context) : context.mode === "summary" ? renderSummary(context) : renderRead(context),
  configSchema: { mode: ["summary", "read", "edit"] },
  dependencies: ["Product", "ProductMarketingAsset", "ProductMarketingManage"],
});
