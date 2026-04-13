/**
 * Shared jest mock for write-file-atomic. Wired in via moduleNameMapper in
 * each package's jest.config.js so consumers do not need to call jest.mock()
 * inline. Tests that want to assert on calls do:
 *
 *   import writeFileAtomic from "write-file-atomic";
 *   const mockSync = writeFileAtomic.sync as jest.Mock;
 *
 * The default export is callable (for `await writeFileAtomic(path, data)`)
 * AND exposes a `.sync` jest.fn (for `writeFileAtomic.sync(path, data)`).
 */
const sync = jest.fn();
const writeFileAtomic = Object.assign(jest.fn().mockResolvedValue(undefined), { sync });
export default writeFileAtomic;
