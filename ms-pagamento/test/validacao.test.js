import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarChaveIdempotencia, validarSolicitacao } from '../src/transacoes/validacao.js';

const solicitacaoValida = () => ({
  pedidoId: 'PED-1001',
  valor: 249.9,
  metodoPagamento: 'pix',
  cliente: { id: '10', nome: 'Maria Souza', email: 'Maria@Exemplo.com ' },
});

test('aceita uma solicitação válida e normaliza os campos', () => {
  const r = validarSolicitacao(solicitacaoValida());
  assert.equal(r.valido, true);
  assert.deepEqual(r.dados, {
    pedidoId: 'PED-1001',
    valor: 249.9,
    metodoPagamento: 'PIX',
    cliente: { id: '10', nome: 'Maria Souza', email: 'maria@exemplo.com' },
  });
});

test('usa CARTAO_CREDITO quando o método não é informado', () => {
  const corpo = solicitacaoValida();
  delete corpo.metodoPagamento;
  assert.equal(validarSolicitacao(corpo).dados.metodoPagamento, 'CARTAO_CREDITO');
});

test('aceita pedidoId numérico e valor em texto com vírgula', () => {
  const r = validarSolicitacao({ ...solicitacaoValida(), pedidoId: 123, valor: '10,50' });
  assert.equal(r.valido, true);
  assert.equal(r.dados.pedidoId, '123');
  assert.equal(r.dados.valor, 10.5);
});

test('rejeita corpo que não é objeto', () => {
  for (const corpo of [null, 'texto', 42, []]) {
    assert.equal(validarSolicitacao(corpo).valido, false);
  }
});

test('lista todos os campos obrigatórios ausentes', () => {
  const r = validarSolicitacao({});
  assert.equal(r.valido, false);
  assert.ok(r.erros.some((e) => e.includes('pedidoId')));
  assert.ok(r.erros.some((e) => e.includes('valor')));
  assert.ok(r.erros.some((e) => e.includes('cliente')));
});

test('rejeita valores zerados, negativos, com mais de duas casas ou acima do limite', () => {
  for (const valor of [0, -10, 10.123, 2_000_000, 'abc', null]) {
    const r = validarSolicitacao({ ...solicitacaoValida(), valor });
    assert.equal(r.valido, false, `valor ${valor} deveria ser rejeitado`);
  }
});

test('rejeita método de pagamento desconhecido', () => {
  const r = validarSolicitacao({ ...solicitacaoValida(), metodoPagamento: 'CHEQUE' });
  assert.equal(r.valido, false);
  assert.match(r.erros[0], /metodoPagamento/);
});

test('rejeita e-mail inválido', () => {
  const corpo = solicitacaoValida();
  corpo.cliente.email = 'maria.exemplo.com';
  assert.equal(validarSolicitacao(corpo).valido, false);
});

test('chave de idempotência é opcional e limitada a 100 caracteres', () => {
  assert.deepEqual(validarChaveIdempotencia(undefined), { valido: true, chave: null });
  assert.deepEqual(validarChaveIdempotencia(' abc '), { valido: true, chave: 'abc' });
  assert.equal(validarChaveIdempotencia('x'.repeat(101)).valido, false);
});
