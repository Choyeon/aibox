<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "./AppIcon.vue";

const maximized = ref(false);

async function syncMax() {
  try {
    maximized.value = await invoke("window_is_maximized");
  } catch {
    maximized.value = false;
  }
}
onMounted(syncMax);

const minimize = () => invoke("window_minimize").catch(() => {});
const toggleMax = async () => {
  await invoke("window_toggle_maximize").catch(() => {});
  await syncMax();
};
const close = () => invoke("window_close").catch(() => {});
</script>

<template>
  <div class="titlebar" data-tauri-drag-region>
    <div class="tb-left" data-tauri-drag-region>
      <span class="tb-dot"></span>
      <span class="tb-title" data-tauri-drag-region>AIBox</span>
    </div>
    <div class="tb-controls">
      <button class="tb-btn" title="最小化" @click="minimize"><AppIcon name="minimize" :size="13" /></button>
      <button class="tb-btn" :title="maximized ? '还原' : '最大化'" @click="toggleMax">
        <AppIcon :name="maximized ? 'stop' : 'maximize'" :size="12" />
      </button>
      <button class="tb-btn danger" title="关闭" @click="close"><AppIcon name="close" :size="14" /></button>
    </div>
  </div>
</template>
