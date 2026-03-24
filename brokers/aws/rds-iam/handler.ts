import { Signer } from "@aws-sdk/rds-signer";
import type { BrokerHandler } from "@clef-sh/broker";

export const handler: BrokerHandler = {
  create: async (config) => {
    const signer = new Signer({
      hostname: config.DB_ENDPOINT,
      port: Number(config.DB_PORT ?? "5432"),
      username: config.DB_USER,
    });

    return {
      data: { DB_TOKEN: await signer.getAuthToken() },
      ttl: 900,
    };
  },
};
