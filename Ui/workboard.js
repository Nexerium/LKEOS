// Loaded before the dashboard. Moodle module IDs are shared by the course index and the calendar.
const workIndexes = new Map();
let boardGeneration = 0;
let boardJobs = 0;
let boardWork = null;
let drawerVisible = false;
let drawerEntered = false;
let lastTrigger = null;
const workDrawer = document.getElementById("work-drawer");
let recentWorks = [];
let completionMarks = new Map();
let hiddenSubjects = new Set();

function boardStorageKey(group) {
  return "campus." + group + "." + JSON.stringify([accountsModel?.active ?? "", data.accountKey ?? data.name]);
}

function trackWork(courseId, id) {
  if (!live || !courseId || !id) return;
  recentWorks = [{courseId,id}, ...recentWorks.filter(item=>item.courseId!==courseId || item.id!==id)].slice(0,32);
  try { localStorage.setItem(boardStorageKey("recentWorks"),JSON.stringify(recentWorks)); } catch {}
}

function resetBoard() {
  ++boardGeneration;
  workIndexes.clear();
  recentWorks = [];
  hiddenSubjects = new Set();
  if (live) try {
    const stored = JSON.parse(localStorage.getItem(boardStorageKey("hiddenSubjects")) || "[]");
    if (Array.isArray(stored)) hiddenSubjects = new Set(stored.filter(Number.isSafeInteger));
  } catch {}
  completionMarks = new Map();
  if (live) try {
    completionMarks = new Map(JSON.parse(localStorage.getItem(boardStorageKey("completion")) || "[]"));
  } catch {}
  if (live) try {
    const stored = JSON.parse(localStorage.getItem(boardStorageKey("recentWorks")) || "[]");
    if (Array.isArray(stored)) recentWorks = stored.filter(item=>Number.isSafeInteger(item?.courseId) && Number.isSafeInteger(item.id)).slice(0,32);
  } catch {}
  if (boardWork) releaseWork();
}

function tickBoard() {
  if (!sso || !live || !["home","works"].includes(page) || restoringSession || connectionPending) return;
  const missing = visibleCourses().filter(c => !workIndexes.has(c.id) &&
    (page === "works" ? !hiddenSubjects.has(c.id) : recentWorks.some(item=>item.courseId===c.id)));
  for (const course of missing.slice(0, Math.max(0, 2-boardJobs))) {
    const generation = boardGeneration;
    ++boardJobs;
    workIndexes.set(course.id,{loading:true});
    callHost("workIndex",{courseId:course.id}).then(index => {
      if (generation !== boardGeneration) return;
      if (!Array.isArray(index?.works)) throw new Error("Формат списка работ изменился.");
      workIndexes.set(course.id,index);
    }).catch(() => {
      if (generation === boardGeneration) workIndexes.set(course.id,{failed:true});
    }).finally(() => {
      --boardJobs;
      updateBoard();
      tickBoard();
    });
  }
}

function worksFor(course) {
  const works = new Map();
  const index = workIndexes.get(course.id);
  for (const entry of index?.works || []) {
    if (Number.isSafeInteger(entry.id) && entry.id > 0 && officialLink(entry.url))
      works.set(entry.id,{...entry, courseId:course.id});
  }
  for (const task of data.tasks) {
    if (task.courseId !== course.id) continue;
    const id = labModuleId(task.url);
    if (!id) continue;
    const entry = works.get(id);
    const due = task.due ? dateAndTime.format(new Date(task.due*1000)) : "";
    if (entry) { entry.taskId=task.id; entry.due ||= due; }
    else works.set(id,{id, courseId:course.id, taskId:task.id, name:task.name, url:task.url, kind:"assign",
      section:"", status:submissionByTask.get(task.id) || task.status || "", due, instructions:task.description || ""});
  }
  return [...works.values()];
}

function workLabel(entry) {
  const pattern=/(?:^|[^\p{L}])(?:(л[.\s]*р|лабораторн\p{L}*)(?:\s+(?:работ\p{L}*|заняти\p{L}*))?|(п[.\s]*р|практикум\p{L}*|практик[ауи]?|практическ\p{L}*)(?:\s+(?:работ\p{L}*|заняти\p{L}*))?)(?!\p{L})[.\s№#:\-]*(\d+(?:[.]\d+)*)?/iu;
  const match=pattern.exec(entry.name) || pattern.exec(entry.section || "");
  return match ? (match[1] ? "ЛР" : "ПР") + (match[3] ? " "+match[3] : "") : "Задание";
}

function workStatus(entry) {
  const grade = entry.grade?.trim() || "";
  const text = entry.status || "";
  const pending = /не\s+(сдан|отправл|представ|оцен|выполн)|нет ответа|not (submitted|graded)|no submission/i.test(text);
  const submitted = !pending && /сдан|отправлен|представлен|submitted/i.test(text);
  const graded = /^\s*\d/.test(grade);
  return {submitted, done:graded || submitted || (!pending && /оценено|graded/i.test(text)),
    text:(graded ? grade : text) || "Статус не указан"};
}

function completionControl(key, name, status, course = false) {
  const checked = completionMarks.get(key) ?? status.done;
  const hint = course ? "Личная отметка о закрытии предмета" :
    (completionMarks.has(key) ? "Личная отметка. " : "") + "ЭОС: " + status.text;
  return '<label class="completion-control" title="'+escape(hint)+'"><input type="checkbox" data-completion="'+key+
    '" data-mark-name="'+escape(name)+'" data-submitted="'+(status.submitted === true)+'" aria-label="'+escape((course ? "Предмет закрыт: " : "Работа выполнена: ")+name)+
    '"'+(checked ? " checked" : "")+'><span class="check-box" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none">'+
    '<path d="M3.5 8 6.5 11 12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'+
    (course ? '<span class="course-mark-label">'+(checked ? "Предмет закрыт" : "Закрыть предмет")+'</span>' : "")+'</label>';
}

function workCheck(work) {
  return completionControl(work.courseId+"."+work.id, work.name, workStatus(work));
}

function courseCheck(course) {
  return completionControl(String(course.id), course.name, {done:false}, true);
}

function changeCompletion(input) {
  const {completion:key, markName:name, submitted} = input.dataset;
  const checked = input.checked;
  input.checked = !checked;
  const course = !key.includes(".");
  if (!course && submitted === "true") {
    saveCompletion(key, checked);
    document.querySelector('[data-completion="'+key+'"]')?.focus({preventScroll:true});
    return;
  }
  const action = course ? (checked ? "Закрыть предмет" : "Открыть предмет снова") :
    (checked ? "Отметить выполненной" : "Снять отметку");
  const title = course ? action+"?" : checked ? "Отметить работу выполненной?" : "Снять отметку о выполнении?";
  const detail = course ? "Изменится личная отметка предмета в вашем профиле." :
    "В ЭОС нет подтверждения отправки ответа. Изменится только ваша личная отметка.";
  openDialog(title, '<p class="confirm-subject">'+escape(name)+'</p><p class="dialog-meta">'+detail+'</p><div class="actions">'+
    button("Отмена",'data-action="close"',"")+
    button(action,'data-confirm-mark="'+key+'" data-checked="'+checked+'"',"","primary")+'</div>');
  dialog.querySelector('.actions [data-action="close"]').focus();
}

function saveCompletion(key, value) {
  const marks = new Map(completionMarks);
  if (value === null) marks.delete(key);
  else marks.set(key, value);
  try {
    localStorage.setItem(boardStorageKey("completion"), JSON.stringify([...marks]));
    completionMarks = marks;
  } catch {
    toast("Не удалось сохранить отметку на этом компьютере.");
    return false;
  }
  updateBoard();
  return true;
}

function recentBody() {
  if (!live) return empty("Войдите в ЭОС, чтобы увидеть работы");
  const courses = new Map(visibleCourses().map(course=>[course.id,course]));
  const rows = [];
  let loading = false, incomplete = false;
  for (const {courseId,id} of recentWorks) {
    const course = courses.get(courseId);
    if (!course) continue;
    const index = workIndexes.get(courseId);
    loading ||= sso && (!index || !!index.loading);
    incomplete ||= !!(index?.failed || index?.partial);
    const work = worksFor(course).find(item=>item.id===id);
    if (!work) continue;
    const sectionLabel = workLabel({name:"",section:work.section});
    const name = workLabel({name:work.name})==="Задание" && sectionLabel!=="Задание" ? sectionLabel+" · "+work.name : work.name;
    rows.push('<div class="recent-item"><button type="button" class="recent-row" data-work="'+id+'" data-subject="'+courseId+'" aria-haspopup="dialog">'+
      '<span class="recent-copy"><strong>'+escape(name)+'</strong><small>'+escape(course.name)+'</small></span></button>'+workCheck(work)+'</div>');
    if (rows.length === 5) break;
  }
  return rows.join("") + (incomplete ? '<p class="board-note">Не все работы загрузились. '+button("Повторить",'data-action="retry-index"',"refresh","ghost")+'</p>' :
    !rows.length ? empty(loading ? "Загружаем недавние работы…" : "Пока нет открытых работ", loading ? "" : "Откройте лабораторную или практику в разделе «Мои работы».") : "");
}

function recentPanel() {
  return '<section class="panel recent-panel"><div class="panel-head"><h2>Недавние работы</h2>'+
    button("Все работы",'data-nav="works"',"chevron","ghost")+'</div><div id="recent-works">'+recentBody()+'</div></section>';
}

function workBoardBody() {
  if (!live) return empty("Войдите в ЭОС, чтобы увидеть работы");
  let rows = "", loading = false, incomplete = false;
  for (const course of visibleCourses()) {
    if (hiddenSubjects.has(course.id)) continue;
    const index = workIndexes.get(course.id);
    loading ||= sso && (!index || !!index.loading);
    incomplete ||= !!(index?.failed || index?.partial);
    const works = worksFor(course);
    works.forEach((work,i) => {
      const label=workLabel(work);
      rows += '<tr>' + (i ? '' : '<th scope="rowgroup" rowspan="'+works.length+'"><div class="subject-heading"><span>'+escape(course.name)+
        '</span><button class="icon-button" type="button" data-hide-subject="'+course.id+'" title="Скрыть из моих работ" aria-label="'+
        escape("Скрыть предмет «"+course.name+"»")+'">'+icon("hide")+'</button></div>'+courseCheck(course)+'</th>') +
        '<td><button class="work-link" data-work="'+work.id+'" data-subject="'+course.id+'" aria-haspopup="dialog" aria-label="'+
        escape(label+" · "+work.name)+'"><strong>'+escape(label)+'</strong>' +
        (label.toLowerCase() !== work.name.toLowerCase() ? '<span>'+escape(work.name)+'</span>' : '')+'</button></td>' +
        '<td class="work-state">'+workCheck(work)+'</td></tr>';
    });
    if (works.length) rows += '</tbody><tbody>';
  }
  const table = rows ? '<div class="work-table-scroll"><table class="work-table"><thead><tr><th>Предмет</th><th>Работа</th><th aria-label="Состояние">Статус</th></tr></thead><tbody>'+
    rows.replace(/<\/tbody><tbody>$/,'')+'</tbody></table></div>' : '';
  return table + (loading ? '<p class="board-note" role="status">Загружаем работы из курсов…</p>' : '') +
    (incomplete ? '<p class="board-note" role="status">ЭОС вернула неполный список. '+button("Повторить",'data-action="retry-index"',"refresh","ghost")+'</p>' : '') +
    (!table && !loading && !incomplete ? empty("Работ в видимых курсах пока нет") : '');
}

function workBoard() {
  const hidden = live ? visibleCourses().filter(course=>hiddenSubjects.has(course.id)).length : 0;
  const restore = hidden ? button("Скрытые предметы · "+hidden,'data-action="hidden-subjects"',"eye") : "";
  return header("Мои работы","",restore)+'<section class="panel work-board"><div id="work-rows">'+workBoardBody()+'</div></section>';
}

function setSubjectHidden(id, hidden) {
  const next = new Set(hiddenSubjects);
  if (hidden) next.add(id);
  else next.delete(id);
  try { localStorage.setItem(boardStorageKey("hiddenSubjects"), JSON.stringify([...next])); }
  catch { toast("Не удалось сохранить видимость предмета."); return false; }
  hiddenSubjects = next;
  if (hidden && boardWork?.courseId === id) hideWork(false);
  render();
  return true;
}

function showHiddenSubjects() {
  const rows = visibleCourses().filter(course=>hiddenSubjects.has(course.id)).map(course=>'<div class="hidden-subject"><span>'+escape(course.name)+'</span>'+
    button("Вернуть",'data-restore-subject="'+course.id+'" aria-label="'+escape("Вернуть предмет «"+course.name+"»")+'"',"eye","ghost")+'</div>');
  if (rows.length) openDialog("Скрытые предметы", rows.join(""));
  else dialog.close();
}
function updateBoard() {
  const body=document.getElementById(page==="home" ? "recent-works" : "work-rows");
  if (!body) return;
  const active=body.contains(document.activeElement) ? document.activeElement.dataset : {};
  body.innerHTML=page==="home" ? recentBody() : workBoardBody();
  if (active.work) body.querySelector('[data-work="'+active.work+'"]')?.focus({preventScroll:true});
  if (active.completion) body.querySelector('[data-completion="'+active.completion+'"]')?.focus({preventScroll:true});
}
function retryIndex() {
  for (const [id,index] of workIndexes) if (index.failed || index.partial) workIndexes.delete(id);
  updateBoard(); tickBoard();
}

function releaseWork() {
  hideWork(false);
  if (lab?.from === "board") labLeave();
  boardWork=null;
  workDrawer.querySelector(".work-body").replaceChildren();
}
function hideWork(restoreFocus=true) {
  drawerVisible=false; drawerEntered=false; workDrawer.hidden=true;
  if (restoreFocus && lastTrigger)
    document.querySelector('[data-subject="'+lastTrigger.courseId+'"][data-work="'+lastTrigger.id+'"]')?.focus({preventScroll:true});
}
function rememberState(current) {
  if (!current.details?.fields) return;
  const index=workIndexes.get(current.parentId);
  const entry=index?.works?.find(w=>w.id===current.id);
  if (!entry) return;
  const field=regex=>current.details.fields.find(f=>regex.test(f.label))?.text;
  entry.grade=field(/^(оценка|grade)$/i) || entry.grade;
  entry.status=field(/состояние ответа|submission status/i) || entry.status;
  if (boardWork?.id === current.id) Object.assign(boardWork,{grade:entry.grade,status:entry.status});
}

async function showWork(courseId,id) {
  const course=visibleCourses().find(c=>c.id===courseId);
  const work=course && worksFor(course).find(w=>w.id===id);
  if (!work || lab?.busy==="save" || lab?.busy==="pick" || lab?.busy==="edit") return;
  const same=boardWork?.id===id && boardWork.courseId===courseId;
  if (!same && lab?.files.length) {
    openDialog("Перейти к другой работе?",'<p>В текущем ответе есть выбранные файлы. При переходе выбор придётся повторить.</p><div class="actions">'+
      button("Остаться",'data-action="close"',"") + button("Перейти",'data-switch-work="'+id+'" data-subject="'+courseId+'"',"chevron")+'</div>');
    return;
  }
  if (!same) { releaseWork(); boardWork=work; }
  trackWork(courseId,id);
  if (page==="home") updateBoard();
  lastTrigger={courseId,id};
  drawerVisible=true; drawerEntered=false; workDrawer.hidden=false;
  const needsLab=sso && work.kind==="assign";
  if (!same && needsLab) {
    lab={id,parentId:courseId,title:work.name,from:"board",details:null,editor:null,files:[],busy:"",error:"",saved:false,replace:false,statement:false};
  }
  renderDrawer(); workDrawer.scrollTop=0;
  workDrawer.querySelector("[data-action=close-work]").focus({preventScroll:true});
  if (same) return;
  if (needsLab) { await readLab(lab); return; }
  try {
    if (sso) Object.assign(work, await callHost("activityInfo",{url:work.url}));
    else if (work.taskId) work.status=await callHost("submission",{assignmentId:work.taskId,url:work.url});
  } catch(error) {work.error=error.message;}
  if (boardWork===work) renderDrawer();
}

function workFacts() {
  const work=boardWork;
  const course=data.courses.find(c=>c.id===work.courseId);
  const teachers=[...new Set([...(course?.teachers || []), ...(workIndexes.get(work.courseId)?.teachers || [])])];
  const info=lab?.from==="board" ? lab.details : work;
  const facts=[];
  for (const text of info?.dates || []) {
    const split=text.match(/^([^:·]+?)\s*[:·]\s*(.+)$/);
    facts.push(split ? [split[1],split[2]] : ["Дата",text]);
  }
  if (work.due && !info?.dates?.some(t=>/срок|due/i.test(t))) facts.push(["Срок сдачи",work.due]);
  const fields=info?.fields || [];
  const grade=fields.find(f=>/^(оценка|grade)$/i.test(f.label))?.text || work.grade;
  const state=fields.find(f=>/состояние ответа|submission status/i.test(f.label))?.text || work.status;
  if (grade) facts.push(["Оценка",grade]);
  if (state) facts.push(["Ответ",state]);
  if (teachers.length) facts.push(["Преподаватели",teachers.join(", ")]);
  const grader=fields.find(f=>/^(оценено|оценил[аи]?|проверил[аи]?|graded by)$/i.test(f.label))?.text;
  if (grader) facts.push(["Проверил работу",grader]);
  return facts.length ? '<dl class="panel work-facts">'+facts.map(([k,v])=>'<div><dt>'+escape(k)+'</dt><dd>'+escape(v)+'</dd></div>').join("")+'</dl>' : '';
}

function renderDrawer() {
  if (!drawerVisible || !boardWork) return;
  const work=boardWork;
  workDrawer.querySelector(".work-caption").textContent=courseName(work.courseId);
  const body=workDrawer.querySelector(".work-body");
  if (lab?.from==="board") body.innerHTML=labPage();
  else body.innerHTML='<h2>'+escape(work.name)+'</h2>'+workFacts()+
    (work.instructions ? '<p class="detail-copy">'+escape(work.instructions)+'</p>' : '')+
    labFileList(work.materials || [],"Материал преподавателя")+
    (work.error?'<p role="alert">'+escape(work.error)+'</p>':'')+
    (sso ? button("Открыть в ЭОС",'data-url="'+escape(work.url)+'"',"external") :
      button("Войти через МГТУ для сдачи файлов",'data-action="work-login"',"person"));
  const key=work.courseId+"."+work.id;
  if (completionMarks.has(key)) body.insertAdjacentHTML("beforeend", '<div class="actions">'+
    button("Вернуть отметку из ЭОС",'data-reset-completion="'+key+'"',"refresh","ghost")+'</div>');
}

workDrawer.addEventListener("pointermove",e=>{if(e.pointerType==="mouse" && drawerVisible) drawerEntered=true;});
workDrawer.addEventListener("pointerleave",e=>{
  if(e.pointerType==="mouse" && drawerVisible && drawerEntered && !dialog.open && !["pick","save"].includes(lab?.busy)) hideWork();
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape" && drawerVisible && !dialog.open) {event.preventDefault(); hideWork();}
});

