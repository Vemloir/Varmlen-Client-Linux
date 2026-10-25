//! Downloaded Xray versions, kept as root-owned copies the daemon may run.
//!
//! The GUI downloads a release archive into the owner's data directory. That
//! copy is writable by the user, so the daemon never executes it: it reads the
//! archive through a descriptor whose owner it checks, verifies it against the
//! digest GitHub publishes for that release, and installs the `xray` inside it
//! as `/var/lib/varmlen/cores/<tag>/xray`, owned by root. A connect that names
//! a tag runs that copy; one that names none runs the bundled Xray.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::protocol::{valid_core_tag, CoreInstallRequest, DaemonError, DaemonErrorCode};
use crate::system::ensure_trusted_binary;

pub const CORES_DIR: &str = "/var/lib/varmlen/cores";
const XRAY_REPOSITORY: &str = "XTLS/Xray-core";
/// A release archive is about 15 MB and its binary about 30 MB.
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const METADATA_TIMEOUT: Duration = Duration::from_secs(20);

/// Xray's release asset for a Rust target architecture.
///
/// This intentionally covers every Linux architecture published by Xray.
pub fn xray_asset_name(arch: &str, little_endian: bool) -> Option<&'static str> {
    match (arch, little_endian) {
        ("x86_64", _) => Some("Xray-linux-64.zip"),
        ("x86", _) => Some("Xray-linux-32.zip"),
        ("aarch64", _) => Some("Xray-linux-arm64-v8a.zip"),
        // Rust exposes all 32-bit ARM targets as `arm` at runtime. Varmlen's
        // supported 32-bit Linux baseline is ARMv7; the build fetcher uses the
        // full target triple and can additionally bundle v5/v6 assets.
        ("arm", _) => Some("Xray-linux-arm32-v7a.zip"),
        ("riscv64", _) => Some("Xray-linux-riscv64.zip"),
        ("loongarch64", _) => Some("Xray-linux-loong64.zip"),
        ("powerpc64", true) => Some("Xray-linux-ppc64le.zip"),
        ("powerpc64", false) => Some("Xray-linux-ppc64.zip"),
        ("s390x", _) => Some("Xray-linux-s390x.zip"),
        ("mips", true) | ("mips32r6", true) => Some("Xray-linux-mips32le.zip"),
        ("mips", false) | ("mips32r6", false) => Some("Xray-linux-mips32.zip"),
        ("mips64", true) | ("mips64r6", true) => Some("Xray-linux-mips64le.zip"),
        ("mips64", false) | ("mips64r6", false) => Some("Xray-linux-mips64.zip"),
        _ => None,
    }
}

/// The release asset for the architecture this daemon was built for.
pub fn host_xray_asset_name() -> Option<&'static str> {
    xray_asset_name(std::env::consts::ARCH, cfg!(target_endian = "little"))
}

fn failed(message: impl Into<String>) -> DaemonError {
    DaemonError::new(DaemonErrorCode::CoreInstallFailed, message)
}

pub struct CoreStore {
    root: PathBuf,
    owner_uid: u32,
}

impl CoreStore {
    pub fn installed(owner_uid: u32) -> Self {
        Self::new(PathBuf::from(CORES_DIR), owner_uid)
    }

    pub fn new(root: PathBuf, owner_uid: u32) -> Self {
        Self { root, owner_uid }
    }

    fn binary(&self, tag: &str) -> PathBuf {
        self.root.join(tag).join("xray")
    }

    /// The root-owned binary installed for `tag`.
    pub fn resolve(&self, tag: &str) -> Result<PathBuf, DaemonError> {
        if !valid_core_tag(tag) {
            return Err(DaemonError::new(
                DaemonErrorCode::InvalidRequest,
                format!("invalid Xray version: {tag}"),
            ));
        }
        let binary = self.binary(tag);
        if !binary.exists() {
            return Err(DaemonError::new(
                DaemonErrorCode::XrayUnavailable,
                format!("Xray {tag} is not installed for the daemon; select it again in Settings"),
            ));
        }
        ensure_trusted_binary(&binary)?;
        Ok(binary)
    }

    /// Verify the owner's archive against GitHub and install its `xray`.
    ///
    /// A tag that is already installed is left as it is, without reading the
    /// archive or reaching GitHub.
    pub async fn install(&self, request: &CoreInstallRequest) -> Result<(), DaemonError> {
        let tag = request.tag.as_str();
        if self.resolve(tag).is_ok() {
            return Ok(());
        }
        let asset = host_xray_asset_name()
            .ok_or_else(|| failed("Xray publishes no build for this architecture"))?;
        let archive = read_owned_archive(Path::new(&request.archive), self.owner_uid)?;
        let expected = fetch_release_digest(tag, asset).await?;
        let actual = sha256_hex(&archive);
        if actual != expected {
            return Err(failed(format!(
                "Xray {tag} archive does not match its published checksum \
                 (expected {expected}, got {actual})"
            )));
        }
        let binary = extract_xray(&archive)?;
        let installed = install_binary(&self.root, tag, &binary)?;
        let reported = binary_version(&installed).await;
        if reported.as_deref() != Some(tag) {
            let _ = fs::remove_dir_all(self.root.join(tag));
            return Err(failed(format!(
                "the installed binary reports Xray {}, not {tag}",
                reported.as_deref().unwrap_or("nothing")
            )));
        }
        Ok(())
    }

    /// Remove the copy installed for `tag`, unless `running` is that copy.
    pub fn remove(&self, tag: &str, running: Option<&Path>) -> Result<(), DaemonError> {
        if !valid_core_tag(tag) {
            return Err(DaemonError::new(
                DaemonErrorCode::InvalidRequest,
                format!("invalid Xray version: {tag}"),
            ));
        }
        let binary = self.binary(tag);
        if running.is_some_and(|path| path == binary) {
            return Err(failed(format!(
                "Xray {tag} is running the tunnel; disconnect before removing it"
            )));
        }
        match fs::remove_dir_all(self.root.join(tag)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(failed(format!("could not remove Xray {tag}: {error}"))),
        }
    }
}

/// Read a file the owner could read anyway.
///
/// The path comes from the owner, so the checks are made on the opened
/// descriptor: a symlink as the last component is refused, and a file the
/// owner does not own -- a hard link to a root file, a swapped path -- is
/// refused before anything is read from it.
fn read_owned_archive(path: &Path, owner_uid: u32) -> Result<Vec<u8>, DaemonError> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| {
            failed(format!(
                "could not open Xray archive {}: {error}",
                path.display()
            ))
        })?;
    let metadata = file
        .metadata()
        .map_err(|error| failed(format!("could not inspect Xray archive: {error}")))?;
    if !metadata.is_file() || metadata.uid() != owner_uid {
        return Err(failed(format!(
            "{} is not an archive owned by the desktop user",
            path.display()
        )));
    }
    if metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(failed(format!(
            "Xray archive is too large: {} bytes",
            metadata.len()
        )));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut file)
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(format!("could not read Xray archive: {error}")))?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(failed("Xray archive grew past its size limit"));
    }
    Ok(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn http_client() -> Result<reqwest::Client, DaemonError> {
    reqwest::Client::builder()
        .user_agent("varmlend (core-installer)")
        .timeout(METADATA_TIMEOUT)
        .build()
        .map_err(|error| failed(format!("could not build HTTP client: {error}")))
}

async fn get_limited(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, DaemonError> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| failed(format!("could not reach GitHub: {error}")))?;
    if !response.status().is_success() {
        return Err(failed(format!(
            "GitHub answered HTTP {}",
            response.status()
        )));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| failed(format!("could not read GitHub's answer: {error}")))?
    {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_METADATA_BYTES {
            return Err(failed("GitHub's answer is too large"));
        }
    }
    Ok(body)
}

/// The SHA-256 GitHub publishes for one asset of an Xray release.
///
/// Xray attaches a `.dgst` file to every asset of every release, and it is
/// served from the release downloads, which the API's 60-requests-an-hour
/// limit for anonymous clients does not cover. The digest the release API
/// carries for each asset is asked only when that file is unavailable. A
/// release with neither is refused.
async fn fetch_release_digest(tag: &str, asset: &str) -> Result<String, DaemonError> {
    let client = http_client()?;
    let dgst_error = match get_limited(
        &client,
        &format!("https://github.com/{XRAY_REPOSITORY}/releases/download/v{tag}/{asset}.dgst"),
    )
    .await
    {
        Ok(dgst) => match parse_dgst(&String::from_utf8_lossy(&dgst)) {
            Some(digest) => return Ok(digest),
            None => "it lists no SHA2-256".to_string(),
        },
        Err(error) => error.message,
    };
    let release = get_limited(
        &client,
        &format!("https://api.github.com/repos/{XRAY_REPOSITORY}/releases/tags/v{tag}"),
    )
    .await
    .map_err(|error| {
        failed(format!(
            "no checksum for Xray {tag}: {asset}.dgst: {dgst_error}; release API: {}",
            error.message
        ))
    })?;
    let release: serde_json::Value = serde_json::from_slice(&release)
        .map_err(|error| failed(format!("GitHub returned an unreadable release: {error}")))?;
    asset_digest(&release, asset)
        .ok_or_else(|| failed(format!("Xray {tag} publishes no SHA-256 for {asset}")))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn asset_digest(release: &serde_json::Value, asset: &str) -> Option<String> {
    release
        .get("assets")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("name").and_then(|name| name.as_str()) == Some(asset))?
        .get("digest")?
        .as_str()?
        .strip_prefix("sha256:")
        .filter(|hex| is_sha256_hex(hex))
        .map(str::to_ascii_lowercase)
}

/// The `SHA2-256= <hex>` line of an Xray `.dgst` file.
fn parse_dgst(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("SHA2-256="))
        .map(str::trim)
        .filter(|hex| is_sha256_hex(hex))
        .map(str::to_ascii_lowercase)
}

/// The `xray` member of a release archive, with its size bounded as it is
/// decompressed rather than as the archive claims.
fn extract_xray(archive: &[u8]) -> Result<Vec<u8>, DaemonError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))
        .map_err(|error| failed(format!("Xray archive is not a zip: {error}")))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| failed(format!("Xray archive entry: {error}")))?;
        if !entry.is_file() || !entry.name().is_ok_and(|name| name == "xray") {
            continue;
        }
        let mut binary = Vec::new();
        (&mut entry)
            .take(MAX_BINARY_BYTES + 1)
            .read_to_end(&mut binary)
            .map_err(|error| failed(format!("could not unpack xray: {error}")))?;
        if binary.len() as u64 > MAX_BINARY_BYTES {
            return Err(failed("xray in the archive is too large"));
        }
        return Ok(binary);
    }
    Err(failed("the archive holds no xray binary"))
}

/// Write the binary into `<root>/<tag>/xray` and rename it into place only
/// once it is complete, so a connect never runs a half-written core.
fn install_binary(root: &Path, tag: &str, binary: &[u8]) -> Result<PathBuf, DaemonError> {
    let io = |what: &'static str| move |error: std::io::Error| failed(format!("{what}: {error}"));
    let directory = root.join(tag);
    fs::create_dir_all(&directory).map_err(io("create core directory"))?;
    for path in [root, directory.as_path()] {
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .map_err(io("secure core directory"))?;
    }
    let destination = directory.join("xray");
    let temporary = directory.join(format!(".xray.tmp-{}", std::process::id()));
    let _ = fs::remove_file(&temporary);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o755)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&temporary)?;
        file.write_all(binary)?;
        file.set_permissions(fs::Permissions::from_mode(0o755))?;
        file.sync_all()?;
        fs::rename(&temporary, &destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(io("install core binary"))?;
    Ok(destination)
}

/// The version an Xray binary reports: `Xray 26.10.21 (Xray, ...) ...`.
async fn binary_version(binary: &Path) -> Option<String> {
    let output = timeout(
        Duration::from_secs(10),
        Command::new(binary)
            .arg("version")
            .env_clear()
            .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    parse_version_line(&String::from_utf8_lossy(&output.stdout))
}

fn parse_version_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, body) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn xray_assets_cover_supported_linux_architectures() {
        assert_eq!(xray_asset_name("x86_64", true), Some("Xray-linux-64.zip"));
        assert_eq!(xray_asset_name("x86", true), Some("Xray-linux-32.zip"));
        assert_eq!(
            xray_asset_name("aarch64", true),
            Some("Xray-linux-arm64-v8a.zip")
        );
        assert_eq!(
            xray_asset_name("arm", true),
            Some("Xray-linux-arm32-v7a.zip")
        );
        assert_eq!(
            xray_asset_name("riscv64", true),
            Some("Xray-linux-riscv64.zip")
        );
        assert_eq!(
            xray_asset_name("loongarch64", true),
            Some("Xray-linux-loong64.zip")
        );
        assert_eq!(
            xray_asset_name("powerpc64", true),
            Some("Xray-linux-ppc64le.zip")
        );
        assert_eq!(
            xray_asset_name("powerpc64", false),
            Some("Xray-linux-ppc64.zip")
        );
        assert_eq!(
            xray_asset_name("mips", true),
            Some("Xray-linux-mips32le.zip")
        );
        assert_eq!(
            xray_asset_name("mips64", false),
            Some("Xray-linux-mips64.zip")
        );
        assert_eq!(
            xray_asset_name("s390x", false),
            Some("Xray-linux-s390x.zip")
        );
        assert_eq!(xray_asset_name("unknown", true), None);
    }

    #[test]
    fn digests_come_from_the_release_api_or_the_dgst_file() {
        let hex = "0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978";
        let release = serde_json::json!({"assets": [
            {"name": "Xray-linux-32.zip", "digest": "sha256:00"},
            {"name": "Xray-linux-64.zip", "digest": format!("sha256:{}", hex.to_uppercase())},
        ]});
        assert_eq!(
            asset_digest(&release, "Xray-linux-64.zip").as_deref(),
            Some(hex)
        );
        assert_eq!(asset_digest(&release, "Xray-linux-32.zip"), None);
        assert_eq!(asset_digest(&release, "Xray-linux-arm64-v8a.zip"), None);

        let dgst = format!("MD5= 5adb\nSHA1= 1068\nSHA2-256= {hex}\nSHA2-512= a9dc\n");
        assert_eq!(parse_dgst(&dgst).as_deref(), Some(hex));
        assert_eq!(parse_dgst("SHA2-256= nothex\n"), None);
        assert_eq!(parse_dgst(""), None);
    }

    #[test]
    fn only_the_xray_member_is_extracted() {
        let archive = zip_with(&[("LICENSE", b"text"), ("xray", b"\x7fELF binary")]);
        assert_eq!(extract_xray(&archive).unwrap(), b"\x7fELF binary");

        let nested = zip_with(&[("bin/xray", b"elsewhere")]);
        assert!(extract_xray(&nested).is_err());
        assert!(extract_xray(b"not a zip").is_err());
    }

    #[test]
    fn archives_are_read_only_from_files_the_owner_owns() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("xray.zip");
        fs::write(&archive, b"zip bytes").unwrap();
        let uid = unsafe { libc::getuid() };

        assert_eq!(read_owned_archive(&archive, uid).unwrap(), b"zip bytes");
        assert!(read_owned_archive(&archive, uid + 1).is_err());

        let link = directory.path().join("link.zip");
        std::os::unix::fs::symlink(&archive, &link).unwrap();
        assert!(read_owned_archive(&link, uid).is_err());
        assert!(read_owned_archive(directory.path(), uid).is_err());
    }

    #[test]
    fn binaries_are_installed_complete_and_executable() {
        let root = tempfile::tempdir().unwrap();
        let installed = install_binary(root.path(), "26.10.21", b"binary").unwrap();
        assert_eq!(installed, root.path().join("26.10.21").join("xray"));
        assert_eq!(fs::read(&installed).unwrap(), b"binary");
        assert_eq!(
            fs::metadata(&installed).unwrap().permissions().mode() & 0o777,
            0o755
        );
        let leftovers: Vec<_> = fs::read_dir(root.path().join("26.10.21"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from("xray")]);

        install_binary(root.path(), "26.10.21", b"replacement").unwrap();
        assert_eq!(fs::read(&installed).unwrap(), b"replacement");
    }

    #[test]
    fn a_core_running_the_tunnel_is_not_removed() {
        let root = tempfile::tempdir().unwrap();
        let store = CoreStore::new(root.path().to_path_buf(), 1000);
        let installed = install_binary(root.path(), "26.10.21", b"binary").unwrap();

        assert!(store.remove("26.10.21", Some(&installed)).is_err());
        assert!(installed.exists());
        store
            .remove("26.10.21", Some(Path::new("/usr/libexec/varmlen/xray")))
            .unwrap();
        assert!(!installed.exists());
        store.remove("26.10.21", None).unwrap();
        assert!(store.remove("../etc", None).is_err());
    }

    #[test]
    fn unknown_tags_are_reported_as_not_installed() {
        let root = tempfile::tempdir().unwrap();
        let store = CoreStore::new(root.path().to_path_buf(), 1000);
        let error = store.resolve("26.10.21").unwrap_err();
        assert_eq!(error.code, DaemonErrorCode::XrayUnavailable);
        assert_eq!(
            store.resolve("../../usr/bin").unwrap_err().code,
            DaemonErrorCode::InvalidRequest
        );
    }

    /// Reaches GitHub: `cargo test -p varmlend -- --ignored published_digests`.
    #[tokio::test]
    #[ignore]
    async fn published_digests_are_found_for_new_and_old_releases() {
        assert_eq!(
            fetch_release_digest("26.10.21", "Xray-linux-64.zip")
                .await
                .unwrap(),
            "0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978"
        );
        let old = fetch_release_digest("1.8.4", "Xray-linux-64.zip")
            .await
            .unwrap();
        assert!(is_sha256_hex(&old));
    }

    /// Reaches GitHub: `cargo test -p varmlend -- --ignored real_release`.
    #[tokio::test]
    #[ignore]
    async fn a_real_release_installs_and_a_tampered_one_does_not() {
        let Some(asset) = host_xray_asset_name() else {
            return;
        };
        let archive = download(&format!(
            "https://github.com/{XRAY_REPOSITORY}/releases/download/v26.10.21/{asset}"
        ))
        .await;
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = home.path().join("xray.zip");
        let store = CoreStore::new(root.path().to_path_buf(), unsafe { libc::getuid() });
        let request = CoreInstallRequest {
            tag: "26.10.21".into(),
            archive: path.to_str().unwrap().into(),
        };

        let mut tampered = archive.clone();
        *tampered.last_mut().unwrap() ^= 1;
        fs::write(&path, &tampered).unwrap();
        let error = store.install(&request).await.unwrap_err();
        assert!(error.message.contains("checksum"), "{}", error.message);
        assert!(!root.path().join("26.10.21").exists());

        fs::write(&path, &archive).unwrap();
        store.install(&request).await.unwrap();
        let installed = root.path().join("26.10.21").join("xray");
        assert_eq!(
            binary_version(&installed).await.as_deref(),
            Some("26.10.21")
        );

        // The archive must be the release the tag names.
        let request = CoreInstallRequest {
            tag: "26.9.30".into(),
            ..request
        };
        assert!(store.install(&request).await.is_err());
        assert!(!root.path().join("26.9.30").exists());
    }

    async fn download(url: &str) -> Vec<u8> {
        reqwest::get(url)
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .to_vec()
    }

    #[test]
    fn xray_reports_its_version_on_the_first_line() {
        assert_eq!(
            parse_version_line(
                "Xray 26.10.21 (Xray, Penetrates Everything.) 0eec3ed\nA unified platform"
            )
            .as_deref(),
            Some("26.10.21")
        );
        assert_eq!(parse_version_line(""), None);
    }
}
