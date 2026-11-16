// Topologia AMQP do serviço de notificação.
//
//   pagamentos.eventos (exchange topic, publicado pelo ms-pagamento)
//     ├─ transacao.recebida   ─┐
//     └─ transacao.confirmada ─┴→ notificacoes.transacoes (fila deste serviço)
//
//   notificacoes.dlx (exchange direct) → notificacoes.transacoes.dlq
//
// O serviço de notificação é dono da sua fila: ele a declara e a liga ao exchange.
// O exchange é declarado com as mesmas opções usadas pelo ms-pagamento, então
// qualquer um dos dois serviços pode subir primeiro.

export const EXCHANGE_EVENTOS_PAGAMENTO = 'pagamentos.eventos';
export const EXCHANGE_DLX = 'notificacoes.dlx';
export const FILA_TRANSACOES = 'notificacoes.transacoes';
export const FILA_TRANSACOES_DLQ = `${FILA_TRANSACOES}.dlq`;

export const ROTAS = Object.freeze({
  TRANSACAO_RECEBIDA: 'transacao.recebida',
  TRANSACAO_CONFIRMADA: 'transacao.confirmada',
});

export async function declararTopologia(canal) {
  await canal.assertExchange(EXCHANGE_EVENTOS_PAGAMENTO, 'topic', { durable: true });
  await canal.assertExchange(EXCHANGE_DLX, 'direct', { durable: true });

  await canal.assertQueue(FILA_TRANSACOES, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE_DLX,
      'x-dead-letter-routing-key': FILA_TRANSACOES_DLQ,
    },
  });
  await canal.assertQueue(FILA_TRANSACOES_DLQ, { durable: true });
  await canal.bindQueue(FILA_TRANSACOES_DLQ, EXCHANGE_DLX, FILA_TRANSACOES_DLQ);

  for (const rota of Object.values(ROTAS)) {
    await canal.bindQueue(FILA_TRANSACOES, EXCHANGE_EVENTOS_PAGAMENTO, rota);
  }
}
