[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsDecryptionError

# Class: SopsDecryptionError

Defined in: [packages/core/src/types/index.ts:371](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L371)

Thrown when SOPS decryption fails (bad key, corrupt file, etc.).

## Extends

- [`ClefError`](ClefError.md)

## Constructors

### Constructor

```ts
new SopsDecryptionError(message, filePath?): SopsDecryptionError;
```

Defined in: [packages/core/src/types/index.ts:372](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L372)

#### Parameters

| Parameter   | Type     |
| ----------- | -------- |
| `message`   | `string` |
| `filePath?` | `string` |

#### Returns

`SopsDecryptionError`

#### Overrides

[`ClefError`](ClefError.md).[`constructor`](ClefError.md#constructor)

## Properties

| Property                                                | Modifier   | Type      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       | Inherited from                                                                         | Defined in                                                                                                                                                  |
| ------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cause"></a> `cause?`                    | `public`   | `unknown` | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`ClefError`](ClefError.md).[`cause`](ClefError.md#property-cause)                     | node_modules/typescript/lib/lib.es2022.error.d.ts:26                                                                                                        |
| <a id="property-filepath"></a> `filePath?`              | `readonly` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -                                                                                      | [packages/core/src/types/index.ts:374](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L374) |
| <a id="property-fix"></a> `fix?`                        | `readonly` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`ClefError`](ClefError.md).[`fix`](ClefError.md#property-fix)                         | [packages/core/src/types/index.ts:352](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L352) |
| <a id="property-message"></a> `message`                 | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`ClefError`](ClefError.md).[`message`](ClefError.md#property-message)                 | node_modules/typescript/lib/lib.es5.d.ts:1077                                                                                                               |
| <a id="property-name"></a> `name`                       | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`ClefError`](ClefError.md).[`name`](ClefError.md#property-name)                       | node_modules/typescript/lib/lib.es5.d.ts:1076                                                                                                               |
| <a id="property-stack"></a> `stack?`                    | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`ClefError`](ClefError.md).[`stack`](ClefError.md#property-stack)                     | node_modules/typescript/lib/lib.es5.d.ts:1078                                                                                                               |
| <a id="property-stacktracelimit"></a> `stackTraceLimit` | `static`   | `number`  | The `Error.stackTraceLimit` property specifies the number of stack frames collected by a stack trace (whether generated by `new Error().stack` or `Error.captureStackTrace(obj)`). The default value is `10` but may be set to any valid JavaScript number. Changes will affect any stack trace captured _after_ the value has been changed. If set to a non-number value, or set to a negative number, stack traces will not capture any frames. | [`ClefError`](ClefError.md).[`stackTraceLimit`](ClefError.md#property-stacktracelimit) | packages/core/node_modules/@types/node/globals.d.ts:68                                                                                                      |

## Methods

### captureStackTrace()

```ts
static captureStackTrace(targetObject, constructorOpt?): void;
```

Defined in: packages/core/node_modules/@types/node/globals.d.ts:52

Creates a `.stack` property on `targetObject`, which when accessed returns
a string representing the location in the code at which
`Error.captureStackTrace()` was called.

```js
const myObject = {};
Error.captureStackTrace(myObject);
myObject.stack; // Similar to `new Error().stack`
```

The first line of the trace will be prefixed with
`${myObject.name}: ${myObject.message}`.

The optional `constructorOpt` argument accepts a function. If given, all frames
above `constructorOpt`, including `constructorOpt`, will be omitted from the
generated stack trace.

The `constructorOpt` argument is useful for hiding implementation
details of error generation from the user. For instance:

```js
function a() {
  b();
}

function b() {
  c();
}

function c() {
  // Create an error without stack trace to avoid calculating the stack trace twice.
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  const error = new Error();
  Error.stackTraceLimit = stackTraceLimit;

  // Capture the stack trace above function b
  Error.captureStackTrace(error, b); // Neither function c, nor b is included in the stack trace
  throw error;
}

a();
```

#### Parameters

| Parameter         | Type       |
| ----------------- | ---------- |
| `targetObject`    | `object`   |
| `constructorOpt?` | `Function` |

#### Returns

`void`

#### Inherited from

[`ClefError`](ClefError.md).[`captureStackTrace`](ClefError.md#capturestacktrace)

---

### prepareStackTrace()

```ts
static prepareStackTrace(err, stackTraces): any;
```

Defined in: packages/core/node_modules/@types/node/globals.d.ts:56

#### Parameters

| Parameter     | Type         |
| ------------- | ------------ |
| `err`         | `Error`      |
| `stackTraces` | `CallSite`[] |

#### Returns

`any`

#### See

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

#### Inherited from

[`ClefError`](ClefError.md).[`prepareStackTrace`](ClefError.md#preparestacktrace)
