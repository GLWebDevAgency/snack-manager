/** Temporary width receipt. Real compiled Next; repository fixtures intercepted in memory. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = '/Users/limameghassene/development/SnackManager-refonte-ui';
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright'), { build } = require('esbuild');
const base = 'http://127.0.0.1:3092', api = 'http://127.0.0.1:3094';
const out = join(root, 'docs/refonte-ui/captures/admin-full-width');
await mkdir(out, { recursive: true });
const buildId = (await readFile(join(root, 'apps/web/.next/BUILD_ID'), 'utf8')).trim();
const bundle = await build({ stdin: { contents: "export {routeDemo,resetDemoWorld,demoWorld} from './apps/web/src/lib/demo/router'; export {DeliverySettingsSchema} from './packages/contracts/dist/index.js';", resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const fixture = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const browser = await chromium.launch({ headless: true });
const repairComparators = process.env.WIDTH_COMPARATORS_ONLY === '1';
const initial = repairComparators ? JSON.parse(await readFile(join(out, 'initial-harness-attempt.json'), 'utf8')) : null;
assert.ok(!initial || initial.buildId === buildId);
const results = initial ? initial.results.filter(r=>r.pass) : [], startedAt = initial?.startedAt ?? new Date().toISOString();
const persist = () => writeFile(join(out, 'results.json'), JSON.stringify({ startedAt, updatedAt: new Date().toISOString(), buildId, base, api, browser: browser.version(), initialHarnessAttempt: initial ? 'initial-harness-attempt.json (four temporary selector errors: direct section child expected as div; same build, passing initial contexts retained)' : null, limits: 'Chromium sur Next compilé local ; fixtures du dépôt et mutations mémoire seulement. Aucun compte, API, paiement, base ou serveur externe. Pas de Safari matériel.', results }, null, 2));
const initialDelivery = { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [{ id: 'centre', name: 'Centre-ville', postalCodes: ['69001', '69002'], feeCents: 500, minimumOrderCents: 1500, freeDeliveryFromCents: null }] };
const cases = [...[320,768,1440,1920,2560].map(width => ({width, theme:'light'})), ...[390,1920].map(width => ({width,theme:'dark'}))];

async function scenario(surface, width, theme = 'light', noOnline = false) {
  fixture.resetDemoWorld();
  const record = { name: `${surface}-${width}-${theme}${noOnline?'-sans-online':''}`, surface, width, theme, noOnline, measurements: [], checks: [], shots: [], requests: [], blocked: [], unknown: [], errors: [] };
  let delivery = structuredClone(initialDelivery);
  const caps = noOnline ? ['bo','pos','planning','delivery'] : ['bo','pos','online','planning','delivery'];
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 900 : 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  await context.addInitScript(({theme,width}) => {
    localStorage.setItem('sm.backoffice.theme.v1',theme);
    localStorage.setItem('sm-bo-nav',width>=1280?'open':'closed');
    localStorage.setItem('sm.token.resto','fixture.'+btoa(JSON.stringify({sub:'u1',tenantId:'t1',kind:'user',role:'owner',exp:2200000000}))+'.fixture');
  },{theme,width});
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => record.errors.push(error.stack));
  await context.routeWebSocket('**/*', socket => { if(!['127.0.0.1','localhost'].includes(new URL(socket.url()).hostname))record.blocked.push(socket.url());socket.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), u = new URL(request.url()), method = request.method();
    if(u.origin===base && method==='GET') return route.continue();
    if(u.origin!==api) { record.blocked.push({method,url:u.origin+u.pathname});return route.abort(); }
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':base,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,POST,OPTIONS','cache-control':'no-store'},body:JSON.stringify(body)});
    if(method==='OPTIONS')return json({});
    if(u.pathname.startsWith('/socket.io'))return json({message:'Realtime disabled in local recipe'},503);
    record.requests.push({method,path:u.pathname});
    if(method==='GET' && u.pathname==='/tenants/me')return json({...fixture.demoWorld().tenant,capacites:caps});
    if(method==='GET' && u.pathname==='/dining/room')return json({tables:[{id:'10000000-0000-4000-8000-000000000001',label:'Terrasse 1',seats:4,active:true,revision:0}],sessions:[]});
    if(method==='GET' && u.pathname==='/medias')return json({medias:[],quota:{octetsUtilises:0,octetsMax:268435456,medias:0}});
    if(method==='GET' && u.pathname==='/audit')return json({entries:[{_id:'audit-local',at:'2026-09-13T10:00:00.000Z',actionLabel:'Identité modifiée',action:'tenant.identity',meta:{},actor:{}}]});
    if(method==='GET' && u.pathname==='/delivery/settings')return json(delivery);
    if(method==='GET' && u.pathname==='/delivery/operators')return json({operators:[],candidates:[],truncated:false,nextCursor:null});
    if(method==='PATCH' && u.pathname==='/delivery/settings'){delivery=fixture.DeliverySettingsSchema.parse(request.postDataJSON());return json(delivery);}
    const response=fixture.routeDemo(method,u.pathname+u.search,request.postData()?request.postDataJSON():undefined);
    if(response.status>=400)record.unknown.push({method,path:u.pathname,status:response.status});
    return json(response.body,response.status);
  });
  const main=page.getByRole('main');
  const card = (heading,scope=main) => scope.locator('.rounded-panel').filter({has:page.getByRole('heading',{name:heading,exact:true})}).first();
  async function widthMatches(locator,label) {
    await locator.waitFor();
    const measured = await locator.evaluate(el=>{
      const r=el.getBoundingClientRect(),m=document.querySelector('main'),b=m.getBoundingClientRect();
      const pad=innerWidth>=768?26:16;
      return {left:r.left,right:r.right,width:r.width,mainLeft:b.left,mainRight:b.right,padding:pad,targetLeft:b.left+pad,targetRight:b.left+m.clientWidth-pad};
    });
    record.measurements.push({label,...measured});
    assert.ok(Math.abs(measured.left-measured.targetLeft)<=1.5 && Math.abs(measured.right-measured.targetRight)<=1.5,`${label} must fill main minus ${measured.padding}px: ${JSON.stringify(measured)}`);
  }
  async function geometry() {
    const d = await main.evaluate(el=>({main:el.clientWidth,scroll:el.scrollWidth,viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    assert.ok(d.scroll<=d.main+1 && d.html<=d.viewport+1 && d.body<=d.viewport+1,`overflow: ${JSON.stringify(d)}`);
    const tabs=await main.getByRole('tab').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,clip:n.scrollWidth>n.clientWidth+1};}));
    assert.ok(tabs.every(t=>t.w>=44&&t.h>=44&&!t.clip),JSON.stringify(tabs));
  }
  async function shot(suffix) {
    await main.evaluate(el=>el.scrollTop=0);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await geometry();
    const file=`${record.name}-${suffix}.png`;await page.screenshot({path:join(out,file)});record.shots.push(file);
  }
  async function select(label) {
    await main.getByRole('tab',{name:label,exact:true}).click();
    const panel=main.getByRole('tabpanel',{name:label,exact:true});await panel.waitFor();
    await widthMatches(panel,`${label} tabpanel`);
    assert.equal(new URL(page.url()).searchParams.get('source'),'full-width');
    return panel;
  }
  async function zoneLayout(count) {
    const zones=main.getByRole('tabpanel',{name:'Zones et tarifs',exact:true}).locator('fieldset').filter({has:page.getByLabel('Nom de la zone',{exact:true})});
    assert.equal(await zones.count(),count);
    const d = await zones.evaluateAll(nodes=>{
      const grid=nodes[0].parentElement,b=grid.getBoundingClientRect();
      return {grid:{left:b.left,right:b.right,width:b.width},columns:getComputedStyle(grid).gridTemplateColumns,items:nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width};})};
    });
    record.measurements.push({label:`${count} delivery zones`,...d});
    const firstRow=d.items.filter(n=>Math.abs(n.top-d.items[0].top)<2);
    assert.ok(Math.abs(firstRow[0].left-d.grid.left)<=1 && Math.abs(firstRow.at(-1).right-d.grid.right)<=1,`Zone rows must fill available width: ${JSON.stringify(d)}`);
    assert.ok(d.items.every(n=>n.left>=d.grid.left-1 && n.right<=d.grid.right+1));
    if(count===1)assert.ok(Math.abs(d.items[0].width-d.grid.width)<=1);
    if(width>=1920 && count>1)assert.equal(firstRow.length,count,'Large desktop zones should share one row');
    for(const zone of await zones.all()){
      await zone.getByRole('button',{name:'Retirer cette zone',exact:true}).scrollIntoViewIfNeeded();
      await zone.getByRole('button',{name:'Retirer cette zone',exact:true}).waitFor();
    }
  }
  try {
    await page.goto(`${base}/admin/${surface}?source=full-width`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator(`.sm-backoffice[data-sm-theme="${theme}"]`).waitFor();
    if(surface==='settings') {
      await page.getByLabel("Nom de l'enseigne",{exact:true}).fill('Largeur · brouillon enseigne');
      await select('Mon compte');await page.getByLabel('Votre nom',{exact:true}).fill('Camille · brouillon');
      await select('Enseigne');assert.equal(await page.getByLabel("Nom de l'enseigne",{exact:true}).inputValue(),'Largeur · brouillon enseigne');
      await page.goBack();await page.getByLabel('Votre nom',{exact:true}).waitFor();assert.equal(await page.getByLabel('Votre nom',{exact:true}).inputValue(),'Camille · brouillon');
      await page.goForward();await page.getByLabel("Nom de l'enseigne",{exact:true}).waitFor();
      record.checks.push('Two independent drafts survive tabs and browser back/forward without writes');
      for(const label of ['Enseigne','Salle','Identité visuelle','Mon compte','Journal']) {
        const panel=await select(label);
        if(label==='Enseigne'){await widthMatches(card("L'identité de l'enseigne",panel),'Identity card');await widthMatches(card("Ce qui ne s'édite pas ici",panel),'Identity information card');}
        if(label==='Salle'){await page.getByRole('article',{name:'Table Terrasse 1',exact:true}).waitFor();await widthMatches(page.getByRole('region',{name:'Configuration de la salle',exact:true}),'Dining room');}
        if(label==='Mon compte')await widthMatches(card('Votre compte',panel),'Account card');
        if(label==='Journal')await widthMatches(card('Journal des gestes sensibles',panel),'Audit card');
        if(label==='Identité visuelle') {
          const save=page.getByRole('button',{name:"Enregistrer l'identité visuelle",exact:true});
          const bar=save.locator('xpath=../..');await widthMatches(bar,'Brand save bar');
          await widthMatches(bar.locator('xpath=..'),'Brand editor');
          const brandGrid=bar.locator('xpath=..').locator(':scope > div').filter({has:page.getByRole('heading',{name:'Votre vitrine',exact:true})}).first();
          await widthMatches(brandGrid,'Brand grid including preview');
        }
        await shot(label.toLowerCase().replaceAll(' ','-'));
      }
      assert.equal(record.requests.filter(r=>r.method!=='GET').length,0);
    } else if(surface==='livraison') {
      await page.getByLabel('Nom de la zone',{exact:true}).waitFor();
      const save=page.getByRole('button',{name:'Enregistrer et publier',exact:true});
      for(const label of ['Zones et tarifs','Capacité et ouverture','Livreurs']){
        const panel=await select(label);
        if(label==='Zones et tarifs'){
          await widthMatches(card('Zones de livraison',panel),'Delivery zones card');await zoneLayout(1);
          await page.getByLabel('Nom de la zone',{exact:true}).fill('Zone de recette conservée');
        } else if(label==='Capacité et ouverture') {
          await widthMatches(panel.locator(':scope > div').first(),'Capacity grid');
          await page.getByLabel('Délai minimum avant livraison (min)',{exact:true}).fill('60');
        } else { await page.getByRole('button',{name:'Ajouter un livreur',exact:true}).waitFor();await widthMatches(card('Vos livreurs',panel),'Drivers card'); }
        await widthMatches(save.locator('xpath=../..'),'Delivery publication bar');await shot(label.toLowerCase().replaceAll(' ','-'));
      }
      await page.goBack();await page.getByLabel('Délai minimum avant livraison (min)',{exact:true}).waitFor();assert.equal(await page.getByLabel('Délai minimum avant livraison (min)',{exact:true}).inputValue(),'60');
      await page.goForward();await page.getByRole('button',{name:'Ajouter un livreur',exact:true}).waitFor();
      await select('Zones et tarifs');assert.equal(await page.getByLabel('Nom de la zone',{exact:true}).inputValue(),'Zone de recette conservée');
      record.checks.push('Delivery draft survives three sections and browser back/forward; publication bar full width in every section');
      await save.click();await page.getByText('Vos réglages sont à jour',{exact:true}).waitFor();assert.equal(delivery.leadTimeMin,60);assert.equal(delivery.zones[0].name,'Zone de recette conservée');
      record.checks.push('Original publication handler sends both hidden capacity and zone changes to schema-validated in-memory PATCH');
      for(const count of [2,3]){
        await page.getByRole('button',{name:'Ajouter',exact:true}).click();await zoneLayout(count);await shot(`${count}-zones`);
      }
    } else if(surface==='encaissement') {
      await page.getByRole('heading',{name:'Non raccordé',exact:true}).waitFor();
      const cards=main.locator('.rounded-panel');assert.equal(await cards.count(),2);
      for(let i=0;i<2;i++)await widthMatches(cards.nth(i),`Payment card ${i+1}`);
      assert.equal(record.requests.filter(r=>r.path==='/encaissement/me/raccordement').length,0);
      await shot('cards');
    } else if(surface==='site'&&noOnline) {
      await page.getByRole('textbox',{name:'Adresse du site vitrine (facultative)'}).waitFor();
      await widthMatches(main.locator('.rounded-panel').first(),'Website without online capability');await shot('vitrine');
    } else {
      const labels=surface==='site'?['Commande en ligne','Adresses']:['Vos écrans','Installation et services'];
      for(const label of labels){const panel=await select(label);await widthMatches(panel.locator(':scope > :is(div,section):visible').first(),`${label} content`);await shot(label.toLowerCase().replaceAll(' ','-'));}
    }
    await geometry();assert.deepEqual(record.errors,[]);assert.deepEqual(record.blocked,[]);assert.deepEqual(record.unknown,[]);
    record.checks.push('Exact main-content left/right alignment; no horizontal overflow; named tabs meet 44px targets');record.pass=true;console.log(`PASS ${record.name}`);
  } catch(error){record.pass=false;record.failure=error.stack;await shot('failure').catch(()=>{});console.error(`FAIL ${record.name}: ${error}`);}
  finally {results.push(record);await context.close();await persist();}
}
try {
  if(!repairComparators)for(const surface of ['settings','livraison'])for(const c of cases)await scenario(surface,c.width,c.theme);
  for(const surface of (repairComparators?['site','screens']:['encaissement','site','screens']))for(const width of [320,1920])await scenario(surface,width);
  if(!repairComparators)for(const width of [320,1920])await scenario('site',width,'light',true);
} finally {await browser.close();await persist();}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,shots:results.reduce((n,r)=>n+r.shots.length,0),out,buildId}));
if(results.some(r=>!r.pass))process.exitCode=1;
