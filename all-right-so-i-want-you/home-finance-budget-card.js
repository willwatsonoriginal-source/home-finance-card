/* Home Finance Budget Card — no credentials or financial values are stored here. */
class HomeFinanceBudgetCard extends HTMLElement {
  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities)) {
      throw new Error("Set an entities list for home-finance-budget-card.");
    }
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() { return (this._config?.entities?.length || 5) + 2; }

  _number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  _money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(this._number(value));
  }

  _render() {
    if (!this._config || !this._hass) return;
    const rows = this._config.entities.map((entry) => {
      const item = typeof entry === "string" ? { entity: entry } : entry;
      const state = this._hass.states[item.entity];
      const attributes = state?.attributes || {};
      const name = item.name || attributes.friendly_name || item.entity;
      const available = this._number(attributes.available);
      const spent = this._number(attributes.spent);
      const percent = Math.max(0, Math.min(100, this._number(state?.state)));
      const color = item.color || "var(--primary-color)";
      return `<button class="row" data-entity="${item.entity}" aria-label="Open ${name}">
        <span class="labels"><span class="name">${name}</span><span class="amount">${this._money(spent)} / ${this._money(available)}</span></span>
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
        .row:hover { opacity:.8; } .labels { display:flex; justify-content:space-between; gap:8px; font-size:14px; }
        .name { font-weight:600; } .amount { color:var(--secondary-text-color); white-space:nowrap; }
        .track { background:color-mix(in srgb, var(--primary-color) 12%, transparent); border-radius:999px; display:block; grid-column:1; height:14px; overflow:hidden; }
        .fill { border-radius:999px; display:block; height:100%; min-width:0; transition:width .3s ease; }
        .percent { align-self:end; color:var(--secondary-text-color); font-size:13px; font-weight:600; grid-column:2; grid-row:1 / span 2; text-align:right; }
        @media (max-width: 450px) { .labels { align-items:flex-start; flex-direction:column; gap:2px; } }
      </style>
      <h2>${this._config.title || "Monthly Budget"}</h2>
      <div class="month">${this._config.subtitle || new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date())}</div>${rows}
    </ha-card>`;
    this.querySelectorAll(".row").forEach((button) => button.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: button.dataset.entity } }));
    }));
  }
}
customElements.define("home-finance-budget-card", HomeFinanceBudgetCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "home-finance-budget-card", name: "Home Finance Budget Card", description: "Compact monthly category budget bars." });
