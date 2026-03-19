export const generateIdentity = jest.fn().mockResolvedValue("AGE-SECRET-KEY-1MOCKPRIVATEKEY1234");
export const identityToRecipient = jest
  .fn()
  .mockResolvedValue("age1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn5");

export const Encrypter = jest.fn().mockImplementation(() => ({
  addRecipient: jest.fn(),
  encrypt: jest
    .fn()
    .mockResolvedValue(
      "-----BEGIN AGE ENCRYPTED FILE-----\nmockencrypted\n-----END AGE ENCRYPTED FILE-----",
    ),
}));

export const Decrypter = jest.fn().mockImplementation(() => ({
  addIdentity: jest.fn(),
  decrypt: jest.fn().mockResolvedValue('{"KEY":"value"}'),
}));
