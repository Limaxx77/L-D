import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Sobe um PostgreSQL embutido (PGlite) para os testes de integração,
 * aplica as migrações reais e expõe a URL para o Prisma.
 * Para testar contra um Postgres de verdade, defina TEST_DATABASE_URL.
 */
let server: PGLiteSocketServer | null = null;
let db: PGlite | null = null;

export async function setup() {
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-uploads-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PUBLIC_APP_URL: 'http://localhost:5173',
    PUBLIC_API_URL: 'http://localhost:4000',
    UPLOAD_DIR: uploads,
    STORAGE_DRIVER: 'local',
  });
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }
  db = await PGlite.create();
  const dir = path.join(__dirname, '..', 'prisma', 'migrations');
  for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  }
  const port = 55432 + Math.floor(Math.random() * 1000);
  server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=1&pool_timeout=30`;
}

export async function teardown() {
  await server?.stop();
  await db?.close();
}
