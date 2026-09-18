import { state, validateCurrentSession, resolveAssetUrl } from '../../../src/appState.js';
import { renderActionProductSelector, bindActionProductSelectors, collectActionProductIds } from '../../../src/actionProductRelations.js';
import { renderContentNoteTemplateSelector, bindContentNoteTemplateSelectors } from '../../../src/contentNoteTemplateSelector.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function read(path, options) {
  const response = await window.contentCenterFetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || '读取失败');
  return data;
}
let optionsCache = null;
export async function initializeWorkstation() {
  await validateCurrentSession();
  optionsCache = await read('/api/references');
  window.contentRequestReferences = optionsCache;
  window.contentRequestAssetUrl = resolveAssetUrl;
  window.mountContentWorkstationReferences = async note => {
    const host = document.querySelector('#workstation-relations');
    if (!host) return;
    const save = document.querySelector('#save-note'); save.disabled = true;
    host.dataset.loading = 'true';
    try {
      const options = await read('/api/references' + (note?.id ? '?noteId='+encodeURIComponent(note.id) : ''));
      if (!host.isConnected) return;
      state.templates = options.templates;
      state.actionProductOptions = options.productOptions;
      host.innerHTML = `${window.contentCenterPermissions?.products ? renderActionProductSelector(note?.workstationProductIds || []) : '<p>暂无产品查看权限；已有产品关联将保留。</p>'}
        ${options.canUseTemplates ? renderContentNoteTemplateSelector(note?.workstationTemplateId || '') : '<p>暂无模板中心查看权限；已有模板关联将保留。</p>'}
        <input type="hidden" name="publishingAccountId" value="${escape(note?.publishingAccountId||'')}">
        <p class="muted">产品与模板直接使用工作站资料。策划账号属于品牌栏目，工作站发布账号用于执行行动，请核对后关联。</p>`;
      bindActionProductSelectors(host, { loadOptions: query => read('/api/product-options?search='+encodeURIComponent(query)) });
      bindContentNoteTemplateSelectors(host);
      host.querySelector('[data-action="clear-goal-linked-template"]')?.addEventListener('click', () => { host.querySelectorAll('[name="linkedTemplateId"]').forEach(input=>input.checked=false); host.dispatchEvent(new Event('input',{bubbles:true})); });
      host.addEventListener('action-products-change', () => host.dispatchEvent(new Event('input',{bubbles:true})));
      host.dataset.canTemplates = String(options.canUseTemplates);
      host.dataset.loading = 'false';
    } catch (error) { host.innerHTML = `<p role="alert">${escape(error.message)}。请关闭表单后重试。</p>`; host.dataset.loading='error'; }
    finally { if (host.isConnected) save.disabled = host.dataset.loading !== 'false'; }
  };
  window.collectContentWorkstationReferences = () => {
    const host = document.querySelector('#workstation-relations');
    if (!host || host.dataset.loading !== 'false') throw new Error('产品与模板资料尚未载入，请稍后重试');
    return { ...(window.contentCenterPermissions?.products ? { workstationProductIds: collectActionProductIds(host) } : {}), ...(host.dataset.canTemplates==='true' ? { workstationTemplateId:host.querySelector('[name="linkedTemplateId"]:checked')?.value || '' } : {}), publishingAccountId:host.querySelector('[name="publishingAccountId"]').value };
  };
  window.renderContentWorkstationSummary = async note => {
    const host = document.querySelector('#workstation-reference-summary'); if(!host)return;
    try {
      const refs = await read('/api/references?noteId='+encodeURIComponent(note.id)); if(!host.isConnected)return;
      const template = refs.templates.find(t=>t.id===note.workstationTemplateId);
      const account = refs.publishingAccounts.find(a=>a.id===note.publishingAccountId);
      host.innerHTML = `<h3>关联产品</h3>${refs.productOptions.length?refs.productOptions.map(product=>`<a target="_top" href="/#products/sku/${encodeURIComponent(product.erpSkuId)}">${escape(product.name)} · ${escape(product.skuCode || product.erpSkuCode || '')}</a>`).join('<br>'):`<p>${note.workstationProductIds?.length?'已有产品关联，当前不可查看':'暂未关联产品'}</p>`}<h3>关联模板</h3><p>${escape(template?.name || (note.workstationTemplateId?'原模板已失效或无查看权限':'暂未关联模板'))}</p><h3>工作站发布账号</h3><p>${escape(account ? `${account.name}（${account.platform}）` : '尚未关联有效发布账号')}</p><p>计划发布：${escape([note.date || note.preferredDate,note.time || note.preferredTime].filter(Boolean).join(' ') || '待安排')}</p>`;
    } catch(error) { if(host.isConnected)host.textContent=error.message; }
  };
  window.launchContentPlanning = async note => {
    if(!String(note.title||'').trim()||contentStageOf(note)!=='candidate')throw Error('请先保存策划标题，并填写正文或选择不设正文');
    const prefill=await read('/api/notes/'+encodeURIComponent(note.id)+'/launch-preview');
    if(prefill.existing){window.parent.sessionStorage.setItem('selectedProcessInstanceId',prefill.existing.actionId);window.parent.location.hash='process-progress';return;}
    window.parent.sessionStorage.setItem('goalTaskPrefill',JSON.stringify({...prefill,publishingAccounts:optionsCache.publishingAccounts}));
    window.parent.location.hash='goals';
  };
  window.renderContentActionPanel = async note => {
    const host = document.querySelector('#content-action-panel'); if (!host) return;
    try {
      const progress = await read('/api/notes/'+encodeURIComponent(note.id)+'/action'); if(!host.isConnected)return;
      host.innerHTML = `<h3>发布行动</h3>${progress.linked ? `<p><strong>${escape(progress.status)}</strong> ${escape(progress.businessCode || '')}</p><p>${escape(progress.currentTask || '')}${progress.executorName?' · '+escape(progress.executorName):''}</p>${progress.changedSinceLaunch?'<p class="content-action-warning">策划在发起后有修改，行动保留发起时的快照。请在行动中确认调整，避免覆盖执行内容。</p>':''}${progress.publishUrl?`<a href="${escape(progress.publishUrl)}" target="_blank" rel="noopener">查看已发布笔记</a><p>实际发布：${escape(progress.publishedAt || '待补充')}</p>`:''}${progress.actionId?'<button type="button" data-open-linked-action>查看关联行动</button>':''}` : `<p>把策划交给制作、审核和发布流程，执行结果会显示在这里。</p>${optionsCache.canLaunch?'<button type="button" class="primary" data-launch-content-action>发起发布行动</button>':'<p class="muted">发起需要内容管理、目标查看和发布内容笔记发起权限。</p>'}`}`;
      host.querySelector('[data-open-linked-action]')?.addEventListener('click', () => { window.parent.sessionStorage.setItem('selectedProcessInstanceId',progress.actionId); window.parent.location.hash='process-progress'; });
      host.querySelector('[data-launch-content-action]')?.addEventListener('click', async event => {
        event.target.disabled=true;
        try {
          const prefill=await read('/api/notes/'+encodeURIComponent(note.id)+'/launch-preview');
          if(prefill.existing){await window.renderContentActionPanel(note);return;}
          // The next screen is the existing workstation launch form, not a launch request.
          window.parent.sessionStorage.setItem('goalTaskPrefill',JSON.stringify({...prefill,publishingAccounts:optionsCache.publishingAccounts}));
          window.parent.location.hash='goals';
        } catch(error) { let message=host.querySelector('[role="alert"]');if(!message){message=document.createElement('p');message.setAttribute('role','alert');host.append(message);}message.textContent=error.message;event.target.disabled=false; }
      });
    } catch(error) { if(host.isConnected)host.textContent=error.message; }
  };
}
