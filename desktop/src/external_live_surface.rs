use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{ipc::Channel, AppHandle, Manager};

const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

#[cfg(target_os = "macos")]
const HELPER_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/external-live-surface"));

#[derive(Default)]
pub struct ExternalLiveSurfaceSessions(Mutex<HashMap<String, Child>>);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRectangle {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLiveSurfaceCaptureRequest {
    frames_per_second: f64,
    region: CaptureRectangle,
    session_id: String,
    source_title: String,
    source_window: CaptureRectangle,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExternalLiveSurfaceCaptureEvent {
    Ended {
        session_id: String,
    },
    Frame {
        data_url: String,
        sequence: u64,
        session_id: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLiveSurfaceCaptureStarted {
    session_id: String,
    transport: &'static str,
}

fn valid_rectangle(rectangle: CaptureRectangle) -> bool {
    rectangle.x.is_finite()
        && rectangle.y.is_finite()
        && rectangle.width.is_finite()
        && rectangle.height.is_finite()
        && rectangle.width > 0.0
        && rectangle.height > 0.0
        && rectangle.width <= 16_384.0
        && rectangle.height <= 16_384.0
}

fn validate_request(request: &ExternalLiveSurfaceCaptureRequest) -> Result<(), String> {
    if request.session_id.is_empty() || request.session_id.len() > 128 {
        return Err("invalid live-surface session id".into());
    }
    if request.source_title.len() > 500 {
        return Err("source window title is too long".into());
    }
    if !valid_rectangle(request.region) || !valid_rectangle(request.source_window) {
        return Err("invalid live-surface capture geometry".into());
    }
    if !request.frames_per_second.is_finite()
        || request.frames_per_second < 1.0
        || request.frames_per_second > 60.0
    {
        return Err("live-surface frame rate must be between 1 and 60".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("could not resolve app cache directory: {error}"))?
        .join("external-live-surface");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not prepare capture helper directory: {error}"))?;
    let path = directory.join(format!("stream-{}", env!("CARGO_PKG_VERSION")));
    let should_write = fs::read(&path)
        .map(|installed| installed != HELPER_BYTES)
        .unwrap_or(true);
    if should_write {
        fs::write(&path, HELPER_BYTES)
            .map_err(|error| format!("could not install capture helper: {error}"))?;
    }
    let mut permissions = fs::metadata(&path)
        .map_err(|error| format!("could not inspect capture helper: {error}"))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions)
        .map_err(|error| format!("could not make capture helper executable: {error}"))?;
    Ok(path)
}

#[cfg(not(target_os = "macos"))]
fn helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("external live-surface capture currently requires macOS 14 or newer".into())
}

fn capture_arguments(request: &ExternalLiveSurfaceCaptureRequest) -> Vec<String> {
    [
        request.source_title.clone(),
        request.region.x.to_string(),
        request.region.y.to_string(),
        request.region.width.to_string(),
        request.region.height.to_string(),
        request.source_window.x.to_string(),
        request.source_window.y.to_string(),
        request.source_window.width.to_string(),
        request.source_window.height.to_string(),
        request.frames_per_second.to_string(),
        "0".into(),
    ]
    .into()
}

#[tauri::command]
pub fn start_external_live_surface_capture(
    app: AppHandle,
    state: tauri::State<ExternalLiveSurfaceSessions>,
    request: ExternalLiveSurfaceCaptureRequest,
    on_event: Channel<ExternalLiveSurfaceCaptureEvent>,
) -> Result<ExternalLiveSurfaceCaptureStarted, String> {
    validate_request(&request)?;
    let helper = helper_path(&app)?;
    let mut child = Command::new(helper)
        .args(capture_arguments(&request))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("could not start live-surface capture: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "live-surface capture did not expose a frame stream".to_string())?;
    let process_id = child.id();
    let session_id = request.session_id.clone();
    {
        let mut sessions = state
            .0
            .lock()
            .map_err(|_| "live-surface session state is unavailable".to_string())?;
        if let Some(mut previous) = sessions.insert(session_id.clone(), child) {
            let _ = previous.kill();
            let _ = previous.wait();
        }
    }

    let app_for_stream = app.clone();
    let stream_session_id = session_id.clone();
    thread::spawn(move || {
        let mut reader = stdout;
        let mut sequence = 0_u64;
        loop {
            let mut length_bytes = [0_u8; 4];
            match reader.read_exact(&mut length_bytes) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::UnexpectedEof => break,
                Err(_) => break,
            }
            let length = u32::from_be_bytes(length_bytes) as usize;
            if !(100..=MAX_FRAME_BYTES).contains(&length) {
                break;
            }
            let mut frame = vec![0_u8; length];
            if reader.read_exact(&mut frame).is_err() {
                break;
            }
            sequence += 1;
            if on_event
                .send(ExternalLiveSurfaceCaptureEvent::Frame {
                    data_url: format!("data:image/jpeg;base64,{}", BASE64.encode(frame)),
                    sequence,
                    session_id: stream_session_id.clone(),
                })
                .is_err()
            {
                break;
            }
        }

        if let Ok(mut sessions) = app_for_stream
            .state::<ExternalLiveSurfaceSessions>()
            .0
            .lock()
        {
            let owns_session = sessions
                .get(&stream_session_id)
                .is_some_and(|child| child.id() == process_id);
            if owns_session {
                if let Some(mut child) = sessions.remove(&stream_session_id) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        let _ = on_event.send(ExternalLiveSurfaceCaptureEvent::Ended {
            session_id: stream_session_id,
        });
    });

    Ok(ExternalLiveSurfaceCaptureStarted {
        session_id,
        transport: "attune-window-region-stream",
    })
}

#[tauri::command]
pub fn stop_external_live_surface_capture(
    state: tauri::State<ExternalLiveSurfaceSessions>,
    session_id: String,
) -> Result<bool, String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|_| "live-surface session state is unavailable".to_string())?;
    let Some(mut child) = sessions.remove(&session_id) else {
        return Ok(false);
    };
    child
        .kill()
        .map_err(|error| format!("could not stop live-surface capture: {error}"))?;
    child
        .wait()
        .map_err(|error| format!("could not reap live-surface capture: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ExternalLiveSurfaceCaptureRequest {
        ExternalLiveSurfaceCaptureRequest {
            frames_per_second: 30.0,
            region: CaptureRectangle {
                x: 20.0,
                y: 40.0,
                width: 320.0,
                height: 180.0,
            },
            session_id: "surface-1".into(),
            source_title: "Source".into(),
            source_window: CaptureRectangle {
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 800.0,
            },
        }
    }

    #[test]
    fn validates_bounded_capture_geometry() {
        assert!(validate_request(&request()).is_ok());
        let mut invalid = request();
        invalid.region.width = 0.0;
        assert!(validate_request(&invalid).is_err());
    }

    #[test]
    fn builds_attune_compatible_region_arguments() {
        let arguments = capture_arguments(&request());
        assert_eq!(arguments.len(), 11);
        assert_eq!(arguments[0], "Source");
        assert_eq!(arguments[3], "320");
        assert_eq!(arguments[9], "30");
        assert_eq!(arguments[10], "0");
    }
}
