/** Companion UI for refonte-mediatheque.mjs; excluded from application builds. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotosDuPlat } from '@/app/admin/menu/PhotosDuPlat';
import { ChoixDeMedia } from '@/components/mediatheque/ChoixDeMedia';
import { creerFichierIllustration, illustrations } from '@/components/mediatheque/illustrations';
import { planifierDepot, reduirePourEnvoi } from '@/components/mediatheque/photos';
import { MEDIA_MAX_OCTETS } from '@sm/contracts';
// Replaced at bundle time by the fixture. The production transport is never included.
import { charger, evidence, reset } from '@/lib/api';

const originalToBlob = HTMLCanvasElement.prototype.toBlob;
HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
  const delay = evidence.delay;
  if (delay) evidence.pending++;
  return originalToBlob.call(this, (blob) => {
    if (!delay) { callback(blob); return; }
    setTimeout(() => { evidence.pending--; callback(blob); }, 5000);
  }, ...args);
};
window.addEventListener('error', event => evidence.errors.push(event.message));
window.addEventListener('unhandledrejection', event => evidence.errors.push(String(event.reason)));

const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
function Fixture() {
  const [photos, setPhotos] = useState<string[]>(['existing-original']);
  const [chosen, setChosen] = useState<string | null>(null);
  const [brand, setBrand] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState('Prête');
  const [journal, setJournal] = useState('');
  useEffect(() => { const id = setInterval(() => setJournal(JSON.stringify({ ...evidence, photos, chosen }, null, 2)), 200); return () => clearInterval(id); }, [photos, chosen]);
  async function renderAll() {
    try {
      evidence.renders.length = 0;
      for (const asset of illustrations) {
        setState('PNG ' + asset.label);
        const file = await creerFichierIllustration(asset.id);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const plan = planifierDepot(bytes, file.name);
        assert(plan.ok && plan.type === 'image/png', 'PNG réel absent pour ' + asset.id);
        assert(plan.ok && plan.source?.largeur === 1600 && plan.source?.hauteur === 1100, 'Dimensions erronées ' + asset.id);
        assert(file.size <= MEDIA_MAX_OCTETS, 'Quota fichier dépassé ' + asset.id);
        const result = await reduirePourEnvoi(file);
        assert(result.ok && result.fichier === file && !result.reduit, 'Dépôt altéré ' + asset.id);
        evidence.renders.push({ id: asset.id, bytes: file.size, type: file.type, plan });
      }
      setState('41 PNG réels conformes · réduction existante conserve les octets');
    } catch (e) { evidence.errors.push(String(e)); setState(String(e)); }
  }
  function fresh() { reset(); setPhotos(['existing-original']); setChosen(null); setGeneration(n => n + 1); }
  return <main className="mx-auto max-w-4xl p-5 text-ink">
    <h1 className="text-xl font-bold">Recette médiathèque locale</h1>
    <p className="my-3 text-sm text-mut">Composants produit et image d’établissement existants. API en mémoire, aucune base ni requête distante. La référence « existing-original » prouve la conservation de la photo principale.</p>
    <div className="mb-3 flex flex-wrap gap-3">
      <button className="rounded-ctrl border border-line p-3" onClick={() => void renderAll()}>Vérifier les 41 PNG</button>
      <button className="rounded-ctrl border border-line p-3" onClick={() => setBrand(true)}>Ouvrir le choix de marque</button>
      <button className="rounded-ctrl border border-line p-3" onClick={fresh}>Réinitialiser les scénarios</button>
      <button className="rounded-ctrl border border-line p-3" onClick={async () => { await fetch('/preuves', { method: 'POST', body: JSON.stringify({ ...evidence, photos, chosen }) }); setState('Preuves enregistrées'); }}>Enregistrer les preuves</button>
    </div>
    <div className="flex flex-wrap gap-5">
      <label><input type="checkbox" onChange={e => { evidence.quotaRefused = e.target.checked; }} /> Refuser le quota</label>
      <label><input type="checkbox" onChange={e => { evidence.delay = e.target.checked; }} /> Raster lent (5 secondes)</label>
      <label><input type="checkbox" onChange={e => { evidence.canAct = !e.target.checked; }} /> Retirer le droit d’action</label>
    </div>
    <p role="status" className="mt-3 text-sm">{state}</p>
    <p>Photos attachées : <output>{photos.join(' → ')}</output></p>
    <p>Image choisie : <output>{chosen ?? 'aucune'}</output></p>
    <PhotosDuPlat key={generation} produitNom="Plat de recette" photos={photos} onChange={ids => { evidence.updates.push({ kind: 'product', ids }); setPhotos(ids); }} chargerMediatheque={charger} />
    {brand && <ChoixDeMedia titre="Image de marque — recette" aide="Choix volontaire de l’image d’accueil." posee={chosen} adresseDe={media => media.urls.original} admissible={() => true} onChoisir={media => { evidence.updates.push({ kind: 'brand', id: media.id }); setChosen(media.urls.original); }} onFerme={() => setBrand(false)} chargerMediatheque={charger} canAct={() => evidence.canAct} />}
    <details className="mt-5"><summary>Journal de recette</summary><pre className="overflow-auto text-xs" id="evidence">{journal}</pre></details>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
