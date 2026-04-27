import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid({
  mermaid: {
    theme: "dark",
    themeVariables: {
      background: "transparent",
      fontFamily: "inherit",
    },
  },
  title: "Clef",
  description: "Keep encrypted secrets alongside your code. One commit hash = your entire system.",

  appearance: "dark",

  // Two chunks land over Vite's default 500 KB warning threshold:
  //   - `app.*.js` (~600 KB) — VitePress runtime + theme + minisearch.
  //   - `@localSearchIndexroot.*.js` (~1.4 MB) — the indexed corpus, shipped
  //     client-side for local search. Both are loaded once and cached;
  //     manualChunks splitting wouldn't help since the main app chunk is
  //     on every page anyway. Bump the limit so the build output stays
  //     signal, not noise.
  vite: {
    build: {
      chunkSizeWarningLimit: 1500,
    },
  },

  head: [
    ["link", { rel: "icon", href: "/logo.svg" }],
    // Docs is all-Inter (no Instrument Serif here — that's reserved for
    // the marketing surface). JetBrains Mono for code blocks + terminal.
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  ],

  themeConfig: {
    logo: "/logo.svg",

    search: {
      provider: "local",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/clef-sh/clef" },
      {
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        },
        link: "https://clef.sh",
      },
    ],

    editLink: {
      pattern: "https://github.com/clef-sh/clef/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "MIT License | Made by the Clef contributors",
    },

    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "CLI Reference", link: "/cli/overview" },
      { text: "UI", link: "/ui/overview" },
      { text: "CDK", link: "/cdk/overview" },
      { text: "Backends", link: "/backends/age" },
      { text: "Schemas", link: "/schemas/overview" },
      { text: "API", link: "/api/" },
      { text: "Contributing", link: "/contributing/development-setup" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Quick Start", link: "/guide/quick-start" },
            { text: "Migrating to Clef", link: "/guide/migrating" },
            { text: "Core Concepts", link: "/guide/concepts" },
            { text: "Key Storage", link: "/guide/key-storage" },
            { text: "Pending Values", link: "/guide/pending-values" },
            { text: "CI/CD Integration", link: "/guide/ci-cd" },
            { text: "Rotation Policy & Compliance", link: "/guide/compliance" },
            { text: "Team Setup", link: "/guide/team-setup" },
            { text: "Merge Conflicts", link: "/guide/merge-conflicts" },
            { text: "Scanning for Secrets", link: "/guide/scanning" },
            { text: "Service Identities", link: "/guide/service-identities" },
            { text: "Dynamic Secrets", link: "/guide/dynamic-secrets" },
            { text: "Pack Backend Plugins", link: "/guide/pack-plugins" },
            {
              text: "AWS Parameter Store Backend",
              link: "/guide/pack-aws-parameter-store",
            },
            {
              text: "AWS Secrets Manager Backend",
              link: "/guide/pack-aws-secrets-manager",
            },
            { text: "CDK Constructs (AWS)", link: "/guide/cdk" },
            { text: "Runtime Agent", link: "/guide/agent" },
            { text: "Client SDK", link: "/guide/client" },
            { text: "Telemetry", link: "/guide/telemetry" },
            { text: "Production Isolation", link: "/guide/production-isolation" },
            { text: "Manifest Reference", link: "/guide/manifest" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Reference",
          items: [
            { text: "Overview", link: "/cli/overview" },
            { text: "clef doctor", link: "/cli/doctor" },
            { text: "clef init", link: "/cli/init" },
            { text: "clef update", link: "/cli/update" },
            { text: "clef get", link: "/cli/get" },
            { text: "clef set", link: "/cli/set" },
            { text: "clef compare", link: "/cli/compare" },
            { text: "clef delete", link: "/cli/delete" },
            { text: "clef diff", link: "/cli/diff" },
            { text: "clef lint", link: "/cli/lint" },
            { text: "clef scan", link: "/cli/scan" },
            { text: "clef policy", link: "/cli/policy" },
            { text: "clef rotate", link: "/cli/rotate" },
            { text: "clef recipients", link: "/cli/recipients" },
            { text: "clef hooks", link: "/cli/hooks" },
            { text: "clef exec", link: "/cli/exec" },
            { text: "clef export", link: "/cli/export" },
            { text: "clef import", link: "/cli/import" },
            { text: "clef migrate-backend", link: "/cli/migrate-backend" },
            { text: "clef service", link: "/cli/service" },
            { text: "clef pack", link: "/cli/pack" },
            { text: "clef envelope", link: "/cli/envelope" },
            { text: "clef revoke", link: "/cli/revoke" },
            { text: "clef drift", link: "/cli/drift" },
            { text: "clef report", link: "/cli/report" },
            { text: "clef cloud", link: "/cli/cloud" },
            { text: "clef serve", link: "/cli/serve" },
            { text: "clef agent", link: "/cli/agent" },
            { text: "clef ui", link: "/cli/ui" },
          ],
        },
      ],
      "/ui/": [
        {
          text: "Web UI",
          items: [
            { text: "Overview", link: "/ui/overview" },
            { text: "Matrix View", link: "/ui/matrix-view" },
            { text: "Namespace Editor", link: "/ui/editor" },
            { text: "Diff View", link: "/ui/diff-view" },
            { text: "Lint View", link: "/ui/lint-view" },
          ],
        },
      ],
      "/cdk/": [
        {
          text: "CDK Constructs",
          items: [
            { text: "Overview", link: "/cdk/overview" },
            { text: "ClefArtifactBucket", link: "/cdk/artifact-bucket" },
            { text: "ClefSecret", link: "/cdk/secret" },
            { text: "ClefParameter", link: "/cdk/parameter" },
          ],
        },
      ],
      "/backends/": [
        {
          text: "Encryption Backends",
          items: [
            { text: "age (recommended)", link: "/backends/age" },
            { text: "AWS KMS", link: "/backends/aws-kms" },
            { text: "GCP KMS", link: "/backends/gcp-kms" },
            { text: "PGP", link: "/backends/pgp" },
          ],
        },
      ],
      "/schemas/": [
        {
          text: "Schemas",
          items: [
            { text: "Overview", link: "/schemas/overview" },
            { text: "Schema Reference", link: "/schemas/reference" },
          ],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [
            { text: "Development Setup", link: "/contributing/development-setup" },
            { text: "Architecture", link: "/contributing/architecture" },
            { text: "Testing", link: "/contributing/testing" },
            { text: "Releasing", link: "/contributing/releasing" },
          ],
        },
      ],
      // Typedoc drills into /api/<package>/src/{classes,interfaces,functions,type-aliases,variables}
      // from each package index page, so we only list the package entry points here —
      // the generated per-package pages handle drill-down without hand-curation.
      "/api/": [
        {
          text: "API Reference",
          items: [{ text: "Overview", link: "/api/" }],
        },
        {
          text: "Packages",
          items: [
            { text: "@clef-sh/agent", link: "/api/agent/src/" },
            { text: "@clef-sh/analytics", link: "/api/analytics/src/" },
            { text: "@clef-sh/broker", link: "/api/broker/src/" },
            { text: "@clef-sh/cdk", link: "/api/cdk/src/" },
            { text: "@clef-sh/client", link: "/api/client/src/" },
            { text: "@clef-sh/cloud", link: "/api/cloud/src/" },
            { text: "@clef-sh/core", link: "/api/core/src/" },
            { text: "@clef-sh/runtime", link: "/api/runtime/src/" },
          ],
        },
      ],
    },
  },
});
