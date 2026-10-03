import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const css = readFileSync('src/index.css', 'utf8')

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{
    --bg-000:220 20% 98%;--bg-100:220 20% 96%;--bg-200:220 16% 93%;--bg-300:220 12% 88%;
    --text-100:220 20% 15%;--text-300:220 10% 55%;--text-500:220 8% 70%;
    --border-200:220 12% 80%;--accent-main-000:24 80% 45%;--accent-main-100:24 85% 52%;
    --accent-main-200:24 85% 58%;--oncolor-100:0 0% 100%;
  }
  *{box-sizing:border-box;} body{margin:0;background:hsl(var(--bg-000));height:100vh;color:hsl(var(--text-100));font:14px system-ui;overflow:hidden;}
  .scroll{position:absolute;inset:0;overflow:auto;padding-bottom:240px;}
  .msg{max-width:760px;margin:0 auto 14px;padding:12px 16px;background:hsl(var(--bg-200));border-radius:8px;}
  .dock{position:fixed;left:0;right:0;bottom:36px;display:flex;justify-content:center;}
  .col{position:relative;width:820px;}
  .glass{background-color:hsl(var(--bg-000));border-color:hsl(var(--border-200)/.6);}
  .exp{padding:0;}
  ${css}
  /* 简化真实内容，便于对比 */
  .real-toolbar{display:flex;align-items:center;justify-content:space-between;padding:0 14px 12px 12px;}
  .real-toolbar .l{display:flex;gap:8px;}
  .chip{height:32px;padding:0 12px;border-radius:8px;background:hsl(var(--bg-200));display:flex;align-items:center;font-size:13px;}
  .ta{height:52px;margin:14px 16px 2px;background:transparent;}
  .pill-content{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:6px;color:hsl(var(--text-300));transition:opacity .2s ease;}
  </style></head><body>
  <div class="scroll" id="scroll"></div>
  <div class="dock"><div class="col" id="col">
    <div class="relative">
      <div class="chat-fab-anchor" data-collapsed="false">
        <button class="chat-fab" data-collapsed="false" data-mode="send" aria-label="Send message">
          <span class="chat-fab-icon icon-scroll">↓</span>
          <span class="chat-fab-icon icon-send">➤</span>
          <span class="chat-fab-icon icon-stop">■</span>
        </button>
      </div>
      <div class="glass rounded-2xl" data-input-box id="box" style="position:relative;overflow:hidden;border:1px solid hsl(var(--border-200)/.6);border-radius:16px;">
        <div class="pill-content" id="pill" style="opacity:0">↑ 回复</div>
        <div class="exp" id="exp">
          <div class="ta"></div>
          <div class="real-toolbar" id="tb"><div class="l"><div class="chip">Build</div><div class="chip">deepseek-v4.1-flash</div><div class="chip">High</div></div><div></div></div>
        </div>
      </div>
    </div>
  </div></div>
<script>
  const scroll=document.getElementById('scroll'); for(let i=0;i<200;i++){const d=document.createElement('div');d.className='msg';d.textContent='msg '+i+' '+'lorem ipsum '.repeat(10);scroll.appendChild(d);}
  const box=document.getElementById('box'),fab=document.querySelector('.chat-fab'),anchor=document.querySelector('.chat-fab-anchor'),pill=document.getElementById('pill');
  box.style.height=(exp.offsetHeight+2)+'px';
  const EXP=box.offsetHeight;
  window.__expand=()=>{box.removeAttribute('data-collapsed');box.removeAttribute('data-morphing');box.style.height=EXP+'px';fab.dataset.collapsed='false';fab.dataset.mode='send';anchor.dataset.collapsed='false';pill.style.opacity='0';};
  window.__collapse=()=>{box.dataset.morphing='';box.setAttribute('data-collapsed','');box.style.height='36px';fab.dataset.collapsed='true';fab.dataset.mode='scroll';anchor.dataset.collapsed='true';pill.style.opacity='1';setTimeout(()=>box.removeAttribute('data-morphing'),560);};
  window.__geom=()=>{const b=box.getBoundingClientRect(),f=fab.getBoundingClientRect();return{boxTop:+b.top.toFixed(1),boxBottom:+b.bottom.toFixed(1),boxH:+b.height.toFixed(1),fabTop:+f.top.toFixed(1),fabBottom:+f.bottom.toFixed(1),fabH:+f.height.toFixed(1),fabVisible:!!(f.width>0),fabZ:getComputedStyle(fab).zIndex,anchorZ:getComputedStyle(anchor).zIndex};};
</script></body></html>`
}
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(page())})
await new Promise(r=>server.listen(0,r)); const port=server.address().port
const browser=await chromium.launch(); const p=await browser.newPage({viewport:{width:1000,height:760},deviceScaleFactor:2})
await p.goto(`http://localhost:${port}/`); await p.waitForTimeout(400)
const out=join(tmpdir(),'opencode','fab'); 
await p.evaluate(()=>window.__expand()); await p.waitForTimeout(300)
console.log('expanded  :', JSON.stringify(await p.evaluate(()=>window.__geom())))
await p.screenshot({path:join(out,'expanded.png'),clip:{x:60,y:520,width:880,height:220}})
await p.evaluate(()=>window.__collapse()); await p.waitForTimeout(700)
console.log('collapsed :', JSON.stringify(await p.evaluate(()=>window.__geom())))
await p.screenshot({path:join(out,'collapsed.png'),clip:{x:300,y:560,width:400,height:120}})
console.log('shots ->', out)
await browser.close(); server.close()
