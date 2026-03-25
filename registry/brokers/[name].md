---
layout: page
---

<script setup>
import { useData } from "vitepress";
import BrokerHeader from "../.vitepress/theme/components/BrokerHeader.vue";
const { params } = useData();
</script>

<BrokerHeader :broker="params.broker" />

<div class="broker-detail">
  <div class="section" v-if="params.readmeHtml">
    <h2>Overview</h2>
    <div class="vp-doc" v-html="params.readmeHtml"></div>
  </div>
  <div class="section" v-if="params.handlerHtml">
    <h2>Handler Source</h2>
    <div class="vp-doc" v-html="params.handlerHtml"></div>
  </div>
</div>
