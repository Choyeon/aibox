// 隐藏 Windows 启动时附带的控制台黑框（release 构建）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aibox_lib::run();
}
