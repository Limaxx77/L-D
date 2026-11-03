import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bike, ShoppingBag, Store, Tag, Trash2 } from 'lucide-react';
import { useCart, useCustomer, useStore, useToast } from '../lib/context';
import { api, newIdempotencyKey } from '../lib/api';
import { brl, maskPhoneInput, parseBRL, PAYMENT_LABELS } from '../lib/format';
import type { PublicOrder, Quote } from '../lib/types';
import { Empty, Field, QtyStepper } from '../components/ui';
import { productImage } from '../components/menu';

export default function Cart() {
  const cart = useCart();
  const { info, reload } = useStore();
  const { customer } = useCustomer();
  const toast = useToast();
  const nav = useNavigate();

  const [type, setType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [optIn, setOptIn] = useState(true);
  const [addr, setAddr] = useState({ street: '', number: '', neighborhood: '', complement: '', reference: '', deliveryAreaId: '' });
  const [saveAddress, setSaveAddress] = useState(true);
  const [payment, setPayment] = useState('PIX');
  const [needChange, setNeedChange] = useState(false);
  const [changeFor, setChangeFor] = useState('');
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [notes, setNotes] = useState('');
  const [schedule, setSchedule] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (customer) {
      setName((n) => n || customer.name);
      setPhone((p) => p || maskPhoneInput(customer.phone.replace(/^55/, '')));
      setOptIn(customer.whatsappOptIn);
    }
  }, [customer]);

  useEffect(() => {
    if (!info) return;
    if (!info.delivery.enabled && info.delivery.pickupEnabled) setType('PICKUP');
    const first = Object.entries(info.payment.methods).find(([, v]) => v)?.[0];
    if (first && !info.payment.methods[payment]) setPayment(first);
  }, [info, payment]);

  const items = useMemo(() => cart.lines.map((l) => l.input), [cart.lines]);

  // Cotação oficial do servidor (preços, economia, cupom e taxa)
  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Quote>('/public/cart/quote', { body: { type, items, couponCode: appliedCoupon || null, deliveryAreaId: addr.deliveryAreaId || null }, signal: ctrl.signal })
        .then((q) => {
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') {
            setQuote(null);
            setQuoteError((e as Error).message);
          }
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [items, type, appliedCoupon, addr.deliveryAreaId]);

  if (!cart.lines.length)
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Empty icon={<ShoppingBag size={48} />} title="Seu carrinho está vazio">
          <p>Que tal um pastel quentinho?</p>
          <Link to="/cardapio" className="btn-primary mt-4">
            Ver cardápio
          </Link>
        </Empty>
      </div>
    );

  const closed = info && !info.open.open && !(info.open.reason === 'CLOSED' && info.acceptOutsideHours);
  const canSchedule = !!info?.acceptScheduled;
  const blockedByHours = closed && !(canSchedule && schedule);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privacy) return toast('Aceite a política de privacidade para continuar.', 'error');
    if (type === 'DELIVERY' && !addr.deliveryAreaId && !info?.delivery.allowOutsideArea) return toast('Selecione seu bairro.', 'error');
    setBusy(true);
    try {
      const order = await api<PublicOrder>('/public/orders', {
        idempotencyKey: idemKey.current,
        body: {
          type,
          items,
          customer: { name, phone },
          whatsappOptIn: optIn,
          address:
            type === 'DELIVERY'
              ? {
                  street: addr.street,
                  number: addr.number,
                  neighborhood: addr.neighborhood || info?.delivery.areas.find((a) => a.id === addr.deliveryAreaId)?.neighborhood || '',
                  complement: addr.complement || null,
                  reference: addr.reference || null,
                  deliveryAreaId: addr.deliveryAreaId || null,
                }
              : null,
          saveAddress: !!customer && saveAddress,
          paymentMethod: payment,
          changeForCents: payment === 'CASH' && needChange ? parseBRL(changeFor) : null,
          couponCode: appliedCoupon || null,
          notes: notes || null,
          scheduledFor: schedule ? new Date(schedule).toISOString() : null,
          privacyAccepted: true,
        },
      });
      try {
        localStorage.setItem('ld-last-order', JSON.stringify({ token: order.publicToken, number: order.number }));
      } catch {
        /* ignore */
      }
      cart.clear();
      idemKey.current = newIdempotencyKey();
      nav(`/pedido/${order.publicToken}`, { replace: true });
    } catch (err) {
      toast((err as Error).message, 'error');
      void reload(); // atualiza disponibilidade/preços
    } finally {
      setBusy(false);
    }
  };

  const areas = info?.delivery.areas ?? [];
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <section className="card p-5">
          <h1 className="mb-3 text-3xl font-extrabold">Seu carrinho</h1>
          <ul className="divide-y divide-black/5">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex gap-3 py-3">
                <img src={productImage({ imageUrl: l.imageUrl ?? null, kind: l.input.type === 'combo' ? 'PASTEL' : undefined })} alt="" className="h-16 w-16 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <p className="font-bold">{l.name}</p>
                    <p className="font-bold">{brl(l.unitPriceCents * l.input.quantity)}</p>
                  </div>
                  {l.description && <p className="text-sm text-ink-700">{l.description}</p>}
                  <p className="text-xs text-black/50">{brl(l.unitPriceCents)} cada</p>
                  <input className="input mt-2 py-1.5 text-sm" placeholder="Observações" maxLength={300} value={l.input.notes ?? ''} onChange={(e) => cart.setNotes(l.key, e.target.value)} />
                  <div className="mt-2 flex items-center justify-between">
                    <QtyStepper size="sm" value={l.input.quantity} min={1} max={l.input.type === 'combo' ? 10 : 50} onChange={(v) => cart.setQty(l.key, v)} />
                    <button type="button" className="rounded-xl p-2 text-brand-700 hover:bg-brand-50" onClick={() => cart.remove(l.key)} aria-label="Remover">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/cardapio" className="btn-ghost btn-sm mt-2">
            + Adicionar mais itens
          </Link>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-2xl font-extrabold">Como você quer receber?</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { v: 'DELIVERY' as const, icon: <Bike />, label: 'Delivery', on: info?.delivery.enabled },
              { v: 'PICKUP' as const, icon: <Store />, label: 'Retirar no local', on: info?.delivery.pickupEnabled },
            ].map((o) => (
              <button
                type="button"
                key={o.v}
                disabled={!o.on}
                onClick={() => setType(o.v)}
                className={`flex flex-col items-center gap-1 rounded-2xl p-4 font-bold ring-1 transition ${type === o.v ? 'bg-gold-50 ring-2 ring-gold-500' : 'ring-black/10'} disabled:opacity-40`}
              >
                {o.icon} {o.label}
                {!o.on && <span className="text-xs font-normal">Indisponível</span>}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-700">Na pastelaria? Use o QR Code ou cartão NFC da sua mesa para pedir direto da mesa.</p>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-2xl font-extrabold">Seus dados</h2>
          {!customer && (
            <p className="text-sm text-ink-700">
              Não precisa criar conta. <Link to="/conta" className="font-semibold text-brand-600 underline">Entrar</Link> para salvar endereços e repetir pedidos.
            </p>
          )}
          <Field label="Nome completo">
            <input className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Telefone / WhatsApp">
            <input className="input" required inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhoneInput(e.target.value))} placeholder="(65) 99999-9999" autoComplete="tel" />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            Aceito receber atualizações deste pedido pelo WhatsApp.
          </label>
        </section>

        {type === 'DELIVERY' && (
          <section className="card space-y-3 p-5">
            <h2 className="text-2xl font-extrabold">Endereço de entrega</h2>
            {customer?.addresses && customer.addresses.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customer.addresses.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className="btn-ghost btn-sm"
                    onClick={() => setAddr({ street: a.street, number: a.number, neighborhood: a.neighborhood, complement: a.complement ?? '', reference: a.reference ?? '', deliveryAreaId: a.deliveryAreaId ?? '' })}
                  >
                    {a.label || `${a.street}, ${a.number}`}
                  </button>
                ))}
              </div>
            )}
            <Field label="Bairro">
              <select className="input" required={!info?.delivery.allowOutsideArea} value={addr.deliveryAreaId} onChange={(e) => setAddr({ ...addr, deliveryAreaId: e.target.value, neighborhood: '' })}>
                <option value="">Selecione o bairro</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.neighborhood} — taxa {brl(a.feeCents)}
                  </option>
                ))}
              </select>
            </Field>
            {!areas.length && <p className="text-sm text-brand-700">A área de entrega ainda não foi configurada pela loja.</p>}
            {info?.delivery.allowOutsideArea && !addr.deliveryAreaId && (
              <Field label="Outro bairro">
                <input className="input" value={addr.neighborhood} onChange={(e) => setAddr({ ...addr, neighborhood: e.target.value })} />
              </Field>
            )}
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Rua">
                <input className="input" required value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} autoComplete="address-line1" />
              </Field>
              <Field label="Número">
                <input className="input" required value={addr.number} onChange={(e) => setAddr({ ...addr, number: e.target.value })} />
              </Field>
            </div>
            <Field label="Complemento">
              <input className="input" value={addr.complement} onChange={(e) => setAddr({ ...addr, complement: e.target.value })} placeholder="Apto, bloco..." />
            </Field>
            <Field label="Ponto de referência">
              <input className="input" value={addr.reference} onChange={(e) => setAddr({ ...addr, reference: e.target.value })} />
            </Field>
            {customer && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Salvar este endereço
              </label>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <section className="card space-y-3 p-5">
          <h2 className="text-2xl font-extrabold">Pagamento</h2>
          <div className="grid gap-2">
            {Object.entries(PAYMENT_LABELS)
              .filter(([k]) => info?.payment.methods[k])
              .map(([k, label]) => (
                <label key={k} className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${payment === k ? 'bg-gold-50 ring-2 ring-gold-500' : 'ring-black/10'}`}>
                  <input type="radio" name="payment" className="h-5 w-5 accent-brand-600" checked={payment === k} onChange={() => setPayment(k)} />
                  <span className="font-semibold">{k === 'IN_PERSON' ? (type === 'PICKUP' ? 'Pagar na retirada' : 'Pagar na entrega') : label}</span>
                </label>
              ))}
          </div>
          {payment === 'PIX' && info && (
            <div className="rounded-2xl bg-gold-50 p-4 text-sm">
              {info.payment.pixKey ? (
                <>
                  <p>
                    Chave PIX ({info.payment.pixKeyType || 'chave'}): <strong className="break-all">{info.payment.pixKey}</strong>
                  </p>
                  {info.payment.pixHolderName && <p>Favorecido: {info.payment.pixHolderName}</p>}
                  <p className="mt-1 text-ink-700">{info.payment.pixInstructions}</p>
                </>
              ) : (
                <p>A chave PIX será informada pelo atendente após o aceite do pedido.</p>
              )}
            </div>
          )}
          {payment === 'CASH' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={needChange} onChange={(e) => setNeedChange(e.target.checked)} /> Preciso de troco
              </label>
              {needChange && (
                <Field label="Troco para quanto?">
                  <input className="input" inputMode="decimal" placeholder="R$ 100,00" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} required />
                </Field>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-3 p-5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Tag size={16} className="absolute left-3 top-3.5 text-black/40" />
              <input className="input pl-9 uppercase" placeholder="Cupom de desconto" value={coupon} onChange={(e) => setCoupon(e.target.value)} maxLength={30} />
            </div>
            <button type="button" className="btn-ghost" onClick={() => setAppliedCoupon(coupon.trim().toUpperCase())}>
              Aplicar
            </button>
          </div>
          {quote?.couponError && appliedCoupon && <p className="text-sm font-semibold text-brand-700">{quote.couponError}</p>}
          <textarea className="input min-h-16" placeholder="Observações gerais do pedido" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {canSchedule && (
            <Field label="Agendar para (opcional)" hint="Deixe em branco para receber o quanto antes.">
              <input type="datetime-local" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
            </Field>
          )}

          <dl className="space-y-1.5 border-t border-black/5 pt-3 text-sm">
            {quoteError && <p className="font-semibold text-brand-700">{quoteError}</p>}
            {quote && (
              <>
                <Row label="Subtotal" value={brl(quote.grossCents)} />
                {quote.savingsCents > 0 && <Row label="Desconto dos combos/promoções" value={`- ${brl(quote.savingsCents)}`} tone="text-green-700" />}
                {quote.discountCents > 0 && <Row label={`Cupom ${appliedCoupon}`} value={`- ${brl(quote.discountCents)}`} tone="text-green-700" />}
                {type === 'DELIVERY' && <Row label="Taxa de entrega" value={quote.deliveryError ? '—' : quote.deliveryFeeCents === 0 ? (addr.deliveryAreaId ? 'Grátis' : 'Selecione o bairro') : brl(quote.deliveryFeeCents)} />}
                {quote.deliveryError && addr.deliveryAreaId && <p className="text-xs font-semibold text-brand-700">{quote.deliveryError}</p>}
                <div className="flex justify-between pt-2 text-xl font-extrabold">
                  <span>Total</span>
                  <span>{brl(quote.totalCents)}</span>
                </div>
              </>
            )}
          </dl>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
            <span>
              Li e aceito a{' '}
              <Link to="/privacidade" target="_blank" className="font-semibold underline">
                política de privacidade
              </Link>
              . Meus dados serão usados apenas para processar e entregar o pedido.
            </span>
          </label>

          {closed && <p className="rounded-2xl bg-brand-50 p-3 text-sm font-semibold text-brand-700">{info?.closedMessage}</p>}
          <button className="btn-primary w-full py-4 text-lg" disabled={busy || !quote || !!quoteError || (type === 'DELIVERY' && !!quote?.deliveryError) || !!blockedByHours}>
            {busy ? 'Enviando...' : `Confirmar pedido${quote ? ` · ${brl(quote.totalCents)}` : ''}`}
          </button>
        </section>
      </aside>
    </form>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`flex justify-between ${tone ?? ''}`}>
      <dt>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
