-- Banco exclusivo do serviço de pagamento.
-- Nenhum outro serviço lê ou grava estas tabelas.

CREATE TABLE IF NOT EXISTS transacoes (
    id                 UUID          PRIMARY KEY,
    pedido_id          VARCHAR(64)   NOT NULL,
    cliente_id         VARCHAR(64)   NOT NULL,
    cliente_nome       VARCHAR(120)  NOT NULL,
    cliente_email      VARCHAR(254)  NOT NULL,
    valor              NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    metodo_pagamento   VARCHAR(20)   NOT NULL,
    status             VARCHAR(20)   NOT NULL DEFAULT 'PENDENTE'
                                     CHECK (status IN ('PENDENTE', 'SUCESSO')),
    origem             VARCHAR(10)   NOT NULL CHECK (origem IN ('REST', 'AMQP')),
    -- Chave enviada pelo cliente (header Idempotency-Key ou messageId da mensagem AMQP).
    -- Impede que a mesma solicitação gere duas cobranças.
    chave_idempotencia VARCHAR(100)  UNIQUE,
    codigo_autorizacao VARCHAR(40),
    criada_em          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atualizada_em      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    confirmada_em      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_transacoes_cliente ON transacoes (cliente_id);
CREATE INDEX IF NOT EXISTS ix_transacoes_pedido  ON transacoes (pedido_id);
CREATE INDEX IF NOT EXISTS ix_transacoes_status  ON transacoes (status);

-- Transactional outbox: o evento é gravado na mesma transação que altera a transação
-- de pagamento e depois publicado no RabbitMQ por um processo separado (relay).
-- Assim, nenhum evento se perde se o broker estiver fora do ar no momento da gravação.
CREATE TABLE IF NOT EXISTS outbox (
    seq          BIGSERIAL    PRIMARY KEY,
    evento_id    UUID         NOT NULL UNIQUE,
    tipo         VARCHAR(60)  NOT NULL,
    routing_key  VARCHAR(100) NOT NULL,
    payload      JSONB        NOT NULL,
    criada_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    publicada_em TIMESTAMPTZ,
    tentativas   INT          NOT NULL DEFAULT 0,
    ultimo_erro  TEXT
);

CREATE INDEX IF NOT EXISTS ix_outbox_pendentes ON outbox (seq) WHERE publicada_em IS NULL;
