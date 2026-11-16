import { randomBytes } from 'node:crypto';
import { esperar } from '../util.js';

/**
 * Simula a autorização da cobrança em um provedor de pagamento externo (PSP).
 * Em produção, aqui ficaria a chamada HTTP ao PSP, com tempo-limite e chave idempotente.
 */
export function criarGatewaySimulado({ atrasoMs }) {
  return {
    async autorizar(/* transacao */) {
      await esperar(atrasoMs);
      return { aprovada: true, codigoAutorizacao: `AUT-${randomBytes(4).toString('hex').toUpperCase()}` };
    },
  };
}
