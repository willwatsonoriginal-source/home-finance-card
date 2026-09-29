/*
 * Family Calendar Card for Home Assistant
 * A dependency-free month grid with compact, individually styled calendar events.
 * Add this file as a dashboard resource with type: JavaScript module.
 */
class FamilyCalendarCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this._week = new Date();
    this._view = "month";
    this._enabledEntities = new Set();
    this._calendarMenuOpen = false;
    this._events = [];
    this._loading = false;
    this._error = "";
    this._lastFetch = 0;
    this._request = 0;
    this._refreshTimer = window.setInterval(() => this._fetchEvents(), 5 * 60 * 1000);
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("Add at least one calendar entity, for example calendar.family.");
    }
    this._config = {
      title: "Family Calendar",
      entities: config.entities,
      show_adjacent_days: config.show_adjacent_days !== false,
      max_events_per_day: Number(config.max_events_per_day || 5),
      max_events_per_day_week: Number(config.max_events_per_day_week || 12),
      ...config,
    };
    const storageKey = `family-calendar-card:${config.storage_key || config.title || "default"}:${config.entities.join("|")}`;
    if (this._storageKey !== storageKey) {
      this._storageKey = storageKey;
      try {
        const savedEntities = JSON.parse(localStorage.getItem(`${storageKey}:entities`) || "null");
        const validSaved = Array.isArray(savedEntities)
          ? savedEntities.filter(entity => config.entities.includes(entity))
          : [];
        this._enabledEntities = new Set(validSaved.length ? validSaved : config.entities);
        const savedView = localStorage.getItem(`${storageKey}:view`);
        this._view = savedView === "week" ? "week" : "month";
      } catch (_) {
        this._enabledEntities = new Set(config.entities);
      }
    }
    this._render();
    this._fetchEvents();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && !this._lastFetch && !this._loading) this._fetchEvents();
  }

  get hass() { return this._hass; }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 6, min_rows: 4, max_rows: 12 };
  }

  getCardSize() { return 6; }

  connectedCallback() {
    if (!this._refreshTimer) this._refreshTimer = window.setInterval(() => this._fetchEvents(), 5 * 60 * 1000);
    if (this._config) this._render();
  }

  disconnectedCallback() {
    if (this._refreshTimer) window.clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }

  _dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  _parseDate(value) {
    if (!value) return null;
    // Calendar all-day values are date-only; parse them as local dates.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    const date = new Date(value.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  _visibleRange() {
    if (this._view === "week") {
      const start = new Date(this._week.getFullYear(), this._week.getMonth(), this._week.getDate());
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const startLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start);
      const endLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1));
      return { start, end, cells: 7, rows: 1, label: `${startLabel} – ${endLabel}` };
    }

    const first = new Date(this._month.getFullYear(), this._month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const rows = Math.ceil((first.getDay() + daysInMonth) / 7);
    const end = new Date(start);
    end.setDate(end.getDate() + rows * 7);
    const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first);
    return { start, end, cells: rows * 7, rows, label };
  }

  _calendarName(entity) {
    const friendly = this._hass?.states?.[entity]?.attributes?.friendly_name;
    if (friendly) return friendly;
    return entity.replace(/^calendar\./, "").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
  }

  _savePreferences() {
    if (!this._storageKey) return;
    try {
      localStorage.setItem(`${this._storageKey}:entities`, JSON.stringify([...this._enabledEntities]));
      localStorage.setItem(`${this._storageKey}:view`, this._view);
    } catch (_) {
      // Home Assistant may disable storage in restrictive browser modes.
    }
  }

  async _fetchEvents() {
    if (!this._hass || !this._config) return;
    if (this._loading) { this._fetchAgain = true; return; }
    const request = ++this._request;
    this._loading = true;
    this._error = "";
    this._render();

    const { start, end } = this._visibleRange();

    try {
      const response = await this._hass.callWS({
        type: "call_service",
        domain: "calendar",
        service: "get_events",
        target: { entity_id: this._config.entities },
        service_data: {
          start_date_time: start.toISOString(),
          end_date_time: end.toISOString(),
        },
        return_response: true,
      });
      if (request !== this._request) return;
      const data = response?.response ?? response;
      const all = [];
      for (const entity of this._config.entities) {
        const eventList = data?.[entity]?.events || data?.response?.[entity]?.events || [];
        for (const item of eventList) {
          all.push({
            ...item,
            calendar: entity,
            startDate: this._parseDate(item.start),
            endDate: this._parseDate(item.end),
            allDay: /^\d{4}-\d{2}-\d{2}$/.test(item.start || ""),
          });
        }
      }
      this._events = all.filter(e => e.startDate).sort((a, b) => a.startDate - b.startDate);
      this._lastFetch = Date.now();
    } catch (err) {
      this._error = err?.message || "Could not load calendar events.";
    } finally {
      if (request === this._request) {
        this._loading = false;
        this._render();
        if (this._fetchAgain) { this._fetchAgain = false; this._fetchEvents(); }
      }
    }
  }

  _eventsForDay(day) {
    const key = this._dateKey(day);
    return this._events.filter(event => {
      if (!this._enabledEntities.has(event.calendar)) return false;
      if (!event.endDate) return this._dateKey(event.startDate) === key;
      if (event.allDay) {
        const lastIncluded = new Date(event.endDate);
        lastIncluded.setDate(lastIncluded.getDate() - 1);
        return key >= this._dateKey(event.startDate) && key <= this._dateKey(lastIncluded);
      }
      return this._dateKey(event.startDate) === key;
    });
  }

  _timeLabel(event) {
    if (event.allDay) return "All day";
    const format = d => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
    return event.endDate ? `${format(event.startDate)} – ${format(event.endDate)}` : format(event.startDate);
  }

  _colorFor(entity) {
    const palette = ["blue", "green", "rose", "purple", "amber", "teal"];
    let hash = 0;
    for (const char of entity) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  _renderWeek(root, range) {
    root.querySelector('.weekdays').remove();
    const grid = root.querySelector('.grid');
    grid.className = 'schedule'; grid.replaceChildren();
    const visible = this._events.filter(e => !e.allDay && this._enabledEntities.has(e.calendar) && e.startDate < range.end && (e.endDate || e.startDate) >= range.start);
    let first = 7 * 60, last = 20 * 60;
    for (const e of visible) {
      first = Math.min(first, e.startDate.getHours()*60 + e.startDate.getMinutes());
      const end = e.endDate || new Date(+e.startDate + 1800000);
      if (this._dateKey(e.startDate) === this._dateKey(end)) last = Math.max(last, end.getHours()*60 + end.getMinutes());
      else { first = 0; last = 1440; } // Keep actual overnight events visible too.
    }
    const startMinute = Math.floor(first/60)*60, endMinute = Math.min(1440, Math.ceil(last/60)*60);
    const duration = endMinute - startMinute;
    grid.style.setProperty('--hour-size', (60/duration*100)+'%');
    const style = document.createElement('style');
    style.textContent = `
      .schedule { display:flex; flex-direction:column; flex:1; margin:0 10px 12px; overflow:hidden; min-height:0; border:1px solid var(--divider-color); border-radius:10px; }
      .schedule-head,.schedule-all,.schedule-body { display:grid; grid-template-columns:48px repeat(7,minmax(0,1fr)); min-width:0; }
      .schedule-head { position:sticky; top:0; z-index:3; background:var(--card-background-color,#fff); }
      .schedule-head>div { text-align:center; padding:12px 4px; border-bottom:1px solid var(--divider-color); font-size:13px; }
      .schedule-head .current { color:var(--primary-color); font-weight:750; }
      .schedule-all { position:sticky; top:42px; z-index:3; background:var(--card-background-color,#fff); }
      .schedule-all>div { padding:5px; border-bottom:1px solid var(--divider-color); border-right:1px solid var(--divider-color); font-size:11px; }
      .schedule-body { flex:1; min-height:0; } .hour-labels,.time-day { position:relative; }
      .hour-labels span { position:absolute; right:8px; font-size:11px; color:var(--secondary-text-color); }
      .time-day { border-left:1px solid var(--divider-color); background:repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--hour-size) - 1px),var(--divider-color) calc(var(--hour-size) - 1px),var(--divider-color) var(--hour-size)); }
      .time-event { display:flex; flex-direction:column; align-items:flex-start; justify-content:flex-start; position:absolute; box-sizing:border-box; padding:4px 6px; border-radius:6px; border-left:3px solid currentColor; overflow:hidden; text-align:left; font-size:12px; line-height:1.2; min-width:0; }
      .time-event strong,.time-event small { display:block; flex:0 0 auto; max-width:100%; overflow-wrap:anywhere; } .time-event small { margin-top:3px; font-size:10px; }
      .all-event { height:auto; width:100%; text-align:left; padding:5px; margin:2px 0; font-size:11px; }
      .now-line { position:absolute; left:0; right:0; border-top:2px solid #ec5265; pointer-events:none; z-index:2; }
    `;
    root.append(style);
    const days = Array.from({length:7},(_,i) => { const d=new Date(range.start); d.setDate(d.getDate()+i); return d; });
    const head=document.createElement('div'); head.className='schedule-head'; head.append(document.createElement('div'));
    const all=document.createElement('div'); all.className='schedule-all'; const caption=document.createElement('div'); caption.textContent='All day'; all.append(caption);
    const body=document.createElement('div'); body.className='schedule-body';
    const labels=document.createElement('div'); labels.className='hour-labels';
    for(let h=startMinute/60;h<endMinute/60;h++){const l=document.createElement('span'); l.style.top=`${(h*60-startMinute)/duration*100}%`;l.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).format(new Date(2026,0,1,h));labels.append(l);}body.append(labels);
    for(const day of days){
      const next=new Date(day);next.setDate(next.getDate()+1);
      const h=document.createElement('div');h.textContent=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric'}).format(day);
      if(this._dateKey(day)===this._dateKey(new Date()))h.className='current'; head.append(h);
      const ac=document.createElement('div');
      for(const event of this._eventsForDay(day).filter(e=>e.allDay)){const b=document.createElement('button');b.className=`all-event ${this._colorFor(event.calendar)}`;b.textContent=event.summary||'Untitled event';b.onclick=()=>this._showEvent(event);ac.append(b);}all.append(ac);
      const col=document.createElement('div');col.className='time-day';
      col.addEventListener('click',e=>{if(e.target!==col)return;const minutes=Math.min(endMinute-30,Math.max(startMinute,Math.floor((startMinute+(e.clientY-col.getBoundingClientRect().top)/col.getBoundingClientRect().height*duration)/30)*30));const date=new Date(day);date.setMinutes(minutes);this._newEvent(date);});
      const timed=this._events.filter(e=>!e.allDay&&this._enabledEntities.has(e.calendar)&&e.startDate<next&&(e.endDate||new Date(+e.startDate+1800000))>day).map(event=>{
        const start=event.startDate<day?0:event.startDate.getHours()*60+event.startDate.getMinutes();
        const endDate=event.endDate||new Date(+event.startDate+1800000);
        const end=endDate>=next?1440:endDate.getHours()*60+endDate.getMinutes();
        return {event,start:Math.max(startMinute,start),end:Math.min(endMinute,Math.max(start+1,end))};
      }).filter(t=>t.end>t.start).sort((a,b)=>a.start-b.start||b.end-a.end);
      // Assign simultaneous events separate lanes within each overlap group.
      const groups=[];let group=[],edge=-1;
      for(const t of timed){if(t.start>=edge&&group.length){groups.push(group);group=[];edge=-1;}group.push(t);edge=Math.max(edge,t.end);}if(group.length)groups.push(group);
      for(const g of groups){const lanes=[];for(const t of g){let lane=lanes.findIndex(end=>end<=t.start);if(lane<0)lane=lanes.length;lanes[lane]=t.end;t.lane=lane;}
        for(const t of g){const b=document.createElement('button');b.className=`time-event ${this._colorFor(t.event.calendar)}`;
          b.style.cssText=`top:${(t.start-startMinute)/duration*100}%;height:${(t.end-t.start)/duration*100}%;left:calc(${t.lane/lanes.length*100}% + 2px);width:calc(${100/lanes.length}% - 4px)`;
          const title=document.createElement('strong');title.textContent=t.event.summary||'Untitled event';const time=document.createElement('small');time.textContent=this._timeLabel(t.event);b.append(title,time);b.title=`${title.textContent} · ${time.textContent}`;b.onclick=()=>this._showEvent(t.event);col.append(b);
        }
      }
      if(this._dateKey(day)===this._dateKey(new Date())){const now=new Date();const line=document.createElement('div');line.className='now-line';const minute=now.getHours()*60+now.getMinutes();line.style.top=`${(minute-startMinute)/duration*100}%`;if(minute>=startMinute&&minute<=endMinute)col.append(line);}body.append(col);
    }
    grid.append(head,all,body);
    
  }

  _dialog(title) {
    this.shadowRoot.querySelector('dialog')?.remove();
    const dialog=document.createElement('dialog');
    dialog.innerHTML=`<style>
      dialog { box-sizing:border-box; width:min(520px,94vw); max-height:90vh; border:1px solid var(--divider-color); border-radius:20px; padding:24px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#172334); box-shadow:0 20px 80px #0004; font:16px system-ui; }
      dialog::backdrop { background:#15223766; } .dialog-head { display:flex; align-items:center; justify-content:space-between; gap:12px; } .dialog-head h2 { font-size:23px;margin:0; } dialog button,dialog .google-link { min-height:44px; padding:10px 16px; border:0; border-radius:10px; cursor:pointer; font:inherit; } dialog button { background:var(--secondary-background-color,#eef2f7);color:inherit; } .dialog-content { margin-top:16px; } dialog label {display:block;margin:12px 0;font-size:14px;} dialog input:not([type=checkbox]),dialog select,dialog textarea {box-sizing:border-box;width:100%;padding:12px;margin-top:5px;border:1px solid var(--divider-color,#ccd4de);border-radius:9px;font:inherit;background:var(--card-background-color,#fff);color:inherit;} dialog textarea {min-height:80px;} .form-pair {display:grid;grid-template-columns:1fr 1fr;gap:12px;} .primary {background:var(--primary-color,#287df0)!important;color:white!important;} .form-error {color:#c42d3c;white-space:pre-wrap;} .detail {white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;} .google-link {display:inline-block;background:#edf3ff;color:#2462bf;text-decoration:none;margin-top:12px;} .hint {font-size:12px;color:var(--secondary-text-color,#576778);}
    </style><div class="dialog-head"><h2></h2><button type="button" aria-label="Close">×</button></div><div class="dialog-content"></div>`;
    dialog.querySelector('h2').textContent=title;
    dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>dialog.remove());
    this.shadowRoot.append(dialog);dialog.showModal();return dialog;
  }

  _showEvent(event) {
    const dialog=this._dialog(event.summary||'Untitled event');const content=dialog.querySelector('.dialog-content');
    const date=new Intl.DateTimeFormat(undefined,{dateStyle:'full',...(event.allDay?{}:{timeStyle:'short'})});
    for(const text of [this._calendarName(event.calendar),event.allDay?'All day':null,date.format(event.startDate),!event.allDay&&event.endDate?`Ends ${date.format(event.endDate)}`:null,event.location,event.description]){if(!text)continue;const p=document.createElement('p');p.className='detail';p.textContent=text;content.append(p);}
    const link=document.createElement('a');link.className='google-link';link.textContent='Edit or delete in Google Calendar';link.target='_blank';link.rel='noopener noreferrer';
    const supplied=event.htmlLink||event.url;
    link.href=supplied&&/^https:\/\/calendar\.google\.com\//.test(supplied)?supplied:`https://calendar.google.com/calendar/u/0/r/day/${event.startDate.getFullYear()}/${event.startDate.getMonth()+1}/${event.startDate.getDate()}`;
    content.append(link);const note=document.createElement('p');note.className='hint';note.textContent='Opens Google Calendar on this event’s day when a direct event link is unavailable.';content.append(note);
  }

  _newEvent(start = new Date()) {
    const dialog=this._dialog('New event');const content=dialog.querySelector('.dialog-content');
    const form=document.createElement('form');
    form.innerHTML=`<label>Calendar<select name="calendar" required></select></label><label>Title<input name="summary" required maxlength="250" autocomplete="off"></label><label><input type="checkbox" name="allDay"> All day</label><div class="form-pair"><label>Starts<input name="start" type="datetime-local" required></label><label>Ends<input name="end" type="datetime-local" required></label></div><label>Location<input name="location"></label><label>Notes<textarea name="description"></textarea></label><p class="hint zone"></p><p class="form-error" role="alert"></p><button class="primary" type="submit">Create event</button>`;
    const el=n=>form.elements.namedItem(n);
    const writable=this._config.entities.filter(id=>Number(this._hass?.states?.[id]?.attributes?.supported_features)&1);
    for(const id of writable){const option=document.createElement('option');option.value=id;option.textContent=this._calendarName(id);el('calendar').append(option);}
    const preferred=writable.find(id=>this._enabledEntities.has(id));if(preferred)el('calendar').value=preferred;
    const local=d=>`${this._dateKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const end=new Date(+start+3600000);el('start').value=local(start);el('end').value=local(end);
    form.querySelector('.zone').textContent=`Times use this screen’s time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
    el('allDay').onchange=()=>{for(const name of ['start','end']){const field=el(name),old=field.value;field.type=el('allDay').checked?'date':'datetime-local';field.value=el('allDay').checked?old.slice(0,10):`${old.slice(0,10)}T09:00`;}};
    if(!writable.length){form.querySelector('.form-error').textContent='No writable calendars are available. Enable read-write access for this calendar in Home Assistant.';form.querySelector('[type=submit]').disabled=true;}
    form.onsubmit=async e=>{
      e.preventDefault();const error=form.querySelector('.form-error');error.textContent='';const submit=form.querySelector('[type=submit]');
      if(submit.disabled)return;
      const data={summary:el('summary').value.trim(),location:el('location').value,description:el('description').value};
      if(!data.summary){error.textContent='Enter an event title.';return;}
      if(el('allDay').checked){if(el('end').value<el('start').value){error.textContent='The end date must not be before the start date.';return;}const exclusive=this._parseDate(el('end').value);exclusive.setDate(exclusive.getDate()+1);data.start_date=el('start').value;data.end_date=this._dateKey(exclusive);}
      else{const begin=new Date(el('start').value),finish=new Date(el('end').value);if(!(finish>begin)){error.textContent='The end time must be after the start time.';return;}data.start_date_time=begin.toISOString();data.end_date_time=finish.toISOString();}
      submit.disabled=true;submit.textContent='Saving…';
      try{await this._hass.callService('calendar','create_event',data,{entity_id:el('calendar').value});dialog.close();await this._fetchEvents();}
      catch(err){error.textContent=err?.message||'Could not save the event. Check calendar write access and try again.';submit.disabled=false;submit.textContent='Create event';}
    };
    content.append(form);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const range = this._visibleRange();
    const gridStart = range.start;
    const today = this._dateKey(new Date());
    const weekdays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2024, 0, 7 + i);
      return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
    });

    const root = document.createElement("div");
    root.style.cssText = "height:100%;min-height:0;";
    root.innerHTML = `
      <style>
        :host { display:block; height:100%; min-height:0; color:var(--primary-text-color); }
        ha-card { height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; overflow:hidden;
          border:1px solid var(--ha-card-border-color, var(--divider-color)); border-radius:14px;
          background:var(--ha-card-background, var(--card-background-color)); }
        .top { padding:14px 16px 10px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .heading { min-width:0; }
        .title { font-size:clamp(18px, 2vw, 26px); font-weight:650; line-height:1.2; }
        .month { margin-top:2px; font-size:clamp(14px, 1.4vw, 19px); font-weight:550; color:var(--secondary-text-color); }
        .controls { display:flex; gap:5px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
        button { font:inherit; color:var(--primary-text-color); background:var(--secondary-background-color); border:0; border-radius:8px; min-width:34px; height:34px; cursor:pointer; }
        button:hover { filter:brightness(.96); }
        .today-btn { padding:0 10px; font-size:13px; }
        .view-toggle { display:flex; padding:2px; background:var(--secondary-background-color); border-radius:9px; }
        .view-toggle button { height:30px; padding:0 9px; font-size:12px; background:transparent; }
        .view-toggle button.active { color:var(--primary-background-color); background:var(--primary-color); }
        .calendar-picker { position:relative; }
        .calendars-btn { padding:0 10px; font-size:12px; }
        .calendar-menu { position:absolute; z-index:5; top:39px; right:0; min-width:210px; padding:7px;
          background:var(--ha-card-background,var(--card-background-color)); border:1px solid var(--divider-color);
          border-radius:10px; box-shadow:0 6px 22px rgba(0,0,0,.18); }
        .calendar-option { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:7px; font-size:13px; cursor:pointer; white-space:nowrap; }
        .calendar-option:hover { background:var(--secondary-background-color); }
        .calendar-option input { margin:0; accent-color:var(--primary-color); }
        .calendar-dot { width:9px; height:9px; flex:0 0 auto; border-radius:50%; background:var(--primary-color); }
        .status { padding:0 16px 7px; color:var(--secondary-text-color); font-size:12px; min-height:12px; }
        .weekdays { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); border-top:1px solid var(--divider-color); border-left:1px solid var(--divider-color); margin:0 10px; }
        .weekday { text-align:center; padding:7px 2px; font-size:12px; font-weight:600; color:var(--secondary-text-color); border-right:1px solid var(--divider-color); }
        .week-grid { grid-template-rows:minmax(720px,1fr) !important; } .week-grid .day { background:repeating-linear-gradient(to bottom, transparent 0, transparent calc(6.25% - 1px), var(--divider-color) calc(6.25% - 1px), var(--divider-color) 6.25%); }
        .grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); grid-template-rows:repeat(var(--fc-rows),minmax(0,1fr)); flex:1 1 auto; min-height:0; margin:0 10px 10px; border-left:1px solid var(--divider-color); border-top:1px solid var(--divider-color); }
        .day { min-width:0; min-height:0; overflow:hidden; padding:5px 5px 4px; border-right:1px solid var(--divider-color); border-bottom:1px solid var(--divider-color); display:flex; flex-direction:column; gap:3px; }
        .day.outside { color:var(--secondary-text-color); background:color-mix(in srgb, var(--secondary-background-color) 52%, transparent); }
        .day-num { font-size:12px; line-height:19px; height:20px; flex:0 0 auto; }
        .day-num span { display:inline-flex; min-width:20px; justify-content:center; }
        .day.today .day-num span { color:#fff; background:#287df0; border-radius:50%; }
        .events { overflow:auto; min-height:0; display:flex; flex-direction:column; gap:3px; scrollbar-width:thin; }
        .event { min-width:0; border-radius:5px; padding:3px 5px; line-height:1.18; font-size:clamp(10px, .9vw, 12px); overflow:hidden; }
        .event-line { display:flex; align-items:flex-start; gap:4px; }
        .event-time { flex:0 0 auto; font-weight:700; white-space:nowrap; }
        .event-title { min-width:0; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow-wrap:anywhere; }
        .blue { background:var(--fc-blue-bg,#d9eaff); color:var(--fc-blue-fg,#163d68); }
        .green { background:var(--fc-green-bg,#d9f4e2); color:var(--fc-green-fg,#174d2b); }
        .rose { background:var(--fc-rose-bg,#ffe0e6); color:var(--fc-rose-fg,#713044); }
        .purple { background:var(--fc-purple-bg,#eee2ff); color:var(--fc-purple-fg,#513477); }
        .amber { background:var(--fc-amber-bg,#fff0d2); color:var(--fc-amber-fg,#684714); }
        .teal { background:var(--fc-teal-bg,#d7f1ef); color:var(--fc-teal-fg,#164d49); }
        @media (max-width:700px) {
          .top { padding:10px 10px 7px; } .grid,.weekdays { margin-left:5px; margin-right:5px; }
          .day { padding:3px 2px; } .event { padding:3px 3px; }
          .event-line { display:block; } .event-time { display:block; font-size:9px; }
          .event-title { -webkit-line-clamp:2; }
        }
      </style>
      <ha-card>
        <div class="top">
          <div class="heading"><div class="title"></div><div class="month"></div></div>
          <div class="controls">
            <div class="view-toggle">
              <button data-view="month">Month</button>
              <button data-view="week">Week</button>
            </div>
            <div class="calendar-picker">
              <button class="calendars-btn" data-action="calendars">Calendars ▾</button>
              <div class="calendar-menu"></div>
            </div>
            <button data-action="prev" aria-label="Previous period">‹</button>
            <button class="today-btn" data-action="today">Today</button>
            <button data-action="next" aria-label="Next period">›</button>
          </div>
        </div>
        <div class="status"></div>
        <div class="weekdays"></div>
        <div class="grid"></div>
      </ha-card>`;

    root.querySelector(".title").textContent = this._config.title;
    root.querySelector(".month").textContent = range.label;
    root.querySelector(".status").textContent = this._error ? `Calendar error: ${this._error}` : (this._loading ? "Updating calendar…" : "");
    const weekdayRow = root.querySelector(".weekdays");
    for (const name of weekdays) {
      const cell = document.createElement("div"); cell.className = "weekday"; cell.textContent = name; weekdayRow.append(cell);
    }

    root.querySelectorAll("button[data-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.view === this._view);
      button.addEventListener("click", () => {
        const nextView = button.dataset.view;
        if (nextView === this._view) return;
        if (nextView === "week") {
          const now = new Date();
          this._week = now.getMonth() === this._month.getMonth() && now.getFullYear() === this._month.getFullYear()
            ? now : new Date(this._month);
        } else {
          this._month = new Date(this._week.getFullYear(), this._week.getMonth(), 1);
        }
        this._view = nextView;
        this._savePreferences();
        this._calendarMenuOpen = false;
        this._render();
        this._fetchEvents();
      });
    });

    const calendarMenu = root.querySelector(".calendar-menu");
    calendarMenu.hidden = !this._calendarMenuOpen;
    for (const entity of this._config.entities) {
      const option = document.createElement("label");
      option.className = "calendar-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this._enabledEntities.has(entity);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this._enabledEntities.add(entity);
        else this._enabledEntities.delete(entity);
        this._savePreferences();
        this._render();
      });
      const dot = document.createElement("span");
      dot.className = `calendar-dot ${this._colorFor(entity)}`;
      const name = document.createElement("span");
      name.textContent = this._calendarName(entity);
      option.append(checkbox, dot, name);
      calendarMenu.append(option);
    }

    const grid = root.querySelector(".grid");
    grid.style.setProperty("--fc-rows", String(range.rows));
    for (let i = 0; i < range.cells; i++) {
      const day = new Date(gridStart); day.setDate(gridStart.getDate() + i);
      const key = this._dateKey(day);
      const cell = document.createElement("div");
      const outside = this._view === "month" && day.getMonth() !== this._month.getMonth();
      cell.className = `day${outside ? " outside" : ""}${key === today ? " today" : ""}`;
      const number = document.createElement("div"); number.className = "day-num";
      const numberText = document.createElement("span"); numberText.textContent = String(day.getDate()); number.append(numberText); cell.append(number);
      const eventsBox = document.createElement("div"); eventsBox.className = "events";
      const events = this._eventsForDay(day);
      const max = Math.max(1, this._view === "week" ? this._config.max_events_per_day_week : this._config.max_events_per_day);
      for (const event of events.slice(0, max)) {
        const chip = document.createElement("div"); chip.className = `event ${this._colorFor(event.calendar)}`;
        const line = document.createElement("div"); line.className = "event-line";
        const time = document.createElement("span"); time.className = "event-time"; time.textContent = this._timeLabel(event);
        const title = document.createElement("span"); title.className = "event-title"; title.textContent = event.summary || "Untitled event";
        line.append(time, title); chip.append(line); eventsBox.append(chip);
        chip.tabIndex = 0; chip.setAttribute("role", "button");
        chip.addEventListener("click", () => this._showEvent(event));
        chip.addEventListener("keydown", e => { if (e.key === "Enter") this._showEvent(event); });
      }
      if (events.length > max) {
        const more = document.createElement("div"); more.className = "event"; more.textContent = `+${events.length - max} more`; more.style.color = "var(--secondary-text-color)"; eventsBox.append(more);
      }
      cell.append(eventsBox); grid.append(cell);
    }

    root.querySelectorAll("button[data-action]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "calendars") {
        this._calendarMenuOpen = !this._calendarMenuOpen;
        this._render();
        return;
      }
      if (action === "today") {
        const now = new Date();
        this._month = new Date(now.getFullYear(), now.getMonth(), 1);
        this._week = now;
      } else if (this._view === "week") {
        this._week = new Date(this._week.getFullYear(), this._week.getMonth(), this._week.getDate() + (action === "next" ? 7 : -7));
      } else {
        this._month = new Date(this._month.getFullYear(), this._month.getMonth() + (action === "next" ? 1 : -1), 1);
      }
      this._calendarMenuOpen = false;
      this._render();
      this._fetchEvents();
    }));
    if (this._view === "week") this._renderWeek(root, range);
    const add = document.createElement("button");
    add.textContent = "+"; add.style.cssText="font-size:24px;font-weight:750;"; add.setAttribute("aria-label", "Add event");
    add.addEventListener("click", () => this._newEvent());
    root.querySelector(".controls").prepend(add);
    // Keep the form alive when a background refresh completes.
    const oldRoot = this.shadowRoot.querySelector('div');
    if (oldRoot) oldRoot.replaceWith(root); else this.shadowRoot.prepend(root);
  }
}

customElements.define("family-calendar-card", FamilyCalendarCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "family-calendar-card",
  name: "Family Calendar Grid",
  description: "A full-height month calendar with individually styled event chips.",
});