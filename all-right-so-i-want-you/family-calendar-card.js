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
    const validEnabled = [...this._enabledEntities].filter(entity => config.entities.includes(entity));
    this._enabledEntities = new Set(validEnabled.length ? validEnabled : config.entities);
    this._render();
    this._fetchEvents();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && !this._events.length && !this._loading) this._fetchEvents();
  }

  get hass() { return this._hass; }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 6, min_rows: 4, max_rows: 12 };
  }

  getCardSize() { return 6; }

  connectedCallback() {
    if (this._config) this._render();
  }

  disconnectedCallback() {
    if (this._refreshTimer) window.clearInterval(this._refreshTimer);
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

  async _fetchEvents() {
    if (!this._hass || !this._config || this._loading) return;
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
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
      .format(event.startDate).replace(":00", "");
  }

  _colorFor(entity) {
    const palette = ["blue", "green", "rose", "purple", "amber", "teal"];
    let hash = 0;
    for (const char of entity) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
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
      cell.className = `day${day.getMonth() !== this._month.getMonth() ? " outside" : ""}${key === today ? " today" : ""}`;
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
    this.shadowRoot.replaceChildren(root);
  }
}

customElements.define("family-calendar-card", FamilyCalendarCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "family-calendar-card",
  name: "Family Calendar Grid",
  description: "A full-height month calendar with individually styled event chips.",
});
