import { describe, expect, it } from 'vitest';
import { computeSplit } from '../src/lib/split';
import { allocateByWeights } from '../src/lib/money';

const people = [
  { id: 'leo', name: 'Leonardo' },
  { id: 'dan', name: 'Daniel' },
  { id: 'ped', name: 'Pedro' },
  { id: 'luc', name: 'Lucas' },
];

// Exemplo do enunciado: Mesa 03, total R$ 50,00
const items = [
  { id: 'i1', name: '2x Pastel de Carne', totalCents: 16_00, allocations: [{ participantId: 'leo', weight: 1 }] },
  { id: 'i2', name: '1x Pastel de Pizza', totalCents: 8_00, allocations: [{ participantId: 'dan', weight: 1 }] },
  { id: 'i3', name: '1x Pastel de Frango', totalCents: 8_00, allocations: [{ participantId: 'ped', weight: 1 }] },
  { id: 'i4', name: '1x Refrigerante', totalCents: 6_00, allocations: [{ participantId: 'ped', weight: 1 }] },
  { id: 'i5', name: '2x Refrigerante', totalCents: 12_00, allocations: [{ participantId: 'luc', weight: 1 }] },
];

const due = (r: ReturnType<typeof computeSplit>) => Object.fromEntries(r.shares.map((s) => [s.participantId, s.dueCents]));

describe('divisão de conta', () => {
  it('por consumo: cada um paga o que consumiu', () => {
    const r = computeSplit({ participants: people, items, mode: 'CONSUMPTION', paid: [] });
    expect(r.totalCents).toBe(50_00);
    expect(due(r)).toEqual({ leo: 16_00, dan: 8_00, ped: 14_00, luc: 12_00 });
  });

  it('igualitária fecha exatamente com o total (centavos determinísticos)', () => {
    const r = computeSplit({ participants: people.slice(0, 3), items: [{ id: 'x', name: 'x', totalCents: 100_00, allocations: [] }], mode: 'EQUAL', paid: [] });
    expect(due(r)).toEqual({ leo: 33_34, dan: 33_33, ped: 33_33 });
    expect(r.shares.reduce((s, x) => s + x.dueCents, 0)).toBe(100_00);
  });

  it('igualitária apenas entre participantes selecionados', () => {
    const r = computeSplit({ participants: people, items, mode: 'EQUAL', config: { participantIds: ['dan', 'leo'] }, paid: [] });
    expect(due(r)).toEqual({ leo: 25_00, dan: 25_00, ped: 0, luc: 0 });
  });

  it('personalizada: refrigerante compartilhado R$ 3,00 para cada', () => {
    const r = computeSplit({
      participants: people,
      items,
      mode: 'CUSTOM',
      config: { items: { i4: { leo: 1, dan: 1 } } },
      paid: [],
    });
    expect(due(r)).toEqual({ leo: 19_00, dan: 11_00, ped: 8_00, luc: 12_00 });
    expect(r.totalCents).toBe(50_00);
  });

  it('item compartilhado com frações (2/3 e 1/3) e combo dividido preservando o preço', () => {
    const r = computeSplit({
      participants: people.slice(0, 3),
      items: [{ id: 'combo', name: 'Combo Trio', totalCents: 34_00, allocations: [{ participantId: 'leo', weight: 1 }, { participantId: 'dan', weight: 1 }, { participantId: 'ped', weight: 1 }] }],
      mode: 'CONSUMPTION',
      paid: [],
    });
    expect(due(r)).toEqual({ leo: 11_34, dan: 11_33, ped: 11_33 });
    const f = allocateByWeights(10_00, [{ key: 'a', weight: 2 }, { key: 'b', weight: 1 }]);
    expect(f.get('a')! + f.get('b')!).toBe(10_00);
    expect(f.get('a')).toBe(6_67);
  });

  it('pagamentos parciais: mostra pago e saldo por pessoa e da mesa', () => {
    const r = computeSplit({
      participants: people,
      items,
      mode: 'CONSUMPTION',
      paid: [{ participantId: 'leo', amountCents: 16_00 }, { participantId: 'ped', amountCents: 10_00 }],
      unassignedPaidCents: 2_00,
    });
    expect(r.paidCents).toBe(28_00);
    expect(r.remainingCents).toBe(22_00);
    const leo = r.shares.find((s) => s.participantId === 'leo')!;
    const ped = r.shares.find((s) => s.participantId === 'ped')!;
    expect(leo.remainingCents).toBe(0);
    expect(ped.remainingCents).toBe(4_00);
  });

  it('item sem responsável é rateado entre todos (total sempre fecha)', () => {
    const r = computeSplit({ participants: people, items: [{ id: 'z', name: 'z', totalCents: 10_01, allocations: [] }], mode: 'CONSUMPTION', paid: [] });
    expect(r.shares.reduce((s, x) => s + x.dueCents, 0)).toBe(10_01);
  });

  it('resultado é estável para a mesma entrada', () => {
    const a = computeSplit({ participants: people, items, mode: 'EQUAL', paid: [] });
    const b = computeSplit({ participants: people, items, mode: 'EQUAL', paid: [] });
    expect(a).toEqual(b);
  });
});

describe('allocateByWeights', () => {
  it('distribui sobras de centavos pela ordem/maior resto', () => {
    for (const total of [1, 2, 99, 100, 101, 12345]) {
      for (const n of [1, 2, 3, 7]) {
        const r = allocateByWeights(total, Array.from({ length: n }, (_, i) => ({ key: i, weight: 1 })));
        const values = [...r.values()];
        expect(values.reduce((s, v) => s + v, 0)).toBe(total);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }
    }
  });
});
