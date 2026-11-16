import amqp from 'amqp-connection-manager';
import { declararTopologia } from './topologia.js';

/**
 * Conecta ao RabbitMQ com reconexão automática.
 * Se o broker cair, a biblioteca reconecta sozinha, redeclara a topologia e
 * reativa os consumidores — o serviço continua no ar enquanto isso.
 */
export function conectarRabbit(url, logger) {
  const conexao = amqp.connect([url], {
    heartbeatIntervalInSeconds: 15,
    reconnectTimeInSeconds: 3,
    connectionOptions: { clientProperties: { connection_name: 'ms-pagamento' } },
  });

  conexao.on('connect', () => logger.info('conectado ao RabbitMQ'));
  conexao.on('disconnect', ({ err }) =>
    logger.warn(`desconectado do RabbitMQ (${err?.message ?? 'conexão encerrada'}); reconectando...`),
  );
  conexao.on('connectFailed', ({ err }) =>
    logger.warn(`falha ao conectar no RabbitMQ (${err?.message}); nova tentativa em 3 s`),
  );

  // Canal com confirmação do broker (publisher confirms): publish() só resolve
  // depois que o RabbitMQ confirma que recebeu e gravou a mensagem.
  const canal = conexao.createChannel({
    name: 'ms-pagamento',
    confirm: true,
    setup: (ch) => declararTopologia(ch),
  });
  canal.on('error', (erro) => logger.error(`erro no canal AMQP: ${erro.message}`));

  return { conexao, canal };
}
