import express from 'express';
import { criarRotasTransacoes } from './transacoes/rotas.js';
import { EXCHANGE_EVENTOS, FILA_PROCESSAMENTO, FILA_SOLICITACOES, ROTAS } from './mensageria/topologia.js';

export function criarApp({ servico, pool, conexao, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({
      servico: 'ms-pagamento',
      descricao: 'Serviço de pagamentos da CompreFácil',
      rest: {
        'POST /transacoes': 'solicita uma transação (header opcional Idempotency-Key)',
        'GET /transacoes': 'lista transações (?status=&clienteId=&pedidoId=&limite=)',
        'GET /transacoes/:id': 'consulta uma transação',
        'GET /health': 'situação do serviço e das dependências',
      },
      amqp: {
        consome: [FILA_SOLICITACOES, `${FILA_PROCESSAMENTO} (${ROTAS.TRANSACAO_RECEBIDA})`],
        publica: { exchange: EXCHANGE_EVENTOS, routingKeys: Object.values(ROTAS) },
      },
    });
  });

  // O serviço continua aceitando solicitações mesmo com o RabbitMQ fora do ar:
  // os eventos ficam na outbox e são publicados quando o broker voltar.
  // Por isso, só o banco indisponível torna o serviço "DOWN".
  app.get('/health', async (_req, res) => {
    let banco = 'UP';
    try {
      await pool.query('SELECT 1');
    } catch {
      banco = 'DOWN';
    }
    const rabbitmq = conexao.isConnected() ? 'UP' : 'DOWN';
    let eventosPendentes = null;
    if (banco === 'UP') {
      const { rows } = await pool.query('SELECT count(*)::int AS total FROM outbox WHERE publicada_em IS NULL');
      eventosPendentes = rows[0].total;
    }
    const status = banco === 'DOWN' ? 'DOWN' : rabbitmq === 'DOWN' ? 'DEGRADADO' : 'UP';
    res.status(banco === 'UP' ? 200 : 503).json({
      status,
      servico: 'ms-pagamento',
      dependencias: { postgres: banco, rabbitmq },
      outbox: { eventosPendentes },
      horario: new Date().toISOString(),
    });
  });

  app.use('/transacoes', criarRotasTransacoes({ servico }));

  app.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  // Tratamento centralizado de erros (o Express 5 encaminha erros de rotas async para cá).
  app.use((erro, _req, res, _next) => {
    if (erro.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'JSON inválido no corpo da requisição' });
    }
    if (erro.status >= 400 && erro.status < 500) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    logger.error('erro inesperado na API REST', erro);
    return res.status(500).json({ erro: 'Erro interno no serviço de pagamento' });
  });

  return app;
}
