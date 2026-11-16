const COLUNAS = `id, evento_id, tipo, transacao_id, pedido_id, cliente_id, canal, destinatario, assunto,
                 mensagem, status, tentativas, ultimo_erro, recebida_em, enviada_em`;

export function paraNotificacao(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    eventoId: linha.evento_id,
    tipo: linha.tipo,
    transacaoId: linha.transacao_id,
    pedidoId: linha.pedido_id,
    clienteId: linha.cliente_id,
    canal: linha.canal,
    destinatario: linha.destinatario,
    assunto: linha.assunto,
    mensagem: linha.mensagem,
    status: linha.status,
    tentativas: linha.tentativas,
    ultimoErro: linha.ultimo_erro,
    recebidaEm: linha.recebida_em?.toISOString(),
    enviadaEm: linha.enviada_em?.toISOString() ?? null,
  };
}

/**
 * Registra a notificação como PENDENTE. Se o evento já foi registrado antes
 * (mensagem entregue de novo), devolve o registro existente com `nova = false`.
 */
export async function registrar(db, n) {
  const { rows } = await db.query(
    `INSERT INTO notificacoes (id, evento_id, tipo, transacao_id, pedido_id, cliente_id, canal,
                               destinatario, assunto, mensagem, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'EMAIL', $7, $8, $9, 'PENDENTE')
     ON CONFLICT (evento_id) DO NOTHING
     RETURNING ${COLUNAS}`,
    [n.id, n.eventoId, n.tipo, n.transacaoId, n.pedidoId, n.clienteId, n.destinatario, n.assunto, n.mensagem],
  );
  if (rows[0]) return { notificacao: paraNotificacao(rows[0]), nova: true };
  const existente = await db.query(`SELECT ${COLUNAS} FROM notificacoes WHERE evento_id = $1`, [n.eventoId]);
  return { notificacao: paraNotificacao(existente.rows[0]), nova: false };
}

export async function marcarEnviada(db, id, tentativas) {
  const { rows } = await db.query(
    `UPDATE notificacoes
        SET status = 'ENVIADA', enviada_em = now(), tentativas = tentativas + $2, ultimo_erro = NULL
      WHERE id = $1
      RETURNING ${COLUNAS}`,
    [id, tentativas],
  );
  return paraNotificacao(rows[0]);
}

export async function marcarFalha(db, id, tentativas, erro) {
  await db.query(
    `UPDATE notificacoes SET status = 'FALHA', tentativas = tentativas + $2, ultimo_erro = $3 WHERE id = $1`,
    [id, tentativas, erro],
  );
}

export async function buscarPorId(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS} FROM notificacoes WHERE id = $1`, [id]);
  return paraNotificacao(rows[0]);
}

export async function listar(db, { transacaoId, clienteId, pedidoId, tipo, status, limite = 50 }) {
  const filtros = [];
  const valores = [];
  const adicionar = (coluna, valor) => {
    if (valor === undefined) return;
    valores.push(valor);
    filtros.push(`${coluna} = $${valores.length}`);
  };
  adicionar('transacao_id', transacaoId);
  adicionar('cliente_id', clienteId);
  adicionar('pedido_id', pedidoId);
  adicionar('tipo', tipo);
  adicionar('status', status);
  valores.push(limite);
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT ${COLUNAS} FROM notificacoes ${where} ORDER BY recebida_em DESC LIMIT $${valores.length}`,
    valores,
  );
  return rows.map(paraNotificacao);
}
