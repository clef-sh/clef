import { GcpKmsProvider } from "./gcp";

describe("GcpKmsProvider", () => {
  const provider = new GcpKmsProvider();

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
