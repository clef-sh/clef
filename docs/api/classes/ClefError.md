[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefError

# Class: ClefError

Defined in: [packages/core/src/types/index.ts:338](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L338)

Base error class for all Clef errors.
Carries an optional `fix` hint string describing how to resolve the issue.

## Extends

- `Error`

## Extended by

- [`ManifestValidationError`](ManifestValidationError.md)
- [`SopsDecryptionError`](SopsDecryptionError.md)
- [`SopsEncryptionError`](SopsEncryptionError.md)
- [`SopsKeyNotFoundError`](SopsKeyNotFoundError.md)
- [`GitOperationError`](GitOperationError.md)
- [`SchemaLoadError`](SchemaLoadError.md)
- [`SopsMissingError`](SopsMissingError.md)
- [`SopsVersionError`](SopsVersionError.md)

## Constructors

### Constructor

```ts
new ClefError(message, fix?): ClefError;
```

Defined in: [packages/core/src/types/index.ts:339](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L339)

#### Parameters

| Parameter | Type     |
| --------- | -------- |
| `message` | `string` |
| `fix?`    | `string` |

#### Returns

`ClefError`

#### Overrides

```ts
Error.constructor;
```

## Properties

| Property                                                | Modifier   | Type      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       | Inherited from          | Defined in                                                                                                                                                  |
| ------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cause"></a> `cause?`                    | `public`   | `unknown` | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.cause`           | node_modules/typescript/lib/lib.es2022.error.d.ts:26                                                                                                        |
| <a id="property-fix"></a> `fix?`                        | `readonly` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -                       | [packages/core/src/types/index.ts:341](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L341) |
| <a id="property-message"></a> `message`                 | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.message`         | node_modules/typescript/lib/lib.es5.d.ts:1077                                                                                                               |
| <a id="property-name"></a> `name`                       | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.name`            | node_modules/typescript/lib/lib.es5.d.ts:1076                                                                                                               |
| <a id="property-stack"></a> `stack?`                    | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.stack`           | node_modules/typescript/lib/lib.es5.d.ts:1078                                                                                                               |
| <a id="property-stacktracelimit"></a> `stackTraceLimit` | `static`   | `number`  | The `Error.stackTraceLimit` property specifies the number of stack frames collected by a stack trace (whether generated by `new Error().stack` or `Error.captureStackTrace(obj)`). The default value is `10` but may be set to any valid JavaScript number. Changes will affect any stack trace captured _after_ the value has been changed. If set to a non-number value, or set to a negative number, stack traces will not capture any frames. | `Error.stackTraceLimit` | packages/core/node_modules/@types/node/globals.d.ts:68                                                                                                      |

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

```ts
Error.captureStackTrace;
```

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

```ts
Error.prepareStackTrace;
```
