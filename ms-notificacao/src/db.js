import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { esperar } from './util.js';

const PASTA_MIGRACOES = fileURLToPath(new URL('../db/migrations/', import.meta.url));

export function criarPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Aguarda o PostgreSQL aceitar conexões (útil quando o serviço sobe antes do banco). */
export async function aguardarBanco(pool, logger, { tentativas = 30, esperaMs = 2000 } = {}) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await pool.query('SELECT 1');
      logger.info('conectado ao PostgreSQL');
      return;
    } catch (erro) {
      if (tentativa >= tentativas) throw erro;
      logger.warn(`PostgreSQL indisponível (${erro.message}); nova tentativa em ${esperaMs} ms`);
      await esperar(esperaMs);
    }
  }
}

/**
 * Aplica, em ordem, os arquivos .sql de db/migrations que ainda não foram aplicados.
 * Um advisory lock impede que duas réplicas do serviço migrem ao mesmo tempo.
 */
export async function migrar(pool, logger) {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock(727002)');
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        arquivo     VARCHAR(200) PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await cliente.query('SELECT arquivo FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.arquivo));
    const arquivos = (await readdir(PASTA_MIGRACOES)).filter((a) => a.endsWith('.sql')).sort();

    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await readFile(path.join(PASTA_MIGRACOES, arquivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migrations (arquivo) VALUES ($1)', [arquivo]);
        await cliente.query('COMMIT');
        logger.info(`migração aplicada: ${arquivo}`);
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      }
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(727002)').catch(() => {});
    cliente.release();
  }
}

/** Executa `fn` dentro de uma transação do banco (BEGIN/COMMIT/ROLLBACK). */
export async function emTransacao(pool, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}
