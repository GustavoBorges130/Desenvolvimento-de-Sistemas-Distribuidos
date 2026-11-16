-- Banco exclusivo do serviço de notificação.
-- Guarda o histórico de notificações enviadas; não acessa dados do serviço de pagamento.

CREATE TABLE IF NOT EXISTS notificacoes (
    id            UUID          PRIMARY KEY,
    -- id do evento recebido do RabbitMQ. A restrição UNIQUE torna o consumidor idempotente:
    -- se a mesma mensagem chegar duas vezes, o cliente recebe apenas um e-mail.
    evento_id     UUID          NOT NULL UNIQUE,
    tipo          VARCHAR(40)   NOT NULL
                                CHECK (tipo IN ('SOLICITACAO_RECEBIDA', 'PAGAMENTO_CONFIRMADO')),
    transacao_id  UUID          NOT NULL,
    pedido_id     VARCHAR(64)   NOT NULL,
    cliente_id    VARCHAR(64)   NOT NULL,
    canal         VARCHAR(10)   NOT NULL DEFAULT 'EMAIL',
    destinatario  VARCHAR(254)  NOT NULL,
    assunto       VARCHAR(200)  NOT NULL,
    mensagem      TEXT          NOT NULL,
    status        VARCHAR(10)   NOT NULL DEFAULT 'PENDENTE'
                                CHECK (status IN ('PENDENTE', 'ENVIADA', 'FALHA')),
    tentativas    INT           NOT NULL DEFAULT 0,
    ultimo_erro   TEXT,
    recebida_em   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    enviada_em    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_notificacoes_transacao ON notificacoes (transacao_id);
CREATE INDEX IF NOT EXISTS ix_notificacoes_cliente   ON notificacoes (cliente_id);
