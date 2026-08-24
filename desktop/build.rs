use std::{env, path::PathBuf, process::Command};

fn build_external_live_surface_helper() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let source = manifest_dir.join("helpers/external-live-surface.swift");
    let output = PathBuf::from(env::var("OUT_DIR").expect("build output directory"))
        .join("external-live-surface");
    println!("cargo:rerun-if-changed={}", source.display());
    let status = Command::new("xcrun")
        .args(["swiftc", "-parse-as-library", "-O"])
        .arg(&source)
        .arg("-o")
        .arg(&output)
        .status()
        .expect("xcrun is required to build the macOS live-surface helper");
    assert!(
        status.success(),
        "failed to compile the macOS live-surface helper"
    );
}

fn main() {
    build_external_live_surface_helper();
    tauri_build::build()
}
