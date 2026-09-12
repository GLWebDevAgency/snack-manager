/** Shared production icon renderers only; loopback fixture, all external traffic denied. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=process.cwd(), out=resolve(root,'docs/refonte-ui/captures/icones-v2');
await mkdir(out,{recursive:true});
const bundle=await build({stdin:{sourcefile:'icons-fixture.tsx',resolveDir:root,loader:'tsx',contents:`
import React from 'react';import{createRoot}from'react-dom/client';
import{Icon as WebIcon}from'./apps/web/src/components/ui/icons';
import{Icon as NativeIcon}from'./packages/ui-native/src/Icon';
import{iconNames,legacyIconAliases,shapes,resolveIconName}from'./design/refonte-swiftui/packages/icons/index.mjs';
const names=[...Object.keys(legacyIconAliases),...iconNames];
function App(){const[dark,setDark]=React.useState(false);window.setFixtureTheme=setDark;
return <main style={{color:dark?'#f5f7f2':'#252723',background:dark?'#111310':'#f5f5f3'}}>
<h1>Composants applicatifs · React / react-native-svg · {dark?'sombre':'clair'}</h1>
<div className="grid">{names.map(name=><article key={name} data-key={name}>
<b>{name}</b><small>{resolveIconName(name)}</small><div className="icons">
<span data-renderer="web"><WebIcon name={name} size={28} stroke={2.25}/></span>
<span data-renderer="native"><NativeIcon name={name} size={28} strokeWidth={2.25} color={dark?'#f5f7f2':'#252723'}/></span>
<span data-renderer="source"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.25" dangerouslySetInnerHTML={{__html:shapes[resolveIconName(name)]}}/></span>
</div></article>)}</div></main>}
createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.mjs','.json'],mainFields:['browser','module','main'],alias:{react:resolve(root,'node_modules/react'),'react-dom':resolve(root,'node_modules/react-dom'),'react-native':resolve(root,'node_modules/react-native-web/dist/index.js'),'react-native-svg':resolve(root,'node_modules/react-native-svg/src/index.ts')},define:{'process.env.NODE_ENV':'"production"','__DEV__':'false'}});
const javascript=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(javascript);}else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><style>body{margin:0;font:13px system-ui}main{padding:24px}h1{margin:0 0 24px;font-size:22px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:8px}article{padding:12px;border:1px solid #7775;border-radius:12px}b,small{display:block}small{opacity:.7;margin:4px 0 12px}.icons{display:flex;justify-content:space-between}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');}else res.writeHead(204).end();});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch();
try{const context=await browser.newContext({viewport:{width:1440,height:1900},serviceWorkers:'block'});const faults=[];
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const page=await context.newPage();page.on('pageerror',e=>faults.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))faults.push(m.text())});await page.goto(base);await page.locator('article').last().waitFor();
const results=[];
for(const dark of [false,true]){await page.evaluate(dark=>window.setFixtureTheme(dark),dark);await page.waitForFunction(dark=>document.querySelector('h1').textContent.includes(dark?'sombre':'clair'),dark);
 const metrics=await page.locator('article').evaluateAll(articles=>articles.map(article=>{const nodes=renderer=>article.querySelector('[data-renderer="'+renderer+'"] svg');const shape=svg=>Array.from(svg.querySelectorAll('path,rect,circle')).map(el=>Object.fromEntries(Array.from(el.attributes).filter(a=>['d','x','y','width','height','rx','cx','cy','r'].includes(a.name)).map(a=>[a.name,a.value])));return{key:article.dataset.key,web:shape(nodes('web')),native:shape(nodes('native')),source:shape(nodes('source')),webColor:getComputedStyle(nodes('web')).stroke,nativeColor:getComputedStyle(nodes('native')).stroke,width:nodes('native').getBoundingClientRect().width,stroke:nodes('native').getAttribute('stroke-width')}}));
 for(const m of metrics){assert.deepEqual(m.web,m.source,m.key+' web');assert.deepEqual(m.native,m.source,m.key+' native');assert.equal(m.width,28);assert.equal(m.stroke,'2.25');assert.equal(m.webColor,m.nativeColor,m.key+' currentColor');}
 await page.screenshot({path:resolve(out,`renderers-${dark?'sombre':'clair'}.png`),fullPage:true});results.push({theme:dark?'sombre':'clair',count:metrics.length,pass:true});}
assert.deepEqual(faults,[]);await writeFile(resolve(out,'resultats.json'),JSON.stringify({base,results,faults,nativeLimit:'react-native-svg rendered through react-native-web; no iOS/Android device screenshot'},null,2));console.log(JSON.stringify(results));await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
