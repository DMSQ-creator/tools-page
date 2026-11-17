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
    const shot=await cdp('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.resolve('.browser-test/mobile.png'),Buffer.from(shot.data,'base64'));
    assert.deepEqual(errors,[],'no uncaught browser exceptions');
    console.log(JSON.stringify({browser:'Edge headless',...result,mobileChecks,uncaughtExceptions:errors},null,2));
    await cdp('Browser.close').catch(()=>{});
  } finally {if(socket)socket.close();browser.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
