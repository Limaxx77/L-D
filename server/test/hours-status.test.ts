import { describe, expect, it } from 'vitest';
import { isWithinHours, openState, startOfLocalDay } from '../src/lib/hours';
import { canAdvance, nextStatus, statusLabel } from '../src/lib/orderStatus';
import { renderMessage } from '../src/lib/messages';
import { normalizePhoneBR } from '../src/lib/money';

const TZ = 'America/Cuiaba'; // UTC-4

describe('horário de funcionamento', () => {
  const ranges = [
    { weekday: 1, opensAt: '11:00', closesAt: '14:00' }, // segunda, almoço
    { weekday: 1, opensAt: '18:00', closesAt: '23:00' }, // segunda, noite (intervalo)
    { weekday: 5, opensAt: '18:00', closesAt: '02:00' }, // sexta, até a madrugada
  ];
  it('respeita intervalos e o fuso da loja', () => {
    // 2026-11-02 é segunda-feira. 12:00 em Cuiabá = 16:00 UTC
    expect(isWithinHours(new Date('2026-11-02T16:00:00Z'), ranges, TZ)).toBe(true);
    expect(isWithinHours(new Date('2026-11-02T19:00:00Z'), ranges, TZ)).toBe(false); // 15:00 local, intervalo
    expect(isWithinHours(new Date('2026-11-02T23:30:00Z'), ranges, TZ)).toBe(true); // 19:30 local
  });
  it('turno que atravessa a meia-noite', () => {
    // sábado 2026-11-07 01:00 local = 05:00 UTC → ainda turno de sexta
    expect(isWithinHours(new Date('2026-11-07T05:00:00Z'), ranges, TZ)).toBe(true);
    expect(isWithinHours(new Date('2026-11-07T07:00:00Z'), ranges, TZ)).toBe(false);
  });
  it('pausa temporária fecha a loja', () => {
    const now = new Date('2026-11-02T16:00:00Z');
    expect(openState(now, ranges, TZ, { paused: true, pausedUntil: null }).reason).toBe('PAUSED');
    expect(openState(now, ranges, TZ, { paused: true, pausedUntil: '2026-11-02T15:00:00Z' }).open).toBe(true);
  });
  it('início do dia local', () => {
    expect(startOfLocalDay(new Date('2026-11-02T02:00:00Z'), TZ).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('status dos pedidos', () => {
  it('fluxos de delivery, retirada e mesa', () => {
    expect(nextStatus('DELIVERY', 'READY')).toBe('OUT_FOR_DELIVERY');
    expect(nextStatus('PICKUP', 'READY')).toBe('PICKED_UP');
    expect(statusLabel('PICKUP', 'READY')).toBe('Pronto para retirada');
    expect(nextStatus('TABLE', 'READY')).toBe('SERVED');
  });
  it('permissões por perfil', () => {
    expect(canAdvance('KITCHEN', 'DELIVERY', 'ACCEPTED', 'PREPARING')).toBe(true);
    expect(canAdvance('KITCHEN', 'DELIVERY', 'READY', 'OUT_FOR_DELIVERY')).toBe(false);
    expect(canAdvance('COURIER', 'DELIVERY', 'READY', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canAdvance('COURIER', 'DELIVERY', 'PREPARING', 'READY')).toBe(false);
    expect(canAdvance('ATTENDANT', 'DELIVERY', 'AWAITING_ACCEPT', 'ACCEPTED')).toBe(false); // exige rota de aceite
    expect(canAdvance('ADMIN', 'DELIVERY', 'DELIVERED', 'READY')).toBe(false); // não volta
  });
});

describe('mensagens e telefone', () => {
  it('substitui os marcadores', () => {
    const msg = renderMessage('Olá, [NOME]! Pedido #[NÚMERO] — R$ [VALOR] em [TEMPO] min. Motivo: [MOTIVO]', {
      NOME: 'Ana',
      NÚMERO: 42,
      VALOR: '65,00',
      TEMPO: 35,
      MOTIVO: 'Alta demanda',
    });
    expect(msg).toBe('Olá, Ana! Pedido #42 — R$ 65,00 em 35 min. Motivo: Alta demanda');
  });
  it('normaliza telefones brasileiros', () => {
    expect(normalizePhoneBR('(65) 99263-8816')).toBe('5565992638816');
    expect(normalizePhoneBR('+55 65 99263-8816')).toBe('5565992638816');
    expect(normalizePhoneBR('123')).toBeNull();
  });
});
