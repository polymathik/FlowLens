<script setup lang="ts">
import MyBadge from './Badge.vue';
import { formatDuration } from '@scope/core/utils/format';

const props = defineProps<{ elapsed: number }>();

function label(): string {
  return formatDuration(props.elapsed);
}
</script>

<template>
  <section>
    <my-badge :text="label()" />
    <span>{{ label() }}</span>
  </section>
</template>
