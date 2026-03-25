---
layout: page
---

<script setup>
import { ref, computed } from "vue";
import { data as brokers } from "./data/brokers.data";
import BrokerCard from "./.vitepress/theme/components/BrokerCard.vue";

const search = ref("");
const providerFilter = ref("all");
const tierFilter = ref("all");

const providers = ["all", "aws", "gcp", "azure", "agnostic"];
const tiers = [
  { value: "all", label: "All Tiers" },
  { value: "1", label: "Tier 1 \u2014 Self-expiring" },
  { value: "2", label: "Tier 2 \u2014 Stateful" },
  { value: "3", label: "Tier 3 \u2014 Complex" },
];

const filtered = computed(() => {
  return brokers.filter((b) => {
    const matchesSearch =
      !search.value ||
      b.name.toLowerCase().includes(search.value.toLowerCase()) ||
      b.description.toLowerCase().includes(search.value.toLowerCase());
    const matchesProvider =
      providerFilter.value === "all" || b.provider === providerFilter.value;
    const matchesTier =
      tierFilter.value === "all" || b.tier === Number(tierFilter.value);
    return matchesSearch && matchesProvider && matchesTier;
  });
});
</script>

<div class="registry-hero">
  <h1>Clef <span class="gold">Broker Registry</span></h1>
  <p>
    Browse and install dynamic credential broker templates.
    Each broker generates short-lived credentials &mdash; deploy with your own infrastructure.
  </p>
  <input
    v-model="search"
    type="text"
    placeholder="Search brokers..."
    class="search-input"
  />
</div>

<div class="filter-bar">
  <button
    v-for="p in providers"
    :key="p"
    class="filter-pill"
    :class="{ active: providerFilter === p }"
    @click="providerFilter = p"
  >
    {{ p === "all" ? "All Providers" : p.toUpperCase() }}
  </button>
</div>

<div class="filter-bar">
  <button
    v-for="t in tiers"
    :key="t.value"
    class="filter-pill"
    :class="{ active: tierFilter === t.value }"
    @click="tierFilter = t.value"
  >
    {{ t.label }}
  </button>
</div>

<div class="broker-grid">
  <BrokerCard
    v-for="broker in filtered"
    :key="broker.name"
    :broker="broker"
  />
</div>

<div v-if="filtered.length === 0" class="empty-state">
  No brokers match your filters. Try adjusting the search or filters.
</div>
