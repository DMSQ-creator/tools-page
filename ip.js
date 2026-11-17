/* Native IP client. No API keys, iframe, automatic lookup or third-party UI code. */
(function(root){
  'use strict';
  function isIP(value) {
    if (typeof value !== 'string' || !value || value.length>45) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return value.split('.').every(part=>/^(0|[1-9]\d{0,2})$/.test(part)&&Number(part)<=255);
    if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return false;
    try { return new URL(`http://[${value}]/`).hostname.startsWith('['); } catch { return false; }
  }
  const text = value => typeof value==='string' && value.trim() ? value.trim().slice(0,500) : typeof value==='number' && Number.isFinite(value) ? String(value) : '未知';
  const score = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? value : null;
  const flag = value => value===true ? '检出' : value===false ? '未检出' : '未知';
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalize(data) {
    if (!data || typeof data!=='object' || !isIP(data.target_ip) || !data.details || typeof data.details!=='object') throw Error('接口返回格式异常，未生成报告。');
    const geo=data.details.geo||{}, security=data.details.security||{}, summary=data.summary||{};
    const validCoordinates=typeof geo.lat==='number' && Number.isFinite(geo.lat) && Math.abs(geo.lat)<=90 && typeof geo.lon==='number' && Number.isFinite(geo.lon) && Math.abs(geo.lon)<=180;
    return {ip:data.target_ip,country:text(geo.country),city:text(geo.city),isp:text(geo.isp),asn:text(geo.asn),coordinates:validCoordinates?`${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`:'未知',map:validCoordinates?`https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=9/${geo.lat}/${geo.lon}`:null,score:score(summary.score),level:text(summary.level),proxy:flag(security.is_proxy),vpn:flag(security.vpn),tor:flag(security.tor),type:text(security.proxy_type),abuse:score(security.abuse_score),tags:Array.isArray(summary.tags)?summary.tags.filter(v=>typeof v==='string').slice(0,20).map(v=>v.slice(0,160)):[]};
  }
  function report(model) {
    const fields=[['国家 / 地区',model.country],['城市',model.city],['ISP 服务商',model.isp],['ASN',model.asn],['代理检测',model.proxy],['代理类型',model.type],['VPN',model.vpn],['Tor',model.tor],['滥用评分（接口值）',model.abuse===null?'未知':`${model.abuse} / 100`],['近似坐标',model.coordinates]];
    return `<div class="ip-overview"><div><span class="ip-eyebrow">查询结果</span><h2>${esc(model.ip)}</h2><p>${esc(model.country)} · ${esc(model.city)}</p></div><div class="ip-score"><strong>${model.score===null?'—':esc(model.score)}</strong><span>风险评分 / 100</span><small>接口等级：${esc(model.level)}</small></div></div><dl class="ip-grid">${fields.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${model.tags.length?`<div class="ip-tags"><span>接口标签</span>${model.tags.map(tag=>`<span class="ip-tag">${esc(tag)}</span>`).join('')}</div>`:''}${model.map?`<div class="ip-map-link"><a href="${esc(model.map)}" target="_blank" rel="noopener noreferrer">在地图上查看近似位置 ↗</a><span>点击后打开 OpenStreetMap，不自动加载地图</span></div>`:''}`;
  }
  async function query(endpoint,ip,fetcher=root.fetch,timeoutMs=15000) {
    if (ip && !isIP(ip)) throw Error('请输入有效的 IPv4 或 IPv6 地址，不支持域名、端口或网址。');
    const url=new URL(endpoint);
    if (url.protocol!=='https:') throw Error('查询接口必须使用 HTTPS。');
    if(ip)url.searchParams.set('ip',ip);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetcher(url.href,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw Error(response.status===429?'查询过于频繁，请稍后再试。':`查询接口暂不可用（HTTP ${response.status}）。`);
      const model=normalize(await response.json());
      if(ip) {
        const canonical=value=>value.includes(':')?new URL(`http://[${value}]/`).hostname:value;
        if(canonical(ip)!==canonical(model.ip))throw Error('接口返回的 IP 与查询目标不一致，未显示报告。');
      }
      return model;
    } catch(error) {
      if(error.name==='AbortError')throw Error('查询超时，请稍后重试。');
      if(error instanceof TypeError)throw Error('无法连接查询接口，请检查网络或跨域配置。');
      if(error instanceof SyntaxError)throw Error('接口未返回有效 JSON，未生成报告。');
      throw error;
    } finally {clearTimeout(timeout)}
  }
  const api={isIP,normalize,report,query};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!root.document)return;
  const $=id=>root.document.getElementById(id);
  let busy=false;
  async function run(self=false) {
    if(busy)return;
    const input=$('ip-input');
    const ip=self?'':input.value.trim();
    if(!self&&!isIP(ip)) {
      $('ip-result').hidden=true; $('ip-status').textContent='请输入有效的 IPv4 / IPv6，或点击“我的 IP”。';input.setAttribute('aria-invalid','true');input.focus();return;
    }
    input.removeAttribute('aria-invalid');
    busy=true;$('ip-submit').disabled=true;$('ip-self').disabled=true;input.disabled=true;
    $('ip-tool-area').setAttribute('aria-busy','true');$('ip-result').hidden=true;
    $('ip-status').textContent=self?'正在识别当前网络出口…':`正在查询 ${ip}…`;
    try {
      const tool=root.TOOLS_REGISTRY.find(tool=>tool.kind==='ip');
      const model=await query(tool.url,ip);
      if(self)input.value=model.ip;
      $('ip-result').innerHTML=report(model);$('ip-result').hidden=false;
      $('ip-status').textContent=`查询完成 · ${new Date().toLocaleTimeString('zh-CN',{hour12:false})} · 以下为接口返回结果`;
    } catch(error) { $('ip-status').textContent=error.message; }
    finally {busy=false;$('ip-submit').disabled=false;$('ip-self').disabled=false;input.disabled=false;$('ip-tool-area').setAttribute('aria-busy','false')}
  }
  $('ip-form').addEventListener('submit',event=>{event.preventDefault();run()});
  $('ip-self').addEventListener('click',()=>run(true));
})(typeof window==='undefined'?globalThis:window);
