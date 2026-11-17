'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildUTMUrl, init } = require('../utm.js');

const base = Object.freeze({ url: 'https://example.com/landing', source: 'google', medium: 'cpc', campaign: 'summer_launch' });
const build = (extra) => buildUTMUrl({ ...base, ...extra });

function invalid(extra, field = 'url') {
  assert.throws(() => build(extra), error => error.name === 'UTMValidationError' && error.field === field && !!error.message);
}

test('exports a pure builder and an optional DOM initializer', () => {
  assert.equal(typeof buildUTMUrl, 'function');
  assert.equal(typeof init, 'function');
  assert.equal(buildUTMUrl(base), 'https://example.com/landing?utm_source=google&utm_medium=cpc&utm_campaign=summer_launch');
  assert.deepEqual(base, { url: 'https://example.com/landing', source: 'google', medium: 'cpc', campaign: 'summer_launch' });
});

test('supports HTTP, uppercase schemes, ports, localhost and IPv6', () => {
  for (const url of ['http://example.com:8080/a', 'HTTPS://EXAMPLE.COM/a', 'http://localhost/a', 'https://[::1]:8443/a']) {
    assert.equal(new URL(build({ url })).searchParams.get('utm_source'), 'google');
  }
});

test('trims surrounding whitespace without lowercasing campaign values', () => {
  const url = new URL(build({ url: '  https://example.com/a  ', source: ' Google ', campaign: ' Summer Launch ', term: '  ' }));
  assert.equal(url.searchParams.get('utm_source'), 'Google');
  assert.equal(url.searchParams.get('utm_campaign'), 'Summer Launch');
  assert.equal(url.searchParams.has('utm_term'), false);
});

test('preserves unrelated query encoding, order, duplicates and hash', () => {
  const url = build({ url: 'https://example.com/p?q=a%20b&tag=x&tag=y&token=A%2fb%7e&empty=#section?x=1' });
  assert.ok(url.startsWith('https://example.com/p?q=a%20b&tag=x&tag=y&token=A%2fb%7e&empty=&utm_source='));
  assert.equal(new URL(url).hash, '#section?x=1');
  assert.deepEqual(new URL(url).searchParams.getAll('tag'), ['x', 'y']);
});

test('replaces all five standard parameters and removes duplicate encoded names', () => {
  const url = new URL(build({ url: 'https://example.com/?utm_source=old&%75tm_source=other&utm_medium=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e', term: 'new term', content: 'new content' }));
  for (const [key, value] of Object.entries({ source: 'google', medium: 'cpc', campaign: 'summer_launch', term: 'new term', content: 'new content' })) {
    assert.deepEqual(url.searchParams.getAll('utm_' + key), [value]);
  }
});

test('omitted and blank optional values delete old parameters', () => {
  for (const optional of [{}, { term: '', content: '  ' }, { term: null, content: undefined }]) {
    const url = new URL(build({ url: 'https://example.com/?utm_term=a&utm_term=b&utm_content=c', ...optional }));
    assert.equal(url.searchParams.has('utm_term'), false);
    assert.equal(url.searchParams.has('utm_content'), false);
  }
});

test('encodes unicode, emoji, plus, ampersands, percent and fragment characters as values', () => {
  const value = '夏日 🌞 + & ? = # / % " <script>';
  const url = new URL(build({ source: value, medium: value, campaign: value, term: value, content: value }));
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) assert.equal(url.searchParams.get('utm_' + key), value);
  assert.equal([...url.searchParams].length, 5);
  assert.equal(url.hash, '');
});

test('supports internationalized domain names and paths', () => {
  const url = new URL(build({ url: 'https://例子.测试/路径?搜索=中文#章节' }));
  assert.equal(url.hostname, 'xn--fsqu00a.xn--0zwm56d');
  assert.equal(decodeURIComponent(url.pathname), '/路径');
  assert.equal(url.searchParams.get('搜索'), '中文');
  assert.equal(decodeURIComponent(url.hash), '#章节');
});

test('second generation is byte-for-byte idempotent', () => {
  const first = build({ url: 'https://example.com/p?a=%20&b=~&utm_source=old#hash', term: 'a+b', content: '中文' });
  assert.equal(build({ url: first, term: 'a+b', content: '中文' }), first);
});

test('preserves case-sensitive nonstandard UTM names and unrelated utm keys', () => {
  const url = new URL(build({ url: 'https://example.com/?UTM_SOURCE=keep&utm_id=123&utm_source_extra=keep' }));
  assert.equal(url.searchParams.get('UTM_SOURCE'), 'keep');
  assert.equal(url.searchParams.get('utm_id'), '123');
  assert.equal(url.searchParams.get('utm_source_extra'), 'keep');
});

test('rejects absent input objects and non-text URL inputs', () => {
  for (const input of [null, undefined, [], 'https://example.com/']) assert.throws(() => buildUTMUrl(input), { name: 'UTMValidationError' });
  for (const url of [undefined, null, '', ' ', 42, new URL('https://example.com/')]) invalid({ url });
});

test('rejects relative URLs, protocol-relative URLs and non-HTTP protocols', () => {
  for (const url of ['/page', 'example.com', '//example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'ftp://example.com', 'mailto:a@example.com']) invalid({ url });
});

test('rejects missing hosts, invalid ports and browser-repaired URL forms', () => {
  for (const url of ['https://', 'https:///example.com', 'https:example.com', 'https://?a=1', 'http://#a', 'http://example.com:65536', 'http://[broken]/', 'https://exa mple.com', 'https://example.com/a b', 'https://example.com/\npath', 'https://example.com/\\path', 'https://example.com/%zz']) invalid({ url });
});

test('rejects user info including empty credentials', () => {
  for (const url of ['https://user:pass@example.com/', 'https://user@example.com/', 'https://:pass@example.com/', 'https://@example.com/', 'https://user%40mail@example.com/']) invalid({ url });
  assert.equal(new URL(build({ url: 'https://example.com/path@name?q=a@b' })).hostname, 'example.com');
});

test('requires source, medium and campaign individually', () => {
  for (const field of ['source', 'medium', 'campaign']) {
    for (const value of [undefined, null, '', '  ']) invalid({ [field]: value }, field);
  }
});

test('rejects non-text values rather than stringifying objects or arrays', () => {
  for (const field of ['source', 'medium', 'campaign', 'term', 'content']) {
    for (const value of [42, false, {}, ['value']]) invalid({ [field]: value }, field);
  }
});

test('rejects embedded control characters and lone surrogates in parameter values', () => {
  for (const field of ['source', 'medium', 'campaign', 'term', 'content']) {
    for (const value of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb', '\ud800']) invalid({ [field]: value }, field);
  }
});

test('does not interpret URL parameters as HTML or execute script values', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const result = build({ campaign: payload });
  assert.equal(result.includes('<img'), false);
  assert.equal(new URL(result).searchParams.get('utm_campaign'), payload);
});

test('classic-script browser export initializes without module loaders or network APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utm.js'), 'utf8');
  const context = { URL, URLSearchParams, document: { readyState: 'complete', getElementById: () => null } };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.UTMTool.buildUTMUrl, 'function');
  assert.equal(context.UTMTool.buildUTMUrl(base), buildUTMUrl(base));
});

function mount(clipboard) {
  const controls = new Map();
  function control(id) {
    if (!controls.has(id)) controls.set(id, {
      value: '', hidden: id === 'result-region', disabled: false, textContent: '',
      handlers: {}, attributes: {}, classList: { add() {}, remove() {} },
      addEventListener(event, callback) { this.handlers[event] = callback; },
      removeAttribute(name) { delete this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; }, select() { this.selected = true; },
      reset() { for (const field of ['url', 'source', 'medium', 'campaign', 'term', 'content']) control(field).value = ''; }
    });
    return controls.get(id);
  }
  const container = { dataset: {}, classList: { add() {} }, querySelector: id => control(id.slice(5)) };
  const doc = { getElementById: () => container, defaultView: { navigator: { clipboard } } };
  init(doc);
  for (const [key, value] of Object.entries(base)) control(key).value = value;
  const submit = () => control('form').handlers.submit({ preventDefault() {} });
  return { control, submit, container, doc };
}

test('UI mounts once, produces readonly result and invalidates stale output on input', () => {
  const { control, submit, container, doc } = mount();
  const markup = container.innerHTML;
  assert.match(markup, /id="utm-result"[^>]*readonly/);
  submit();
  assert.equal(control('result').value, buildUTMUrl(base));
  assert.equal(control('result-region').hidden, false);
  control('form').handlers.input();
  assert.equal(control('result').value, '');
  assert.equal(control('result-region').hidden, true);
  init(doc);
  assert.equal(container.innerHTML, markup);
});

test('UI exposes field errors and templates do not guess or replace campaign', () => {
  const { control, submit } = mount();
  control('campaign').value = '';
  submit();
  assert.equal(control('campaign').attributes['aria-invalid'], 'true');
  assert.equal(control('campaign').focused, true);
  assert.equal(control('result-region').hidden, true);
  control('template-google').handlers.click();
  assert.equal(control('campaign').value, '');
  control('campaign').value = 'chosen';
  control('template-email').handlers.click();
  assert.equal(control('campaign').value, 'chosen');
  assert.equal(control('source').value, 'newsletter');
  assert.equal(control('medium').value, 'email');
  assert.equal(control('campaign').attributes['aria-invalid'], undefined);
  control('reset').handlers.click();
  assert.equal(control('url').value, '');
  assert.equal(control('url').focused, true);
});

test('clipboard success is reported only after writeText resolves', async () => {
  let resolve;
  let written;
  const { control, submit } = mount({ writeText: value => { written = value; return new Promise(done => { resolve = done; }); } });
  submit();
  const pending = control('copy').handlers.click();
  assert.equal(written, buildUTMUrl(base));
  assert.equal(control('copy').disabled, true);
  assert.doesNotMatch(control('status').textContent, /已复制/);
  resolve();
  await pending;
  assert.equal(control('status').textContent, '链接已复制。');
  assert.equal(control('copy').disabled, false);
});

test('missing or rejected clipboard selects text and never claims success', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('permission denied'); } }]) {
    const { control, submit } = mount(clipboard);
    submit();
    await control('copy').handlers.click();
    assert.equal(control('result').selected, true);
    assert.match(control('status').textContent, /无法自动复制/);
    assert.doesNotMatch(control('status').textContent, /已复制/);
    assert.equal(control('copy').disabled, false);
  }
});

test('pending clipboard feedback cannot restore a stale result after editing', async () => {
  let resolve;
  const { control, submit } = mount({ writeText: () => new Promise(done => { resolve = done; }) });
  submit();
  const pending = control('copy').handlers.click();
  control('form').handlers.input();
  resolve();
  await pending;
  assert.equal(control('status').textContent, '');
  assert.equal(control('result-region').hidden, true);
});

test('defers automatic browser mount until DOMContentLoaded when necessary', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utm.js'), 'utf8');
  let mounted = 0;
  let ready;
  const context = { URL, URLSearchParams, document: {
    readyState: 'loading',
    getElementById: () => { mounted++; return null; },
    addEventListener: (event, callback, options) => { assert.equal(event, 'DOMContentLoaded'); assert.equal(options.once, true); ready = callback; }
  } };
  vm.runInNewContext(source, context);
  assert.equal(mounted, 0);
  ready();
  assert.equal(mounted, 1);
});
