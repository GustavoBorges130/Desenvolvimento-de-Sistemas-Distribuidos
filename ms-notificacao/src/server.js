import { config } from './config.js';
import { criarLogger } from './logger.js';
import { aguardarBanco, criarPool, migrar } from './db.js';
import { conectarRabbit } from './mensageria/rabbitmq.js';
import { criarCanalEmail } from './canais/email.js';
import { criarServicoNotificacoes } from './notificacoes/servico.js';
import { iniciarConsumidorEventosTransacao } from './consumidores/eventos-transacao.js';
import { criarApp } from './app.js';

const logger = criarLogger(config.servico);

async function iniciar() {
  logger.info('iniciando o serviço de notificação');

  // 1) Banco de dados exclusivo do serviço
  const pool = criarPool(config.databaseUrl);
  pool.on('error', (erro) => logger.error(`erro em conexão ociosa do PostgreSQL: ${erro.message}`));
  await aguardarBanco(pool, logger);
  await migrar(pool, logger);

  // 2) Canal de envio (e-mail)
  const canalEmail = criarCanalEmail({
    host: config.smtpHost,
    porta: config.smtpPorta,
    usuario: config.smtpUsuario,
    senha: config.smtpSenha,
    remetente: config.emailRemetente,
    logger,
  });
  logger.info(`notificações serão enviadas por ${canalEmail.descricao}`);

  // 3) Mensageria e consumidor
  const { conexao, canal } = conectarRabbit(config.rabbitmqUrl, logger);
  const servico = criarServicoNotificacoes({ pool, canalEmail, logger });
  iniciarConsumidorEventosTransacao({ canal, servico, logger }).catch((erro) =>
    logger.error('falha ao iniciar o consumidor de eventos de transação', erro),
  );

  // 4) API REST
  const app = criarApp({ servico, pool, conexao, canalEmail, logger });
  const servidor = app.listen(config.porta, () => logger.info(`API REST ouvindo na porta ${config.porta}`));

  let encerrando = false;
  async function encerrar(sinal) {
    if (encerrando) return;
    encerrando = true;
    logger.info(`recebido ${sinal}; encerrando...`);
    const forcar = setTimeout(() => process.exit(1), 10_000);
    forcar.unref();
    servidor.close();
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
