<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { state, openDrawer, setModels, setTheme, applyTheme } from "./store";
import { fetchModels, classifyModels } from "./api";
import AppIcon from "./components/AppIcon.vue";
import TitleBar from "./components/TitleBar.vue";
import ChatView from "./components/ChatView.vue";
import ImageView from "./components/ImageView.vue";
import VideoView from "./components/VideoView.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";

const titles = { chat: "对话", image: "图像生成", video: "视频生成" };
const currentTitle = computed(() => titles[state.activeView]);
const currentModel = computed(() => ({
  chat: state.settings.chatModel,
  image: state.settings.imageModel,
  video: state.settings.videoModel,
}[state.activeView]));

const nav = [
  { key: "chat", icon: "chat", label: "对话" },
  { key: "image", icon: "image", label: "生图" },
  { key: "video", icon: "video", label: "视频" },
] as const;

async function silentFetchModels() {
  const s = state.settings;
  if (!s.chatKey && !s.mediaKey) return;
  const cache = { ...state.models };
  let changed = false;
  if (s.chatKey) {
    try {
      const list = await fetchModels(s.chatBaseUrl, s.chatKey);
      if (list.length) {
        cache.chat = list;
        changed = true;
        if (!s.mediaKey) {
          const { image, video } = classifyModels(list);
          cache.image = image.length ? image : list;
          cache.video = video.length ? video : list;
        }
      }
    } catch { /* 静默失败，不影响启动 */ }
  }
  if (s.mediaKey) {
    try {
      const list = await fetchModels(s.mediaBaseUrl, s.mediaKey);
      if (list.length) {
        const { image, video } = classifyModels(list);
        cache.image = image.length ? image : list;
        cache.video = video.length ? video : list;
        changed = true;
      }
    } catch { /* 静默失败 */ }
  }
  if (changed) setModels(cache);
}

const isDark = computed(() => document.documentElement.classList.contains("dark"));
function toggleTheme() {
  const next = state.theme === "dark" ? "light" : "dark";
  setTheme(next);
  applyTheme();
}

onMounted(() => {
  applyTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") applyTheme();
  });
  silentFetchModels();
});
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <div class="app-body">
      <aside class="sidebar">
        <div class="brand-mark" title="AIBox"><AppIcon name="sparkle" :size="23" /></div>
        <div class="brand-name">AIBox</div>
        <nav class="nav-stack">
          <button v-for="n in nav" :key="n.key" class="nav-item"
                  :class="{ active: state.activeView === n.key }" :title="n.label"
                  @click="state.activeView = n.key">
            <AppIcon :name="n.icon" :size="22" />
            <span>{{ n.label }}</span>
          </button>
        </nav>
        <div class="sidebar-bottom">
          <button class="nav-item" title="设置" @click="openDrawer">
            <AppIcon name="settings" :size="22" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="topbar-title">
            <h1>{{ currentTitle }}</h1>
            <span class="topbar-sub">{{ currentModel }}</span>
          </div>
          <div class="topbar-status">
            <button class="theme-btn" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
              <AppIcon :name="isDark ? 'sun' : 'moon'" :size="16" />
            </button>
            <span class="status-dot"></span>本地运行 · 自带密钥
          </div>
        </header>
        <section class="content">
          <ChatView v-if="state.activeView === 'chat'" />
          <ImageView v-else-if="state.activeView === 'image'" />
          <VideoView v-else />
        </section>
      </main>
    </div>

    <SettingsDrawer />

    <div class="toast-stack">
      <transition-group name="toast">
        <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
      </transition-group>
    </div>
  </div>
</template>
