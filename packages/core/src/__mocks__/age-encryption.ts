export const generateIdentity = jest.fn().mockResolvedValue("AGE-SECRET-KEY-1MOCKPRIVATEKEY1234");
export const identityToRecipient = jest
  .fn()
  .mockReturnValue("age1mockpublickey00000000000000000000000000000000000000000000");
