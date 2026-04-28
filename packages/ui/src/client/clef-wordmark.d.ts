// JSX type for <clef-wordmark>. Runtime registration lives in
// @clef-sh/design/wordmark — main.tsx side-effect-imports it once.
import "react";

interface ClefWordmarkAttributes {
  size?: number | string;
  variant?: "lockup" | "mark" | "text";
  tld?: "true" | "false";
  surface?: "dark" | "light";
  class?: string;
  className?: string;
  style?: React.CSSProperties;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "clef-wordmark": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & ClefWordmarkAttributes,
        HTMLElement
      >;
    }
  }
}
