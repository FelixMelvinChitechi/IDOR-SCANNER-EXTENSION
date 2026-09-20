// background.js
// Responsible for:
//  1. Managing the declarativeNetRequest session rule that overrides the
//     Cookie / Authorization headers for "Session B" during Auth-Diff scans.
//  2. Never touching the user's real browser cookies — this only rewrites
//     headers on outgoing requests that match the authorized target origin,
//     and only while a scan is actively running.

const SESSION_B_RULE_ID = 9001;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SET_SESSION_B_RULE") {
    setSessionBRule(msg.originPattern, msg.cookieValue, msg.authValue)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }

  if (msg.type === "CLEAR_SESSION_B_RULE") {
    clearSessionBRule()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function setSessionBRule(originPattern, cookieValue, authValue) {
  await clearSessionBRule();

  const requestHeaders = [];
  if (cookieValue) {
    requestHeaders.push({ header: "Cookie", operation: "set", value: cookieValue });
  }
  if (authValue) {
    requestHeaders.push({ header: "Authorization", operation: "set", value: authValue });
  }
  if (requestHeaders.length === 0) return;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [SESSION_B_RULE_ID],
    addRules: [
      {
        id: SESSION_B_RULE_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders },
        condition: {
          urlFilter: originPattern,
          resourceTypes: ["xmlhttprequest", "sub_frame", "main_frame"],
        },
      },
    ],
  });
}

async function clearSessionBRule() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [SESSION_B_RULE_ID],
    addRules: [],
  });
}
