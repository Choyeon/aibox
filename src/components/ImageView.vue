<script setup lang="ts">
import { ref } from "vue";
import { state, toast, openDrawer, saveSettings } from "../store";
import { generateImage } from "../api";
import AppIcon from "./AppIcon.vue";
import ModelSelect from "./ModelSelect.vue";

const prompt = ref("");
const size = ref("1024x1024");
const count = ref(1);
const busy = ref(false);

async function doGenerate() {
  const text = prompt.value.trim();
  if (!text) { toast("请输入提示词", "err"); return; }
  if (!state.settings.mediaKey) { toast("请先在设置中填写媒体 API Key", "err"); openDrawer(); return; }
  busy.value = true;
  try {
    const result = await generateImage(text, size.value, count.value, state.settings, (m, e) => {
      toast(`模型 ${m} 失败，尝试备选：${e.slice(0, 40)}`, "err");
    });
    state.currentImages = result.data;
    if (result.fallbacks.length && result.usedModel !== state.settings.imageModel)
      toast(`已由备选模型 ${result.usedModel} 完成`);
    else toast(`生成完成，共 ${result.data.length} 张`);
  } catch (e: any) {
    toast(`生成失败：${e?.message || e}`, "err");
  } finally {
    busy.value = false;
  }
}

function setModel(v: string) { state.settings.imageModel = v; saveSettings(); }
function setFallbacks(v: string[]) { state.settings.imageFallbacks = v; saveSettings(); }
</script>

<template>
  <div class="gen-view">
    <div class="gen-controls">
      <div class="control-group">
        <label>提示词</label>
        <textarea v-model="prompt" rows="4" placeholder="描述你想生成的画面…"></textarea>
      </div>
      <div class="control-group">
        <label>模型</label>
        <ModelSelect :model-value="state.settings.imageModel" :fallbacks="state.settings.imageFallbacks"
                     :options="state.models.image" multiple up
                     @update:model-value="setModel" @update:fallbacks="setFallbacks" />
      </div>
      <div class="control-row">
        <div class="control-group">
          <label>尺寸</label>
          <select v-model="size"><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option><option>auto</option></select>
        </div>
        <div class="control-group">
          <label>数量</label>
          <select v-model.number="count"><option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select>
        </div>
      </div>
      <button class="primary-btn" :disabled="busy" @click="doGenerate">
        <AppIcon name="sparkle" :size="17" /> {{ busy ? "生成中…" : "生成图像" }}
      </button>
      <div class="cost-note">生成图像会调用你的 API，可能产生费用。</div>
    </div>
    <div class="gen-results">
      <div v-if="!state.currentImages.length" class="empty-state">
        <div class="empty-icon"><AppIcon name="image" :size="28" /></div>
        <h2>图像工作台</h2>
        <p>输入提示词，选择模型与尺寸，生成的结果会显示在这里。</p>
      </div>
      <div v-else class="result-grid">
        <div v-for="(src, i) in state.currentImages" :key="i" class="result-card">
          <img :src="src" alt="生成结果" />
          <a class="result-download" :href="src" download="aibox-image.png" title="下载"><AppIcon name="download" :size="17" /></a>
        </div>
      </div>
    </div>
  </div>
</template>
