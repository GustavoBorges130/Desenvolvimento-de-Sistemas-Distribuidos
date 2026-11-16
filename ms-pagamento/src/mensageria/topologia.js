// Nomes de exchanges, filas e routing keys usados pelo serviço de pagamento.
//
//   pagamentos.eventos (exchange topic) — eventos publicados por este serviço
//     ├─ transacao.recebida   → consumido pelo ms-notificacao (etapa III)
//     │                         e por este serviço, na fila de processamento (etapa IV)
//     └─ transacao.confirmada → consumido pelo ms-notificacao (etapa VI)
//
//   pagamentos.solicitacoes (fila) — interface AMQP para solicitar transações
//   pagamentos.processamento (fila) — trabalho interno: autorizar e confirmar transações
//   pagamentos.dlx (exchange direct) → filas *.dlq com mensagens que não puderam ser processadas

export const EXCHANGE_EVENTOS = 'pagamentos.eventos';
export const EXCHANGE_DLX = 'pagamentos.dlx';

export const ROTAS = Object.freeze({
  TRANSACAO_RECEBIDA: 'transacao.recebida',
  TRANSACAO_CONFIRMADA: 'transacao.confirmada',
});

export const FILA_SOLICITACOES = 'pagamentos.solicitacoes';
export const FILA_PROCESSAMENTO = 'pagamentos.processamento';

const argumentosComDlq = (fila) => ({
  'x-dead-letter-exchange': EXCHANGE_DLX,
  'x-dead-letter-routing-key': `${fila}.dlq`,
});

/**
 * Declara exchanges, filas e ligações. É idempotente e roda a cada (re)conexão.
 * O exchange de eventos também é declarado pelo ms-notificacao, com as mesmas opções,
 * para que os serviços possam subir em qualquer ordem.
 */
export async function declararTopologia(canal) {
  await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
  await canal.assertExchange(EXCHANGE_DLX, 'direct', { durable: true });

  for (const fila of [FILA_SOLICITACOES, FILA_PROCESSAMENTO]) {
    await canal.assertQueue(fila, { durable: true, arguments: argumentosComDlq(fila) });
    await canal.assertQueue(`${fila}.dlq`, { durable: true });
    await canal.bindQueue(`${fila}.dlq`, EXCHANGE_DLX, `${fila}.dlq`);
  }

  // O próprio serviço de pagamento assina o evento "transacao.recebida" para confirmar
  // a transação de forma assíncrona, sem bloquear a resposta ao cliente.
  await canal.bindQueue(FILA_PROCESSAMENTO, EXCHANGE_EVENTOS, ROTAS.TRANSACAO_RECEBIDA);
}
