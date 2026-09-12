from playwright.sync_api import sync_playwright
from pathlib import Path
import json,time,os
r=Path(__file__).resolve().parents[1];out=r/'qa';screens=json.loads((r/'studio/screen-manifest.json').read_text())
report={'engine':'System Chromium via Playwright','method':'set_content of built standalone HTML; file navigation blocked by administrator','views':[],'errors':[],'interactions':[],'consoleErrors':[]}
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}));page=b.new_page();page.set_default_timeout(5000);page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else None)
 page.set_content((r/'dist/index.html').read_text(),wait_until='load')
 for w,h in [(1440,1000),(1024,768),(768,1024),(390,844)]:
  page.set_viewport_size({'width':w,'height':h})
  for mode in ['light','dark']:
   if page.get_attribute('body','data-theme')!=mode:page.locator('[data-action="theme"]').evaluate('(el)=>el.click()')
   for s in screens:
    if page.locator('#studio-dialog[open]').count():page.keyboard.press('Escape')
    page.locator('#screen-select').evaluate('(el,id)=>{el.value=id;el.dispatchEvent(new Event("change",{bubbles:true}));}',s['id'])
    overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    data={'id':s['id'],'width':w,'height':h,'theme':mode,'title':s['title'] in page.title(),'meaningful':page.locator('h1,h2').count()>0,'overflow':overflow}
    if s['id']=='pos-sale' and w>650:
     rect=page.locator('.sm-ticket').get_by_role('button',name='Carte',exact=True).bounding_box();data['paymentVisible']=bool(rect and rect['y']+rect['height']<=h)
    if s['family'] in ['Commande','Fidélité','Livreur'] and s['kind']!='auth':
     rect=page.locator('.mobile-bottom').bounding_box();data['navVisible']=bool(rect and rect['y']+rect['height']<=h+1)
    if s['id']=='loyalty-card':data['balanceNotClipped']=page.locator('.sm-loyalty-pass').evaluate('(el)=>el.scrollHeight<=el.clientHeight+2')
    report['views'].append(data)
   print('matrix',w,h,mode,len(report['views']),flush=True)
 if page.locator('#studio-dialog[open]').count():page.keyboard.press('Escape')
 page.set_viewport_size({'width':1440,'height':1000});page.select_option('#screen-select','pos-sale')
 if page.get_attribute('body','data-theme')!='light':page.locator('[data-action="theme"]').evaluate('(el)=>el.click()')
 page.get_by_label('Rechercher un produit',exact=True).fill('tiramisu')
 report['interactions'].append({'name':'product search','pass':page.locator('.sm-product').count()==1})
 page.locator('.sm-product').first.click();report['interactions'].append({'name':'product sheet','pass':page.locator('#studio-dialog[open]').count()==1})
 page.get_by_role('button',name='Ajouter au ticket',exact=True).click();report['interactions'].append({'name':'add fixture product','pass':page.locator('.ticket-item').filter(has_text='Tiramisu').count()==1})
 page.select_option('#state-select','uncertain');report['interactions'].append({'name':'uncertain disables payment','pass':page.locator('.sm-ticket').get_by_role('button',name='Carte',exact=True).is_disabled()})
 page.select_option('#state-select','normal');page.select_option('#screen-select','kds-board')
 page.get_by_role('button',name='Accepter',exact=True).first.click();report['interactions'].append({'name':'KDS fixture advances','pass':page.locator('.sm-kitchen-ticket--warning').count()==3})
 report['interactions'].append({'name':'KDS ready has no serve action','pass':page.locator('.sm-kitchen-ticket--success button').count()==0})
 page.set_viewport_size({'width':390,'height':844});page.select_option('#screen-select','pos-sale');page.locator('[data-action="cart"]').click();report['interactions'].append({'name':'mobile ticket opens','pass':page.locator('.pos-layout.cart-open').count()==1})
 page.select_option('#screen-select','loyalty-card');page.get_by_role('button',name='Scanner mon ticket',exact=True).click();report['interactions'].append({'name':'loyalty scanner navigation','pass':'Scanner mon ticket' in page.title()})
 page.select_option('#screen-select','courier-map');page.get_by_role('button',name='Confirmer une remise',exact=True).click();report['interactions'].append({'name':'handoff requires explicit dialog','pass':page.locator('#studio-dialog').get_by_role('button',name='Confirmer la remise',exact=True).count()==1})
 page.keyboard.press('Escape');page.select_option('#screen-select','pos-settings');page.locator('#motion-check').check();report['interactions'].append({'name':'reduced motion switch','pass':page.get_attribute('body','data-reduced-motion')=='true'})
 b.close()
(out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
fail=[v for v in report['views'] if v['overflow'] or not v['title'] or not v['meaningful'] or v.get('paymentVisible') is False or v.get('navVisible') is False or v.get('balanceNotClipped') is False]
print(json.dumps({'views':len(report['views']),'errors':report['errors'],'layoutFailures':fail,'interactions':report['interactions']},ensure_ascii=False,indent=2))
