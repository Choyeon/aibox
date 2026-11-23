<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { state, toast, openDrawer, saveSettings } from "../store";
import { chatStream, ChatMessage } from "../api";
import { renderMarkdown } from "../markdown";
import AppIcon from "./AppIcon.vue";
import ModelSelect from "./ModelSelect.vue";

const input = ref<HTMLTextAreaElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const sending = ref(false);
const copiedIdx = ref<number | null>(null);

watch(() => state.chatHistory.length, () => nextTick(scrollBottom));
function scrollBottom() { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; }

function autoGrow() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function bubbleHtml(m: ChatMessage) { return m.role === "assistant" ? renderMarkdown(esc(m.content)) : ""; }

async function runStream(messages: ChatMessage[], placeholder: ChatMessage) {
  sending.value = true;
  try {
    const result = await chatStream(messages, state.settings,
      (delta) => { placeholder.content += delta; nextTick(scrollBottom); },
      (m, e) => toast(`模型 ${m} 失败，尝试备选：${e.slice(0, 40)}`, "err"),
    );
    if (result.fallbacks.length && result.usedModel !== state.settings.chatModel)
      toast(`已由备选模型 ${result.usedModel} 完成`);
    if (!placeholder.content) placeholder.content = "（空响应）";
  } catch (e: any) {
    placeholder.content = `调用失败：${e?.message || e}`;
  } finally {
    sending.value = false;
    nextTick(scrollBottom);
  }
}

async function doSend() {
  const text = input.value?.value.trim() ?? "";
  if (!text || sending.value) return;
  if (!state.settings.chatKey) { toast("请先在设置中填写对话 API Key", "err"); openDrawer(); return; }
  state.chatHistory.push({ role: "user", content: text });
  if (input.value) input.value.value = "";
  nextTick(autoGrow);
  const placeholder: ChatMessage = { role: "assistant", content: "" };
  state.chatHistory.push(placeholder);
  const messages = state.chatHistory.slice(0, -1).map((m) => ({ ...m }));
  await runStream(messages, placeholder);
}

async function regenerate(idx: number) {
  if (sending.value) return;
  const msg = state.chatHistory[idx];
  if (!msg || msg.role !== "assistant") return;
  const context = state.chatHistory.slice(0, idx).map((m) => ({ ...m }));
  state.chatHistory.splice(idx);
  const placeholder: ChatMessage = { role: "assistant", content: "" };
  state.chatHistory.push(placeholder);
  toast("正在重新生成…");
  await runStream(context, placeholder);
}

function removeAt(idx: number) { state.chatHistory.splice(idx, 1); toast("消息已删除"); }

async function copyText(text: string, idx: number) {
  try {
    await navigator.clipboard.writeText(text);
    copiedIdx.value = idx;
    toast("已复制");
    setTimeout(() => { if (copiedIdx.value === idx) copiedIdx.value = null; }, 1500);
  } catch { toast("复制失败", "err"); }
}

function onCopyCode(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest(".md-copy") as HTMLElement | null;
  if (!btn) return;
  const code = decodeURIComponent(btn.dataset.code || "");
  navigator.clipboard.writeText(code).then(() => toast("代码已复制")).catch(() => toast("复制失败", "err"));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
}
function clearChat() { state.chatHistory = []; toast("对话已清空"); }
function setModel(v: string) { state.settings.chatModel = v; saveSettings(); }
function setFallbacks(v: string[]) { state.settings.chatFallbacks = v; saveSettings(); }
</script>

<template>
  <div class="chat-view">
    <div class="chat-list" ref="listEl" @click="onCopyCode">
      <div v-if="!state.chatHistory.length" class="empty-state">
        <div class="empty-icon"><AppIcon name="sparkle" :size="28" /></div>
        <h2>开始一段对话</h2>
        <p>在下方输入问题，使用你自己的 API 密钥直接调用模型。</p>
      </div>
      <div v-for="(m, i) in state.chatHistory" :key="i" class="msg" :class="m.role">
        <div class="msg-avatar">{{ m.role === 'user' ? '你' : 'A' }}</div>
        <div class="msg-wrap">
          <div class="msg-bubble">
            <span v-if="m.role === 'user'">{{ m.content }}</span>
            <span v-else-if="sending && i === state.chatHistory.length - 1 && !m.content" class="thinking"><i></i><i></i><i></i></span>
            <span v-else class="md-body" v-html="bubbleHtml(m)"></span>
          </div>
          <div v-if="m.content && !sending" class="msg-actions">
            <button title="复制" @click.stop="copyText(m.content, i)">
              <AppIcon :name="copiedIdx === i ? 'check' : 'copy'" :size="13" />
            </button>
            <button v-if="m.role === 'assistant'" title="重新生成" @click.stop="regenerate(i)"><AppIcon name="refresh" :size="13" /></button>
            <button title="删除" @click.stop="removeAt(i)"><AppIcon name="trash" :size="13" /></button>
          </div>
        </div>
      </div>
    </div>
    <div class="composer-wrap">
      <div class="composer">
        <textarea ref="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                  :disabled="sending" @keydown="onKeydown" @input="autoGrow"></textarea>
        <button class="send-btn" :disabled="sending" title="发送" @click="doSend">
          <AppIcon name="send" :size="17" />
        </button>
      </div>
      <div class="composer-bar">
        <div class="composer-model">
          <ModelSelect :model-value="state.settings.chatModel" :fallbacks="state.settings.chatFallbacks"
                       :options="state.models.chat" multiple up
                       @update:model-value="setModel" @update:fallbacks="setFallbacks" />
          <span class="hint">默认 + 备选自动回退</span>
        </div>
        <div class="composer-hint">
          <button v-if="state.chatHistory.length" class="text-btn" @click="clearChat">清空对话</button>
          <span>按 Enter 发送</span>
        </div>
      </div>
    </div>
  </div>
</template>
