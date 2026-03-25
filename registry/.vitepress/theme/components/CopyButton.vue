<template>
  <button
    class="copy-btn"
    :class="{ copied }"
    :title="copied ? 'Copied!' : 'Copy to clipboard'"
    @click="copy"
  >
    {{ copied ? "Copied" : "Copy" }}
  </button>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ text: string }>();
const copied = ref(false);

async function copy() {
  await navigator.clipboard.writeText(props.text);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>
