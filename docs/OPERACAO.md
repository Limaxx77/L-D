# Operação e itens que dependem de serviços externos

## Pronto para uso

| Área | Situação |
|---|---|
| Pedidos delivery/retirada/mesa, status em tempo real | Funcional |
| Aceite com prazo, recusa com motivo, alerta sonoro e notificação no navegador | Funcional |
| Divisão de conta (consumo, igualitária, personalizada), pagamentos parciais | Funcional |
| Catálogo, combos, fotos (com recorte), cupons, horários, bairros | Funcional |
| Financeiro, relatórios, CSV/PDF, despesas e lucro estimado | Funcional |
| Perfis e permissões no backend, auditoria | Funcional |
| PWA instalável | Funcional (exige HTTPS em produção) |

## Depende de configuração externa

| Item | O que falta | Sem isso |
|---|---|---|
| WhatsApp automático | Conta Meta, número na Cloud API, token, templates aprovados — veja [WHATSAPP.md](WHATSAPP.md) | Envio manual pelo botão wa.me; notificações internas funcionam |
| Armazenamento das fotos em produção | Bucket S3/R2 ou disco persistente — veja [DEPLOY.md](DEPLOY.md) | No Render sem disco, as fotos somem a cada deploy |
| PIX dinâmico (QR com valor e confirmação automática) | Contratar um gateway (Mercado Pago, Efí, Asaas, PagSeguro...) | PIX por chave, com confirmação manual pelo atendente |
| Impressora térmica | Impressora configurada no computador/tablet do balcão | Impressão usa o diálogo do navegador (layout 80 mm) |

## PIX dinâmico — onde encaixar

O modelo de dados já prevê: `payments.provider`, `payments.providerRef` e `status` (`PENDING` → `CONFIRMED`). Para integrar um gateway:

1. Ao criar o pedido com PIX, chamar a API do gateway, criar o `Payment` com `status=PENDING`, `provider` e `providerRef` (id da cobrança) e devolver o QR/copia-e-cola ao cliente.
2. Criar a rota de webhook do gateway em `server/src/app.ts`, validar a assinatura e, ao confirmar, marcar o pagamento como `CONFIRMED` e o pedido como `PAID`.
3. Nunca marcar como pago sem a confirmação do gateway (o sistema hoje só marca com confirmação do atendente).

## Rotina sugerida

- **Abertura:** entrar no painel, clicar em **Ativar alertas** (o navegador exige um clique para liberar o som), conferir a disponibilidade dos produtos.
- **Durante o expediente:** use **Pausar pedidos** em Configurações → Horários quando a demanda estiver alta.
- **Fechamento:** conferir em Mesas que todas estão livres e, em Financeiro, os pendentes e os estornos.

## Privacidade (LGPD)

- Coleta apenas o necessário para o pedido; a autorização para WhatsApp é opcional e registrada.
- Entregadores veem somente as entregas atribuídas a eles; a cozinha não acessa clientes nem financeiro.
- Cada consulta de cliente no painel é registrada em auditoria.
- O cliente pode excluir a conta em **Minha conta**: os dados pessoais são anonimizados e os registros financeiros mantidos sem identificação.
- Ao cadastrar uma conta com telefone de pedidos anteriores feitos como visitante, esses pedidos **não** aparecem na conta (o telefone não é verificado por código). Para unir o histórico, implemente verificação por código (SMS/WhatsApp).
