# ms-pagamento

Serviço de pagamentos da CompreFácil. Recebe solicitações de transação por **REST** (`POST /transacoes`) e por **AMQP** (fila `pagamentos.solicitacoes`). Grava cada transação como `PENDENTE`, confirma de forma assíncrona (`SUCESSO`) e publica os eventos `transacao.recebida` e `transacao.confirmada` no exchange `pagamentos.eventos` do RabbitMQ.

As instruções completas (execução, testes e arquitetura) estão no [README principal](../README.md).

## Executar isoladamente

```bash
# na raiz do repositório: infraestrutura
docker compose up -d rabbitmq postgres-pagamento

# nesta pasta
npm install
npm start          # API em http://localhost:3001
npm test           # testes unitários
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta da API REST |
| `DATABASE_URL` | `postgres://pagamento:pagamento@localhost:5433/pagamentos` | Banco exclusivo do serviço |
| `RABBITMQ_URL` | `amqp://comprefacil:comprefacil@localhost:5672` | Broker de mensagens |
| `PROCESSAMENTO_DELAY_MS` | `3000` | Tempo de autorização do gateway de pagamento simulado |
| `OUTBOX_INTERVALO_MS` | `1000` | Intervalo de varredura da outbox |
| `PROCESSAMENTO_PREFETCH` | `10` | Transações confirmadas em paralelo |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

## Organização

```
src/
├── server.js                    inicialização e encerramento gracioso
├── app.js                       API REST (Express) e /health
├── config.js                    variáveis de ambiente
├── db.js                        conexão, migrações e transações do PostgreSQL
├── transacoes/
│   ├── validacao.js             validação do corpo da solicitação
│   ├── eventos.js               formato das mensagens publicadas
│   ├── repositorio.js           SQL das tabelas transacoes e outbox
│   ├── servico.js               regras: solicitar (etapa I) e confirmar (etapa IV)
│   └── rotas.js                 rotas /transacoes
├── consumidores/
│   ├── solicitacoes.js          fila pagamentos.solicitacoes (interface AMQP)
│   └── processamento.js         fila pagamentos.processamento (etapa IV)
├── mensageria/
│   ├── topologia.js             exchanges, filas e ligações
│   ├── rabbitmq.js              conexão com reconexão automática
│   └── outbox-relay.js          publicação dos eventos (etapas II e V)
└── gateway/gateway-simulado.js  provedor de pagamento simulado
```
