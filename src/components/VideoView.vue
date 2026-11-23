<script setup lang="ts">
import { ref, onMounted } from "vue";
import { state, toast, openDrawer, saveSettings } from "../store";
import { submitVideo, queryVideo, downloadVideo } from "../api";
import AppIcon from "./AppIcon.vue";
import ModelSelect from "./ModelSelect.vue";

const prompt = ref("");
const seconds = ref(8);
const busy = ref(false);

function setModel(v: string) { state.settings.videoModel = v; saveSettings(); }
function setFallbacks(v: string[]) { state.settings.videoFallbacks = v; saveSettings(); }

async function pollVideo(taskId: string) {
  for (let i = 0; i < 120; i++) {
    try {
      const s = await queryVideo(taskId, state.settings);
      if (s.status === "failed" || s.status === "cancelled") {
        state.videoTaskId = null;
        state.videoStatus = "";
        toast(`生成失败：${s.error?.message || "任务失败"}`, "err");
        return;
      }
      const url = s.video_url || s.url || s.result_url;
      if (url) {
        state.currentVideo = url.startsWith("http") ? await downloadVideo(url, state.settings) : url;
        state.videoTaskId = null; state.videoStatus = "";
        toast("视频生成完成");
        return;
      }
      if (s.status === "completed") {
        try {
          state.currentVideo = await downloadVideo(
            `${state.settings.mediaBaseUrl.replace(/\/$/, "")}/videos/${taskId}/content`, state.settings);
        } catch { state.currentVideo = null; }
        state.videoTaskId = null; state.videoStatus = "";
        if (state.currentVideo) toast("视频生成完成");
        else toast("任务完成但无法获取视频", "err");
        return;
      }
      state.videoStatus = s.progress != null ? `生成中 ${s.progress}%` : "生成中…";
    } catch (e: any) {
      state.videoTaskId = null; state.videoStatus = "";
      toast(`查询失败：${e?.message || e}`, "err");
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  state.videoTaskId = null; state.videoStatus = "";
  toast("视频生成超时，请稍后重试", "err");
}

async function doSubmit() {
  const text = prompt.value.trim();
  if (!text) { toast("请输入提示词", "err"); return; }
  if (!state.settings.mediaKey) { toast("请先在设置中填写媒体 API Key", "err"); openDrawer(); return; }
  busy.value = true;
  try {
    const result = await submitVideo(text, seconds.value, state.settings, (m, e) => {
      toast(`模型 ${m} 失败，尝试备选：${e.slice(0, 40)}`, "err");
    });
    state.currentVideo = null;
    state.videoTaskId = result.data;
    state.videoStatus = "任务已提交";
    if (result.fallbacks.length && result.usedModel !== state.settings.videoModel)
      toast(`已由备选模型 ${result.usedModel} 提交`);
    else toast("任务已提交，正在生成");
    pollVideo(result.data);
  } catch (e: any) {
    toast(`提交失败：${e?.message || e}`, "err");
  } finally {
    busy.value = false;
  }
}

onMounted(() => { if (state.videoTaskId) pollVideo(state.videoTaskId); });
</script>

<template>
  <div class="gen-view">
    <div class="gen-controls">
      <div class="control-group">
        <label>提示词</label>
        <textarea v-model="prompt" rows="4" placeholder="描述你想要的视频画面…"></textarea>
      </div>
      <div class="control-row">
        <div class="control-group">
          <label>模型</label>
          <ModelSelect :model-value="state.settings.videoModel" :fallbacks="state.settings.videoFallbacks"
                       :options="state.models.video" multiple up
                       @update:model-value="setModel" @update:fallbacks="setFallbacks" />
        </div>
        <div class="control-group">
          <label>时长（秒）</label>
          <select v-model.number="seconds"><option :value="5">5</option><option :value="8">8</option><option :value="10">10</option></select>
        </div>
      </div>
      <button class="primary-btn" :disabled="busy" @click="doSubmit">
        <AppIcon name="sparkle" :size="17" /> {{ busy ? "提交中…" : "生成视频" }}
      </button>
      <div class="cost-note">视频生成调用你的 API，单次费用较高（约 $0.3–2）。</div>
    </div>
    <div class="gen-results">
      <div v-if="state.currentVideo" class="video-result">
        <video :src="state.currentVideo" controls autoplay loop></video>
        <a class="primary-btn" :href="state.currentVideo" download="aibox-video.mp4"><AppIcon name="download" :size="17" /> 下载视频</a>
      </div>
      <div v-else-if="state.videoTaskId" class="loading-state">
        <span class="spinner"></span>
        <p>{{ state.videoStatus || '视频生成中…' }}</p>
        <small>任务 {{ state.videoTaskId }} · 通常需要 1-3 分钟</small>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon"><AppIcon name="video" :size="28" /></div>
        <h2>视频工作台</h2>
        <p>输入提示词，提交视频生成任务。生成完成后可在此播放与下载。</p>
      </div>
    </div>
  </div>
</template>
