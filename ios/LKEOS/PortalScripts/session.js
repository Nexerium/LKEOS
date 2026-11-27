return await (async () => {
  "use strict";


  const site = "https://e-learning.bmstu.ru/kaluga/";
  const userId = Number(window.M?.cfg?.userId ?? window.M?.cfg?.userid);
  if (!location.href.startsWith(site) ||
      /\/kaluga\/(?:login|auth|admin)\//.test(location.pathname) ||
      !Number.isSafeInteger(userId) || userId <= 0 || document.body.classList.contains("notloggedin")) {
    return { error: "login" };
  }

  const clean = value => {
    const content = document.createElement("template");
    content.innerHTML = String(value ?? "");
    content.content.querySelectorAll("script,style").forEach(node => node.remove());
    return (content.content.textContent ?? "").trim();
  };
  const read = node => node?.textContent.trim() ?? "";
  const localLink = (value, base = site) => {
    try {
      const url = new URL(value, base);
      return url.href.startsWith(site) && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  };

  async function page(path) {
    const url = localLink(path);
    if (!url) throw new Error("route");
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          credentials: "same-origin", mode: "same-origin", signal: AbortSignal.timeout(10500)
        });
      } catch (error) {
        if (!attempt) continue;
        throw error;
      }
      if (!attempt && [502, 503, 504].includes(response.status)) continue;
      if (response.status===401 || /\/kaluga\/(?:login|auth)\//.test(new URL(response.url).pathname)) throw new Error("login");
      if (!response.ok || !response.url.startsWith(site)) throw new Error("page");
      const doc=new DOMParser().parseFromString(await response.text(), "text/html");
      if (doc.body.classList.contains("notloggedin") || doc.querySelector("form#login")) throw new Error("login");
      return doc;
    }
  }

  let ajaxModule;
  async function call(methodname, args) {
    ajaxModule ??= new Promise((resolve, reject) => window.require(["core/ajax"], resolve, reject));
    const ajax = await ajaxModule;
    return await ajax.call([{ methodname, args }], true, true, false, 12000)[0];
  }

  async function courses() {
    const byId = new Map();
    let offset = 0;
    for (let batch = 0; batch < 12; batch++) {
      const result = await call("core_course_get_enrolled_courses_by_timeline_classification", {
        classification: "all", limit: 100, offset
      });
      if (!Array.isArray(result?.courses)) throw new Error("courses");
      for (const course of result.courses) {
        const id = Number(course.id);
        const name = clean(course.fullname || course.displayname);
        if (id > 0 && name) byId.set(id, {
            id, name, code: clean(course.shortname), description: clean(course.summary),
            teachers: (Array.isArray(course.coursecontacts) ? course.coursecontacts : Array.isArray(course.contacts) ? course.contacts : [])
              .map(contact => clean(contact.fullname)).filter(Boolean),
          progress: course.hasprogress !== false && course.progress != null && Number.isFinite(Number(course.progress))
            ? Number(course.progress) : null
        });
      }
      const next = Number(result.nextoffset);
      if (result.courses.length < 100 || !Number.isSafeInteger(next) || next <= offset)
        return { items: [...byId.values()], partial: false };
      offset = next;
    }
    return { items: [...byId.values()], partial: true };
  }

  async function assignments() {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    const limit = 50;
    const items = new Map();
    let aftereventid = 0;
    for (let batch = 0; batch < 8; batch++) {
      const result = await call("core_calendar_get_action_events_by_timesort", {
        timesortfrom: now - 90 * day, timesortto: now + 180 * day, aftereventid, limitnum: limit
      });
      if (!Array.isArray(result?.events)) throw new Error("events");
      for (const event of result.events) {
        const url = localLink(event.action?.url ?? event.url);
        const route = url?.pathname.match(/^\/kaluga\/mod\/([a-z0-9_]+)\/view\.php$/);
        const id = Number(event.id);
        const due = Number(event.timesort || event.timestart);
        const courseId = Number(event.course?.id);
        const name = clean(event.activityname || event.name);
        if (id > 0 && courseId > 0 && due > 0 && name && route) {
          items.set(id, {
            id, courseId, due, name, kind: { assign: "Задание", quiz: "Тест", lesson: "Урок", forum: "Форум" }[route[1]] ?? "Активность",
            description: clean(event.description), url: url.href
          });
        }
      }
      const next = Number(result.lastid ?? result.events.at(-1)?.id);
      if (!result.events.length || !Number.isSafeInteger(next) || next <= 0 || next === aftereventid)
        return { items: [...items.values()], partial: false };
      aftereventid = next;
      if (result.events.length < limit) return { items: [...items.values()], partial: false };
    }
    return { items: [...items.values()], partial: true };
  }

  async function profileName() {
    const fallback = read(document.querySelector("#user-menu-toggle .usertext, .usermenu .usertext"));
    try {
      const form = await page("user/edit.php?id=" + userId);
      const field = name => form.querySelector('input[name="' + name + '"]')?.value.trim() || "";
      const surname = field("lastname");
      const first = field("firstname").split(/\s+/)[0];
      if (surname && first) return surname + " " + first;
    } catch { /* Some accounts have a read-only SSO profile. */ }
    if (fallback) return fallback;
    const profile = await page("user/profile.php?id=" + userId);
    return read(profile.querySelector(".page-header-headings h1, #page-header h1"));
  }

  async function dashboard() {
    const [courseData, taskData, profile] = await Promise.allSettled([courses(), assignments(), profileName()]);
    if (courseData.status === "rejected") return { error:
      ["requireloginerror","invalidsesskey","servicerequireslogin"].includes(courseData.reason?.errorcode) ? "login" : "courses" };
    const warnings = [];
    if (courseData.value.partial) warnings.push("В списке курсов показана только часть записей.");
    if (taskData.status === "rejected") warnings.push("ЭОС не предоставила данные ленты заданий.");
    else if (taskData.value.partial) warnings.push("В ленте заданий показана только часть записей.");
    const courseIds = new Set(courseData.value.items.map(course => course.id));
    const name = profile.value || "";
    return { value: {
      name, warnings, accountKey: String(userId), courses: courseData.value.items,
      tasks: (taskData.value?.items ?? []).filter(task => courseIds.has(task.courseId)),
      grades: []
    }};
  }

  async function courseContents(id, loadedPage) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("id");
    const path = "course/view.php?id=" + id;
    const course = loadedPage || await page(path);
    const main = course.querySelector("#region-main, main, [role=main]");
    if (!main || course.querySelector("#notice .continuebutton, .alert-danger")) throw new Error("course");
    const sections = [...main.querySelectorAll("li.section, .course-section, [data-for=section]")];
    const groups = sections.length ? sections : [main];
    const seen = new Set();
    return groups.map(section => {
      const modules = [];
      for (const anchor of section.querySelectorAll('a[href*="/mod/"][href*="/view.php"]')) {
        const url = localLink(anchor.getAttribute("href"), site + path);
        const kind = url?.pathname.match(/^\/kaluga\/mod\/([a-z0-9_]+)\/view\.php$/)?.[1];
        if (!kind || !Number(url.searchParams.get("id")) || seen.has(url.href)) continue;
        const title = (anchor.querySelector(".instancename") ?? anchor).cloneNode(true);
        title.querySelectorAll(".sr-only,.visually-hidden,.accesshide").forEach(node => node.remove());
        const name = read(title);
        if (name) {
          seen.add(url.href);
          modules.push({ name, kind, url: url.href, description: "" });
        }
      }
      return {
        name: read(section.querySelector(".sectionname, h3.section-title, [data-for=section_title]")) || "Материалы курса",
        description: read(section.querySelector(".section-summary, .summary")), modules
      };
    }).filter(section => section.description || section.modules.length);
  }

  async function workIndex(courseId) {
    if (!Number.isSafeInteger(courseId) || courseId <= 0) throw new Error("id");
    let teachers = [];
    const [index, course] = await Promise.allSettled([
      page("mod/assign/index.php?id=" + courseId),
      page("course/view.php?id=" + courseId).then(doc => {
        teachers = [...doc.querySelectorAll(".teachers a[href*='/user/'], .course-contacts a[href*='/user/']")].map(read).filter(Boolean);
        return courseContents(courseId, doc);
      })
    ]);
    if ([index,course].some(result=>result.reason?.message==="login")) throw new Error("login");
    if (index.status === "rejected" && course.status === "rejected") throw new Error("course");
    const works = new Map();
    if (course.status === "fulfilled") {
      for (const group of course.value) for (const item of group.modules) {
        if (item.kind !== "assign" && !(["quiz","lesson","workshop"].includes(item.kind) &&
            /лабораторн|практич|практикум|(?:^|\s)(?:лр|пр)\s*[№#\d]/i.test(item.name+" "+group.name))) continue;
        const id = Number(new URL(item.url).searchParams.get("id"));
        works.set(id, {...item, id, section:group.name});
      }
    }
    if (index.status === "fulfilled") {
      for (const table of index.value.querySelectorAll("#region-main table, main table")) {
        const heads = [...(table.tHead?.rows[0]?.cells || table.rows[0]?.cells || [])].map(read);
        const find = regex => heads.findIndex(text => regex.test(text));
        const grade = find(/оценк|grade/i), status = find(/ответ|статус|submission/i);
        const due = find(/срок|due date|дата сдачи/i), section = find(/недел|раздел|тем[аы]|week|section|topic/i);
        let sectionName = "";
        for (const row of table.rows) {
          const a = [...row.querySelectorAll('a[href*="view.php"]')].find(link =>
            localLink(link.getAttribute("href"), site + "mod/assign/index.php")?.pathname === "/kaluga/mod/assign/view.php");
          if (!a) continue;
          const url = localLink(a.getAttribute("href"), site + "mod/assign/index.php");
          if (url?.pathname !== "/kaluga/mod/assign/view.php") continue;
          const id = Number(url.searchParams.get("id"));
          if (!Number.isSafeInteger(id) || id <= 0) continue;
          const value = col => read(row.cells[col]);
          const previous = works.get(id);
          if (section >= 0 && value(section)) sectionName = value(section);
          works.set(id, {id, kind:"assign", name:previous?.name || read(a), url:url.href,
            section:previous?.section || sectionName, status:value(status), grade:value(grade), due:value(due)});
        }
      }
    }
    return {works:[...works.values()], teachers:[...new Set(teachers)], partial:index.status === "rejected" || course.status === "rejected"};
  }

  async function activityInfo(address) {
    const url = localLink(address);
    if (!url || !/^\/kaluga\/mod\/(quiz|lesson|workshop)\/view\.php$/.test(url.pathname)) throw new Error("route");
    const doc = await page(url.href);
    const main = doc.querySelector("#region-main, main");
    if (!main) throw new Error("page");
    return {instructions:read(main.querySelector("#intro, .activity-description")),
      dates:[...main.querySelectorAll(".activity-dates > *, [data-region=activity-dates] > *")].map(read).filter(Boolean),
      materials:labLinks(main,/\/mod_(quiz|lesson|workshop)\//i)};
  }

  async function submission(url) {
    const link = localLink(url);
    if (link?.pathname !== "/kaluga/mod/assign/view.php") return "Статус доступен в ЭОС";
    const id = Number(link.searchParams.get("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return "Статус доступен в ЭОС";
    const assignment = await page("mod/assign/view.php?id=" + id);
    const area = assignment.querySelector(".submissionstatustable, #submissionstatus");
    if (area?.querySelector(".submissiongraded")) return "Оценено";
    if (area?.querySelector(".submissionstatussubmitted")) return "Сдано";
    if (area?.querySelector(".submissionstatusdraft")) return "Черновик";
    return "Статус доступен в ЭОС";
  }

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


  try {
    if (["labDetails", "labEditor", "labSave", "prepareLabUpload"].includes(request.action))
      return await runLabAction();
    if (request.action === "check") return { value: true };
    if (request.action === "dashboard") return await dashboard();
    if (request.action === "course") return { value: await courseContents(request.courseId) };
    if (request.action === "workIndex") return { value: await workIndex(request.courseId) };
    if (request.action === "activityInfo") return { value: await activityInfo(request.url) };
    if (request.action === "submission") return { value: await submission(request.url) };
    return { error: "data" };
  } catch (error) {
    if (error.message==="login") return {error:"login"};
    return { error: "data", message: error?.labMessage ? error.message : "" };
  }
})()
