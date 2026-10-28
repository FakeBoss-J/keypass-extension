/**
 * KeyPass 域名提取与比对工具
 */

function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    return raw;
  }
  return 'https://' + raw;
}

function extractHostname(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    let host = (parsed.hostname || '').toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return '';
  }
}

function matchSite(site, pageUrl) {
  if (!site) return 0;
  const pageHost = extractHostname(pageUrl);
  if (!pageHost) return 0;

  const siteHost = extractHostname(site.url);

  if (siteHost) {
    if (pageHost === siteHost) {
      return 100;
    }
    if (pageHost.endsWith('.' + siteHost)) {
      return 80;
    }
    if (siteHost.endsWith('.' + pageHost)) {
      return 60;
    }
  }

  // 站点名称关键字匹配
  if (site.siteName) {
    const cleanName = String(site.siteName).trim().toLowerCase();
    if (cleanName && pageHost.includes(cleanName)) {
      return 40;
    }
  }

  return 0;
}

function rankMatchingSites(sites, pageUrl) {
  if (!Array.isArray(sites) || !pageUrl) return [];

  const matched = [];
  for (const site of sites) {
    const score = matchSite(site, pageUrl);
    if (score > 0) {
      matched.push({
        ...site,
        matchScore: score,
      });
    }
  }

  return matched.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

const KeyPassDomain = {
  extractHostname,
  matchSite,
  rankMatchingSites,
};

(typeof globalThis !== 'undefined' ? globalThis : self).KeyPassDomain = KeyPassDomain;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyPassDomain;
}
