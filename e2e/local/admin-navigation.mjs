/** Actual compiled restaurant back-office. In-memory repository fixtures only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.ADMIN_NAV_URL ?? 'http://127.0.0.1:3092').origin;
const apiOrigin = 'http://127.0.0.1:3094';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out = join(root, 'docs/refonte-ui/captures/navigation-admin');
await mkdir(out, { recursive: true });
const bundle = await build({ stdin: { contents: "export {routeDemo,resetDemoWorld,demoWorld} from './apps/web/src/lib/demo/router';", resolveDir: root, loader:'ts' }, bundle:true, write:false, format:'esm', platform:'node' });
const fixture = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const browser = await chromium.launch({ headless: true });
const results = [];
const pages = {
  settings: ['Enseigne','Salle','Identité visuelle','Mon compte','Journal'],
  team: ['Membres','Pointages'],
  stats: ['Ventes','Service','Exports'],
  planning: ['Planning','Charge et bilan'],
};
async function scenario(routeName, width, theme = 'light', zoom = 1) {
  fixture.resetDemoWorld();
  const record = { route:routeName,width,theme,zoom,shots:[],checks:[],requests:[],errors:[],blocked:[] };
  const context = await browser.newContext({ viewport:{width,height:width===844?390:920}, reducedMotion:'reduce',serviceWorkers:'block' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror',error=>record.errors.push(error.stack));
  await context.addInitScript(({theme})=>{
    localStorage.setItem('sm.backoffice.theme.v1',theme);
    localStorage.setItem('sm-bo-nav','closed');
    localStorage.setItem('sm.token.resto','fixture.'+btoa(JSON.stringify({sub:'u1',tenantId:'t1',kind:'user',role:'owner',exp:2200000000}))+'.fixture');
  },{theme});
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url());
    if(u.origin===base)return r.continue();
    if(u.origin!==apiOrigin){record.blocked.push(u.origin+u.pathname);return r.abort();}
    if(u.pathname.startsWith('/socket.io'))return r.fulfill({status:200,body:'0{"sid":"local-qa","upgrades":[],"pingInterval":600000,"pingTimeout":600000}'});
    const json=(body,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':base,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,POST,OPTIONS'},body:JSON.stringify(body)});
    if(q.method()==='OPTIONS')return json({});
    record.requests.push([q.method(),u.pathname]);
    if(u.pathname==='/dining/room')return json({tables:[{id:'10000000-0000-4000-8000-000000000001',label:'Terrasse 1',seats:4,active:true,revision:0}],sessions:[]});
    if(u.pathname==='/medias')return json({medias:[],quota:{octetsUtilises:0,octetsMax:268435456,medias:0}});
    if(u.pathname==='/tenants/me' && q.method()==='GET')return json({...fixture.demoWorld().tenant,capacites:['bo','pos','online','planning','delivery']});
    if(u.pathname==='/audit')return json({entries:[{_id:'audit-local',at:new Date().toISOString(),actionLabel:'Identité modifiée',action:'tenant.identity',meta:{},actor:{}}]});
    const response=fixture.routeDemo(q.method(),u.pathname+u.search,q.postData()?JSON.parse(q.postData()):undefined);
    return json(u.pathname==='/tenants/me/identity' && response.status===200 ? {...response.body,capacites:['bo','pos','online','planning','delivery']} : response.body,response.status);
  });
  try {
    await page.goto(base+'/admin/'+routeName+(routeName==='settings'?'?source=recette':'?demo=1&source=recette'),{waitUntil:'domcontentloaded'});
    const tabs=page.getByRole('tablist',{name:routeName==='settings'?'Rubriques de l’établissement':routeName==='team'?'Rubriques de l’équipe':routeName==='stats'?'Rubriques des statistiques':'Rubriques du planning'});
    await tabs.waitFor();
    if(zoom!==1)await page.locator('html').evaluate((el,scale)=>el.style.zoom=String(scale),zoom);
    if(routeName==='settings'){
      await page.getByLabel("Nom de l'enseigne",{exact:true}).fill('Le Comptoir · brouillon');
      await tabs.getByRole('tab',{name:'Mon compte',exact:true}).click();
      await page.getByLabel('Votre nom',{exact:true}).fill('Camille · brouillon');
      await tabs.getByRole('tab',{name:'Enseigne',exact:true}).click();
      assert.equal(await page.getByLabel("Nom de l'enseigne",{exact:true}).inputValue(),'Le Comptoir · brouillon');
      await page.goBack();
      await page.getByLabel('Votre nom',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Votre nom',{exact:true}).inputValue(),'Camille · brouillon');
      await page.goForward();
      await page.getByLabel("Nom de l'enseigne",{exact:true}).waitFor();
      await page.getByRole('tabpanel',{name:'Enseigne',exact:true}).getByRole('button',{name:'Enregistrer',exact:true}).click();
      await page.getByText('Rien à enregistrer.',{exact:true}).first().waitFor();
      assert.ok(record.requests.some(([method,path])=>method==='PATCH'&&path==='/tenants/me/identity'));
      record.checks.push('independent drafts survive tabs/back/forward; identity PATCH from original handler');
    }
    for(const label of pages[routeName]){
      await tabs.getByRole('tab',{name:label,exact:true}).click();
      await page.getByRole('tabpanel',{name:label,exact:true}).waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const dims=await tabs.getByRole('tab').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,clip:n.scrollWidth>n.clientWidth+1})));
      assert.ok(dims.every(d=>d.w>=44&&d.h>=44&&!d.clip),JSON.stringify(dims));
      const overflow=await page.locator('main').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
      assert.ok(overflow.scroll<=overflow.client+1,JSON.stringify(overflow));
      assert.equal(new URL(page.url()).searchParams.get('source'),'recette');
      const id=await tabs.getByRole('tab',{selected:true}).getAttribute('aria-controls');
      assert.equal(id,await page.getByRole('tabpanel',{name:label,exact:true}).getAttribute('id'));
      const name=`${routeName}-${width}-${theme}-zoom${zoom}-${pages[routeName].indexOf(label)}.png`;
      await page.screenshot({path:join(out,name)});record.shots.push(name);
    }
    record.checks.push('all panels visible by named tab; 44px targets; main has no horizontal overflow; other query preserved');
    assert.deepEqual(record.errors,[]); assert.deepEqual(record.blocked,[]);
    record.passed=true;
  }catch(error){record.failure=error.stack;await page.screenshot({path:join(out,`${routeName}-${width}-${theme}-failure.png`)}).catch(()=>{});}
  finally{results.push(record);await context.close();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));}
}
try {
  for(const route of (process.env.NAV_ROUTES?.split(',')??Object.keys(pages)))for(const width of (process.env.NAV_WIDTHS?.split(',').map(Number)??[320,390,768,1024,1440]))await scenario(route,width);
  if(!process.env.NAV_ROUTES)for(const route of Object.keys(pages))await scenario(route,390,'dark');
  if(!process.env.NAV_ROUTES)await scenario('settings',844); // landscape phone
  if(!process.env.NAV_ROUTES)await scenario('settings',1280,'light',2); // 200% layout zoom
  assert.ok(results.every(r=>r.passed),results.filter(r=>!r.passed).map(r=>`${r.route}/${r.width}: ${r.failure}`).join('\n'));
  console.log(`${results.length}/${results.length} compiled-page scenarios passed; ${results.reduce((n,r)=>n+r.shots.length,0)} captures`);
}finally{await browser.close();}
