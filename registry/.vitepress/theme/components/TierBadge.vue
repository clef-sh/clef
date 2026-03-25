<template>
  <span class="badge" :class="`badge-tier-${tier}`">
    Tier {{ tier }}{{ tierLabel ? ` \u2014 ${tierLabel}` : "" }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ tier: number }>();

const tierLabel = computed(() => {
  const labels: Record<number, string> = {
    1: "Self-expiring",
    2: "Stateful",
    3: "Complex",
  };
  return labels[props.tier] ?? "";
});
</script>
