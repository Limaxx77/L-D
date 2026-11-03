import http from 'node:http';
import { env } from './env';
import { prisma } from './db';
import { allowedOrigins, createApp } from './app';
import { initRealtime } from './realtime';
import { retryDueNotifications } from './services/whatsapp';

const app = createApp();
const server = http.createServer(app);
initRealtime(server, allowedOrigins());

server.listen(env.PORT, () => {
  console.log(`Pastel L&D API ouvindo na porta ${env.PORT} (${env.NODE_ENV})`);
});

// Reenvio de notificações WhatsApp com falha temporária
const retryTimer = setInterval(() => {
  retryDueNotifications().catch((e) => console.error('Falha no reenvio de notificações', e));
}, 60_000);

async function shutdown(signal: string) {
  console.log(`${signal} recebido, encerrando...`);
  clearInterval(retryTimer);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
