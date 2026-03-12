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
    });
  },
};
