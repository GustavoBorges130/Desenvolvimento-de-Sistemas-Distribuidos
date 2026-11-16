// Logger simples em texto, legível no terminal e no `docker compose logs`.
// As mensagens do fluxo do desafio começam com o número da etapa ([I] a [VI]).

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };

export function criarLogger(servico, nivelMinimo = process.env.LOG_LEVEL ?? 'info') {
  const minimo = NIVEIS[nivelMinimo] ?? NIVEIS.info;

  function escrever(nivel, mensagem, erro) {
    if (NIVEIS[nivel] < minimo) return;
    const linha = `${new Date().toISOString()} ${nivel.toUpperCase().padEnd(5)} [${servico}] ${mensagem}`;
    const saida = nivel === 'error' || nivel === 'warn' ? console.error : console.log;
    saida(linha);
    if (erro instanceof Error && nivel === 'error') {
      saida(erro.stack ?? erro.message);
    }
  }

  return {
    debug: (msg) => escrever('debug', msg),
    info: (msg) => escrever('info', msg),
    warn: (msg) => escrever('warn', msg),
    error: (msg, erro) => escrever('error', msg, erro),
  };
}
