import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/context';
import { dateTime, formatPhone } from '../lib/format';
import { Field, Spinner, Toggle } from '../components/ui';
import { PageTitle } from './AdminApp';

interface Info {
  enabled: boolean;
  ready: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  config: { phoneNumberId: string; businessAccountId: string; displayPhone: string; templates: Record<string, { name: string; language: string; enabled: boolean }> };
  hasToken: boolean;
  tokenSource: 'env' | 'database' | null;
  webhook: { url: string; verifyTokenConfigured: boolean; appSecretConfigured: boolean };
  events: { event: string; label: string; params: string[] }[];
  stats: { status: string; count: number }[];
}
interface Notif { id: string; event: string; toPhone: string; status: string; skipReason: string | null; lastError: string | null; attempts: number; createdAt: string; order: { number: number } | null }

interface MetaTemplate { name: string; status: string; language: string; rejected_reason?: string }
const META_STATUS_PT: Record<string, string> = { APPROVED: 'Aprovado', PENDING: 'Em análise', REJECTED: 'Rejeitado', PAUSED: 'Pausado', DISABLED: 'Desativado' };

const STATUS_PT: Record<string, string> = { PENDING: 'Pendente', SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida', FAILED: 'Falhou', SKIPPED: 'Não enviada' };

export default function Integrations() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [form, setForm] = useState<Info['config'] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState('');
  const [testTo, setTestTo] = useState('');
  const [history, setHistory] = useState<Notif[]>([]);
  const [filter, setFilter] = useState('');
  const [defs, setDefs] = useState<Record<string, { name: string; body: string }> | null>(null);
  const [metaStatus, setMetaStatus] = useState<MetaTemplate[] | null>(null);
  const [submitResult, setSubmitResult] = useState<{ event: string; name: string; status: string; error?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const i = await api<Info>('/admin/integrations/whatsapp');
    setInfo(i);
    setForm(i.config);
    setEnabled(i.enabled);
  }, []);
  const loadHistory = useCallback(() => api<{ items: Notif[] }>(`/admin/integrations/whatsapp/notifications${filter ? `?status=${filter}` : ''}`).then((r) => setHistory(r.items)), [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  useEffect(() => {
    api<Record<string, { name: string; body: string }>>('/admin/integrations/whatsapp/templates/definitions').then(setDefs).catch(() => {});
  }, []);
  if (!info || !form) return <Spinner />;

  const fillDefaults = async () => {
    try {
      const config = await api<Info['config']>('/admin/integrations/whatsapp/templates/defaults', { body: {} });
      setForm(config);
      toast('Templates padrão preenchidos.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const submitToMeta = async () => {
    if (!window.confirm('Enviar os 7 templates para aprovação na sua conta do WhatsApp Business?')) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; error?: string; results?: typeof submitResult }>('/admin/integrations/whatsapp/templates/submit', { body: {} });
      if (!r.ok) toast(r.error ?? 'Falha ao enviar.', 'error');
      else {
        setSubmitResult(r.results ?? null);
        toast('Templates enviados. A Meta costuma responder em minutos ou algumas horas.');
        void load();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const checkStatus = async () => {
    const r = await api<{ ok: boolean; error?: string; templates?: MetaTemplate[] }>('/admin/integrations/whatsapp/templates/status');
    if (!r.ok) toast(r.error ?? 'Falha ao consultar.', 'error');
    else setMetaStatus(r.templates ?? []);
  };

  const save = async () => {
    try {
      const r = await api<{ ready: boolean }>('/admin/integrations/whatsapp', { method: 'PUT', body: { enabled, config: form, ...(token ? { accessToken: token } : {}) } });
      setToken('');
      toast(r.ready ? 'Integração ativa.' : 'Salvo. A integração ainda está incompleta.');
      void load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const test = async () => {
    const r = await api<{ ok: boolean; error?: string }>('/admin/integrations/whatsapp/test', { body: { to: testTo } }).catch((e) => ({ ok: false, error: (e as Error).message }));
    toast(r.ok ? 'Mensagem de teste aceita pela API do WhatsApp.' : `Falha: ${r.error}`, r.ok ? 'ok' : 'error');
    void load();
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Integrações — WhatsApp" />
      <div className="card border-l-4 border-[#25D366] p-4 text-sm">
        <p className="font-bold">Modo simples (recomendado para começar): WhatsApp com um clique</p>
        <p className="mt-1">
          Não precisa de conta na Meta nem de aprovação. Com <strong>“Avisar no WhatsApp: ligado”</strong> (botão no topo do painel), ao aceitar, recusar ou mudar o status de um pedido o
          WhatsApp abre já com a mensagem pronta para o cliente — é só tocar em <strong>Enviar</strong>. A mensagem sai do WhatsApp instalado no aparelho do atendente (celular, WhatsApp Web ou Desktop).
        </p>
        <p className="mt-1 text-ink-700">Os textos são editados em Configurações → Mensagens. Abre automaticamente só para clientes que autorizaram; o botão verde do pedido envia em qualquer caso.</p>
        <p className="mt-1 text-ink-700">A configuração abaixo (API oficial) é opcional e só é necessária se você quiser envio 100% automático, sem tocar em Enviar.</p>
      </div>
      <div className={`card flex items-start gap-3 p-4 ${info.ready ? 'border-l-4 border-green-600' : 'border-l-4 border-gold-500'}`}>
        {info.ready ? <CheckCircle2 className="text-green-600" /> : <AlertTriangle className="text-gold-600" />}
        <div className="text-sm">
          <p className="font-bold">{info.ready ? 'Envio automático ativo (WhatsApp Cloud API oficial)' : 'Envio automático NÃO configurado'}</p>
          {!info.ready && <p>Nenhuma mensagem automática é enviada. O sistema continua funcionando com notificações internas e o botão de envio manual (link wa.me) em cada pedido.</p>}
          {info.lastError && <p className="text-brand-700">Último erro: {info.lastError}</p>}
          {info.lastCheckedAt && <p className="text-ink-700">Último teste: {dateTime(info.lastCheckedAt)} ({info.status})</p>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h2 className="text-xl font-bold">Credenciais</h2>
          <Toggle checked={enabled} onChange={setEnabled} label="Ativar envio automático" />
          <Field label="Número comercial exibido"><input className="input" value={form.displayPhone} onChange={(e) => setForm({ ...form, displayPhone: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Phone Number ID (identificador do número)" hint="Código numérico da Meta — não é o telefone. Meta for Developers → seu app → WhatsApp → Configuração da API."><input className="input font-mono" inputMode="numeric" placeholder="Ex.: 106540352242922" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="WhatsApp Business Account ID" hint="Código numérico da conta (WABA) — na mesma tela, abaixo do Phone Number ID."><input className="input font-mono" inputMode="numeric" placeholder="Ex.: 102938475610293" value={form.businessAccountId} onChange={(e) => setForm({ ...form, businessAccountId: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field
            label="Token de acesso permanente"
            hint={info.tokenSource === 'env' ? 'Definido por variável de ambiente no servidor (prioritário).' : info.hasToken ? 'Token salvo (criptografado). Preencha só para substituir.' : 'Fica criptografado no servidor e nunca é exibido novamente.'}
          >
            <input className="input font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={info.hasToken ? '••••••••' : 'EAAG...'} disabled={info.tokenSource === 'env'} />
          </Field>
          <button className="btn-primary" onClick={save}>Salvar</button>
          <div className="border-t border-black/5 pt-3">
            <p className="label">Testar envio (template hello_world)</p>
            <div className="flex gap-2">
              <input className="input" placeholder="Telefone de teste" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              <button className="btn-ghost" onClick={test}>Testar</button>
            </div>
          </div>
        </div>
        <div className="card space-y-3 p-5 text-sm">
          <h2 className="text-xl font-bold">Webhook</h2>
          <p>Configure no painel da Meta (WhatsApp → Configuração → Webhook):</p>
          <p className="break-all rounded-xl bg-gold-50 p-2 font-mono">{info.webhook.url}</p>
          <p>Token de verificação: {info.webhook.verifyTokenConfigured ? '✅ definido (WHATSAPP_VERIFY_TOKEN)' : '❌ defina WHATSAPP_VERIFY_TOKEN no servidor'}</p>
          <p>Assinatura das chamadas: {info.webhook.appSecretConfigured ? '✅ validada (WHATSAPP_APP_SECRET)' : '❌ defina WHATSAPP_APP_SECRET no servidor'}</p>
          <p className="text-ink-700">Assine o campo “messages” para receber os status de entrega e leitura.</p>
          <h3 className="pt-2 font-bold">Resumo (30 dias)</h3>
          <div className="flex flex-wrap gap-2">{info.stats.map((s) => <span key={s.status} className="chip bg-black/5">{STATUS_PT[s.status]}: {s.count}</span>)}</div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-xl font-bold">Templates de mensagens</h2>
        <p className="mb-3 text-sm text-ink-700">Mensagens iniciadas pela empresa exigem templates aprovados pela Meta (categoria “Utilidade”, idioma pt_BR). Crie cada template com as variáveis do corpo na ordem indicada e informe o nome exato aqui. Mensagens só são enviadas a clientes que autorizaram no pedido.</p>
        <div className="space-y-2">
          {info.events.map((ev) => {
            const t = form.templates[ev.event] ?? { name: '', language: 'pt_BR', enabled: false };
            const set = (patch: Partial<typeof t>) => setForm({ ...form, templates: { ...form.templates, [ev.event]: { ...t, ...patch } } });
            const meta = metaStatus?.find((m) => m.name === t.name);
            return (
              <div key={ev.event} className="rounded-2xl p-3 ring-1 ring-black/10">
                <div className="grid items-center gap-2 md:grid-cols-[1.2fr_1fr_6rem_auto]">
                  <div>
                    <p className="font-semibold">
                      {ev.label}{' '}
                      {meta && <span className={`chip ${meta.status === 'APPROVED' ? 'bg-green-100 text-green-800' : meta.status === 'REJECTED' ? 'bg-brand-100 text-brand-700' : 'bg-gold-100 text-gold-700'}`}>{META_STATUS_PT[meta.status] ?? meta.status}</span>}
                    </p>
                    <p className="text-xs text-ink-700">{ev.params.map((p, i) => `{{${i + 1}}}=${p}`).join(' · ')}</p>
                  </div>
                  <input className="input py-1.5 font-mono text-sm" placeholder="nome_do_template" value={t.name} onChange={(e) => set({ name: e.target.value.trim() })} />
                  <input className="input py-1.5 text-sm" value={t.language} onChange={(e) => set({ language: e.target.value.trim() })} />
                  <Toggle checked={t.enabled} onChange={(v) => set({ enabled: v })} />
                </div>
                {defs?.[ev.event] && t.name === defs[ev.event].name && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-gold-50 p-2 font-sans text-xs text-ink-800">{defs[ev.event].body}</pre>
                )}
                {meta?.rejected_reason && meta.rejected_reason !== 'NONE' && <p className="mt-1 text-xs text-brand-700">Motivo da rejeição: {meta.rejected_reason}</p>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={save}>Salvar templates</button>
          <button className="btn-ghost" onClick={fillDefaults}>Preencher templates padrão</button>
          <button className="btn-gold" onClick={submitToMeta} disabled={busy}>{busy ? 'Enviando...' : 'Enviar para aprovação na Meta'}</button>
          <button className="btn-ghost" onClick={checkStatus}>Ver status de aprovação</button>
        </div>
        {submitResult && (
          <ul className="mt-3 space-y-1 text-sm">
            {submitResult.map((r) => <li key={r.name}><span className="font-mono">{r.name}</span>: <strong>{r.status}</strong>{r.error ? ` — ${r.error}` : ''}</li>)}
          </ul>
        )}
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Histórico de envios</h2>
          <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(STATUS_PT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-ink-700"><tr><th className="py-1">Data</th><th>Pedido</th><th>Evento</th><th>Para</th><th>Status</th><th>Detalhe</th><th /></tr></thead>
          <tbody className="divide-y divide-black/5">
            {history.map((n) => (
              <tr key={n.id}>
                <td className="py-1.5">{dateTime(n.createdAt)}</td>
                <td>{n.order ? `#${n.order.number}` : '—'}</td>
                <td>{n.event}</td>
                <td>{formatPhone(n.toPhone)}</td>
                <td>{STATUS_PT[n.status]}{n.attempts > 1 ? ` (${n.attempts}x)` : ''}</td>
                <td className="text-xs text-ink-700">{n.skipReason || n.lastError}</td>
                <td>{n.status === 'FAILED' && <button className="btn-ghost btn-sm" onClick={() => api(`/admin/integrations/whatsapp/notifications/${n.id}/retry`, { body: {} }).then(loadHistory).catch((e) => toast(e.message, 'error'))}><RefreshCw size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
