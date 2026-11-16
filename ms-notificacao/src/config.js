// Configuração lida de variáveis de ambiente.
// Os valores padrão permitem rodar o serviço fora do Docker (npm start),
// usando a infraestrutura do docker-compose exposta em localhost.

const env = process.env;

function numero(nome, padrao) {
  const valor = Number(env[nome] ?? padrao);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`Variável de ambiente ${nome} inválida: "${env[nome]}"`);
  }
  return valor;
}

export const config = Object.freeze({
  servico: 'ms-notificacao',
  porta: numero('PORT', 3002),
  databaseUrl: env.DATABASE_URL ?? 'postgres://notificacao:notificacao@localhost:5434/notificacoes',
  rabbitmqUrl: env.RABBITMQ_URL ?? 'amqp://comprefacil:comprefacil@localhost:5672',
  // Servidor SMTP. No docker-compose é o Mailpit, que captura os e-mails e os mostra em http://localhost:8025.
  // Deixe SMTP_HOST vazio para apenas registrar as notificações no log, sem enviar e-mail.
  smtpHost: env.SMTP_HOST ?? 'localhost',
  smtpPorta: numero('SMTP_PORT', 1025),
  smtpUsuario: env.SMTP_USER || undefined,
  smtpSenha: env.SMTP_PASS || undefined,
  emailRemetente: env.EMAIL_REMETENTE ?? 'CompreFácil <nao-responda@comprefacil.com.br>',
});
