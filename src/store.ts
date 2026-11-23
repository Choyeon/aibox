import { reactive, ref, watch } from "vue";
import {
  Settings, loadSettings, saveSettings as persistSettings,
  ChatMessage, modelOptions, saveModelCache,
} from "./api";

const CHAT_KEY = "aibox-chat-history";
function loadChat(): ChatMessage[] {
  try { const r = localStorage.getItem(CHAT_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
export function persistChat(h: ChatMessage[]) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(h.slice(-100))); } catch { /* 超出配额忽略 */ }
}

export type ViewName = "chat" | "image" | "video";

// 全局响应式状态
export const state = reactive({
  settings: loadSettings() as Settings,
  activeView: "chat" as ViewName,
  chatHistory: loadChat() as ChatMessage[],
  theme: (localStorage.getItem("aibox-theme") as "light" | "dark" | "system") || "system",
  currentImages: [] as string[],
  currentVideo: null as string | null,
  videoTaskId: null as string | null,
  videoStatus: "",
  drawerOpen: false,
  models: modelOptions(),
  toasts: [] as { id: number; text: string; kind: "ok" | "err" }[],
});

let toastSeq = 0;
export function toast(text: string, kind: "ok" | "err" = "ok") {
  const id = ++toastSeq;
  state.toasts.push({ id, text, kind });
  window.setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id);
    if (i >= 0) state.toasts.splice(i, 1);
  }, 3200);
}

export function saveSettings() {
  persistSettings(state.settings);
}

export function setModels(cache: { chat: string[]; image: string[]; video: string[] }) {
  state.models = cache;
  saveModelCache(cache);
}

export function openDrawer() { state.drawerOpen = true; }
export function closeDrawer() { state.drawerOpen = false; }

// 对话记录与主题自动持久化
watch(() => state.chatHistory, (h) => persistChat(h), { deep: true });
watch(() => state.theme, (t) => localStorage.setItem("aibox-theme", t));

export function setTheme(t: "light" | "dark" | "system") { state.theme = t; }
export function applyTheme() {
  const dark = state.theme === "dark" ||
    (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
