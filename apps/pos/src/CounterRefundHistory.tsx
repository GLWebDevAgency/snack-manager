import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { euros, SmApiError } from '@sm/client-core';
import { Btn } from './ui';
import { S, useTheme } from './theme';
import { counterRefundDeadline, type CounterRefundAccess } from './counter-refund';

type Row = { _id: string; number: number; status: string; payment: { method: string; status: string; tender?: string }; totals: { total: number } };
const browserOffline = () => globalThis.navigator?.onLine === false;
export function CounterRefundHistory({ access, onSelect, offline }: { access: CounterRefundAccess; onSelect: (id: string) => void; offline: boolean }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ rows: Row[]; total: number; truncated: boolean } | null>(null);
  const current = useRef({ access, offline }); current.current = { access, offline };
  const alive = useRef(false), flight = useRef(false);
  const { type, sheet } = useTheme();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (flight.current || offline || browserOffline()) return;
    flight.current = true; setOpen(true); setBusy(true); setError(null); setView(null);
    try {
      const raw = await counterRefundDeadline(access.request('GET', '/orders?status=delivered'));
      if (!alive.current || current.current.access !== access || current.current.offline || browserOffline()) return;
      if (!raw || typeof raw !== 'object') throw Error('Historique illisible.');
      const result = raw as { rows?: Row[]; total?: number; truncated?: boolean };
      if (!Array.isArray(result.rows) || result.rows.length > 200 || !Number.isSafeInteger(result.total) || result.total! < result.rows.length
        || typeof result.truncated !== 'boolean' || result.rows.some(row => !/^[a-f0-9]{24}$/.test(row?._id)
          || row.status !== 'delivered' || !Number.isSafeInteger(row.number) || !Number.isSafeInteger(row.totals?.total)
          || row.totals.total < 0 || !row.payment || typeof row.payment.method !== 'string' || typeof row.payment.status !== 'string')) throw Error('Historique illisible.');
      setView({ rows: result.rows, total: result.total!, truncated: result.truncated || result.total! > result.rows.length });
    } catch (cause) {
      if (!alive.current || current.current.access !== access) return;
      if (cause instanceof SmApiError && cause.status === 401) access.onSessionExpired();
      setError('Les commandes remises ne peuvent pas être vérifiées. Réessayez avec la connexion.');
    } finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  return <View style={[sheet.inset, { padding: S.md, gap: S.sm }]}>
    <Btn label={open ? 'Actualiser les commandes remises' : 'Commandes remises'} kind="ghost" disabled={busy || offline} onPress={() => void load()} />
    {open ? <>
      <Text style={type.mut}>Lecture serveur des 200 commandes remises les plus récentes, y compris les retraits commandés en ligne. Les files actives restent affichées plus bas.</Text>
      {busy ? <Text style={type.mut}>Vérification des commandes remises…</Text> : null}
      {error ? <Text accessibilityRole="alert" style={type.mut}>{error}</Text> : null}
      {view ? <>
        <Text style={type.strong}>{`${view.rows.length} affichée(s) sur ${view.total}`}</Text>
        {view.truncated ? <Text accessibilityRole="alert" style={type.mut}>Historique incomplet : des commandes plus anciennes ne sont pas affichées. Utilisez le back-office pour les retrouver.</Text> : null}
        {!view.rows.length ? <Text style={type.mut}>Aucune commande remise dans cette lecture.</Text> : null}
        {view.rows.map(row => <View key={row._id} style={{ gap: S.sm, paddingVertical: S.sm }}>
          <Text style={type.strong}>{`Commande n° ${row.number} · ${euros(row.totals.total)}`}</Text>
          {row.payment.method === 'counter' && ['paid', 'refunded'].includes(row.payment.status)
            ? <Btn label={`Remboursement comptoir de la commande ${row.number}`} size="sm" kind="ghost" disabled={offline || busy} onPress={() => onSelect(row._id)} />
            : <Text style={type.mut}>Paiement en ligne ou preuve comptoir absente : consulter le back-office.</Text>}
        </View>)}
      </> : null}
      <Btn label="Masquer les commandes remises" kind="ghost" onPress={() => setOpen(false)} />
    </> : null}
  </View>;
}
