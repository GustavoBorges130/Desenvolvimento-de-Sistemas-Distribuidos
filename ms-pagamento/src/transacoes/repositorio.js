// Acesso ao banco do serviço de pagamento. Todas as funções recebem um cliente
// (pool ou conexão em transação) para poderem participar de transações maiores.

const COLUNAS = `id, pedido_id, cliente_id, cliente_nome, cliente_email, valor, metodo_pagamento,
                 status, origem, chave_idempotencia, codigo_autorizacao, criada_em, atualizada_em, confirmada_em`;

export function paraTransacao(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    pedidoId: linha.pedido_id,
    valor: Number(linha.valor),
    metodoPagamento: linha.metodo_pagamento,
    status: linha.status,
    origem: linha.origem,
    cliente: { id: linha.cliente_id, nome: linha.cliente_nome, email: linha.cliente_email },
    codigoAutorizacao: linha.codigo_autorizacao,
    criadaEm: linha.criada_em?.toISOString(),
    atualizadaEm: linha.atualizada_em?.toISOString(),
    confirmadaEm: linha.confirmada_em?.toISOString() ?? null,
  };
}

/**
 * Insere a transação com status PENDENTE. Se já existir uma transação com a mesma
 * chave de idempotência, não insere nada e retorna null.
 */
export async function inserirPendente(db, { id, dados, origem, chaveIdempotencia }) {
  const { rows } = await db.query(
    `INSERT INTO transacoes (id, pedido_id, cliente_id, cliente_nome, cliente_email, valor,
                             metodo_pagamento, status, origem, chave_idempotencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDENTE', $8, $9)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING ${COLUNAS}`,
    [
      id,
      dados.pedidoId,
      dados.cliente.id,
      dados.cliente.nome,
      dados.cliente.email,
      dados.valor,
      dados.metodoPagamento,
      origem,
      chaveIdempotencia,
    ],
  );
  return paraTransacao(rows[0]);
}

export async function buscarPorChave(db, chaveIdempotencia) {
  const { rows } = await db.query(`SELECT ${COLUNAS} FROM transacoes WHERE chave_idempotencia = $1`, [
    chaveIdempotencia,
  ]);
  return paraTransacao(rows[0]);
}

export async function buscarPorId(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS} FROM transacoes WHERE id = $1`, [id]);
  return paraTransacao(rows[0]);
}

export async function listar(db, { status, clienteId, pedidoId, limite = 50 }) {
  const filtros = [];
  const valores = [];
  if (status) {
    valores.push(status);
    filtros.push(`status = $${valores.length}`);
  }
  if (clienteId) {
    valores.push(clienteId);
    filtros.push(`cliente_id = $${valores.length}`);
  }
  if (pedidoId) {
    valores.push(pedidoId);
    filtros.push(`pedido_id = $${valores.length}`);
  }
  valores.push(limite);
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT ${COLUNAS} FROM transacoes ${where} ORDER BY criada_em DESC LIMIT $${valores.length}`,
    valores,
  );
  return rows.map(paraTransacao);
}

/**
 * Atualiza PENDENTE → SUCESSO de forma condicional. Se a transação já estiver
 * confirmada (mensagem repetida), nenhuma linha é alterada e a função retorna null.
 */
export async function confirmar(db, id, codigoAutorizacao) {
  const { rows } = await db.query(
    `UPDATE transacoes
        SET status = 'SUCESSO', codigo_autorizacao = $2, confirmada_em = now(), atualizada_em = now()
      WHERE id = $1 AND status = 'PENDENTE'
      RETURNING ${COLUNAS}`,
    [id, codigoAutorizacao],
  );
  return paraTransacao(rows[0]);
}

export async function adicionarNaOutbox(db, { routingKey, mensagem }) {
  await db.query(
    `INSERT INTO outbox (evento_id, tipo, routing_key, payload) VALUES ($1, $2, $3, $4)`,
    [mensagem.id, mensagem.tipo, routingKey, mensagem],
  );
}
