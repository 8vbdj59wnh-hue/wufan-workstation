import { initializeWorkstation } from "./workstation.js";
import { authFetch, apiBaseUrl } from '../../../src/appState.js';

window.contentCenterFetch = (url, options = {}) => {
  if (!url.startsWith('/api/')) throw new Error('内容中心请求地址无效');
  return authFetch(`${apiBaseUrl}/api/content-center/${url.slice(5)}`, options);
};
const imageRequests = new Map();
const objectUrls = new Set();
const observed = new WeakSet();
const imageObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    imageObserver.unobserve(img);
    const path = img.dataset.contentImage;
    if (!imageRequests.has(path)) imageRequests.set(path, window.contentCenterFetch(path).then(async response => {
      if (!response.ok) throw new Error('图片读取失败，请检查登录或权限');
      const url = URL.createObjectURL(await response.blob()); objectUrls.add(url); return url;
    }));
    imageRequests.get(path).then(url => { img.src = url; if(img.parentElement?.tagName==='A')img.parentElement.href=url; }).catch(error => { img.alt = error.message; imageRequests.delete(path); });
  }
}, { rootMargin: '200px' });
const writeSelector = '[data-add-request], #new-note, #save-as-candidate, [data-edit-candidate], #edit-detail, #schedule-candidate, [data-new-candidate], [data-schedule], [data-quick-status], [data-quick-time], [data-new-date], [data-new-time], [data-add-reference]';
function refreshIntegration() {
  document.querySelectorAll('img[data-content-image]').forEach(img => {
    if (!observed.has(img)) { observed.add(img); imageObserver.observe(img); }
  });
  const permissions = window.contentCenterPermissions;
  if (!permissions) return;
  if (!permissions.manage) {
    document.querySelectorAll(writeSelector).forEach(element => { element.disabled = true; element.title = '仅可查看，请联系管理员开通内容管理权限'; });
    document.querySelectorAll('[draggable="true"]').forEach(element => { element.draggable = false; });
    document.querySelectorAll('[data-config-kind] input,[data-config-kind] select,[data-config-kind] textarea,[data-config-kind] button').forEach(element => { element.disabled = true; });
  }
}
new MutationObserver(refreshIntegration).observe(document.body, { childList: true, subtree: true });
document.addEventListener('submit', event => {
  if (window.contentCenterPermissions?.manage === false) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
document.addEventListener('drop', event => {
  if (window.contentCenterPermissions?.manage === false) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
const productLookupRevisions = new WeakMap();
document.addEventListener('focusout', async event => {
  const input = event.target;
  if (input.name !== 'productCodes' && input.dataset.key !== 'productCodes') return;
  let hint = input.parentElement.querySelector('[data-product-match]');
  if (!hint) { hint = document.createElement('small'); hint.dataset.productMatch = ''; hint.setAttribute('role', 'status'); input.after(hint); }
  const revision = (productLookupRevisions.get(input) || 0) + 1;
  productLookupRevisions.set(input, revision);
  if (!input.value.trim()) { hint.textContent = ''; return; }
  if (!window.contentCenterPermissions?.products) { hint.textContent = '已保留编码；查询产品资料需要产品查看权限。'; return; }
  hint.textContent = '正在核对工作站货品编码…';
  try {
    const response = await window.contentCenterFetch('/api/product-matches?codes=' + encodeURIComponent(input.value));
    const result = await response.json();
    if (revision !== productLookupRevisions.get(input) || !hint.isConnected) return;
    if (!response.ok) throw new Error(result.error || result.message || '查询失败');
    hint.textContent = result.map(item => `${item.code}：${item.status === 'matched' ? item.matches[0].goodsName || '已匹配' : item.status === 'ambiguous' ? '存在多个匹配，保留原编码' : '未找到货品，保留原编码'}`).join('；');
  } catch (error) { hint.textContent = `${error.message}，原编码仍可保存。`; }
});
window.addEventListener('pagehide', () => { imageObserver.disconnect(); objectUrls.forEach(url => URL.revokeObjectURL(url)); });
try {
  await initializeWorkstation();
  for (const file of ['app.js', 'company.js', 'requests.js', 'weekly-rhythm.js']) await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL(file, import.meta.url).href;
    script.onload = resolve; script.onerror = () => reject(new Error('内容中心页面加载失败，请刷新重试')); document.head.append(script);
  });
  const initialPage = new URLSearchParams(window.location.search).get('page');
  if (['requests','candidates','configuration'].includes(initialPage)) page=initialPage==='candidates'?'requests':initialPage;
  await window.contentCenterInit();
  window.contentCenterHasUnsavedChanges = () => dirty || uploading || configDirty || configSaving || requestDrafts.size > 0 || requestSaving.size > 0;
  refreshIntegration();
  const noteId = new URLSearchParams(window.location.search).get('note');
  if (noteId) { const note=notes.find(item=>item.id===noteId); if(note)showDetail(note); }
} catch (error) { const notice = document.querySelector('#load-error'); notice.hidden = false; notice.textContent = error.message; }
