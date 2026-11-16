import { FILA_SOLICITACOES } from '../mensageria/topologia.js';
import { validarChaveIdempotencia, validarSolicitacao } from '../transacoes/validacao.js';

/**
 * Interface AMQP do serviço de pagamento: outros serviços (por exemplo, um futuro
 * serviço de pedidos) podem solicitar uma transação publicando uma mensagem na fila
 * `pagamentos.solicitacoes`, com o mesmo JSON aceito pelo POST /transacoes.
 *
 * - messageId da mensagem é usado como chave de idempotência;
 * - se a mensagem tiver replyTo, o serviço responde com o id e o status da transação
 *   (padrão request/reply), usando o mesmo correlationId.
 */
export async function iniciarConsumidorSolicitacoes({ canal, servico, logger }) {
  return canal.consume(
    FILA_SOLICITACOES,
    async (msg) => {
      const { messageId, replyTo, correlationId } = msg.properties;

      const responder = async (corpo) => {
        if (!replyTo) return;
        await canal.sendToQueue(replyTo, Buffer.from(JSON.stringify(corpo)), {
          contentType: 'application/json',
          correlationId: correlationId ?? messageId,
        });
      };

      let corpo;
      try {
        corpo = JSON.parse(msg.content.toString('utf8'));
      } catch {
        logger.warn(`mensagem em ${FILA_SOLICITACOES} não é um JSON válido; enviada para a DLQ`);
        await responder({ erro: 'mensagem não é um JSON válido' }).catch(() => {});
        canal.nack(msg, false, false);
        return;
      }

      const validacao = validarSolicitacao(corpo);
      const chave = validarChaveIdempotencia(messageId ?? corpo.chaveIdempotencia);
      if (!validacao.valido || !chave.valido) {
        const erros = [...(validacao.erros ?? []), ...(chave.erros ?? [])];
        logger.warn(`solicitação AMQP inválida (${erros.join('; ')}); enviada para a DLQ`);
        await responder({ erro: 'solicitação inválida', detalhes: erros }).catch(() => {});
        canal.nack(msg, false, false);
        return;
      }

      try {
        logger.info(`solicitação de transação recebida pela fila ${FILA_SOLICITACOES} (pedido ${validacao.dados.pedidoId})`);
        const { transacao } = await servico.solicitar(validacao.dados, { origem: 'AMQP', chaveIdempotencia: chave.chave });
        await responder({ transacaoId: transacao.id, status: transacao.status }).catch((erro) =>
          logger.warn(`não foi possível responder em ${replyTo}: ${erro.message}`),
        );
        canal.ack(msg);
      } catch (erro) {
        if (erro.status === 409) {
          logger.warn(`solicitação AMQP rejeitada: ${erro.message}`);
          await responder({ erro: erro.message }).catch(() => {});
          canal.nack(msg, false, false);
          return;
        }
        // Erro inesperado (ex.: banco indisponível): devolve para a fila uma vez antes de ir para a DLQ.
        const requeue = !msg.fields.redelivered;
        logger.error(`erro ao registrar solicitação AMQP (${requeue ? 'devolvida à fila' : 'enviada para a DLQ'})`, erro);
        canal.nack(msg, false, requeue);
      }
    },
    { prefetch: 10 },
  );
}
