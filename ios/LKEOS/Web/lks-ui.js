let servicesBusy = false;
let servicesError = "";
let lksConnected = false;
const lksViews = {
  schedule: {value:null, busy:false, error:""},
  sessions: {value:null, busy:false, error:""}
};
let selectedSubgroup = 1;
let termFilter = "";

async function loadLksView(view) {
  const state = lksViews[view];
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  render();
  try {
    const value = await callHost(view);
    if (!Array.isArray(view === "schedule" ? value?.schedule : value?.terms))
      throw new Error("ЛКС вернул данные в неизвестном формате.");
    state.value = value;
    if (view === "sessions") {
      lksConnected = true; expiredSession.lks=false;
      if (accountsModel) accountsModel.restoreLks = true;
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    if (page === view || page === "settings") render();
  }
}

async function manageServices(action) {
  if (servicesBusy || connectionPending || reportBusy || lksViews.sessions.busy || lksViews.schedule.busy) return;
  servicesBusy = true;
  servicesError = "";
  const errors = [];
  try {
    const eosAction = action === "login" ? "signIn" : action;
    if (action !== "refresh" || live) {
      const error = await connection(eosAction);
      if (error) errors.push("ЭОС: " + error);
      if (error === "Вход отменён.") return;
    }
    if (action === "disconnect") {
      await disconnectLks();
    } else if (action === "login") {
      report = null;
      reportDate = reportError = termFilter = "";
      Object.assign(lksViews.sessions,{value:null,error:""});
      lksConnected = false;
      try {
        await callHost("connectLks");
        lksConnected = true; expiredSession.lks=false;
        if (accountsModel) accountsModel.restoreLks = true;
      } catch (error) { errors.push("ЛКС: " + error.message); }
    } else {
      if (lksConnected || accountsModel?.restoreLks) {
        await loadProgress();
        await loadLksView("sessions");
        if (lksViews.sessions.error) errors.push("Сессия: " + lksViews.sessions.error);
      }
      await loadLksView("schedule");
      if (lksViews.schedule.error) errors.push("Расписание: " + lksViews.schedule.error);
    }
    if (reportError) errors.push("ЛКС: " + reportError);
  } finally {
    servicesError = errors.join(" ");
    servicesBusy = false;
    render();
  }
}

function lksSection(view) {
  const state = lksViews[view];
  const schedule = view === "schedule";
  const title = labels[view];
  const label = state.busy ? "Загружаем…" : !schedule && expiredSession.lks ? "Войти в ЛКС" : state.value ? "Обновить" : schedule || lksConnected ? "Загрузить" : "Войти в ЛКС";
  const refresh = button(label, 'data-load-lks="'+view+'"'+(state.busy || servicesBusy ? " disabled" : ""), "refresh");
  const subtitle = schedule ? state.value?.title || "Расписание группы" : "Результаты по семестрам";
  const top = header(title, subtitle, refresh) + notice(state.error ? [state.error] : []);
  if (!state.value) return top + '<section class="panel">'+empty(state.busy ? "Загружаем данные ЛКС…" :
    schedule ? "Расписание пока не загружено" : "Войдите в ЛКС для просмотра результатов")+'</section>';
  return top + (schedule ? scheduleTable(state.value) : sessionTables(state.value));
}

function scheduleLesson(lesson) {
  const types = {lab:"Лабораторная", lecture:"Лекция", seminar:"Семинар"};
  const teachers = (lesson.teachers || []).map(t => [t.lastName,t.firstName,t.middleName].filter(Boolean).join(" "));
  const rooms = (lesson.audiences || []).map(a => [a.building,a.name].filter(Boolean).join(" · "));
  const kind = lesson.discipline?.actType;
  return '<div class="lesson"><strong>'+escape(lesson.discipline?.fullName || lesson.discipline?.abbr || "Занятие")+'</strong><small>'+
    escape([types[kind] || kind,...teachers,...rooms].filter(Boolean).join(" · "))+'</small></div>';
}

function scheduleSlot(lessons) {
  const first = lessons[0];
  const time = [first.startTime,first.endTime].filter(Boolean).join("–") || first.time+"-я пара";
  const common = lessons.filter(lesson => lesson.week === "all");
  const split = lessons.some(lesson => lesson.week !== "all");
  const rows = [];
  if (common.length) rows.push('<td colspan="2">'+common.map(scheduleLesson).join("")+'</td>');
  if (split) rows.push(["ch","zn"].map(week => {
    const content = lessons.filter(lesson => lesson.week === week).map(scheduleLesson).join("");
    return '<td>'+ (content || '<span class="free-slot" aria-label="Нет занятия">—</span>') +'</td>';
  }).join(""));
  return '<tbody>'+rows.map((cells,index) => '<tr>'+(index === 0 ? '<th scope="rowgroup" rowspan="'+rows.length+'">'+escape(time)+'</th>' : '')+
    cells+'</tr>').join("")+'</tbody>';
}

function scheduleTable(group) {
  const days = ["Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье"];
  const schedule = [];
  let subgroupCount = 1;
  for (const lesson of group.schedule) {
    const streams = lesson.stream?.groups || [];
    const matches = streams.filter(g => g.groupUuid === group.uuid);
    if (streams.length && !matches.length) continue;
    for (const g of matches) subgroupCount = Math.max(subgroupCount, Number(g.sub1) || 0, Number(g.sub2) || 0);
    schedule.push({lesson,matches});
  }
  if (selectedSubgroup > subgroupCount) selectedSubgroup = 1;
  const visible = schedule.filter(({matches}) => !matches.length ||
    matches.some(g => !Number(g.sub1) || Number(g.sub1) === selectedSubgroup)).map(item=>item.lesson);
  const filters = subgroupCount > 1 ? '<div class="tabs subgroup-tabs" role="group" aria-label="Подгруппа">'+
    Array.from({length:subgroupCount}, (_,i) => {
      const n = i+1;
      return '<button type="button" class="tab '+(selectedSubgroup===n?"active":"")+'" aria-pressed="'+(selectedSubgroup===n)+
        '" data-subgroup="'+n+'">Подгруппа '+n+'</button>';
    }).join("")+'</div>' : "";
  const tables = days.map((day,index) => {
    const slots = new Map();
    const lessons = visible.filter(item => Number(item.day) === index+1).sort((a,b) => Number(a.time)-Number(b.time));
    for (const lesson of lessons) {
      const key = [lesson.time,lesson.startTime,lesson.endTime].join("/");
      if (!slots.has(key)) slots.set(key,[]);
      slots.get(key).push(lesson);
    }
    if (!slots.size) return "";
    return '<section class="panel"><div class="panel-head"><h2>'+day+'</h2></div><table class="schedule-table" aria-label="'+day+
      '"><colgroup><col class="schedule-time"><col><col></colgroup><thead><tr><th scope="col">Время</th><th scope="col">Числитель</th>'+
      '<th scope="col">Знаменатель</th></tr></thead>'+Array.from(slots.values(),scheduleSlot).join("")+'</table></section>';
  }).join("");
  return '<div class="content-stack">'+filters+(tables || '<section class="panel">'+empty("Для этой подгруппы занятий нет")+'</section>')+'</div>';
}

function sessionTables(value) {
  const terms = [...value.terms].filter(Boolean).sort((a,b)=>Number(b.term)-Number(a.term));
  if (!terms.length) return '<section class="panel">'+empty("В ЛКС пока нет результатов сессий")+'</section>';
  if (!terms.some(row=>String(row.term)===termFilter)) termFilter="";
  const select = '<label class="session-filter">Семестр <select id="session-term" class="input"><option value="">Все семестры</option>'+
    terms.map(t=>'<option value="'+escape(t.term)+'"'+(String(t.term)===termFilter?' selected':'')+'>Семестр '+escape(t.term)+'</option>').join("")+'</select></label>';
  const stamp = formatReportDate(value.date);
  return (stamp ? '<p class="report-stamp">Данные актуальны на '+escape(stamp)+' мск</p>' : '') +
    '<div class="content-stack">'+select+terms.filter(t=>!termFilter || termFilter===String(t.term)).map(term=>
    '<section class="panel"><div class="panel-head"><h2>Семестр '+escape(term.term)+'</h2></div>'+
    (term.marks?.length ? '<div class="report-scroll"><table class="session-table"><thead><tr><th>Дисциплина</th><th>Часы</th><th>Оценка</th></tr></thead><tbody>'+
      term.marks.map(m=>'<tr><td>'+escape(m.disciplineName)+'<small>'+escape([m.disciplineDepartment,m.testTitleShort].filter(Boolean).join(" · "))+'</small></td><td>'+
        escape(m.audlek ?? "—")+'</td><td>'+escape(m.title || m.mark || "—")+'</td></tr>').join("")+'</tbody></table></div>' : empty("Оценок пока нет"))+'</section>').join("")+'</div>';
}
