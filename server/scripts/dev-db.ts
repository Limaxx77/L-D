/**
 * Banco PostgreSQL local para DESENVOLVIMENTO, sem instalar nada (PGlite, dados em ./.devdb).
 * Em produção use um PostgreSQL de verdade (Render, Neon, Supabase...).
 *
 * Uso: npm run dev:db   (deixe rodando)  →  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable&connection_limit=1&pgbouncer=true
 */
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

async function main() {
  const port = Number(process.env.DEV_DB_PORT ?? 5433);
  const db = await PGlite.create(path.resolve(__dirname, '..', '.devdb'));
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  console.log(`PostgreSQL de desenvolvimento (PGlite) em 127.0.0.1:${port}`);
  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
