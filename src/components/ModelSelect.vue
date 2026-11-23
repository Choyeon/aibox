<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  modelValue: string;
  fallbacks?: string[];
  options: string[];
  multiple?: boolean;
  placeholder?: string;
  up?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [v: string];
  "update:fallbacks": [v: string[]];
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);
const pos = ref({ top: 0, left: 0, width: 0 });

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = q ? props.options.filter((m) => m.toLowerCase().includes(q)) : props.options;
  if (activeIndex.value >= list.length) activeIndex.value = Math.max(0, list.length - 1);
  return [...list].sort((a, b) => {
    const sa = a === props.modelValue ? -1 : props.fallbacks?.includes(a) ? 0 : 1;
    const sb = b === props.modelValue ? -1 : props.fallbacks?.includes(b) ? 0 : 1;
    return sa - sb;
  });
});

// fixed 定位：根据触发按钮计算，脱离任何 overflow 祖先裁剪
function reposition() {
  const el = trigger.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const desired = Math.max(r.width, 260);
  const width = Math.min(desired, window.innerWidth - 24);
  let left = r.left;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (left < 12) left = 12;
  const margin = 6;
  const listH = Math.min(260, Math.max(120, filtered.value.length * 34 + 40));
  const popH = listH + 100;
  let top: number;
  if (props.up) {
    top = r.top - popH - margin;
    if (top < 8) top = Math.min(r.bottom + margin, window.innerHeight - popH - 8);
  } else {
    top = r.bottom + margin;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - margin);
  }
  pos.value = { top, left, width };
}

function toggle() {
  if (open.value) { open.value = false; return; }
  open.value = true;
  query.value = "";
  activeIndex.value = 0;
  nextTick(() => { reposition(); inputEl.value?.focus(); });
}

function selectModel(m: string) {
  emit("update:modelValue", m);
  open.value = false;
}

function toggleFallback(m: string) {
  if (m === props.modelValue) return;
  const cur = [...(props.fallbacks ?? [])];
  const i = cur.indexOf(m);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(m);
  emit("update:fallbacks", cur);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown") { e.preventDefault(); activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex.value = Math.max(activeIndex.value - 1, 0); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const m = filtered.value[activeIndex.value];
    if (m) selectModel(m);
  } else if (e.key === "Escape") open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (root.value?.contains(t)) return;
  if (popover.value?.contains(t)) return;
  open.value = false;
}
function onScrollResize() { if (open.value) reposition(); }

watch(() => props.options.length, () => { if (open.value) nextTick(reposition); });
onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  window.addEventListener("scroll", onScrollResize, true);
  window.addEventListener("resize", onScrollResize);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  window.removeEventListener("scroll", onScrollResize, true);
  window.removeEventListener("resize", onScrollResize);
});
</script>

<template>
  <div class="model-select" ref="root">
    <button type="button" ref="trigger" class="ms-trigger" :class="{ open }" @click="toggle">
      <span class="ms-value" :class="{ placeholder: !modelValue }">{{ modelValue || placeholder || "选择或输入模型" }}</span>
      <span v-if="fallbacks?.length" class="ms-count" :title="`${fallbacks.length} 个备选模型`">+{{ fallbacks.length }}</span>
      <AppIcon name="chevron" :size="15" class="ms-chevron" />
    </button>
  </div>

  <Teleport to="body">
    <transition name="ms-pop">
      <div v-if="open" ref="popover" class="ms-popover"
           :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }">
        <div class="ms-search">
          <AppIcon name="sparkle" :size="15" />
          <input ref="inputEl" v-model="query" @keydown="onKey"
                 :placeholder="`搜索 ${options.length} 个可用模型…`" />
          <button class="ms-close" type="button" title="关闭" @click="open = false"><AppIcon name="close" :size="13" /></button>
        </div>
        <div class="ms-list">
          <div v-for="(m, i) in filtered" :key="m"
               class="ms-option" :class="{ active: i === activeIndex, primary: m === modelValue, fallback: fallbacks?.includes(m) }"
               @mouseenter="activeIndex = i">
            <button class="ms-main" type="button" @click="selectModel(m)">
              <AppIcon v-if="m === modelValue" name="check" :size="14" class="ms-tick" />
              <span v-else class="ms-dot" :class="{ on: fallbacks?.includes(m) }"></span>
              <span class="ms-label">{{ m }}</span>
              <span v-if="m === modelValue" class="ms-tag">当前</span>
              <span v-else-if="fallbacks?.includes(m)" class="ms-tag alt">备选</span>
            </button>
            <button v-if="multiple && m !== modelValue" class="ms-alt-btn" type="button"
                    :title="fallbacks?.includes(m) ? '移除备选' : '添加为备选'"
                    @click.stop="toggleFallback(m)">
              <AppIcon :name="fallbacks?.includes(m) ? 'close' : 'plus'" :size="13" />
            </button>
          </div>
          <div v-if="!filtered.length" class="ms-empty">没有匹配的模型</div>
        </div>
        <div v-if="multiple" class="ms-footer">
          <span>点模型名设为默认 · 点 + 添加备选</span>
          <span>备选 {{ fallbacks?.length ?? 0 }}</span>
        </div>
      </div>
    </transition>
  </Teleport>
</template>
