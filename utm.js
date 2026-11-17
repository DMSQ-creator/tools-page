(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UTMTool = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.init(document); }, { once: true });
    else api.init(document);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var fields = ['source', 'medium', 'campaign', 'term', 'content'];
  var labels = { source: '来源', medium: '媒介', campaign: '活动名称', term: '关键词', content: '内容标识' };

  function invalid(message, field) {
    var error = new Error(message);
    error.name = 'UTMValidationError';
    error.field = field;
    return error;
  }

  /** Pure, offline builder. Required fields: url, source, medium, campaign.
   * Existing unrelated query components keep their original encoding and order.
   * UTM names are case-sensitive; optional blank values remove existing values.
   */
  function buildUTMUrl(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('请填写链接与活动参数。', 'url');
    if (typeof input.url !== 'string' || !input.url.trim()) throw invalid('请输入完整的 HTTP 或 HTTPS 链接。', 'url');
    var raw = input.url.trim();
    if (!/^https?:\/\/[^/\\?#]/i.test(raw)) throw invalid('只支持以 http:// 或 https:// 开头的完整链接。', 'url');
    // Reject browser URL-parser repairs which could silently change the destination.
    if (/[\u0000-\u0020\u007f\\]/.test(raw) || /%(?![\da-f]{2})/i.test(raw)) {
      throw invalid('链接含空白、反斜杠或无效转义；请使用正确编码的完整链接。', 'url');
    }
    var url;
    try { url = new URL(raw); } catch (_) { throw invalid('链接格式无效，请检查域名和端口。', 'url'); }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw invalid('只支持 HTTP 或 HTTPS 链接。', 'url');
    var authority = raw.slice(raw.indexOf('//') + 2).split(/[/?#]/)[0];
    if (url.username || url.password || authority.indexOf('@') !== -1) throw invalid('请移除链接中的用户名或密码。', 'url');

    var values = {};
    fields.forEach(function (field, index) {
      var value = input[field];
      if (value == null) value = '';
      if (typeof value !== 'string') throw invalid(labels[field] + '必须为文本。', field);
      value = value.trim();
      if (index < 3 && !value) throw invalid('请填写' + labels[field] + '（本工具必填）。', field);
      if (/[\u0000-\u001f\u007f]/.test(value)) throw invalid(labels[field] + '不能包含换行或控制字符。', field);
      // URLSearchParams replaces unpaired UTF-16 surrogates. Reject instead of silently losing data.
      try { encodeURIComponent(value); } catch (_) { throw invalid(labels[field] + '包含无效字符。', field); }
      values[field] = value;
    });

    var retained = url.search ? url.search.slice(1).split('&').filter(function (part) {
      var key = new URLSearchParams(part).keys().next().value;
      return fields.every(function (field) { return key !== 'utm_' + field; });
    }) : [];
    var tracking = new URLSearchParams();
    fields.forEach(function (field) { if (values[field]) tracking.append('utm_' + field, values[field]); });
    retained.push(tracking.toString());
    url.search = '?' + retained.join('&');
    return url.href;
  }

  function init(doc) {
    var container = doc.getElementById('utm-tool-area');
    if (!container || container.dataset.utmReady === 'true') return;
    container.dataset.utmReady = 'true';
    container.classList.add('utm-panel');
    container.innerHTML = '<form id="utm-form" class="utm-form" novalidate>' +
      '<p class="utm-intro">为营销链接添加 UTM 参数，区分流量来源。仅在本地生成，不访问目标网站。</p>' +
      '<div class="utm-templates" role="group" aria-label="来源与媒介模板"><span>快速填写</span>' +
      '<button type="button" id="utm-template-google" class="utm-button utm-template">Google Ads</button>' +
      '<button type="button" id="utm-template-email" class="utm-button utm-template">邮件</button>' +
      '<button type="button" id="utm-template-linkedin" class="utm-button utm-template">LinkedIn 贴文</button></div>' +
      '<p class="utm-hint">模板仅填写来源和媒介，活动名称请自行填写。带 * 的字段为本工具必填项。</p>' +
      '<div class="utm-grid"><div class="utm-field utm-wide"><label for="utm-url">目标链接 *</label>' +
      '<input id="utm-url" name="url" type="url" required placeholder="https://example.com/page" autocomplete="off" spellcheck="false" aria-describedby="utm-url-help">' +
      '<small id="utm-url-help">支持 HTTP / HTTPS；保留其他查询参数与 # 锚点，替换已有的五个标准 UTM 参数。</small></div>' +
      fields.map(function (field, index) {
        var examples = { source: 'google / newsletter', medium: 'cpc / email', campaign: 'summer_launch', term: '可选：投放关键词', content: '可选：banner_a' };
        return '<div class="utm-field"><label for="utm-' + field + '">' + labels[field] + (index < 3 ? ' *' : '（可选）') +
          ' <span>utm_' + field + '</span></label><input id="utm-' + field + '" name="' + field + '" type="text"' +
          (index < 3 ? ' required' : '') + ' placeholder="' + examples[field] + '" autocomplete="off" spellcheck="false"></div>';
      }).join('') + '</div>' +
      '<p class="utm-privacy" id="utm-privacy">不要填写姓名、邮箱、手机号等个人信息。参数会出现在链接中；目标网站的分析系统需支持并接收 UTM 才能统计。签名链接可能因新增参数失效。</p>' +
      '<div class="utm-actions"><button id="utm-generate" class="utm-button utm-primary" type="submit">生成链接</button>' +
      '<button id="utm-reset" class="utm-button" type="button">清空</button></div></form>' +
      '<div id="utm-result-region" class="utm-result-region" hidden><label for="utm-result">生成结果</label>' +
      '<textarea id="utm-result" class="utm-result" rows="4" readonly spellcheck="false" aria-describedby="utm-status"></textarea>' +
      '<button id="utm-copy" type="button" class="utm-button utm-primary">复制链接</button></div>' +
      '<p id="utm-status" class="utm-status" role="status" aria-live="polite" aria-atomic="true"></p>';

    function el(id) { return container.querySelector('#utm-' + id); }
    var form = el('form');
    var region = el('result-region');
    var result = el('result');
    var status = el('status');
    var copy = el('copy');
    var version = 0;
    function clearErrors() {
      ['url'].concat(fields).forEach(function (field) { el(field).removeAttribute('aria-invalid'); });
      status.classList.remove('utm-error');
    }
    function invalidate() {
      version += 1;
      region.hidden = true;
      result.value = '';
      status.textContent = '';
      clearErrors();
    }
    form.addEventListener('input', invalidate);
    form.addEventListener('change', invalidate);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      invalidate();
      var input = { url: el('url').value };
      fields.forEach(function (field) { input[field] = el(field).value; });
      try {
        result.value = buildUTMUrl(input);
        region.hidden = false;
        status.textContent = '链接已生成，可复制或在结果框中手动选择。';
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('utm-error');
        var control = el(error.field || 'url');
        control.setAttribute('aria-invalid', 'true');
        control.focus();
      }
    });
    el('reset').addEventListener('click', function () { form.reset(); invalidate(); el('url').focus(); });
    [
      ['google', 'google', 'cpc'],
      ['email', 'newsletter', 'email'],
      ['linkedin', 'linkedin', 'social']
    ].forEach(function (template) {
      el('template-' + template[0]).addEventListener('click', function () {
        invalidate();
        el('source').value = template[1];
        el('medium').value = template[2];
        status.textContent = '已填写来源和媒介，请确认活动名称。';
        el('campaign').focus();
      });
    });
    copy.addEventListener('click', async function () {
      if (region.hidden || !result.value || copy.disabled) return;
      var currentVersion = version;
      var text = result.value;
      copy.disabled = true;
      try {
        var nav = doc.defaultView && doc.defaultView.navigator;
        if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
        await nav.clipboard.writeText(text);
        if (currentVersion === version) status.textContent = '链接已复制。';
      } catch (_) {
        if (currentVersion === version) {
          result.focus();
          result.select();
          status.textContent = '无法自动复制，已选中链接；请按 Ctrl+C / ⌘C，或长按后选择复制。';
        }
      } finally { copy.disabled = false; }
    });
  }

  return { buildUTMUrl: buildUTMUrl, init: init };
}));
