import { allocateByWeights } from './money';
import { badRequest } from './errors';

/**
 * Divisão de conta de mesa. Sempre fecha exatamente com o total da comanda:
 * cada item é rateado pelo método do maior resto, em ordem determinística
 * (ordem de entrada dos participantes).
 */

export type SplitMode = 'CONSUMPTION' | 'EQUAL' | 'CUSTOM';

export interface SplitParticipant {
  id: string;
  name: string;
}

export interface SplitItem {
  id: string;
  name: string;
  totalCents: number;
  allocations: { participantId: string; weight: number }[];
}

export interface SplitConfig {
  /** EQUAL: participantes que dividem a conta (padrão: todos). */
  participantIds?: string[];
  /** CUSTOM: pesos por item que substituem a atribuição original. */
  items?: Record<string, Record<string, number>>;
}

export interface SplitInput {
  participants: SplitParticipant[];
  items: SplitItem[];
  mode: SplitMode;
  config?: SplitConfig | null;
  /** Pagamentos confirmados já atribuídos a participantes. */
  paid: { participantId: string; amountCents: number }[];
  /** Pagamentos confirmados sem participante (pagamento "da mesa"). */
  unassignedPaidCents?: number;
}

export interface ParticipantShare {
  participantId: string;
  name: string;
  dueCents: number;
  paidCents: number;
  remainingCents: number;
  items: { itemId: string; name: string; amountCents: number }[];
}

export interface SplitResult {
  mode: SplitMode;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  shares: ParticipantShare[];
}

export function computeSplit(input: SplitInput): SplitResult {
  const { participants, items, mode } = input;
  const config = input.config ?? {};
  const order = new Map(participants.map((p, i) => [p.id, i]));
  const byOrder = <T extends { participantId: string }>(a: T, b: T) =>
    (order.get(a.participantId) ?? 0) - (order.get(b.participantId) ?? 0);

  const shares = new Map<string, ParticipantShare>(
    participants.map((p) => [p.id, { participantId: p.id, name: p.name, dueCents: 0, paidCents: 0, remainingCents: 0, items: [] }]),
  );
  const totalCents = items.reduce((s, i) => s + i.totalCents, 0);

  if (participants.length === 0) {
    const paid = input.unassignedPaidCents ?? 0;
    return { mode, totalCents, paidCents: paid, remainingCents: totalCents - paid, shares: [] };
  }

  if (mode === 'EQUAL') {
    const ids = (config.participantIds?.length ? config.participantIds : participants.map((p) => p.id)).filter((id) =>
      shares.has(id),
    );
    if (ids.length === 0) throw badRequest('SPLIT_INVALID', 'Selecione ao menos uma pessoa para dividir.');
    ids.sort((a, b) => order.get(a)! - order.get(b)!);
    const parts = allocateByWeights(totalCents, ids.map((id) => ({ key: id, weight: 1 })));
    for (const [id, cents] of parts) shares.get(id)!.dueCents = cents;
  } else {
    const everyone = participants.map((p) => ({ participantId: p.id, weight: 1 }));
    for (const item of items) {
      let allocs = item.allocations;
      if (mode === 'CUSTOM' && config.items?.[item.id]) {
        allocs = Object.entries(config.items[item.id])
          .filter(([pid, w]) => shares.has(pid) && Number.isInteger(w) && w > 0)
          .map(([participantId, weight]) => ({ participantId, weight }));
      }
      allocs = allocs.filter((a) => shares.has(a.participantId) && a.weight > 0);
      // Item sem responsável válido: rateio igual entre todos, para o total sempre fechar.
      if (allocs.length === 0) allocs = everyone;
      const parts = allocateByWeights(
        item.totalCents,
        [...allocs].sort(byOrder).map((a) => ({ key: a.participantId, weight: a.weight })),
      );
      for (const [pid, cents] of parts) {
        const s = shares.get(pid)!;
        s.dueCents += cents;
        if (cents > 0) s.items.push({ itemId: item.id, name: item.name, amountCents: cents });
      }
    }
  }

  let paidCents = input.unassignedPaidCents ?? 0;
  for (const p of input.paid) {
    paidCents += p.amountCents;
    const s = shares.get(p.participantId);
    if (s) s.paidCents += p.amountCents;
  }
  for (const s of shares.values()) s.remainingCents = s.dueCents - s.paidCents;

  return {
    mode,
    totalCents,
    paidCents,
    remainingCents: totalCents - paidCents,
    shares: participants.map((p) => shares.get(p.id)!),
  };
}
