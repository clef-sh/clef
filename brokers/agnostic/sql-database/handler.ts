import { randomBytes } from "crypto";
import Handlebars from "handlebars";
import knex, { type Knex } from "knex";
import type { BrokerHandler } from "@clef-sh/broker";

function connect(config: Record<string, string>): Knex {
  return knex({
    client: config.DB_CLIENT ?? "pg",
    connection: {
      host: config.DB_HOST,
      port: Number(config.DB_PORT ?? "5432"),
      user: config.DB_ADMIN_USER,
      password: config.DB_ADMIN_PASSWORD,
      database: config.DB_NAME,
    },
  });
}

export const handler: BrokerHandler = {
  create: async (config) => {
    const ttl = Number(config.TTL ?? "3600");
    const username = `clef_${Date.now()}`;
    const password = randomBytes(24).toString("base64url");
    const expiration = new Date(Date.now() + ttl * 1000).toISOString();

    const sql = Handlebars.compile(config.CREATE_STATEMENT)({ username, password, expiration });

    const db = connect(config);
    try {
      await db.raw(sql);
    } finally {
      await db.destroy();
    }

    return {
      data: { DB_USER: username, DB_PASSWORD: password },
      ttl,
      entityId: username,
    };
  },

  revoke: async (entityId, config) => {
    const sql = Handlebars.compile(config.REVOKE_STATEMENT)({ username: entityId });

    const db = connect(config);
    try {
      await db.raw(sql);
    } finally {
      await db.destroy();
    }
  },

  validateConnection: async (config) => {
    const db = connect(config);
    try {
      await db.raw("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await db.destroy();
    }
  },
};
