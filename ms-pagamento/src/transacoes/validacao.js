export const METODOS_PAGAMENTO = Object.freeze(['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO']);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALOR_MAXIMO = 1_000_000;

function texto(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Valida e normaliza o corpo de uma solicitação de transação (REST ou AMQP).
 * Retorna { valido: true, dados } ou { valido: false, erros: [...] }.
 *
 * Formato esperado:
 * {
 *   "pedidoId": "PED-1001",
 *   "valor": 249.90,
 *   "metodoPagamento": "CARTAO_CREDITO",       // opcional (padrão CARTAO_CREDITO)
 *   "cliente": { "id": "10", "nome": "Maria Souza", "email": "maria@exemplo.com" }
 * }
 */
export function validarSolicitacao(corpo) {
  const erros = [];
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { valido: false, erros: ['o corpo da requisição deve ser um objeto JSON'] };
  }

  const pedidoId = texto(corpo.pedidoId);
  if (!pedidoId) erros.push('pedidoId é obrigatório');
  else if (pedidoId.length > 64) erros.push('pedidoId deve ter no máximo 64 caracteres');

  const valor = typeof corpo.valor === 'string' ? Number(corpo.valor.replace(',', '.')) : corpo.valor;
  if (typeof valor !== 'number' || !Number.isFinite(valor)) erros.push('valor é obrigatório e deve ser numérico');
  else if (valor <= 0) erros.push('valor deve ser maior que zero');
  else if (valor > VALOR_MAXIMO) erros.push(`valor deve ser no máximo ${VALOR_MAXIMO}`);
  else if (Math.round(valor * 100) !== Number((valor * 100).toFixed(6)))
    erros.push('valor deve ter no máximo duas casas decimais');

  const metodoPagamento = texto(corpo.metodoPagamento || 'CARTAO_CREDITO').toUpperCase();
  if (!METODOS_PAGAMENTO.includes(metodoPagamento)) {
    erros.push(`metodoPagamento deve ser um de: ${METODOS_PAGAMENTO.join(', ')}`);
  }

  const cliente = corpo.cliente;
  let clienteNormalizado;
  if (cliente === null || typeof cliente !== 'object' || Array.isArray(cliente)) {
    erros.push('cliente é obrigatório (id, nome e email)');
  } else {
    clienteNormalizado = {
      id: texto(cliente.id),
      nome: texto(cliente.nome),
      email: texto(cliente.email).toLowerCase(),
    };
    if (!clienteNormalizado.id) erros.push('cliente.id é obrigatório');
    else if (clienteNormalizado.id.length > 64) erros.push('cliente.id deve ter no máximo 64 caracteres');
    if (!clienteNormalizado.nome) erros.push('cliente.nome é obrigatório');
    else if (clienteNormalizado.nome.length > 120) erros.push('cliente.nome deve ter no máximo 120 caracteres');
    if (!EMAIL.test(clienteNormalizado.email) || clienteNormalizado.email.length > 254) {
      erros.push('cliente.email deve ser um e-mail válido');
    }
  }

  if (erros.length > 0) return { valido: false, erros };

  return {
    valido: true,
    dados: {
      pedidoId,
      valor: Math.round(valor * 100) / 100,
      metodoPagamento,
      cliente: clienteNormalizado,
    },
  };
}

/** Valida a chave de idempotência opcional (header Idempotency-Key ou messageId AMQP). */
export function validarChaveIdempotencia(chave) {
  if (chave === undefined || chave === null || chave === '') return { valido: true, chave: null };
  const normalizada = String(chave).trim();
  if (normalizada.length === 0 || normalizada.length > 100) {
    return { valido: false, erros: ['Idempotency-Key deve ter entre 1 e 100 caracteres'] };
  }
  return { valido: true, chave: normalizada };
}
