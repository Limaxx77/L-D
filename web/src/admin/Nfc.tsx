import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, Nfc, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { api, apiUrl } from '../lib/api';
import { useStore, useToast } from '../lib/context';
import { Field, Modal, Spinner, Toggle } from '../components/ui';
import { PageTitle, useAdmin } from './AdminApp';

interface T {
  id: string;
  name: string;
  number: number;
  active: boolean;
  url: string;
  status: string;
  session: { id: string } | null;
}

export function NfcManager() {
  const toast = useToast();
  const { info } = useStore();
  const { can } = useAdmin();
  const [tables, setTables] = useState<T[] | null>(null);
  const [edit, setEdit] = useState<Partial<T> | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const load = useCallback(() => api<T[]>('/admin/tables').then(setTables).catch((e) => toast((e as Error).message, 'error')), [toast]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!tables) return <Spinner />;
  const configure = can('tables.configure');
  const nfcSupported = 'NDEFReader' in window;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, number: Number(edit.number), active: edit.active ?? true };
    await act(() => (edit.id ? api(`/admin/tables/${edit.id}`, { method: 'PUT', body }) : api('/admin/tables', { body })), 'Mesa salva.');
    setEdit(null);
  };

  /** Grava o link direto no cartão (Chrome Android com Web NFC). */
  const writeNfc = async (t: T) => {
    try {
      setWriting(t.id);
      // @ts-expect-error Web NFC ainda não está nas definições do TypeScript
      const reader = new window.NDEFReader();
      await reader.write({ records: [{ recordType: 'url', data: t.url }] });
      toast(`Cartão NFC da ${t.name} gravado!`);
    } catch (e) {
      toast(`Não foi possível gravar: ${(e as Error).message}`, 'error');
    } finally {
      setWriting(null);
    }
  };

  const printCard = (t: T) => {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title>
      <style>body{font-family:'Baloo 2',system-ui,sans-serif;display:flex;justify-content:center;padding:24px}
      .card{width:9cm;border:4px solid #D7261E;border-radius:24px;padding:24px;text-align:center;background:#FFF8E6}
      h1{margin:0;font-size:28px;color:#D7261E} h2{margin:4px 0 12px;font-size:40px} p{font-family:system-ui;font-size:14px;margin:8px 0}
      img{width:6cm;height:6cm}</style></head><body><div class="card">
      <h1>${info?.store.name ?? 'Pastel L&D'}</h1><h2>${t.name}</h2>
      <img src="${apiUrl(`/admin/tables/${t.id}/qr.svg`)}" alt="QR Code"/>
      <p><b>Aponte a câmera</b> ou <b>aproxime o celular</b> do cartão NFC para ver o cardápio e pedir.</p>
      </div><script>setTimeout(()=>window.print(),600)</script></body></html>`);
    w.document.close();
  };

  return (
    <div>
      <PageTitle title="NFC e QR Codes">{configure && <button className="btn-primary" onClick={() => setEdit({ name: `Mesa ${String(tables.length + 1).padStart(2, '0')}`, number: (Math.max(0, ...tables.map((t) => t.number)) || 0) + 1, active: true })}>+ Nova mesa</button>}</PageTitle>
      <div className="card mb-5 p-4 text-sm">
        <p className="font-bold">Como gravar os cartões NFC</p>
        <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-ink-700">
          <li>Use cartões/tags NFC NTAG213, NTAG215 ou NTAG216.</li>
          <li>{nfcSupported ? 'Neste aparelho você pode tocar em “Gravar NFC” e aproximar o cartão.' : 'No Android, abra este painel no Chrome para gravar direto, ou use o app gratuito “NFC Tools”: Escrever → Adicionar registro → URL → cole o link da mesa → Escrever.'}</li>
          <li>O QR Code e o NFC da mesma mesa abrem o mesmo link. Ao “Gerar novo link”, regrave o cartão e reimprima o QR.</li>
          <li>Opcional: bloqueie a tag contra regravação (NFC Tools → Outros → Bloquear) para evitar adulteração.</li>
        </ol>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((t) => (
          <div key={t.id} className={`card p-4 ${t.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start gap-4">
              <img src={apiUrl(`/admin/tables/${t.id}/qr.svg`)} alt={`QR Code ${t.name}`} className="h-28 w-28 rounded-xl bg-white ring-1 ring-black/10" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl font-extrabold">{t.name}</p>
                <p className="text-xs text-ink-700">{t.active ? (t.session ? 'Mesa aberta' : 'Mesa livre') : 'Desativada'}</p>
                <p className="mt-1 break-all text-xs text-ink-700">{t.url}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button className="btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(t.url).then(() => toast('Link copiado.'))}><Copy size={14} /> Copiar link</button>
              <a className="btn-ghost btn-sm" href={apiUrl(`/admin/tables/${t.id}/qr.png?download=1`)}><Download size={14} /> PNG</a>
              <a className="btn-ghost btn-sm" href={apiUrl(`/admin/tables/${t.id}/qr.svg?download=1`)}><Download size={14} /> SVG</a>
              <button className="btn-ghost btn-sm" onClick={() => printCard(t)}><Printer size={14} /> Imprimir</button>
              {nfcSupported && <button className="btn-gold btn-sm" disabled={writing === t.id} onClick={() => writeNfc(t)}><Nfc size={14} /> {writing === t.id ? 'Aproxime o cartão...' : 'Gravar NFC'}</button>}
              {configure && (
                <>
                  <button className="btn-ghost btn-sm" onClick={() => setEdit(t)}>Editar</button>
                  <button className="btn-danger btn-sm" onClick={() => window.confirm(`Gerar novo link para ${t.name}? O cartão NFC e o QR Code atuais deixarão de funcionar.`) && act(() => api(`/admin/tables/${t.id}/regenerate`, { body: {} }), 'Novo link gerado. Regrave o NFC e reimprima o QR.')}><RefreshCw size={14} /> Novo link</button>
                  <button className="btn-danger btn-sm" onClick={() => window.confirm(`Remover ${t.name}?`) && act(() => api(`/admin/tables/${t.id}`, { method: 'DELETE' }), 'Mesa removida.')} aria-label="Remover"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Editar mesa' : 'Nova mesa'} footer={<button className="btn-primary w-full" onClick={save}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Nome"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Número"><input className="input" type="number" min={1} value={edit.number ?? ''} onChange={(e) => setEdit({ ...edit, number: Number(e.target.value) })} /></Field>
            <Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" />
          </div>
        </Modal>
      )}
    </div>
  );
}
