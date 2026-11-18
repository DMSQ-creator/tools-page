const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {matches,filterRecords,gdpRows,escapeHTML} = require('../app.js');
const records = [
  {zh:'中国',en:'China',i2:'CN',i3:'CHN',wbCode:'CHN',values:{2023:100,2024:120}},
  {zh:'美国',en:'United States',i2:'US',i3:'USA',wbCode:'USA',values:{2023:200,2024:220}},
  {zh:'越南',en:'Vietnam',i2:'VN',i3:'VNM',wbCode:'VNM',values:{2023:50,2024:null}},
];
test('same-year ranks survive search and missing values are excluded', () => {
  assert.equal(gdpRows(records,2024,'CN')[0].rank,2);
  assert.equal(gdpRows(records,2024).length,2);
  assert.equal(gdpRows(records,2024,'VN').length,0);
  assert.equal(gdpRows(records,2023,'VN')[0].rank,3);
  assert.equal(gdpRows(records,2024,'does-not-exist').length,0);
  assert.deepEqual(records[0].values,{2023:100,2024:120});
});
test('latest values preserve actual year without rank', () => {
  const result = gdpRows(records,'latest','VN')[0];
  assert.equal(result.year,2023); assert.equal(result.value,50); assert.equal(result.rank,null);
});
test('ties share rank and zero is valid but null is not', () => {
  const tied = records.map(r => ({...r,values:{2024:1}}));
  assert.deepEqual(gdpRows(tied,2024).map(r=>r.rank),[1,1,1]);
  tied[0].values[2024]=0;
  assert.equal(gdpRows(tied,2024).at(-1).value,0);
});
test('search handles ISO codes, normalized text and all dialing prefixes', () => {
  assert.ok(matches(records[0],' ＣＮ '));
  assert.ok(matches(records[1],'united'));
  assert.ok(matches(records[2],'VNM'));
  const phone = {...records[0],callingCode:'+1',prefixes:['+1809','+1829','+1849']};
  assert.ok(matches(phone,'+1 (829)',true));
  assert.ok(matches(phone,'001849',true));
  assert.ok(!matches(phone,'---',true));
  assert.ok(!matches(phone,'+86',true));
});
test('exact ISO search takes precedence over country name substrings', () => {
  const data = [...records,{zh:'俄罗斯',en:'Russia',i2:'RU',i3:'RUS',wbCode:'RUS',values:{2023:90}}];
  assert.deepEqual(filterRecords(data,'US').map(r=>r.i2),['US']);
  assert.deepEqual(gdpRows(data,2024,'RUS'),[]);
  assert.equal(filterRecords(data,'united')[0].i2,'US');
});
test('external text is escaped before HTML rendering', () => {
  assert.equal(escapeHTML('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
});
function mockPage(catalog, blockedStorage=false) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'',textContent:'',innerHTML:'',style:{},attributes:{},dataset:{},hidden:false,
      classList:{toggle(){}},listeners:{},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},removeAttribute(k){delete this.attributes[k]},focus(){},showModal(){this.open=true},close(){this.open=false},
      addEventListener(k,v){this.listeners[k]=v}});
    return elements.get(id);
  };
  const document = {getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,documentElement:element('html'),body:element('body')};
  const window = {document,TOOLS_DATA:catalog,matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem(){if(blockedStorage)throw Error('blocked');return null},setItem(){if(blockedStorage)throw Error('blocked')}}};
  window.location={hash:''}; window.history={replaceState(a,b,hash){window.location.hash=hash}};
  window.listeners={};window.addEventListener=(key,handler)=>window.listeners[key]=handler;
  vm.runInNewContext(fs.readFileSync(require.resolve('../tools.js'),'utf8'),{window});
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),{window});
  return {window,element};
}
test('page initialization, switching, missing snapshot and disabled storage', () => {
  const catalog = {schemaVersion:1,phone:{updatedAt:'2026-11-17',sources:[],records:[{...records[0],callingCode:'+86',prefixes:[]}]},gdp:{updatedAt:'2026-11-17',source:{name:'WB',url:'https://data.worldbank.org',indicator:'NY.GDP.PCAP.CD'},years:[2024,2023],defaultYear:2024,records}};
  const {window,element} = mockPage(catalog,true);
  assert.equal(element('total').textContent,'1');
  window.switchTool('gdp');
  assert.equal(element('gdp-year').value,'latest');
  assert.equal(element('total').textContent,'3');
  assert.doesNotMatch(element('results').innerHTML,/#\d+/);
  element('gdp-year').value='2024'; element('gdp-year').listeners.change();
  assert.equal(element('total').textContent,'2');
  window.switchTool('phone-code'); window.switchTool('gdp');
  assert.equal(element('gdp-year').value,'2024','manual year survives tool switching');
  assert.equal(element('gdp-controls').hidden,false);
  element('search').value='CN'; element('search').listeners.input();
  assert.match(element('results').innerHTML,/#2/);
  element('gdp-year').value='latest'; element('gdp-year').listeners.change();
  assert.doesNotMatch(element('results').innerHTML,/#2/);
  window.switchTool('ip-risk');
  assert.equal(element('ip-form').hidden,false);
  assert.equal(element('query-controls').hidden,true);
  window.toggleTheme(); assert.equal(element('html').attributes['data-theme'],'dark');
  const missing=mockPage(undefined);
  assert.match(missing.element('results').textContent,/数据快照加载失败/);
});
test('checked-in snapshot parses and core searches work', () => {
  const path = require('node:path').join(__dirname,'../data/catalog.json');
  assert.ok(fs.existsSync(path),'generated snapshot must exist');
  const data = JSON.parse(fs.readFileSync(path,'utf8'));
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../data/catalog.js'),'utf8'),context);
  assert.equal(JSON.stringify(context.window.TOOLS_DATA),JSON.stringify(data));
  for (const [code,expected] of [['US','+1'],['RU','+7'],['KZ','+7']]) assert.equal(data.phone.records.find(r=>r.i2===code).callingCode,expected);
  for (const code of ['VN','CZ','PR','VI','SX','CW','ST','CG','SO']) assert.ok(data.gdp.records.find(r=>r.i2===code),'missing code '+code);
  assert.ok(gdpRows(data.gdp.records,data.gdp.defaultYear).length>150);
  const page=mockPage(data); page.window.switchTool('gdp');
  assert.ok(Number(page.element('total').textContent)>150);
});
