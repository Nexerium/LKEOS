// Each request runs in the corresponding service's existing WebKit store.
const eos = service === "eos";
if (location.hostname === "sso.bmstu.ru") return "expired";
if (location.origin !== (eos ? "https://e-learning.bmstu.ru" : "https://lks.bmstu.ru")) return "unknown";
try {
  const response = await fetch(eos ? "/kaluga/my/" : "/lks-back/api/v1/person", {
    credentials:"same-origin", mode:"no-cors", cache:"no-store", signal:AbortSignal.timeout(6000)
  });
  if (response.status===401 || response.type==="opaque" ||
      /\/kaluga\/(?:login|auth)\/|\/portal4\/cookie\/login/.test(new URL(response.url).pathname)) return "expired";
  if (!response.ok) return "unknown";
  if (!eos) return (await response.json())?.data ? "active" : "unknown";
  const doc=new DOMParser().parseFromString(await response.text(),"text/html");
  if (doc.body.classList.contains("notloggedin") || doc.querySelector("form#login")) return "expired";
  return doc.querySelector("#user-menu-toggle,.usermenu") ? "active" : "unknown";
} catch { return "unknown"; }
