/* Home Finance Budget Card — no credentials or financial values are stored here. */
class HomeFinanceBudgetCard extends HTMLElement {
  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities)) throw new Error("Set an entities list for home-finance-budget-card.");
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() { return (this._config?.entities?.length || 5) + 2; }
  _number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  _money(value) { const n = this._number(value); return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n) < 0.5 ? 0 : n); }

  _categoryData(entry) {
    const item = typeof entry === "string" ? { entity: entry } : entry;
    const state = this._hass.states[item.entity];
    const attributes = state?.attributes || {};
    const adjustmentEntity = item.adjustment_entity;
    const helperAdjustment = adjustmentEntity ? this._number(this._hass.states[adjustmentEntity]?.state) : 0;
    const savedAdjustment = this._number(attributes.adjustments);
    const available = this._number(attributes.available) + helperAdjustment - savedAdjustment;
    const spent = this._number(attributes.spent);
    return {
      item, name: item.name || attributes.friendly_name || item.entity, adjustmentEntity,
      helperAdjustment, available, spent, remaining: available - spent,
    };
  }

  _render() {
    if (!this._config || !this._hass) return;
    const rows = this._config.entities.map((entry, index) => {
      const data = this._categoryData(entry);
      const percent = Math.max(0, Math.min(100, data.available > 0 ? (data.remaining / data.available) * 100 : 0));
      const color = data.item.color || "var(--primary-color)";
      return `<button class="row" data-row="${index}" aria-label="Adjust ${data.name}">
        <span class="labels"><span class="name">${data.name}</span><span class="amount">${this._money(data.remaining)} / ${this._money(data.available)}</span></span>
        <span class="track"><span class="fill" style="width:${percent}%;background:${color}"></span></span>
        <span class="percent">${Math.round(percent)}%</span>
      </button>`;
    }).join("");

    this.innerHTML = `<ha-card>
      <style>
        ha-card { padding: 18px; font-family: var(--primary-font-family); }
        h2 { margin: 0 0 2px; font-size: 23px; line-height: 1.2; }
        .month { color: var(--secondary-text-color); font-size: 14px; margin-bottom: 15px; }
        .row { appearance:none; border:0; background:transparent; color:var(--primary-text-color); cursor:pointer; display:grid; grid-template-columns:1fr 42px; gap:7px 12px; padding:9px 0; text-align:left; width:100%; }
        .row:hover, .row:focus-visible { opacity:.82; outline:none; } .labels { display:flex; justify-content:space-between; gap:8px; font-size:14px; }
        .name { font-weight:600; } .amount { color:var(--secondary-text-color); font-variant-numeric:tabular-nums; white-space:nowrap; }
        .track { background:color-mix(in srgb, var(--primary-color) 12%, transparent); border-radius:999px; display:block; grid-column:1; height:14px; overflow:hidden; }
        .fill { border-radius:999px; display:block; height:100%; transition:width .3s ease; }
        .percent { align-self:end; color:var(--secondary-text-color); font-size:13px; font-weight:600; grid-column:2; grid-row:1; text-align:right; }
        .sheet { align-items:end; background:rgba(0,0,0,.35); display:flex; inset:0; justify-content:center; padding:16px; position:fixed; z-index:9999; }
        .sheet[hidden] { display:none; } .panel { background:var(--card-background-color, #fff); border-radius:20px 20px 12px 12px; box-shadow:0 -8px 32px rgba(0,0,0,.25); color:var(--primary-text-color); max-width:410px; padding:20px; width:100%; }
        .panel-head { align-items:center; display:flex; justify-content:space-between; } .panel h3 { font-size:20px; margin:0; } .close { background:transparent; border:0; color:var(--secondary-text-color); font-size:30px; line-height:1; min-height:44px; min-width:44px; }
        .panel-note { color:var(--secondary-text-color); font-size:14px; margin:4px 0 14px; } .display { background:var(--secondary-background-color, #f1f5f9); border-radius:12px; font-size:32px; font-variant-numeric:tabular-nums; font-weight:600; margin-bottom:14px; overflow:hidden; padding:13px 16px; text-align:right; }
        .keypad { display:grid; gap:9px; grid-template-columns:repeat(3, 1fr); } .key { background:var(--secondary-background-color, #f1f5f9); border:0; border-radius:12px; color:var(--primary-text-color); font-size:24px; font-weight:600; min-height:58px; } .key:active { transform:scale(.97); }
        .key.action { color:var(--primary-color); } .key.apply { background:var(--primary-color); color:var(--text-primary-color, #fff); }
        @media (max-width: 450px) { .labels { align-items:flex-start; flex-direction:column; gap:2px; } }
      </style>
      <h2>${this._config.title || "Monthly Budget"}</h2>
      <div class="month">${this._config.subtitle || new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date())}</div>${rows}
      <div class="sheet" hidden><div class="panel" role="dialog" aria-modal="true" aria-label="Manual budget adjustment">
        <div class="panel-head"><h3 class="panel-title"></h3><button class="close" aria-label="Close">×</button></div>
        <div class="panel-note">Choose + or −, enter an amount, then apply it.</div><div class="display">+$0</div>
        <div class="keypad"><button class="key action" data-key="sign">±</button><button class="key action" data-key="clear">Clear</button><button class="key action" data-key="back">⌫</button>
          <button class="key" data-key="1">1</button><button class="key" data-key="2">2</button><button class="key" data-key="3">3</button>
          <button class="key" data-key="4">4</button><button class="key" data-key="5">5</button><button class="key" data-key="6">6</button>
          <button class="key" data-key="7">7</button><button class="key" data-key="8">8</button><button class="key" data-key="9">9</button>
          <button class="key" data-key=".">.</button><button class="key" data-key="0">0</button><button class="key apply" data-key="apply">Apply</button>
        </div></div></div>
    </ha-card>`;

    this._active = null;
    this.querySelectorAll(".row").forEach((button) => button.addEventListener("click", () => this._openKeypad(Number(button.dataset.row))));
    this.querySelector(".close").addEventListener("click", () => this._closeKeypad());
    this.querySelector(".sheet").addEventListener("click", (event) => { if (event.target === event.currentTarget) this._closeKeypad(); });
    this.querySelectorAll(".key").forEach((button) => button.addEventListener("click", () => this._key(button.dataset.key)));
  }

  _openKeypad(index) {
    const data = this._categoryData(this._config.entities[index]);
    if (!data.adjustmentEntity) return;
    this._active = { ...data, value: "", sign: 1 };
    this.querySelector(".panel-title").textContent = data.name;
    this.querySelector(".sheet").hidden = false;
    this._updateDisplay();
  }

  _closeKeypad() { this._active = null; const sheet = this.querySelector(".sheet"); if (sheet) sheet.hidden = true; }
  _updateDisplay() { const raw = this._active?.value || "0"; this.querySelector(".display").textContent = `${this._active.sign < 0 ? "−" : "+"}$${raw}`; }
  _key(key) {
    if (!this._active) return;
    if (key === "sign") this._active.sign *= -1;
    else if (key === "clear") this._active.value = "";
    else if (key === "back") this._active.value = this._active.value.slice(0, -1);
    else if (key === "apply") {
      const amount = Number(this._active.value || 0) * this._active.sign;
      if (Number.isFinite(amount) && amount !== 0) this._hass.callService("input_number", "set_value", { entity_id: this._active.adjustmentEntity, value: Number((this._active.helperAdjustment + amount).toFixed(2)) });
      this._closeKeypad(); return;
    } else if (key === "." ? !this._active.value.includes(".") : this._active.value.length < 8) this._active.value += key;
    this._updateDisplay();
  }
}
customElements.define("home-finance-budget-card", HomeFinanceBudgetCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "home-finance-budget-card", name: "Home Finance Budget Card", description: "Touch-friendly monthly category budget bars." });