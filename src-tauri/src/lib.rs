use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ---------- Chat streaming (SSE) ----------
// 前端传入 Channel：逐块推送 {"delta": "..."} / {"done": true} / {"error": "..."}
#[tauri::command]
async fn chat_completion_stream(req: ChatRequest, on_event: tauri::ipc::Channel<Value>) -> Result<(), String> {
    use futures_util::StreamExt;
    // req 定义在下方，Rust 允许先引用后定义
    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));
    let payload = json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let ct = resp.headers().get("content-type")
        .and_then(|v| v.to_str().ok()).unwrap_or("").to_string();

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&body).ok()
            .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or(body.chars().take(300).collect());
        let _ = on_event.send(json!({ "error": format!("HTTP {}: {}", status, msg) }));
        let _ = on_event.send(json!({ "done": true }));
        return Ok(());
    }

    // 非 SSE：回退一次性解析
    if !ct.contains("text/event-stream") {
        let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
        let content = body.get("choices").and_then(|c| c.get(0))
            .and_then(|c| c.get("message")).and_then(|m| m.get("content"))
            .and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !content.is_empty() { let _ = on_event.send(json!({ "delta": content })); }
        let _ = on_event.send(json!({ "done": true }));
        return Ok(());
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut got_any = false;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk { Ok(c) => c, Err(e) => {
            let _ = on_event.send(json!({ "error": format!("读取失败: {}", e) }));
            break;
        }};
        buf.push_str(&String::from_utf8_lossy(&chunk));
        // SSE 以空行分隔事件，按行处理 data: 帧
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();
            if !line.starts_with("data:") { continue; }
            let data = line[5..].trim();
            if data == "[DONE]" {
                let _ = on_event.send(json!({ "done": true }));
                return Ok(());
            }
            let v: Value = match serde_json::from_str(data) { Ok(v) => v, Err(_) => continue };
            if let Some(err) = v.get("error") {
                let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("未知错误");
                let _ = on_event.send(json!({ "error": msg }));
                let _ = on_event.send(json!({ "done": true }));
                return Ok(());
            }
            let delta = v.get("choices").and_then(|c| c.get(0))
                .and_then(|c| c.get("delta")).and_then(|d| d.get("content"))
                .and_then(|x| x.as_str()).unwrap_or("");
            if !delta.is_empty() {
                got_any = true;
                let _ = on_event.send(json!({ "delta": delta }));
            }
        }
    }
    if !got_any {
        let _ = on_event.send(json!({ "error": "未收到流式内容" }));
    }
    let _ = on_event.send(json!({ "done": true }));
    Ok(())
}

// ---------- Models ----------
#[tauri::command]
async fn list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    if !status.is_success() {
        let msg = body.get("error").and_then(|e| e.get("message"))
            .and_then(|m| m.as_str()).unwrap_or("未知错误");
        return Err(format!("HTTP {}: {}", status, msg));
    }
    // 兼容多种返回结构：{data:[{id}]} / {models:[...]} / 直接数组
    let mut ids: Vec<String> = Vec::new();
    let collect = |v: &Value, out: &mut Vec<String>| {
        if let Some(arr) = v.as_array() {
            for item in arr {
                let id = item.as_str()
                    .or_else(|| item.get("id").and_then(|x| x.as_str()))
                    .or_else(|| item.get("name").and_then(|x| x.as_str()))
                    .or_else(|| item.get("model").and_then(|x| x.as_str()));
                if let Some(s) = id {
                    let s = s.to_string();
                    if !s.is_empty() && !out.contains(&s) { out.push(s); }
                }
            }
        }
    };
    if let Some(data) = body.get("data") { collect(data, &mut ids); }
    if ids.is_empty() {
        if let Some(models) = body.get("models") { collect(models, &mut ids); }
    }
    if ids.is_empty() { collect(&body, &mut ids); }
    ids.sort();
    Ok(ids)
}

// ---------- Chat ----------
#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChatRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

#[tauri::command]
async fn chat_completion(req: ChatRequest) -> Result<String, String> {
    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let payload = json!({
        "model": req.model,
        "messages": req.messages,
        "stream": false
    });
    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    if !status.is_success() {
        let msg = body.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("未知错误");
        return Err(format!("HTTP {}: {}", status, msg));
    }
    let content = body
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(content)
}

// ---------- Image ----------
#[derive(Serialize, Deserialize)]
pub struct ImageRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub size: String,
    pub n: u32,
}

#[tauri::command]
async fn generate_image(req: ImageRequest) -> Result<Vec<String>, String> {
    let url = format!("{}/images/generations", req.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let payload = json!({
        "model": req.model,
        "prompt": req.prompt,
        "size": req.size,
        "n": req.n,
        "response_format": "b64_json"
    });
    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    if !status.is_success() {
        let msg = body.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("未知错误");
        return Err(format!("HTTP {}: {}", status, msg));
    }
    let mut images = Vec::new();
    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
                images.push(format!("data:image/png;base64,{}", b64));
            } else if let Some(u) = item.get("url").and_then(|v| v.as_str()) {
                images.push(u.to_string());
            }
        }
    }
    Ok(images)
}

// ---------- Video ----------
#[derive(Serialize, Deserialize)]
pub struct VideoRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub seconds: u32,
    pub size: String,
}

#[derive(Serialize, Deserialize)]
pub struct VideoTask {
    pub id: String,
}

#[tauri::command]
async fn submit_video(req: VideoRequest) -> Result<String, String> {
    let url = format!("{}/videos", req.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let payload = json!({
        "model": req.model,
        "prompt": req.prompt,
        "seconds": req.seconds,
        "size": req.size
    });
    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    if !status.is_success() {
        let msg = body.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("未知错误");
        return Err(format!("HTTP {}: {}", status, msg));
    }
    let id = body.get("id").and_then(|v| v.as_str())
        .or_else(|| body.get("task_id").and_then(|v| v.as_str()))
        .ok_or("未返回任务 ID")?;
    Ok(id.to_string())
}

#[tauri::command]
async fn query_video(base_url: String, api_key: String, task_id: String) -> Result<Value, String> {
    let url = format!("{}/videos/{}", base_url.trim_end_matches('/'), task_id);
    let client = reqwest::Client::new();
    let resp = client.get(&url).bearer_auth(&api_key).send().await.map_err(|e| format!("查询失败: {}", e))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }
    Ok(body)
}

#[tauri::command]
async fn download_video(url: String, api_key: String) -> Result<String, String> {
    use base64::Engine;
    let client = reqwest::Client::new();
    let resp = client.get(&url).bearer_auth(&api_key).send().await.map_err(|e| format!("下载失败: {}", e))?;
    let bytes = resp.bytes().await.map_err(|e| format!("读取失败: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes.as_ref());
    Ok(format!("data:video/mp4;base64,{}", b64))
}

// ---------- 窗口控制 ----------
// 自绘标题栏的三个按钮走 Rust 命令，避免前端 getCurrentWindow() 在
// WebView 初始化时序或 ACL 受限时静默失败。

#[tauri::command]
fn window_minimize(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
fn window_toggle_maximize(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = if window.is_maximized().unwrap_or(false) {
            window.unmaximize()
        } else {
            window.maximize()
        };
    }
}

#[tauri::command]
fn window_close(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

#[tauri::command]
fn window_is_maximized(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("main")
        .and_then(|w| w.is_maximized().ok())
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Windows 11 亚克力毛玻璃背景；失败时回退到普通背景不影响使用
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    use window_vibrancy::apply_acrylic;
                    // WebviewWindow 实现了 HasWindowHandle，直接传入
                    let _ = apply_acrylic(&window, Some((18, 18, 20, 150)));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat_completion,
            chat_completion_stream,
            generate_image,
            submit_video,
            query_video,
            download_video,
            list_models,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
