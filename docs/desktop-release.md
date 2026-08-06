# Building the desktop app for release

The rule that shapes everything here: **Tauri does not cross-compile.** A
Linux machine produces the Linux bundles, a Mac the macOS ones, a Windows
machine the Windows ones. Each platform builds against its own webview and
its own bundler tooling, so "release for all three" means three builds — done
by hand on three machines, or by CI (last section).

The command is the same everywhere:

```bash
npm run app:build
```

That runs `npm run build` first (the `beforeBuildCommand` in
`src-tauri/tauri.conf.json`), compiles the Rust shell in release mode, and
writes installers to `src-tauri/target/release/bundle/`. Version and bundle
identifier both live in `tauri.conf.json`; bump `version` there before
tagging a release — it is what the installers and the app's metadata carry.

Every platform needs Node and a Rust toolchain via [rustup](https://rustup.rs).
The Tauri CLI is a pinned devDependency, so `npm install` brings it.

## Linux

Build deps (Arch): `webkit2gtk-4.1`, `gtk3`, `librsvg`, plus `base-devel`.
Debian/Ubuntu equivalents: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`librsvg2-dev`, `build-essential`.

Outputs: `.deb`, `.rpm`, and an AppImage. The AppImage tooling (linuxdeploy)
is downloaded by the bundler on first use, so the first build wants network.

```
npm run app:build -- --no-bundle    # compiles the binary, skips deb/rpm/AppImage
```

On a rolling-release distro (Arch) the AppImage step needs one env var:

```bash
NO_STRIP=true npm run app:build
```

linuxdeploy bundles its own old binutils, whose `strip` does not understand
the `.relr.dyn` sections a modern toolchain emits — every library fails with
"unknown type [0x13]" and the bundle aborts. `NO_STRIP` skips the stripping;
the AppImage is a little larger and works.

Two more Linux notes: the standalone binary is
`src-tauri/target/release/jaima` — the frontend is embedded at compile time,
so it runs from anywhere but shows the site as of its build. And bundling
*patches that binary in place*, so a build fails with `Text file busy` while
a copy of it is running. Close the app first.

One caveat worth knowing: the AppImage bakes in the system webview *libraries*
but still runs against the user's WebKitGTK at runtime — a distro with an
ancient webkit2gtk renders with that ancient engine. The `.deb`/`.rpm` declare
it as a dependency instead, which is the honest arrangement.

Video needs more than the webview: WebKitGTK plays media through the system's
GStreamer, and YouTube (the arati) wants `gst-plugins-bad` (MSE/adaptive
streaming) and `gst-libav` (H.264/AAC decode) on top of the usual base/good.
Without them the embed loads and then says "Your browser can't play this
video." Arch: `pacman -S gst-plugins-bad gst-libav`; Debian/Ubuntu:
`gstreamer1.0-plugins-bad gstreamer1.0-libav`. The bundles do not declare
these as hard dependencies — the whole altar minus one video is the wrong
thing to refuse to install over — so it stays a note here and would belong in
release notes for Linux users.

The window is frameless here (`tauri.linux.conf.json`); macOS and Windows get
the base config's decorated window. Note the merge semantics if you touch it:
platform files are JSON-merged over `tauri.conf.json` and arrays are replaced
whole, so the Linux file must carry the entire window object, not just
`decorations`.

## macOS

Xcode Command Line Tools (`xcode-select --install`) and nothing else. A plain
`npm run app:build` produces a `.app` and a `.dmg` for the architecture of the
machine building it. For one artifact that runs on both Apple Silicon and
Intel, install both targets and ask for a universal binary:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run app:build -- --target universal-apple-darwin
```

Signing and notarization hook in through environment variables
(`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_TEAM_ID` and friends — see Tauri's
macOS signing docs); with them set, the build signs and notarizes as part of
bundling. Without them it still builds, and Gatekeeper complains on other
people's machines.

To sign by hand instead, build only the `.app` — Tauri's `.dmg` is assembled
from the unsigned app, so it would have to be discarded anyway:

```bash
npm run app:build -- --bundles app
```

Then codesign the `.app` in `target/release/bundle/macos/`, package it
yourself, and notarize. (On Apple Silicon the freshly built app carries the
linker's ad-hoc signature; `codesign --force` replaces it.)

## Windows

Visual Studio Build Tools with the C++ workload (the MSVC linker — Rust on
Windows needs it regardless of Tauri). The app renders in **WebView2**, which
ships with Windows 11 and any updated Windows 10; the generated installers
bootstrap it on machines that lack it, so there is nothing to bundle.

Outputs: an `.msi` (WiX) and an NSIS `.exe` installer. Either alone is fine to
ship; the `.exe` is the friendlier default for direct download.

## All three from one push (CI)

The practical way to cut a release without owning three machines:
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) on a
GitHub Actions matrix. It builds on each OS runner and attaches every bundle
to one draft release. This stays a **separate workflow** from
`deploy.yml` — the site deploys on every push, the app builds on a tag.

```yaml
name: app
on:
  push:
    tags: ['app-v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-22.04
          - os: windows-latest
          - os: macos-latest
            args: --target universal-apple-darwin
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: dtolnay/rust-toolchain@stable
      - if: matrix.os == 'macos-latest'
        run: rustup target add aarch64-apple-darwin x86_64-apple-darwin
      - if: matrix.os == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS signing/notarization env vars go here
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'ജയ്മാ ${{ github.ref_name }}'
          releaseDraft: true
          args: ${{ matrix.args }}
```

The macOS signing secrets go into the repo's Actions secrets and through to
that `env:` block; unsigned CI builds of the other two platforms work as-is.

## Why the app serves itself on localhost

The window loads `http://localhost:43823`, served from inside the app by
`tauri-plugin-localhost` — the assets are still embedded in the binary; only
the origin changes. This is not optional plumbing: Tauri's native origin is a
custom scheme (`tauri://localhost`), the webviews send no `Referer` header
from non-http(s) schemes, and YouTube now refuses embeds without one — the
arati player dies with error 153. A real http origin restores the referer.

The port is fixed so the window URL can live declaratively in the configs,
and it appears in **three places that must agree**: `PORT` in
`src-tauri/src/lib.rs`, and the window `url` in `tauri.conf.json` *and*
`tauri.linux.conf.json` (the platform file repeats the whole window object —
see above). The cost of the arrangement is that any local process can read
the site off that port, which for a static devotional site is nothing.

## The icons

`src-tauri/icons/` is generated, but tracked — it is an input to the build,
not an output of it. To change the icon, start from a square image and let the
CLI cut every size and format:

```bash
npx tauri icon path/to/square.png
```

The current set is `static/images/photos/her-feet2.jpg`, centre-cropped.
