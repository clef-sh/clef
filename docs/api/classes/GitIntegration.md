[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / GitIntegration

# Class: GitIntegration

Defined in: [packages/core/src/git/integration.ts:53](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L53)

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

Defined in: [packages/core/src/git/integration.ts:54](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L54)

#### Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

#### Returns

`GitIntegration`

## Methods

### commit()

```ts
commit(message, repoRoot): Promise<string>;
```

Defined in: [packages/core/src/git/integration.ts:84](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L84)

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

Defined in: [packages/core/src/git/integration.ts:143](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L143)

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

Defined in: [packages/core/src/git/integration.ts:107](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L107)

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

Defined in: [packages/core/src/git/integration.ts:159](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L159)

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

### installPreCommitHook()

```ts
installPreCommitHook(repoRoot): Promise<void>;
```

Defined in: [packages/core/src/git/integration.ts:201](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L201)

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

Defined in: [packages/core/src/git/integration.ts:63](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/git/integration.ts#L63)

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
