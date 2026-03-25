<template>
  <span class="badge" :class="`badge-${provider}`">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ provider: string }>();

const label = computed(() => {
  const labels: Record<string, string> = {
    aws: "AWS",
    gcp: "GCP",
    azure: "Azure",
    agnostic: "Agnostic",
  };
  return labels[props.provider] ?? props.provider;
});
</script>
