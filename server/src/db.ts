import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type Tx = Prisma.TransactionClient;

/** Executa uma transação com nova tentativa em caso de conflito de serialização/deadlock. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15000, maxWait: 10000 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const retriable = code === 'P2034' || /deadlock|could not serialize/i.test(String((e as Error).message));
      if (!retriable || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }
}
