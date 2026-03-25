import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Clef Registry",
  description: "Browse and install dynamic credential broker templates for the Clef secrets agent",

  // Light mode default with dark toggle (distinct from dark-only docs site)
  appearance: true,

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
