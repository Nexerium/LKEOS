  const labPath = "mod/assign/view.php";
  const labInput = "campus-local-lab-files";
  const labError = message => Object.assign(new Error(message), { labMessage: true });
  const basename = value => {
    try { return decodeURIComponent(value.slice(value.lastIndexOf("/") + 1)); }
    catch { return value; }
  };
  const labRoute = (id, action) => labPath + "?id=" + id + (action ? "&action=" + action : "");
  const labId = value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw labError("Не найден номер лабораторной.");
    return id;
  };

  function labLinks(root, match) {
    const result = new Map();
    for (const anchor of root.querySelectorAll('a[href*="pluginfile.php"]')) {
      const url = localLink(anchor.getAttribute("href"), site + labPath);
      if (!url || !match.test(url.pathname + url.search)) continue;
      const name = basename(url.pathname) || read(anchor);
      if (name) result.set(url.href, { name, url: url.href });
    }
    return [...result.values()];
  }

  function labDetails(doc, id) {
    const region = doc.querySelector("#region-main, main, [role=main]");
    if (!region || doc.body.classList.contains("notloggedin") || doc.querySelector("#notice .continuebutton, .alert-danger"))
      throw labError("ЭОС не открыла лабораторную. Проверьте доступ к курсу.");

    const fields = [];
    const rows = region.querySelectorAll(".submissionstatustable tr, .feedback tr, .feedbacktable tr");
    for (const row of rows) {
      if (row.cells.length < 2 || row.cells[1].querySelector('a[href*="pluginfile.php"]')) continue;
      const label = read(row.cells[0]);
      const cell = row.cells[1].cloneNode(true);
      cell.querySelectorAll("script,style,template,form,textarea,button,input,[hidden],.accesshide,.sr-only,.visually-hidden,.userinitials,.initials").forEach(node => node.remove());
      if (cell.querySelector(".comment-area,.commentscontainer,.comment-link,[id^=comment-link]") || /комментари.*ответ|submission comments/i.test(label)) {
        const comments = [...cell.querySelectorAll(".comment-content")].map(read)
          .filter(text => text && !/___(?:picture|name|time|content)___/.test(text));
        if (comments.length) fields.push({ label, text: comments.join("\n") });
        continue;
      }
      const text = read(cell);
      if (/___(?:picture|name|time|content)___/.test(text)) continue;
      if (label && text) fields.push({ label, text });
    }
    const acts = new Set();
    for (const control of region.querySelectorAll('input[name="action"], button[name="action"], a[href*="action="]')) {
      const form = control.closest("form");
      if (control.disabled || form?.querySelector('button[type="submit"]:disabled, input[type="submit"]:disabled')) continue;
      const action = control.value || localLink(control.getAttribute("href"), site + labPath)?.searchParams.get("action");
      if (action) acts.add(action);
    }
    const intro = region.querySelector("#intro, .assignment-intro, .activity-description");
    const instructions = intro?.cloneNode(true);
    instructions?.querySelectorAll(".assignintroattachment, a[href*='pluginfile.php']").forEach(node => node.remove());
    const dates = region.querySelector(".activity-dates, [data-region=activity-dates]");
    const dateRows = dates ? Array.from(dates.children, read).filter(Boolean) : [];
    const courseLink = Array.from(doc.querySelectorAll('nav[aria-label] a[href*="/course/view.php"], .breadcrumb a[href*="/course/view.php"]')).at(-1);
    const materials = new Map(labLinks(region, /\/mod_assign\/(?:intro|introattachment)\//i).map(file=>[file.url,file]));
    for (const anchor of intro?.querySelectorAll("a[href]") || []) {
      const link = localLink(anchor.getAttribute("href"), site + labRoute(id));
      if (link && (/\/pluginfile\.php(?:\/|$)/.test(link.pathname) || /\/mod\/(resource|folder|page)\/view\.php$/.test(link.pathname)) && !materials.has(link.href))
        materials.set(link.href,{name:read(anchor) || basename(link.pathname),url:link.href});
    }
    return {
      id, title: read(doc.querySelector("#page-header h1, main h1, h1")) || "Лабораторная работа",
      course: read(courseLink), instructions: read(instructions), dates: dateRows,
      fields, materials: [...materials.values()],
      files: labLinks(region, /\/assignsubmission_file\/submission_files\//i),
      canEdit: acts.has("editsubmission"), canSubmit: acts.has("submit")
    };
  }

  function fileManagerOptions(doc, itemId) {
    const pattern = /M\.form_filemanager\.init\s*\(\s*(?:Y\s*,\s*)?(\{)/g;
    for (const script of doc.scripts) {
      const text = script.textContent;
      for (const match of text.matchAll(pattern)) {
        const start = match.index + match[0].length - 1;
        let braces = 0;
        let quoted = false;
        for (let i = start; i < text.length; i++) {
          const char = text[i];
          if (quoted && char === "\\") { i++; continue; }
          if (char === '"') quoted = !quoted;
          if (quoted) continue;
          if (char === "{") braces++;
          if (char !== "}" || --braces !== 0) continue;
          try {
            const options = JSON.parse(text.slice(start, i + 1));
            if (Number(options.itemid) === itemId) return options;
          } catch { /* Search the next initialization if this one cannot be parsed. */ }
          break;
        }
      }
    }
    throw labError("Не удалось прочитать ограничения файлового поля ЭОС.");
  }

  function editorStatement(form) {
    const input = form.querySelector('input[type=checkbox][name="submissionstatement"]');
    if (!input) return null;
    const label = read(form.querySelector('label[for="' + CSS.escape(input.id) + '"]'));
    return { input, label: label || "Подтверждаю заявление об авторстве работы." };
  }

  async function editor(id) {
    const doc = await page(labRoute(id, "editsubmission"));
    const form = doc.querySelector('input[type=hidden][name="files_filemanager"]')?.closest("form");
    const submit = form?.querySelector("#id_submitbutton");
    if (!form || !submit || submit.disabled)
      throw labError("ЭОС не разрешает редактировать файловый ответ для этой лабораторной.");
    const fields = new FormData(form, submit);
    const itemId = Number(fields.get("files_filemanager"));
    const url = localLink(form.getAttribute("action"), site + labPath);
    if (!url || url.pathname !== "/kaluga/" + labPath || form.method !== "post" ||
        Number(fields.get("id")) !== id || fields.get("action") !== "savesubmission" ||
        !fields.get("sesskey") || itemId <= 0) throw labError("Форма ответа ЭОС изменилась. Файлы не отправлены.");

    const options = fileManagerOptions(doc, itemId);
    const picker = options.filepicker;
    const repo = Object.entries(picker?.repositories ?? {}).find(([, info]) => info.type === "upload");
    const repoId = Number(repo?.[1]?.id ?? repo?.[0]);
    const contextId = Number(picker?.context?.id ?? options.context?.id);
    if (!(repoId > 0) || !(contextId > 0) || !options.client_id)
      throw labError("В этой форме ЭОС не включена загрузка файлов с компьютера.");

    const types = options.accepted_types;
    const accepted = (Array.isArray(types) ? types : [types ?? "*"]).map(String);
    const existing = (options.list ?? []).filter(file => file.type !== "folder")
      .map(file => String(file.filename ?? file.fullname ?? '')).filter(Boolean);
    const statement = editorStatement(form);
    return {
      url, fields, options, itemId, repoId, contextId, accepted, existing, statement,
      limits: {
        maxBytes: Number(options.maxbytes) || 0, maxFiles: Number(options.maxfiles) || 0,
        fileCount: Number(options.filecount) || existing.length, types: accepted,
        statement: statement?.label ?? ""
      }
    };
  }

  async function uploadLabFile(file, edit, replace, signal) {
    const body = new FormData();
    const values = {
      sesskey: edit.fields.get("sesskey"), repo_id: edit.repoId, ctx_id: edit.contextId,
      itemid: edit.itemId, client_id: edit.options.client_id, env: "filemanager", savepath: "/",
      maxbytes: edit.limits.maxBytes, areamaxbytes: Number(edit.options.areamaxbytes) || -1,
      license: edit.options.defaultlicense, author: edit.options.author, overwrite: replace ? 1 : 0
    };
    for (const [key, value] of Object.entries(values)) {
      if (value != null) body.set(key, String(value));
    }
    for (const type of edit.accepted) body.append("accepted_types[]", type);
    body.set("repo_upload_file", file, file.name);
    const response = await fetch(site + "repository/repository_ajax.php?action=upload", {
      method: "POST", body, credentials: "same-origin", mode: "same-origin", redirect: "error", signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error || payload.event === "fileexists" || !payload.file) {
      const reason = clean(payload?.error || (payload?.event === "fileexists" ? "Файл с таким именем уже есть." : ""));
      throw labError(reason || "ЭОС отклонила загрузку файла «" + file.name + "».");
    }
    return String(payload.file);
  }

  function prepareLabUpload() {
    document.getElementById(labInput)?.remove();
    const input = document.createElement("input");
    input.id = labInput;
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    document.body.append(input);
    return true;
  }

  async function saveLab(id) {
    const input = document.getElementById(labInput);
    const files = Array.from(input?.files ?? []);
    input?.remove();
    if (!files.length) throw labError("Выберите файлы для ответа.");

    const edit = await editor(id);
    if (edit.statement) {
      if (!request.statement || request.statementText !== edit.statement.label)
        throw labError("Сначала прочитайте и подтвердите актуальное заявление ЭОС.");
      edit.fields.set(edit.statement.input.name, edit.statement.input.value);
    }
    const keys = files.map(file => file.name.toLowerCase());
    if (new Set(keys).size !== keys.length) throw labError("В списке есть файлы с одинаковыми именами.");
    const replaced = files.filter(file => request.replace && edit.existing.includes(file.name)).length;
    if (!request.replace && files.some(file => edit.existing.includes(file.name)))
      throw labError("Файл с таким именем уже прикреплён. Отметьте замену или выберите другое имя.");
    if (edit.limits.maxFiles > 0 && edit.limits.fileCount + files.length - replaced > edit.limits.maxFiles)
      throw labError("Превышено максимальное число файлов для этой лабораторной.");
    if (edit.limits.maxBytes > 0 && files.some(file => file.size > edit.limits.maxBytes))
      throw labError("Один из файлов превышает лимит размера для этой лабораторной.");

    const names = [];
    const signal = AbortSignal.timeout(15 * 60 * 1000);
    for (const file of files) names.push(await uploadLabFile(file, edit, request.replace && edit.existing.includes(file.name), signal));

    let doc;
    try {
      const response = await fetch(edit.url, {
        method: "POST", body: edit.fields, credentials: "same-origin", mode: "same-origin", signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw labError("ЭОС не приняла форму ответа.");
      const result = new DOMParser().parseFromString(await response.text(), "text/html");
      const validation = read(result.querySelector(".felement .invalid-feedback:not([hidden]), .alert-danger"));
      if (result.querySelector('input[name="files_filemanager"]'))
        throw labError(validation || "ЭОС отклонила сохранение ответа.");
      doc = await page(labRoute(id));
    } catch (error) {
      if (error.labMessage) throw error;
      throw labError("Ответ ЭОС не получен. Обновите состояние работы перед повторной отправкой.");
    }
    const details = labDetails(doc, id);
    if (!names.every(name => details.files.some(file => file.name === name)))
      throw labError("ЭОС не подтвердила все вложения в ответе. Обновите состояние работы перед повтором.");
    return details;
  }

  async function runLabAction() {
    if (request.action === "prepareLabUpload") return { value: prepareLabUpload() };
    const id = labId(request.assignmentId);
    if (request.action === "labDetails") return { value: labDetails(await page(labRoute(id)), id) };
    if (request.action === "labEditor") return { value: (await editor(id)).limits };
    if (request.action === "labSave") return { value: await saveLab(id) };
    return { error: "data" };
  }
