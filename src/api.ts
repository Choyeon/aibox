import { invoke, Channel } from "@tauri-apps/api/core";

export interface Settings {
  chatBaseUrl: string;
  chatKey: string;
  chatModel: string;
  chatFallbacks: string[];
  mediaBaseUrl: string;
  mediaKey: string;
  imageModel: string;
  imageFallbacks: string[];
  videoModel: string;
  videoFallbacks: string[];
}

const SETTINGS_KEY = "aibox-settings";
const LEGACY_SETTINGS_KEY = "a6-studio-settings";

export const DEFAULT_SETTINGS: Settings = {
  chatBaseUrl: "https://api.a6api.vip/v1",
  chatKey: "",
  chatModel: "grok-4.6",
  chatFallbacks: [],
  mediaBaseUrl: "https://media.a6api.net/v1",
  mediaKey: "",
  imageModel: "gpt-image-2",
  imageFallbacks: [],
  videoModel: "kling-3.0-turbo",
  videoFallbacks: [],
};

export function loadSettings(): Settings {
  const fill = (raw: any): Settings => ({
    ...DEFAULT_SETTINGS,
    ...raw,
    chatFallbacks: Array.isArray(raw?.chatFallbacks) ? raw.chatFallbacks : [],
    imageFallbacks: Array.isArray(raw?.imageFallbacks) ? raw.imageFallbacks : [],
    videoFallbacks: Array.isArray(raw?.videoFallbacks) ? raw.videoFallbacks : [],
  });
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      // 从旧版 A6 Studio 迁移已保存的配置与密钥
      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy) {
        const migrated = fill(JSON.parse(legacy));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
        return migrated;
      }
      return { ...DEFAULT_SETTINGS };
    }
    return fill(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// 依次尝试主模型与备选模型，返回首个成功结果；全部失败时抛出最后一个错误
async function withFallback<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  onFallback?: (model: string, err: string) => void,
): Promise<T> {
  const list = models.filter(Boolean);
  if (!list.length) throw new Error("未选择模型");
  let lastErr: any;
  for (const model of list) {
    try {
      return await call(model);
    } catch (e: any) {
      lastErr = e;
      if (onFallback) onFallback(model, e?.message || String(e));
    }
  }
  throw lastErr;
}

// 模型调用结果，带回退信息
export interface CallResult<T> {
  data: T;
  usedModel: string;
  fallbacks: string[];
}

export async function chat(messages: ChatMessage[], s: Settings, onFallback?: (m: string, e: string) => void): Promise<CallResult<string>> {
  const models = [s.chatModel, ...s.chatFallbacks];
  let used = s.chatModel;
  const fallbacks: string[] = [];
  const data = await withFallback(models, async (model) => {
    used = model;
    return invoke<string>("chat_completion", {
      req: { base_url: s.chatBaseUrl, api_key: s.chatKey, model, messages },
    });
  }, (m, e) => { fallbacks.push(`${m}: ${e}`); onFallback?.(m, e); });
  return { data, usedModel: used, fallbacks };
}

export interface StreamChunk { delta?: string; done?: boolean; error?: string }

// 流式对话：onDelta 逐块回调，返回实际使用的模型；主模型失败自动回退备选
export async function chatStream(
  messages: ChatMessage[], s: Settings,
  onDelta: (text: string) => void,
  onFallback?: (m: string, e: string) => void,
): Promise<CallResult<void>> {
  const models = [s.chatModel, ...s.chatFallbacks];
  let used = s.chatModel;
  const fallbacks: string[] = [];
  let lastErr: any;
  for (const model of models) {
    if (!model) continue;
    used = model;
    let acc = "";
    let streamErr = "";
    try {
      await invoke<void>("chat_completion_stream", {
        req: { base_url: s.chatBaseUrl, api_key: s.chatKey, model, messages },
        onEvent: new Channel<StreamChunk>((ev: StreamChunk) => {
          if (ev.delta) { acc += ev.delta; onDelta(ev.delta); }
          if (ev.error) streamErr = ev.error;
        }),
      });
      if (streamErr) throw new Error(streamErr);
      return { data: undefined, usedModel: used, fallbacks };
    } catch (e: any) {
      lastErr = e;
      fallbacks.push(`${model}: ${e?.message || e}`);
      // 该模型已输出部分内容则不再回退，避免内容重复
      if (acc.length > 0) return { data: undefined, usedModel: used, fallbacks };
      onFallback?.(model, e?.message || String(e));
    }
  }
  throw lastErr ?? new Error("未选择模型");
}

export async function generateImage(prompt: string, size: string, n: number, s: Settings, onFallback?: (m: string, e: string) => void): Promise<CallResult<string[]>> {
  const models = [s.imageModel, ...s.imageFallbacks];
  let used = s.imageModel;
  const fallbacks: string[] = [];
  const data = await withFallback(models, async (model) => {
    used = model;
    return invoke<string[]>("generate_image", {
      req: { base_url: s.mediaBaseUrl, api_key: s.mediaKey, model, prompt, size, n },
    });
  }, (m, e) => { fallbacks.push(`${m}: ${e}`); onFallback?.(m, e); });
  return { data, usedModel: used, fallbacks };
}

export async function submitVideo(prompt: string, seconds: number, s: Settings, onFallback?: (m: string, e: string) => void): Promise<CallResult<string>> {
  const models = [s.videoModel, ...s.videoFallbacks];
  let used = s.videoModel;
  const fallbacks: string[] = [];
  const data = await withFallback(models, async (model) => {
    used = model;
    return invoke<string>("submit_video", {
      req: { base_url: s.mediaBaseUrl, api_key: s.mediaKey, model, prompt, seconds, size: "1280x720" },
    });
  }, (m, e) => { fallbacks.push(`${m}: ${e}`); onFallback?.(m, e); });
  return { data, usedModel: used, fallbacks };
}

export interface VideoTaskState {
  status: string;
  progress?: number;
  video_url?: string;
  url?: string;
  result_url?: string;
  error?: { message?: string };
}

export async function queryVideo(taskId: string, s: Settings): Promise<VideoTaskState> {
  const v: any = await invoke("query_video", {
    baseUrl: s.mediaBaseUrl,
    apiKey: s.mediaKey,
    taskId,
  });
  return v as VideoTaskState;
}

export async function downloadVideo(url: string, s: Settings): Promise<string> {
  return await invoke<string>("download_video", { url, apiKey: s.mediaKey });
}

// 从服务端拉取全部可用模型（OpenAI 兼容 /models 接口）
export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return await invoke<string[]>("list_models", { baseUrl, apiKey });
}

const MODEL_CACHE_KEY = "aibox-model-cache";
const FALLBACK_MODELS: { chat: string[]; image: string[]; video: string[] } = {
  chat: ["grok-4.6", "gpt-5.5", "gpt-6-astra", "claude-opus-4-8", "claude-sonnet-5", "deepseek-v4.1-flash", "gemini-4-neon", "qwen3.8-max", "kimi-k3"],
  image: ["gpt-image-2", "gpt-image-1.5", "gpt-image-2.5", "flux-3-image", "nano-banana-pro", "doubao-seedream-5-pro", "grok-imagine-image-2.0"],
  video: ["kling-3.0-turbo", "kling-4", "veo-3.1-fast", "veo-3.1", "doubao-seedance-2.0-fast", "sora-2", "wan3.0-video", "grok-imagine-video-1.5"],
};

export type ModelKind = "chat" | "image" | "video";

export function loadModelCache(): { chat: string[]; image: string[]; video: string[] } {
  try {
    const raw = localStorage.getItem(MODEL_CACHE_KEY);
    if (!raw) return { ...FALLBACK_MODELS };
    const cached = JSON.parse(raw);
    return {
      chat: Array.isArray(cached.chat) && cached.chat.length ? cached.chat : FALLBACK_MODELS.chat,
      image: Array.isArray(cached.image) && cached.image.length ? cached.image : FALLBACK_MODELS.image,
      video: Array.isArray(cached.video) && cached.video.length ? cached.video : FALLBACK_MODELS.video,
    };
  } catch {
    return { ...FALLBACK_MODELS };
  }
}

export function saveModelCache(cache: { chat: string[]; image: string[]; video: string[] }) {
  localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
}

// 媒体模型按名称关键字归类；无法识别的媒体模型同时保留在 image / video 列表中供选择
export function classifyModels(all: string[]): { image: string[]; video: string[] } {
  const imageKw = ["image", "flux", "banana", "seedream", "imagine-image", "dall", "midjourney", "sd", "画"];
  const videoKw = ["video", "kling", "veo", "seedance", "sora", "wan", "imagine-video", "runway", "可灵"];
  const image: string[] = [];
  const video: string[] = [];
  for (const m of all) {
    const low = m.toLowerCase();
    const isImage = imageKw.some((k) => low.includes(k));
    const isVideo = videoKw.some((k) => low.includes(k));
    if (isVideo && !isImage) video.push(m);
    else if (isImage && !isVideo) image.push(m);
    else { image.push(m); video.push(m); }
  }
  return { image, video };
}

export function modelOptions(): { chat: string[]; image: string[]; video: string[] } {
  return loadModelCache();
}
