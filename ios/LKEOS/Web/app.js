"use strict";

let themeChoice;
try { themeChoice = localStorage.getItem("campus.theme"); } catch {}
document.documentElement.dataset.theme = ["dark", "light"].includes(themeChoice) ? themeChoice :
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const site = "https://e-learning.bmstu.ru/kaluga/";
const official = { eos: site, lks: "https://lks.bmstu.ru/profile" };
const labels = { home: "Обзор", courses: "Мои курсы", works: "Мои работы", tasks: "Задания", calendar: "Календарь", grades: "Успеваемость", settings: "Профиль", course: "Материалы курса", lab: "Лабораторная" };
const moduleLabels = {
  assign: ["tasks", "Задание"], quiz: ["edit", "Тест"], forum: ["person", "Форум"],
  page: ["file", "Страница"], book: ["courses", "Книга"], resource: ["file", "Файл"],
  folder: ["folder", "Папка"], url: ["link", "Ссылка"], label: ["file", "Текст"]
};
const colors = ["", "purple", "green", "orange"];
const navigation = document.getElementById("navigation");
const main = document.getElementById("content");
const dialog = document.getElementById("dialog");
const zone = "Europe/Moscow";
const msPerDay = 86400000;
const isoFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "long", weekday: "long" });
const shortDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "short" });
const dateAndTime = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const monthFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "long", year: "numeric" });
const now = () => Math.floor(Date.now() / 1000);
const dayKey = timestamp => isoFormat.format(new Date(timestamp * 1000));
const localDay = key => new Date(key + "T12:00:00+03:00");
const utcKey = date => date.toISOString().slice(0, 10);
const capital = text => text.charAt(0).toLocaleUpperCase("ru-RU") + text.slice(1);
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
const tile = (name, color = "") => '<span class="tile ' + color + '">' + icon(name) + '</span>';
const officialLink = url => {
  try {
    const link = new URL(url);
    return link.href.startsWith(site) && !link.username && !link.password;
  } catch {
    return false;
  }
};

function emptyStudyData() {
  return {name: "", courses: [], tasks: [], grades: [], warnings: []};
}

let data = emptyStudyData();
let live = false;
let sso = false;
let page = "home";
let filter = "all";
let courseFilter = "";
let courseQuery = "";
let showHidden = false;
let courseId = 0;
let selected = dayKey(now());
let dayExpanded = false;
let month = new Date(selected.slice(0, 7) + "-01T00:00:00Z");
let connectionPending = false;
let updatedAt = 0;
const sectionsByCourse = new Map();
const submissionByTask = new Map();
const bridge = window.webkit?.messageHandlers?.campus;
let restoringSession = Boolean(bridge);
const expiredSession = {eos:false,lks:false};
const sessionChecks = new Map();
function markExpired(service) {
  if (expiredSession[service]) return;
  expiredSession[service]=true;
  render();
}
async function checkSession(service) {
  if (!bridge || expiredSession[service] || connectionPending || reportBusy ||
      (service==="eos" ? !live : report===null)) return;
  if (sessionChecks.has(service)) return sessionChecks.get(service);
  const snapshot=service==="eos" ? data : report;
  const check=bridge.postMessage({action:"sessionStatus",service}).then(state=>{
    if (state==="expired" && snapshot===(service==="eos" ? data : report)) markExpired(service);
  }).catch(()=>{}).finally(()=>sessionChecks.delete(service));
  sessionChecks.set(service,check);
  return check;
}
async function callHost(action, args = {}) {
  if (!bridge) throw new Error("Откройте приложение ЛКЭОС.");
  try { return await bridge.postMessage({action,...args}); }
  catch (error) {
    const message=String(error?.message ?? error);
    if (message.includes("LKEOS_AUTH_EOS") || message.includes("LKEOS_AUTH_LKS")) {
      const service=message.includes("LKEOS_AUTH_LKS") ? "lks" : "eos";
      markExpired(service);
      throw new Error(service==="eos" ? "Требуется вход в ЭОС." : "Требуется вход в ЛКС.");
    }
    if (["course","submission","workIndex","activityInfo","labDetails","labEditor","labSave"].includes(action)) void checkSession("eos");
    throw error;
  }
}

function go(view, details = 0) {
  if (boardWork) {
    if (lab?.busy === "save") { toast("Дождитесь завершения отправки."); return; }
    releaseWork();
  }
  if (page === "lab" && view !== "lab") {
    if (lab?.busy === "save") {
      toast("Дождитесь сохранения ответа.");
      return;
    }
    labLeave();
  }
  if (view === "course") {
    courseId = Number(details);
    if (!data.courses.some(item => item.id === courseId)) return;
  }
  dialog.close();
  page = view;
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
  if (view === "course" && live) loadCourse(courseId);
  if (view === "grades" && !expiredSession.lks) {
    void checkSession("lks").then(()=>{ if (page==="grades" && !expiredSession.lks) void loadProgress(); });
  }
  if (["settings","courses","works","home"].includes(view)) void checkSession("eos");
  if (view === "settings") void checkSession("lks");
}

function button(label, attributes, glyph, kind = "") {
  return '<button type="button" class="button ' + kind + '" ' + attributes + '>' + escape(label) +
    (glyph ? icon(glyph) : "") + '</button>';
}

const empty = (title, detail = "") => '<div class="empty"><strong>' + escape(title) + '</strong>' + escape(detail) + '</div>';
const warning = root => data.warnings.filter(text => !root || text.includes(root));
const notice = lines => lines.length ? '<div class="notice">' + lines.map(line => '<p>' + escape(line) + '</p>').join("") + '</div>' : "";
const courseName = id => data.courses.find(course => course.id === id)?.name ?? ("Курс");
const hiddenStorageKey = () => "campus.hiddenCourses.eos." + (data.accountKey ?? "default");
const courseKey = course => String(course.id);
let hiddenCourses = new Set();
function readHiddenCourses() {
  try {
    const values = JSON.parse(localStorage.getItem(hiddenStorageKey()) ?? "[]");
    return new Set(Array.isArray(values) ? values.filter(value => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}
function toggleCourseVisibility(id) {
  const course = data.courses.find(item => item.id === id);
  if (!course) return;
  const key = courseKey(course);
  const hidden = hiddenCourses.has(key);
  if (hidden) hiddenCourses.delete(key);
  else hiddenCourses.add(key);
  try {
    localStorage.setItem(hiddenStorageKey(), JSON.stringify([...hiddenCourses]));
  } catch {
    toast("Не удалось сохранить настройку после закрытия приложения.");
  }
  render();
  document.querySelector('[data-course-visibility="' + id + '"]')?.focus();
}
const isHidden = course => hiddenCourses.has(courseKey(course));
const visibleCourses = () => data.courses.filter(course => !isHidden(course));
const visibleTasks = () => {
  const hiddenIds = new Set(data.courses.filter(isHidden).map(course => course.id));
  return data.tasks.filter(task => !hiddenIds.has(task.courseId));
};
hiddenCourses = readHiddenCourses();
const plural = new Intl.PluralRules("ru");
const count = (number, words) => words[{ one: 0, few: 1 }[plural.select(number)] ?? 2];
const hasGrade = grade => grade && !/^[-–—]$/.test(grade);
const completed = task => ["Сдано", "Оценено"].includes(submissionByTask.get(task.id) ?? task.status);
const orderTasks = tasks => [...tasks].sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || a.name.localeCompare(b.name, "ru"));

function header(title, subtitle = "", extra = "") {
  return '<div class="page-head"><div><h1>' + escape(title) + '</h1>' +
    (subtitle ? '<p>' + escape(subtitle) + '</p>' : '') + '</div>' + extra + '</div>';
}

function deadlineTag(task) {
  if (completed(task)) return '<span class="tag done">' + escape(submissionByTask.get(task.id) ?? task.status) + '</span>';
  if (!task.due) return '<span class="tag past">Без срока</span>';
  const key = dayKey(task.due);
  const days = Math.round((localDay(key) - localDay(dayKey(now()))) / msPerDay);
  const type = task.due < now() ? "past" : days <= 1 ? "urgent" : "";
  const label = task.due >= now() && days <= 1 ? (days === 0 ? "Сегодня" : "Завтра") :
    shortDate.format(new Date(task.due * 1000)).replace(/\.$/, "");
  return '<span class="tag ' + type + '">' + escape(label) + '</span>';
}

function taskRow(task, showCourse = true) {
  const color = task.kind === "Лабораторная" ? "purple" : task.kind === "Практикум" ? "green" : "";
  const description = showCourse ? courseName(task.courseId) + " · " + task.kind : task.kind;
  return '<button class="row" type="button" data-task="' + task.id + '">' +
    tile(task.kind === "Практикум" ? "edit" : "tasks", color) +
    '<span class="row-copy"><strong>' + escape(task.name) + '</strong><small>' + escape(description) +
    '</small></span>' + deadlineTag(task) + icon("chevron") + '</button>';
}

function courseCard(course, index) {
  const progress = course.progress == null ? null : Math.round(Math.min(100, Math.max(0, Number(course.progress))));
  const visibility = isHidden(course) ? "Вернуть курс" : "Скрыть курс";
  return '<article class="course-card"><button class="course-open" type="button" data-course="' + course.id + '">' +
    '<span class="course-card-heading">' + tile(index % 4 === 1 ? "code" : "courses", colors[index % 4]) + '</span>' +
    '<h3>' + escape(course.name) + '</h3><p>' + escape(course.code) + '</p>' +
    (progress == null ? "" : '<div class="course-progress"><div class="progress-text"><span>Прогресс</span><strong>' + progress +
      '%</strong></div><span class="progress-track"><span class="progress-fill" style="width:' + progress +
      '%"></span></span></div>') + '</button><button class="icon-button course-visibility" type="button" data-course-visibility="' +
    course.id + '" title="' + visibility + '" aria-label="' + escape(visibility + " «" + course.name + "»") + '">' +
    icon(isHidden(course) ? "eye" : "hide") + '</button></article>';
}

// Published by the public LKS schedule. Keep this semester available on the first offline launch.
const semesters = new Map([["2026-09-01", "2027-01-05"]]);
function rememberSemester(start, end) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(start) || !isoDate.test(end) || start > end) return;
  semesters.set(start, end);
}
try {
  for (const [start, end] of JSON.parse(localStorage.getItem("campus.semesters") || "[]"))
    rememberSemester(start, end);
} catch {}

async function refreshAcademicCalendar() {
  try {
    const term = await callHost("academicCalendar");
    rememberSemester(term.semesterStarts, term.semesterEnds);
    if (page === "home") {
      const label = main.querySelector(".week-parity");
      if (label) label.textContent = academicWeekLabel(selected);
    }
    localStorage.setItem("campus.semesters", JSON.stringify([...semesters]));
  } catch { /* The published semester remains available offline. */ }
}

function academicWeekNumber(date) {
  for (const [start, end] of semesters) {
    if (date < start || date > end) continue;
    const firstDay = new Date(start + "T00:00:00Z");
    const daysSinceStart = (Date.parse(date + "T00:00:00Z") - firstDay.getTime()) / msPerDay;
    const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
    const weekIndex = Math.floor((daysSinceStart + mondayOffset) / 7);
    return weekIndex + 1;
  }
  return 0;
}

function academicWeekLabel(date) {
  const week = academicWeekNumber(date);
  return week ? (week % 2 ? "Числитель" : "Знаменатель") : "Нет данных о неделе";
}

function monthCalendar(full) {
  const offset = (month.getUTCDay() + 6) % 7;
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const length = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Math.ceil((offset + length) / 7) * 7;
  const marked = new Set(visibleTasks().filter(task => task.due).map(task => dayKey(task.due)));
  const today = dayKey(now());
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => '<span class="week-day">' + day + '</span>');
  const days = Array.from({ length: cells }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, index - offset + 1));
    const key = utcKey(date);
    const classes = ["day", date.getUTCMonth() !== monthIndex ? "other" : "", key === today ? "today" : "",
      key === selected ? "selected" : "", marked.has(key) ? "marked" : ""].join(" ");
    const label = fullDate.format(localDay(key)) + (marked.has(key) ? (", есть задания") : "");
    return '<button type="button" class="' + classes + '" data-day="' + key + '" aria-pressed="' +
      (key === selected) + '" aria-label="' + escape(label) + '"' + (key === today ? ' aria-current="date"' : '') +
      '>' + date.getUTCDate() + '</button>';
  });
  return '<section class="panel ' + (full ? "full-calendar" : "") + '"><div class="panel-head"><h2>' +
    (full ? "Месяц" : "Календарь") + '</h2><div class="month-tools">' +
    '<button type="button" class="icon-button" data-month="-1" aria-label="Предыдущий месяц">' + icon("back") + '</button>' +
    '<span class="month-name" aria-live="polite">' + escape(capital(monthFormat.format(month).replace(/\sг\.$/, ""))) + '</span>' +
    '<button type="button" class="icon-button" data-month="1" aria-label="Следующий месяц">' + icon("chevron") + '</button>' +
    '</div></div><div class="month-grid">' + weekdays.concat(days).join("") + '</div>' +
    (!full ? '<div class="calendar-footer"><span class="week-parity" aria-live="polite">' + academicWeekLabel(selected) + '</span>' +
      button("Сегодня", 'data-action="today"', "", "ghost") + '</div>' +
      (dayExpanded ? '<div class="calendar-agenda"><strong>' + escape(capital(fullDate.format(localDay(selected)))) + '</strong>' +
        (visibleTasks().filter(task => task.due && dayKey(task.due) === selected).map(task => taskRow(task)).join("") ||
        '<p>Событий нет</p>') + '</div>' : "") : '') + '</section>';
}

function overview() {
  const today = capital(fullDate.format(localDay(dayKey(now()))));
  const semester = monthText();
  const personalName = (data.name || "").trim().split(/\s+/).slice(0, 2).join(" ");
  const heroTitle = live ? "Добрый день" + (personalName && personalName !== "Студент" ? ", " + escape(personalName) : "") :
    "Ваш учебный кабинет";
  const heroText = live ? "Курсы и задания вашего профиля ЭОС." : "Войдите через МГТУ, чтобы загрузить свои курсы и задания.";
  return header("Обзор", "", '<span class="today-label">' + icon("calendar") + escape(today) + '</span>') +
    notice(data.warnings) + '<section class="hero"><div class="hero-copy"><div class="term">' + escape(semester) +
    '</div><h2>' + heroTitle + '</h2><p>' + heroText + '</p>' +
    '<div class="actions">' +
    (!live ? button("Войти через МГТУ", 'data-action="signIn"' + (connectionPending ? " disabled" : ""), "chevron") : "") +
    (live ? button("К моим курсам", 'data-nav="courses"', "chevron") : "") + '</div></div></section>' +
    '<div class="overview-grid">' + recentPanel() + monthCalendar(false) + '</div>';
}

function monthText() {
  const current = new Date(dayKey(now()) + "T12:00:00Z");
  const monthIndex = current.getUTCMonth();
  const year = current.getUTCFullYear();
  const yearStart = monthIndex >= 8 ? year : year - 1;
  const term = monthIndex >= 8 || monthIndex === 0 ? "Осенний семестр" : "Весенний семестр";
  return term + " " + yearStart + "/" + String(yearStart + 1).slice(-2);
}

function courseResults() {
  const query = courseQuery.trim().toLocaleLowerCase("ru-RU");
  const result = data.courses.filter(course => isHidden(course) === showHidden &&
    (course.name + " " + course.code).toLocaleLowerCase("ru-RU").includes(query));
  return result.length ? '<div class="courses-grid">' + result.map(courseCard).join("") + '</div>' :
    '<div class="panel">' + (query ? empty("Курсы не найдены", "Попробуйте изменить запрос.") :
      empty(showHidden ? "Скрытых курсов нет" : "В списке нет видимых курсов")) + '</div>';
}

function coursesPage() {
  if (!live) return header("Мои курсы") + '<section class="panel settings-panel"><p>Войдите в ЭОС, чтобы открыть свои курсы.</p>' +
    button("Войти через МГТУ", 'data-action="signIn"', "person", "primary") + '</section>';
  const hidden = data.courses.filter(isHidden).length;
  return header("Мои курсы") +
    '<div class="filters"><div class="tabs" aria-label="Видимость курсов">' +
    '<button type="button" class="tab ' + (showHidden ? '' : 'active') + '" data-course-tab="visible" aria-pressed="' + !showHidden +
    '">Видимые · ' + (data.courses.length - hidden) + '</button>' +
    '<button type="button" class="tab ' + (showHidden ? 'active' : '') + '" data-course-tab="hidden" aria-pressed="' + showHidden +
    '">Скрытые · ' + hidden + '</button></div><input class="input" id="course-query" type="search" aria-label="Фильтр курсов" ' +
    'placeholder="Название или кафедра" value="' + escape(courseQuery) + '"></div><div id="course-results">' + courseResults() + '</div>';
}

function filteredTasks() {
  const moment = now();
  const filters = {
    all: () => true,
    week: task => task.due >= moment && task.due - moment <= 7 * 86400 && !completed(task),
    future: task => task.due >= moment && !completed(task),
    past: task => task.due > 0 && task.due < moment,
    undated: task => task.due <= 0
  };
  return orderTasks(visibleTasks().filter(task => (!courseFilter || Number(courseFilter) === task.courseId) && filters[filter](task)));
}

function tasksPage() {
  const tabs = { all: "Все", week: "На 7 дней", future: "Предстоящие", past: "Прошедшие сроки" };
  if (!sso) tabs.undated = "Без срока";
  const controls = Object.entries(tabs).map(([key, label]) => '<button type="button" class="tab ' +
    (filter === key ? "active" : "") + '" data-task-filter="' + key + '" aria-pressed="' + (filter === key) + '">' + label + '</button>');
  const courses = visibleCourses().map(course => '<option value="' + course.id + '"' +
    (String(course.id) === courseFilter ? " selected" : "") + '>' + escape(course.name) + '</option>');
  const tasks = filteredTasks();
  const noun = ["задание", "задания", "заданий"];
  return header("Задания", sso ? "Активности из ленты сроков ЭОС" : "Фильтры по срокам и курсам") + notice(warning("заданий")) +
    '<div class="filters"><div class="tabs" aria-label="Сроки">' + controls.join("") + '</div>' +
    '<select class="input" id="task-course" aria-label="Курс"><option value="">Все курсы</option>' + courses.join("") + '</select></div>' +
    '<section class="panel"><div class="panel-head"><h2>' + tasks.length + " " + count(tasks.length, noun) +
    '</h2></div>' + (tasks.length ? tasks.map(task => taskRow(task)).join("") : empty("По этому фильтру " + noun[2] + " нет")) + '</section>';
}

function calendarPage() {
  const tasks = orderTasks(visibleTasks().filter(task => task.due && dayKey(task.due) === selected));
  return header("Календарь", ("Сроки сдачи заданий") + " · московское время",
    button("Сегодня", 'data-action="today"', "calendar")) + notice(warning("заданий")) +
    '<div class="calendar-grid">' + monthCalendar(true) + '<section class="panel"><div class="panel-head"><h2>' +
    escape(capital(fullDate.format(localDay(selected)))) + '</h2></div>' +
    (tasks.length ? tasks.map(task => taskRow(task)).join("") : empty("На эту дату сроков нет")) + '</section></div>';
}

let report = null;
let reportDate = "";
let reportBusy = false;
let reportError = "";

async function loadProgress() {
  if (reportBusy) return;
  reportBusy = true;
  reportError = "";
  render();
  try {
    const result = await callHost("progress");
    if (!result) return;
    if (!Array.isArray(result?.disciplines)) throw new Error("ЛКС вернул неполную ведомость.");
    report = result.disciplines;
    expiredSession.lks=false;
    reportDate = formatReportDate(result.date);
  } catch (error) {
    reportError = error.message;
  } finally {
    reportBusy = false;
    if (page === "grades" || page === "home" || page==="settings") render();
  }
}

async function disconnectLks() {
  if (reportBusy) return;
  reportBusy = true;
  render();
  try {
    await callHost("disconnectLks");
    expiredSession.lks=false;
    report = null;
    reportDate = "";
    reportError = "";
  } catch (error) {
    reportError = error.message;
  } finally {
    reportBusy = false;
    render();
  }
}

const reportGroups = {controls: "Текущая успеваемость", laboratory: "Лабораторные работы", seminars: "Семинарские занятия"};
const workStages = {"1":"Выдано", "2":"Выполнено", "3":"Защищено"};
const seminarStages = {"0":"Пропущено", "4":"Посещено", "12":"Работа на семинаре"};
const timingLabels = {"early":"раньше срока", "late":"с опозданием", "in time":"вовремя"};

function formatReportDate(value) {
  if (!value) return "";
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? dateAndTime.format(timestamp) : "";
}

function reportCell(entry, key, address) {
  const seminar = key === "seminars";
  const phase = seminar ? {"0":1,"4":2,"12":3}[entry.stage] : {"1":1,"2":2,"3":3}[entry.stage];
  const stage = (seminar ? seminarStages : workStages)[entry.stage] || "";
  const timing = timingLabels[entry.passStatus] || "";
  const type = entry.type || (seminar ? "СЗ" : key === "laboratory" ? "ЛР" : "");
  const hasValue = entry.value != null && String(entry.value).trim() !== "";
  const value = hasValue ? String(entry.value) + (type === "М" ? "" : "%") : "";
  const limits = ["point_3","point_4","point_5"].map(name => entry.points?.[name]);
  const score = Number(entry.value ?? 0);
  let tone = "";
  if (entry.stage != null && String(entry.stage) !== "" && Number.isFinite(score) &&
      limits.every(point => point != null && point !== "" && Number.isFinite(Number(point)))) {
    const level = limits.findIndex(point => score < Number(point));
    tone = [" fail"," pass"," good"][level] || " excellent";
  }
  const when = seminar ? "" : {early:" early",late:" late","in time":" on-time"}[entry.passStatus] || "";
  const label = [type, value, stage, timing].filter(Boolean).join(" · ") || "Подробности";
  return '<button class="week-mark' + tone + (tone || stage || value ? '' : ' planned') + '" data-mark="' + address +
    '" title="' + escape(label) + '" aria-label="' + escape(label) + '">' +
    (type ? '<strong>' + escape(type) + '</strong>' : '') + (hasValue ? '<span>' + escape(value) + '</span>' : '') +
    (phase ? '<i aria-hidden="true" class="stage s' + phase + when + '"></i>' :
      (key !== "controls" && (!entry.stage || String(entry.stage) === "0") ? '<i aria-hidden="true" class="stage unset"></i>' : '')) + '</button>';
}

function openReportMark(address) {
  const [row, group, index] = address.split(":");
  const course = report?.[row];
  const entry = course?.[group]?.[index];
  if (!entry) return;
  const module = entry.type === "М";
  const facts = [
    ["Неделя", entry.week], ["Вид", entry.type || reportGroups[group]],
    [module ? "Баллы" : "Выполнение", entry.value == null || entry.value === "" ? null :
      module ? entry.value + (entry.points?.point_all != null ? " / " + entry.points.point_all : "") : entry.value + "%"],
    ["Статус", (group === "seminars" ? seminarStages : workStages)[entry.stage]],
    ["Срок", timingLabels[entry.passStatus]], ["Выставлено", formatReportDate(entry.setDate)]
  ];
  openDialog(course.title || "Дисциплина", '<dl class="lab-status">' + facts
    .filter(([,value]) => value != null && value !== "").map(([label,value]) =>
      '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join("") + '</dl>');
}

function reportLegend(key) {
  const labels = Object.values(key === "seminars" ? seminarStages : workStages);
  return '<div class="report-legend">' + labels.map((label,i) => '<span><i class="stage s' + (i+1) +
    '" aria-hidden="true"></i>' + label + '</span>').join("") +
    (key === "seminars" ? '' : '<em class="late">с опозданием</em><em class="early">раньше срока</em><em class="on-time">вовремя</em>') + '</div>';
}

function reportTables() {
  let lastWeek = 0;
  const grouped = Object.keys(reportGroups).map(key => {
    const rows = [];
    let undated = false;
    report.forEach((course, row) => {
      const entries = Array.isArray(course[key]) ? course[key] : [];
      if (key !== "controls" && !entries.length) return;
      const cells = new Map();
      entries.forEach((entry,index) => {
        if (!entry) return;
        const n = Number(entry.week);
        const week = Number.isInteger(n) && n > 0 && n <= 53 ? n : 0;
        if (!week) undated = true;
        lastWeek = Math.max(lastWeek, week);
        const marks = cells.get(week) || [];
        marks.push(reportCell(entry,key,[row,key,index].join(":")));
        cells.set(week,marks);
      });
      rows.push({ name: course.title || "Дисциплина", cells });
    });
    return {key,rows,undated};
  });
  const today = dayKey(now());
  const current = academicWeekNumber(today);
  return grouped.filter(group => group.rows.length).map(({key,rows,undated}) => {
    const weeks = Array.from({length: lastWeek}, (_,i) => i+1);
    if (undated) weeks.push(0);
    const subhead = key === "controls" && current ? '<p>Сейчас: ' + current + ' неделя, ' +
      academicWeekLabel(today).toLocaleLowerCase("ru") + '</p>' : '';
    const head = weeks.map(n => '<th scope="col">' + (n || "Без недели") + '</th>').join("");
    const body = rows.sort((a,b) => a.name.localeCompare(b.name,"ru")).map(row =>
      '<tr><th scope="row">' + escape(row.name) + '</th>' + weeks.map(n => '<td>' +
        (row.cells.get(n) || []).join("") + '</td>').join("") + '</tr>').join("");
    const title = reportGroups[key];
    return '<section class="panel report-panel"><div class="report-head"><div><h2>' + title + '</h2>' +
      subhead + '</div>' + reportLegend(key) + '</div><div class="report-scroll" tabindex="0" role="region" aria-label="' +
      title + '"><table class="week-table" aria-label="' + title + '" style="--week-count:' + weeks.length +
      '"><thead><tr><th scope="col">Дисциплины / Недели</th>' + head + '</tr></thead><tbody>' + body +
      '</tbody></table></div></section>';
  }).join("");
}

function gradesPage() {
  const refresh = button(reportBusy ? "Подождите…" : report && !expiredSession.lks ? "Обновить" : "Войти в ЛКС",
    'data-action="progress"' + (reportBusy ? " disabled" : ""), "refresh");
  const top = header("Успеваемость", expiredSession.lks ? "Сессия ЛКС истекла. Войдите, чтобы обновить ведомость." : "Ведомость личного кабинета МГТУ", '<div class="actions">' +
    (report && !expiredSession.lks ? button("Выйти из ЛКС", 'data-action="disconnect-lks"' + (reportBusy ? " disabled" : ""), "", "ghost") : "") + refresh + '</div>');
  const original = button("Открыть ведомость ЛКС", 'data-action="progress-page"', "external", "ghost");
  if (report === null) return top + '<section class="panel"><div class="empty"><strong>' +
    (reportBusy ? "Загружаем ведомость…" : "Успеваемость из ЛКС") + '</strong>' +
    escape(reportError || (reportBusy ? "" : "Для просмотра отметок войдите в личный кабинет МГТУ.")) +
    '</div></section>' + (reportError ? original : "");
  const tables = reportTables();
  const stamp = reportDate ? "Данные актуальны на " + reportDate + " мск" : "ЛКС не указал время актуальности";
  return top + notice(reportError ? ["Не удалось обновить ведомость. " + reportError] : []) +
    '<p class="report-stamp">' + escape(stamp) + '</p><div class="content-stack">' +
    (tables || '<section class="panel">' + empty("В ЛКС пока нет данных об успеваемости") + '</section>') +
    '</div>' + original;
}

function coursePage() {
  const course = data.courses.find(item => item.id === courseId);
  if (!course) return empty("Курс не найден");
  const tasks = orderTasks(data.tasks.filter(task => task.courseId === courseId));
  const materials = sectionsByCourse.get(courseId);
  const sections = materials?.error ? '<section class="panel">' + empty("Материалы недоступны", materials.error) + '<div class="retry">' + button("Повторить", 'data-action="course-retry"', "refresh") + '</div></section>' :
    !materials ? '<section class="panel">' + empty("Загружаем материалы…") + '</section>' :
      !materials.length ? '<section class="panel">' + empty("В курсе пока нет доступных материалов") + '</section>' :
        materials.map(section => '<section class="panel"><div class="panel-head"><h2>' + escape(section.name || "Раздел курса") + '</h2></div>' +
          (section.description ? '<div class="section-description detail-copy">' + escape(section.description) + '</div>' : '') +
          section.modules.map(moduleRow).join("") + '</section>').join("");
  return '<div class="detail-top">' + button("К списку курсов", 'data-nav="courses"', "", "ghost") + '</div>' +
    header(course.name, course.code, live ? button("Курс в ЭОС", 'data-url="' + site + 'course/view.php?id=' + courseId + '"', "external") : "") +
    '<div class="content-stack">' + sections + '<section class="panel"><div class="panel-head"><h2>' +
    (sso ? "Сроки по курсу" : "Задания курса") + '</h2></div>' +
    (tasks.length ? tasks.map(task => taskRow(task, false)).join("") :
      empty(sso ? "В ленте нет сроков по этому курсу" : "Заданий в списке нет")) + '</section></div>';
}

function moduleRow(module) {
  const [symbol, type] = moduleLabels[module.kind] ?? ["file", "Материал"];
  const clickable = officialLink(module.url);
  const body = tile(symbol) + '<span class="row-copy"><strong>' + escape(module.name) + '</strong><small>' +
    escape(type + (module.description ? " · " + module.description : "")) + '</small></span>';
  const native = sso && module.kind === "assign" && labModuleId(module.url);
  return clickable ? '<button type="button" class="row" ' + (native ?
    'data-lab-url="' + escape(module.url) + '" data-lab-title="' + escape(module.name) + '"' :
    'data-url="' + escape(module.url) + '"') + '>' + body + icon(native ? "chevron" : "external") + '</button>' :
    '<div class="row">' + body + '</div>';
}

let accountsModel;
function profilePanel() {
  if (!accountsModel) return '<section class="settings-panel profiles"><h2>Профили</h2>' +
    button("Загрузить профили", 'data-action="load-accounts"', "refresh") + '</section>';
  const profile = accountsModel.profiles.find(item => item.id === accountsModel.active);
  const choices = accountsModel.profiles.map(item => '<option value="' + escape(item.id) + '"' +
    (item.id === profile.id ? ' selected' : '') + '>' + escape(item.name) + '</option>').join("");
  const services = [["eos","ЭОС"],["lks","ЛКС"]].map(([key,title]) => {
    const login = accountsModel[key];
    return '<div class="saved-login"><div><strong>' + title + '</strong><small>' + escape(login || "Данные для входа не сохранены") +
      '</small></div><div class="actions">' + button(login ? "Изменить" : "Сохранить логин и пароль",
        'data-edit-login="' + key + '"', "person") + (login ? button("Забыть", 'data-forget-login="' + key + '"', "", "ghost") : "") + '</div></div>';
  }).join("");
  return '<section class="settings-panel profiles"><h2>Профили</h2><label for="active-account">Активный профиль</label>' +
    '<select class="input" id="active-account">' + choices + '</select>' + services +
    '<form id="add-account"><label for="account-name">Новый профиль</label><div class="actions">' +
    '<input class="input" id="account-name" name="name" maxlength="60" required placeholder="Название профиля">' +
    '<button class="button" type="submit">Создать и переключиться</button></div></form></section>';
}

async function accountAction(action, args = {}) {
  try {
    const result = await callHost(action,args);
    if (action === "selectAccount") { location.reload(); return; }
    if (action === "editLogin" && accountsModel?.[args.service] !== result[args.service]) {
      if (args.service === "eos") { location.reload(); return; }
      report = null;
      expiredSession.lks=false;
      reportDate = "";
      reportError = "";
    }
    accountsModel = result;
    if (page === "settings") render();
  } catch (error) { toast(error.message); }
}

function settingsPage() {
  const name=data.name || accountsModel?.profiles.find(p=>p.id===accountsModel.active)?.name || "Профиль";
  const initials=name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join("").toLocaleUpperCase("ru");
  const dark=document.documentElement.dataset.theme==="dark";
  const serviceRow=(title,status,actions)=>'<div class="service-row"><div><strong>'+title+'</strong><small>'+status+
    '</small></div><div class="actions">'+actions+'</div></div>';
  const eosActive=live && !expiredSession.eos;
  const lksActive=report!==null && !expiredSession.lks;
  const eosStatus=connectionPending ? "Подключение…" : expiredSession.eos ? "Требуется повторный вход" : live ? "Подключена" : "Вход не выполнен";
  const lksStatus=reportBusy ? "Подключение…" : expiredSession.lks ? "Требуется повторный вход" : lksActive ? "Подключён" :
    accountsModel?.restoreLks ? "Сессия сохранена · проверится при входе" : "Вход не выполнен";
  return header("Профиль")+'<div class="panel settings-grid"><div class="connection-sections"><section class="settings-panel">'+
    '<div class="profile-identity"><span class="profile-initials" aria-hidden="true">'+escape(initials)+'</span><strong>'+escape(name)+'</strong></div>'+
    '<div class="profile-theme"><strong>Тёмная тема</strong><button type="button" class="theme-toggle" role="switch" aria-label="Тёмная тема" aria-checked="'+dark+'" data-action="theme"><span></span></button></div></section>'+
    '<section class="settings-panel"><h2>Учебные сервисы</h2>'+
    serviceRow("ЭОС",eosStatus,eosActive ? button("Обновить",'data-action="refresh"'+(connectionPending?" disabled":""),"refresh","ghost")+
      button("Выйти",'data-action="disconnect"'+(connectionPending?" disabled":""),"") :
      button("Войти в ЭОС",'data-action="signIn"'+(connectionPending?" disabled":""),"","primary"))+
    serviceRow("ЛКС",lksStatus,lksActive ? button("Выйти",'data-action="disconnect-lks"'+(reportBusy?" disabled":""),"") :
      button("Войти в ЛКС",'data-action="progress"'+(reportBusy?" disabled":""),"","primary"))+
    (reportError ? '<p class="feedback" role="status">'+escape(reportError)+'</p>' : "")+
    '<p id="feedback" class="feedback" role="status"></p></section>' +
    '<section class="settings-panel"><h2>Официальные сервисы</h2>' +
    '<p>Сдача работ, тесты и материалы доступны в окне официальной ЭОС.</p><div class="actions">' +
    button("Открыть ЭОС", 'data-external="eos"', "globe") +
    button("ЛКС МГТУ", 'data-external="lks"', "external") + '</div></section></div>' + profilePanel() + '</div>';
}

function render() {
  const active = page === "course" || (page === "lab" && lab?.from === "course") ? "courses" :
    page === "lab" ? "tasks" : page;
  labels.tasks = "Задания";
  navigation.innerHTML = ["home", "courses", "works", "grades"].map(view =>
    '<button class="nav-item" type="button" data-nav="' + view + '" aria-label="'+escape(labels[view])+'"' + (active === view ? ' aria-current="page"' : '') +
    '>' + icon(view==="works" ? "tasks" : view) + (view==="grades" ? '<span class="regular-label">Успеваемость</span><span class="short-label">Оценки</span>' : '<span>'+escape(labels[view])+'</span>') + '</button>').join("");
  const settings = document.querySelector(".sidebar-bottom [data-nav=settings]");
  if (active === "settings") settings.setAttribute("aria-current", "page");
  else settings.removeAttribute("aria-current");
  if (restoringSession) {
    main.innerHTML = '<section class="panel settings-panel" role="status"><h2>' +
      (connectionPending ? "Входим в ЭОС…" : "Открываем профиль…") + '</h2></section>';
    return;
  }
  const views = { home: overview, courses: coursesPage, works: workBoard, tasks: tasksPage, calendar: calendarPage, grades: gradesPage, settings: settingsPage, course: coursePage, lab: labPage };
  try {
    main.innerHTML = views[page]();
    if (page!=="settings" && page!=="grades" && (expiredSession.eos || (page==="works" && !live))) {
      const banner='<div class="panel session-login"><strong>'+(expiredSession.eos ? "Сессия ЭОС истекла" : "Работы доступны после входа")+
        '</strong>'+button("Войти в ЭОС",'data-action="signIn"'+(connectionPending?" disabled":""),"","primary")+'</div>';
      const heading=main.querySelector(".page-head");
      if (heading) heading.insertAdjacentHTML("afterend",banner);
      else main.insertAdjacentHTML("afterbegin",banner);
    }
    renderDrawer();
    tickBoard();
  } catch {
    main.innerHTML = '<section class="panel"><div class="empty"><strong>Не удалось показать раздел</strong>' +
      'Попробуйте обновить данные.</div><div class="retry">' + button("К обзору", 'data-nav="home"', "back") +
      (live ? button("Обновить данные", 'data-action="refresh"', "refresh") : "") + '</div></section>';
  }
}

function openDialog(title, body) {
  dialog.innerHTML = '<div class="dialog-head"><h2 id="dialog-title">' + escape(title) +
    '</h2><button type="button" class="icon-button" data-action="close" aria-label="Закрыть">' + icon("close") +
    '</button></div>' + body;
  if (!dialog.open) dialog.showModal();
}

function showTask(id) {
  const task = data.tasks.find(item => item.id === id);
  if (!task) return;
  if (sso && labModuleId(task.url)) {
    openLab(task.url, task.name, task.courseId);
    return;
  }
  trackWork(task.courseId,labModuleId(task.url));
  if (page==="home") updateBoard();
  const date = task.due ? dateAndTime.format(new Date(task.due * 1000)) + " мск" : "Срок не указан";
  const status = submissionByTask.get(task.id) ?? task.status;
  openDialog(task.name, '<p class="dialog-meta">' + escape(courseName(task.courseId)) + '<br>' + escape(date) +
    '</p><div class="detail-copy">' + escape(task.description || ("Полное описание доступно в ЭОС.")) + '</div>' +
    (status ? '<p class="dialog-meta dialog-actions" id="submission-status">' + escape(status) + '</p>' :
      live ? '<p class="dialog-meta dialog-actions" id="submission-status">Запрашиваем статус…</p>' : '') +
    '<div class="actions dialog-actions">' +
    (task.url ? button("Открыть в ЭОС", 'data-url="' + escape(task.url) + '"', "external", "primary") : '') +
    (task.courseId > 0 ? button("Открыть курс", 'data-course="' + task.courseId + '"', "chevron") : "") + '</div>');
  dialog.dataset.taskId = String(task.id);
  if (live && !status) loadSubmission(task);
}

async function loadSubmission(task) {
  const { id, url } = task;
  const snapshot = data;
  let status;
  try {
    status = await callHost("submission", { assignmentId: id, url });
    if (data !== snapshot) return;
    submissionByTask.set(id, status);
    updateBoard();
  } catch {
    status = "Статус можно проверить на странице задания в ЭОС.";
  }
  if (dialog.open && dialog.dataset.taskId === String(id)) {
    const output = document.getElementById("submission-status");
    if (output) output.textContent = status;
  }
}

async function loadCourse(id) {
  if (sectionsByCourse.has(id) && !sectionsByCourse.get(id)?.error) return;
  const snapshot = data;
  sectionsByCourse.set(id, null);
  const result = await callHost("course", { courseId: id }).catch(error => ({ error: error.message }));
  if (data !== snapshot) return;
  sectionsByCourse.set(id, result);
  if (page === "course" && courseId === id) render();
}

function searchResults() {
  const container = document.getElementById("search-results");
  const query = document.getElementById("search-box").value.trim().toLocaleLowerCase("ru-RU");
  const matches = (text) => text.toLocaleLowerCase("ru-RU").includes(query);
  const courses = visibleCourses().filter(course => matches(course.name + " " + course.code)).slice(0, query ? 7 : 4);
  const tasks = query ? visibleTasks().filter(task => matches(task.name + " " + courseName(task.courseId))).slice(0, 8) : [];
  container.innerHTML = courses.map(course => '<button class="row" type="button" data-course="' + course.id + '">' +
    tile("courses") + '<span class="row-copy"><strong>' + escape(course.name) + '</strong><small>Курс</small></span>' +
    icon("chevron") + '</button>').concat(tasks.map(task => taskRow(task))).join("") || empty("Ничего не найдено");
}

function showSearch() {
  delete dialog.dataset.taskId;
  openDialog("Поиск", '<input class="input" type="search" id="search-box" autocomplete="off" aria-label="Поисковый запрос" ' +
    'placeholder="' + ("Название курса или задания") +
    '"><div class="search-results" id="search-results" aria-live="polite"></div>');
  document.getElementById("search-box").focus();
  searchResults();
}

let toastTimer;
function toast(message) {
  const element = document.getElementById("toast");
  clearTimeout(toastTimer);
  element.textContent = message;
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 4800);
}

async function openPage(url) {
  try {
    await callHost("open", { url });
  } catch (error) {
    toast(error.message);
  }
}

async function connection(action, args = {}) {
  if (connectionPending) return;
  connectionPending = true;
  render();
  let error;
  try {
    const result = await callHost(action, args);
    if (action === "signIn" && !result) return;
    expiredSession.eos=false;
    live = action === "signIn" || action === "connect" || action === "refresh";
    sso = action === "signIn" || (action === "refresh" && sso);
    data = live ? result : emptyStudyData();
    hiddenCourses = readHiddenCourses();
    showHidden = false;
    updatedAt = live ? Date.now() : 0;
    courseFilter = "";
    courseQuery = "";
    filter = "all";
    resetBoard();
    sectionsByCourse.clear();
    submissionByTask.clear();
    dialog.close();
    if (page==="course" || page==="lab" || (action==="connect" && page!=="settings")) go("home");
    toast(live ? "Данные ЭОС обновлены" : "ЭОС отключена");
  } catch (failure) {
    error = failure.message;
  } finally {
    connectionPending = false;
    render();
    if (error) {
      if (action==="refresh") void checkSession("eos");
      if (action === "connect") document.querySelector(".advanced")?.setAttribute("open", "");
      const feedback = document.getElementById("feedback");
      if (feedback) feedback.textContent = error;
      else toast(error);
    }
  }
}

document.querySelectorAll("[data-icon]").forEach(element => {
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = icon(element.dataset.icon);
});

document.addEventListener("click", event => {
  const element = event.target.closest("button");
  if (!element) return;
  const key = element.dataset;
  if (key.nav) {
    if (key.nav === "tasks") {
      filter = key.filter ?? "all";
      courseFilter = "";
    }
    go(key.nav);
  } else if (key.courseVisibility) toggleCourseVisibility(Number(key.courseVisibility));
  else if (key.switchWork) {
    dialog.close();
    releaseWork();
    showWork(Number(key.subject), Number(key.switchWork));
  }
  else if (key.work) showWork(Number(key.subject), Number(key.work));
  else if (key.mark) openReportMark(key.mark);
  else if (key.editLogin) accountAction("editLogin",{service:key.editLogin});
  else if (key.forgetLogin) accountAction("forgetLogin",{service:key.forgetLogin});
  else if (key.labUrl) openLab(key.labUrl, key.labTitle, courseId);
  else if (key.removeLabFile && lab && !lab.busy) {
    lab.files = lab.files.filter(file => file.key !== key.removeLabFile);
    lab.error = "";
    render();
  }
  else if (key.courseTab) {
    showHidden = key.courseTab === "hidden";
    courseQuery = "";
    render();
    document.querySelector('[data-course-tab="' + key.courseTab + '"]').focus();
  } else if (key.course) go("course", key.course);
  else if (key.task) showTask(Number(key.task));
  else if (key.external || key.url) openPage(official[key.external] ?? key.url);
  else if (key.taskFilter) {
    filter = key.taskFilter;
    render();
    document.querySelector('[data-task-filter="' + filter + '"]').focus();
  } else if (key.day) {
    selected = key.day;
    month = new Date(selected.slice(0, 7) + "-01T00:00:00Z");
    dayExpanded = true;
    render();
    document.querySelector('[data-day="' + selected + '"]').focus();
  } else if (key.month) {
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + Number(key.month), 1));
    const first = utcKey(month);
    const today = dayKey(now());
    selected = first.slice(0, 7) === today.slice(0, 7) ? today : first;
    dayExpanded = false;
    render();
    document.querySelector('[data-month="' + key.month + '"]').focus();
  } else switch (key.action) {
    case "close-work": hideWork(); break;
    case "retry-index": retryIndex(); break;
    case "work-login": {
      const selected = lastTrigger;
      hideWork();
      connection("signIn").then(() => { if (sso && selected) showWork(selected.courseId, selected.id); });
      break;
    }
    case "theme": {
      const mode = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = mode;
      try { localStorage.setItem("campus.theme", mode); } catch {}
      if (bridge) callHost("theme", { mode }).catch(() => {});
      render();
      break;
    }
    case "progress": loadProgress(); break;
    case "load-accounts": accountAction("accounts"); break;
    case "disconnect-lks": disconnectLks(); break;
    case "progress-page": callHost("progressPage").catch(error => toast(error.message)); break;
    case "course-retry": loadCourse(courseId); break;
    case "today":
      selected = dayKey(now());
      month = new Date(selected.slice(0, 7) + "-01T00:00:00Z");
      render();
      document.querySelector('[data-action="today"]')?.focus();
      break;
    case "search": showSearch(); break;
    case "close": dialog.close(); break;
    case "signIn": connection("signIn"); break;
    case "refresh": connection("refresh"); break;
    case "disconnect": connection("disconnect"); break;
    case "lab-back": labBack(); break;
    case "lab-read": if (lab && !lab.busy) readLab(lab); break;
    case "lab-edit": openLabEditor(); break;
    case "lab-choose": stageLab("labChooseFiles"); break;
    case "lab-cancel": cancelLabEditor(); break;
    case "lab-save": saveLabEditor(); break;
  }
});

document.addEventListener("input", event => {
  if (event.target.id === "course-query") {
    courseQuery = event.target.value;
    document.getElementById("course-results").innerHTML = courseResults();
  } else if (event.target.id === "search-box") searchResults();
});
document.addEventListener("change", event => {
  if (event.target.id === "active-account") {
    const id = event.target.value;
    event.target.value = accountsModel.active;
    accountAction("selectAccount",{profileId:id});
    return;
  }
  if (lab && event.target.id === "lab-replace") {
    lab.replace = event.target.checked;
    return;
  }
  if (lab && event.target.id === "lab-statement") {
    lab.statement = event.target.checked;
    render();
    document.getElementById("lab-statement")?.focus();
    return;
  }
  if (event.target.id !== "task-course") return;
  courseFilter = event.target.value;
  render();
  document.getElementById("task-course").focus();
});
document.addEventListener("dragover", event => {
  if (!Array.from(event.dataTransfer.types).includes("Files")) return;
  event.preventDefault();
  if (event.target.closest("[data-drop=lab]") && !lab?.busy) {
    event.dataTransfer.dropEffect = "copy";
    document.getElementById("lab-drop")?.classList.add("dragging");
  } else event.dataTransfer.dropEffect = "none";
});
document.addEventListener("dragleave", event => {
  const target = event.target.closest("[data-drop=lab]");
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("dragging");
});
document.addEventListener("drop", event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  document.getElementById("lab-drop")?.classList.remove("dragging");
  if (event.target.closest("[data-drop=lab]")) stageLab("labDropFiles", Array.from(event.dataTransfer.files));
});
document.addEventListener("submit", event => {
  if (event.target.id === "add-account") {
    event.preventDefault();
    const name = new FormData(event.target).get("name").trim();
    if (name) accountAction("selectAccount",{newName:name});
    return;
  }
  if (event.target.id !== "connect-form") return;
  event.preventDefault();
  const token = new FormData(event.target).get("token");
  event.target.reset();
  connection("connect", { token });
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
    event.preventDefault();
    showSearch();
  }
});
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

if (bridge) callHost("theme", { mode: document.documentElement.dataset.theme }).catch(() => {});
render();
if (bridge) void refreshAcademicCalendar();
if (bridge) void restoreAccount();
document.addEventListener("visibilitychange",()=>{
  if (!document.hidden) { void checkSession("eos"); void checkSession("lks"); }
});

async function restoreAccount() {
  const shell = document.querySelector(".shell");
  shell.inert = true;
  try {
    await accountAction("accounts");
    if (accountsModel) {
      try { localStorage.removeItem("campus.lksPhoto." + accountsModel.active); } catch {}
    }
    if (accountsModel?.eos || accountsModel?.restoreEos) await connection("signIn");
  } finally {
    restoringSession = false;
    shell.inert = false;
    render();
  }
}
