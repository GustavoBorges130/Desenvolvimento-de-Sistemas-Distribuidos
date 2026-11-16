// Configuração lida de variáveis de ambiente.
// Os valores padrão permitem rodar o serviço fora do Docker (npm start),
// usando a infraestrutura do docker-compose exposta em localhost.

const env = process.env;

function numero(nome, padrao) {
  const valor = Number(env[nome] ?? padrao);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`Variável de ambiente ${nome} inválida: "${env[nome]}"`);
  }
  return valor;
}

export const config = Object.freeze({
  servico: 'ms-pagamento',
  porta: numero('PORT', 3001),
  databaseUrl: env.DATABASE_URL ?? 'postgres://pagamento:pagamento@localhost:5433/pagamentos',
  rabbitmqUrl: env.RABBITMQ_URL ?? 'amqp://comprefacil:comprefacil@localhost:5672',
  // Tempo que o gateway de pagamento simulado leva para autorizar a transação.
  processamentoDelayMs: numero('PROCESSAMENTO_DELAY_MS', 3000),
  // Intervalo de varredura da tabela outbox (o envio também é disparado logo após cada gravação).
  outboxIntervaloMs: numero('OUTBOX_INTERVALO_MS', 1000),
  // Quantas transações o processador confirma em paralelo.
  processamentoPrefetch: numero('PROCESSAMENTO_PREFETCH', 10),
});
