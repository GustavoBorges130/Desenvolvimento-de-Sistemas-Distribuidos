import { config } from './config.js';
import { criarLogger } from './logger.js';
import { aguardarBanco, criarPool, migrar } from './db.js';
import { conectarRabbit } from './mensageria/rabbitmq.js';
import { criarOutboxRelay } from './mensageria/outbox-relay.js';
import { criarServicoTransacoes } from './transacoes/servico.js';
import { criarGatewaySimulado } from './gateway/gateway-simulado.js';
import { iniciarConsumidorSolicitacoes } from './consumidores/solicitacoes.js';
import { iniciarConsumidorProcessamento } from './consumidores/processamento.js';
import { criarApp } from './app.js';

const logger = criarLogger(config.servico);

async function iniciar() {
  logger.info('iniciando o serviço de pagamento');

  // 1) Banco de dados exclusivo do serviço
  const pool = criarPool(config.databaseUrl);
  pool.on('error', (erro) => logger.error(`erro em conexão ociosa do PostgreSQL: ${erro.message}`));
  await aguardarBanco(pool, logger);
  await migrar(pool, logger);

  // 2) Mensageria (reconecta sozinha; o serviço não depende do broker para subir)
  const { conexao, canal } = conectarRabbit(config.rabbitmqUrl, logger);
  const relay = criarOutboxRelay({ pool, conexao, canal, logger, intervaloMs: config.outboxIntervaloMs });
  relay.iniciar();

  // 3) Regras de negócio e consumidores AMQP
  const servico = criarServicoTransacoes({ pool, relay, logger });
  const gateway = criarGatewaySimulado({ atrasoMs: config.processamentoDelayMs });
  iniciarConsumidorSolicitacoes({ canal, servico, logger }).catch((erro) =>
    logger.error('falha ao iniciar o consumidor de solicitações', erro),
  );
  iniciarConsumidorProcessamento({ canal, servico, gateway, logger, prefetch: config.processamentoPrefetch }).catch(
    (erro) => logger.error('falha ao iniciar o consumidor de processamento', erro),
  );

  // 4) API REST
  const app = criarApp({ servico, pool, conexao, logger });
  const servidor = app.listen(config.porta, () => logger.info(`API REST ouvindo na porta ${config.porta}`));

  // Encerramento gracioso: para de aceitar requisições, termina o que está em andamento e fecha as conexões.
  let encerrando = false;
  async function encerrar(sinal) {
    if (encerrando) return;
    encerrando = true;
    logger.info(`recebido ${sinal}; encerrando...`);
    const forcar = setTimeout(() => process.exit(1), 10_000);
    forcar.unref();
    servidor.close();
    await relay.parar();
    await canal.close().catch(() => {});
    await conexao.close().catch(() => {});
    await pool.end().catch(() => {});
    logger.info('serviço encerrado');
    process.exit(0);
  }
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

iniciar().catch((erro) => {
  logger.error('não foi possível iniciar o serviço', erro);
  process.exit(1);
});
