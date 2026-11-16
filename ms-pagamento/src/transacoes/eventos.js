import { randomUUID } from 'node:crypto';
import { ROTAS } from '../mensageria/topologia.js';

export const TIPOS_EVENTO = Object.freeze({
  TRANSACAO_RECEBIDA: 'TransacaoRecebida',
  TRANSACAO_CONFIRMADA: 'TransacaoConfirmada',
});

const ROTA_POR_TIPO = {
  [TIPOS_EVENTO.TRANSACAO_RECEBIDA]: ROTAS.TRANSACAO_RECEBIDA,
  [TIPOS_EVENTO.TRANSACAO_CONFIRMADA]: ROTAS.TRANSACAO_CONFIRMADA,
};

/**
 * Monta a mensagem publicada no RabbitMQ. O evento leva todos os dados de que o
 * serviço de notificação precisa, para que ele não dependa de consultar o serviço
 * de pagamento (autonomia entre os serviços).
 */
export function criarEvento(tipo, transacao) {
  const routingKey = ROTA_POR_TIPO[tipo];
  if (!routingKey) throw new Error(`tipo de evento desconhecido: ${tipo}`);

  return {
    routingKey,
    mensagem: {
      id: randomUUID(),
      tipo,
      versao: 1,
      origem: 'ms-pagamento',
      ocorridoEm: new Date().toISOString(),
      dados: {
        transacaoId: transacao.id,
        pedidoId: transacao.pedidoId,
        valor: transacao.valor,
        metodoPagamento: transacao.metodoPagamento,
        status: transacao.status,
        cliente: { ...transacao.cliente },
        criadaEm: transacao.criadaEm,
        confirmadaEm: transacao.confirmadaEm,
        codigoAutorizacao: transacao.codigoAutorizacao,
      },
    },
  };
}
