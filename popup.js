// popup.js
// Orchestrates scans. Actual HTTP requests are executed inside the target
// tab's own page context via chrome.scripting.executeScript, so requests are
// same-origin from the page's point of view (avoids CORS issues and mirrors
// how the browser would normally make them).

let lastResults = [];
let currentMode = "enum";
let grantedOriginPattern = null;

const logsDiv = document.getElementById("logs");
const startBtn = document.getElementById("startScan");
const stopBtn = document.getElementById("stopScan");
const consentBox = document.getElementById("consentBox");
const scopeStatus = document.getElementById("scopeStatus");

function log(line) {
  logsDiv.textContent += (logsDiv.textContent ? "\n" : "") + line;
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

function toOriginPattern(originStr) {
  try {
    const u = new URL(originStr);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

function updateStartEnabled() {
  startBtn.disabled = !(grantedOriginPattern && consentBox.checked);
}
consentBox.addEventListener("change", updateStartEnabled);

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".mode-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    document.getElementById(`panel-${currentMode}`).classList.add("active");
  });
});

document.getElementById("authorizeBtn").addEventListener("click", async () => {
  const originStr = document.getElementById("targetOrigin").value.trim();
  const pattern = toOriginPattern(originStr);
  if (!pattern) {
    scopeStatus.textContent = "Enter a valid origin, e.g. https://example.com";
    scopeStatus.className = "sub status-bad";
    return;
  }
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (granted) {
    grantedOriginPattern = pattern;
    scopeStatus.textContent = `Permission granted for ${pattern}`;
    scopeStatus.className = "sub status-ok";
  } else {
    grantedOriginPattern = null;
    scopeStatus.textContent = "Permission denied.";
    scopeStatus.className = "sub status-bad";
  }
  updateStartEnabled();
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ---- Function injected into the page context. Must be self-contained. ----
async function pageFetchLoop(urls, delayMs) {
  const out = [];
  for (const { id, url } of urls) {
    try {
      const res = await fetch(url, { method: "GET", credentials: "include" });
      const text = await res.text();
      out.push({ id, url, status: res.status, length: text.length, snippet: text.slice(0, 200) });
    } catch (err) {
      out.push({ id, url, status: 0, length: 0, snippet: `ERROR: ${err.message}` });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

function buildUrls(pattern, start, end) {
  const urls = [];
  for (let id = start; id <= end; id++) {
    urls.push({ id, url: pattern.replace("{{ID}}", id) });
  }
  return urls;
}

function similarity(aLen, bLen) {
  if (aLen === 0 && bLen === 0) return 1;
  const max = Math.max(aLen, bLen);
  const diff = Math.abs(aLen - bLen);
  return max === 0 ? 1 : 1 - diff / max;
}

async function runEnumeration() {
  const pattern = document.getElementById("urlPatternEnum").value.trim();
  const start = parseInt(document.getElementById("startId").value, 10);
  const end = parseInt(document.getElementById("endId").value, 10);
  const baselineId = parseInt(document.getElementById("baselineId").value, 10);
  const delayMs = parseInt(document.getElementById("delayEnum").value, 10) || 0;

  const tab = await getActiveTab();
  log(`[*] Fetching baseline (known-invalid ID ${baselineId})...`);

  const [baselineRes] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageFetchLoop,
    args: [[{ id: baselineId, url: pattern.replace("{{ID}}", baselineId) }], delayMs],
  });
  const baseline = baselineRes.result[0];
  log(`[*] Baseline: status ${baseline.status}, length ${baseline.length}`);

  log(`[*] Scanning IDs ${start}..${end}...`);
  const urls = buildUrls(pattern, start, end);
  const [scanRes] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageFetchLoop,
    args: [urls, delayMs],
  });

  lastResults = scanRes.result.map((r) => {
    const sim = similarity(baseline.length, r.length);
    let verdict = "similar-to-baseline";
    if (r.status === 200 && sim < 0.85) verdict = "ANOMALY (differs from baseline) — review";
    else if (r.status !== 200) verdict = `non-200 (${r.status})`;
    return { ...r, baselineStatus: baseline.status, baselineLength: baseline.length, verdict };
  });

  logsDiv.textContent = "";
  for (const r of lastResults) {
    log(`ID ${r.id} -> status ${r.status}, len ${r.length} :: ${r.verdict}`);
  }
  log(`\n[+] Done. ${lastResults.filter((r) => r.verdict.startsWith("ANOMALY")).length} anomalies flagged for manual review.`);
}

async function runAuthDiff() {
  const pattern = document.getElementById("urlPatternDiff").value.trim();
  const start = parseInt(document.getElementById("startIdDiff").value, 10);
  const end = parseInt(document.getElementById("endIdDiff").value, 10);
  const cookieB = document.getElementById("sessionBCookie").value.trim();
  const authB = document.getElementById("sessionBAuth").value.trim();
  const delayMs = parseInt(document.getElementById("delayDiff").value, 10) || 0;

  if (!cookieB && !authB) {
    log("[!] Provide a Session B cookie string and/or Authorization header.");
    return;
  }

  const tab = await getActiveTab();
  const urls = buildUrls(pattern, start, end);

  log(`[*] Step 1/3 — requesting as Session A (your current session)...`);
  const [resA] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageFetchLoop,
    args: [urls, delayMs],
  });

  log(`[*] Step 2/3 — activating Session B header override for this scope only...`);
  await chrome.runtime.sendMessage({
    type: "SET_SESSION_B_RULE",
    originPattern: grantedOriginPattern,
    cookieValue: cookieB || null,
    authValue: authB || null,
  });

  let resB;
  try {
    [resB] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFetchLoop,
      args: [urls, delayMs],
    });
  } finally {
    log(`[*] Step 3/3 — clearing Session B header override...`);
    await chrome.runtime.sendMessage({ type: "CLEAR_SESSION_B_RULE" });
  }

  const a = resA.result;
  const b = resB.result;
  logsDiv.textContent = "";
  lastResults = a.map((ra, i) => {
    const rb = b[i];
    const sim = similarity(ra.length, rb.length);
    let verdict = "Enforced";
    if ([401, 403].includes(rb.status) || rb.status >= 300 && rb.status < 400) {
      verdict = "Enforced (access denied/redirected)";
    } else if (rb.status === 200 && sim >= 0.85) {
      verdict = "POTENTIAL IDOR — Session B got a near-identical response ⚠️";
    } else if (rb.status === 200) {
      verdict = "200 but content differs — needs manual review";
    }
    return {
      id: ra.id,
      url: ra.url,
      statusA: ra.status,
      lengthA: ra.length,
      statusB: rb.status,
      lengthB: rb.length,
      similarity: sim.toFixed(2),
      verdict,
    };
  });

  for (const r of lastResults) {
    log(`ID ${r.id} :: A=${r.statusA}/${r.lengthA}  B=${r.statusB}/${r.lengthB}  sim=${r.similarity} :: ${r.verdict}`);
  }
  const flagged = lastResults.filter((r) => r.verdict.startsWith("POTENTIAL")).length;
  log(`\n[+] Done. ${flagged} potential IDOR(s) flagged for manual verification.`);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  stopBtn.style.display = "block";
  logsDiv.textContent = "";
  try {
    if (currentMode === "enum") await runEnumeration();
    else await runAuthDiff();
  } catch (err) {
    log(`[ERROR] ${err.message}`);
  } finally {
    stopBtn.style.display = "none";
    updateStartEnabled();
  }
});

stopBtn.addEventListener("click", async () => {
  // Best-effort: clear any active header override immediately.
  await chrome.runtime.sendMessage({ type: "CLEAR_SESSION_B_RULE" });
  log("[!] Stop requested — in-flight requests will finish, no new ones will be scored.");
});

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("exportCsv").addEventListener("click", () => {
  if (!lastResults.length) return log("[!] No results to export yet.");
  download("idor-scan-results.csv", toCSV(lastResults), "text/csv");
});

document.getElementById("exportJson").addEventListener("click", () => {
  if (!lastResults.length) return log("[!] No results to export yet.");
  download("idor-scan-results.json", JSON.stringify(lastResults, null, 2), "application/json");
});
