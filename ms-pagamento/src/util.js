export const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn` e, em caso de erro, tenta de novo com espera crescente.
 * Usado para falhas transitórias (banco reiniciando, rede instável).
 */
export async function comRetentativas(fn, { tentativas = 3, esperaInicialMs = 500, aoFalhar } = {}) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await fn(tentativa);
    } catch (erro) {
      ultimoErro = erro;
      aoFalhar?.(erro, tentativa);
      if (tentativa < tentativas) await esperar(esperaInicialMs * 2 ** (tentativa - 1));
    }
  }
  throw ultimoErro;
}
