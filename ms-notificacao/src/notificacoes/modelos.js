// Monta o conteúdo das notificações a partir dos eventos publicados pelo ms-pagamento.

export const TIPOS_NOTIFICACAO = Object.freeze({
  SOLICITACAO_RECEBIDA: 'SOLICITACAO_RECEBIDA',
  PAGAMENTO_CONFIRMADO: 'PAGAMENTO_CONFIRMADO',
});

const TIPO_POR_EVENTO = {
  TransacaoRecebida: TIPOS_NOTIFICACAO.SOLICITACAO_RECEBIDA,
  TransacaoConfirmada: TIPOS_NOTIFICACAO.PAGAMENTO_CONFIRMADO,
};

const METODOS = {
  CARTAO_CREDITO: 'cartão de crédito',
  CARTAO_DEBITO: 'cartão de débito',
  PIX: 'Pix',
  BOLETO: 'boleto',
};

const moeda = (valor) => Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const primeiroNome = (nome) => String(nome).trim().split(/\s+/)[0];
const escapar = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Verifica se o evento tem os campos de que a notificação precisa. */
export function validarEvento(evento) {
  const erros = [];
  if (!evento || typeof evento !== 'object') return ['mensagem não é um objeto JSON'];
  if (!evento.id) erros.push('id do evento ausente');
  if (!TIPO_POR_EVENTO[evento.tipo]) erros.push(`tipo de evento não suportado: ${evento.tipo}`);
  const d = evento.dados;
  if (!d || typeof d !== 'object') return [...erros, 'dados do evento ausentes'];
  for (const campo of ['transacaoId', 'pedidoId', 'valor']) {
    if (d[campo] === undefined || d[campo] === null || d[campo] === '') erros.push(`dados.${campo} ausente`);
  }
  if (!d.cliente?.id || !d.cliente?.email || !d.cliente?.nome) erros.push('dados.cliente incompleto');
  return erros;
}

/**
 * Gera tipo, assunto, texto e HTML da notificação.
 * Etapa III: TransacaoRecebida → "Recebemos sua solicitação de pagamento".
 * Etapa VI: TransacaoConfirmada → "Pagamento confirmado".
 */
export function montarNotificacao(evento) {
  const tipo = TIPO_POR_EVENTO[evento.tipo];
  if (!tipo) throw new Error(`tipo de evento não suportado: ${evento.tipo}`);

  const d = evento.dados;
  const nome = primeiroNome(d.cliente.nome);
  const metodo = METODOS[d.metodoPagamento] ?? d.metodoPagamento ?? 'não informado';
  const valor = moeda(d.valor);

  let assunto;
  let paragrafos;
  if (tipo === TIPOS_NOTIFICACAO.SOLICITACAO_RECEBIDA) {
    assunto = `Recebemos sua solicitação de pagamento - pedido ${d.pedidoId}`;
    paragrafos = [
      `Olá, ${nome}!`,
      `Recebemos a solicitação de pagamento do pedido ${d.pedidoId}, no valor de ${valor} (${metodo}).`,
      'O pagamento está em processamento. Avisaremos assim que ele for confirmado.',
      `Código da transação: ${d.transacaoId}`,
    ];
  } else {
    assunto = `Pagamento confirmado - pedido ${d.pedidoId}`;
    paragrafos = [
      `Olá, ${nome}!`,
      `O pagamento do pedido ${d.pedidoId}, no valor de ${valor} (${metodo}), foi confirmado` +
        (d.confirmadaEm ? ` em ${dataHora(d.confirmadaEm)}.` : '.'),
      'Agora vamos preparar o seu pedido. Obrigado por comprar na CompreFácil!',
      `Código da transação: ${d.transacaoId}` + (d.codigoAutorizacao ? ` | Autorização: ${d.codigoAutorizacao}` : ''),
    ];
  }

  const texto = `${paragrafos.join('\n\n')}\n\n— Equipe CompreFácil`;
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:560px">
<h2 style="color:#1F3864;margin-bottom:16px">${escapar(assunto)}</h2>
${paragrafos.map((p) => `<p style="line-height:1.5">${escapar(p)}</p>`).join('\n')}
<p style="color:#595959;font-size:12px;margin-top:24px">Equipe CompreFácil · mensagem automática, não responda.</p>
</body></html>`;

  return { tipo, assunto, texto, html };
}
