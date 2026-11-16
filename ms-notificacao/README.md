# ms-notificacao

Serviço de notificações da CompreFácil. Consome por **AMQP** os eventos `transacao.recebida` e `transacao.confirmada`, publicados pelo serviço de pagamento, na fila `notificacoes.transacoes`. Para cada evento, envia um e-mail ao cliente e guarda o histórico, que pode ser consultado por **REST** (`GET /notificacoes`).

As instruções completas (execução, testes e arquitetura) estão no [README principal](../README.md).

## Executar isoladamente

```bash
# na raiz do repositório: infraestrutura
docker compose up -d rabbitmq postgres-notificacao mailpit

# nesta pasta
npm install
npm start          # API em http://localhost:3002 · e-mails em http://localhost:8025
npm test           # testes unitários
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3002` | Porta da API REST |
| `DATABASE_URL` | `postgres://notificacao:notificacao@localhost:5434/notificacoes` | Banco exclusivo do serviço |
| `RABBITMQ_URL` | `amqp://comprefacil:comprefacil@localhost:5672` | Broker de mensagens |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Servidor SMTP (Mailpit). Com `SMTP_HOST` vazio, as notificações só vão para o log |
| `SMTP_USER` / `SMTP_PASS` | — | Credenciais SMTP, se o servidor exigir |
| `EMAIL_REMETENTE` | `CompreFácil <nao-responda@comprefacil.com.br>` | Remetente dos e-mails |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

## Organização

```
src/
├── server.js                       inicialização e encerramento gracioso
├── app.js                          API REST (Express) e /health
├── config.js                       variáveis de ambiente
├── db.js                           conexão e migrações do PostgreSQL
├── consumidores/
│   └── eventos-transacao.js        fila notificacoes.transacoes (etapas III e VI)
├── notificacoes/
│   ├── modelos.js                  validação dos eventos e texto dos e-mails
│   ├── repositorio.js              SQL da tabela notificacoes
│   ├── servico.js                  envio idempotente com retentativas
│   └── rotas.js                    rotas /notificacoes
├── canais/email.js                 envio por SMTP (Nodemailer)
└── mensageria/
    ├── topologia.js                exchange, fila, ligações e DLQ
    └── rabbitmq.js                 conexão com reconexão automática
```
