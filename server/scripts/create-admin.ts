/**
 * Cria ou atualiza um administrador.
 * Uso: tsx scripts/create-admin.ts "<email>" "<senha>" ["Nome"]
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [emailArg, password, name = 'Administrador'] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  if (!email || !password) throw new Error('Informe e-mail e senha.');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, roleKey: 'ADMIN', passwordHash },
    // tokenVersion incrementado encerra sessões abertas com a senha antiga
    update: { passwordHash, roleKey: 'ADMIN', active: true, tokenVersion: { increment: 1 } },
  });
  await prisma.auditLog.create({ data: { actor: 'system', action: 'user.createAdminScript', entity: 'user', entityId: user.id, data: { email } } });
  console.log(`Administrador pronto: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
