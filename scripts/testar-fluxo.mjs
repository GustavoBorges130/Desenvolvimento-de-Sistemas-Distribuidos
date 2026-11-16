#!/usr/bin/env node
/**
 * Executa o fluxo do desafio de ponta a ponta e confere cada etapa (I a VI).
 *
 *   node scripts/testar-fluxo.mjs              solicitação pela API REST
 *   node scripts/testar-fluxo.mjs --via amqp   solicitação pela fila pagamentos.solicitacoes
 *
 * Requisitos: Node.js 22+ e o docker compose em execução. Não usa dependências externas.
 */

const PAGAMENTO = process.env.PAGAMENTO_URL ?? 'http://localhost:3001';
const NOTIFICACAO = process.env.NOTIFICACAO_URL ?? 'http://localhost:3002';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RABBITMQ_API = process.env.RABBITMQ_API_URL ?? 'http://localhost:15672';
const RABBITMQ_AUTH = 'Basic ' + Buffer.from(process.env.RABBITMQ_API_AUTH ?? 'comprefacil:comprefacil').toString('base64');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30_000);

const via = process.argv.includes('--via') ? process.argv[process.argv.indexOf('--via') + 1]?.toLowerCase() : 'rest';
if (!['rest', 'amqp'].includes(via)) {
  console.error('Uso: node scripts/testar-fluxo.mjs [--via rest|amqp]');
  process.exit(2);
}

const cor = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo, texto) => (cor ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const verde = (t) => pintar(32, t);
const vermelho = (t) => pintar(31, t);
const amarelo = (t) => pintar(33, t);
const cinza = (t) => pintar(90, t);
const negrito = (t) => pintar(1, t);

const inicio = Date.now();
const decorrido = () => cinza(`+${((Date.now() - inicio) / 1000).toFixed(1)}s`);
const ok = (etapa, texto) => console.log(`${verde('OK')}  ${negrito(etapa.padEnd(5))} ${texto} ${decorrido()}`);
const info = (texto) => console.log(`    ${cinza(texto)}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function falhar(texto) {
  console.log(`${vermelho('ERRO')} ${texto}`);
  process.exit(1);
}

async function http(metodo, url, { corpo, headers = {} } = {}) {
  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new Error(`não foi possível acessar ${url} (${erro.cause?.code ?? erro.message})`);
  }
  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta não é JSON */
  }
  return { status: resposta.status, json, headers: resposta.headers };
}

/** Repete `fn` até ela retornar um valor diferente de null/undefined ou estourar o tempo. */
async function aguardar(descricao, fn, intervaloMs = 300) {
  const limite = Date.now() + TIMEOUT_MS;
  while (Date.now() < limite) {
    const resultado = await fn().catch(() => null);
    if (resultado !== null && resultado !== undefined) return resultado;
    await esperar(intervaloMs);
  }
  falhar(`tempo esgotado (${TIMEOUT_MS / 1000}s) aguardando: ${descricao}`);
}

async function notificacao(transacaoId, tipo) {
  const { status, json } = await http('GET', `${NOTIFICACAO}/notificacoes?transacaoId=${transacaoId}&tipo=${tipo}`);
  if (status !== 200) return null;
  const n = json.notificacoes[0];
  return n && n.status === 'ENVIADA' ? n : null;
}

async function main() {
  console.log(negrito(`\nCompreFácil — teste do fluxo de pagamento (solicitação via ${via.toUpperCase()})\n`));

  // Situação dos serviços
  for (const [nome, url] of [['ms-pagamento', PAGAMENTO], ['ms-notificacao', NOTIFICACAO]]) {
    const { status, json } = await http('GET', `${url}/health`).catch((e) => falhar(`${nome}: ${e.message}`));
    if (status !== 200) falhar(`${nome} respondeu ${status} em /health`);
    const deps = Object.entries(json.dependencias).map(([k, v]) => `${k} ${v}`).join(', ');
    ok('', `${nome} no ar (${json.status}: ${deps})`);
  }

  const sufixo = Date.now().toString(36).toUpperCase();
  const solicitacao = {
    pedidoId: `PED-${sufixo}`,
    valor: 249.9,
    metodoPagamento: 'CARTAO_CREDITO',
    cliente: { id: '10', nome: 'Maria Souza', email: 'maria.souza@exemplo.com' },
  };
  const chave = `teste-${sufixo}`;
  let transacao;

  // Etapa I — solicitação recebida e gravada como PENDENTE
  console.log('');
  if (via === 'rest') {
    const r = await http('POST', `${PAGAMENTO}/transacoes`, { corpo: solicitacao, headers: { 'Idempotency-Key': chave } });
    if (r.status !== 202) falhar(`POST /transacoes respondeu ${r.status}: ${JSON.stringify(r.json)}`);
    transacao = r.json.transacao;
    info(`POST ${PAGAMENTO}/transacoes → ${r.status} Accepted (a resposta não espera a confirmação)`);
  } else {
    const r = await fetch(`${RABBITMQ_API}/api/exchanges/%2F/amq.default/publish`, {
      method: 'POST',
      headers: { Authorization: RABBITMQ_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: 'pagamentos.solicitacoes',
        properties: { message_id: chave, content_type: 'application/json', delivery_mode: 2 },
        payload: JSON.stringify(solicitacao),
        payload_encoding: 'string',
      }),
    }).catch((e) => falhar(`não foi possível publicar pela API do RabbitMQ: ${e.message}`));
    const corpo = await r.json();
    if (!corpo.routed) falhar('a mensagem não foi roteada para a fila pagamentos.solicitacoes');
    info('mensagem publicada na fila pagamentos.solicitacoes (via API HTTP do painel do RabbitMQ)');
    transacao = await aguardar('transação criada a partir da mensagem AMQP', async () => {
      const { json } = await http('GET', `${PAGAMENTO}/transacoes?pedidoId=${solicitacao.pedidoId}`);
      return json?.transacoes?.[0];
    });
  }
  if (transacao.status !== 'PENDENTE' && transacao.status !== 'SUCESSO') falhar(`status inesperado: ${transacao.status}`);
  ok('[I]', `transação ${transacao.id} armazenada com status ${transacao.status === 'PENDENTE' ? amarelo('PENDENTE') : transacao.status}`);

  // Etapas II e III — evento transacao.recebida → notificação de solicitação recebida
  const n1 = await aguardar('notificação de solicitação recebida', () => notificacao(transacao.id, 'SOLICITACAO_RECEBIDA'));
  ok('[II]', 'mensagem transacao.recebida publicada no RabbitMQ');
  ok('[III]', `notificação lida da fila e enviada: "${n1.assunto}" → ${n1.destinatario}`);

  // Etapa IV — transação confirmada
  const confirmada = await aguardar('status SUCESSO', async () => {
    const { json } = await http('GET', `${PAGAMENTO}/transacoes/${transacao.id}`);
    return json?.status === 'SUCESSO' ? json : null;
  });
  ok('[IV]', `transação confirmada: status ${verde('SUCESSO')} (autorização ${confirmada.codigoAutorizacao})`);

  // Etapas V e VI — evento transacao.confirmada → notificação de pagamento confirmado
  const n2 = await aguardar('notificação de pagamento confirmado', () => notificacao(transacao.id, 'PAGAMENTO_CONFIRMADO'));
  ok('[V]', 'mensagem transacao.confirmada publicada no RabbitMQ');
  ok('[VI]', `notificação lida da fila e enviada: "${n2.assunto}" → ${n2.destinatario}`);

  if (new Date(n1.enviadaEm) > new Date(n2.enviadaEm)) falhar('as notificações foram enviadas fora de ordem');

  // Conferência na caixa de entrada do Mailpit (opcional: só se ele estiver acessível)
  const caixa = await http('GET', `${MAILPIT}/api/v1/search?query=${encodeURIComponent(transacao.id)}`).catch(() => null);
  if (caixa?.status === 200) {
    const assuntos = caixa.json.messages.map((m) => m.Subject);
    if (caixa.json.messages_count !== 2) falhar(`esperados 2 e-mails no Mailpit, encontrados ${caixa.json.messages_count}`);
    ok('', `2 e-mails na caixa de entrada do Mailpit (${MAILPIT}): ${assuntos.map((a) => `"${a}"`).join(' e ')}`);
  } else {
    info(`Mailpit não acessível em ${MAILPIT}; conferência dos e-mails ignorada`);
  }

  // Idempotência — reenviar a mesma solicitação não cria outra transação
  if (via === 'rest') {
    const r = await http('POST', `${PAGAMENTO}/transacoes`, { corpo: solicitacao, headers: { 'Idempotency-Key': chave } });
    if (r.status !== 200 || r.json.transacao.id !== transacao.id) falhar('o reenvio com a mesma Idempotency-Key criou outra transação');
    ok('', `reenvio com a mesma Idempotency-Key devolveu a mesma transação (HTTP ${r.status}, sem nova cobrança)`);
  }

  const tempo = ((new Date(n2.enviadaEm) - new Date(transacao.criadaEm)) / 1000).toFixed(1);
  console.log(`\n${verde(negrito('Fluxo concluído'))}: da solicitação à notificação de confirmação em ${tempo}s.`);
  console.log(cinza(`Transação:     ${PAGAMENTO}/transacoes/${transacao.id}`));
  console.log(cinza(`Notificações:  ${NOTIFICACAO}/notificacoes?transacaoId=${transacao.id}`));
  console.log(cinza(`E-mails:       ${MAILPIT}`));
  console.log(cinza(`RabbitMQ:      ${RABBITMQ_API} (usuário e senha: comprefacil)\n`));
}

main().catch((erro) => falhar(erro.message));
