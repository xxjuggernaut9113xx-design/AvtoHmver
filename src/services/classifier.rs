//! Local classifier controls shared by native Host and HTTP Admin adapters.
use crate::{
    phar::{self, PharBackend, PharStatus},
    AppState,
};

#[derive(Clone, Copy)]
pub enum Action {
    Status,
    Install,
    Evaluate,
    Repair,
    SelfTest,
    Cancel,
    Configure {
        enabled: bool,
        backend: Option<PharBackend>,
    },
}

#[derive(Debug)]
pub enum Error {
    Forbidden,
    Unavailable(&'static str),
    Failed(String),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Forbidden => {
                f.write_str("Classifier management is available only on the library computer")
            }
            Self::Unavailable(message) => f.write_str(message),
            Self::Failed(message) => f.write_str(message),
        }
    }
}

static CONTROL: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn control(state: &AppState, action: Action) -> Result<PharStatus, Error> {
    if !state.edition.has_local_admin() {
        return Err(Error::Forbidden);
    }
    if state.shutdown.is_cancelled() {
        return Err(Error::Unavailable("AvtoHmver is shutting down"));
    }
    let lease = state
        .maintenance
        .try_acquire_background_worker()
        .ok_or(Error::Unavailable("A local maintenance job is active"))?;
    let _serial = CONTROL.lock().unwrap_or_else(|error| error.into_inner());
    if matches!(action, Action::Install | Action::Repair) {
        let current = phar::status(&state.data_dir, state.install_scope);
        if matches!(
            current.phase,
            phar::PharPhase::Detecting
                | phar::PharPhase::ProvisioningRuntime
                | phar::PharPhase::FetchingSource
                | phar::PharPhase::InstallingDependencies
                | phar::PharPhase::DownloadingModels
                | phar::PharPhase::Verifying
                | phar::PharPhase::Probing
        ) {
            if matches!(action, Action::Install) {
                return Ok(current);
            }
            return Err(Error::Unavailable(
                "Cancel the running setup before repairing it",
            ));
        }
    }
    let result = match action {
        Action::Status => Ok(phar::status(&state.data_dir, state.install_scope)),
        Action::Install => phar::record_install_intent(
            &state.data_dir,
            state.install_scope,
            true,
            None,
        )
        .and_then(|_| {
            phar::start_install_with_lease(&state.data_dir, state.install_scope, Some(lease))
        }),
        Action::Evaluate => {
            phar::start_install_with_lease(&state.data_dir, state.install_scope, Some(lease))
        }
        Action::Repair => phar::record_install_intent(
            &state.data_dir,
            state.install_scope,
            true,
            None,
        )
        .and_then(|_| {
            phar::start_install_with_lease(&state.data_dir, state.install_scope, Some(lease))
        }),
        Action::SelfTest => phar::self_test(&state.data_dir, state.install_scope),
        Action::Cancel => phar::cancel(&state.data_dir, state.install_scope),
        Action::Configure { enabled, backend } => {
            let status = phar::status(&state.data_dir, state.install_scope);
            if matches!(
                status.phase,
                phar::PharPhase::Detecting
                    | phar::PharPhase::ProvisioningRuntime
                    | phar::PharPhase::FetchingSource
                    | phar::PharPhase::InstallingDependencies
                    | phar::PharPhase::DownloadingModels
                    | phar::PharPhase::Verifying
                    | phar::PharPhase::Probing
            ) {
                return Err(Error::Unavailable(
                    "Cancel the running setup before changing classifier configuration",
                ));
            }
            phar::record_install_intent(&state.data_dir, state.install_scope, enabled, backend)
        }
    };
    result.map_err(|error| Error::Failed(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_classifier_controls_deny_viewer_and_shutdown_before_configuration_access() {
        let root = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(root.path());
        let mut viewer = (*state).clone();
        viewer.edition = crate::edition::Edition::Viewer;
        assert!(matches!(
            control(&viewer, Action::Install),
            Err(Error::Forbidden)
        ));
        state.shutdown.cancel();
        assert!(matches!(
            control(
                &state,
                Action::Configure {
                    enabled: true,
                    backend: Some(PharBackend::Cuda)
                }
            ),
            Err(Error::Unavailable(_))
        ));
        assert!(!state.data_dir.join("phar").exists());
    }
}
