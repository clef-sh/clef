import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Clef Registry",
  description: "Browse and install dynamic credential broker templates for the Clef secrets agent",

  // Light mode default with dark toggle (distinct from dark-only docs site)
  appearance: true,

  head: [
    ["link", { rel: "icon", href: "/logo.svg" }],
    // Fonts come from @clef-sh/design/fonts-cdn.css (imported from
    // theme/style.css) — Google Fonts CDN. Preconnects shave first-paint.
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
  ],

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
