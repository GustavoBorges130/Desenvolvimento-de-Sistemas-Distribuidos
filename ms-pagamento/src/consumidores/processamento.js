import { FILA_PROCESSAMENTO } from '../mensageria/topologia.js';
import { comRetentativas } from '../util.js';

/**
 * Consumidor da fila `pagamentos.processamento` (ligada ao evento transacao.recebida).
 *
 * Etapa IV do fluxo: autoriza a cobrança no gateway (simulado) e atualiza a
 * transação para SUCESSO. A etapa V (publicar transacao.confirmada) é feita pela
 * outbox, gravada na mesma transação do banco.
 *
 * O consumo é feito com confirmação manual (ack): a mensagem só sai da fila depois
 * que o banco foi atualizado. Se o serviço cair no meio, o RabbitMQ entrega de novo.
 */
export async function iniciarConsumidorProcessamento({ canal, servico, gateway, logger, prefetch }) {
  return canal.consume(
    FILA_PROCESSAMENTO,
    async (msg) => {
      let evento;
      try {
        evento = JSON.parse(msg.content.toString('utf8'));
      } catch {
        logger.error(`mensagem inválida em ${FILA_PROCESSAMENTO}; enviada para a DLQ`);
        canal.nack(msg, false, false);
        return;
      }

      const transacaoId = evento?.dados?.transacaoId;
      try {
        const atual = await servico.buscarPorId(transacaoId);
        if (!atual) {
          logger.warn(`transação ${transacaoId} não encontrada; mensagem enviada para a DLQ`);
          canal.nack(msg, false, false);
          return;
        }
        if (atual.status !== 'PENDENTE') {
          // Mensagem repetida (at-least-once): a transação já foi confirmada, nada a fazer.
          logger.info(`transação ${transacaoId} já está ${atual.status}; mensagem repetida ignorada`);
          canal.ack(msg);
          return;
        }

        logger.info(`[IV] autorizando a transação ${transacaoId} no gateway de pagamento...`);
        const { codigoAutorizacao } = await gateway.autorizar(atual);

        const confirmada = await comRetentativas(() => servico.confirmar(transacaoId, codigoAutorizacao), {
          aoFalhar: (erro, n) => logger.warn(`falha ao confirmar ${transacaoId} (tentativa ${n}): ${erro.message}`),
        });
        if (confirmada) {
          logger.info(`[IV] transação ${transacaoId} confirmada: status atualizado para SUCESSO (${codigoAutorizacao})`);
        } else {
          logger.info(`transação ${transacaoId} já havia sido confirmada por outra entrega da mensagem`);
        }
        canal.ack(msg);
      } catch (erro) {
        // Erro inesperado (ex.: banco indisponível): devolve para a fila uma vez antes de ir para a DLQ.
        const requeue = !msg.fields.redelivered;
        logger.error(
          `erro ao processar a transação ${transacaoId} (${requeue ? 'devolvida à fila' : 'enviada para a DLQ'})`,
          erro,
        );
        canal.nack(msg, false, requeue);
      }
    },
    { prefetch },
  );
}
