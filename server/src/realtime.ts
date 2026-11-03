import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { prisma } from './db';
import { verifyToken } from './middleware/auth';
import { sha256 } from './lib/crypto';

/**
 * Tempo real via Socket.IO.
 * Salas: "staff" (equipe), "kitchen", "courier:<id>", "order:<publicToken>", "session:<id>".
 */
let io: Server | null = null;

export function initRealtime(server: HttpServer, origins: string[]) {
  io = new Server(server, {
    cors: { origin: origins, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', async (socket) => {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    try {
      if (typeof auth.staffToken === 'string') {
        const p = verifyToken(auth.staffToken, 'rt');
        const user = p ? await prisma.user.findUnique({ where: { id: p.sub } }) : null;
        if (user && user.active && user.tokenVersion === p!.v) {
          if (user.roleKey === 'COURIER') socket.join(`courier:${user.id}`);
          else socket.join('staff');
        }
      }
      if (typeof auth.orderToken === 'string' && auth.orderToken.length <= 64) {
        const order = await prisma.order.findUnique({ where: { publicToken: auth.orderToken }, select: { id: true } });
        if (order) socket.join(`order:${auth.orderToken}`);
      }
      if (typeof auth.participantToken === 'string' && auth.participantToken.length <= 64) {
        const part = await prisma.tableParticipant.findUnique({
          where: { deviceTokenHash: sha256(auth.participantToken) },
          include: { session: { select: { id: true, status: true } } },
        });
        if (part && part.session.status !== 'CLOSED') socket.join(`session:${part.session.id}`);
      }
    } catch (e) {
      console.warn('Falha na autenticação do socket', (e as Error).message);
    }
    socket.emit('ready', { rooms: [...socket.rooms].filter((r) => r !== socket.id).length });
  });
  return io;
}

function emit(room: string, event: string, payload: unknown) {
  io?.to(room).emit(event, payload);
}

export const realtime = {
  staff: (event: string, payload: unknown) => emit('staff', event, payload),
  courier: (userId: string, event: string, payload: unknown) => emit(`courier:${userId}`, event, payload),
  order: (publicToken: string, event: string, payload: unknown) => emit(`order:${publicToken}`, event, payload),
  session: (sessionId: string, event: string, payload: unknown) => emit(`session:${sessionId}`, event, payload),
};
