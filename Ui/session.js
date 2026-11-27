(async () => {
  "use strict";

  const request = /* CAMPUS_REQUEST */ null;
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
      if (!response.ok || !response.url.startsWith(site) ||
          /\/kaluga\/(?:login|auth|admin)\//.test(new URL(response.url).pathname)) throw new Error("page");
      return new DOMParser().parseFromString(await response.text(), "text/html");
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
    if (courseData.status === "rejected") return { error: "courses" };
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

  /* CAMPUS_LAB_SESSION */

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
    return { error: "data", message: error?.labMessage ? error.message : "" };
  }
})()
