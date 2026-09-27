//! HTTP adapter for download controls. Business logic lives in the typed
//! [`crate::services::downloads`] ops; the adapters only translate between
//! HTTP and those ops. Rejections keep the legacy 200 + JSON error body.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};

use crate::services::downloads::{
    pause_source_typed, pause_typed, resume_source_typed, resume_typed, ControlError, PauseOutcome,
    ResumeOutcome, SourcePauseOutcome, SourceResumeOutcome,
};
use crate::AppState;

// ─── GET /api/downloads/status ───────────────────────────────────────────────

pub async fn status(
    State(state): State<Arc<AppState>>,
) -> Json<crate::services::downloads::DownloadStatus> {
    Json(crate::services::downloads::status(&state).await)
}

pub async fn pause(
    State(state): State<Arc<AppState>>,
) -> Result<Json<PauseOutcome>, Json<ControlError>> {
    match pause_typed(&state).await {
        Ok(outcome) => Ok(Json(outcome)),
        Err(error) => Err(Json(error)),
    }
}

pub async fn pause_source(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<SourcePauseOutcome>, Json<ControlError>> {
    match pause_source_typed(&state, id).await {
        Ok(outcome) => Ok(Json(outcome)),
        Err(error) => Err(Json(error)),
    }
}

pub async fn resume_source(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<SourceResumeOutcome>, Json<ControlError>> {
    match resume_source_typed(state, id).await {
        Ok(outcome) => Ok(Json(outcome)),
        Err(error) => Err(Json(error)),
    }
}

pub async fn resume(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ResumeOutcome>, Json<ControlError>> {
    match resume_typed(state).await {
        Ok(outcome) => Ok(Json(outcome)),
        Err(error) => Err(Json(error)),
    }
}
