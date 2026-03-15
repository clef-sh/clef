[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / GitIntegration

# Class: GitIntegration

Defined in: [packages/core/src/git/integration.ts:53](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L53)

Wraps git operations: staging, committing, log, diff, status, and hook installation.

## Example

```ts
const git = new GitIntegration(runner);
await git.stageFiles(["secrets/app/production.enc.yaml"], repoRoot);
const hash = await git.commit("chore(secrets): rotate production keys", repoRoot);
```

## Constructors

### Constructor

```ts
new GitIntegration(runner): GitIntegration;
```

Defined in: [packages/core/src/git/integration.ts:54](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L54)

#### Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

#### Returns

`GitIntegration`

## Methods

### checkMergeDriver()

```ts
checkMergeDriver(repoRoot): Promise<{
  gitattributes: boolean;
  gitConfig: boolean;
}>;
```

Defined in: [packages/core/src/git/integration.ts:244](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L244)

Check whether the SOPS merge driver is configured in both
`.git/config` and `.gitattributes`.

#### Parameters

| Parameter  | Type     | Description                           |
| ---------- | -------- | ------------------------------------- |
| `repoRoot` | `string` | Absolute path to the repository root. |

#### Returns

`Promise`\<\{
`gitattributes`: `boolean`;
`gitConfig`: `boolean`;
\}\>

An object indicating which parts are configured.

---

### commit()

```ts
commit(message, repoRoot): Promise<string>;
```

Defined in: [packages/core/src/git/integration.ts:84](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L84)

Create a commit with the given message.

#### Parameters

| Parameter  | Type     | Description                            |
| ---------- | -------- | -------------------------------------- |
| `message`  | `string` | Commit message.                        |
| `repoRoot` | `string` | Working directory for the git command. |

#### Returns

`Promise`\<`string`\>

The short commit hash, or an empty string if parsing fails.

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### getDiff()

```ts
getDiff(repoRoot): Promise<string>;
```

Defined in: [packages/core/src/git/integration.ts:143](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L143)

Get the staged diff (`git diff --cached`).

#### Parameters

| Parameter  | Type     | Description                            |
| ---------- | -------- | -------------------------------------- |
| `repoRoot` | `string` | Working directory for the git command. |

#### Returns

`Promise`\<`string`\>

Raw diff output as a string.

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### getLog()

```ts
getLog(
   filePath,
   repoRoot,
limit?): Promise<GitCommit[]>;
```

Defined in: [packages/core/src/git/integration.ts:107](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L107)

Retrieve recent commits for a specific file.

#### Parameters

| Parameter  | Type     | Default value | Description                                        |
| ---------- | -------- | ------------- | -------------------------------------------------- |
| `filePath` | `string` | `undefined`   | Path to the file (relative to `repoRoot`).         |
| `repoRoot` | `string` | `undefined`   | Working directory for the git command.             |
| `limit`    | `number` | `20`          | Maximum number of commits to return (default: 20). |

#### Returns

`Promise`\<[`GitCommit`](../interfaces/GitCommit.md)[]\>

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### getStatus()

```ts
getStatus(repoRoot): Promise<GitStatus>;
```

Defined in: [packages/core/src/git/integration.ts:159](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L159)

Parse `git status --porcelain` into staged, unstaged, and untracked lists.

#### Parameters

| Parameter  | Type     | Description                            |
| ---------- | -------- | -------------------------------------- |
| `repoRoot` | `string` | Working directory for the git command. |

#### Returns

`Promise`\<[`GitStatus`](../interfaces/GitStatus.md)\>

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### installMergeDriver()

```ts
installMergeDriver(repoRoot): Promise<void>;
```

Defined in: [packages/core/src/git/integration.ts:207](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L207)

Configure the SOPS-aware git merge driver so that encrypted files
are merged at the plaintext level instead of producing ciphertext conflicts.

Sets two things:

1. `.gitattributes` — tells git which files use the custom driver.
2. `.git/config [merge "sops"]` — tells git what command to run.

Both operations are idempotent — safe to call repeatedly.

#### Parameters

| Parameter  | Type     | Description                           |
| ---------- | -------- | ------------------------------------- |
| `repoRoot` | `string` | Absolute path to the repository root. |

#### Returns

`Promise`\<`void`\>

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### installPreCommitHook()

```ts
installPreCommitHook(repoRoot): Promise<void>;
```

Defined in: [packages/core/src/git/integration.ts:293](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L293)

Write and chmod the Clef pre-commit hook into `.git/hooks/pre-commit`.
The hook blocks commits of unencrypted matrix files and scans staged files for secrets.

#### Parameters

| Parameter  | Type     | Description                           |
| ---------- | -------- | ------------------------------------- |
| `repoRoot` | `string` | Absolute path to the repository root. |

#### Returns

`Promise`\<`void`\>

#### Throws

[GitOperationError](GitOperationError.md) On failure.

---

### stageFiles()

```ts
stageFiles(filePaths, repoRoot): Promise<void>;
```

Defined in: [packages/core/src/git/integration.ts:63](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/git/integration.ts#L63)

Stage one or more file paths with `git add`.

#### Parameters

| Parameter   | Type       | Description                            |
| ----------- | ---------- | -------------------------------------- |
| `filePaths` | `string`[] | Paths to stage (relative or absolute). |
| `repoRoot`  | `string`   | Working directory for the git command. |

#### Returns

`Promise`\<`void`\>

#### Throws

[GitOperationError](GitOperationError.md) On failure.
