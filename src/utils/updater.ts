import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import type { UpdateChannel } from "../api";

const REPO_OWNER = "InvectedGaming";
const REPO_NAME = "chimaera-files";

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string | null;
  prerelease: boolean;
  assets: GithubAsset[];
  html_url: string;
}

/** Resolve the GitHub API endpoint for a channel.
 *
 *    stable → /releases/latest  (GitHub skips prereleases automatically)
 *    beta   → /releases/tags/beta
 *    dev    → /releases/tags/dev
 *
 *  CI is expected to move the `beta` / `dev` tags forward with each build. */
function channelApiUrl(channel: UpdateChannel): string {
  const base = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
  if (channel === "stable") return `${base}/latest`;
  return `${base}/tags/${channel}`;
}

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  notes?: string;
  downloadUrl?: string;
  installerName?: string;
  releaseUrl?: string;
}

/** Naïve semver-ish comparison that tolerates a leading `v` and a `-suffix`.
 *  Returns true if `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [aM, am, ap] = [...norm(a), 0, 0, 0];
  const [bM, bm, bp] = [...norm(b), 0, 0, 0];
  if (aM !== bM) return aM > bM;
  if (am !== bm) return am > bm;
  return ap > bp;
}

export async function checkForUpdate(
  channel: UpdateChannel,
): Promise<UpdateCheckResult> {
  const currentVersion = await getVersion();

  const res = await fetch(channelApiUrl(channel), {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    // 404 on a channel tag just means no build published yet — treat as
    // "up to date" rather than surfacing a scary error.
    if (res.status === 404) {
      return { available: false, currentVersion };
    }
    throw new Error(`GitHub API returned ${res.status}`);
  }
  const release: GithubRelease = await res.json();

  if (!isNewer(release.tag_name, currentVersion)) {
    return { available: false, currentVersion };
  }

  // Prefer the NSIS `-setup.exe` asset (our primary installer). Fall back to
  // any `.exe` or `.msi` if the naming ever changes.
  const setup = release.assets.find((a) => /-setup\.exe$/i.test(a.name))
    || release.assets.find((a) => /\.exe$/i.test(a.name))
    || release.assets.find((a) => /\.msi$/i.test(a.name));
  if (!setup) {
    throw new Error("Release has no installer asset");
  }

  return {
    available: true,
    currentVersion,
    newVersion: release.tag_name,
    notes: release.body ?? undefined,
    downloadUrl: setup.browser_download_url,
    installerName: setup.name,
    releaseUrl: release.html_url,
  };
}

/** Download the installer into `%TEMP%` and launch it. The current app
 *  exits right after spawning the installer so the new build can replace
 *  the installed binary. */
export async function installUpdate(result: UpdateCheckResult): Promise<void> {
  if (!result.downloadUrl || !result.installerName) {
    throw new Error("No installer URL to download");
  }
  await invoke("download_and_run_installer", {
    url: result.downloadUrl,
    installerName: result.installerName,
  });
}
