/* Static snapshots: no visitor-side API requests, also works over file://. */
(function (root) {
  'use strict';
  const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function matches(record, query, phone = false) {
    const q = normalize(query);
    if (!q) return true;
    if ([record.i2, record.i3, record.wbCode].some(code => code && normalize(code) === q)) return true;
    if ([record.zh, record.en, ...(record.aliases || [])].some(name => normalize(name).includes(q))) return true;
    const digits = q.replace(/[\s()-]/g, '').replace(/^00/, '+');
    return phone && /^\+?\d+$/.test(digits) && [record.callingCode, ...(record.prefixes || [])].some(code => code && code.includes(digits));
  }
  function filterRecords(records, query, phone = false) {
    const q = normalize(query);
    const exact = q && records.filter(row => [row.i2, row.i3, row.wbCode].some(code => code && normalize(code) === q));
    return exact?.length ? exact : records.filter(row => matches(row, query, phone));
  }
  function gdpRows(records, period, query = '') {
    const latest = period === 'latest';
    const rows = records.map(record => {
      const years = Object.keys(record.values).filter(year => Number.isFinite(record.values[year]) && record.values[year] >= 0).sort((a,b) => Number(b)-Number(a));
      const year = latest ? years[0] : String(period);
      const value = record.values[year];
      return {...record, year: Number(year), value};
    }).filter(row => Number.isFinite(row.value) && row.value >= 0);
    rows.sort((a,b) => b.value-a.value || a.wbCode.localeCompare(b.wbCode));
    let rank = 0;
    const ranked = rows.map((row,index) => {
      if (index === 0 || row.value !== rows[index-1].value) rank = index+1;
      return {...row, rank: latest ? null : rank};
    });
    // Resolve exact country codes before filtering by data availability, so a missing
    // country/year cannot accidentally turn into a substring search for other places.
    const selected = new Set(filterRecords(records, query).map(row => row.wbCode));
    return ranked.filter(row => selected.has(row.wbCode));
  }
  const api = {normalize, escapeHTML, matches, filterRecords, gdpRows};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const document = root.document;
  const $ = id => document.getElementById(id);
  const media = root.matchMedia('(prefers-color-scheme: dark)');
  let savedTheme;
  try { savedTheme = root.localStorage.getItem('theme'); } catch (_) { /* Storage may be disabled. */ }
  if (!['dark','light'].includes(savedTheme)) savedTheme = null;
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme',theme);
    $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
  }
  root.toggleTheme = () => {
    savedTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { root.localStorage.setItem('theme',savedTheme); } catch (_) { /* Still apply in memory. */ }
    applyTheme(savedTheme);
  };
  applyTheme(savedTheme || (media.matches ? 'dark' : 'light'));
  media.addEventListener('change', e => { if (!savedTheme) applyTheme(e.matches ? 'dark' : 'light'); });
  const catalog = root.TOOLS_DATA;
  const tools = root.TOOLS_REGISTRY;
  let currentTool = null;
  const toolState = new Map();
  function sourceLink(source) {
    // Only allow HTTP(S) source links, even if a future upstream label contains markup.
    if (!/^https?:\/\//i.test(source.url || '')) return escapeHTML(source.name);
    return `<a class="underline" href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.name)}</a>`;
  }
  function identity(row) {
    return `<div class="country-cell">${row.rank ? `<span class="rank" title="所选年份已收录经济体排名">#${row.rank}</span>` : ''}<span class="flag" aria-hidden="true">${escapeHTML(row.f)}</span><div class="country-copy"><div class="country-name">${escapeHTML(row.zh)} <span class="country-code">${escapeHTML(row.i2)}</span></div><div class="country-en">${escapeHTML(row.en)}</div></div></div>`;
  }
  function note(row) {
    return row.note ? `<details class="row-note"><summary>数据说明</summary><p>${escapeHTML(row.note)}</p></details>` : '';
  }
  function render() {
    if (!catalog || catalog.schemaVersion !== 1) {
      $('results').textContent = '数据快照加载失败，请刷新页面；若仍失败，请检查 data/catalog.js 是否已部署。';
      $('total').textContent = '0';
      return;
    }
    const query = $('search').value;
    $('search-clear').hidden = !query;
    let rows;
    const kind = tools.find(tool => tool.id === currentTool)?.kind;
    if (kind === 'phone') {
      const phone = catalog.phone;
      rows = filterRecords(phone.records, query, true);
      $('data-meta').innerHTML = `快照更新：${escapeHTML(phone.updatedAt)} · 来源：${phone.sources.map(sourceLink).join(' / ')}`;
      $('data-note').textContent = '';
      $('data-note').hidden = true;
      $('coverage').textContent = '';
      $('results').innerHTML = rows.map(row => `<div class="result-row">${identity(row)}<div class="value-cell"><div class="value">${escapeHTML(row.callingCode || '—')}</div>${row.prefixes.some(prefix => prefix !== row.callingCode) ? `<div class="value-sub">${row.prefixes.map(escapeHTML).join(' / ')}</div>` : ''}</div>${note(row)}</div>`).join('');
    } else if (kind === 'gdp') {
      const gdp = catalog.gdp;
      const period = $('gdp-year').value;
      const all = gdpRows(gdp.records, period);
      rows = gdpRows(gdp.records, period, query);
      $('data-meta').innerHTML = `快照更新：${escapeHTML(gdp.updatedAt)}${gdp.sourceUpdatedAt ? ` · 数据源更新：${escapeHTML(gdp.sourceUpdatedAt)}` : ''} · 来源：${sourceLink(gdp.source)} · ${escapeHTML(gdp.source.indicator)}`;
      $('data-note').hidden = false;
      $('data-note').textContent = period === 'latest'
        ? '现价美元 · 各地年份不同，不作同年排名'
        : '现价美元 · 同年有值经济体排名 · 缺失不补零、不跨年补齐';
      $('coverage').textContent = ` · 当前口径有值 ${all.length} / ${gdp.records.length} 个经济体`;
      $('results').innerHTML = rows.map(row => `<div class="result-row">${identity(row)}<div class="value-cell"><div class="value">$${row.value.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="value-sub">${row.year} 年</div></div>${note(row)}</div>`).join('');
    } else return;
    $('total').textContent = String(rows.length);
    if (!rows.length) $('results').innerHTML = '<div class="empty-state">未找到匹配结果，或所选年份暂无数据。</div>';
  }
  function showTool(id) {
    const tool = tools.find(item => item.id === id);
    if (!tool) return;
    if (currentTool && currentTool !== id) toolState.set(currentTool, {query:$('search').value,year:$('gdp-year').value});
    const changed = currentTool !== id;
    currentTool = id;
    if (changed) root.scrollTo?.(0,0);
    document.querySelectorAll('[data-tool]').forEach(link => {
      const active = link.dataset.tool === id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    $('tool-title').textContent = tool.name;
    $('tool-description').textContent = tool.description;
    $('tool-picker').textContent = `${tool.icon}  ${tool.name}  ▾`;
    document.title = `${tool.name} · 在线工具箱`;
    const isIP = tool.kind === 'ip';
    const isData = ['phone','gdp'].includes(tool.kind);
    $('ip-form').hidden = !isIP;
    $('query-controls').hidden = !isData;
    $('data-tool-area').hidden = !isData;
    $('ip-tool-area').hidden = !isIP;
    $('clock-tool-area').hidden = tool.kind !== 'clock';
    $('utm-tool-area').hidden = tool.kind !== 'utm';
    if (isIP) {
      $('data-meta').innerHTML = `数据来源：${sourceLink({name:'本站 IP 查询接口 · Cloudflare',url:tool.url})} · 评分与标签由接口返回，非本站独立核验`;
    } else if (tool.kind === 'clock') {
      $('data-meta').textContent = '时间规则：浏览器 Intl / IANA 时区数据 · 以设备时钟为基准，请保持系统和浏览器更新 · 不包含节假日判断';
    } else if (tool.kind === 'utm') {
      $('data-meta').textContent = '链接在本地生成，不上传、不访问目标网址 · UTM 标记需由落地页、分析或表单系统采集才能归因';
    } else {
      const isGDP = tool.kind === 'gdp';
      $('gdp-controls').hidden = !isGDP;
      $('col3-header').textContent = isGDP ? '人均 GDP / 年份' : '呼叫码 / 地区前缀';
      $('search').placeholder = tool.placeholder;
      if (changed) {
        const state = toolState.get(id);
        $('search').value = state?.query || '';
        if (isGDP) $('gdp-year').value = state?.year || String(catalog?.gdp.defaultYear || '');
      }
      render();
    }
  }
  document.querySelector('.skip-link')?.addEventListener('click',event=>{
    event.preventDefault(); $('main-content').focus(); $('main-content').scrollIntoView();
  });
  function route() {
    const id = root.location.hash.replace(/^#\/?/, '');
    const valid = tools.some(tool => tool.id === id);
    if (!valid) root.history.replaceState(null,'',`#/${tools[0].id}`);
    showTool(valid ? id : tools[0].id);
  }
  root.switchTool = id => {
    if (!tools.some(tool => tool.id === id)) return;
    if (root.location.hash !== `#/${id}`) root.location.hash = `/${id}`;
    showTool(id);
  };
  $('tool-nav').innerHTML = tools.map(tool => `<a class="nav-item" data-tool="${escapeHTML(tool.id)}" href="#/${escapeHTML(tool.id)}" title="${escapeHTML(tool.name)}"><span class="nav-icon" aria-hidden="true">${escapeHTML(tool.icon)}</span><span class="nav-label">${escapeHTML(tool.name)}</span><span class="nav-arrow" aria-hidden="true">›</span></a>`).join('');
  function renderToolOptions() {
    const q = normalize($('tool-search').value);
    const found = tools.filter(tool => normalize(`${tool.name} ${tool.category} ${tool.keywords}`).includes(q));
    $('tool-options').innerHTML = found.map(tool => `<a class="tool-option" data-tool="${escapeHTML(tool.id)}" href="#/${escapeHTML(tool.id)}"><span class="nav-icon" aria-hidden="true">${escapeHTML(tool.icon)}</span><span><strong>${escapeHTML(tool.name)}</strong><small>${escapeHTML(tool.description)}</small></span><span class="nav-arrow" aria-hidden="true">↗</span></a>`).join('') || '<p class="empty-state">没有找到工具，试试其他关键词。</p>';
  }
  const dialog = $('tool-dialog');
  let dialogOpener;
  function openTools(event) {
    dialogOpener = event?.currentTarget;
    $('tool-search').value = '';
    renderToolOptions();
    dialog.showModal();
    $('tool-search').focus();
  }
  $('tool-picker').addEventListener('click',openTools);
  $('tool-search-open').addEventListener('click',openTools);
  $('dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>dialogOpener?.focus());
  dialog.addEventListener('click',event=>{ if (event.target === dialog) dialog.close(); });
  $('tool-search').addEventListener('input',renderToolOptions);
  $('tool-options').addEventListener('click',event=>{
    const link = event.target.closest('[data-tool]');
    if (link) { event.preventDefault(); root.switchTool(link.dataset.tool); dialog.close(); }
  });
  let collapsed = false;
  try { collapsed = root.localStorage.getItem('sidebar-collapsed') === 'true'; } catch (_) {}
  function applySidebar() {
    document.body.classList.toggle('sidebar-collapsed',collapsed);
    $('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));
    $('sidebar-toggle').setAttribute('aria-label',collapsed ? '展开工具导航' : '收起工具导航');
  }
  applySidebar();
  $('sidebar-toggle').addEventListener('click',()=>{
    collapsed = !collapsed; applySidebar();
    try { root.localStorage.setItem('sidebar-collapsed',String(collapsed)); } catch (_) {}
  });
  if (catalog?.schemaVersion === 1) {
    $('gdp-year').innerHTML = catalog.gdp.years.map(year => `<option value="${escapeHTML(year)}">${escapeHTML(year)} 年 · 同年排名</option>`).join('') + '<option value="latest">各地最新可用值（非同年）</option>';
    $('gdp-year').value = String(catalog.gdp.defaultYear);
  }
  $('gdp-year').addEventListener('change',render);
  $('search').addEventListener('input',render);
  $('search-clear').addEventListener('click',()=>{ $('search').value=''; render(); $('search').focus(); });
  root.addEventListener('hashchange',route);
  route();
})(typeof window === 'undefined' ? globalThis : window);
