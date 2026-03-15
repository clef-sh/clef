<template>
  <div class="doc-hero">
    <div class="hero-inner">
      <div class="hero-text">
        <p class="hero-eyebrow">CLEF DOCUMENTATION</p>
        <h1 class="hero-headline">
          Encrypted secrets,<br />
          <span class="gold">version-controlled.</span>
        </h1>
        <p class="hero-sub">
          A CLI and local UI for managing SOPS-encrypted secrets in a namespace &times; environment
          matrix. Age keys, git-native workflows, zero infrastructure.
        </p>
        <div class="hero-actions">
          <a href="/guide/quick-start" class="btn-primary"> Get Started → </a>
          <a
            href="https://github.com/clef-sh/clef"
            class="btn-secondary"
            target="_blank"
            rel="noopener"
          >
            GitHub ↗
          </a>
        </div>
      </div>

      <div class="hero-terminal">
        <div class="terminal">
          <div class="terminal-chrome">
            <div class="terminal-dots">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
            </div>
            <span class="terminal-path">~/my-app</span>
          </div>
          <div class="terminal-body">
            <div class="terminal-line">
              <span class="t-prompt">$</span><span class="t-cmd"> clef init</span>
            </div>
            <div class="terminal-line">
              <span class="t-success">✓</span><span class="t-out"> clef.yaml created</span>
            </div>
            <div class="terminal-line">
              <span class="t-hint">→</span
              ><span class="t-dim"> Add your age recipient to clef.yaml</span>
            </div>
            <div class="terminal-line t-spacer"></div>
            <div class="terminal-line">
              <span class="t-prompt">$</span
              ><span class="t-cmd"> clef set database/staging DB_PASSWORD</span>
            </div>
            <div class="terminal-line"><span class="t-dim">Enter value (hidden):</span></div>
            <div class="terminal-line">
              <span class="t-success">✓</span
              ><span class="t-out"> DB_PASSWORD set in database/staging</span>
            </div>
            <div class="terminal-line t-spacer"></div>
            <div class="terminal-line">
              <span class="t-prompt">$</span
              ><span class="t-cmd"> clef exec payments/production -- ./deploy.sh</span>
            </div>
            <div class="terminal-line">
              <span class="t-success">✓</span><span class="t-out"> Injecting 4 secrets...</span>
            </div>
            <div class="terminal-line"><span class="t-dim">Deploying to production...</span></div>
            <div class="terminal-line t-spacer"></div>
            <div class="terminal-line">
              <span class="t-prompt">$</span><span class="t-cmd"> clef lint</span>
            </div>
            <div class="terminal-line">
              <span class="t-success">✓</span><span class="t-out"> All environments in sync</span>
            </div>
            <div class="terminal-line t-spacer"></div>
            <div class="terminal-line"><span class="t-cursor">█</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

onMounted(() => {
  const terminal = document.querySelector(".terminal");
  if (!terminal) return;
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        terminal.classList.add("is-visible");
        observer.disconnect();
      }
    },
    { threshold: 0.2 },
  );
  observer.observe(terminal);
});
</script>
