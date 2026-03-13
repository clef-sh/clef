[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SubprocessRunner

# Interface: SubprocessRunner

Defined in: [packages/core/src/types/index.ts:18](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L18)

Abstraction over subprocess execution used throughout the core library.
Inject a real implementation (`NodeSubprocessRunner`) in production and a
mock via `jest.fn()` in unit tests — no real subprocess calls in tests.

## Methods

### run()

```ts
run(
   command,
   args,
options?): Promise<SubprocessResult>;
```

Defined in: [packages/core/src/types/index.ts:19](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L19)

#### Parameters

| Parameter  | Type                                        |
| ---------- | ------------------------------------------- |
| `command`  | `string`                                    |
| `args`     | `string`[]                                  |
| `options?` | [`SubprocessOptions`](SubprocessOptions.md) |

#### Returns

`Promise`\<[`SubprocessResult`](SubprocessResult.md)\>
