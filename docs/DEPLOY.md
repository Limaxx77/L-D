# Deploy em produção

Arquitetura recomendada:

```
Cliente ──► Vercel (site/PWA)  ──/api, /uploads (rewrite)──► Render (API Node.js) ──► PostgreSQL
                └──────────── WebSocket direto (tempo real) ──────────┘        └──► Bucket S3/R2 (fotos)
```

O site chama `/api` no **próprio domínio**; a Vercel encaminha para o Render. Assim o cookie de login é do mesmo site (funciona no Safari/iPhone, que bloqueia cookies de terceiros). O WebSocket conecta direto ao Render com um token de curta duração.

## 1. Banco de dados (PostgreSQL)

Use o PostgreSQL do Render (o `render.yaml` já cria um), Neon ou Supabase. As migrações rodam automaticamente no deploy (`preDeployCommand`).

**Backups:** ative backups automáticos no provedor (Render: planos pagos têm backup diário e recuperação point-in-time). Faça também um dump semanal fora do provedor:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=pastelld-$(date +%F).dump
```

## 2. Armazenamento das fotos

O disco dos serviços do Render é apagado a cada deploy. Use **uma** destas opções:

- **Recomendado — Cloudflare R2** (ou AWS S3, Supabase Storage, Backblaze B2): crie um bucket com acesso público de leitura (domínio público ou `r2.dev`), gere uma chave de API com permissão de escrita e preencha `STORAGE_DRIVER=s3` e as variáveis `S3_*`.
- **Disco persistente do Render:** adicione um *Persistent Disk* montado em `/var/data`, use `STORAGE_DRIVER=local` e `UPLOAD_DIR=/var/data/uploads`.

## 3. Backend no Render

1. Envie o projeto para um repositório no GitHub.
2. Render → **New → Blueprint** → selecione o repositório (usa `render.yaml`).
3. Preencha as variáveis marcadas como `sync: false`:
   - `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **guarde uma cópia**; sem ela credenciais salvas no painel não podem ser lidas.
   - `PUBLIC_APP_URL` e `PUBLIC_API_URL`: o domínio do site (ex.: `https://pastelld.com.br`).
   - `CORS_ORIGINS`: outros domínios do site, como `https://pastel-ld.vercel.app`.
4. Após o primeiro deploy, crie o administrador pelo Shell do Render:
   ```bash
   ADMIN_EMAIL=voce@email.com ADMIN_PASSWORD='uma-senha-forte-aqui' npm run seed -w server
   ```
   O seed também cadastra o cardápio inicial, os 8 combos e as mesas 01–05. Pode ser executado de novo sem duplicar nada.

## 4. Frontend na Vercel

1. Vercel → **Add New Project** → importe o repositório → **Root Directory: `web`**.
2. Em `web/vercel.json`, troque `SEU-BACKEND.onrender.com` pelo endereço real da API (duas linhas).
3. Variáveis de ambiente: `VITE_SOCKET_URL=https://SEU-BACKEND.onrender.com` (deixe `VITE_API_URL` vazio).
4. Configure o domínio próprio (ex.: `pastelld.com.br`). HTTPS é automático na Vercel e no Render.

> O link dos cartões NFC/QR usa `PUBLIC_APP_URL`. Defina o domínio definitivo **antes** de gravar os cartões.

## 5. Conferência final

- `https://SEU-BACKEND.onrender.com/api/health` responde `{"ok":true}`.
- Entre em `/admin`, cadastre horários, bairros/taxas e a chave PIX.
- Faça um pedido de teste pelo celular e acompanhe o alerta no painel (clique em **Ativar alertas** para liberar o som).
- Troque as fotos ilustrativas pelas reais em Produtos e Combos.

## Logs e monitoramento

Erros da API aparecem nos logs do Render (com data, rota e detalhe). Recomenda-se configurar alertas de saúde no Render apontando para `/api/health`.

## Escala

A API guarda em memória apenas um cache de 15 s das configurações. Para rodar mais de uma instância, adicione o adaptador Redis do Socket.IO (`@socket.io/redis-adapter`) para que os eventos em tempo real cheguem a todas as instâncias.
