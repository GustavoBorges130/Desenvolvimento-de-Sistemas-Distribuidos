import { FILA_TRANSACOES, ROTAS } from '../mensageria/topologia.js';
import { validarEvento } from '../notificacoes/modelos.js';

const ETAPA = {
  [ROTAS.TRANSACAO_RECEBIDA]: 'III',
  [ROTAS.TRANSACAO_CONFIRMADA]: 'VI',
};

/**
 * Consumidor da fila `notificacoes.transacoes`.
 *
 * - prefetch 1: as mensagens são tratadas uma de cada vez, na ordem em que chegaram,
 *   então o aviso de "solicitação recebida" sempre sai antes do "pagamento confirmado".
 * - ack manual: a mensagem só é removida da fila depois que a notificação foi enviada
 *   e registrada. Mensagens inválidas vão direto para a DLQ; as que falham no envio
 *   voltam para a fila uma vez e, se falharem de novo, vão para a DLQ.
 */
export async function iniciarConsumidorEventosTransacao({ canal, servico, logger }) {
  return canal.consume(
    FILA_TRANSACOES,
    async (msg) => {
      const rota = msg.fields.routingKey;
      const etapa = ETAPA[rota] ? `[${ETAPA[rota]}] ` : '';

      let evento;
      try {
        evento = JSON.parse(msg.content.toString('utf8'));
      } catch {
        logger.error(`mensagem em ${FILA_TRANSACOES} não é um JSON válido; enviada para a DLQ`);
        canal.nack(msg, false, false);
        return;
      }

      const erros = validarEvento(evento);
      if (erros.length > 0) {
        logger.error(`evento inválido em ${FILA_TRANSACOES} (${erros.join('; ')}); enviado para a DLQ`);
        canal.nack(msg, false, false);
        return;
      }

      const transacaoId = evento.dados.transacaoId;
      logger.info(`${etapa}mensagem ${evento.tipo} lida da fila ${FILA_TRANSACOES} (transação ${transacaoId})`);

      try {
        const { notificacao, duplicada } = await servico.processarEvento(evento);
        if (duplicada) {
          logger.info(`evento ${evento.id} já havia sido notificado; mensagem repetida ignorada`);
        } else {
          logger.info(`${etapa}notificação "${notificacao.assunto}" enviada para ${notificacao.destinatario}`);
        }
        canal.ack(msg);
      } catch (erro) {
        // Falha após as retentativas (SMTP ou banco fora do ar): devolve para a fila uma vez
        // e, se falhar de novo, manda para a DLQ para não travar as demais mensagens.
        const requeue = !msg.fields.redelivered;
        logger.error(
          `não foi possível notificar o evento ${evento.id} (${requeue ? 'devolvida à fila' : 'enviada para a DLQ'})`,
          erro,
        );
        canal.nack(msg, false, requeue);
      }
    },
    { prefetch: 1 },
  );
}
