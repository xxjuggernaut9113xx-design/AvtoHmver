//! Caller authority carried into shared operations independently of HTTP.
//!
//! Every service-boundary check resolves the caller's authenticated role
//! (Host / Server / Viewer) plus the Viewer capability set negotiated at
//! connect time ([`crate::native::ViewerPermissions`]). Raw peer locality is
//! only ever the *input* to that resolution, never the decision itself, and
//! the same [`Caller`] type guards the Host-direct call path and the HTTP
//! adapters alike.

use crate::native::ViewerPermissions;
use std::net::SocketAddr;

/// Authenticated caller roles. Host and Server own the library; a Viewer is
/// a remote Tailnet peer whose capabilities were negotiated at connect time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Host,
    Server,
    Viewer,
}

/// Locality-derived actor, kept for the existing service signatures that
/// predate authenticated roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    LocalOwner,
    RemoteViewer,
}

impl Actor {
    pub fn can_edit_library(self) -> bool {
        matches!(self, Self::LocalOwner)
    }

    /// Lift a locality-derived actor into a full [`Caller`]. Local owners
    /// keep full authority; remote viewers carry the negotiated permissions.
    pub fn caller(self, permissions: ViewerPermissions) -> Caller {
        match self {
            Self::LocalOwner => Caller::host(),
            Self::RemoteViewer => Caller::viewer(permissions),
        }
    }
}

const fn full_permissions() -> ViewerPermissions {
    ViewerPermissions {
        library_read: true,
        playback: true,
        discovery: true,
        library_edit: true,
        session_control: true,
    }
}

/// Full authority for one caller: the authenticated role plus the Viewer
/// capability set negotiated at connect time. Service boundaries check
/// [`Caller`] instead of re-deriving trust from the TCP peer on every call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caller {
    role: Role,
    permissions: ViewerPermissions,
}

impl Caller {
    /// The local Host process. Always fully authorized.
    pub fn host() -> Self {
        Self {
            role: Role::Host,
            permissions: full_permissions(),
        }
    }

    /// The local Server process. Always fully authorized; the edition check
    /// in each service still decides whether this installation owns the
    /// library it is asked to mutate.
    pub fn server() -> Self {
        Self {
            role: Role::Server,
            permissions: full_permissions(),
        }
    }

    /// A remote Tailnet Viewer carrying the capabilities negotiated during
    /// the connect handshake.
    pub fn viewer(permissions: ViewerPermissions) -> Self {
        Self {
            role: Role::Viewer,
            permissions,
        }
    }

    /// Resolve a caller from an optional TCP peer address. A loopback peer —
    /// or no peer at all, as on the Host-direct call path and in-process
    /// tests — is the Host itself; any other address is an authenticated
    /// Viewer carrying `permissions`.
    pub fn for_peer(peer: Option<SocketAddr>, permissions: ViewerPermissions) -> Self {
        if peer.is_some_and(|peer| !peer.ip().is_loopback()) {
            Self::viewer(permissions)
        } else {
            Self::host()
        }
    }

    pub fn role(self) -> Role {
        self.role
    }

    pub fn permissions(self) -> ViewerPermissions {
        self.permissions
    }

    pub fn is_viewer(self) -> bool {
        matches!(self.role, Role::Viewer)
    }

    /// Library mutations (ratings, tags, groups, bulk operations). Host and
    /// Server may always edit; a Viewer needs the explicitly negotiated
    /// `library_edit` capability.
    pub fn can_edit_library(self) -> bool {
        !self.is_viewer() || self.permissions.library_edit
    }

    /// Byte-range media streaming. Host and Server may always stream; a
    /// Viewer needs the `playback` capability.
    pub fn can_stream_media(self) -> bool {
        !self.is_viewer() || self.permissions.playback
    }

    /// Library listing and search. Host and Server may always read; a Viewer
    /// needs the `library_read` capability.
    pub fn can_read_library(self) -> bool {
        !self.is_viewer() || self.permissions.library_read
    }

    /// Discovery search and downloads. Host and Server may always use them;
    /// a Viewer needs the `discovery` capability.
    pub fn can_use_discovery(self) -> bool {
        !self.is_viewer() || self.permissions.discovery
    }

    /// Playback session control (play/pause/seek orchestration). Host and
    /// Server may always control sessions; a Viewer needs the
    /// `session_control` capability.
    pub fn can_control_sessions(self) -> bool {
        !self.is_viewer() || self.permissions.session_control
    }

    /// Back-compatibility projection for the existing service signatures.
    /// Host and Server act as the local owner; only Viewers are remote.
    pub fn actor(self) -> Actor {
        match self.role {
            Role::Host | Role::Server => Actor::LocalOwner,
            Role::Viewer => Actor::RemoteViewer,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn loopback() -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 42168)
    }

    fn tailnet_peer() -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 2)), 42168)
    }

    #[test]
    fn peer_locality_resolves_to_host_or_viewer() {
        let viewer = Caller::for_peer(Some(tailnet_peer()), ViewerPermissions::default());
        assert_eq!(viewer.role(), Role::Viewer);
        assert!(viewer.is_viewer());
        assert_eq!(viewer.actor(), Actor::RemoteViewer);

        let host = Caller::for_peer(Some(loopback()), ViewerPermissions::default());
        assert_eq!(host.role(), Role::Host);
        assert_eq!(host.actor(), Actor::LocalOwner);

        // The Host-direct call path carries no peer at all.
        let direct = Caller::for_peer(None, ViewerPermissions::default());
        assert_eq!(direct.role(), Role::Host);
    }

    #[test]
    fn viewer_without_edit_permission_is_denied_library_mutations() {
        let viewer = Caller::viewer(ViewerPermissions::default());
        assert!(!viewer.permissions.library_edit);
        assert!(!viewer.can_edit_library());
        assert_eq!(viewer.actor(), Actor::RemoteViewer);
        assert!(!viewer.actor().can_edit_library());

        let elevated = Caller::viewer(ViewerPermissions {
            library_edit: true,
            ..ViewerPermissions::default()
        });
        assert!(elevated.can_edit_library());
    }

    #[test]
    fn host_and_server_keep_full_authority() {
        for caller in [Caller::host(), Caller::server()] {
            assert!(caller.can_edit_library());
            assert!(caller.can_stream_media());
            assert!(caller.can_read_library());
            assert!(caller.can_use_discovery());
            assert!(caller.can_control_sessions());
            assert_eq!(caller.actor(), Actor::LocalOwner);
        }
    }

    #[test]
    fn every_viewer_capability_is_gated() {
        let denied = ViewerPermissions {
            library_read: false,
            playback: false,
            discovery: false,
            library_edit: false,
            session_control: false,
        };
        let viewer = Caller::viewer(denied);
        assert!(!viewer.can_edit_library());
        assert!(!viewer.can_stream_media());
        assert!(!viewer.can_read_library());
        assert!(!viewer.can_use_discovery());
        assert!(!viewer.can_control_sessions());

        // Each capability is granted independently of the others.
        assert!(Caller::viewer(ViewerPermissions {
            playback: true,
            ..denied
        })
        .can_stream_media());
        assert!(Caller::viewer(ViewerPermissions {
            session_control: true,
            ..denied
        })
        .can_control_sessions());
        assert!(!Caller::viewer(ViewerPermissions {
            playback: true,
            ..denied
        })
        .can_edit_library());
    }

    #[test]
    fn legacy_actor_lifts_into_caller() {
        let owner = Actor::LocalOwner.caller(ViewerPermissions::default());
        assert_eq!(owner.role(), Role::Host);
        assert!(owner.can_edit_library());

        let viewer = Actor::RemoteViewer.caller(ViewerPermissions::default());
        assert_eq!(viewer.role(), Role::Viewer);
        assert!(!viewer.can_edit_library());
    }
}
