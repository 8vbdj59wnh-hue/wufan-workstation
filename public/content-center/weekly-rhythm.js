'use strict';
const rhythmDialog=document.createElement('dialog');rhythmDialog.className='weekly-rhythm-dialog';document.body.append(rhythmDialog);
let rhythmConfig=null,rhythmAccount=null,rhythmTimes=[],rhythmCells=new Map(),rhythmSaving=false;
function renderRhythm(){
 rhythmDialog.innerHTML=`<form><div class="dialog-heading"><h2>${esc(rhythmAccount.name)} · 每周发布节奏</h2><button type="button" data-rhythm-close>关闭</button></div><label class="rhythm-enabled"><input type="checkbox" data-rhythm-enabled ${rhythmConfig.enabled?'checked':''}>启用每周固定需求</label><p>每次打开需求页，自动补齐下周和下下周。已有需求和策划保留，不重复生成；空白时段不发布。</p>${rhythmConfig.solarTerm?`<p>节气当天 ${esc(rhythmConfig.solarTerm.time)} 发布「${esc(rhythmConfig.solarTerm.column)}」，替换当天常规需求（按北京时间）。</p>`:''}<div class="rhythm-grid-scroll"><table><thead><tr><th>星期</th>${rhythmTimes.map(t=>`<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:7},(_,i)=>`<tr><th>周${'一二三四五六日'[i]}</th>${rhythmTimes.map(t=>`<td><select data-rhythm-day="${i+1}" data-rhythm-time="${esc(t)}" aria-label="周${'一二三四五六日'[i]} ${esc(t)}">${options(rhythmAccount.columns.map(c=>c.name),rhythmCells.get((i+1)+'/'+t)||'','— 不发布')}</select></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="rhythm-time-entry"><input type="time" data-rhythm-new-time aria-label="新增发布时间"><button type="button" data-rhythm-add-time>增加时段</button><span data-rhythm-count></span></div><p>修改节奏仅影响尚未生成的需求。已经生成的内容请在列表中调整。</p><div class="dialog-footer"><span role="alert"></span><button type="submit" class="primary">保存节奏</button></div></form>`;
 updateRhythmCount();
}
function updateRhythmCount(){rhythmDialog.querySelector('[data-rhythm-count]').textContent=`每周 ${[...rhythmCells.values()].filter(Boolean).length} 条`;}
document.addEventListener('click',async e=>{
 if(!e.target.closest('[data-weekly-rhythm]'))return;
 rhythmAccount=account(filters.account);if(!rhythmAccount)return;
 try{rhythmConfig=await api('/api/weekly-rhythm/'+encodeURIComponent(rhythmAccount.id));rhythmTimes=[...new Set((rhythmConfig.slots.length?rhythmConfig.slots.map(s=>s.time):['09:00','12:30','18:30','21:30']))].sort();rhythmCells=new Map(rhythmConfig.slots.map(s=>[s.weekday+'/'+s.time,s.column]));renderRhythm();rhythmDialog.showModal();}catch(error){toast(error.message);}
});
rhythmDialog.addEventListener('change',e=>{if(e.target.matches('[data-rhythm-day]')){rhythmCells.set(e.target.dataset.rhythmDay+'/'+e.target.dataset.rhythmTime,e.target.value);updateRhythmCount();}if(e.target.matches('[data-rhythm-enabled]'))rhythmConfig.enabled=e.target.checked;});
rhythmDialog.addEventListener('click',e=>{if(e.target.closest('[data-rhythm-close]')&&!rhythmSaving)rhythmDialog.close();if(e.target.closest('[data-rhythm-add-time]')){const time=rhythmDialog.querySelector('[data-rhythm-new-time]').value;if(time&&!rhythmTimes.includes(time)){rhythmTimes.push(time);rhythmTimes.sort();renderRhythm();}}});
rhythmDialog.addEventListener('cancel',e=>{if(rhythmSaving)e.preventDefault();});
rhythmDialog.addEventListener('submit',async e=>{
 e.preventDefault();if(rhythmSaving)return;rhythmSaving=true;const button=rhythmDialog.querySelector('[type=submit]');button.disabled=true;
 try{const slots=[...rhythmCells].filter(([,column])=>column).map(([key,column])=>({weekday:Number(key.split('/')[0]),time:key.split('/')[1],column}));await api('/api/weekly-rhythm/'+encodeURIComponent(rhythmAccount.id),'PUT',{revision:rhythmConfig.revision,enabled:rhythmConfig.enabled,slots});rhythmDialog.close();await reload();toast('每周节奏已保存，已有策划保留');}catch(error){rhythmDialog.querySelector('[role=alert]').textContent=error.message;}finally{rhythmSaving=false;button.disabled=false;}
});
