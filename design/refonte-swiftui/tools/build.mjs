import {readFile,mkdir,writeFile,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {screens} from '../studio/screens.mjs';
import {assets,renderArtwork} from '../packages/assets/index.mjs';
import {iconNames,renderIcon} from '../packages/icons/index.mjs';
import {light,dark,brand,space,radius,density,typography,motion,cssVariables} from '../packages/tokens/index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});
for(const folder of ['screens','assets/food','assets/icons','tokens','prompts'])await mkdir(path.join(out,folder),{recursive:true});
const modules=['packages/tokens/index.mjs','packages/icons/index.mjs','packages/assets/original.mjs','packages/assets/index.mjs','studio/screens.mjs','studio/fixtures.mjs','studio/app.mjs'];
const code=(await Promise.all(modules.map(async file=>(await readFile(path.join(root,file),'utf8')).replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')))).join('\n');
const css=(await Promise.all(['packages/ui-web/styles.css','studio/styles.css'].map(file=>readFile(path.join(root,file),'utf8')))).join('\n');
function html(id){return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Snack Manager · Design Studio</title><meta name="description" content="Maquettes de référence de Snack Manager. Données fictives, aucune opération réelle."><style>${css}</style></head><body class="sm-ui" data-start="${id}" style="${cssVariables('light',brand.preview)}"><div id="app"></div><noscript>Activez JavaScript pour explorer les maquettes.</noscript><script>(()=>{'use strict';\n${code.replace(/<\/script/gi,'<\\/script')}\n})();</script></body></html>`;}
await writeFile(path.join(out,'index.html'),html('pos-sale'));
for(const screen of screens){
 await writeFile(path.join(out,'screens',screen.id+'.html'),html(screen.id));
 const text=`# Refonte visuelle : ${screen.title}\n\n## Référence\nFamille : ${screen.family}. Écran : ${screen.id}. Source repérée : \`${screen.source}\`. Base auditée : \`2c879899adc0e7c3b98817ef76cf026ea5d22bf8\`. Maquette : \`dist/screens/${screen.id}.html\`.\n\n## Mission\nRelire prompts/00-MASTER.md, docs/CHARTE.md, docs/INVARIANTS.md et la source ACTUELLE avant de coder. La maquette fixe la direction visuelle, pas le modèle de données. Relever chaque action, garde, préférence, libellé, état asynchrone, retour arrière et test existant de cette surface. Toute divergence supplémentaire doit être tracée dans la matrice de parité et conservée.\n\n## Mise en œuvre\nRemplacer progressivement uniquement le rendu et les styles, en réutilisant les composants du kit. Conserver les signatures de props, les handlers, clés métier et identifiants de test. Les prix sont des labels dérivés du métier ; les soldes, taxes, seuils et transitions ne se recalculent pas dans l’UI. Aucun import de studio/fixtures.mjs dans une application. Ne mettre à niveau aucune dépendance pour cette refonte. Conserver les hôtes de modales et les politiques de média existants.\n\n## États obligatoires\nNominal, chargement, vide, erreur, donnée ancienne, opération en attente, résultat incertain, refus de rôle/capacité et indisponibilité réseau. Tester chaque action pertinente dans son état réel ; ne pas inventer d’état de succès. Réduire les mouvements et la transparence selon les préférences existantes.\n\n## Recette\nCapturer 390, 768, 1024 et 1440 px dans les deux thèmes. Le test des données anciennes doit rester distinct du test vide. Conserver les tests existants et ajouter tests visuels + clavier/focus. L’UI doit garder visibles les messages critiques et l’action principale. Sur native, recette tactile, clavier logiciel, rotation et lecteur d’écran sur appareils requise. Rapporter les commandes réellement exécutées, leurs résultats, les preuves et toute limite.\n\n## Sortie\nPetite PR pour cette surface uniquement, inventaire avant/après, captures côte à côte, tests existants inchangés, aucun changement API/métier. Ne pas fusionner automatiquement.\n`;
 await writeFile(path.join(out,'prompts',screen.id+'.md'),text);
}
for(const a of assets)await writeFile(path.join(out,'assets/food',a.id+'.svg'),renderArtwork(a.id,'export-'+a.id));
for(const name of iconNames)await writeFile(path.join(out,'assets/icons',name+'.svg'),renderIcon(name));
await writeFile(path.join(out,'tokens/tokens.json'),JSON.stringify({format:'Snack Manager semantic tokens v1',brand,light,dark,space,radius,density,typography,motion},null,2)+'\n');
await writeFile(path.join(out,'tokens/tokens.css'),`:root,[data-sm-theme=light]{${cssVariables('light')}}\n[data-sm-theme=dark]{${cssVariables('dark')}}\n`);
await copyFile(path.join(root,'studio/screen-manifest.json'),path.join(out,'screen-manifest.json'));
await writeFile(path.join(out,'README.txt'),`Snack Manager Design Studio\nOuvrir index.html dans un navigateur. Fichiers autonomes, sans connexion.\n${screens.length} vues, ${assets.length} illustrations, ${iconNames.length} icônes.\nLes maquettes sont des fixtures DOM, pas des captures des applications Expo ou Next.js.\nAucun paiement, compte, QR utilisable ou réseau restaurant.\n`);
console.log(JSON.stringify({screens:screens.length,foodAssets:assets.length,icons:iconNames.length,out},null,2));
