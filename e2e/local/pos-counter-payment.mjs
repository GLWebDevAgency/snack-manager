/**
 * Real POS UI, entirely local request fixtures. No API server, real order,
 * Stripe payment, SMS, service worker, or remote write is permitted.
 * Start Expo with EXPO_PUBLIC_API_URL=http://localhost:3001 and
 * EXPO_PUBLIC_ALLOW_LOCAL_API=1, then run node e2e/local/pos-counter-payment.mjs.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = new URL(process.env.POS_COUNTER_WEB_URL ?? 'http://localhost:8084').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local POS only: never run against staging or production');
const artifactDir = await mkdtemp(join(tmpdir(), 'sm-pos-counter-'));
console.log(`Artifacts: ${artifactDir}`);
const tenant = { slug: 'qa-collect', name: 'Classfood QA', brandColor: '#dec99c', logoUrl: null };
const device = { id: 'qa-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Caisse QA' };
const product = { _id: 'be821c69-b71e-4c31-9389-6d360da15097', name: 'Boisson QA', price: 250, variants: [], optionGroups: [], supplements: [], removables: [], active: true, outOfStock: false, medias: [] };
const menu = { categories: [{ _id: 'cat', name: 'Boissons', products: [product] }] };
const initialOrder = () => ({ _id: 'a1fb4cb2-a0c0-4d8c-af05-e9e12a8bc545', clientId: '3b22cfb9-9cca-44cd-bdd1-ec70a88d09d0', number: 42, type: 'pickup', channel: 'online', status: 'ready', createdAt: new Date(Date.now()-18*86400000).toISOString(), payment: { method: 'counter', status: 'pending', tender: null }, pickup: { slot: new Date().toISOString(), customerName: 'Client QA', customerPhone: null }, totals: { subtotal: 1250, total: 1250 }, lines: [{ productId: product._id, name: 'Menu QA', qty: 1, unitPrice: 1250, lineTotal: 1250, options: [], removed: [] }], statusHistory: [], trackingToken: 'local-qa-only' });
const browser = await chromium.launch({ headless: true });
let results = [];
async function scenario(name, viewport, flow, opts={}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  let row = initialOrder(), requests = [], errors = [], posts = [], patch = [], mode = opts.mode ?? 'ok', omitFromLists = false;
  if (opts.delivery) row.type = 'delivery';
  if (opts.delivery) row.payment.status = 'paid';
  if (opts.online) row.payment.method = 'online';
  if (opts.journal) row.createdAt = new Date(Date.now()-86_400_000).toISOString();
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(({ tenant, device, role, journal, row }) => {
    if (localStorage.getItem('qa-seeded')) return;
    localStorage.setItem('qa-seeded', '1');
    localStorage.setItem('sm.pos.device.v1', JSON.stringify({ deviceToken: 'local-fake-device', tenant, device }));
    localStorage.setItem('sm.pos.session.v1', JSON.stringify({ token: 'local-fake-staff', staffName: 'Équipier QA', staffRole: role, tenantName: tenant.name, tenantSlug: tenant.slug, brandColor: tenant.brandColor, at: Date.now() }));
    if (journal) {
      const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      localStorage.setItem('sm.pos.daylog.v1',JSON.stringify({day,entries:[{clientId:row.clientId,serverId:row._id,serverNumber:42,localNumber:1,trackingToken:'local-ticket-token',mode:'tel',method:'retrait',paid:false,total:1250,items:1,at:Date.parse(row.createdAt)}]}));
    }
  }, { tenant, device, role: opts.role ?? 'caisse', journal:opts.journal, row });
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'http://localhost:3001') return route.abort();
    const path = url.pathname, method = req.method(); requests.push([method,path]);
    const json = (body, status=200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    if (path.includes('/socket.io')) return json({ message: 'Socket fixture disabled' }, 400);
    if (path.endsWith('/heartbeat')) return json({ tenant, device });
    if (path.endsWith('/menu')) return json(menu);
    if (path === '/orders/count') return json({ total: row.status === 'ready' ? 1 : 0 });
    if (path === '/orders' && method === 'GET') {
      if (omitFromLists) return json(url.searchParams.has('status') ? { rows: [], total: 0, truncated: false } : {
        rows: Array.from({length:200},(_,index)=>({...row,_id:`recent-${index}`,clientId:`recent-client-${index}`,number:1000+index,createdAt:new Date().toISOString(),status:'delivered'})), total:201,truncated:true,
      });
      return json({ rows: (!url.searchParams.has('status') || row.status === url.searchParams.get('status')) ? [row] : [], total: (!url.searchParams.has('status') || row.status === url.searchParams.get('status')) ? 1 : 0, truncated: false });
    }
    if (path === `/orders/by-client/${row.clientId}` && method === 'GET') {
      if (mode === 'lookup-missing') return json({message:'Commande introuvable'},404);
      return json(row);
    }
    if (path === `/orders/${row._id}` && method === 'GET') return json(row);
    if (path === `/orders/${row._id}/collect`) {
      const body = req.postDataJSON(); posts.push(body);
      if (mode === 'drop') return route.abort('failed');
      if (mode === 'silent') return;
      if (mode === 'rejected') { row.totals={ subtotal:1500,total:1500 }; mode='ok'; return json({code:'ORDER_COLLECTION_REJECTED',message:'Le montant a changé, vérifiez avant de confirmer.'},409); }
      if (mode === 'elsewhere') { row.payment={method:'counter',status:'paid',tender:'card'}; return json({code:'ORDER_COLLECTION_ALREADY_COLLECTED',message:'Déjà encaissée depuis une autre opération.'},409); }
      if (mode === 'conflict') return json({code:'ORDER_COLLECTION_OPERATION_CONFLICT',message:'Référence incompatible. Faites vérifier cette commande.'},409);
      await new Promise((r)=>setTimeout(r,350));
      row.payment={method:'counter',status:'paid',tender:body.tender,cashReceived:body.tender==='cash'?body.cashReceivedCents:null,changeGiven:body.tender==='cash'?body.cashReceivedCents-row.totals.total:null};
      if (mode === 'audit-pending') return json({code:'ORDER_COLLECTION_RECONCILIATION_REQUIRED',message:'Vérification en cours. Reprenez la même référence.'},503);
      return json(row);
    }
    if (path === `/orders/${row._id}/status`) { patch.push(req.postDataJSON()); assert.equal(row.payment.status,'paid'); row.status='delivered';return json(row); }
    if (path === '/orders' && method === 'POST') throw new Error('Forbidden new order POST in collection QA');
    return json({ message: `Unhandled local fixture ${method} ${path}` },404);
  });
  const tools = { page, context, requests, posts, patch, get row(){return row;}, setMode(value){mode=value;}, hideFromRecentLists(){omitFromLists=true;row.status='delivered';}, async open() {
    await page.goto(base); await page.getByRole('button', {name:/Boisson QA,/}).waitFor({timeout:90000});
  }, async service() {
    const buttons=await page.getByRole('button').allTextContents();
    const service = page.getByRole('tab',{name:/Le service/}).first();
    if (await service.count()) await service.click(); else { console.log('BUTTONS', buttons); throw new Error('Service button missing'); }
    await page.getByRole('button',{name:/42.*Client QA/}).click();
  }, async collect() { await page.getByRole('button',{name:'Encaisser la commande 42',exact:true}).click(); await page.getByRole('button',{name:'Compte juste',exact:true}).waitFor(); }, async paid() { await page.getByRole('button',{name:'Retour à la commande',exact:true}).waitFor(); }, async shot() { await page.screenshot({path:join(artifactDir, `${name}.png`),fullPage:true}); }};
  try { await flow(tools); assert.deepEqual(errors,[]); assert.equal(requests.filter(([m,p])=>m==='POST'&&p==='/orders').length,0); results.push({name,posts:posts.length,pass:true}); }
  catch(e){await tools.shot();console.log(await page.locator('body').innerText());throw e;}
  finally { await context.close(); }
}
try {
 await scenario('cash-desktop',{width:1440,height:1000},async t=>{
   await t.open(); await t.page.getByRole('button',{name:/Boisson QA,/}).click();
   await t.page.getByRole('button',{name:/Ajouter/}).click();
   await t.service(); await t.collect(); await t.page.getByRole('button',{name:'+ 20,00 €',exact:true}).click();
   await t.shot(); await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click(); await t.paid();
   assert.equal(t.posts.length,1); assert.equal(t.posts[0].cashReceivedCents,2000); assert.equal(t.row.status,'ready');
   assert.match(await t.page.getByRole('dialog',{name:'Encaisser la commande 42',exact:true}).innerText(),/À rendre · 7,50 €/);
   await t.page.getByRole('button',{name:'Retour à la commande',exact:true}).click();
   await t.page.getByRole('button',{name:'Confirmer la remise au client de la commande 42',exact:true}).click();
   await t.page.getByRole('dialog',{name:'Commande 42',exact:true}).waitFor({state:'hidden'});
   assert.deepEqual(t.patch,[{status:'delivered'}]);
   await t.page.getByRole('tab',{name:'Vendre',exact:true}).click();
   await t.page.getByRole('button',{name:'Modifier Boisson QA',exact:true}).waitFor();
   assert.match(await t.page.locator('body').innerText(),/Sous-total · 1 article/);
 });
 for (const [name,viewport,tender] of [['card-mobile',{width:390,height:844},'card'],['voucher-tablet',{width:820,height:1180},'meal_voucher']]) {
   await scenario(name,viewport,async t=>{
     await t.open(); await t.service(); await t.collect();
     await t.page.getByRole('radio',{name:tender==='card'?'Carte · TPE':'Titre-restaurant',exact:true}).click();
     const confirm=t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/});
     assert.equal(await confirm.isDisabled(),true);
     await t.page.getByRole('checkbox',{name:tender==='card'?'Confirmer le paiement accepté sur le TPE':'Confirmer le titre-restaurant accepté',exact:true}).click();
     await t.shot(); await confirm.focus(); await t.page.keyboard.press('Enter');
     await t.page.keyboard.press('Enter'); await t.page.keyboard.press('Escape');
     await t.paid(); assert.equal(t.posts.length,1); assert.equal(t.posts[0].tender,tender); assert.equal('cashReceivedCents' in t.posts[0],false);
   });
 }
 await scenario('lost-response-reload',{width:1440,height:1000},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();
   await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).waitFor();
   const first=t.posts[0]; assert.ok(first.operationId); await t.page.keyboard.press('Escape');
   assert.equal(await t.page.getByRole('dialog',{name:'Encaisser la commande 42',exact:true}).count(),1);
   await t.page.reload(); await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).waitFor();
   assert.equal(t.posts.length,1); await t.shot(); t.setMode('ok');
   await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).click(); await t.paid();
   assert.deepEqual(t.posts,[first,first]);
   const recovery=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.collection-recovery.v1'))); assert.deepEqual(recovery.orders,{});
 },{mode:'drop'});
 await scenario('paid-audit-recovery',{width:820,height:1180},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();
   await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).waitFor();
   const first=t.posts[0];assert.equal(t.row.payment.status,'paid');
   await t.page.reload(); await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).waitFor();
   await t.shot();t.setMode('ok');await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).click();await t.paid();assert.deepEqual(t.posts,[first,first]);
 },{mode:'audit-pending'});
 await scenario('concurrent-paid',{width:390,height:844},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();await t.paid();
   assert.match(await t.page.locator('body').innerText(),/Si vous avez aussi reçu de l’argent/);await t.shot();assert.equal(t.posts.length,1);
 },{mode:'elsewhere'});
 await scenario('amount-changed',{width:1440,height:1000},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();
   await t.page.getByRole('button',{name:/Confirmer 15,00.*encaissés/}).waitFor();assert.equal(t.posts.length,1);
   assert.equal(await t.page.getByRole('button',{name:/Confirmer 15,00.*encaissés/}).isDisabled(),true);await t.shot();
 },{mode:'rejected'});
 await scenario('offline-no-post',{width:390,height:844},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.context.setOffline(true);await t.page.getByText(/Connexion requise : cet encaissement/).waitFor();
   assert.equal(await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).isDisabled(),true);assert.equal(t.posts.length,0);await t.shot();
 });
 await scenario('role-kitchen',{width:1440,height:1000},async t=>{
   await t.open();await t.service();assert.equal(await t.page.getByRole('button',{name:'Encaisser la commande 42',exact:true}).count(),0);assert.equal(t.posts.length,0);
 },{role:'cuisine'});
 for(const opts of [{delivery:true},{online:true}]) await scenario(opts.delivery?'delivery-not-collectible':'online-not-collectible',{width:1440,height:1000},async t=>{
   await t.open();await t.service();assert.equal(await t.page.getByRole('button',{name:'Encaisser la commande 42',exact:true}).count(),0);assert.equal(t.posts.length,0);
 },opts);
 await scenario('silent-network-deadline',{width:390,height:844},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();
   await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).waitFor({timeout:22000});
   assert.equal(t.posts.length,1);await t.shot(); const first=t.posts[0];t.setMode('ok');
   await t.page.getByRole('button',{name:'Reprendre la confirmation du règlement',exact:true}).click();await t.paid();assert.deepEqual(t.posts,[first,first]);
 },{mode:'silent'});
 await scenario('journal-storage-failure-reload',{width:1440,height:1000},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='sm.pos.daylog.v1')throw new DOMException('Quota simulated','QuotaExceededError');return original.call(this,key,value);};});
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();await t.paid();
   let journal=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));assert.equal(journal.entries[0].paid,false);
   const recovery=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.collection-recovery.v1')));assert.deepEqual(recovery.orders,{});
   await t.page.reload();await t.page.getByRole('button',{name:/Boisson QA,/}).waitFor();
   await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1'))?.entries?.[0]?.paid===true);
   journal=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].method,'especes');assert.equal(t.posts.length,1);
 },{journal:true});
 await scenario('journal-yesterday-outside-200',{width:1440,height:1000},async t=>{
   await t.open();await t.service();await t.collect();await t.page.getByRole('button',{name:'Compte juste',exact:true}).click();
   await t.page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='sm.pos.daylog.v1')throw new DOMException('Quota simulated','QuotaExceededError');return original.call(this,key,value);};});
   await t.page.getByRole('button',{name:/Confirmer 12,50.*encaissés/}).click();await t.paid();
   assert.deepEqual(await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.collection-recovery.v1')).orders),{});
   t.hideFromRecentLists();await t.page.reload();await t.page.getByRole('button',{name:/Boisson QA,/}).waitFor();
   await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1'))?.entries?.[0]?.paid===true);
   const journal=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].method,'especes');
   assert.equal(t.requests.filter(([method,path])=>method==='GET'&&path===`/orders/by-client/${t.row.clientId}`).length,1);assert.equal(t.posts.length,1);await t.shot();
 },{journal:true});
 await scenario('journal-exact-lookup-404',{width:1440,height:1000},async t=>{
   const exactRead=t.page.waitForRequest((request)=>new URL(request.url()).pathname===`/orders/by-client/${t.row.clientId}`);
   t.hideFromRecentLists();t.setMode('lookup-missing');await t.open();await exactRead;
   await t.page.waitForFunction(()=>document.body.innerText.includes('Boisson QA'));
   await t.page.getByRole('button',{name:'Récapitulatif local du poste',exact:true}).click();
   const journal=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));assert.equal(journal.entries[0].paid,false);assert.equal(t.posts.length,0);
   assert.equal(t.requests.filter(([method,path])=>method==='GET'&&path===`/orders/by-client/${t.row.clientId}`).length,1);
 },{journal:true});
 console.log(JSON.stringify(results));
} finally { await browser.close(); }
