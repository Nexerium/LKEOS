if (location.origin !== "https://e-learning.bmstu.ru" || !location.pathname.startsWith("/kaluga/")) throw Error("Сессия ЭОС закрыта.");
const store = window.lkeosUpload;
if (action === "reset") { window.lkeosUpload={id,files:new Map()};return true; }
if (!store || store.id !== id) throw Error("Откройте редактор ответа заново.");
if (action === "attach") {
  const input=document.getElementById("campus-local-lab-files");
  const transfer=new DataTransfer();
  for (const key of keys) {
    const f=store.files.get(key);
    if (!f) throw Error("Выберите файлы заново.");
    transfer.items.add(f);
  }
  input.files=transfer.files;
  return true;
}
if (action === "cancel") { store.cancel?.(); return true; }
const sheet=document.createElement("dialog");
sheet.style.cssText="position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;box-sizing:border-box;border:0;margin:0;background:Canvas;color:CanvasText;padding:28px 20px;font:17px -apple-system,sans-serif;color-scheme:light dark";
const title=document.createElement("h2"); title.textContent="Файлы ответа"; title.style.fontSize="23px";
const label=document.createElement("label");label.textContent="Выбрать на iPhone"; label.style.cssText="display:block;position:relative;padding:16px;border-radius:12px;background:#245bbb;color:#fff;text-align:center";
const input=document.createElement("input");input.type="file";input.multiple=true;input.style.cssText="position:absolute;inset:0;width:100%;height:100%;opacity:0";
label.append(input);sheet.append(title,label);document.body.append(sheet);sheet.showModal();
return await new Promise(resolve=>{
  const finish=items=>{store.cancel=null;sheet.remove();resolve(items)};
  store.cancel=()=>finish([]);
  input.addEventListener("cancel",store.cancel,{once:true});
  input.addEventListener("change",()=>{
    const items=Array.from(input.files || [],f=>{
      const key=crypto.randomUUID(); store.files.set(key,f);return {name:f.name,key,size:f.size};
    });
    finish(items);
  },{once:true});
});
