import express from 'express';
import { criarRotasNotificacoes } from './notificacoes/rotas.js';
import { EXCHANGE_EVENTOS_PAGAMENTO, FILA_TRANSACOES, ROTAS } from './mensageria/topologia.js';

export function criarApp({ servico, pool, conexao, canalEmail, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({
      servico: 'ms-notificacao',
      descricao: 'Serviço de notificações da CompreFácil',
      rest: {
        'GET /notificacoes': 'histórico (?transacaoId=&clienteId=&pedidoId=&tipo=&status=&limite=)',
        'GET /notificacoes/:id': 'detalhe de uma notificação',
        'GET /health': 'situação do serviço e das dependências',
      },
      amqp: {
        consome: { fila: FILA_TRANSACOES, exchange: EXCHANGE_EVENTOS_PAGAMENTO, routingKeys: Object.values(ROTAS) },
      },
      canal: canalEmail.descricao,
    });
  });

  app.get('/health', async (_req, res) => {
    let banco = 'UP';
    try {
      await pool.query('SELECT 1');
    } catch {
      banco = 'DOWN';
    }
    const rabbitmq = conexao.isConnected() ? 'UP' : 'DOWN';
    const smtp = (await canalEmail.verificar()) ? 'UP' : 'DOWN';
    const status = banco === 'DOWN' ? 'DOWN' : rabbitmq === 'DOWN' || smtp === 'DOWN' ? 'DEGRADADO' : 'UP';
    res.status(banco === 'UP' ? 200 : 503).json({
      status,
      servico: 'ms-notificacao',
      dependencias: { postgres: banco, rabbitmq, smtp },
      horario: new Date().toISOString(),
    });
  });

  app.use('/notificacoes', criarRotasNotificacoes({ servico }));

  app.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  app.use((erro, _req, res, _next) => {
    if (erro.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'JSON inválido no corpo da requisição' });
    }
    if (erro.status >= 400 && erro.status < 500) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    logger.error('erro inesperado na API REST', erro);
    return res.status(500).json({ erro: 'Erro interno no serviço de notificação' });
  });

  return app;
}
