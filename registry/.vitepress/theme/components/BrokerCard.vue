<template>
  <div class="broker-card">
    <div class="badges">
      <ProviderBadge :provider="broker.provider" />
      <TierBadge :tier="broker.tier" />
    </div>
    <h3>
      <a :href="`/brokers/${broker.name}`">{{ broker.name }}</a>
    </h3>
    <p class="description">{{ broker.description }}</p>
    <div class="output-keys" v-if="broker.outputKeys.length">
      <code v-for="key in broker.outputKeys" :key="key">{{ key }}</code>
    </div>
    <div class="install-cmd">
      <code>clef install {{ broker.name }}</code>
      <CopyButton :text="`clef install ${broker.name}`" />
    </div>
    <div class="meta">
      <span>v{{ broker.version }}</span>
      <span>{{ broker.author }}</span>
      <span>{{ broker.license }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import ProviderBadge from "./ProviderBadge.vue";
import TierBadge from "./TierBadge.vue";
import CopyButton from "./CopyButton.vue";

defineProps<{
  broker: {
    name: string;
    description: string;
    provider: string;
    tier: number;
    version: string;
    author: string;
    license: string;
    outputKeys: string[];
  };
}>();
</script>
