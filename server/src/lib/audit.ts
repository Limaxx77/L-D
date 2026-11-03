import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db';

export interface Actor {
  kind: 'user' | 'customer' | 'participant' | 'system';
  id?: string;
  ip?: string;
}

export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  data?: Prisma.InputJsonValue,
  tx: Tx = prisma,
) {
  await tx.auditLog.create({
    data: {
      userId: actor.kind === 'user' ? actor.id : null,
      actor: actor.id ? `${actor.kind}:${actor.id}` : actor.kind,
      action,
      entity,
      entityId,
      data,
      ip: actor.ip,
    },
  });
}
