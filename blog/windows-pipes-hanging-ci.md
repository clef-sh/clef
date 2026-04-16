---
title: The Windows Bug That Hung Our CI Forever (And What Node's socket.end() Won't Tell You)
published: false
description: A debugging war story about piping secrets between Node.js and a Go subprocess on Windows, and why socket.end() silently fails to signal EOF.
tags: nodejs, windows, debugging, golang
cover_image:
---

Building [Clef](https://clef.sh) has a non-negotiable constraint: decrypted secrets never touch disk. Encryption and decryption go through the `sops` binary, and we pipe everything through stdin/stdout. On Linux and macOS, that's a one-liner — pass `/dev/stdin` as SOPS's input file and stream the content in.

Then we enabled Windows CI, and every test hung until GitHub Actions killed the job at the six-hour timeout.

Here's what happened, and why the fix is three characters different from what you'd probably write first.

## The constraint and the Windows problem

SOPS is a Go binary. It expects a file path as input. On Unix we exploit the fact that `/dev/stdin` is a real path that resolves to the current process's standard input — SOPS opens it, reads to EOF, and we're done.

Windows has no `/dev/stdin`. There's no equivalent path you can hand to a subprocess. So we need another way to give SOPS a "file" that's really a stream.

The Windows answer is **named pipes**: paths of the form `\\.\pipe\name` that Go's `os.Open` / `CreateFile` can open exactly like a regular file. The first naive version looked like this:

```ts
const server = net.createServer((socket) => {
  socket.end(content);  // <-- seems reasonable
});
server.listen(`\\\\.\\pipe\\clef-sops-${randomBytes(8).toString("hex")}`, () => {
  spawn("sops", ["-e", pipeName], ...);
});
```

`socket.end(content)` is the standard Node idiom: write the payload, half-close the stream, let the reader see EOF.

On Unix this works perfectly. On Windows, SOPS would open the pipe, read our content, and then **wait forever**. The Go side never saw EOF, so its `io.ReadAll` never returned.

## Why `socket.end()` lies on Windows pipes

This is the part that cost me half a day.

Node's `socket.end()` is supposed to flush pending writes and then signal EOF to the peer via a half-close. Under the hood, that half-close is implemented by libuv's `uv_shutdown`, which on Unix sockets calls `shutdown(fd, SHUT_WR)`. The peer's `read()` returns 0 bytes. Clean EOF.

On Windows named pipes, **`uv_shutdown` is effectively a no-op**. There's no half-close primitive for Windows pipes — the only way to signal "I'm done writing" is to close the handle entirely. But libuv keeps the handle open because, from its perspective, you only asked to shut down the write side.

So from the Go side: the pipe is still open, no bytes are arriving, but there's no EOF either. `ReadAll` does the only thing it can — it blocks.

## The fix

Close the handle instead of half-closing it:

```ts
const server = net.createServer((socket) => {
  socket.write(content, () => {
    socket.destroy();
  });
});
```

Three things matter here:

1. **`socket.write()` instead of `socket.end()`** — we're doing the flush ourselves.
2. **The callback** — don't destroy until the write is flushed to the kernel, or you'll truncate the content.
3. **`socket.destroy()` instead of `socket.end()`** — destroy closes the handle. Go's `CreateFile` handle to the pipe now returns `ERROR_BROKEN_PIPE` on the next read, which Go's stdlib maps to `io.EOF`. The read loop terminates. SOPS proceeds.

The final code lives in [`packages/core/src/sops/client.ts`](https://github.com/clef-sh/clef/blob/main/packages/core/src/sops/client.ts):

```ts
const server = net.createServer((socket) => {
  // On Windows, socket.end() does not reliably signal EOF to named pipe
  // clients because libuv's uv_shutdown is a no-op for pipes. Write the
  // content and then force-destroy the socket so the pipe handle is closed,
  // which the Go client (sops) sees as ERROR_BROKEN_PIPE → io.EOF.
  socket.write(content, () => {
    socket.destroy();
  });
});
```

## Takeaways

A few things I walked away with:

- **`socket.end()` is not a portable EOF signal.** It works on TCP sockets and Unix domain sockets because the underlying primitives support half-close. On Windows named pipes, there is no half-close — only handle close.
- **Cross-runtime pipes are a minefield.** Node and Go both abstract over platform-specific pipe semantics, but the abstractions don't line up exactly. The bug only shows up when both runtimes are on the Windows side of the abstraction at the same time.
- **"Silent hang in CI" is a strong signal.** If the failure mode is "no output, no error, just timeout," the problem is almost always an EOF / blocking-read mismatch somewhere. No exception means neither side _thinks_ anything is wrong.

If you're curious about the larger design — why we're piping to SOPS in the first place, and how the in-memory-only constraint shapes the rest of the architecture — the [whitepaper](https://github.com/clef-sh/clef/blob/main/whitepaper.md) has the longer version.
