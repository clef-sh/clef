/**
 * Thrown when the transaction lock is held by another process and could not
 * be acquired within the configured retry budget.
 */
export class TransactionLockError extends Error {
  constructor(
    public readonly holderPid: number | null,
    message: string,
  ) {
    super(message);
    this.name = "TransactionLockError";
  }
}

/**
 * Thrown when the preflight checks fail before any mutation is attempted.
 * No side effects have occurred at this point — the working tree is untouched.
 */
export class TransactionPreflightError extends Error {
  constructor(
    public readonly reason:
      | "not-a-repo"
      | "dirty-tree"
      | "mid-operation"
      | "no-author-identity"
      | "no-commits",
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "TransactionPreflightError";
  }
}

/**
 * Thrown when a mutation failed AND the rollback either succeeded or failed.
 *
 * If `rollbackOk` is true, the working tree was restored to its pre-mutation
 * state and the user only needs to address the original error.
 *
 * If `rollbackOk` is false, the working tree is in an unknown state and the
 * user must inspect manually with `git status`.
 */
export class TransactionRollbackError extends Error {
  constructor(
    public readonly originalError: Error,
    public readonly rollbackOk: boolean,
    message: string,
  ) {
    super(message);
    this.name = "TransactionRollbackError";
  }
}
