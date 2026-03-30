# Multi-arch Dockerfile for @clef-sh/agent
#
# Expects pre-built SEA binaries in the build context:
#   clef-agent-linux-x64   (amd64)
#   clef-agent-linux-arm64 (arm64)
#
# Build with:
#   docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/clef-sh/agent .

# --- Per-architecture stages (select the correct binary) ---

FROM gcr.io/distroless/cc-debian12:nonroot AS binary-amd64
COPY clef-agent-linux-x64 /usr/local/bin/clef-agent

FROM gcr.io/distroless/cc-debian12:nonroot AS binary-arm64
COPY clef-agent-linux-arm64 /usr/local/bin/clef-agent

# --- Final stage (buildx resolves TARGETARCH automatically) ---

FROM binary-${TARGETARCH}

EXPOSE 7779
ENTRYPOINT ["clef-agent"]
