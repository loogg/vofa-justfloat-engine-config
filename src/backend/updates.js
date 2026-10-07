'use strict';
const https = require('node:https');
const GITHUB_REPO = 'loogg/vofa-justfloat-engine-config';
const packageJson = require('../../package.json');
const currentVersion = packageJson.version;
function isSafeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return url.hostname === 'www.vofa.plus' || (url.hostname === 'github.com'
      && (url.pathname === `/${GITHUB_REPO}` || url.pathname.startsWith(`/${GITHUB_REPO}/`)));
  } catch (_error) { return false; }
}

function compareSemver(left, right) {
  const parse = (v) => String(v).replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(left);
  const [rMaj = 0, rMin = 0, rPat = 0] = parse(right);
  if (lMaj !== rMaj) return lMaj > rMaj ? 1 : -1;
  if (lMin !== rMin) return lMin > rMin ? 1 : -1;
  if (lPat !== rPat) return lPat > rPat ? 1 : -1;
  return 0;
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': `vofa-justfloat-engine-config/${currentVersion}`,
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function queryGitHubRelease() {
  const defaultReleasesUrl = `https://github.com/${GITHUB_REPO}/releases`;
  const latestReleaseUrl = `https://github.com/${GITHUB_REPO}/releases/latest`;

  // Strategy 1: GitHub Releases API
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const res = await fetchJson(apiUrl);
    if (res.statusCode === 200) {
      const release = JSON.parse(res.body);
      const tagName = release.tag_name || '';
      const versionString = tagName.replace(/^v/, '');
      const hasUpdate = compareSemver(versionString, currentVersion) > 0;
      return {
        success: true,
        currentVersion,
        latestVersion: versionString,
        hasUpdate,
        releaseUrl: release.html_url || latestReleaseUrl,
        releaseName: release.name || tagName,
        publishedAt: release.published_at || '',
        notes: release.body || '',
        assets: Array.isArray(release.assets) ? release.assets.map((a) => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url
        })) : []
      };
    }
  } catch (_error) {
    // API failed or rate limited, proceed to fallback
  }

  // Strategy 2: Probe 302 redirect of https://github.com/.../releases/latest
  try {
    const redirectRes = await new Promise((resolve, reject) => {
      const req = https.request(latestReleaseUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': `vofa-justfloat-engine-config/${currentVersion}`
        },
        timeout: 8000
      }, (res) => {
        resolve({ statusCode: res.statusCode, headers: res.headers });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Redirect check timed out'));
      });
      req.end();
    });

    const location = redirectRes.headers.location;
    if (location) {
      const match = location.match(/\/tag\/v?(\d+\.\d+\.\d+)/);
      if (match) {
        const latestVersion = match[1];
        const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
        return {
          success: true,
          currentVersion,
          latestVersion,
          hasUpdate,
          releaseUrl: location,
          releaseName: `v${latestVersion}`,
          publishedAt: '',
          notes: '',
          assets: []
        };
      }
    }
  } catch (_error) {
    // Fallback also failed
  }

  return {
    success: false,
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    releaseUrl: defaultReleasesUrl,
    error: '无法连接到 GitHub 或网络异常，请直接在浏览器中查看最新发布。'
  };
}


module.exports = { queryGitHubRelease, isSafeExternalUrl };
