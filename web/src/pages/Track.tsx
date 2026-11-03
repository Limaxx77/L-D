import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../lib/socket';
import { useStore, useToast } from '../lib/context';
import { brl, dateTime, PAYMENT_LABELS, time } from '../lib/format';
import type { OrderStatus, PublicOrder } from '../lib/types';
import { Spinner, StatusBadge } from '../components/ui';
import { WhatsAppButton } from '../components/brand';

const STEPS: Record<string, OrderStatus[]> = {
  DELIVERY: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  PICKUP: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'],
  TABLE: ['AWAITING_ACCEPT', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'],
};
const LABEL: Record<string, string> = {
  AWAITING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  PREPARING: 'Em preparação',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  PICKED_UP: 'Retirado',
  SERVED: 'Entregue na mesa',
};

export default function Track() {
  const { token = '' } = useParams();
  const { info } = useStore();
  const toast = useToast();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    api<PublicOrder>(`/public/orders/track/${token}`)
      .then((o) => {
        setOrder(o);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [token]);

  useEffect(() => {
    load();
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    const poll = setInterval(load, 45_000); // segurança caso o tempo real caia
    return () => {
      clearInterval(t);
      clearInterval(poll);
    };
  }, [load]);

  useSocket(
    async () => ({ orderToken: token }),
    {
      'order:status': (o: PublicOrder) => {
        setOrder((prev) => {
          if (prev && prev.status !== o.status) {
            const msg = `Pedido #${o.number}: ${o.statusLabel}`;
            toast(msg, o.status === 'CANCELED' ? 'error' : 'ok');
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Pastel L&D', { body: msg, icon: '/icons/icon-192.png' });
          }
          return o;
        });
      },
      $connect: () => load(),
    },
    [token],
  );

  if (error) return <p className="p-10 text-center font-semibold text-brand-700">{error}</p>;
  if (!order) return <Spinner label="Carregando pedido..." />;

  const steps = STEPS[order.type];
  const currentIdx = steps.indexOf(order.status);
  const canceled = order.status === 'CANCELED';
  const eta = order.acceptedAt && order.estimatedMinutes ? new Date(new Date(order.acceptedAt).getTime() + order.estimatedMinutes * 60_000) : null;
  const minutesLeft = eta ? Math.max(0, Math.ceil((eta.getTime() - Date.now()) / 60_000)) : null;
  const done = ['DELIVERED', 'PICKED_UP', 'SERVED'].includes(order.status);

  const cancel = async () => {
    if (!window.confirm('Cancelar este pedido?')) return;
    try {
      setOrder(await api<PublicOrder>(`/public/orders/track/${token}/cancel`, { body: {} }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="card overflow-hidden">
        <div className={`p-6 text-white ${canceled ? 'bg-brand-700' : done ? 'bg-green-700' : 'bg-ink-900'}`}>
          <p className="text-sm opacity-80">Pedido #{order.number} · {dateTime(order.createdAt)}</p>
          <h1 className="mt-1 text-3xl font-extrabold">{canceled ? 'Pedido cancelado' : order.statusLabel}</h1>
          {order.status === 'AWAITING_ACCEPT' && <p className="mt-1 opacity-90">Recebemos seu pedido! Aguarde a confirmação da loja.</p>}
          {eta && !canceled && !done && (
            <p className="mt-3 flex items-center gap-2 text-lg font-bold text-gold-300">
              <Clock /> Previsão: {time(eta)} {minutesLeft !== null && minutesLeft > 0 ? `(~${minutesLeft} min)` : ''}
            </p>
          )}
          {order.scheduledFor && <p className="mt-2 font-semibold text-gold-300">Agendado para {dateTime(order.scheduledFor)}</p>}
        </div>
        {canceled ? (
          <div className="flex gap-3 p-6">
            <XCircle className="shrink-0 text-brand-600" />
            <div>
              <p className="font-semibold">Motivo: {order.cancelReason}</p>
              {order.paymentStatus === 'REFUND_PENDING' && <p className="mt-1 text-sm">Seu pagamento será estornado. Em caso de dúvidas, fale conosco.</p>}
            </div>
          </div>
        ) : (
          <ol className="space-y-3 p-6">
            {steps.map((s, i) => {
              const h = order.history.find((x) => x.status === s);
              const reached = i <= currentIdx;
              return (
                <li key={s} className="flex items-center gap-3">
                  {reached ? <CheckCircle2 className="text-green-600" /> : <Circle className="text-black/20" />}
                  <span className={`flex-1 ${reached ? 'font-bold' : 'text-black/40'} ${i === currentIdx ? 'text-brand-600' : ''}`}>
                    {s === 'READY' && order.type === 'PICKUP' ? 'Pronto para retirada' : LABEL[s]}
                  </span>
                  {h && <span className="text-sm text-black/50">{time(h.at)}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-2 text-xl font-extrabold">Itens</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((i) => (
            <li key={i.id} className={`flex justify-between gap-3 ${i.canceled ? 'line-through opacity-50' : ''}`}>
              <div>
                <p className="font-semibold">
                  {i.quantity}x {i.name}
                </p>
                {i.description && <p className="text-ink-700">{i.description}</p>}
                {i.notes && <p className="text-xs italic text-ink-700">Obs.: {i.notes}</p>}
              </div>
              <span className="font-semibold">{brl(i.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-black/5 pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{brl(order.grossCents)}</dd></div>
          {order.comboSavingsCents > 0 && <div className="flex justify-between text-green-700"><dt>Desconto dos combos</dt><dd>- {brl(order.comboSavingsCents)}</dd></div>}
          {order.discountCents > 0 && <div className="flex justify-between text-green-700"><dt>Cupom {order.couponCode}</dt><dd>- {brl(order.discountCents)}</dd></div>}
          {order.type === 'DELIVERY' && <div className="flex justify-between"><dt>Taxa de entrega</dt><dd>{order.deliveryFeeCents ? brl(order.deliveryFeeCents) : 'Grátis'}</dd></div>}
          <div className="flex justify-between pt-1 text-lg font-extrabold"><dt>Total</dt><dd>{brl(order.totalCents)}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>Pagamento: <strong>{PAYMENT_LABELS[order.paymentMethod]}</strong></span>
          <StatusBadge status={order.paymentStatus === 'PAID' ? 'DELIVERED' : order.paymentStatus === 'PENDING' ? 'AWAITING_ACCEPT' : 'CANCELED'} label={order.paymentStatus === 'PAID' ? 'Pago' : order.paymentStatus === 'PENDING' ? 'A confirmar' : order.paymentStatus === 'REFUND_PENDING' ? 'Estorno pendente' : 'Estornado'} />
          {order.changeForCents && <span>· Troco para {brl(order.changeForCents)}</span>}
        </div>
        {order.paymentMethod === 'PIX' && order.paymentStatus === 'PENDING' && !canceled && info?.payment.pixKey && (
          <div className="mt-3 rounded-2xl bg-gold-50 p-4 text-sm">
            <p>Chave PIX: <strong className="break-all">{info.payment.pixKey}</strong></p>
            <p className="mt-1 text-ink-700">{info.payment.pixInstructions}</p>
            <p className="mt-1 text-xs text-ink-700">O pagamento é confirmado manualmente pelo atendente.</p>
          </div>
        )}
        {order.address && (
          <p className="mt-3 text-sm text-ink-700">
            Entrega em: {order.address.street}, {order.address.number} — {order.address.neighborhood}
            {order.address.complement ? ` (${order.address.complement})` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <WhatsAppButton text={`Olá! Gostaria de falar sobre meu pedido #${order.number}.`} />
        {order.status === 'AWAITING_ACCEPT' && (
          <button className="btn-danger" onClick={cancel}>
            Cancelar pedido
          </button>
        )}
      </div>
    </div>
  );
}
