// Small, dependency-free UI helpers shared across screens.

/** Show a transient toast. type: "info" | "success" | "error". */
export function toast(message, type = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  el.style.pointerEvents = "auto";
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 220);
  }, 2800);
}

/** Build a block of shimmer skeleton lines. */
export function skeleton(count = 3) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  for (let i = 0; i < count; i++) {
    const line = document.createElement("div");
    line.className = "skeleton";
    line.style.width = `${90 - i * 12}%`;
    wrap.appendChild(line);
  }
  return wrap;
}

/** Circular ATS score ring (0-100). Colors by band. */
export function atsRing(score, size = 72) {
  const n = Math.max(0, Math.min(100, Math.round(score || 0)));
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - n / 100);
  const color = n >= 80 ? "var(--success)" : n >= 60 ? "var(--amber)" : "var(--danger)";

  const wrap = document.createElement("div");
  wrap.className = "ats-ring";
  wrap.style.width = wrap.style.height = `${size}px`;
  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="ats-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="none" stroke-width="${stroke}"></circle>
      <circle class="ats-ring__value" cx="${size / 2}" cy="${size / 2}" r="${r}"
        fill="none" stroke-width="${stroke}" stroke-linecap="round"
        stroke="${color}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"></circle>
    </svg>
    <div class="ats-ring__label" style="inset:0">
      <div class="ats-ring__num" style="color:${color}">${n}</div>
      <div class="ats-ring__cap">ATS</div>
    </div>`;
  return wrap;
}

/** A row of keyword chips. variant: "matched" | "missing". */
export function keywordChips(list = [], variant = "matched") {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  if (!list.length) {
    const none = document.createElement("span");
    none.className = "subtitle";
    none.textContent = "-";
    wrap.appendChild(none);
    return wrap;
  }
  for (const kw of list) {
    const chip = document.createElement("span");
    chip.className = `chip chip--${variant}`;
    chip.textContent = kw;
    wrap.appendChild(chip);
  }
  return wrap;
}

/** Toggle a button's loading state (disables + spinner). */
export function spinnerButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-loading", !!on);
  btn.disabled = !!on;
}

/** Convenience DOM builder: el("div", {class:"x"}, [children|strings]). */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
