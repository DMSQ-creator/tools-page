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
  let currentTool = 'phone-code';
  function sourceLink(source) {
    // Only allow HTTP(S) source links, even if a future upstream label contains markup.
    if (!/^https?:\/\//i.test(source.url || '')) return escapeHTML(source.name);
    return `<a class="underline" href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.name)}</a>`;
  }
  function identity(row) {
    return `<div class="country-cell">${row.rank ? `<span class="text-muted text-xs font-bold" title="所选年份已收录经济体排名">#${row.rank}</span>` : ''}<span class="text-xl">${escapeHTML(row.f)}</span><span class="font-bold text-sm">${escapeHTML(row.zh)}</span><span class="text-muted text-xs">${escapeHTML(row.i2)}</span></div>`;
  }
  const rowClass = 'result-row gap-4 px-4 py-3 rounded-xl items-center border-b border-black/5';
  function render() {
    if (!catalog || catalog.schemaVersion !== 1) {
      $('results').textContent = '数据快照加载失败，请刷新页面；若仍失败，请检查 data/catalog.js 是否已部署。';
      $('total').textContent = '0';
      return;
    }
    const query = $('search').value;
    let rows;
    if (currentTool === 'phone-code') {
      const phone = catalog.phone;
      rows = filterRecords(phone.records, query, true);
      $('data-meta').innerHTML = `快照更新：${escapeHTML(phone.updatedAt)} · 来源：${phone.sources.map(sourceLink).join(' / ')}`;
      $('data-note').textContent = '';
      $('data-note').hidden = true;
      $('coverage').textContent = '';
      $('results').innerHTML = rows.map(row => `<div class="${rowClass}">${identity(row)}<div><div class="accent-indigo font-mono font-bold text-lg">${escapeHTML(row.callingCode || '—')}</div>${row.prefixes.some(prefix => prefix !== row.callingCode) ? `<div class="text-xs text-soft">拨号前缀：${row.prefixes.map(escapeHTML).join(' / ')}</div>` : ''}</div><div class="english-cell text-soft text-sm">${escapeHTML(row.en)}${row.note ? `<div class="text-xs mt-1">${escapeHTML(row.note)}</div>` : ''}</div></div>`).join('');
    } else if (currentTool === 'gdp') {
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
      $('results').innerHTML = rows.map(row => `<div class="${rowClass}">${identity(row)}<div><div class="accent-green font-mono font-bold">$${row.value.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="text-xs text-soft">${row.year} 年</div></div><div class="english-cell text-soft text-sm">${escapeHTML(row.en)}${row.note ? `<div class="text-xs mt-1">${escapeHTML(row.note)}</div>` : ''}</div></div>`).join('');
    } else return;
    $('total').textContent = String(rows.length);
    if (!rows.length) $('results').textContent = '未找到匹配结果，或所选年份暂无数据。';
  }
  root.switchTool = tool => {
    if (!['phone-code','gdp','ip-risk'].includes(tool)) return;
    currentTool = tool;
    document.querySelectorAll('[data-tool]').forEach(button => {
      const active = button.dataset.tool === tool;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    const isIP = tool === 'ip-risk';
    $('data-tool-area').style.display = isIP ? 'none' : 'block';
    $('ip-tool-area').style.display = isIP ? 'block' : 'none';
    if (isIP) {
      $('data-meta').innerHTML = `服务来源：${sourceLink({name:'第三方 IP 风控查询',url:'https://cipda.pages.dev/'})} · 数据由第三方提供`;
      if (!$('ip-iframe').getAttribute('src')) $('ip-iframe').src = 'https://cipda.pages.dev/';
      return;
    }
    const isGDP = tool === 'gdp';
    $('gdp-controls').hidden = !isGDP;
    $('tool-title').textContent = isGDP ? '💰 人均 GDP 查询' : '📞 国家区号查询';
    $('col3-header').textContent = isGDP ? '人均 GDP / 年份' : '国家呼叫码 / 地区前缀';
    $('search').placeholder = isGDP ? '输入国家名、英文名或简码(US/USA)…' : '输入国家名、英文名、区号或简码(CN/CHN)…';
    $('search').value = '';
    render();
  };
  if (catalog?.schemaVersion === 1) {
    $('gdp-year').innerHTML = catalog.gdp.years.map(year => `<option value="${escapeHTML(year)}">${escapeHTML(year)} 年 · 同年排名</option>`).join('') + '<option value="latest">各地最新可用值（非同年）</option>';
    $('gdp-year').value = String(catalog.gdp.defaultYear);
  }
  $('gdp-year').addEventListener('change',render);
  $('search').addEventListener('input',render);
  root.switchTool('phone-code');
})(typeof window === 'undefined' ? globalThis : window);
