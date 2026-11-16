import amqp from 'amqp-connection-manager';
import { declararTopologia } from './topologia.js';

/**
 * Conecta ao RabbitMQ com reconexão automática. Enquanto o serviço de notificação
 * estiver fora do ar, as mensagens ficam guardadas na fila durável e são entregues
 * quando ele voltar.
 */
export function conectarRabbit(url, logger) {
  const conexao = amqp.connect([url], {
    heartbeatIntervalInSeconds: 15,
    reconnectTimeInSeconds: 3,
    connectionOptions: { clientProperties: { connection_name: 'ms-notificacao' } },
  });

  conexao.on('connect', () => logger.info('conectado ao RabbitMQ'));
  conexao.on('disconnect', ({ err }) =>
    logger.warn(`desconectado do RabbitMQ (${err?.message ?? 'conexão encerrada'}); reconectando...`),
  );
  conexao.on('connectFailed', ({ err }) =>
    logger.warn(`falha ao conectar no RabbitMQ (${err?.message}); nova tentativa em 3 s`),
  );

  const canal = conexao.createChannel({
    name: 'ms-notificacao',
    setup: (ch) => declararTopologia(ch),
  });
  canal.on('error', (erro) => logger.error(`erro no canal AMQP: ${erro.message}`));

  return { conexao, canal };
}
