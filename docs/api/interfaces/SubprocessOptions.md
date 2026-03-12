[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SubprocessOptions

# Interface: SubprocessOptions

Defined in: [packages/core/src/types/index.ts:23](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L23)

Options forwarded to the subprocess.

## Properties

| Property                             | Type                           | Description                                             | Defined in                                                                                                                                                |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cwd"></a> `cwd?`     | `string`                       | Working directory for the child process.                | [packages/core/src/types/index.ts:25](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L25) |
| <a id="property-env"></a> `env?`     | `Record`\<`string`, `string`\> | Additional environment variables for the child process. | [packages/core/src/types/index.ts:29](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L29) |
| <a id="property-stdin"></a> `stdin?` | `string`                       | Data to pipe to stdin.                                  | [packages/core/src/types/index.ts:27](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L27) |
