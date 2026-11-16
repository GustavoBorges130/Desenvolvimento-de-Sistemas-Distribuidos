import { Router } from 'express';
import { validarChaveIdempotencia, validarSolicitacao } from './validacao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = ['PENDENTE', 'SUCESSO'];

const comLinks = (transacao) => ({
  ...transacao,
  _links: { self: `/transacoes/${transacao.id}` },
});

export function criarRotasTransacoes({ servico }) {
  const rotas = Router();

  /**
   * POST /transacoes — solicita uma transação de pagamento.
   * Responde 202 Accepted assim que a transação é registrada como PENDENTE:
   * a confirmação e as notificações acontecem depois, de forma assíncrona.
   */
  rotas.post('/', async (req, res) => {
    const chave = validarChaveIdempotencia(req.get('Idempotency-Key'));
    const validacao = validarSolicitacao(req.body);
    if (!validacao.valido || !chave.valido) {
      return res.status(400).json({
        erro: 'Solicitação inválida',
        detalhes: [...(validacao.erros ?? []), ...(chave.erros ?? [])],
      });
    }

    const { transacao, criada } = await servico.solicitar(validacao.dados, {
      origem: 'REST',
      chaveIdempotencia: chave.chave,
    });

    res.location(`/transacoes/${transacao.id}`);
    if (!criada) res.set('Idempotent-Replayed', 'true');
    return res.status(criada ? 202 : 200).json({
      mensagem: criada
        ? 'Solicitação recebida. A transação será confirmada de forma assíncrona.'
        : 'Solicitação já recebida anteriormente com esta Idempotency-Key.',
      transacao: comLinks(transacao),
    });
  });

  /** GET /transacoes — lista as transações mais recentes, com filtros opcionais. */
  rotas.get('/', async (req, res) => {
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if (status && !STATUS.includes(status)) {
      return res.status(400).json({ erro: `status deve ser um de: ${STATUS.join(', ')}` });
    }
    const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
    const transacoes = await servico.listar({
      status,
      clienteId: req.query.clienteId ? String(req.query.clienteId) : undefined,
      pedidoId: req.query.pedidoId ? String(req.query.pedidoId) : undefined,
      limite,
    });
    return res.json({ total: transacoes.length, transacoes: transacoes.map(comLinks) });
  });

  /** GET /transacoes/:id — consulta a situação de uma transação. */
  rotas.get('/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) {
      return res.status(400).json({ erro: 'id deve ser um UUID' });
    }
    const transacao = await servico.buscarPorId(req.params.id);
    if (!transacao) return res.status(404).json({ erro: 'Transação não encontrada' });
    return res.json(comLinks(transacao));
  });

  return rotas;
}
