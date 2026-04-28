import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-title-before": () =>
        h("clef-wordmark", { size: "22", "aria-label": "Clef Registry" }),
    });
  },
  enhanceApp() {
    if (typeof window !== "undefined") {
      void import("@clef-sh/design/wordmark");
    }
  },
};
