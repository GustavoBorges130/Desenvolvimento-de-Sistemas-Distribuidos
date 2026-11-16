import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarNotificacao, validarEvento, TIPOS_NOTIFICACAO } from '../src/notificacoes/modelos.js';

const evento = (tipo, extras = {}) => ({
  id: '0b6f3c1e-8a7d-4f2b-9c55-3e1d2a4b5c6d',
  tipo,
  versao: 1,
  origem: 'ms-pagamento',
  ocorridoEm: '2026-11-16T11:00:00.000Z',
  dados: {
    transacaoId: '6f1c2a54-5b0e-4f53-9d6a-0d7c3b2f8e11',
    pedidoId: 'PED-1001',
    valor: 1249.9,
    metodoPagamento: 'CARTAO_CREDITO',
    status: 'PENDENTE',
    cliente: { id: '10', nome: 'Maria Souza', email: 'maria@exemplo.com' },
    ...extras,
  },
});

test('TransacaoRecebida gera o aviso de solicitação recebida (etapa III)', () => {
  const n = montarNotificacao(evento('TransacaoRecebida'));
  assert.equal(n.tipo, TIPOS_NOTIFICACAO.SOLICITACAO_RECEBIDA);
  assert.match(n.assunto, /Recebemos sua solicitação de pagamento - pedido PED-1001/);
  assert.match(n.texto, /Olá, Maria!/);
  assert.match(n.texto, /R\$\s?1\.249,90/);
  assert.match(n.texto, /cartão de crédito/);
});

test('TransacaoConfirmada gera o aviso de pagamento confirmado (etapa VI)', () => {
  const n = montarNotificacao(
    evento('TransacaoConfirmada', {
      status: 'SUCESSO',
      confirmadaEm: '2026-11-16T11:00:03.000Z',
      codigoAutorizacao: 'AUT-1A2B3C4D',
    }),
  );
  assert.equal(n.tipo, TIPOS_NOTIFICACAO.PAGAMENTO_CONFIRMADO);
  assert.match(n.assunto, /Pagamento confirmado - pedido PED-1001/);
  assert.match(n.texto, /16\/11\/2026,? 08:00/); // horário de Brasília
  assert.match(n.texto, /AUT-1A2B3C4D/);
});

test('o HTML escapa caracteres especiais vindos do evento', () => {
  const e = evento('TransacaoRecebida');
  e.dados.pedidoId = '<script>alert(1)</script>';
  const n = montarNotificacao(e);
  assert.ok(!n.html.includes('<script>'));
  assert.ok(n.html.includes('&lt;script&gt;'));
});

test('validarEvento aceita um evento completo', () => {
  assert.deepEqual(validarEvento(evento('TransacaoRecebida')), []);
});

test('validarEvento aponta tipo desconhecido e campos ausentes', () => {
  const e = evento('PedidoEnviado');
  delete e.dados.cliente.email;
  delete e.dados.valor;
  const erros = validarEvento(e);
  assert.ok(erros.some((x) => x.includes('tipo de evento não suportado')));
  assert.ok(erros.some((x) => x.includes('dados.valor')));
  assert.ok(erros.some((x) => x.includes('dados.cliente')));
});

test('validarEvento rejeita mensagens que não são objetos', () => {
  assert.notDeepEqual(validarEvento(null), []);
  assert.notDeepEqual(validarEvento({ id: 'x', tipo: 'TransacaoRecebida' }), []);
});
