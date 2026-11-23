<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { state, toast, closeDrawer, saveSettings, setModels } from "../store";
import { fetchModels, classifyModels, DEFAULT_SETTINGS } from "../api";
import AppIcon from "./AppIcon.vue";
import ModelSelect from "./ModelSelect.vue";

const draft = reactive({ ...state.settings, chatFallbacks: [...state.settings.chatFallbacks], imageFallbacks: [...state.settings.imageFallbacks], videoFallbacks: [...state.settings.videoFallbacks] });
const busyChat = ref(false);
const busyMedia = ref(false);

// 每次打开抽屉都用最新设置重置草稿，避免在其它页面改的模型/密钥这里显示旧值
watch(() => state.drawerOpen, (open) => {
  if (open) {
    Object.assign(draft, JSON.parse(JSON.stringify(state.settings)));
  }
});

async function pullModels(which: "chat" | "media") {
  const cache = { ...state.models };
  if (which === "chat") {
    if (!draft.chatKey) { toast("请先填写对话 API Key", "err"); return; }
    busyChat.value = true;
    try {
      const list = await fetchModels(draft.chatBaseUrl, draft.chatKey);
      if (!list.length) { toast("接口未返回模型", "err"); return; }
      cache.chat = list;
      if (!draft.mediaKey) {
        const { image, video } = classifyModels(list);
        cache.image = image.length ? image : list;
        cache.video = video.length ? video : list;
      }
      setModels(cache);
      toast(`已获取 ${list.length} 个模型`);
    } catch (e: any) { toast(`拉取失败：${e?.message || e}`, "err"); }
    finally { busyChat.value = false; }
  } else {
    if (!draft.mediaKey) { toast("请先填写媒体 API Key", "err"); return; }
    busyMedia.value = true;
    try {
      const list = await fetchModels(draft.mediaBaseUrl, draft.mediaKey);
      if (!list.length) { toast("接口未返回模型", "err"); return; }
      const { image, video } = classifyModels(list);
      cache.image = image.length ? image : list;
      cache.video = video.length ? video : list;
      setModels(cache);
      toast(`已获取 ${list.length} 个媒体模型`);
    } catch (e: any) { toast(`拉取失败：${e?.message || e}`, "err"); }
    finally { busyMedia.value = false; }
  }
}

function doSave() {
  Object.assign(state.settings, {
    ...draft,
    chatFallbacks: [...draft.chatFallbacks],
    imageFallbacks: [...draft.imageFallbacks],
    videoFallbacks: [...draft.videoFallbacks],
  });
  saveSettings();
  closeDrawer();
  toast("设置已保存");
  if (draft.chatKey || draft.mediaKey) {
    pullModels("chat").catch(() => {});
  }
}

function doReset() {
  Object.assign(draft, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  toast("已恢复默认（点击保存生效）");
}
</script>

<template>
  <div class="drawer-overlay" :class="{ open: state.drawerOpen }" @click="closeDrawer"></div>
  <aside class="settings-drawer" :class="{ open: state.drawerOpen }">
    <div class="drawer-header">
      <div><h2>设置</h2><span class="drawer-sub">配置你的 API 与模型</span></div>
      <button class="icon-btn" title="关闭" @click="closeDrawer"><AppIcon name="close" :size="16" /></button>
    </div>

    <div class="drawer-body">
      <section class="settings-section">
        <div class="section-title"><AppIcon name="key" :size="16" /> 对话 API</div>
        <label>Base URL</label>
        <input v-model="draft.chatBaseUrl" placeholder="https://api.a6api.vip/v1" />
        <label>API Key</label>
        <input v-model="draft.chatKey" type="password" placeholder="sk-..." />
        <label>默认模型</label>
        <ModelSelect v-model="draft.chatModel" v-model:fallbacks="draft.chatFallbacks"
                     :options="state.models.chat" multiple />
        <div class="fallback-note">点开下拉，点「+」把拉取到的模型添加为备选；主模型调用失败会自动依次回退。</div>
        <button class="refresh-models-btn" :disabled="busyChat" @click="pullModels('chat')">
          <AppIcon name="refresh" :size="14" /> {{ busyChat ? "获取中…" : "从 API 获取全部模型" }}
        </button>
      </section>

      <section class="settings-section">
        <div class="section-title"><AppIcon name="key" :size="16" /> 媒体 API（生图 / 视频）</div>
        <label>Base URL</label>
        <input v-model="draft.mediaBaseUrl" placeholder="https://media.a6api.net/v1" />
        <label>API Key</label>
        <input v-model="draft.mediaKey" type="password" placeholder="sk-..." />
        <label>默认生图模型</label>
        <ModelSelect v-model="draft.imageModel" v-model:fallbacks="draft.imageFallbacks"
                     :options="state.models.image" multiple />
        <label>默认视频模型</label>
        <ModelSelect v-model="draft.videoModel" v-model:fallbacks="draft.videoFallbacks"
                     :options="state.models.video" multiple />
        <button class="refresh-models-btn" :disabled="busyMedia" @click="pullModels('media')">
          <AppIcon name="refresh" :size="14" /> {{ busyMedia ? "获取中…" : "从 API 获取全部模型" }}
        </button>
      </section>

      <div class="settings-note">
        <strong>隐私说明</strong>
        <p>密钥仅保存在本机，不上传、不硬编码。从旧版升级时已保存的设置会自动迁移。</p>
        <button class="reset-btn" @click="doReset">恢复默认设置</button>
      </div>
    </div>

    <div class="drawer-footer">
      <button class="primary-btn" @click="doSave"><AppIcon name="check" :size="17" /> 保存设置</button>
    </div>
  </aside>
</template>
