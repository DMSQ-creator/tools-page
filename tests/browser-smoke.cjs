// Optional real-browser smoke test. Uses installed Chromium/Edge and Node 22+ only.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const profile=path.resolve('.browser-test',`profile-${Date.now()}`);
  fs.mkdirSync(profile,{recursive:true});
  const executable=process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let socket;
  let spawnError;
  browser.on('error',error=>{spawnError=error});
  try {
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100 && !fs.existsSync(portFile);i++){if(spawnError)throw spawnError;await wait(100)}
    const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
    const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
    let sequence=0; const pending=new Map(); const errors=[];
    socket.onmessage=event=>{
      const msg=JSON.parse(event.data);
      if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);
      if(msg.id && pending.has(msg.id)){const item=pending.get(msg.id);pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(msg.error):item.resolve(msg.result)}
    };
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
    const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
    await cdp('Runtime.enable');await cdp('Page.enable');
    await cdp('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
    let ready=false;
    for(let i=0;i<120;i++){ready=await evaluate('typeof window.switchTool === "function" && !!window.TOOLS_DATA');if(ready)break;await wait(250)}
    assert.ok(ready,'app must load within 30 seconds');
    const result=await evaluate(`(()=>{
      const $=id=>document.getElementById(id);
      const search=q=>{$('search').value=q;$('search').dispatchEvent(new Event('input'));return $('results').textContent};
      const initial=Number($('total').textContent);
      const us=search('US');
      switchTool('gdp');
      if ($('gdp-year').value !== 'latest' || /#\\d+/.test($('results').textContent)) throw Error('GDP must default to latest without ranks');
      $('gdp-year').value=String(TOOLS_DATA.gdp.defaultYear);$('gdp-year').dispatchEvent(new Event('change'));
      const gdpCount=Number($('total').textContent);
      const fullChina=Array.from($('results').children).find(row=>row.textContent.includes('中国')).textContent;
      const china=search('CHN');
      $('gdp-year').value='latest';$('gdp-year').dispatchEvent(new Event('change'));
      const latest=$('results').textContent;
      const latestNote=$('data-note').textContent;
      search('not-a-real-country');const empty=$('results').textContent;
      toggleTheme();const theme=document.documentElement.getAttribute('data-theme');
      switchTool('phone-code');
      return {initial,us,gdpCount,fullChina,china,latest,latestNote,empty,theme,controlsHidden:$('gdp-controls').hidden};
    })()`);
    assert.ok(result.initial>200); assert.match(result.us,/\+1/);assert.doesNotMatch(result.us,/\+1201/);
    assert.ok(result.gdpCount>150);assert.match(result.china,/#\d+/);assert.doesNotMatch(result.latest,/#\d+/);
    assert.match(result.latestNote,/不作同年排名/);assert.match(result.empty,/未找到/);assert.ok(result.controlsHidden);
    assert.equal(result.china,result.fullChina,'search must preserve the original rank');
    assert.equal(result.theme,'dark');
    assert.doesNotMatch(result.us,/俄罗斯/,'US search must resolve exactly');
    const footerOnly=await evaluate(`!!document.getElementById('data-meta').closest('footer') && !document.querySelector('main #data-meta')`);
    assert.ok(footerOnly,'source metadata must appear only in the footer');
    assert.equal(await evaluate('document.getElementById("search").value'),'US','tool query is remembered');
    await evaluate('document.getElementById("search-clear").click()');
    assert.equal(await evaluate('document.getElementById("total").textContent'),'250');
    await evaluate('document.getElementById("tool-search-open").click()');
    assert.equal(await evaluate('document.getElementById("tool-dialog").open'),true);
    await evaluate(`document.getElementById('tool-search').value='GDP';document.getElementById('tool-search').dispatchEvent(new Event('input'));document.querySelector('#tool-options a').click()`);
    assert.equal(await evaluate('document.getElementById("tool-title").textContent'),'人均 GDP');
    assert.equal(await evaluate('document.getElementById("tool-dialog").open'),false);
    assert.equal(await evaluate('location.hash'),'#/gdp');
    await evaluate('history.back()');
    for(let i=0;i<40;i++){if(await evaluate('document.getElementById("tool-title").textContent === "国家区号"'))break;await wait(50)}
    assert.equal(await evaluate('document.getElementById("tool-title").textContent'),'国家区号');
    await evaluate('history.forward()');
    for(let i=0;i<40;i++){if(await evaluate('document.getElementById("tool-title").textContent === "人均 GDP"'))break;await wait(50)}
    assert.equal(await evaluate('document.getElementById("tool-title").textContent'),'人均 GDP');
    await cdp('Page.reload');
    for(let i=0;i<40;i++){if(await evaluate('typeof window.switchTool === "function" && document.getElementById("tool-title").textContent === "人均 GDP"'))break;await wait(50)}
    assert.equal(await evaluate('document.getElementById("tool-title").textContent'),'人均 GDP','deep link survives reload');
    const mobileChecks=[];
    for (const width of [320,390]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      for (const tool of ['phone-code','gdp']) {
        await evaluate(`switchTool('${tool}')`);
        const overflow=await evaluate('document.documentElement.scrollWidth > window.innerWidth');
        assert.equal(overflow,false,`${tool} must not overflow at ${width}px`);
        mobileChecks.push({width,tool,overflow});
      }
    }
    await evaluate(`switchTool('gdp');document.getElementById('search-clear').click();document.documentElement.setAttribute('data-theme','light');window.scrollTo(0,0)`);
    async function screenshot(name) {
      const shot=await cdp('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.resolve('.browser-test',name),Buffer.from(shot.data,'base64'));
    }
    await screenshot('mobile.png');
    await evaluate('document.getElementById("tool-picker").click()');
    assert.equal(await evaluate('document.getElementById("tool-dialog").open'),true);
    await screenshot('mobile-picker.png');
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate('document.getElementById("tool-dialog").open'),false);
    await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await screenshot('desktop.png');
    await evaluate('document.getElementById("sidebar-toggle").click()');
    assert.equal(await evaluate('document.body.classList.contains("sidebar-collapsed")'),true);
    await evaluate('document.getElementById("sidebar-toggle").click();document.documentElement.setAttribute("data-theme","dark")');
    await screenshot('desktop-dark.png');
    await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:904,deviceScaleFactor:1,mobile:false});
    await evaluate(`switchTool('phone-code');document.getElementById('search-clear').click();document.documentElement.setAttribute('data-theme','light');window.scrollTo(0,0)`);
    const density=await evaluate(`(()=>{const rows=[...document.querySelectorAll('.result-row')];return {firstRowTop:rows[0].getBoundingClientRect().top,visibleRows:rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}).length,contentWidth:document.getElementById('data-tool-area').getBoundingClientRect().width}})()`);
    assert.ok(density.firstRowTop<180,'data should start near the top');
    assert.ok(density.visibleRows>=11,'at least eleven complete rows should fit');
    await screenshot('compact-desktop.png');
    await evaluate(`switchTool('gdp');document.getElementById('search-clear').click()`);
    await screenshot('compact-gdp.png');
    await evaluate(`switchTool('ip-risk')`);
    assert.equal(await evaluate('document.querySelectorAll("iframe").length'),0);
    assert.equal(await evaluate('document.getElementById("ip-result").hidden'),true,'no automatic lookup');
    await evaluate(`document.getElementById('ip-input').value='bad';document.getElementById('ip-form').requestSubmit()`);
    assert.match(await evaluate('document.getElementById("ip-status").textContent'),/有效/);
    if (process.env.LIVE_IP !== '1') await evaluate(`window.fetch=async()=>({ok:true,json:async()=>({target_ip:'1.1.1.1',summary:{score:0,level:'TEST',tags:['测试数据 · 非实时报告']},details:{geo:{country:'测试国家',city:'测试城市',lat:0,lon:0},security:{is_proxy:false}}})})`);
    await evaluate(`document.getElementById('ip-input').value='1.1.1.1';document.getElementById('ip-form').requestSubmit()`);
    for(let i=0;i<100;i++){if(await evaluate('!document.getElementById("ip-submit").disabled'))break;await wait(200)}
    const ipStatus=await evaluate('document.getElementById("ip-status").textContent');
    assert.match(ipStatus,/查询完成/,'live IP API browser request: '+ipStatus);
    assert.match(await evaluate('document.getElementById("ip-result").textContent'),/1\.1\.1\.1/);
    await screenshot('native-ip.png');
    for(const width of [320,390]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,'IP panel mobile overflow');
    }
    await screenshot('native-ip-mobile.png');
    await evaluate(`window.fetch=async()=>({ok:false,status:429});document.getElementById('ip-form').requestSubmit()`);
    for(let i=0;i<20;i++){if(await evaluate('!document.getElementById("ip-submit").disabled'))break;await wait(50)}
    assert.match(await evaluate('document.getElementById("ip-status").textContent'),/频繁/);
    assert.equal(await evaluate('document.getElementById("ip-result").hidden'),true,'stale results hidden on failure');
    await evaluate(`switchTool('local-time');document.getElementById('clock-search').value='美国';document.getElementById('clock-search').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate('document.querySelectorAll(".clock-card").length'),5);
    await evaluate(`document.getElementById('clock-origin').value='America/New_York';document.getElementById('clock-mode').value='fixed';document.getElementById('clock-date').value='2026-03-08T02:30';document.getElementById('clock-mode').dispatchEvent(new Event('change'))`);
    assert.match(await evaluate('document.getElementById("clock-status").textContent'),/不存在/);
    assert.equal(await evaluate('document.querySelectorAll(".clock-card").length'),0);
    await evaluate(`document.getElementById('clock-origin').value='Asia/Shanghai';document.getElementById('clock-search').value='';document.getElementById('clock-date').value='2026-07-15T21:00';document.getElementById('clock-date').dispatchEvent(new Event('input'))`);
    assert.match(await evaluate(`[...document.querySelectorAll('.clock-card')].find(c=>c.textContent.includes('纽约')).textContent`),/09:00/);
    for(const tool of ['local-time','utm-builder'])for(const width of [320,390]){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate(`switchTool('${tool}')`);
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false,`${tool} mobile overflow`);
    }
    await evaluate(`switchTool('utm-builder');document.getElementById('utm-url').value='https://example.com/products?sku=42#quote';document.getElementById('utm-source').value='google';document.getElementById('utm-medium').value='cpc';document.getElementById('utm-campaign').value='industrial-pumps';document.getElementById('utm-form').requestSubmit()`);
    const built=await evaluate('document.getElementById("utm-result").value');
    const parsed=new URL(built);assert.equal(parsed.searchParams.get('sku'),'42');assert.equal(parsed.searchParams.get('utm_campaign'),'industrial-pumps');assert.equal(parsed.hash,'#quote');
    await screenshot('utm-mobile.png');
    await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await screenshot('utm-desktop.png');
    await evaluate(`document.getElementById('utm-campaign').value='changed';document.getElementById('utm-campaign').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await evaluate('document.getElementById("utm-result-region").hidden'),true,'UTM stale output hidden');
    await evaluate(`switchTool('local-time');window.scrollTo(0,0)`);await screenshot('clock-desktop.png');
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('clock-mobile.png');
    console.log(process.env.LIVE_IP === '1' ? 'Live IP:' : 'Mock IP:',ipStatus);
    console.log('Compact density:',JSON.stringify(density));
    assert.deepEqual(errors,[],'no uncaught browser exceptions');
    console.log(JSON.stringify({browser:'Edge headless',...result,mobileChecks,uncaughtExceptions:errors},null,2));
    await cdp('Browser.close').catch(()=>{});
  } finally {if(socket)socket.close();browser.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
