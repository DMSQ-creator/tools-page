const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isIP,normalize,report,query}=require('../ip.js');
const fixture={target_ip:'1.1.1.1',summary:{score:0,level:'SAFE',tags:['被举报265次']},details:{geo:{country:'Australia',lat:0,lon:0},security:{is_proxy:false,abuse_score:0}}};
test('strict IPv4 and IPv6 validation',()=>{
 for(const ip of ['1.1.1.1','255.255.255.255','::1','2001:4860:4860::8888','::ffff:192.0.2.1'])assert.ok(isIP(ip),ip);
 for(const ip of ['','256.1.1.1','01.2.3.4','https://1.1.1.1','1.1.1.1:80','example.com',':::','fe80::1%eth0','1.2.3.4&x=1'])assert.equal(isIP(ip),false,ip);
});
test('missing and invalid values never become safe or zero',()=>{
 const m=normalize({target_ip:'::1',details:{}});assert.equal(m.score,null);assert.equal(m.abuse,null);assert.equal(m.proxy,'未知');assert.equal(m.coordinates,'未知');assert.equal(m.map,null);
 const valid=normalize(fixture);assert.equal(valid.score,0);assert.equal(valid.proxy,'未检出');assert.match(valid.map,/mlat=0&mlon=0/);assert.equal(valid.abuse,0);
 assert.throws(()=>normalize({error:'bad'}));
});
test('render escapes source strings and excludes backend configuration',()=>{
 const data=structuredClone(fixture);data.summary.tags=['<img onerror=alert(1)>'];data.details.geo.isp='<script>x</script>';data.config={map_key:'SECRET'};
 const html=report(normalize(data));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;img/);assert.ok(!html.includes('SECRET'));assert.ok(!html.includes('信用良好'));
});
test('request handles success, rate limits, invalid JSON and mismatch',async()=>{
 let request;const fetcher=async(url,options)=>{request={url,options};return {ok:true,json:async()=>fixture}};
 const m=await query('https://example.test/','1.1.1.1',fetcher);assert.equal(m.ip,'1.1.1.1');assert.match(request.url,/ip=1.1.1.1/);assert.equal(request.options.credentials,'omit');
 await assert.rejects(query('https://example.test/','bad',fetcher),/有效/);
 await assert.rejects(query('https://example.test/','1.1.1.1',async()=>({ok:false,status:429})),/频繁/);
 await assert.rejects(query('https://example.test/','1.1.1.1',async()=>({ok:true,json:async()=>{throw new SyntaxError()}})),/JSON/);
 await assert.rejects(query('https://example.test/','8.8.8.8',fetcher),/不一致/);
 await query('https://example.test/','',fetcher);assert.ok(!request.url.includes('ip='));
});
test('bounded timeout and network failures are visible',async()=>{
 await assert.rejects(query('https://example.test/','',async()=>{throw new TypeError('network')}),/网络/);
 await assert.rejects(query('https://example.test/','',(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))),5),/超时/);
});
