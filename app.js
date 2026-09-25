/* ManualDesk — one screen. The same script runs in the app (mode "app": opens
   the lab's copy, can add / approve / note) and on the published web page
   (mode "web": links to the vendor, read-only). docs/22. */
(function () {
  "use strict";
  const MODE = document.body.dataset.mode;
  const APP = MODE === "app";
  const S = { data: null, app: null, q: "", f: new Set(), open: new Set(), panel: null, add: null };
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ROLE_LABEL = { bench: "BENCH", user: "USER", qiacube: "QIACUBE", index: "INDEX", instrument: "INSTR" };

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500);
  }

  async function post(url, body, isForm) {
    const r = await fetch(url, isForm ? { method: "POST", body } :
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({ error: "No answer from the app." }));
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    return j;
  }

  async function load() {
    const r = await fetch(document.body.dataset.src, { cache: "no-store" });
    S.data = await r.json();
    idx();
    if (!S.app) S.app = firstApp();
    render();
  }

  // ------------------------------------------------------------ indexes
  let KITS = {}, INST = {}, APPS = {}, BYLIN = {}, SUGBYLIN = {}, NOTESBYLIN = {};
  function idx() {
    const d = S.data;
    KITS = Object.fromEntries(d.kits.map((k) => [k.kit_id, k]));
    INST = Object.fromEntries(d.instruments.map((i) => [i.instrument_id, i]));
    APPS = Object.fromEntries(d.apps.map((a) => [a.slug, a]));
    BYLIN = {}; d.docs.forEach((x) => (BYLIN[x.lineage] = BYLIN[x.lineage] || []).push(x));
    SUGBYLIN = {}; d.suggestions.forEach((s) => (SUGBYLIN[s.lineage] = s));
    NOTESBYLIN = {}; d.notes.forEach((n) => (NOTESBYLIN[n.lineage] = NOTESBYLIN[n.lineage] || []).push(n));
  }
  function appOf(doc) {
    if (doc.kit_id && KITS[doc.kit_id]) return KITS[doc.kit_id].application;
    return doc.instrument_id ? "instruments" : "general";
  }
  function firstApp() {
    for (const a of S.data.apps) if (S.data.docs.some((x) => appOf(x) === a.slug && x.status === "current")) return a.slug;
    return S.data.apps[0] && S.data.apps[0].slug;
  }

  // ------------------------------------------------------------ filters
  function roleOk(doc) {
    const roles = ["bench", "user", "qiacube", "index"].filter((r) => S.f.has(r));
    if (!roles.length) return true;
    return roles.includes(doc.role);
  }
  function statusOk(doc) { return doc.status === "current" || S.f.has("archived"); }
  function hit(doc) {
    if (!S.q) return true;
    const k = KITS[doc.kit_id] || {}, i = INST[doc.instrument_id] || {};
    const hay = [doc.title, doc.doc_id, doc.revision, doc.cat_no, doc.file_name, doc.doc_type,
      k.kit, k.cat_no, k.vendor, i.name].join(" ").toLowerCase();
    return S.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  // ------------------------------------------------------------ render
  function render() {
    const d = S.data;
    $("#n-upd").textContent = d.suggestions.length;
    $("#n-mis").textContent = d.missing.length;
    $(".act.upd").classList.toggle("has", d.suggestions.length > 0);
    $(".act.mis").classList.toggle("has", d.missing.length > 0);
    document.querySelectorAll("#chips button").forEach((b) => b.classList.toggle("on", S.f.has(b.dataset.f)));
    document.querySelectorAll(".act[data-panel]").forEach((b) => b.classList.toggle("on", S.panel === b.dataset.panel));
    renderNav(); renderMain(); renderPanel();
  }

  function renderNav() {
    const d = S.data, counts = {}, upd = {};
    d.docs.forEach((x) => {
      if (x.status !== "current") return;
      const a = appOf(x); counts[a] = (counts[a] || 0) + 1;
      if (SUGBYLIN[x.lineage]) upd[a] = 1;
    });
    let html = "", group = null;
    for (const a of d.apps) {
      if (!counts[a.slug] && a.slug !== "_retired") continue;
      if (a.group !== group) { group = a.group; html += `<h4>${esc(group)}</h4>`; }
      html += `<button data-app="${esc(a.slug)}" class="${a.slug === S.app && !S.q ? "on" : ""}">
        <span>${esc(a.name)}${upd[a.slug] ? '<span class="dot" title="update"></span>' : ""}</span>
        <i>${counts[a.slug] || ""}</i></button>`;
    }
    $("#nav").innerHTML = html;
  }

  function docsForView() {
    const d = S.data;
    return d.docs.filter((x) => (S.q ? hit(x) : appOf(x) === S.app) && roleOk(x) &&
      (statusOk(x) || (S.app === "_retired" && !S.q)));
  }

  function renderMain() {
    const docs = docsForView();
    const owners = new Map();
    docs.forEach((x) => {
      const key = x.kit_id ? "k:" + x.kit_id : "i:" + x.instrument_id;
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(x);
    });
    const title = S.q ? `“${esc(S.q)}”` : esc((APPS[S.app] || {}).name || "");
    let html = `<h2>${title}</h2>`;
    if (!owners.size) html += `<p class="empty">—</p>`;
    const order = [...owners.keys()].sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
    for (const key of order) html += card(key, owners.get(key));
    $("#main").innerHTML = html;
  }
  function ownerName(key) {
    const id = key.slice(2);
    if (key[0] === "k") { const k = KITS[id] || {}; return (k.status === "active" ? "0" : "1") + (k.kit || id); }
    return "2" + ((INST[id] || {}).name || id);
  }

  function card(key, docs) {
    const id = key.slice(2), isKit = key[0] === "k";
    const k = isKit ? KITS[id] || { kit: id } : null, i = isKit ? null : INST[id] || { name: id };
    const name = isKit ? k.kit : i.name;
    const cats = isKit ? (k.cat_nos || []).join(" · ") : "";
    const status = isKit ? k.status : i.status;
    const pill = status && status !== "active" ? `<span class="pill ${esc(status)}">${esc(status)}</span>` : "";
    const roleRank = { bench: 0, qiacube: 1, user: 2, index: 3, instrument: 4 };
    docs.sort((a, b) => (a.status === "current" ? 0 : 1) - (b.status === "current" ? 0 : 1) ||
      roleRank[a.role] - roleRank[b.role] || (a.title || "").localeCompare(b.title || ""));
    return `<section class="kit"><header><h3>${esc(name)}</h3>
      ${cats ? `<span class="cat">${esc(cats)}</span>` : ""}
      ${isKit && k.vendor ? `<span class="vendor">${esc(k.vendor)}</span>` : ""}${pill}</header>
      ${docs.map(row).join("")}</section>`;
  }

  function stateOf(doc) {
    const sug = SUGBYLIN[doc.lineage];
    if (doc.status !== "current") return ["arch", "Archived"];
    if (sug) return ["upd", "▲ " + sug.found_revision];
    if (doc.check_result === "failed") return ["bad", "! Check"];
    if (doc.due) return ["due", "○ Due"];
    return ["ok", "● Current"];
  }

  function href(doc) {
    if (APP) return "/doc/" + encodeURIComponent(doc.row_id);
    return doc.vendor_url || "";
  }

  function row(doc) {
    const [cls, label] = stateOf(doc);
    const open = S.open.has(doc.row_id);
    const ident = [doc.doc_id, doc.revision].filter(Boolean).join(" ");
    const h = href(doc);
    const t = esc(doc.title || doc.file_name);
    const link = h ? `<a href="${esc(h)}" target="_blank" rel="noopener">${t}</a>` : t;
    const nNotes = (NOTESBYLIN[doc.lineage] || []).length;
    return `<div class="doc"><div class="row ${doc.status !== "current" ? "arch" : ""}">
      <span class="badge ${esc(doc.role)}">${ROLE_LABEL[doc.role] || esc(doc.role)}</span>
      <span class="ttl"><span class="dt">${esc(doc.doc_type)}</span>${link}${nNotes ? ` <span title="notes">✎${nNotes}</span>` : ""}</span>
      <span class="ident">${esc(ident)}</span>
      <span class="st ${cls}">${esc(label)}</span>
      <button class="more" data-open="${esc(doc.row_id)}" aria-label="details">${open ? "▾" : "▸"}</button>
      </div>${open ? detail(doc) : ""}</div>`;
  }

  function detail(doc) {
    const revs = (BYLIN[doc.lineage] || []).filter((x) => x.row_id !== doc.row_id);
    const notes = NOTESBYLIN[doc.lineage] || [];
    const hist = S.data.history.filter((h) => h.lineage === doc.lineage).slice(0, 8);
    let html = `<div class="detail"><dl>
      <dt>File</dt><dd>${esc(doc.file_name)}</dd>
      ${doc.cat_no ? `<dt>Cat no</dt><dd>${esc(doc.cat_no)}</dd>` : ""}
      ${doc.rev_date ? `<dt>Dated</dt><dd>${esc(doc.rev_date)}</dd>` : ""}
      <dt>Added</dt><dd>${esc(doc.added_on)}</dd>
      <dt>Checked</dt><dd>${esc(doc.last_checked || "—")}${doc.check_note ? " · " + esc(doc.check_note) : ""}</dd>
      ${!APP && doc.vendor_url ? `<dt>Vendor</dt><dd><a href="${esc(doc.vendor_url)}" target="_blank" rel="noopener">${esc(doc.vendor_url)}</a></dd>` : ""}
      </dl>`;
    if (APP && doc.status === "current") html += `<div class="addnote"><input data-vurl-for="${esc(doc.row_id)}" value="${esc(doc.vendor_url)}" placeholder="Vendor page https://">
      ${doc.vendor_url ? `<a class="go" style="margin:0;text-decoration:none" href="${esc(doc.vendor_url)}" target="_blank" rel="noopener">↗</a>` : ""}
      <button data-vurl-save="${esc(doc.row_id)}">Save</button></div>`;
    html += `<h5>Notes</h5>` + (notes.length ? notes.map((n) => `<div class="note ${n.needs_check === "1" ? "chk" : ""}">
        <span class="txt">${esc(n.text)}</span><span class="by">${esc(n.who)} · ${esc(n.when.slice(0, 10))}${n.revision ? " · " + esc(n.revision) : ""}</span>
        ${APP && n.needs_check === "1" ? `<button data-note-ok="${esc(n.note_id)}" title="still valid">✓</button>` : ""}
        ${APP ? `<button data-note-del="${esc(n.note_id)}" title="remove">✕</button>` : ""}</div>`).join("") : "");
    if (APP) html += `<div class="addnote"><input data-note-for="${esc(doc.lineage)}" maxlength="1000" placeholder="Note"><button class="go" style="margin:0" data-note-add="${esc(doc.lineage)}">+</button></div>`;
    if (revs.length) html += `<h5>Revisions</h5><ul class="revs">` + revs.map((r) =>
      `<li>${href(r) ? `<a href="${esc(href(r))}" target="_blank" rel="noopener">${esc([r.doc_id, r.revision].filter(Boolean).join(" ") || r.file_name)}</a>` : esc(r.revision)} · ${esc(r.status)}</li>`).join("") + `</ul>`;
    if (hist.length) html += `<h5>History</h5><table class="hist">` + hist.map(histRow).join("") + `</table>`;
    if (APP && doc.status === "current") html += `<div class="btns">
      <button data-still="${esc(doc.row_id)}">Still current</button>
      <button data-archive="${esc(doc.row_id)}">Archive</button></div>`;
    return html + `</div>`;
  }

  function histRow(h) {
    const revs = [h.old_revision, h.new_revision].filter(Boolean).join(" → ");
    return `<tr><td>${esc(h.when.slice(0, 10))}</td><td>${esc(h.action)}${revs ? " · " + esc(revs) : ""}${h.detail ? `<div class="s">${esc(h.detail)}</div>` : ""}</td><td>${esc(h.who)}</td></tr>`;
  }

  // ------------------------------------------------------------ panels
  function renderPanel() {
    const p = $("#panel");
    if (!S.panel) { p.hidden = true; return; }
    p.hidden = false;
    const close = `<button data-close aria-label="close">✕</button>`;
    const d = S.data;
    if (S.panel === "updates") {
      p.innerHTML = `<h3>Updates ${close}</h3>` + (d.suggestions.length ? d.suggestions.map((s) => {
        const cur = (BYLIN[s.lineage] || []).find((x) => x.status === "current") || {};
        const k = KITS[cur.kit_id] || {}, i = INST[cur.instrument_id] || {};
        return `<div class="item"><div class="k">${esc(k.kit || i.name || "")}</div>
          <div class="s">${esc(cur.doc_type || "")} · ${esc(cur.title || "")}</div>
          <div class="r">${esc(cur.doc_id || "")} ${esc(s.current_revision)} → <b>${esc(s.found_revision)}</b></div>
          ${s.found_url ? `<div class="s"><a href="${esc(s.found_url)}" target="_blank" rel="noopener">vendor</a> · ${esc(s.found_on.slice(0, 10))}</div>` : `<div class="s">${esc(s.detail)}</div>`}
          ${APP ? `<div class="btns"><button class="go" data-approve="${esc(s.suggestion_id)}">Approve</button><button data-decline="${esc(s.suggestion_id)}">Not now</button></div>` : ""}</div>`;
      }).join("") : `<p class="empty">—</p>`);
    } else if (S.panel === "missing") {
      p.innerHTML = `<h3>Missing ${close}</h3>` + (d.missing.length ? d.missing.map((kid) => {
        const k = KITS[kid] || {};
        return `<div class="item"><div class="k">${esc(k.kit)}</div><div class="s">${esc((APPS[k.application] || {}).name || "")} · ${esc((k.cat_nos || []).join(" · "))}</div></div>`;
      }).join("") : `<p class="empty">—</p>`);
    } else if (S.panel === "history") {
      const rows = d.history.slice(0, 500);
      p.innerHTML = `<h3>History ${close}</h3><table class="hist">` + rows.map((h) => {
        const k = KITS[h.kit_id] || {}, i = INST[h.instrument_id] || {};
        const revs = [h.old_revision, h.new_revision].filter(Boolean).join(" → ");
        return `<tr><td>${esc(h.when.slice(0, 10))}</td><td><b>${esc(h.action)}</b> ${esc(k.kit || i.name || "")}
          <div class="s">${esc(h.title)}${h.doc_id ? " · " + esc(h.doc_id) : ""}${revs ? " · " + esc(revs) : ""}</div></td><td>${esc(h.who)}</td></tr>`;
      }).join("") + `</table>`;
    } else if (S.panel === "add") {
      p.innerHTML = `<h3>Add ${close}</h3>` + addForm();
      wireAdd();
    }
  }

  // ------------------------------------------------------------ add
  function kitOptions(sel) {
    let html = `<option value="">—</option>`;
    for (const a of S.data.apps) {
      if (a.slug === "instruments") continue;
      const ks = S.data.kits.filter((k) => k.application === a.slug).sort((x, y) => x.kit.localeCompare(y.kit));
      if (!ks.length) continue;
      html += `<optgroup label="${esc(a.name)}">` + ks.map((k) =>
        `<option value="k:${esc(k.kit_id)}" ${sel === "k:" + k.kit_id ? "selected" : ""}>${esc(k.kit)}${k.cat_nos.length ? " · " + esc(k.cat_nos[0]) : ""}</option>`).join("") + `</optgroup>`;
    }
    html += `<optgroup label="Instruments">` + S.data.instruments.map((i) =>
      `<option value="i:${esc(i.instrument_id)}" ${sel === "i:" + i.instrument_id ? "selected" : ""}>${esc(i.name)}</option>`).join("") + `</optgroup>`;
    return html;
  }

  function addForm() {
    const a = S.add;
    if (!a || a.stage === "start") {
      return `<div class="form"><label>URL</label><input id="add-url" placeholder="https://">
        <button class="go" id="add-url-go">Fetch</button>
        <div class="drop" id="drop">PDF<input type="file" id="add-file" accept="application/pdf" hidden></div>
        ${a && a.error ? `<div class="err">${esc(a.error)}</div>` : ""}</div>`;
    }
    if (a.stage === "choose") {
      return `<div class="form">` + a.choose.map((c) =>
        `<div class="item"><button class="more" style="text-align:left" data-pick="${esc(c.url)}">${esc(c.label)}</button><div class="s">${esc(c.url)}</div></div>`).join("") +
        `<button data-add-reset>←</button></div>`;
    }
    const m = a.meta, sel = m.kit_matches && m.kit_matches.length ? "k:" + m.kit_matches[0] : "";
    const roleOpts = ["bench", "user", "qiacube", "index"].map((r) =>
      `<option value="${r}" ${(m.role || "bench") === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
    const typeOpts = S.data.doc_types.map((t) => `<option ${t === (m.doc_type || guessType(m.title)) ? "selected" : ""}>${esc(t)}</option>`).join("");
    return `<div class="form">
      <label>Kit</label><select id="f-owner">${kitOptions(sel)}</select>
      <div class="two"><div><label>Role</label><select id="f-role">${roleOpts}</select></div>
      <div><label>Type</label><select id="f-type">${typeOpts}</select></div></div>
      <label>Title</label><input id="f-title" value="${esc(m.title)}">
      <div class="two"><div><label>Doc ID</label><input id="f-docid" value="${esc(m.doc_id)}"></div>
      <div><label>Revision</label><input id="f-rev" value="${esc(m.revision)}"></div></div>
      <div class="two"><div><label>Cat no</label><input id="f-cat" value="${esc(m.cat_no)}"></div>
      <div><label>Vendor</label><input id="f-vendor" value="${esc(m.vendor)}"></div></div>
      <label>Vendor page</label><input id="f-url" value="${esc(m.source_url || "")}">
      <button class="go" id="f-save">Save</button> <button data-add-reset>Cancel</button>
      ${a.error ? `<div class="err">${esc(a.error)}</div>` : ""}</div>`;
  }
  function guessType(t) {
    t = (t || "").toLowerCase();
    if (t.includes("handbook")) return "Handbook";
    if (t.includes("demonstrated")) return "Demonstrated Protocol";
    if (t.includes("reference guide")) return "Reference Guide";
    if (t.includes("user guide") || t.includes("user manual")) return "User Guide";
    if (t.includes("technical note") || t.includes("technote")) return "Technical Note";
    if (t.includes("quick reference")) return "Quick Reference";
    return "Manual";
  }

  async function fetchUrl(url) {
    S.add = { stage: "start", busy: true }; renderPanel();
    try {
      const j = await post("/api/add/url", { url });
      S.add = j.choose ? { stage: "choose", choose: j.choose } : { stage: "confirm", meta: j };
    } catch (e) { S.add = { stage: "start", error: e.message }; }
    renderPanel();
  }

  function wireAdd() {
    const go = $("#add-url-go");
    if (go) go.onclick = () => { const u = $("#add-url").value.trim(); if (u) fetchUrl(u); };
    const drop = $("#drop"), file = $("#add-file");
    if (drop) {
      drop.onclick = () => file.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); };
      file.onchange = () => file.files[0] && upload(file.files[0]);
    }
    const save = $("#f-save");
    if (save) save.onclick = saveAdd;
  }

  async function upload(f) {
    const fd = new FormData(); fd.append("file", f);
    try { S.add = { stage: "confirm", meta: await post("/api/add/upload", fd, true) }; }
    catch (e) { S.add = { stage: "start", error: e.message }; }
    renderPanel();
  }

  async function saveAdd() {
    const m = S.add.meta, own = $("#f-owner").value;
    const body = {
      token: m.token, original_name: m.original_name, pages: m.pages, rev_date: m.rev_date,
      source_url: m.source_url || "",
      kit_id: own.startsWith("k:") ? own.slice(2) : "", instrument_id: own.startsWith("i:") ? own.slice(2) : "",
      role: $("#f-role").value, doc_type: $("#f-type").value, title: $("#f-title").value,
      doc_id: $("#f-docid").value, revision: $("#f-rev").value, cat_no: $("#f-cat").value,
      vendor: $("#f-vendor").value, vendor_url: $("#f-url").value,
    };
    try {
      const j = await post("/api/add/confirm", body);
      S.add = null;
      S.panel = j.result === "suggested" ? "updates" : null;
      toast(j.result === "suggested" ? "Newer revision - waiting in Updates" : "Filed");
      await load();
    } catch (e) { S.add.error = e.message; renderPanel(); }
  }

  // ------------------------------------------------------------ events
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, [data-app]");
    if (!t) return;
    const ds = t.dataset;
    try {
      if (ds.app) { S.app = ds.app; S.q = ""; $("#q").value = ""; render(); window.scrollTo(0, 0); }
      else if (ds.f) { S.f.has(ds.f) ? S.f.delete(ds.f) : S.f.add(ds.f); render(); }
      else if (ds.panel) { S.panel = S.panel === ds.panel ? null : ds.panel; if (ds.panel === "add") S.add = { stage: "start" }; render(); }
      else if ("close" in ds) { S.panel = null; render(); }
      else if (ds.open) { S.open.has(ds.open) ? S.open.delete(ds.open) : S.open.add(ds.open); renderMain(); }
      else if (ds.approve) { t.disabled = true; toast("Downloading…"); await post(`/api/suggestion/${ds.approve}/approve`); toast("Updated"); await load(); }
      else if (ds.decline) { await post(`/api/suggestion/${ds.decline}/decline`); await load(); }
      else if (ds.still) { await post(`/api/doc/${ds.still}/still-current`); toast("Checked"); await load(); }
      else if (ds.archive) { if (!confirm("Archive?")) return; await post(`/api/doc/${ds.archive}/archive`); await load(); }
      else if (ds.noteAdd) {
        const inp = document.querySelector(`input[data-note-for="${CSS.escape(ds.noteAdd)}"]`);
        if (inp && inp.value.trim()) { await post("/api/notes", { lineage: ds.noteAdd, text: inp.value }); await load(); }
      }
      else if (ds.vurlSave) {
        const inp = document.querySelector(`input[data-vurl-for="${CSS.escape(ds.vurlSave)}"]`);
        await post(`/api/doc/${ds.vurlSave}/vendor-url`, { url: inp ? inp.value : "" }); toast("Saved"); await load();
      }
      else if (ds.noteDel) { if (!confirm("Remove note?")) return; await post(`/api/notes/${ds.noteDel}/remove`); await load(); }
      else if (ds.noteOk) { await post(`/api/notes/${ds.noteOk}/confirm`); await load(); }
      else if (ds.pick) { fetchUrl(ds.pick); }
      else if ("addReset" in ds) { S.add = { stage: "start" }; renderPanel(); }
    } catch (err) { t.disabled = false; toast(err.message); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input[data-note-for]")) {
      const b = e.target.parentElement.querySelector("[data-note-add]"); b && b.click();
    }
    if (e.key === "Enter" && e.target.id === "add-url") $("#add-url-go").click();
    if (e.key === "Escape" && S.panel) { S.panel = null; render(); }
  });
  let qt;
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); renderNav(); renderMain(); }, 120); });

  load().catch((e) => { $("#main").innerHTML = `<p class="err">${esc(e.message)}</p>`; });
})();
