# Integração com o WhatsApp (Cloud API oficial)

O sistema usa a **WhatsApp Business Platform — Cloud API** da Meta. Enquanto ela não estiver configurada:

- nenhuma mensagem automática é enviada, e o sistema **não afirma** que enviou;
- cada notificação fica registrada como "não enviada", com o motivo;
- o atendente pode enviar a mensagem pronta pelo botão **"Enviar status pelo WhatsApp (manual)"** no detalhe do pedido (abre o `wa.me` com o texto).

Mensagens automáticas só vão para clientes que marcaram **"Aceito receber atualizações pelo WhatsApp"** no pedido.

## O que é preciso (fora do sistema)

1. Conta no **Meta Business Manager** verificada.
2. Um app em **developers.facebook.com** com o produto **WhatsApp**.
3. O número **(65) 99263-8816** registrado na Cloud API.
   ⚠️ Um número registrado na Cloud API **deixa de funcionar no aplicativo WhatsApp/WhatsApp Business do celular**. Se a loja atende clientes pelo app nesse número, use outro número para as mensagens automáticas, ou use o recurso de coexistência oferecido pela Meta, se estiver disponível para a conta.
4. Um **usuário do sistema** com token permanente (permissões `whatsapp_business_messaging` e `whatsapp_business_management`).
5. Forma de pagamento cadastrada na conta do WhatsApp (mensagens de template são cobradas pela Meta).

## Configurar no servidor (Render)

| Variável | Onde encontrar |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token permanente do usuário do sistema |
| `WHATSAPP_APP_SECRET` | App → Configurações → Básico → Chave secreta do app |
| `WHATSAPP_VERIFY_TOKEN` | Um texto qualquer que você inventa (ex.: `pastelld-webhook-2026`) |

## Configurar no painel (`/admin` → Integrações WhatsApp)

1. Informe o **Phone Number ID** e o **WhatsApp Business Account ID** (WhatsApp → Configuração da API).
2. Ative **"Ativar envio automático"** e salve.
3. Use **Testar** com o seu número (template `hello_world`, que vem aprovado em contas novas).

## Webhook (status de entrega e leitura)

No app da Meta → WhatsApp → Configuração → Webhook:

- URL de callback: a exibida no painel (`https://SEU-BACKEND.onrender.com/api/webhooks/whatsapp`)
- Token de verificação: o mesmo de `WHATSAPP_VERIFY_TOKEN`
- Assine o campo **messages**

As chamadas são validadas pela assinatura `X-Hub-Signature-256`.

## Templates

Mensagens iniciadas pela empresa exigem templates aprovados. Crie no WhatsApp Manager (categoria **Utilidade**, idioma **Português (BR)**) e informe o nome de cada um no painel. As variáveis precisam estar **nesta ordem**:

| Evento | Variáveis | Sugestão de texto |
|---|---|---|
| Pedido recebido | {{1}} nome, {{2}} número, {{3}} itens, {{4}} total | Olá, {{1}}! Recebemos seu pedido #{{2}} na Pastel L&D. Itens: {{3}}. Total: R$ {{4}}. Aguarde a confirmação. |
| Pedido aceito | {{1}} nome, {{2}} número, {{3}} itens, {{4}} total, {{5}} minutos | Olá, {{1}}! 🍕🥟 Seu pedido na Pastel L&D foi ACEITO com sucesso! Pedido: #{{2}} Itens: {{3}} Total: R$ {{4}} Tempo estimado: {{5}} minutos. Já estamos preparando tudo com muito carinho! Obrigado por escolher a Pastel L&D! |
| Em preparação | {{1}} nome, {{2}} número | Olá, {{1}}! Seu pedido #{{2}} está em preparação. |
| Pronto | {{1}} nome, {{2}} número, {{3}} status | Olá, {{1}}! Seu pedido #{{2}} está {{3}}! |
| Saiu para entrega | {{1}} nome, {{2}} número | Olá, {{1}}! Seu pedido #{{2}} saiu para entrega. |
| Entregue | {{1}} nome, {{2}} número | Olá, {{1}}! Seu pedido #{{2}} foi finalizado. Obrigado! |
| Cancelado | {{1}} nome, {{2}} número, {{3}} motivo | Olá, {{1}}. Infelizmente, não conseguimos aceitar seu pedido #{{2}} na Pastel L&D. Motivo: {{3}}. Pedimos desculpas pelo inconveniente. Caso queira falar conosco: (65) 99263-8816. |

Os textos usados no envio manual e nas notificações internas são editados em **Configurações → Mensagens**.

## Reenvio e falhas

Falhas temporárias (erro 5xx ou limite de taxa) são reenviadas automaticamente até 5 vezes, com espera crescente. Em **Integrações → Histórico de envios** é possível ver cada tentativa e reenviar manualmente as que falharam.
