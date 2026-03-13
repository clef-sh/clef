[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / resolveRemoteRepo

# Function: resolveRemoteRepo()

```ts
function resolveRemoteRepo(url, branch, runner): Promise<string>;
```

Defined in: [packages/core/src/git/remote.ts:51](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/git/remote.ts#L51)

Resolves a git URL to a local path by cloning or updating a shallow cache.

Cache lives at `~/.cache/clef/<url-hash>/`. On every call, the cache is
either created (first use) or refreshed to the tip of the requested branch.
Shallow clones (`--depth 1`) keep the operation fast.

This is intentionally read-only — no commit or push operations are performed.

## Parameters

| Parameter | Type                                                    | Description                                                    |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| `url`     | `string`                                                | SSH (`git@...`) or HTTPS (`https://...`) git remote URL.       |
| `branch`  | `string` \| `undefined`                                 | Branch to check out. Defaults to the remote's HEAD if omitted. |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) | Subprocess runner used to invoke git.                          |

## Returns

`Promise`\<`string`\>

Absolute path to the local clone, ready for use as a `repoRoot`.

## Throws

`Error` If the clone or fetch fails (e.g. auth failure, unknown branch).
