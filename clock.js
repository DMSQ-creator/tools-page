/* Local-only clocks using the browser's IANA timezone rules. */
(function(root){
 'use strict';
 const cities=[
 ['北京 / 上海','China Beijing Shanghai','Asia/Shanghai'],['香港','Hong Kong','Asia/Hong_Kong'],['台北','Taipei','Asia/Taipei'],['东京','Japan Tokyo','Asia/Tokyo'],['首尔','Korea Seoul','Asia/Seoul'],['新加坡','Singapore','Asia/Singapore'],['曼谷','Thailand Bangkok','Asia/Bangkok'],['胡志明市','Vietnam Ho Chi Minh','Asia/Ho_Chi_Minh'],['雅加达','Indonesia Jakarta','Asia/Jakarta'],['新德里','India New Delhi','Asia/Kolkata'],['加德满都','Nepal Kathmandu','Asia/Kathmandu'],['达卡','Bangladesh Dhaka','Asia/Dhaka'],['卡拉奇','Pakistan Karachi','Asia/Karachi'],['迪拜','UAE Dubai','Asia/Dubai'],['利雅得','Saudi Riyadh','Asia/Riyadh'],['伊斯坦布尔','Turkey Istanbul','Europe/Istanbul'],['伦敦','UK London','Europe/London'],['柏林','Germany Berlin','Europe/Berlin'],['巴黎','France Paris','Europe/Paris'],['马德里','Spain Madrid','Europe/Madrid'],['罗马','Italy Rome','Europe/Rome'],['华沙','Poland Warsaw','Europe/Warsaw'],['莫斯科','Russia Moscow','Europe/Moscow'],['纽约','USA New York','America/New_York'],['芝加哥','USA Chicago','America/Chicago'],['丹佛','USA Denver','America/Denver'],['洛杉矶','USA Los Angeles','America/Los_Angeles'],['凤凰城','USA Phoenix','America/Phoenix'],['多伦多','Canada Toronto','America/Toronto'],['温哥华','Canada Vancouver','America/Vancouver'],['墨西哥城','Mexico City','America/Mexico_City'],['圣保罗','Brazil Sao Paulo','America/Sao_Paulo'],['波哥大','Colombia Bogota','America/Bogota'],['圣地亚哥','Chile Santiago','America/Santiago'],['悉尼','Australia Sydney','Australia/Sydney'],['珀斯','Australia Perth','Australia/Perth'],['奥克兰','New Zealand Auckland','Pacific/Auckland'],['开罗','Egypt Cairo','Africa/Cairo'],['约翰内斯堡','South Africa Johannesburg','Africa/Johannesburg'],['拉各斯','Nigeria Lagos','Africa/Lagos'],['内罗毕','Kenya Nairobi','Africa/Nairobi']
 ].map(([name,english,zone])=>({name,english,zone}));
 const formats=new Map();
 function parts(instant,zone){
  if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return Object.fromEntries(formats.get(zone).formatToParts(new Date(instant)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 }
 function offset(instant,zone){const p=parts(instant,zone);return (Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(Number(instant)/1000)*1000)/60000}
 function offsetLabel(minutes){const sign=minutes<0?'−':'+';const a=Math.abs(minutes);return `UTC${sign}${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`}
 function resolveLocal(value,zone){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if(!match)throw Error('请选择完整日期和时间。');
  const [y,m,d,h,min]=match.slice(1).map(Number);
  if(y<2000||y>2100)throw Error('请选择 2000–2100 年之间的日期。');
  const wall=Date.UTC(y,m-1,d,h,min),test=new Date(wall);
  if(test.getUTCFullYear()!==y||test.getUTCMonth()!==m-1||test.getUTCDate()!==d||h>23||min>59)throw Error('日期或时间无效。');
  // Collect offsets around the selected day to detect gaps AND folds, including half-hour DST.
  const offsets=new Set();for(let n=-48;n<=48;n+=6)offsets.add(offset(wall+n*3600000,zone));
  const candidates=[...offsets].map(o=>wall-o*60000).filter(t=>{const p=parts(t,zone);return p.year===y&&p.month===m&&p.day===d&&p.hour===h&&p.minute===min});
  if(!candidates.length)throw Error('该当地时间因夏令时跳时而不存在，请选择其他时间。');
  if(candidates.length>1)throw Error('该当地时间在夏令时回拨时出现两次，请换一个无歧义的时间，或从其他时区换算。');
  return candidates[0];
 }
 function inputValue(instant,zone){const p=parts(instant,zone);const pad=v=>String(v).padStart(2,'0');return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`}
 const api={cities,parts,offset,offsetLabel,resolveLocal,inputValue};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const $=id=>root.document.getElementById(id),container=$('clock-tool-area');if(!container)return;
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 container.innerHTML=`<div class="clock-controls"><label>基准城市<select id="clock-origin">${cities.map(c=>`<option value="${c.zone}">${c.name}</option>`).join('')}</select></label><label>模式<select id="clock-mode"><option value="live">现在 · 实时更新</option><option value="fixed">指定基准城市时间</option></select></label><label id="clock-date-label" hidden>基准城市当地日期 / 时间<input id="clock-date" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59"></label><button id="clock-now" type="button" class="secondary-button">回到现在</button></div><div class="clock-search"><label for="clock-search">筛选城市 / 国家 / 时区</label><input id="clock-search" type="search" placeholder="例如：美国、纽约、London、Asia…"><span id="clock-count"></span></div><p id="clock-status" class="clock-status" role="status" aria-live="polite"></p><div class="clock-grid" id="clock-results"></div><p class="clock-note">时差按所选日期计算，包含夏令时及半小时 / 45 分钟偏移。常用城市列表并非全部时区；国家可能跨多个时区。工作时段仅作提示：周一至周五 09:00–18:00，不含当地节假日。</p>`;
 const countryAliases={'美国':'USA','英国':'UK','中国':'China','德国':'Germany','法国':'France','加拿大':'Canada','澳大利亚':'Australia','印度':'India','日本':'Japan','韩国':'Korea','巴西':'Brazil','墨西哥':'Mexico','阿联酋':'UAE'};
 let fixedInstant=null;
 function configure(){
  const fixed=$('clock-mode').value==='fixed';$('clock-date-label').hidden=!fixed;
  if(fixed){try{fixedInstant=resolveLocal($('clock-date').value,$('clock-origin').value);$('clock-status').textContent='正在比较所选时刻；所有城市对应同一个瞬间。'}catch(error){fixedInstant=null;$('clock-status').textContent=error.message;$('clock-results').innerHTML='';$('clock-count').textContent='';return}}
  else {$('clock-status').textContent='当前时间 · 根据设备时钟实时更新';fixedInstant=null}
  render();
 }
 function render(){
  if($('clock-mode').value==='fixed'&&fixedInstant===null)return;
  const instant=$('clock-mode').value==='fixed'?fixedInstant:Date.now(),origin=$('clock-origin').value;
  const baseOffset=offset(instant,origin),q=$('clock-search').value.trim().toLowerCase(),needle=(countryAliases[q]||q).toLowerCase();
  const filtered=cities.filter(c=>`${c.name} ${c.english} ${c.zone}`.toLowerCase().includes(needle));
  $('clock-count').textContent=`${filtered.length} 个城市`;
  $('clock-results').innerHTML=filtered.map(c=>{
   const p=parts(instant,c.zone),off=offset(instant,c.zone),delta=off-baseOffset;
   const weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:c.zone,weekday:'short'}).format(instant);
   const day=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay(),working=day>0&&day<6&&p.hour>=9&&p.hour<18;
   const difference=delta===0?'与基准同时间':`比基准${delta>0?'快':'慢'} ${Math.floor(Math.abs(delta)/60)} 小时${Math.abs(delta)%60?` ${Math.abs(delta)%60} 分钟`:''}`;
   return `<article class="clock-card${c.zone===origin?' clock-base':''}"><div class="clock-card-top"><h2>${esc(c.name)}</h2><span>${c.zone===origin?'基准':esc(offsetLabel(off))}</span></div><div class="clock-time">${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}<small>:${String(p.second).padStart(2,'0')}</small></div><p>${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')} ${weekday}</p><div class="clock-difference">${difference}</div><div class="clock-card-bottom"><span>${working?'工作时段参考':'非工作时段参考'}</span><span>${esc(c.zone)}</span></div></article>`;
  }).join('')||'<p class="empty-state">未找到城市，请尝试中文城市名、英文国家名或时区名称。</p>';
 }
 $('clock-date').value=inputValue(Date.now(),'Asia/Shanghai');
 $('clock-origin').addEventListener('change',configure);$('clock-mode').addEventListener('change',configure);$('clock-date').addEventListener('input',configure);$('clock-search').addEventListener('input',render);
 $('clock-now').addEventListener('click',()=>{$('clock-mode').value='live';$('clock-date').value=inputValue(Date.now(),$('clock-origin').value);configure()});
 configure();root.setInterval(()=>{if(!container.hidden&&!root.document.hidden&&$('clock-mode').value==='live')render()},1000);
})(typeof window==='undefined'?globalThis:window);
