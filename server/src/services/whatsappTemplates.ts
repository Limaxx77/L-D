import type { WhatsappEvent } from './whatsapp';

/**
 * Templates padrão da Pastel L&D para a WhatsApp Cloud API (categoria UTILITY, pt_BR).
 * As variáveis {{1}}, {{2}}... seguem EVENT_PARAMS (whatsapp.ts). Regras da Meta respeitadas:
 * corpo não começa nem termina com variável e cada template traz exemplos.
 */
export interface TemplateDef {
  name: string;
  body: string;
  example: string[];
}

export const TEMPLATE_LANGUAGE = 'pt_BR';

export const DEFAULT_TEMPLATES: Record<WhatsappEvent, TemplateDef> = {
  ORDER_RECEIVED: {
    name: 'pastelld_pedido_recebido',
    body: 'Olá, {{1}}! Recebemos seu pedido #{{2}} na Pastel L&D.\n\nItens: {{3}}\nTotal: R$ {{4}}\n\nAssim que a loja confirmar, avisaremos por aqui.',
    example: ['Maria', '125', '1x Combo Galera, 2x Refrigerante', '77,00'],
  },
  ORDER_ACCEPTED: {
    name: 'pastelld_pedido_aceito',
    body:
      'Olá, {{1}}! 🍕🥟\n\nSeu pedido na Pastel L&D foi ACEITO com sucesso!\n\nPedido: #{{2}}\n\nItens: {{3}}\n\nTotal: R$ {{4}}\n\nTempo estimado: {{5}} minutos.\n\nJá estamos preparando tudo com muito carinho!\n\nObrigado por escolher a Pastel L&D!',
    example: ['Maria', '125', '1x Combo Galera, 2x Refrigerante', '82,00', '35'],
  },
  ORDER_PREPARING: {
    name: 'pastelld_pedido_em_preparo',
    body: 'Olá, {{1}}! Seu pedido #{{2}} está em preparação. 🥟 Logo fica pronto!',
    example: ['Maria', '125'],
  },
  ORDER_READY: {
    name: 'pastelld_pedido_pronto',
    body: 'Olá, {{1}}! Seu pedido #{{2}} está {{3}}! 🎉',
    example: ['Maria', '125', 'pronto para retirada'],
  },
  ORDER_OUT_FOR_DELIVERY: {
    name: 'pastelld_pedido_saiu_entrega',
    body: 'Olá, {{1}}! Seu pedido #{{2}} saiu para entrega. 🛵 Em breve chega até você!',
    example: ['Maria', '125'],
  },
  ORDER_DELIVERED: {
    name: 'pastelld_pedido_entregue',
    body: 'Olá, {{1}}! Seu pedido #{{2}} foi finalizado. Obrigado por escolher a Pastel L&D! 💛',
    example: ['Maria', '125'],
  },
  ORDER_CANCELED: {
    name: 'pastelld_pedido_cancelado',
    body:
      'Olá, {{1}}.\n\nInfelizmente, não conseguimos aceitar seu pedido #{{2}} na Pastel L&D.\n\nMotivo: {{3}}.\n\nPedimos desculpas pelo inconveniente.\n\nCaso queira falar conosco: {{4}}.',
    example: ['Maria', '125', 'Produto indisponível', '(87) 98107-6022'],
  },
};
