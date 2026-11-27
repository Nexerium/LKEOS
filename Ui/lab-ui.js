let lab = null;

function labModuleId(url) {
  if (!officialLink(url)) return 0;
  const parsed = new URL(url);
  const id = Number(parsed.searchParams.get("id"));
  return parsed.pathname === "/kaluga/mod/assign/view.php" && Number.isSafeInteger(id) && id > 0 ? id : 0;
}

async function openLab(url, title, parentId) {
  const id = labModuleId(url);
  if (!sso || !id || lab?.busy === "save") return;
  const current = {
    id, parentId, title, from: page === "course" ? "course" : page === "tasks" ? "tasks" : "home",
    details: null, editor: null, files: [], busy: "", error: "", saved: false, replace: false, statement: false
  };
  trackWork(parentId,id);
  lab = current;
  go("lab");
  await readLab(current);
}

async function readLab(current) {
  current.busy = "read";
  current.error = "";
  render();
  try {
    current.details = await callHost("labDetails", { assignmentId: current.id });
    if (lab === current) rememberState(current);
  } catch (error) {
    current.error = error.message;
  } finally {
    current.busy = "";
    if (lab === current) render();
  }
}

function labLeave() {
  if (!lab) return;
  if (lab.editor || lab.busy === "edit")
    callHost("labDiscard", { assignmentId: lab.id }).catch(() => {});
  lab = null;
}

function labBack() {
  if (!lab || lab.busy === "save") return;
  go(lab.from === "course" && lab.parentId ? "course" : lab.from, lab.parentId);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " Б";
  const unit = bytes < 1024 * 1024 ? "КБ" : "МБ";
  const value = bytes / (unit === "КБ" ? 1024 : 1024 * 1024);
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value) + " " + unit;
}

function labFileList(files, label) {
  return files.length ? files.map(file =>
    '<div class="lab-file-row">' + tile("file") + '<div class="row-copy"><strong>' + escape(file.name) +
    '</strong><small>' + label + '</small></div>' +
    (officialLink(file.url) ? '<button type="button" class="icon-button" data-url="' + escape(file.url) +
      '" aria-label="' + escape("Открыть " + file.name) + '">' + icon("download") + '</button>' : '') + '</div>'
  ).join("") : "";
}

function labPage() {
  if (!lab) return empty("Лабораторная не найдена");
  const details = lab.details;
  const course = details?.course || (lab.parentId ? courseName(lab.parentId) : "");
  const error = lab.error ? '<div class="notice" role="alert">' + escape(lab.error) + '</div>' : "";
  const back = lab.from === "board" ? "" : '<button type="button" class="button ghost lab-back" data-action="lab-back"' +
    (lab.busy === "save" ? " disabled" : "") + '>' + icon("back") + escape(lab.from === "course" ? "К курсу" : "Назад") + '</button>';
  const banner = '<section class="lab-title"><div class="lab-title-icon">' + icon("lab") + '</div><div>' +
    (course ? '<p>' + escape(course) + '</p>' : "") +
    '<h1>' + escape(details?.title ?? lab.title) + '</h1></div></section>';
  const compact = lab.from === "board";
  if (!details) return back + banner + (compact ? workFacts() : "") + error + '<section class="panel">' +
    (lab.busy ? empty("Загружаем лабораторную…") : '<div class="empty">' +
      button("Повторить", 'data-action="lab-read"', "refresh") + '</div>') + '</section>';

  const materials = labFileList(details.materials, "Материал преподавателя");
  const instructions = details.instructions || materials ? '<section class="panel lab-panel"><h2>Условие работы</h2>' +
    (details.instructions ? '<div class="detail-copy">' + escape(details.instructions) + '</div>' : "") +
    materials + '</section>' : "";
  const rows = details.fields.map(field => '<div><dt>' + escape(field.label) + '</dt><dd>' + escape(field.text) + '</dd></div>');
  const status = '<aside class="panel lab-panel lab-aside"><h2>Состояние ответа</h2>' +
    (details.dates.length ? '<div class="lab-dates">' + details.dates.map(date => '<div>' + icon("calendar") +
      '<span>' + escape(date) + '</span></div>').join("") + '</div>' : '') +
    (rows.length ? '<dl class="lab-status">' + rows.join("") + '</dl>' : '<p class="detail-copy">ЭОС не указала состояние.</p>') +
    button("Обновить", 'data-action="lab-read"' + (lab.busy || lab.editor ? " disabled" : ""), "refresh", "ghost") +
    '</aside>';
  const attachments = labFileList(details.files, "В ответе ЭОС");
  const filePanel = '<section class="panel lab-panel"><div class="lab-section-head"><div><h2>Файлы ответа</h2><p>' +
    (details.files.length ? details.files.length + " " + count(details.files.length, ["файл", "файла", "файлов"]) :
      "Прикреплённых файлов пока нет") +
    '</p></div>' + (details.canEdit && !lab.editor ? button(details.files.length ? "Редактировать ответ" : "Добавить файлы",
      'data-action="lab-edit"' + (lab.busy ? " disabled" : ""), "edit", "primary") : "") + '</div>' +
    (attachments ? '<div class="lab-file-list">' + attachments + '</div>' : "") +
    (lab.saved ? '<div class="lab-saved" role="status">' + icon("check") +
      (details.canSubmit ? "Файлы сохранены. ЭОС ожидает отдельного подтверждения сдачи." : "Файлы сохранены в ответе ЭОС.") +
      '</div>' : "") +
    (lab.busy === "edit" ? '<p class="detail-copy">Читаем настройки файлового поля…</p>' : "") +
    (lab.editor ? renderLabEditor() : "") +
    (!details.canEdit && !lab.editor ? '<p class="detail-copy">Редактирование закрыто в ЭОС.</p>' : "") +
    error + '</section>';
  if (compact) return banner + workFacts() +
    (materials ? '<section class="panel lab-panel"><h2>Методички и материалы</h2>' + materials + '</section>' : '') +
    filePanel + (details.instructions ? '<details class="panel work-more"><summary>Условие работы</summary><p class="detail-copy">' +
      escape(details.instructions) + '</p></details>' : '') +
    '<details class="panel work-more"><summary>Все сведения об ответе</summary>' + status + '</details>';
  return back + banner + '<div class="lab-layout"><div class="content-stack">' + instructions + filePanel + '</div>' + status + '</div>';
}

function renderLabEditor() {
  const editor = lab.editor;
  const options = [];
  if (editor.maxBytes > 0) options.push("До " + formatBytes(editor.maxBytes) + " на файл");
  if (editor.maxFiles > 0) options.push("Файлов в ответе " + editor.fileCount + " из " + editor.maxFiles);
  const types = editor.types.filter(type => type && type !== "*");
  if (types.length) options.push(types.join(", "));
  const canReplace = lab.files.some(file => lab.details.files.some(existing => existing.name === file.name));
  const disabled = lab.busy ? " disabled" : "";
  const queued = lab.files.map(file => '<div class="lab-file-row queued">' + tile("file", "purple") +
    '<div class="row-copy"><strong>' + escape(file.name) + '</strong><small>' + formatBytes(file.size) +
    '</small></div><button class="icon-button" type="button" data-remove-lab-file="' + escape(file.key) +
    '" aria-label="' + escape("Убрать " + file.name) + '"' + disabled + '>' + icon("close") + '</button></div>');
  return '<div class="lab-editor"><div class="lab-drop" id="lab-drop" data-drop="lab"><div class="lab-upload-icon">' +
    icon("upload") + '</div><strong>Перетащите файлы сюда</strong>' +
    button("Выбрать файлы", 'data-action="lab-choose"' + disabled, "plus") +
    (options.length ? '<div class="lab-limits">' + options.map(option => '<span>' + escape(option) + '</span>').join("") + '</div>' : "") +
    '</div>' +
    (queued.length ? '<div class="lab-queue"><h3>К сохранению · ' + queued.length + '</h3><div class="lab-file-list">' +
      queued.join("") + '</div></div>' : "") +
    (canReplace ? '<label class="lab-check"><input type="checkbox" id="lab-replace"' +
      (lab.replace ? " checked" : "") + disabled + '> Заменить одноимённые вложения в ответе</label>' : "") +
    (editor.statement ? '<label class="lab-check"><input type="checkbox" id="lab-statement"' +
      (lab.statement ? " checked" : "") + disabled + '> ' + escape(editor.statement) + '</label>' : "") +
    '<div class="lab-savebar"><p>' + (lab.busy === "save" ? "ЭОС загружает файлы. Оставьте это окно открытым." :
      "Выбранные файлы отправятся при сохранении ответа.") + '</p><div class="actions">' +
    button("Отмена", 'data-action="lab-cancel"' + disabled, "") +
    button(lab.busy === "save" ? "Сохраняем…" : "Сохранить ответ",
      'data-action="lab-save"' + (lab.files.length && !lab.busy && (!editor.statement || lab.statement) ? "" : " disabled"),
      "check", "primary") + '</div></div></div>';
}

async function openLabEditor() {
  if (!lab || lab.busy || lab.editor) return;
  const current = lab;
  current.busy = "edit";
  current.saved = false;
  current.error = "";
  render();
  try {
    current.editor = await callHost("labEditor", { assignmentId: current.id });
    if (lab !== current) callHost("labDiscard", { assignmentId: current.id }).catch(() => {});
  } catch (error) {
    current.error = error.message;
  } finally {
    current.busy = "";
    if (lab === current) render();
  }
}

async function stageLab(action, dropped) {
  if (!lab?.editor || lab.busy) return;
  const current = lab;
  current.busy = "pick";
  current.error = "";
  render();
  try {
    const chosen = await callHost(action, { assignmentId: current.id }, dropped);
    const skipped = [];
    for (const file of chosen) {
      if ((current.editor.maxBytes > 0 && file.size > current.editor.maxBytes) ||
          current.files.some(queued => queued.name.toLowerCase() === file.name.toLowerCase())) skipped.push(file.name);
      else current.files.push(file);
    }
    if (skipped.length) current.error = "Превышен лимит размера или имя повторяется. Пропущены " + skipped.join(", ") + ".";
  } catch (error) {
    current.error = error.message;
  } finally {
    current.busy = "";
    if (lab === current) render();
  }
}

function cancelLabEditor() {
  if (!lab?.editor || lab.busy) return;
  callHost("labDiscard", { assignmentId: lab.id }).catch(() => {});
  Object.assign(lab, { editor: null, files: [], replace: false, statement: false, error: "" });
  render();
}

async function saveLabEditor() {
  if (!lab?.editor || !lab.files.length || lab.busy) return;
  const current = lab;
  current.busy = "save";
  current.error = "";
  render();
  try {
    const result = await callHost("labSave", {
      assignmentId: current.id, files: current.files.map(file => file.key),
      replace: current.replace, statement: current.statement, statementText: current.editor.statement
    });
    Object.assign(current, { details: result, editor: null, files: [], replace: false, statement: false, saved: true });
    if (lab === current) rememberState(current);
  } catch (error) {
    current.error = error.message;
  } finally {
    current.busy = "";
    if (lab === current) render();
  }
}
