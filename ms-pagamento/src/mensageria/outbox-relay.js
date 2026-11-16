import { EXCHANGE_EVENTOS } from './topologia.js';

const LOTE = 50;
const TIMEOUT_PUBLICACAO_MS = 5000;

const ETAPA_POR_ROTA = {
  'transacao.recebida': 'II',
  'transacao.confirmada': 'V',
};

/**
 * Relay da tabela outbox: lê eventos ainda não publicados, publica no exchange
 * `pagamentos.eventos` e marca cada um como publicado após a confirmação do broker.
 *
 * - FOR UPDATE SKIP LOCKED permite várias réplicas do serviço sem publicar o mesmo evento duas vezes.
 * - Se o RabbitMQ estiver fora do ar, os eventos ficam na tabela e são publicados quando ele voltar.
 * - A ordem de gravação (coluna seq) é preservada; em caso de falha, o lote para no evento que falhou.
 */
export function criarOutboxRelay({ pool, conexao, canal, logger, intervaloMs }) {
  let timer = null;
  let executando = false;
  let novaRodadaSolicitada = false;
  let ativo = false;

  async function publicarLote() {
    const cliente = await pool.connect();
    let publicados = 0;
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(
        `SELECT seq, evento_id, tipo, routing_key, payload
           FROM outbox
          WHERE publicada_em IS NULL
          ORDER BY seq
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [LOTE],
      );

      for (const evento of rows) {
        // O log vem antes do publish: o consumidor pode receber a mensagem antes de a
        // confirmação do broker chegar aqui, e assim os logs ficam na ordem do fluxo.
        const etapa = ETAPA_POR_ROTA[evento.routing_key];
        logger.info(
          `${etapa ? `[${etapa}] ` : ''}publicando evento ${evento.tipo} em ${EXCHANGE_EVENTOS} ` +
            `(routing key ${evento.routing_key}, transação ${evento.payload?.dados?.transacaoId})`,
        );
        try {
          await canal.publish(
            EXCHANGE_EVENTOS,
            evento.routing_key,
            Buffer.from(JSON.stringify(evento.payload)),
            {
              persistent: true,
              contentType: 'application/json',
              contentEncoding: 'utf-8',
              messageId: evento.evento_id,
              correlationId: evento.payload?.dados?.transacaoId,
              type: evento.tipo,
              appId: 'ms-pagamento',
              timestamp: Math.floor(Date.now() / 1000),
              timeout: TIMEOUT_PUBLICACAO_MS,
            },
          );
          await cliente.query('UPDATE outbox SET publicada_em = now(), tentativas = tentativas + 1 WHERE seq = $1', [
            evento.seq,
          ]);
          publicados++;
          logger.debug(`evento ${evento.evento_id} confirmado pelo broker`);
        } catch (erro) {
          await cliente.query('UPDATE outbox SET tentativas = tentativas + 1, ultimo_erro = $2 WHERE seq = $1', [
            evento.seq,
            erro.message,
          ]);
          logger.warn(`não foi possível publicar o evento ${evento.evento_id} (${erro.message}); será reenviado`);
          break;
        }
      }

      await cliente.query('COMMIT');
      return { lidos: rows.length, publicados };
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally {
      cliente.release();
    }
  }

  async function rodar() {
    if (!ativo) return;
    if (executando) {
      novaRodadaSolicitada = true;
      return;
    }
    if (!conexao.isConnected()) return; // tenta de novo na próxima varredura

    executando = true;
    try {
      do {
        novaRodadaSolicitada = false;
        const { lidos, publicados } = await publicarLote();
        if (lidos === LOTE && publicados === LOTE) novaRodadaSolicitada = true;
      } while (novaRodadaSolicitada && ativo && conexao.isConnected());
    } catch (erro) {
      logger.error(`falha no relay da outbox: ${erro.message}`);
    } finally {
      executando = false;
    }
  }

  return {
    iniciar() {
      ativo = true;
      timer = setInterval(rodar, intervaloMs);
      conexao.on('connect', () => setImmediate(rodar)); // publica o que acumulou enquanto o broker estava fora
      setImmediate(rodar);
    },
    /** Chamado logo após gravar um evento, para publicá-lo sem esperar a próxima varredura. */
    notificar() {
      setImmediate(rodar);
    },
    async parar() {
      ativo = false;
      clearInterval(timer);
      while (executando) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
