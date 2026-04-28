import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import "./style.css";
import "./terminal.css";
import DocHero from "./DocHero.vue";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-features-before": () => h(DocHero),
      "nav-bar-title-before": () => h("clef-wordmark", { size: "22", "aria-label": "Clef" }),
    });
  },
  enhanceApp() {
    // Side-effect import registers <clef-wordmark>. Client-only — the
    // runtime touches customElements, which doesn't exist during SSR.
    if (typeof window !== "undefined") {
      void import("@clef-sh/design/wordmark");
    }
  },
};
