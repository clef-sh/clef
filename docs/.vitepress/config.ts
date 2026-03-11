import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Clef",
  description: "Git-native secrets management built on Mozilla SOPS",

  appearance: "dark",

  head: [["link", { rel: "icon", href: "/logo.svg" }]],

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
      { text: "Backends", link: "/backends/age" },
      { text: "Schemas", link: "/schemas/overview" },
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
            { text: "Pending Values", link: "/guide/pending-values" },
            { text: "CI/CD Integration", link: "/guide/ci-cd" },
            { text: "Team Setup", link: "/guide/team-setup" },
            { text: "Scanning for Secrets", link: "/guide/scanning" },
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
            { text: "clef get", link: "/cli/get" },
            { text: "clef set", link: "/cli/set" },
            { text: "clef delete", link: "/cli/delete" },
            { text: "clef diff", link: "/cli/diff" },
            { text: "clef lint", link: "/cli/lint" },
            { text: "clef scan", link: "/cli/scan" },
            { text: "clef rotate", link: "/cli/rotate" },
            { text: "clef recipients", link: "/cli/recipients" },
            { text: "clef hooks", link: "/cli/hooks" },
            { text: "clef exec", link: "/cli/exec" },
            { text: "clef export", link: "/cli/export" },
            { text: "clef import", link: "/cli/import" },
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
    },
  },
});
