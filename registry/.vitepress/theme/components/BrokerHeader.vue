<template>
  <div class="broker-detail">
    <div class="header">
      <div class="badges">
        <ProviderBadge :provider="broker.provider" />
        <TierBadge :tier="broker.tier" />
      </div>
      <h1>{{ broker.name }}</h1>
      <p class="description">{{ broker.description }}</p>
      <div class="install-cmd">
        <code>clef install {{ broker.name }}</code>
        <CopyButton :text="`clef install ${broker.name}`" />
      </div>
      <div class="meta-row">
        <span>Version {{ broker.version }}</span>
        <span>{{ broker.author }}</span>
        <span>{{ broker.license }}</span>
        <a
          :href="`https://github.com/clef-sh/clef/tree/main/brokers/${broker.provider}/${broker.name}`"
          target="_blank"
          rel="noopener"
        >
          View Source &nearr;
        </a>
      </div>
    </div>

    <div class="section">
      <h2>Configuration</h2>
      <InputsTable :inputs="broker.inputs" />
    </div>

    <div class="section" v-if="broker.outputKeys && broker.outputKeys.length">
      <h2>Output</h2>
      <table class="inputs-table">
        <thead>
          <tr>
            <th>Keys</th>
            <th>Identity</th>
            <th>TTL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code v-for="(key, i) in broker.outputKeys" :key="key"
                >{{ key }}{{ i < broker.outputKeys.length - 1 ? ", " : "" }}</code
              >
            </td>
            <td>
              <code>{{ broker.output?.identity ?? "\u2014" }}</code>
            </td>
            <td>{{ broker.output?.ttl ?? "\u2014" }}s</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="broker.dependencies && Object.keys(broker.dependencies).length > 0" class="section">
      <h2>Runtime Dependencies</h2>
      <table class="inputs-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(version, pkg) in broker.dependencies" :key="pkg">
            <td>
              <code>{{ pkg }}</code>
            </td>
            <td>
              <code>{{ version }}</code>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="broker.permissions && broker.permissions.length > 0" style="margin-top: 16px">
        <strong>Required Permissions:</strong>
        <code v-for="(perm, i) in broker.permissions" :key="perm">
          {{ perm }}{{ i < broker.permissions.length - 1 ? ", " : "" }}
        </code>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ProviderBadge from "./ProviderBadge.vue";
import TierBadge from "./TierBadge.vue";
import CopyButton from "./CopyButton.vue";
import InputsTable from "./InputsTable.vue";

defineProps<{
  broker: {
    name: string;
    description: string;
    provider: string;
    tier: number;
    version: string;
    author: string;
    license: string;
    inputs: Array<{
      name: string;
      description: string;
      secret?: boolean;
      default?: string;
    }>;
    output?: { identity?: string; ttl?: number; keys?: string[] };
    outputKeys: string[];
    dependencies: Record<string, string>;
    permissions: string[];
  };
}>();
</script>
