import { AzureKmsProvider } from "./azure";

describe("AzureKmsProvider", () => {
  const provider = new AzureKmsProvider();

  it("should throw not implemented on wrap", async () => {
    await expect(provider.wrap("key-id", Buffer.from("test"))).rejects.toThrow(
      "not yet implemented",
    );
  });

  it("should throw not implemented on unwrap", async () => {
    await expect(provider.unwrap("key-id", Buffer.from("test"), "alg")).rejects.toThrow(
      "not yet implemented",
    );
  });
});
