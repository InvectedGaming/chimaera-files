# Auto-updates

Chimaera ships a lightweight update flow that just:

1. Queries the GitHub Releases API for the latest release on the selected channel.
2. Compares versions against the running app.
3. Downloads the installer `.exe` asset to `%TEMP%` via the system `curl.exe`.
4. Spawns it (UAC prompt → user approves → installer runs → app exits).
5. Installer replaces the old binary. Launch manually or let Start Menu shortcut re-open.

**No signing keys, no Tauri updater plugin, no custom manifest file.** The trade-off: Windows SmartScreen is the only integrity gate (unless you later add code signing). Fine for personal use and early distribution.

## How the three channels map to GitHub Releases

| Channel | API endpoint | Expected tag |
|---|---|---|
| `stable` | `/repos/<owner>/<repo>/releases/latest` | semver tags like `v0.2.0` (non-prerelease) |
| `beta`   | `/repos/<owner>/<repo>/releases/tags/beta` | the literal tag `beta`, moved forward each build |
| `dev`    | `/repos/<owner>/<repo>/releases/tags/dev`  | the literal tag `dev`, moved forward each build |

The constants to edit if/when you fork or rename the repo live in
[`src/utils/updater.ts`](src/utils/updater.ts):

```ts
const REPO_OWNER = "InvectedGaming";
const REPO_NAME = "chimaera-files";
```

## What each release needs to contain

Each GitHub Release in any channel must have an installer asset whose filename ends in `-setup.exe` (or just `.exe` / `.msi` as fallback). The frontend picks it up by name — everything else in the release is ignored.

The NSIS bundler produces this automatically: `bun run tauri build` → `target/release/bundle/nsis/Chimaera Files_0.1.0_x64-setup.exe` (workspace target dir, at repo root — not under `src-tauri/`).

## Publishing a release

### Manual (good enough to start)

1. `bun run tauri build`
2. In GitHub, Draft a new release. Tag = `v0.2.0` (stable), `beta`, or `dev`.
3. Drag the `-setup.exe` into the "Attach binaries" box.
4. Publish.

### Automated via GitHub Actions

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ["v*"]              # stable channel
    branches: [beta, dev]      # beta/dev channels

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - uses: dtolnay/rust-toolchain@stable
      - run: bun install
      - run: bun run tauri build

      # Find the installer asset.
      - id: find
        shell: pwsh
        run: |
          $exe = Get-ChildItem target/release/bundle/nsis/*-setup.exe | Select-Object -First 1
          echo "path=$($exe.FullName)" >> $env:GITHUB_OUTPUT

      # Tag handling: semver tag → new stable Release; branch push →
      # move the fixed `beta` or `dev` tag to HEAD.
      - name: Move channel tag (beta/dev only)
        if: github.ref_type == 'branch'
        run: |
          git tag -f ${{ github.ref_name }} ${{ github.sha }}
          git push -f origin ${{ github.ref_name }}

      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_type == 'tag' && github.ref_name || github.ref_name }}
          files: ${{ steps.find.outputs.path }}
          prerelease: ${{ github.ref_name != github.event.repository.default_branch && startsWith(github.ref_name, 'v') == false }}
          make_latest: ${{ github.ref_type == 'tag' && startsWith(github.ref_name, 'v') }}
```

Workflow behavior:
- **Push tag `v0.2.0`** → builds → uploads to a new Release → marked as `latest`. Stable channel users pick it up.
- **Push to `beta` branch** → builds → force-moves the `beta` tag → uploads to the `beta` Release. Beta channel users pick it up.
- **Push to `dev` branch** → same as beta with `dev` tag.

No secrets required (public repos). For private repos add a `GITHUB_TOKEN` step.

## Version comparison

[`src/utils/updater.ts:isNewer`](src/utils/updater.ts) does a simple numeric compare on `major.minor.patch`, ignoring any `-suffix`. Good enough for semver-ish tags. If you ever break semver convention (e.g. date-based tags), rewrite that function.

## Security caveats

Without code signing or a signature manifest:

- Windows SmartScreen shows a "Publisher unknown" warning on every install. Users click "Run anyway."
- A MITM who can swap a GitHub release asset could push malware. (Practically: GitHub is HTTPS-only and requires auth to edit releases, so this requires GitHub account takeover — low risk.)
- No protection against a malicious build from the CI itself if someone compromises the Actions workflow.

If you reach a point where those risks matter, add:

1. **Authenticode code signing** — buy a cert (~$100/yr, e.g. SSL.com EV), sign the `-setup.exe` in CI. SmartScreen warning goes away after some reputation builds.
2. **Tauri updater plugin** — signed-manifest approach (more complex, needs its own signing keys separate from Authenticode).

Both are reasonable next steps. For now, ship.
