import { randomUUID } from 'node:crypto';
import { emTransacao } from '../db.js';
import { criarEvento, TIPOS_EVENTO } from './eventos.js';
import * as repositorio from './repositorio.js';

export class ErroConflito extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroConflito';
    this.status = 409;
  }
}

const formatarValor = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function criarServicoTransacoes({ pool, relay, logger }) {
  /**
   * Etapas I e II do fluxo: grava a transação como PENDENTE e, na mesma transação
   * do banco, registra o evento TransacaoRecebida na outbox. O relay publica o
   * evento no RabbitMQ logo em seguida — a requisição não espera por isso.
   */
  async function solicitar(dados, { origem, chaveIdempotencia = null }) {
    const resultado = await emTransacao(pool, async (db) => {
      const nova = await repositorio.inserirPendente(db, { id: randomUUID(), dados, origem, chaveIdempotencia });
      if (!nova) {
        // Mesma chave de idempotência já usada: devolve a transação existente em vez de cobrar de novo.
        const existente = await repositorio.buscarPorChave(db, chaveIdempotencia);
        if (existente.pedidoId !== dados.pedidoId || existente.valor !== dados.valor) {
          throw new ErroConflito(
            'Idempotency-Key já utilizada em outra solicitação, com pedido ou valor diferentes',
          );
        }
        return { transacao: existente, criada: false };
      }
      await repositorio.adicionarNaOutbox(db, criarEvento(TIPOS_EVENTO.TRANSACAO_RECEBIDA, nova));
      return { transacao: nova, criada: true };
    });

    const { transacao, criada } = resultado;
    if (criada) {
      logger.info(
        `[I] transação ${transacao.id} registrada com status PENDENTE ` +
          `(pedido ${transacao.pedidoId}, ${formatarValor(transacao.valor)}, via ${origem})`,
      );
      relay.notificar();
    } else {
      logger.info(`solicitação repetida (Idempotency-Key ${chaveIdempotencia}); devolvendo a transação ${transacao.id}`);
    }
    return resultado;
  }

  /**
   * Etapas IV e V: atualiza a transação para SUCESSO e registra o evento
   * TransacaoConfirmada na outbox, de forma atômica.
   * Retorna null se a transação já estava confirmada (mensagem entregue de novo).
   */
  async function confirmar(transacaoId, codigoAutorizacao) {
    const transacao = await emTransacao(pool, async (db) => {
      const confirmada = await repositorio.confirmar(db, transacaoId, codigoAutorizacao);
      if (!confirmada) return null;
      await repositorio.adicionarNaOutbox(db, criarEvento(TIPOS_EVENTO.TRANSACAO_CONFIRMADA, confirmada));
      return confirmada;
    });
    if (transacao) relay.notificar();
    return transacao;
  }

  return {
    solicitar,
    confirmar,
    buscarPorId: (id) => repositorio.buscarPorId(pool, id),
    listar: (filtros) => repositorio.listar(pool, filtros),
  };
}
