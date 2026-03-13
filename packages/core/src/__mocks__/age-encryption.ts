export const generateIdentity = jest.fn().mockResolvedValue("AGE-SECRET-KEY-1MOCKPRIVATEKEY1234");
export const identityToRecipient = jest
  .fn()
  .mockResolvedValue("age1mockpublickey00000000000000000000000000000000000000000000");
