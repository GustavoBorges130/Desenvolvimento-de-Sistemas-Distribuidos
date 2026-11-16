import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarEvento, TIPOS_EVENTO } from '../src/transacoes/eventos.js';

const transacao = {
  id: '6f1c2a54-5b0e-4f53-9d6a-0d7c3b2f8e11',
  pedidoId: 'PED-1001',
  valor: 249.9,
  metodoPagamento: 'PIX',
  status: 'PENDENTE',
  cliente: { id: '10', nome: 'Maria Souza', email: 'maria@exemplo.com' },
  criadaEm: '2026-11-16T11:00:00.000Z',
  confirmadaEm: null,
  codigoAutorizacao: null,
};

test('TransacaoRecebida usa a routing key transacao.recebida e leva os dados do cliente', () => {
  const { routingKey, mensagem } = criarEvento(TIPOS_EVENTO.TRANSACAO_RECEBIDA, transacao);
  assert.equal(routingKey, 'transacao.recebida');
  assert.equal(mensagem.tipo, 'TransacaoRecebida');
  assert.equal(mensagem.origem, 'ms-pagamento');
  assert.match(mensagem.id, /^[0-9a-f-]{36}$/);
  assert.equal(mensagem.dados.transacaoId, transacao.id);
  assert.equal(mensagem.dados.status, 'PENDENTE');
  assert.deepEqual(mensagem.dados.cliente, transacao.cliente);
});

test('TransacaoConfirmada usa a routing key transacao.confirmada', () => {
  const { routingKey, mensagem } = criarEvento(TIPOS_EVENTO.TRANSACAO_CONFIRMADA, {
    ...transacao,
    status: 'SUCESSO',
    confirmadaEm: '2026-11-16T11:00:03.000Z',
    codigoAutorizacao: 'AUT-1A2B3C4D',
  });
  assert.equal(routingKey, 'transacao.confirmada');
  assert.equal(mensagem.dados.status, 'SUCESSO');
  assert.equal(mensagem.dados.codigoAutorizacao, 'AUT-1A2B3C4D');
});

test('cada evento recebe um id único (usado para idempotência no consumidor)', () => {
  const a = criarEvento(TIPOS_EVENTO.TRANSACAO_RECEBIDA, transacao).mensagem.id;
  const b = criarEvento(TIPOS_EVENTO.TRANSACAO_RECEBIDA, transacao).mensagem.id;
  assert.notEqual(a, b);
});

test('tipo de evento desconhecido gera erro', () => {
  assert.throws(() => criarEvento('PedidoCriado', transacao), /desconhecido/);
});
