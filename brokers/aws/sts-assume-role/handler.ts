import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type { BrokerHandler } from "@clef-sh/broker";

const sts = new STSClient({});

export const handler: BrokerHandler = {
  create: async (config) => {
    const duration = Number(config.DURATION ?? "3600");
    const { Credentials } = await sts.send(
      new AssumeRoleCommand({
        RoleArn: config.ROLE_ARN,
        RoleSessionName: config.SESSION_NAME ?? `clef-${Date.now()}`,
        DurationSeconds: duration,
      }),
    );

    if (!Credentials?.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) {
      throw new Error("STS AssumeRole returned incomplete credentials");
    }

    return {
      data: {
        AWS_ACCESS_KEY_ID: Credentials.AccessKeyId,
        AWS_SECRET_ACCESS_KEY: Credentials.SecretAccessKey,
        AWS_SESSION_TOKEN: Credentials.SessionToken,
      },
      ttl: duration,
    };
  },
};
