import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Clef Registry",
  description: "Browse and install dynamic credential broker templates for the Clef secrets agent",

  // Light mode default with dark toggle (distinct from dark-only docs site)
  appearance: true,

  // Tell Vue to pass <clef-wordmark> through as a real DOM element instead
  // of resolving it as a Vue component. The custom element is registered
  // client-side in theme/index.ts via @clef-sh/design/wordmark.
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag: string) => tag === "clef-wordmark",
      },
    },
  },

  head: [["link", { rel: "icon", href: "/logo.svg" }]],

  themeConfig: {
    logo: "/logo.svg",

    search: {
      provider: "local",
    },

    socialLinks: [{ icon: "github", link: "https://github.com/clef-sh/clef" }],

    nav: [
      { text: "Browse", link: "/" },
      { text: "Contributing", link: "/contributing" },
      { text: "Docs", link: "https://docs.clef.sh" },
      { text: "clef.sh", link: "https://clef.sh" },
    ],

    sidebar: false,

    footer: {
      message: "MIT License | Clef Broker Registry",
    },
  },
});
