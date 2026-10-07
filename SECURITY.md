# Security

## Reporting a vulnerability

Please report suspected vulnerabilities privately by email to
<daniel.morgan@college-de-france.fr>. Do not open a public issue for
security problems. You should normally receive a reply within a week.

## Release integrity

Every release asset can be verified in the following ways.

### macOS packages

The `.pkg` installers (and the apps inside the `.zip` archives) are signed
with an Apple Developer ID certificate and notarized by Apple. Gatekeeper
verifies both automatically on install. To check manually:

    pkgutil --check-signature <package>.pkg
    spctl --assess -vv --type install <package>.pkg

### Linux packages

The apt repository is signed; apt verifies every download against the
archive key (`grognard-archive-key.asc`, attached to each release),
which is the CI signing subkey of the release key listed below. The
standalone `.deb` and `.flatpak` files are covered by the checksums and
attestations below.

### Build provenance (all assets)

Every release asset, including `SHA256SUMS`, carries a GitHub build
provenance attestation binding it to the exact commit and workflow run that
produced it. Verify with the [GitHub CLI](https://cli.github.com/):

    gh attestation verify <file> --repo grognard-xml/grognard

### Checksums

`SHA256SUMS`, attached to each release, contains SHA-256 digests of all
release assets:

    sha256sum --check --ignore-missing SHA256SUMS

### Windows

Starting with v0.1.1-beta.5, the Windows installers (`Grognard-win-Setup-*.exe`)
are Authenticode-signed with SHA-256 and carry an RFC 3161 timestamp from
Certum. The publisher shown by Windows is the signing certificate's subject,
"Open Source Developer Daniel Patrick Morgan". Check the signature in the
file's Properties → Digital Signatures tab, or on Windows with
`Get-AuthenticodeSignature <file>`.

The signing happens after the CI build, on the maintainer's machine, so the
build provenance attestation (above) for these `.exe` files covers the
unsigned CI build rather than the signed file you download. The `SHA256SUMS`
digests match the signed files. Earlier releases are unsigned. This is an
individual-validation certificate, so SmartScreen may still warn until the
publisher builds reputation. Signed MSIX packages distributed through the
Microsoft Store are planned.

## Signing keys

Grognard releases are covered by the same release-signing key as
marinaMoji, published in the marinaMoji repository
(`marinaMoji-release-public-key.asc`).

Primary key fingerprint (certification only; kept offline):

    5469 4B5D D8C8 DBEA 7DFE  F8F1 E40E 872A F7D7 CFEB

Subkeys:

- `35CC 9C65 3654 3F50 5825  2DDC FCDA 39EE 2E22 A192` — maintainer signing
  subkey, kept offline. Used for signatures made outside CI, such as
  security notices or key-rotation statements.
- `A1DF B08F D78B 8A8F 941E  AD5F E4A4 FB8B 462A 09F5` — CI signing subkey,
  held by GitHub Actions. Signs the apt repository metadata; it does not
  sign release assets.

Release assets are authenticated by notarization and build provenance
attestations (above), not by detached GPG signatures. Subkey expiries are
extended in place; re-fetch the archive key if apt reports an expired key.
