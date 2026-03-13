[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / isGitUrl

# Function: isGitUrl()

```ts
function isGitUrl(value): boolean;
```

Defined in: [packages/core/src/git/remote.ts:18](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/git/remote.ts#L18)

Returns true if value looks like a git remote URL (SSH or HTTPS).
Local paths — absolute or relative — return false.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `value`   | `string` |

## Returns

`boolean`

## Example

```ts
isGitUrl("git@github.com:acme/secrets.git"); // true
isGitUrl("https://github.com/acme/secrets"); // true
isGitUrl("/home/user/secrets"); // false
```
