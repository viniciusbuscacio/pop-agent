// Placeholder landing page served at `/` until the React `web/` frontend lands.
// Visual language borrowed from go-notepad (Fluent tokens, Segoe UI, segmented
// theme control) — see ~/dev/go-notepad/frontend/src/style.css. Replaced when
// the real frontend is built.
export const HOME_PAGE = `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Popy</title>
<style>
  :root, :root[data-theme="dark"] {
    --bg: #202020; --screen-fg: #ffffff; --titlebar-fg: #d6d6d6;
    --accent: #4cc2ff; --accent-hover: #48b2e8; --accent-fg: #003a5c;
    --border: #333333; --panel-bg: #2b2b2b; --muted: #9a9a9a;
    --key-fg-dim: #d0d0d0; --hover-overlay: rgba(255,255,255,.06);
  }
  :root[data-theme="light"] {
    --bg: #f3f3f3; --screen-fg: #1a1a1a; --titlebar-fg: #1a1a1a;
    --accent: #005fb8; --accent-hover: #0a6cc8; --accent-fg: #ffffff;
    --border: #e2e2e2; --panel-bg: #ffffff; --muted: #757575;
    --key-fg-dim: #333333; --hover-overlay: rgba(0,0,0,.05);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  button { font-family: inherit; }
  html, body { height: 100%; }
  body {
    font-family: "Segoe UI Variable","Segoe UI", system-ui, -apple-system,"Helvetica Neue", Arial, sans-serif;
    background: var(--bg); color: var(--screen-fg);
    transition: background 120ms ease, color 120ms ease;
  }
  .window { display: flex; flex-direction: column; min-height: 100vh; }
  .titlebar {
    display: flex; align-items: center; height: 40px; flex-shrink: 0;
    padding: 0 8px 0 12px; border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 8px; flex: 1; color: var(--titlebar-fg); }
  .app-glyph { width: 20px; height: 20px; color: var(--accent); }
  .titlebar-title { font-size: 13px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg-btn {
    border: none; background: transparent; color: var(--key-fg-dim);
    padding: 6px 14px; font-size: 13px; cursor: pointer;
  }
  .seg-btn:hover { background: var(--hover-overlay); }
  .seg-btn.active { background: var(--accent); color: var(--accent-fg); }
  .content { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card {
    width: min(520px, 100%); background: var(--panel-bg);
    border: 1px solid var(--border); border-radius: 10px; padding: 28px 26px;
  }
  .card h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
  .card p { font-size: 14px; line-height: 1.6; color: var(--key-fg-dim); }
  .card .host { margin-top: 14px; font-size: 12px; color: var(--muted); }
  .card .host b { color: var(--screen-fg); font-weight: 600; }
</style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="brand">
        <svg class="app-glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="4" stroke="currentColor" stroke-width="1.6"/>
          <path d="M6.5 10.5 L9 13 L13.5 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="titlebar-title">Popy</span>
      </div>
      <div class="seg" role="group" aria-label="Tema">
        <button class="seg-btn" data-set-theme="light">Light</button>
        <button class="seg-btn" data-set-theme="dark">Dark</button>
      </div>
    </div>
    <main class="content">
      <div class="card">
        <h1>Popy</h1>
        <p>Pagina base no ar, servida pelo server real (rota <code>/</code>). Light/dark no padrao visual do go-notepad: tokens Fluent, fonte Segoe UI, seletor de tema em segmented control.</p>
        <div class="host">servido pelo <b>Popy</b> &middot; <span id="loc"></span></div>
      </div>
    </main>
  </div>
<script>
  var root = document.documentElement;
  function apply(t){
    t = (t === "light") ? "light" : "dark";
    root.dataset.theme = t;
    try { localStorage.setItem("popy-theme", t); } catch(e){}
    document.querySelectorAll(".seg-btn").forEach(function(b){
      b.classList.toggle("active", b.dataset.setTheme === t);
    });
  }
  var stored = null; try { stored = localStorage.getItem("popy-theme"); } catch(e){}
  var initial = stored || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  apply(initial);
  document.querySelectorAll(".seg-btn").forEach(function(b){
    b.addEventListener("click", function(){ apply(b.dataset.setTheme); });
  });
  document.getElementById("loc").textContent = location.host;
</script>
</body>
</html>`;
