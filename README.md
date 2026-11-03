# Pastel L&D — plataforma de delivery, cardápio digital e mesas

> **Fase de testes:** o WhatsApp configurado na loja é o número de teste **(87) 98107-6022**. O número oficial **(65) 99263-8816** ainda não é usado; para ativá-lo, altere em `/admin` → Configurações → Loja (e o padrão em `server/src/lib/settings.ts` e `web/src/components/brand.tsx`).

Sistema completo da **Pastel L&D**: delivery, retirada, pedidos na mesa por **cartão NFC / QR Code**, divisão de contas, painel administrativo em tempo real, catálogo com fotos, financeiro e integração com o WhatsApp oficial.

| Pasta | O que é |
|---|---|
| `server/` | API Node.js + Express + TypeScript, PostgreSQL (Prisma), Socket.IO (tempo real) |
| `web/` | Site/PWA React + TypeScript + Tailwind (cliente, mesa e `/admin`) |
| `docs/` | Deploy, WhatsApp, NFC e operação |

## Funcionalidades

**Cliente** — página inicial, cardápio com combos em destaque, montagem de combos com sabores livres, carrinho com cálculo feito no servidor (subtotal, economia dos combos, cupom, taxa por bairro), pedido como visitante ou com conta, PIX/dinheiro com troco/cartões, pedido agendado (opcional), acompanhamento em tempo real, favoritos, repetir pedido com preços atuais, exclusão de conta (LGPD).

**Mesa (NFC/QR)** — cada mesa tem um link com token aleatório (não é o número da mesa); várias pessoas entram, cada uma pede pelo próprio celular, é possível adicionar quem não tem celular, itens compartilhados com frações, comanda ao vivo, divisão **por consumo, igualitária ou personalizada** (centavos fecham exatamente), solicitação de fechamento.

**Painel `/admin`** — dashboard com indicadores e gráficos; quadro de pedidos (Aguardando → Aceitos → Preparando → Prontos → Finalizados) com alerta sonoro, aceite com prazo e recusa com motivo obrigatório; tela da cozinha com letras grandes; tela do entregador; mesas e comandas (pagamentos parciais, comprovante, transferência, correção auditada, bloqueio de fechamento com saldo); produtos, combos e categorias com upload de foto (galeria, câmera ou computador, com recorte); clientes; financeiro (faturamento ≠ lucro, despesas, lucro estimado) com exportação CSV/PDF; relatórios; NFC e QR Codes (PNG/SVG, impressão, gravação direta no Chrome Android); configurações (loja, bairros/taxas, horários com intervalos e pausa, PIX, mensagens, cupons); integração WhatsApp; usuários e perfis; auditoria.

**Perfis** (checados no backend): Administrador, Atendente, Cozinha, Entregador.

## Rodando localmente

Requisitos: Node.js 20+.

```bash
npm install
cp server/.env.example server/.env      # preencha JWT_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
```

Para desenvolvimento sem instalar PostgreSQL, use o banco embutido (PGlite) e a URL indicada no `.env.example`:

```bash
npm run dev:db -w server            # terminal 1 — deixe aberto
npm run migrate:deploy -w server    # aplica as migrações
npm run seed -w server              # cardápio, 8 combos, 5 mesas e o administrador
npm run dev -w server               # terminal 2 — API em http://localhost:4000
npm run dev -w web                  # terminal 3 — site em http://localhost:5173
```

Acesse `http://localhost:5173` (site) e `http://localhost:5173/admin` (painel).

> **Windows:** o caractere `&` no nome da pasta (`L&D`) quebra os atalhos `.cmd` do npm. Renomeie a pasta (ex.: `pastel-ld`) ou rode os comandos pelo Git Bash.

**Primeiros passos no painel:** cadastre os horários (sem horários a loja aparece fechada), os bairros atendidos com as taxas, a chave PIX e troque as fotos ilustrativas pelas fotos reais. Revise as descrições dos pastéis: elas foram deixadas neutras, sem afirmar ingredientes.

## Testes

```bash
npm test -w server
```

52 testes: regras de preço e combos, cupons, taxa de entrega, divisão de conta (exemplo da Mesa 03 = R$ 50,00), horários com intervalos/madrugada, permissões e **testes de integração HTTP contra PostgreSQL com as migrações reais** (cenários A, B e C, idempotência de pedidos simultâneos, aceite concorrente, limite diário de combos, estoque, upload real de imagem, QR Code, CSV/PDF).

Os testes usam um PostgreSQL embutido de conexão única. Para exercitar travas e concorrência em um PostgreSQL de verdade: `TEST_DATABASE_URL=postgresql://... npm test -w server` (use um banco vazio, só para testes).

## Segurança (resumo)

- Preços **sempre recalculados no servidor**; valores históricos gravados em cada item.
- Senhas com bcrypt; sessão em cookie `httpOnly` + `SameSite`; proteção CSRF por cabeçalho; rate limiting; Helmet.
- Validação com Zod em todas as rotas; Prisma (consultas parametrizadas); React escapa a saída.
- Permissões aplicadas no backend; operações críticas em `audit_logs`.
- Idempotência (`Idempotency-Key`) em pedidos e pagamentos; transições de status atômicas (sem processamento duplo).
- Credenciais do WhatsApp só no backend (variável de ambiente ou criptografadas com AES-256-GCM).
- Imagens validadas pelo conteúdo, convertidas para WebP e sem metadados (GPS/EXIF).

## Documentação

- [docs/DEPLOY.md](docs/DEPLOY.md) — Vercel + Render + PostgreSQL + armazenamento de fotos, backups
- [docs/WHATSAPP.md](docs/WHATSAPP.md) — ativar a WhatsApp Cloud API oficial e os templates
- [docs/NFC.md](docs/NFC.md) — gravar os cartões NFC e imprimir os QR Codes
- [docs/OPERACAO.md](docs/OPERACAO.md) — o que depende de serviço externo e como funciona cada fluxo
