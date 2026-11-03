import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useStore, useToast } from '../lib/context';
import { brl, centsToInput, parseBRL, WEEKDAYS } from '../lib/format';
import { Field, Modal, Spinner, Toggle } from '../components/ui';
import { PageTitle } from './AdminApp';

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = Record<string, any>;

const TABS = [
  ['store', 'Loja'],
  ['delivery', 'Delivery e áreas'],
  ['hours', 'Horários'],
  ['payment', 'Pagamentos'],
  ['tables', 'Mesas'],
  ['messages', 'Mensagens'],
  ['coupons', 'Cupons'],
] as const;

export default function Settings() {
  const toast = useToast();
  const { reload } = useStore();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('store');
  const [s, setS] = useState<S | null>(null);
  const load = useCallback(() => api<S>('/admin/settings').then(setS), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return <Spinner />;

  const save = async (key: string, value: unknown) => {
    try {
      await api(`/admin/settings/${key}`, { method: 'PUT', body: value });
      toast('Configurações salvas.');
      void load();
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageTitle title="Configurações" />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([k, l]) => <button key={k} className={`btn-sm ${tab === k ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'store' && <StoreTab value={s.store} onSave={(v) => save('store', v)} onReload={load} />}
      {tab === 'delivery' && <DeliveryTab value={s.delivery} onSave={(v) => save('delivery', v)} />}
      {tab === 'hours' && <HoursTab value={s.hours} onSave={(v) => save('hours', v)} />}
      {tab === 'payment' && <PaymentTab value={s.payment} onSave={(v) => save('payment', v)} />}
      {tab === 'tables' && <SimpleForm value={s.tables} onSave={(v) => save('tables', v)} fields={[['autoOpenOnJoin', 'Abrir a mesa automaticamente quando o primeiro cliente entrar pelo NFC/QR'], ['requireAcceptForTableOrders', 'Pedidos da mesa precisam ser confirmados pelo atendente']]} />}
      {tab === 'messages' && <MessagesTab value={s.messages} onSave={(v) => save('messages', v)} />}
      {tab === 'coupons' && <Coupons />}
    </div>
  );
}

function SimpleForm({ value, onSave, fields }: { value: S; onSave: (v: S) => void; fields: [string, string][] }) {
  const [v, setV] = useState(value);
  return (
    <div className="card max-w-2xl space-y-4 p-5">
      {fields.map(([k, l]) => <Toggle key={k} checked={!!v[k]} onChange={(x) => setV({ ...v, [k]: x })} label={l} />)}
      <button className="btn-primary" onClick={() => onSave(v)}>Salvar</button>
    </div>
  );
}

function StoreTab({ value, onSave, onReload }: { value: S; onSave: (v: S) => void; onReload: () => void }) {
  const toast = useToast();
  const { reload } = useStore();
  const [v, setV] = useState(value);
  const upload = async (kind: 'logo' | 'banner', file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append('image', file);
    try {
      const r = await api<{ url: string }>(`/admin/settings/store/${kind}`, { form });
      setV((x: S) => ({ ...x, [kind === 'logo' ? 'logoUrl' : 'bannerUrl']: r.url }));
      onReload();
      void reload();
      toast('Imagem atualizada.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="card grid max-w-3xl gap-3 p-5 sm:grid-cols-2">
      <Field label="Nome comercial"><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="WhatsApp (DDI + DDD + número)" hint="Ex.: 5565992638816"><input className="input" value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value.replace(/\D/g, '') })} /></Field>
      <div className="sm:col-span-2"><Field label="Frase de destaque"><input className="input" value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} /></Field></div>
      <div className="sm:col-span-2"><Field label="Endereço"><input className="input" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field></div>
      <Field label="Instagram (URL)"><input className="input" value={v.instagram} onChange={(e) => setV({ ...v, instagram: e.target.value })} /></Field>
      <Field label="Facebook (URL)"><input className="input" value={v.facebook} onChange={(e) => setV({ ...v, facebook: e.target.value })} /></Field>
      <Field label="Fuso horário"><input className="input" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} /></Field>
      <div />
      <Field label="Logo">
        <div className="flex items-center gap-2">
          {v.logoUrl && <img src={v.logoUrl} className="h-12 rounded" alt="" />}
          <input type="file" accept="image/*" onChange={(e) => upload('logo', e.target.files?.[0])} />
          {v.logoUrl && <button className="btn-ghost btn-sm" onClick={() => setV({ ...v, logoUrl: null })}>Usar padrão</button>}
        </div>
      </Field>
      <Field label="Banner da página inicial">
        <div className="flex items-center gap-2">
          {v.bannerUrl && <img src={v.bannerUrl} className="h-12 rounded" alt="" />}
          <input type="file" accept="image/*" onChange={(e) => upload('banner', e.target.files?.[0])} />
          {v.bannerUrl && <button className="btn-ghost btn-sm" onClick={() => setV({ ...v, bannerUrl: null })}>Usar padrão</button>}
        </div>
      </Field>
      <div className="sm:col-span-2"><button className="btn-primary" onClick={() => onSave(v)}>Salvar</button></div>
    </div>
  );
}

const money = (v: string) => (v.trim() === '' ? null : parseBRL(v));

function DeliveryTab({ value, onSave }: { value: S; onSave: (v: S) => void }) {
  const toast = useToast();
  const { reload } = useStore();
  const [v, setV] = useState(value);
  const [min, setMin] = useState(centsToInput(value.minOrderCents));
  const [free, setFree] = useState(centsToInput(value.freeDeliveryAboveCents));
  const [outside, setOutside] = useState(centsToInput(value.outsideAreaFeeCents));
  const [areas, setAreas] = useState<{ id: string; neighborhood: string; feeCents: number; minOrderCents: number | null; active: boolean }[] | null>(null);
  const [edit, setEdit] = useState<{ id?: string; neighborhood: string; fee: string; min: string; active: boolean } | null>(null);
  const loadAreas = useCallback(() => api<typeof areas>('/admin/delivery-areas').then(setAreas), []);
  useEffect(() => {
    void loadAreas();
  }, [loadAreas]);
  const saveArea = async () => {
    if (!edit) return;
    try {
      const body = { neighborhood: edit.neighborhood, feeCents: parseBRL(edit.fee) ?? 0, minOrderCents: money(edit.min), active: edit.active };
      await api(edit.id ? `/admin/delivery-areas/${edit.id}` : '/admin/delivery-areas', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      void loadAreas();
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-3 p-5">
        <Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="Delivery ativo" />
        <Toggle checked={v.pickupEnabled} onChange={(x) => setV({ ...v, pickupEnabled: x })} label="Retirada no local ativa" />
        <Field label="Pedido mínimo para entrega (R$)" hint="Em branco = sem mínimo"><input className="input" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label="Entrega grátis acima de (R$)" hint="Em branco = desativado"><input className="input" value={free} onChange={(e) => setFree(e.target.value)} /></Field>
        <Field label="Prazo padrão sugerido (min)"><input className="input" type="number" min={5} value={v.defaultPrepMinutes} onChange={(e) => setV({ ...v, defaultPrepMinutes: Number(e.target.value) })} /></Field>
        <Toggle checked={v.allowOutsideArea} onChange={(x) => setV({ ...v, allowOutsideArea: x })} label="Aceitar endereços fora dos bairros cadastrados" />
        {v.allowOutsideArea && <Field label="Taxa para fora da área (R$)"><input className="input" value={outside} onChange={(e) => setOutside(e.target.value)} /></Field>}
        <button className="btn-primary" onClick={() => onSave({ ...v, minOrderCents: money(min), freeDeliveryAboveCents: money(free), outsideAreaFeeCents: money(outside) })}>Salvar</button>
      </div>
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Bairros atendidos</h2>
          <button className="btn-ghost btn-sm" onClick={() => setEdit({ neighborhood: '', fee: '7,00', min: '', active: true })}><Plus size={14} /> Bairro</button>
        </div>
        {!areas ? <Spinner /> : (
          <ul className="divide-y divide-black/5 text-sm">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <button className={`text-left ${a.active ? '' : 'opacity-50'}`} onClick={() => setEdit({ id: a.id, neighborhood: a.neighborhood, fee: centsToInput(a.feeCents), min: centsToInput(a.minOrderCents), active: a.active })}>
                  <span className="font-semibold">{a.neighborhood}</span> · taxa {brl(a.feeCents)}{a.minOrderCents ? ` · mín. ${brl(a.minOrderCents)}` : ''}
                </button>
                <button className="text-brand-700" onClick={() => window.confirm(`Remover ${a.neighborhood}?`) && api(`/admin/delivery-areas/${a.id}`, { method: 'DELETE' }).then(loadAreas).catch((e) => toast(e.message, 'error'))}><Trash2 size={14} /></button>
              </li>
            ))}
            {!areas.length && <li className="py-2 text-ink-700">Nenhum bairro cadastrado.</li>}
          </ul>
        )}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title="Bairro" footer={<button className="btn-primary w-full" onClick={saveArea}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Bairro"><input className="input" value={edit.neighborhood} onChange={(e) => setEdit({ ...edit, neighborhood: e.target.value })} /></Field>
            <Field label="Taxa de entrega (R$)"><input className="input" value={edit.fee} onChange={(e) => setEdit({ ...edit, fee: e.target.value })} /></Field>
            <Field label="Pedido mínimo do bairro (opcional)"><input className="input" value={edit.min} onChange={(e) => setEdit({ ...edit, min: e.target.value })} /></Field>
            <Toggle checked={edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label="Ativo" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function HoursTab({ value, onSave }: { value: S; onSave: (v: S) => void }) {
  const toast = useToast();
  const { reload } = useStore();
  const [v, setV] = useState(value);
  const [ranges, setRanges] = useState<{ weekday: number; opensAt: string; closesAt: string }[] | null>(null);
  const [pauseMin, setPauseMin] = useState('');
  useEffect(() => {
    api<typeof ranges>('/admin/business-hours').then((r) => setRanges(r!.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt }))));
  }, []);
  const saveRanges = async () => {
    try {
      await api('/admin/business-hours', { method: 'PUT', body: ranges });
      toast('Horários salvos.');
      void reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  if (!ranges) return <Spinner />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="card p-5">
        <h2 className="mb-1 text-xl font-bold">Horário por dia da semana</h2>
        <p className="mb-3 text-xs text-ink-700">Adicione mais de um período no mesmo dia para intervalos (ex.: 11:00–14:00 e 18:00–23:00). Fechamento menor que a abertura = vira a madrugada. Dia sem período = fechado.</p>
        {WEEKDAYS.map((d, wd) => (
          <div key={d} className="flex flex-wrap items-center gap-2 border-b border-black/5 py-2">
            <span className="w-20 font-semibold">{d}</span>
            {ranges.map((r, i) => r.weekday === wd && (
              <span key={i} className="flex items-center gap-1">
                <input type="time" className="input w-28 py-1" value={r.opensAt} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)))} />
                –
                <input type="time" className="input w-28 py-1" value={r.closesAt === '24:00' ? '23:59' : r.closesAt} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)))} />
                <button className="text-brand-700" onClick={() => setRanges(ranges.filter((_, j) => j !== i))} aria-label="Remover período"><Trash2 size={14} /></button>
              </span>
            ))}
            <button className="btn-ghost btn-sm" onClick={() => setRanges([...ranges, { weekday: wd, opensAt: '18:00', closesAt: '23:00' }])}><Plus size={14} /></button>
          </div>
        ))}
        <button className="btn-primary mt-3" onClick={saveRanges}>Salvar horários</button>
      </div>
      <div className="card space-y-3 p-5">
        <h2 className="text-xl font-bold">Pausa e regras</h2>
        <Toggle checked={v.paused} onChange={(x) => setV({ ...v, paused: x, pausedUntil: x ? v.pausedUntil : null })} label="Pausar pedidos agora" />
        {v.paused && (
          <Field label="Retomar automaticamente em (min)" hint="Em branco = até desativar a pausa">
            <input className="input" type="number" min={1} value={pauseMin} onChange={(e) => setPauseMin(e.target.value)} />
          </Field>
        )}
        <Toggle checked={v.acceptOutsideHours} onChange={(x) => setV({ ...v, acceptOutsideHours: x })} label="Aceitar pedidos fora do expediente" />
        <Toggle checked={v.acceptScheduled} onChange={(x) => setV({ ...v, acceptScheduled: x })} label="Aceitar pedidos agendados" />
        <Field label="Mensagem de loja fechada"><textarea className="input" value={v.closedMessage} onChange={(e) => setV({ ...v, closedMessage: e.target.value })} /></Field>
        <button className="btn-primary" onClick={() => onSave({ ...v, pausedUntil: v.paused && pauseMin ? new Date(Date.now() + Number(pauseMin) * 60_000).toISOString() : v.paused ? v.pausedUntil : null })}>Salvar</button>
      </div>
    </div>
  );
}

function PaymentTab({ value, onSave }: { value: S; onSave: (v: S) => void }) {
  const [v, setV] = useState(value);
  const LABELS: Record<string, string> = { PIX: 'PIX', CASH: 'Dinheiro', DEBIT: 'Cartão de débito', CREDIT: 'Cartão de crédito', IN_PERSON: 'Pagamento presencial' };
  return (
    <div className="card grid max-w-3xl gap-3 p-5 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <p className="label">Formas aceitas</p>
        {Object.keys(LABELS).map((k) => <div key={k}><Toggle checked={v.methods[k]} onChange={(x) => setV({ ...v, methods: { ...v.methods, [k]: x } })} label={LABELS[k]} /></div>)}
      </div>
      <Field label="Tipo da chave PIX">
        <select className="input" value={v.pixKeyType} onChange={(e) => setV({ ...v, pixKeyType: e.target.value })}>
          <option value="">Selecione</option><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="EMAIL">E-mail</option><option value="PHONE">Telefone</option><option value="RANDOM">Aleatória</option>
        </select>
      </Field>
      <Field label="Chave PIX"><input className="input" value={v.pixKey} onChange={(e) => setV({ ...v, pixKey: e.target.value })} /></Field>
      <Field label="Nome do favorecido"><input className="input" value={v.pixHolderName} onChange={(e) => setV({ ...v, pixHolderName: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Instruções exibidas ao cliente"><textarea className="input" value={v.pixInstructions} onChange={(e) => setV({ ...v, pixInstructions: e.target.value })} /></Field></div>
      <p className="text-xs text-ink-700 sm:col-span-2">Pagamentos PIX são confirmados manualmente pelo atendente. A arquitetura está preparada para um gateway com cobrança dinâmica e confirmação por webhook (veja a documentação).</p>
      <div><button className="btn-primary" onClick={() => onSave(v)}>Salvar</button></div>
    </div>
  );
}

const MSG_LABELS: Record<string, string> = {
  ORDER_RECEIVED: 'Pedido recebido', ORDER_ACCEPTED: 'Pedido aceito', ORDER_PREPARING: 'Em preparação', ORDER_READY: 'Pronto',
  ORDER_OUT_FOR_DELIVERY: 'Saiu para entrega', ORDER_DELIVERED: 'Entregue', ORDER_CANCELED: 'Cancelado',
};

function MessagesTab({ value, onSave }: { value: S; onSave: (v: S) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="card max-w-3xl space-y-4 p-5">
      <p className="text-sm text-ink-700">Marcadores: [NOME], [NÚMERO], [RESUMO], [VALOR], [TEMPO], [MOTIVO], [STATUS], [LINK], [WHATSAPP] (número da loja). Usados nas notificações internas e no envio manual por WhatsApp. O envio automático usa os templates aprovados configurados em Integrações.</p>
      {Object.keys(MSG_LABELS).map((k) => (
        <Field key={k} label={MSG_LABELS[k]}><textarea className="input min-h-24 font-mono text-sm" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
      ))}
      <button className="btn-primary" onClick={() => onSave(v)}>Salvar</button>
    </div>
  );
}

interface Coupon { id: string; code: string; type: 'PERCENT' | 'FIXED'; value: number; validFrom: string | null; validUntil: string | null; maxUses: number | null; usedCount: number; minOrderCents: number | null; active: boolean }

function Coupons() {
  const toast = useToast();
  const [list, setList] = useState<Coupon[] | null>(null);
  const [edit, setEdit] = useState<{ id?: string; code: string; type: 'PERCENT' | 'FIXED'; value: string; validFrom: string; validUntil: string; maxUses: string; min: string; active: boolean } | null>(null);
  const load = useCallback(() => api<Coupon[]>('/admin/coupons').then(setList), []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (!edit) return;
    try {
      const body = {
        code: edit.code,
        type: edit.type,
        value: edit.type === 'PERCENT' ? Number(edit.value) : parseBRL(edit.value) ?? 0,
        validFrom: edit.validFrom ? new Date(edit.validFrom).toISOString() : null,
        validUntil: edit.validUntil ? new Date(edit.validUntil).toISOString() : null,
        maxUses: edit.maxUses ? Number(edit.maxUses) : null,
        minOrderCents: money(edit.min),
        active: edit.active,
      };
      await api(edit.id ? `/admin/coupons/${edit.id}` : '/admin/coupons', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  if (!list) return <Spinner />;
  return (
    <div className="card max-w-3xl p-5">
      <div className="mb-3 flex justify-between">
        <h2 className="text-xl font-bold">Cupons de desconto</h2>
        <button className="btn-ghost btn-sm" onClick={() => setEdit({ code: '', type: 'PERCENT', value: '10', validFrom: '', validUntil: '', maxUses: '', min: '', active: true })}><Plus size={14} /> Cupom</button>
      </div>
      <ul className="divide-y divide-black/5 text-sm">
        {list.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2">
            <button className={`text-left ${c.active ? '' : 'opacity-50'}`} onClick={() => setEdit({ id: c.id, code: c.code, type: c.type, value: c.type === 'PERCENT' ? String(c.value) : centsToInput(c.value), validFrom: local(c.validFrom), validUntil: local(c.validUntil), maxUses: c.maxUses ? String(c.maxUses) : '', min: centsToInput(c.minOrderCents), active: c.active })}>
              <span className="font-mono font-bold">{c.code}</span> · {c.type === 'PERCENT' ? `${c.value}%` : brl(c.value)} · usado {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ''}
            </button>
            <button className="text-brand-700" onClick={() => window.confirm('Excluir cupom?') && api(`/admin/coupons/${c.id}`, { method: 'DELETE' }).then(load)}><Trash2 size={14} /></button>
          </li>
        ))}
        {!list.length && <li className="py-2 text-ink-700">Nenhum cupom.</li>}
      </ul>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title="Cupom" footer={<button className="btn-primary w-full" onClick={save}>Salvar</button>}>
          <div className="space-y-3">
            <Field label="Código"><input className="input uppercase" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Tipo">
              <select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as 'PERCENT' })}><option value="PERCENT">Percentual (%)</option><option value="FIXED">Valor fixo (R$)</option></select>
            </Field>
            <Field label={edit.type === 'PERCENT' ? 'Percentual' : 'Valor (R$)'}><input className="input" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></Field>
            <Field label="Válido a partir de"><input type="datetime-local" className="input" value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} /></Field>
            <Field label="Válido até"><input type="datetime-local" className="input" value={edit.validUntil} onChange={(e) => setEdit({ ...edit, validUntil: e.target.value })} /></Field>
            <Field label="Limite de usos"><input className="input" type="number" min={1} value={edit.maxUses} onChange={(e) => setEdit({ ...edit, maxUses: e.target.value })} /></Field>
            <Field label="Pedido mínimo (R$)"><input className="input" value={edit.min} onChange={(e) => setEdit({ ...edit, min: e.target.value })} /></Field>
            <Toggle checked={edit.active} onChange={(x) => setEdit({ ...edit, active: x })} label="Ativo" />
          </div>
        </Modal>
      )}
    </div>
  );
}
