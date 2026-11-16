import { Router } from 'express';
import { TIPOS_NOTIFICACAO } from './modelos.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = ['PENDENTE', 'ENVIADA', 'FALHA'];
const TIPOS = Object.values(TIPOS_NOTIFICACAO);

const opcional = (valor) => (valor === undefined || valor === '' ? undefined : String(valor));

export function criarRotasNotificacoes({ servico }) {
  const rotas = Router();

  /** GET /notificacoes — histórico de notificações, com filtros opcionais. */
  rotas.get('/', async (req, res) => {
    const transacaoId = opcional(req.query.transacaoId);
    const status = opcional(req.query.status)?.toUpperCase();
    const tipo = opcional(req.query.tipo)?.toUpperCase();
    if (transacaoId && !UUID.test(transacaoId)) return res.status(400).json({ erro: 'transacaoId deve ser um UUID' });
    if (status && !STATUS.includes(status)) return res.status(400).json({ erro: `status deve ser um de: ${STATUS.join(', ')}` });
    if (tipo && !TIPOS.includes(tipo)) return res.status(400).json({ erro: `tipo deve ser um de: ${TIPOS.join(', ')}` });

    const notificacoes = await servico.listar({
      transacaoId,
      clienteId: opcional(req.query.clienteId),
      pedidoId: opcional(req.query.pedidoId),
      tipo,
      status,
      limite: Math.min(Math.max(Number(req.query.limite) || 50, 1), 200),
    });
    return res.json({ total: notificacoes.length, notificacoes });
  });

  /** GET /notificacoes/:id — detalhe de uma notificação. */
  rotas.get('/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ erro: 'id deve ser um UUID' });
    const notificacao = await servico.buscarPorId(req.params.id);
    if (!notificacao) return res.status(404).json({ erro: 'Notificação não encontrada' });
    return res.json(notificacao);
  });

  return rotas;
}
