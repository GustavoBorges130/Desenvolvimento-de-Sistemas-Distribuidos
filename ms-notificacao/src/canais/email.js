import nodemailer from 'nodemailer';

/**
 * Canal de e-mail. No docker-compose, o SMTP é o Mailpit: ele recebe os e-mails
 * e os exibe em http://localhost:8025, sem enviar nada para fora.
 * Sem SMTP configurado, o canal apenas registra a mensagem no log.
 */
export function criarCanalEmail({ host, porta, usuario, senha, remetente, logger }) {
  if (!host) {
    return {
      descricao: 'log (SMTP não configurado)',
      async enviar({ para, assunto, texto }) {
        logger.info(`e-mail (somente log) para ${para} | ${assunto}\n${texto}`);
        return { id: null };
      },
      async verificar() {
        return true;
      },
    };
  }

  const transporte = nodemailer.createTransport({
    host,
    port: porta,
    secure: porta === 465,
    auth: usuario ? { user: usuario, pass: senha } : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  return {
    descricao: `SMTP ${host}:${porta}`,
    async enviar({ para, assunto, texto, html }) {
      const info = await transporte.sendMail({ from: remetente, to: para, subject: assunto, text: texto, html });
      return { id: info.messageId };
    },
    async verificar() {
      try {
        await transporte.verify();
        return true;
      } catch {
        return false;
      }
    },
  };
}
