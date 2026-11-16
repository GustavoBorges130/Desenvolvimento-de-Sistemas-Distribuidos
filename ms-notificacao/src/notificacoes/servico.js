import { randomUUID } from 'node:crypto';
import { comRetentativas } from '../util.js';
import { montarNotificacao } from './modelos.js';
import * as repositorio from './repositorio.js';

export function criarServicoNotificacoes({ pool, canalEmail, logger }) {
  /**
   * Etapas III e VI do fluxo: registra a notificação e a envia ao cliente.
   *
   * Idempotência: o id do evento é único na tabela. Se a mesma mensagem chegar de novo
   * (o RabbitMQ garante entrega "pelo menos uma vez"), o e-mail não é enviado em dobro.
   * Uma notificação que falhou antes (status FALHA) é reenviada normalmente.
   */
  async function processarEvento(evento) {
    const conteudo = montarNotificacao(evento);
    const d = evento.dados;

    const { notificacao, nova } = await repositorio.registrar(pool, {
      id: randomUUID(),
      eventoId: evento.id,
      tipo: conteudo.tipo,
      transacaoId: d.transacaoId,
      pedidoId: String(d.pedidoId),
      clienteId: String(d.cliente.id),
      destinatario: d.cliente.email,
      assunto: conteudo.assunto,
      mensagem: conteudo.texto,
    });

    if (!nova && notificacao.status === 'ENVIADA') {
      return { notificacao, duplicada: true };
    }

    let tentativas = 0;
    try {
      await comRetentativas(
        () => {
          tentativas++;
          return canalEmail.enviar({
            para: d.cliente.email,
            assunto: conteudo.assunto,
            texto: conteudo.texto,
            html: conteudo.html,
          });
        },
        {
          tentativas: 3,
          esperaInicialMs: 1000,
          aoFalhar: (erro, n) => logger.warn(`falha ao enviar e-mail para ${d.cliente.email} (tentativa ${n}): ${erro.message}`),
        },
      );
    } catch (erro) {
      await repositorio.marcarFalha(pool, notificacao.id, tentativas, erro.message);
      throw erro;
    }

    const enviada = await repositorio.marcarEnviada(pool, notificacao.id, tentativas);
    return { notificacao: enviada, duplicada: false };
  }

  return {
    processarEvento,
    buscarPorId: (id) => repositorio.buscarPorId(pool, id),
    listar: (filtros) => repositorio.listar(pool, filtros),
  };
}
