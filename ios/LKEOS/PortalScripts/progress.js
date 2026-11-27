(() => {
  if (window !== top || location.origin !== "https://lks.bmstu.ru") return;
  const send = data => window.webkit.messageHandlers.progress.postMessage(data);
  const route = value => {
    try {
      const url = new URL(value,location.href);
      if (url.origin !== location.origin) return "";
      if (/^\/lks-back\/api\/v1\/student\/[^/]+\/progress\/?$/.test(url.pathname)) return "grades";
      if (url.pathname === "/lks-back/api/v1/person") return "person";
    } catch {}
    return "";
  };
  function read(kind, status, payload) {
    if (!kind) return;
    if (status === 401 || status === 403) { send({type:"expired"}); return; }
    if (kind !== "grades") return;
    if (status !== 200 || !payload || !("data" in payload)) { send({type:"error"}); return; }
    const data = payload.data;
    const disciplines = !data || !Object.keys(data).length ? [] : data.student?.disciplines;
    if (!Array.isArray(disciplines)) { send({type:"error"}); return; }
    send({type:"result", disciplines, date:payload.date || ""});
  }
  const fetchPage = window.fetch;
  window.fetch = async function(...args) {
    const response = await fetchPage.apply(this,args);
    const kind = route(response.url);
    if (kind) {
      if (kind === "grades" && response.ok) response.clone().json().then(p=>read(kind,response.status,p),()=>read(kind,response.status,null));
      else read(kind,response.status,null);
    }
    return response;
  };
  const sendRequest = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", () => {
      const kind = route(this.responseURL);
      if (!kind) return;
      let value;
      if (kind === "grades" && this.status === 200) {
        try { value = this.responseType === "json" ? this.response : JSON.parse(this.responseText); } catch {}
      }
      read(kind,this.status,value);
    }, {once:true});
    return sendRequest.apply(this,args);
  };
})();
