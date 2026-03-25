<template>
  <table class="inputs-table">
    <thead>
      <tr>
        <th>Input</th>
        <th>Required</th>
        <th>Secret</th>
        <th>Default</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="input in inputs" :key="input.name">
        <td>
          <code>{{ input.name }}</code>
        </td>
        <td>{{ input.default !== undefined ? "No" : "Yes" }}</td>
        <td :class="input.secret ? 'secret-yes' : 'secret-no'">
          {{ input.secret ? "Yes" : "No" }}
        </td>
        <td>
          <code v-if="input.default !== undefined">{{ input.default }}</code>
          <span v-else>&mdash;</span>
        </td>
        <td>{{ input.description }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
defineProps<{
  inputs: Array<{
    name: string;
    description: string;
    secret?: boolean;
    default?: string;
  }>;
}>();
</script>
