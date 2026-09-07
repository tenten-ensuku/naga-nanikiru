(function installOpsDashboard(host) {
  "use strict";

  const REFRESH_INTERVAL_MS = 15 * 60_000;
  const HISTORY_REFRESH_INTERVAL_MS = 15 * 60_000;
  const SNAPSHOT_ENDPOINT = "/api/latest";
  const HISTORY_ENDPOINT = "/api/history";
  const MAX_TREND_POINTS = 30;

  const POLICY_LIMITS = Object.freeze({
    supabaseStorage: 1_000_000_000,
    r2Storage: 10_000_000_000,
  });

  const APP_DEFINITIONS = Object.freeze([
    { id: "minkiru", label: "みん切る", description: "問題・学習データ" },
    { id: "ensuku", label: "エンスクドリル", description: "ドリル・教材" },
    { id: "iishanten", label: "一向聴受け入れ", description: "講義・資料" },
    { id: "isolated", label: "孤立牌比較", description: "解析・補助データ" },
    { id: "zundamon", label: "ずんだもん", description: "問題・解説" },
    { id: "common", label: "共通・未分類", description: "共通テーブル・未分類" },
  ]);

  const APP_COLORS = Object.freeze({
    minkiru: "#137d78",
    ensuku: "#315e78",
    iishanten: "#b48326",
    isolated: "#6a8f8e",
    zundamon: "#8e6f50",
    common: "#9aa8a4",
  });

  const METRIC_DEFINITIONS = Object.freeze([
    {
      id: "supabase-storage",
      label: "Supabase Storage",
      provider: "Supabase",
      kind: "storage",
      limit: POLICY_LIMITS.supabaseStorage,
      note: "組織全体の物理使用量。",
    },
    {
      id: "supabase-database",
      label: "Supabase Database",
      provider: "Supabase PostgreSQL",
      kind: "database",
      limit: null,
      note: "現行DBの物理使用量を構成比で表示。合算上限を設定しない。",
    },
    {
      id: "r2-storage",
      label: "Cloudflare R2",
      provider: "Cloudflare",
      kind: "storage",
      limit: POLICY_LIMITS.r2Storage,
      note: "無料枠10GB。7GB警戒、8GBソフト停止の運用基準。",
    },
    {
      id: "database-minkiru",
      label: "Supabase DB / みん切る",
      provider: "Supabase PostgreSQL",
      kind: "database",
      limit: null,
      note: "DB別の上限はAPIが返した値だけを表示。",
    },
    {
      id: "database-ranking",
      label: "Supabase DB / ランキング",
      provider: "Supabase PostgreSQL",
      kind: "database",
      limit: null,
      note: "DB別の上限はAPIが返した値だけを表示。",
    },
  ]);

  const SOURCE_DEFINITIONS = Object.freeze([
    { id: "minkiru", label: "Supabase PostgreSQL / みん切る" },
    { id: "ranking", label: "Supabase PostgreSQL / ランキング" },
    { id: "r2", label: "Cloudflare R2" },
    { id: "cloudflare", label: "Cloudflare API / Workers" },
    { id: "egress", label: "通信量 / Egress" },
  ]);

  const STATUS_LABELS = Object.freeze({
    ok: "正常",
    unknown: "不明",
    stale: "要更新",
    manual: "手動確認",
    critical: "重大",
  });

  const EVENT_LEVEL_LABELS = Object.freeze({
    notice: "通知",
    warning: "警告",
    critical: "重大",
    recovery: "復旧",
    error: "エラー",
  });

  const DELIVERY_LABELS = Object.freeze({
    sent: "送信済み",
    failed: "送信失敗",
    "not-requested": "未依頼",
    pending: "保留中",
  });

  const EXPORT_CSS = String.raw`
    .trend-panel{grid-template-columns:minmax(0,1fr)}.trend-table{min-width:0;max-width:100%;overflow-x:auto}.signal-value>.status-chip,.control-value>.status-chip{max-width:100%;white-space:normal;overflow-wrap:anywhere}
    :root{color-scheme:light;--navy:#173247;--navy-deep:#10283a;--teal:#137d78;--teal-soft:#d8efeb;--gold:#b48326;--gold-soft:#f7edcf;--ivory:#f8f5ed;--paper:#fffdf8;--ink:#203443;--muted:#687985;--line:#d9e0dc;--line-strong:#bbc9c7;--danger:#b5494d;--danger-soft:#f9e3e1;--shadow:0 16px 38px rgba(23,50,71,.09);font-family:Inter,"Avenir Next","Yu Gothic UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;font-size:16px;line-height:1.55}
    *{box-sizing:border-box}html{background:var(--ivory);scroll-behavior:smooth}body{margin:0;min-width:0;background:var(--ivory);color:var(--ink)}button,input{font:inherit}button{cursor:pointer}.ops-shell{width:min(100% - 32px,1440px);margin:0 auto;padding:30px 0 56px}.ops-header{display:flex;align-items:flex-start;justify-content:space-between;gap:28px;padding:10px 0 28px;border-bottom:1px solid var(--line)}.eyebrow,.section-kicker,.resource-kicker{margin:0;color:var(--teal);font-size:.76rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.ops-header h1{margin:5px 0 7px;color:var(--navy-deep);font-size:clamp(1.75rem,3vw,2.65rem);letter-spacing:-.04em;line-height:1.12}.ops-header p{margin:0;max-width:680px;color:var(--muted)}.header-side{display:grid;gap:12px;justify-items:end;min-width:245px}.snapshot-meta{color:var(--muted);font-size:.82rem;text-align:right}.snapshot-meta strong{display:block;color:var(--navy);font-size:.95rem}.header-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.ops-button{min-height:42px;padding:8px 14px;border:1px solid var(--navy);border-radius:9px;background:var(--navy);color:#fff;font-weight:800;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}.ops-button:hover{background:var(--navy-deep);box-shadow:0 6px 14px rgba(16,40,58,.17);transform:translateY(-1px)}.ops-button:focus-visible,.ops-input:focus-visible{outline:3px solid rgba(19,125,120,.28);outline-offset:2px}.ops-button--quiet{border-color:var(--line-strong);background:var(--paper);color:var(--navy)}.ops-button--quiet:hover{background:#f1f7f5}.export-badge,.status-chip,.level-chip,.delivery-chip{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:25px;padding:3px 9px;border-radius:999px;font-size:.76rem;font-weight:800;white-space:nowrap}.export-badge{border:1px solid #c9deda;background:var(--teal-soft);color:#176862}.status-chip--ok{background:#dff1e9;color:#22694e}.status-chip--unknown{background:#edf0ee;color:#5b6b72}.status-chip--stale{background:var(--gold-soft);color:#80621e}.status-chip--manual{background:#e4eafb;color:#425a88}.status-chip--critical{background:var(--danger-soft);color:#963a3f}.ops-main{display:grid;gap:18px;padding-top:24px}.signal-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.signal-card{min-width:0;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:var(--paper);box-shadow:0 6px 18px rgba(23,50,71,.04)}.signal-card--focus{border-color:#d2bbb3;background:linear-gradient(135deg,#fffdf8 0%,#fcf1ec 100%)}.signal-label{display:block;margin-bottom:5px;color:var(--muted);font-size:.78rem;font-weight:800}.signal-value{display:flex;align-items:baseline;gap:7px;color:var(--navy-deep);font-size:1.55rem;font-weight:900;letter-spacing:-.03em}.signal-value small{color:var(--muted);font-size:.8rem;font-weight:800;letter-spacing:0}.signal-note{display:block;margin-top:3px;color:var(--muted);font-size:.77rem}.control-strip{display:grid;grid-template-columns:1.1fr 1fr 1.25fr;gap:16px;align-items:stretch;padding:16px 18px;border:1px solid #d5e5e2;border-radius:14px;background:linear-gradient(115deg,#eef8f5,#fffdf8 74%)}.control-block{min-width:0}.control-block+.control-block{padding-left:16px;border-left:1px solid #cfe0dd}.control-label{display:block;color:var(--muted);font-size:.76rem;font-weight:800}.control-value{display:flex;align-items:center;gap:8px;margin-top:5px;color:var(--navy);font-size:1rem;font-weight:900}.control-reasons{margin:5px 0 0;padding-left:18px;color:var(--ink);font-size:.84rem}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin-bottom:13px}.section-head h2{margin:0;color:var(--navy-deep);font-size:1.18rem;letter-spacing:-.02em}.section-head p{margin:2px 0 0;color:var(--muted);font-size:.84rem}.section-head-aside{color:var(--muted);font-size:.78rem;font-weight:700;text-align:right}.panel{min-width:0;padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--paper);box-shadow:var(--shadow)}.resource-section{min-width:0}.resource-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.resource-card{min-width:0;display:grid;gap:15px;padding:18px;border:1px solid var(--line);border-top:4px solid var(--teal);border-radius:14px;background:var(--paper);box-shadow:0 9px 22px rgba(23,50,71,.06)}.resource-card--gold{border-top-color:var(--gold)}.resource-card--navy{border-top-color:var(--navy)}.resource-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.resource-card h3{margin:3px 0 0;color:var(--navy-deep);font-size:1.05rem}.resource-provider{display:block;margin-top:3px;color:var(--muted);font-size:.78rem}.resource-body{display:grid;grid-template-columns:126px minmax(0,1fr);gap:17px;align-items:center}.donut-wrap{display:grid;justify-items:center;gap:7px}.donut{position:relative;display:grid;place-items:center;width:120px;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--donut-color,#137d78) 0 var(--donut-progress,0%),#e8eeeb var(--donut-progress,0%) 100%);box-shadow:inset 0 0 0 1px rgba(23,50,71,.08)}.donut::after{content:"";position:absolute;inset:13px;border-radius:50%;background:var(--paper);box-shadow:inset 0 0 0 1px rgba(23,50,71,.05)}.donut--unknown{background:repeating-conic-gradient(#e6ece9 0 9deg,#d2dcda 9deg 18deg)}.donut-center{position:relative;z-index:1;color:var(--navy-deep);font-size:1.12rem;font-weight:900;text-align:center;line-height:1.1}.donut-center small{display:block;margin-top:3px;color:var(--muted);font-size:.64rem;letter-spacing:.02em}.donut-caption{color:var(--muted);font-size:.73rem;font-weight:700;text-align:center}.resource-reading{min-width:0}.resource-reading strong{display:block;color:var(--navy-deep);font-size:1.32rem;letter-spacing:-.025em}.resource-reading>span{display:block;margin-top:2px;color:var(--muted);font-size:.78rem}.resource-facts{display:grid;gap:7px;margin:12px 0 0}.resource-fact{display:flex;justify-content:space-between;gap:12px;padding-top:7px;border-top:1px solid #edf0ed;font-size:.78rem}.resource-fact dt{color:var(--muted)}.resource-fact dd{margin:0;color:var(--navy);font-weight:800;text-align:right}.resource-note{margin:0;padding-top:12px;border-top:1px dashed var(--line-strong);color:var(--muted);font-size:.82rem}.resource-note strong{color:var(--navy)}.legend{display:flex;flex-wrap:wrap;gap:6px 10px;margin:0;padding:0;list-style:none}.legend li{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:.73rem}.legend-dot{width:8px;height:8px;border-radius:50%;background:var(--dot-color,#137d78)}.table-wrap{width:100%;min-width:0;overflow-x:auto}.data-table{width:100%;border-collapse:collapse;font-size:.84rem}.data-table th,.data-table td{padding:11px 10px;border-bottom:1px solid #e7ece9;vertical-align:top;text-align:left}.data-table th{color:var(--muted);font-size:.74rem;font-weight:900;letter-spacing:.02em;white-space:nowrap}.data-table td{color:var(--ink)}.data-table tbody tr:last-child td{border-bottom:0}.data-table tbody tr:hover{background:#fbfcfa}.cell-title{display:block;color:var(--navy-deep);font-weight:900}.cell-sub{display:block;margin-top:2px;color:var(--muted);font-size:.74rem}.value-unknown{color:#68777e;font-weight:800}.value-zero{color:var(--teal);font-weight:900}.table-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.table-status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.table-status--ok{color:#287c5b}.table-status--unknown{color:#7a888e}.table-status--stale{color:#9a7623}.table-status--manual{color:#50689a}.table-status--critical{color:var(--danger)}.subtle-rule{margin:17px 0;border:0;border-top:1px solid var(--line)}.app-table-card{padding-bottom:13px}.app-table-card .data-table th:nth-child(n+2),.app-table-card .data-table td:nth-child(n+2){min-width:112px}.app-table-card .data-table th:last-child,.app-table-card .data-table td:last-child{min-width:82px}.app-table-note{margin:10px 0 0;color:var(--muted);font-size:.79rem}.two-column{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:18px}.source-list{display:grid;gap:9px}.source-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;padding:11px 0;border-bottom:1px solid #e8edeb}.source-row:last-child{border-bottom:0}.source-main{min-width:0}.source-name{display:block;color:var(--navy);font-weight:900}.source-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px;color:var(--muted);font-size:.75rem}.source-error{grid-column:1/-1;color:#9a4b4d;font-size:.76rem;overflow-wrap:anywhere}.source-link{color:var(--teal);font-weight:800;text-decoration-thickness:1px;text-underline-offset:2px}.event-list{display:grid;gap:9px}.event-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid #e8edeb}.event-row:last-child{border-bottom:0}.event-message{margin:0;color:var(--navy);font-size:.84rem;font-weight:750}.event-meta{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px;color:var(--muted);font-size:.74rem}.level-chip--notice{background:#e8f0f3;color:#49626f}.level-chip--warning{background:var(--gold-soft);color:#80621e}.level-chip--critical,.level-chip--error{background:var(--danger-soft);color:#963a3f}.level-chip--recovery{background:#dff1e9;color:#22694e}.delivery-chip{border:1px solid var(--line);background:#f5f7f5;color:var(--muted);font-size:.7rem}.trend-panel{display:grid;gap:0}.trend-frame{min-width:0;padding:10px 0 0;overflow:hidden;border-top:1px solid #edf0ed}.trend-svg{display:block;width:100%;height:auto;min-width:620px}.trend-empty{display:grid;place-items:center;min-height:170px;border:1px dashed var(--line-strong);border-radius:10px;color:var(--muted);font-size:.9rem}.trend-caption{margin:10px 0 0;color:var(--muted);font-size:.78rem}.trend-caption strong{color:var(--navy)}.trend-table{margin-top:14px}.trend-table .data-table{font-size:.76rem}.trend-table .data-table th,.trend-table .data-table td{padding:7px 8px}.details-table .data-table th:nth-child(3),.details-table .data-table td:nth-child(3){min-width:115px}.details-table .data-table th:nth-child(6),.details-table .data-table td:nth-child(6){min-width:130px}.note-box{margin-top:13px;padding:12px 14px;border-left:3px solid var(--gold);background:#fffbf0;color:var(--ink);font-size:.82rem}.note-box strong{color:var(--navy)}.growth-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.growth-item{padding:14px;border:1px solid var(--line);border-radius:11px;background:#fbfcfa}.growth-item dt{color:var(--muted);font-size:.77rem;font-weight:800}.growth-item dd{margin:5px 0 0;color:var(--navy-deep);font-size:1.16rem;font-weight:900}.growth-item small{display:block;margin-top:4px;color:var(--muted);font-size:.72rem}.readonly-label{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:.76rem;font-weight:800}.readonly-label::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--gold)}.owner-panel{border-color:#cededa;background:linear-gradient(135deg,#fffdf8,#f2f9f6)}.owner-lead{margin:0;color:var(--muted);font-size:.84rem}.write-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:18px;margin-top:17px}.ops-form{padding:17px;border:1px solid #d4e3df;border-radius:12px;background:rgba(255,255,255,.58)}.ops-form h3{margin:0;color:var(--navy);font-size:1rem}.form-intro{margin:4px 0 14px;color:var(--muted);font-size:.79rem}.form-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.form-field{display:grid;gap:4px}.form-field--wide{grid-column:1/-1}.form-field label,.form-field>span{color:var(--navy);font-size:.78rem;font-weight:850}.ops-input{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;color:var(--ink)}.form-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:14px}.form-help{margin:0;color:var(--muted);font-size:.74rem}.confirm-line{display:flex;align-items:flex-start;gap:8px;color:var(--ink);font-size:.8rem}.confirm-line input{margin-top:4px;accent-color:var(--teal)}.write-status{min-height:24px;margin:11px 0 0;color:var(--muted);font-size:.8rem}.write-status--error{color:var(--danger);font-weight:800}.write-status--success{color:#287c5b;font-weight:800}.export-note{padding:15px;border:1px dashed #aaccc5;border-radius:11px;background:#f4fbf8;color:var(--navy);font-size:.85rem}.empty-row{text-align:center!important;color:var(--muted)!important;padding:24px!important}.ops-footer{display:flex;justify-content:space-between;gap:16px;padding-top:22px;color:var(--muted);font-size:.74rem}.ops-footer strong{color:var(--navy)}.boot-state{display:grid;place-items:center;min-height:55vh;color:var(--muted);font-weight:800}.boot-mark{display:block;width:22px;height:22px;margin-bottom:12px;border:3px solid #d4e4e0;border-top-color:var(--teal);border-radius:50%;animation:ops-spin .85s linear infinite}.no-script-message{width:min(100% - 32px,720px);margin:40px auto;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:var(--navy)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes ops-spin{to{transform:rotate(360deg)}}
    @media (max-width:1000px){.resource-body{grid-template-columns:105px minmax(0,1fr);gap:12px}.donut{width:100px}.two-column,.write-grid{grid-template-columns:1fr}.control-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.control-block+.control-block{padding-left:12px}}
    @media (max-width:760px){.ops-shell{width:min(100% - 22px,680px);padding-top:20px}.ops-header{display:grid;gap:17px;padding-bottom:20px}.header-side{justify-items:start;min-width:0}.snapshot-meta{text-align:left}.header-actions{justify-content:flex-start}.signal-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.control-strip{grid-template-columns:1fr;gap:11px}.control-block+.control-block{padding:11px 0 0;border-top:1px solid #cfe0dd;border-left:0}.resource-grid{grid-template-columns:1fr}.resource-card{padding:16px}.panel{padding:17px}.section-head{align-items:flex-start;display:grid;gap:5px}.section-head-aside{text-align:left}.growth-grid{grid-template-columns:1fr}.ops-footer{display:grid;gap:5px}.form-fields{grid-template-columns:1fr}.form-field--wide{grid-column:auto}}
    @media (max-width:480px){.ops-shell{width:calc(100% - 16px)}.signal-card{padding:13px}.signal-value{font-size:1.3rem}.header-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.header-actions .ops-button{width:100%;padding-inline:8px}.resource-body{grid-template-columns:96px minmax(0,1fr)}.donut{width:92px}.data-table,.data-table thead,.data-table tbody,.data-table tr,.data-table th,.data-table td{display:block}.data-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.app-table-card .data-table tbody{display:grid;gap:10px}.app-table-card .data-table tr{padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff}.app-table-card .data-table td{display:grid;grid-template-columns:minmax(105px,.7fr) minmax(0,1.3fr);gap:9px;padding:5px 0;border:0}.app-table-card .data-table td::before{content:attr(data-label);color:var(--muted);font-size:.72rem;font-weight:850}.app-table-card .data-table td:first-child{padding-top:0}.app-table-card .data-table td:last-child{padding-bottom:0}.app-table-card .data-table td:nth-child(n+2){min-width:0}.source-row{grid-template-columns:minmax(0,1fr)}.source-row>.status-chip{justify-self:start}.trend-frame{overflow-x:auto;margin-inline:-3px;padding-inline:3px}}
    .table-wrap{width:100%;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
    .control-help{display:block;margin-top:7px;color:var(--teal);font-size:.76rem;font-weight:800}.traffic-panel .data-table th:nth-child(2),.traffic-panel .data-table td:nth-child(2),.traffic-panel .data-table th:nth-child(3),.traffic-panel .data-table td:nth-child(3),.traffic-panel .data-table th:nth-child(4),.traffic-panel .data-table td:nth-child(4){min-width:100px}.future-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.future-option{min-width:0;padding:14px;border:1px solid var(--line);border-radius:11px;background:#fbfcfa}.future-option h3{margin:0;color:var(--navy);font-size:.95rem}.future-option p{margin:5px 0 0;color:var(--muted);font-size:.8rem}.future-link--disabled{color:var(--muted)}.growth-projection{margin-top:13px;padding:15px;border:1px solid #d4e3df;border-radius:11px;background:#f5fbf8}.projection-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.projection-head h3{margin:0;color:var(--navy);font-size:.98rem}.projection-head p{margin:3px 0 0;color:var(--muted);font-size:.78rem}.growth-input-label{display:grid;min-width:210px;gap:4px;color:var(--navy);font-size:.76rem;font-weight:850}.growth-input-static{color:var(--navy);font-size:.8rem;font-weight:850;white-space:nowrap}.projection-summary{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 8px;margin-top:13px;color:var(--muted);font-size:.8rem}.projection-summary strong{color:var(--navy-deep);font-size:1.05rem}.projection-summary .cell-sub{width:100%}.projection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.projection-grid>div{display:grid;gap:4px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--muted);font-size:.76rem;font-weight:800}.projection-grid .value-unknown,.projection-grid>div>span:not(.value-unknown){color:var(--navy-deep);font-size:1rem}@media (max-width:760px){.future-grid{grid-template-columns:1fr}.projection-head{display:grid;gap:10px}.growth-input-label{min-width:0}}@media (max-width:480px){.projection-grid{grid-template-columns:1fr}}
  `;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function finiteCount(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
  }

  function safeString(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    return redactSensitive(String(value)).slice(0, 800);
  }

  function redactSensitive(value) {
    return String(value ?? "")
      .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, "[REDACTED_SECRET]")
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED_SECRET]")
      .replace(/\b(?:sk|rk|ghp|github_pat|xoxb|AKIA)[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
      .replace(/([?&](?:token|key|secret|password|signature|auth)=)[^&#\s]+/gi, "$1[REDACTED_SECRET]")
      .replace(/\b(token|api[_-]?key|secret|password)\s*[:=]\s*["']?[^,\s"']+/gi, "$1=[REDACTED_SECRET]");
  }

  function escapeHtml(value) {
    return redactSensitive(String(value ?? ""))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/\r|\n/g, " ");
  }

  function normalizeTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function normalizeDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
    const candidate = `${value.trim()}T00:00:00.000Z`;
    const date = new Date(candidate);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.trim() ? value.trim() : null;
  }

  function formatDateTime(value) {
    const normalized = normalizeTimestamp(value);
    if (!normalized) return "不明";
    try {
      return new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tokyo",
      }).format(new Date(normalized));
    } catch (_error) {
      return normalized.replace("T", " ").slice(0, 16);
    }
  }

  function formatDateOnly(value) {
    const normalized = normalizeTimestamp(value);
    if (!normalized) return "不明";
    return normalized.slice(0, 10);
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "不明";
    try {
      return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
    } catch (_error) {
      return String(Math.round(value * 10) / 10);
    }
  }

  function formatInteger(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "不明";
    try {
      return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
    } catch (_error) {
      return String(Math.round(value));
    }
  }

  function formatBytes(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "不明";
    if (value === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1);
    const scaled = value / (1000 ** exponent);
    const digits = exponent === 0 ? 0 : exponent >= 3 ? 3 : 2;
    return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits }).format(scaled)} ${units[exponent]}`;
  }

  function formatCount(value) {
    return value === null ? "不明" : `${formatInteger(value)}件`;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "不明";
  }

  function statusClass(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : "unknown";
  }

  function statusChip(status, label = statusLabel(status)) {
    return `<span class="status-chip status-chip--${statusClass(status)}">${escapeHtml(label)}</span>`;
  }

  function tableStatus(status, label = statusLabel(status)) {
    return `<span class="table-status table-status--${statusClass(status)}">${escapeHtml(label)}</span>`;
  }

  function normalizeLimit(value, fallback) {
    if (value === null) return null;
    const parsed = finiteNonNegative(value);
    return parsed === null ? fallback : parsed;
  }

  function createUnknownPart(app) {
    return { appId: app.id, label: app.label, bytes: null, count: null };
  }

  function createUnknownMetric(definition) {
    return {
      id: definition.id,
      label: definition.label,
      provider: definition.provider,
      kind: definition.kind,
      used: null,
      limit: definition.limit,
      unit: definition.kind === "requests" ? "requests" : "bytes",
      status: "unknown",
      observedAt: null,
      source: "不明",
      note: definition.note || "スナップショット未取得。",
      parts: APP_DEFINITIONS.map(createUnknownPart),
      details: [],
    };
  }

  function createUnknownSource(definition) {
    return {
      id: definition.id,
      label: definition.label,
      status: "unknown",
      checkedAt: null,
      lastSuccessAt: null,
      failures: 0,
      error: null,
    };
  }

  function createUnknownSnapshot() {
    return {
      version: 1,
      snapshotState: "unknown",
      generatedAt: null,
      control: {
        mode: null,
        observeUntil: null,
        blocked: false,
        reasons: ["最新スナップショット未取得"],
        canResume: false,
      },
      sources: SOURCE_DEFINITIONS.map(createUnknownSource),
      metrics: METRIC_DEFINITIONS.map(createUnknownMetric),
      events: [],
      candidates: [],
      growth: {
        questionCount: null,
        questionBytes: null,
        imageBytes: null,
        note: "増加推計は未取得です。",
      },
      billing: {
        storageAverageBytes: null,
        periodStart: null,
        periodEnd: null,
        confirmedAt: null,
      },
    };
  }

  function normalizeControl(value) {
    const source = isRecord(value) ? value : {};
    const mode = ["observe", "armed", "blocked"].includes(source.mode) ? source.mode : null;
    const reasons = Array.isArray(source.reasons)
      ? source.reasons.map((reason) => safeString(reason)).filter(Boolean).slice(0, 12)
      : [];
    return {
      mode,
      observeUntil: normalizeTimestamp(source.observeUntil),
      blocked: source.blocked === true,
      reasons: reasons.length ? reasons : mode === null ? ["最新スナップショット未取得"] : [],
      canResume: source.canResume === true,
    };
  }

  function normalizeSource(value, fallback) {
    const source = isRecord(value) ? value : {};
    const status = ["ok", "unknown", "stale"].includes(source.status) ? source.status : "unknown";
    return {
      id: fallback.id,
      label: fallback.label,
      status,
      checkedAt: normalizeTimestamp(source.checkedAt),
      lastSuccessAt: normalizeTimestamp(source.lastSuccessAt),
      failures: finiteCount(source.failures) ?? 0,
      error: source.error === null || source.error === undefined ? null : safeString(source.error, "不明"),
    };
  }

  function normalizePart(value, fallback) {
    const source = isRecord(value) ? value : {};
    return {
      appId: fallback.appId,
      label: fallback.label,
      bytes: source.bytes === null || source.bytes === undefined ? null : finiteNonNegative(source.bytes),
      count: source.count === null || source.count === undefined ? null : finiteCount(source.count),
    };
  }

  function normalizeMetric(value, fallback) {
    const source = isRecord(value) ? value : {};
    const controlled = METRIC_DEFINITIONS.some((definition) => definition.id === fallback.id);
    const status = ["ok", "unknown", "stale", "manual"].includes(source.status)
      ? source.status
      : "unknown";
    const incomingParts = Array.isArray(source.parts) ? source.parts : [];
    const partsById = new Map(
      incomingParts
        .filter(isRecord)
        .map((part) => [safeString(part.appId), part])
        .filter(([appId]) => Boolean(appId)),
    );
    const kind = controlled ? fallback.kind : ["storage", "database", "requests", "egress"].includes(source.kind) ? source.kind : fallback.kind;
    const unknownParts = fallback.parts || APP_DEFINITIONS.map(createUnknownPart);
    const hasEmptyNonBreakdown = Array.isArray(source.parts) && source.parts.length === 0 && (kind === "requests" || kind === "egress" || fallback.id === "database-minkiru" || fallback.id === "database-ranking");
    const parts = hasEmptyNonBreakdown ? [] : unknownParts.map((part) => normalizePart(partsById.get(part.appId), part));
    const details = Array.isArray(source.details)
      ? source.details.slice(0, 100).map((detail) => {
          const item = isRecord(detail) ? detail : {};
          return {
            label: safeString(item.label, "不明") || "不明",
            bytes: item.bytes === null || item.bytes === undefined ? null : finiteNonNegative(item.bytes),
            count: item.count === null || item.count === undefined ? null : finiteCount(item.count),
          };
        })
      : [];
    const sourceValue = safeString(source.source, fallback.source || "不明") || "不明";
    return {
      id: fallback.id,
      label: controlled ? fallback.label : safeString(source.label, fallback.label) || fallback.label,
      provider: controlled ? fallback.provider : safeString(source.provider, fallback.provider) || fallback.provider,
      kind,
      used: source.used === null || source.used === undefined ? null : finiteNonNegative(source.used),
      limit: fallback.id === "supabase-database"
        ? null
        : Object.prototype.hasOwnProperty.call(source, "limit")
          ? normalizeLimit(source.limit, fallback.limit)
          : fallback.limit,
      unit: controlled ? fallback.unit : ["bytes", "requests"].includes(source.unit) ? source.unit : fallback.unit,
      status,
      observedAt: normalizeTimestamp(source.observedAt),
      source: sourceValue,
      note: safeString(source.note, fallback.note || "") || "",
      parts,
      details,
    };
  }

  function normalizeEvent(value) {
    const source = isRecord(value) ? value : {};
    const level = Object.prototype.hasOwnProperty.call(EVENT_LEVEL_LABELS, source.level) ? source.level : "notice";
    const delivery = Object.prototype.hasOwnProperty.call(DELIVERY_LABELS, source.delivery)
      ? source.delivery
      : "not-requested";
    return {
      at: normalizeTimestamp(source.at),
      level,
      message: safeString(source.message, "不明") || "不明",
      delivery,
    };
  }

  function normalizeCandidate(value) {
    const source = isRecord(value) ? value : {};
    return {
      label: safeString(source.label, "不明") || "不明",
      bytes: source.bytes === null || source.bytes === undefined ? null : finiteNonNegative(source.bytes),
      count: source.count === null || source.count === undefined ? null : finiteCount(source.count),
      status: safeString(source.status, "不明") || "不明",
      advice: safeString(source.advice, "") || "",
    };
  }

  function normalizeGrowth(value) {
    const source = isRecord(value) ? value : {};
    return {
      questionCount: source.questionCount === null || source.questionCount === undefined
        ? null
        : finiteCount(source.questionCount),
      questionBytes: source.questionBytes === null || source.questionBytes === undefined
        ? null
        : finiteNonNegative(source.questionBytes),
      imageBytes: source.imageBytes === null || source.imageBytes === undefined
        ? null
        : finiteNonNegative(source.imageBytes),
      note: safeString(source.note, "増加推計は未取得です。") || "増加推計は未取得です。",
    };
  }

  function normalizeBilling(value) {
    const source = isRecord(value) ? value : {};
    return {
      storageAverageBytes: source.storageAverageBytes === null || source.storageAverageBytes === undefined
        ? null
        : finiteNonNegative(source.storageAverageBytes),
      periodStart: normalizeDateOnly(source.periodStart),
      periodEnd: normalizeDateOnly(source.periodEnd),
      confirmedAt: normalizeTimestamp(source.confirmedAt),
    };
  }

  function normalizeLatest(value) {
    const source = isRecord(value) ? value : {};
    const unknown = createUnknownSnapshot();
    const incomingSources = Array.isArray(source.sources) ? source.sources : [];
    const sourceById = new Map(
      incomingSources
        .filter(isRecord)
        .map((item) => [safeString(item.id), item])
        .filter(([id]) => Boolean(id)),
    );
    const sources = SOURCE_DEFINITIONS.map((definition) => normalizeSource(sourceById.get(definition.id), definition));

    const incomingMetrics = Array.isArray(source.metrics) ? source.metrics : [];
    const metricById = new Map(
      incomingMetrics
        .filter(isRecord)
        .map((item) => [safeString(item.id), item])
        .filter(([id]) => Boolean(id)),
    );
    const metrics = METRIC_DEFINITIONS.map((definition) => normalizeMetric(metricById.get(definition.id), createUnknownMetric(definition)));
    const knownMetricIds = new Set(METRIC_DEFINITIONS.map((definition) => definition.id));
    incomingMetrics.forEach((item) => {
      if (!isRecord(item)) return;
      const id = safeString(item.id);
      if (!id || knownMetricIds.has(id)) return;
      const fallback = {
        id,
        label: safeString(item.label, id) || id,
        provider: safeString(item.provider, "不明") || "不明",
        kind: ["storage", "database", "requests", "egress"].includes(item.kind) ? item.kind : "egress",
        limit: item.limit === null ? null : finiteNonNegative(item.limit),
        unit: ["bytes", "requests"].includes(item.unit) ? item.unit : "bytes",
        note: "",
        parts: APP_DEFINITIONS.map(createUnknownPart),
      };
      metrics.push(normalizeMetric(item, fallback));
    });

    const generatedAt = normalizeTimestamp(source.generatedAt);
    return {
      version: Number.isFinite(source.version) ? source.version : unknown.version,
      snapshotState: ["current", "stale", "unknown"].includes(source.snapshotState)
        ? source.snapshotState
        : generatedAt ? "current" : "unknown",
      generatedAt,
      control: normalizeControl(source.control),
      sources,
      metrics,
      events: Array.isArray(source.events) ? source.events.slice(0, 100).map(normalizeEvent) : [],
      candidates: Array.isArray(source.candidates) ? source.candidates.slice(0, 100).map(normalizeCandidate) : [],
      growth: normalizeGrowth(source.growth),
      billing: normalizeBilling(source.billing),
    };
  }

  function markSnapshotStale(snapshotValue) {
    const snapshot = normalizeLatest(snapshotValue);
    if (!snapshot.generatedAt) return snapshot;
    return {
      ...snapshot,
      snapshotState: "stale",
      sources: snapshot.sources.map((source) => ({
        ...source,
        status: source.status === "unknown" ? "unknown" : "stale",
      })),
      metrics: snapshot.metrics.map((metric) => ({
        ...metric,
        status: metric.status === "unknown" && metric.used === null ? "unknown" : "stale",
      })),
      control: {
        ...snapshot.control,
        reasons: Array.from(new Set([
          ...(snapshot.control.reasons || []),
          "最新スナップショット取得失敗。前回保存値を表示中。",
        ])).slice(0, 12),
      },
    };
  }

  function normalizeDaily(value) {
    const source = isRecord(value) ? value : {};
    return {
      at: normalizeTimestamp(source.at),
      storageBytes: source.storageBytes === null || source.storageBytes === undefined ? null : finiteNonNegative(source.storageBytes),
      databaseBytes: source.databaseBytes === null || source.databaseBytes === undefined ? null : finiteNonNegative(source.databaseBytes),
      r2Bytes: source.r2Bytes === null || source.r2Bytes === undefined ? null : finiteNonNegative(source.r2Bytes),
    };
  }

  function normalizeHistory(value) {
    const source = isRecord(value) ? value : {};
    return {
      daily: Array.isArray(source.daily) ? source.daily.slice(-366).map(normalizeDaily) : [],
      recent: Array.isArray(source.recent) ? source.recent.slice(-100).map(normalizeDaily) : [],
    };
  }

  function metricMap(snapshot) {
    return new Map((snapshot.metrics || []).map((metric) => [metric.id, metric]));
  }

  function sourceMap(snapshot) {
    return new Map((snapshot.sources || []).map((source) => [source.id, source]));
  }

  function metricRemaining(metric) {
    if (!metric || metric.limit === null || metric.used === null) return null;
    return Math.max(0, metric.limit - metric.used);
  }

  function metricPercent(metric) {
    if (!metric || metric.used === null || metric.limit === null || metric.limit <= 0) return null;
    return (metric.used / metric.limit) * 100;
  }

  function partsIntegrity(metric) {
    if (!metric || metric.used === null || !Array.isArray(metric.parts)) return "unknown";
    if (metric.parts.some((part) => part.bytes === null)) return "unknown";
    const sum = metric.parts.reduce((total, part) => total + part.bytes, 0);
    return sum === metric.used ? "match" : "mismatch";
  }

  function partFor(metric, appId) {
    if (!metric || !Array.isArray(metric.parts)) return { bytes: null, count: null, label: appId };
    return metric.parts.find((part) => part.appId === appId) || { bytes: null, count: null, label: appId };
  }

  function countUnknownValues(snapshot) {
    return (snapshot.sources || []).filter((source) => source.status === "unknown").length;
  }

  function countStaleValues(snapshot) {
    return (snapshot.sources || []).filter((source) => source.status === "stale").length;
  }

  function safeHttpUrl(value) {
    const source = safeString(value).trim();
    if (!/^https?:\/\//i.test(source)) return null;
    try {
      const url = new URL(source);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function sourceMarkup(value, options = {}) {
    const label = safeString(value, "不明") || "不明";
    if (options.disabled === true) return `<span>${escapeHtml(label)}</span>`;
    const href = safeHttpUrl(label);
    if (!href) return `<span>${escapeHtml(label)}</span>`;
    return `<a class="source-link" href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`;
  }

  function valueMarkup(value, formatter = formatBytes) {
    if (value === null || value === undefined) return `<span class="value-unknown" aria-label="不明">不明</span>`;
    if (value === 0) return `<span class="value-zero">${escapeHtml(formatter(value))}</span>`;
    return `<span>${escapeHtml(formatter(value))}</span>`;
  }

  function donutGradient(parts, metric) {
    const known = (parts || []).filter((part) => part.bytes !== null && part.bytes !== undefined);
    const knownTotal = known.reduce((sum, part) => sum + part.bytes, 0);
    const isDatabaseComposition = metric.id === "supabase-database";
    const base = isDatabaseComposition
      ? metric.used === null ? knownTotal : metric.used
      : metric.limit !== null ? metric.limit : metric.used === null ? knownTotal : metric.used;
    if (!Number.isFinite(base) || base <= 0) return "#e8eeeb 0 100%";

    let cursor = 0;
    const segments = [];
    known.forEach((part) => {
      if (part.bytes <= 0) return;
      const start = cursor;
      cursor = Math.min(100, cursor + (part.bytes / base) * 100);
      if (cursor > start) {
        segments.push(`${APP_COLORS[part.appId] || "#6a8f8e"} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`);
      }
    });

    if (metric.used !== null && knownTotal < metric.used) {
      const usedBoundary = isDatabaseComposition
        ? 100
        : Math.min(100, (metric.used / base) * 100);
      if (cursor < usedBoundary) {
        segments.push(`#b7c4c0 ${cursor.toFixed(3)}% ${usedBoundary.toFixed(3)}%`);
        cursor = usedBoundary;
      }
    }

    if (!isDatabaseComposition && metric.limit !== null && metric.used !== null && cursor < 100) {
      segments.push(`#e8eeeb ${cursor.toFixed(3)}% 100%`);
    }
    return segments.length ? segments.join(",") : "#e8eeeb 0 100%";
  }

  function donutForMetric(metric) {
    const isDatabaseComposition = metric.id === "supabase-database";
    if (isDatabaseComposition) {
      const knownParts = (metric.parts || []).filter((part) => part.bytes !== null);
      const knownTotal = knownParts.reduce((sum, part) => sum + part.bytes, 0);
      if (!knownParts.length && metric.used === null) {
        return {
          unknown: true,
          center: "不明",
          sub: "構成比",
          gradient: "#d1dad7 0 100%",
          caption: "構成比を取得できません",
          };
      }
      const total = metric.used === null ? knownTotal : metric.used;
      return {
        unknown: false,
        center: metric.used === null ? "内訳" : formatBytes(metric.used),
        sub: metric.used === null ? "既知分" : "物理量",
        gradient: donutGradient(metric.parts || [], { ...metric, used: total }),
        caption: metric.used === null
          ? "物理量不明・既知内訳"
          : (metric.parts || []).some((part) => part.bytes === null) ? "一部未取得" : "構成比のみ",
      };
    }
    const percentage = metricPercent(metric);
    if (metric.used === null || percentage === null) {
      return {
        unknown: true,
        center: "不明",
        sub: "使用率",
        gradient: "#d1dad7 0 100%",
        caption: "観測値を取得できません",
      };
    }
    return {
      unknown: false,
      center: `${formatNumber(percentage)}%`,
      sub: "使用率",
      gradient: donutGradient(metric.parts || [], metric),
      caption: metric.status === "stale" ? "更新待ち" : "現在値",
    };
  }

  function resourcePolicy(metric) {
    if (metric.id === "supabase-database") return "合算の容量判定なし（Supabase DB別に判定）";
    if (metric.id === "database-minkiru" || metric.id === "database-ranking") return "DB別の上限はAPI提供時のみ表示";
    if (metric.id === "r2-storage") return "無料枠10 GB / 警戒7 GB / ソフト停止8 GB";
    if (metric.id === "supabase-storage") return "組織上限1 GB";
    return "APIが返した上限だけを表示";
  }

  function formatSignedBytes(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "不明";
    if (value === 0) return "0 B";
    return `${value > 0 ? "+" : "−"}${formatBytes(Math.abs(value))}`;
  }

  function renderBillingFacts(metric, billingValue) {
    if (metric.id !== "supabase-storage") return "";
    const billing = billingValue || {};
    const difference = billing.storageAverageBytes === null || billing.storageAverageBytes === undefined || metric.used === null
      ? null
      : billing.storageAverageBytes - metric.used;
    const period = billing.periodStart && billing.periodEnd
      ? `${billing.periodStart}〜${billing.periodEnd}`
      : "不明";
    return `
      <div class="resource-fact"><dt>期間平均（保存量）</dt><dd>${valueMarkup(billing.storageAverageBytes)}</dd></div>
      <div class="resource-fact"><dt>平均 − 現在</dt><dd>${valueMarkup(difference, formatSignedBytes)}</dd></div>
      <div class="resource-fact"><dt>平均の確認期間</dt><dd>${escapeHtml(period)}<br>確認: ${escapeHtml(formatDateTime(billing.confirmedAt))}</dd></div>`;
  }

  function renderResourceCard(metric, variant, billing) {
    const donut = donutForMetric(metric);
    const percentage = metricPercent(metric);
    const isDatabaseComposition = metric.id === "supabase-database";
    const usageLabel = isDatabaseComposition ? "内訳合計" : "現在の物理使用量";
    const limitLabel = isDatabaseComposition
      ? "合算上限"
      : metric.limit === null
        ? "契約・API上限"
      : "契約・運用上限";
    const limitValue = isDatabaseComposition ? "容量判定なし" : metric.limit === null ? "不明" : formatBytes(metric.limit);
    const integrity = partsIntegrity(metric);
    const integrityLabel = integrity === "match" ? "内訳一致" : integrity === "mismatch" ? "要確認" : "未確認";
    return `
      <article class="resource-card resource-card--${variant}" data-resource-id="${escapeAttribute(metric.id)}" data-quota-scope="${isDatabaseComposition ? "composition-only" : "provider-limit"}">
        <div class="resource-card-head">
          <div>
            <p class="resource-kicker">${escapeHtml(metric.kind === "database" ? "DATABASE" : "STORAGE")}</p>
            <h3>${escapeHtml(metric.label)}</h3>
            <span class="resource-provider">${escapeHtml(metric.provider)}</span>
          </div>
          ${statusChip(metric.status)}
        </div>
        <div class="resource-body">
          <div class="donut-wrap">
            <div class="donut${donut.unknown ? " donut--unknown" : ""}" role="img" aria-label="${escapeAttribute(`${metric.label} ${donut.unknown ? "不明" : donut.center}`)}" style="--donut-progress:100%;--donut-color:#137d78;background:conic-gradient(${escapeAttribute(donut.gradient)})">
              <span class="donut-center">${escapeHtml(donut.center)}<small>${escapeHtml(donut.sub)}</small></span>
            </div>
            <span class="donut-caption">${escapeHtml(donut.caption)}</span>
          </div>
          <div class="resource-reading">
            <strong>${valueMarkup(metric.used)}</strong>
            <span>${escapeHtml(usageLabel)}</span>
            <dl class="resource-facts">
              <div class="resource-fact"><dt>${escapeHtml(limitLabel)}</dt><dd>${escapeHtml(limitValue)}</dd></div>
              <div class="resource-fact"><dt>観測時刻</dt><dd>${escapeHtml(formatDateTime(metric.observedAt))}</dd></div>
              <div class="resource-fact"><dt>判定</dt><dd>${percentage === null ? (isDatabaseComposition ? "構成比のみ" : "不明") : `${escapeHtml(formatNumber(percentage))}%`}</dd></div>
              <div class="resource-fact"><dt>内訳整合性</dt><dd>${escapeHtml(integrityLabel)}</dd></div>
              ${renderBillingFacts(metric, billing)}
            </dl>
          </div>
        </div>
        <p class="resource-note"><strong>${escapeHtml(resourcePolicy(metric))}</strong><br>${escapeHtml(metric.note || "")}</p>
        ${renderResourceLegend(metric)}
      </article>`;
  }

  function partShare(metric, part) {
    if (!metric || !part || part.bytes === null || metric.used === null) return null;
    if (metric.used === 0) return part.bytes === 0 ? 0 : null;
    return (part.bytes / metric.used) * 100;
  }

  function renderResourceLegend(metric) {
    const parts = metric.parts || [];
    const labels = parts.map((part) => {
      const share = partShare(metric, part);
      const shareLabel = share === null ? "使用量内 不明" : `使用量内 ${formatNumber(share)}%`;
      return `<li><span class="legend-dot" style="--dot-color:${APP_COLORS[part.appId] || "#6a8f8e"}"></span><span>${escapeHtml(part.label)}: ${part.bytes === null ? "不明" : escapeHtml(formatBytes(part.bytes))} / ${escapeHtml(shareLabel)}</span></li>`;
    });
    if (parts.some((part) => part.bytes === null)) {
      labels.push(`<li><span class="legend-dot" style="--dot-color:#b7c4c0"></span><span>未取得内訳: 不明</span></li>`);
    }
    if (metric.id !== "supabase-database") {
      const remaining = metricRemaining(metric);
      const remainingShare = remaining === null || metric.limit === null || metric.limit <= 0 ? null : (remaining / metric.limit) * 100;
      const remainingLabel = remaining === null
        ? "不明"
        : `${formatBytes(remaining)} / 枠内 ${formatNumber(remainingShare)}%`;
      labels.push(`<li><span class="legend-dot" style="--dot-color:#e8eeeb"></span><span>残り枠: ${escapeHtml(remainingLabel)}</span></li>`);
    }
    return `<ul class="legend" aria-label="${escapeAttribute(metric.id === "supabase-database" ? "Supabase DB構成比の凡例" : `${metric.label}のアプリ別内訳と残り枠`)}">${labels.join("")}</ul>`;
  }

  function renderCompositionLegend(metric) {
    return renderResourceLegend(metric);
  }

  function capacityCell(metric, part) {
    const share = partShare(metric, part);
    const countLabel = part.count === null ? "不明" : `${formatInteger(part.count)}件`;
    const shareLabel = share === null ? "不明" : `${formatNumber(share)}%`;
    return `<div>${valueMarkup(part.bytes)}<span class="cell-sub">件数: ${escapeHtml(countLabel)} / 使用量内 ${escapeHtml(shareLabel)}</span></div>`;
  }

  function renderSignalStrip(snapshot) {
    const unknownCount = countUnknownValues(snapshot);
    const staleCount = countStaleValues(snapshot);
    const control = snapshot.control || {};
    const controlLabel = control.mode === "observe"
      ? "観測中"
      : control.mode === "armed"
        ? "制御待機"
        : control.mode === "blocked" || control.blocked
          ? "重い追加処理のみ制限"
          : "不明";
    const controlStatus = control.mode === "blocked" || control.blocked ? "critical" : control.mode ? "ok" : "unknown";
    const snapshotLabel = snapshot.snapshotState === "stale" ? "前回値（stale）" : snapshot.generatedAt ? "取得済み" : "不明";
    const snapshotNote = snapshot.snapshotState === "stale" ? `前回生成: ${formatDateTime(snapshot.generatedAt)}` : formatDateTime(snapshot.generatedAt);
    return `
      <div class="signal-strip" aria-label="要約">
        <article class="signal-card signal-card--focus"><span class="signal-label">未確認のソース</span><span class="signal-value">${escapeHtml(formatInteger(unknownCount))}<small>件</small></span><span class="signal-note">必須5ソースのunknownのみ</span></article>
        <article class="signal-card"><span class="signal-label">更新待ちソース</span><span class="signal-value">${escapeHtml(formatInteger(staleCount))}<small>件</small></span><span class="signal-note">必須5ソースのstaleのみ</span></article>
        <article class="signal-card"><span class="signal-label">運用モード</span><span class="signal-value">${statusChip(controlStatus, controlLabel)}</span><span class="signal-note">観測は最短 ${escapeHtml(formatDateTime(control.observeUntil))} まで</span></article>
        <article class="signal-card"><span class="signal-label">スナップショット</span><span class="signal-value">${escapeHtml(snapshotLabel)}</span><span class="signal-note">${escapeHtml(snapshotNote)}</span></article>
      </div>`;
  }

  function renderControlStrip(snapshot) {
    const control = snapshot.control || {};
    const modeLabel = control.mode === "observe" ? "observe / 観測"
      : control.mode === "armed" ? "armed / 制御待機"
        : control.mode === "blocked" ? "blocked / 重い追加処理のみ制限"
          : "不明";
    const status = control.mode === "blocked" || control.blocked ? "critical" : control.mode ? "ok" : "unknown";
    const reasons = Array.isArray(control.reasons) && control.reasons.length ? control.reasons : ["危険域なし／観測継続"];
    const continuationNote = control.mode === null ? "既存回答・練習の状態は不明" : "既存回答・練習は継続";
    return `
      <section class="control-strip" aria-label="運用制御状態">
        <div class="control-block"><span class="control-label">現在の運用モード</span><span class="control-value">${statusChip(status, modeLabel)}</span></div>
        <div class="control-block"><span class="control-label">観測期限（最短）</span><span class="control-value">${escapeHtml(formatDateTime(control.observeUntil))}</span><span class="control-help">時刻だけでは有効化しません</span></div>
        <div class="control-block"><span class="control-label">判断理由</span><ul class="control-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul><span class="control-help">${escapeHtml(continuationNote)}</span></div>
      </section>`;
  }

  function renderAppCapacityTable(snapshot) {
    const metrics = metricMap(snapshot);
    const storage = metrics.get("supabase-storage") || createUnknownMetric(METRIC_DEFINITIONS[0]);
    const database = metrics.get("supabase-database") || createUnknownMetric(METRIC_DEFINITIONS[1]);
    const r2 = metrics.get("r2-storage") || createUnknownMetric(METRIC_DEFINITIONS[2]);
    const rows = APP_DEFINITIONS.map((app) => {
      const storagePart = partFor(storage, app.id);
      const databasePart = partFor(database, app.id);
      const r2Part = partFor(r2, app.id);
      const statuses = [storage, database, r2].map((metric) => metric.status);
      const rowStatus = statuses.includes("stale") ? "stale" : statuses.includes("unknown") || [storagePart, databasePart, r2Part].some((part) => part.bytes === null) ? "unknown" : "ok";
      const observed = [storage.observedAt, database.observedAt, r2.observedAt].filter(Boolean).sort().at(-1) || null;
      return `<tr>
        <td data-label="アプリ / 用途"><span class="cell-title">${escapeHtml(app.label)}</span><span class="cell-sub">${escapeHtml(app.description)}</span></td>
        <td data-label="Storage（物理）">${capacityCell(storage, storagePart)}</td>
        <td data-label="Database（物理）">${capacityCell(database, databasePart)}</td>
        <td data-label="R2（物理）">${capacityCell(r2, r2Part)}</td>
        <td data-label="Supabase DB別残量">下段の<br><a class="source-link" href="#supabase-db-comparison">DB別比較</a></td>
        <td data-label="観測時刻">${escapeHtml(formatDateTime(observed))}</td>
        <td data-label="状態">${tableStatus(rowStatus)}</td>
      </tr>`;
    }).join("");
    return `
      <section class="panel app-table-card" id="app-capacity">
        <div class="section-head"><div><p class="section-kicker">APP BREAKDOWN</p><h2>アプリ別の物理使用量</h2><p>各サービスの保存先ごとの内訳。未取得は明示的に「不明」と表示します。</p></div><div class="section-head-aside">6用途 / 3保存先</div></div>
        <div class="table-wrap"><table class="data-table" data-testid="app-capacity-table"><thead><tr><th>アプリ / 用途</th><th>Storage（物理）</th><th>Database（物理）</th><th>R2（物理）</th><th>Supabase DB別残量</th><th>観測時刻</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="app-table-note">各容量は bytes・件数・その保存先の使用量内割合を表示します。Database合算は構成比の確認専用で、DB別残量は下の比較表でのみ判定します。</p>
      </section>`;
  }

  function renderSourcesAndEvents(snapshot) {
    const sources = snapshot.sources || [];
    const events = (snapshot.events || []).slice().sort((left, right) => String(right.at || "").localeCompare(String(left.at || ""))).slice(0, 8);
    const sourceRows = sources.length ? sources.map((source) => `
      <div class="source-row">
        <div class="source-main"><span class="source-name">${escapeHtml(source.label)}</span><span class="source-meta"><span>確認: ${escapeHtml(formatDateTime(source.checkedAt))}</span><span>最終成功: ${escapeHtml(formatDateTime(source.lastSuccessAt))}</span><span>失敗: ${escapeHtml(formatInteger(source.failures))}回</span></span></div>
        ${statusChip(source.status)}
        ${source.error ? `<div class="source-error">エラー概要: ${escapeHtml(source.error)}</div>` : ""}
      </div>`).join("") : `<p class="empty-row">ソース状態は不明です。</p>`;
    const eventRows = events.length ? events.map((event) => `
      <div class="event-row"><span class="level-chip level-chip--${escapeAttribute(event.level)}">${escapeHtml(EVENT_LEVEL_LABELS[event.level] || "通知")}</span><div><p class="event-message">${escapeHtml(event.message)}</p><div class="event-meta"><span>${escapeHtml(formatDateTime(event.at))}</span><span class="delivery-chip">${escapeHtml(DELIVERY_LABELS[event.delivery] || "不明")}</span></div></div></div>`).join("") : `<p class="empty-row">新しいイベントはありません。</p>`;
    return `
      <div class="two-column">
        <section class="panel" id="sources"><div class="section-head"><div><p class="section-kicker">OBSERVATION SOURCES</p><h2>観測ソース</h2><p>確認時刻と最終成功時刻を分けて表示します。</p></div><div class="section-head-aside">${escapeHtml(formatInteger(sources.filter((source) => source.status === "unknown").length))}件が不明</div></div><div class="source-list">${sourceRows}</div></section>
        <section class="panel" id="alerts"><div class="section-head"><div><p class="section-kicker">ALERTS</p><h2>通知・アラート</h2><p>個別ユーザーや生のAPI応答は表示しません。</p></div><div class="section-head-aside">直近8件</div></div><div class="event-list">${eventRows}</div></section>
      </div>`;
  }

  function trafficValue(metric, value) {
    return valueMarkup(value, metric.unit === "requests" ? formatCount : formatBytes);
  }

  function renderTrafficMetrics(snapshot, options = {}) {
    const rows = (snapshot.metrics || []).filter((metric) => metric.kind === "requests" || metric.kind === "egress");
    const body = rows.map((metric) => {
      const rate = metricPercent(metric);
      const label = metric.kind === "requests" ? "総リクエスト数" : "期間内合計";
      return `<tr><td><span class="cell-title">${escapeHtml(metric.label)}</span><span class="cell-sub">${escapeHtml(label)} / ${escapeHtml(metric.provider)}</span></td><td>${trafficValue(metric, metric.used)}</td><td>${metric.limit === null ? `<span class="value-unknown">上限不明</span>` : trafficValue(metric, metric.limit)}</td><td>${rate === null ? `<span class="value-unknown">不明</span>` : `${escapeHtml(formatNumber(rate))}%`}</td><td>${escapeHtml(formatDateTime(metric.observedAt))}</td><td>${sourceMarkup(metric.source, { disabled: options.exportMode === true })}</td><td>${tableStatus(metric.status)}</td></tr>`;
    }).join("");
    const bodyMarkup = rows.length ? body : `<tr><td class="empty-row" colspan="7">通信指標はsnapshot未取得です。</td></tr>`;
    return `
      <section class="panel traffic-panel" id="traffic-metrics">
        <div class="section-head"><div><p class="section-kicker">TRAFFIC / EGRESS</p><h2>通信・エグレス</h2><p>保存量とは別に、個別指標の総量・上限・率・観測日・sourceを確認します。</p></div><div class="section-head-aside">保存量と別管理</div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>指標</th><th>総量</th><th>上限</th><th>使用率</th><th>観測日</th><th>source</th><th>状態</th></tr></thead><tbody>${bodyMarkup}</tbody></table></div>
        <p class="app-table-note">期間平均の自動取得はありません。通信量は保存量のドーナツ・物理閾値判定・30日物理推移に混ぜません。</p>
      </section>`;
  }

  function trendRows(history) {
    return (history.daily || [])
      .filter((row) => row.at)
      .slice()
      .sort((left, right) => left.at.localeCompare(right.at))
      .slice(-MAX_TREND_POINTS);
  }

  function pathForSeries(rows, key, xFor, yFor) {
    const segments = [];
    let current = [];
    rows.forEach((row, index) => {
      if (row[key] === null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push(`${current.length ? "L" : "M"}${xFor(index).toFixed(2)},${yFor(row[key]).toFixed(2)}`);
    });
    if (current.length) segments.push(current);
    return segments.map((segment) => segment.join(" ")).join(" ");
  }

  function renderTrendSvg(rows) {
    const series = [
      { key: "storageBytes", label: "Supabase Storage", color: "#137d78" },
      { key: "databaseBytes", label: "Database", color: "#315e78" },
      { key: "r2Bytes", label: "Cloudflare R2", color: "#b48326" },
    ];
    const values = rows.flatMap((row) => series.map((item) => row[item.key])).filter((value) => value !== null);
    if (!values.length) return `<div class="trend-empty">30日分の物理スナップショットは不明です。</div>`;
    const width = 780;
    const height = 250;
    const padLeft = 54;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 38;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const spread = high - low || Math.max(high, 1);
    const min = Math.max(0, low - spread * 0.12);
    const max = high + spread * 0.12 || 1;
    const xFor = (index) => rows.length <= 1 ? (width + padLeft - padRight) / 2 : padLeft + (index / (rows.length - 1)) * (width - padLeft - padRight);
    const yFor = (value) => padTop + ((max - value) / (max - min || 1)) * (height - padTop - padBottom);
    const grid = [0, 1, 2, 3].map((index) => {
      const y = padTop + (index / 3) * (height - padTop - padBottom);
      const value = max - (index / 3) * (max - min);
      return `<line x1="${padLeft}" x2="${width - padRight}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#e1e9e5" stroke-width="1"/><text x="${padLeft - 9}" y="${(y + 4).toFixed(2)}" fill="#687985" font-size="11" text-anchor="end">${escapeHtml(formatBytes(value))}</text>`;
    }).join("");
    const lineMarkup = series.map((item) => {
      const path = pathForSeries(rows, item.key, xFor, yFor);
      return path ? `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    }).join("");
    const dots = series.flatMap((item) => rows.map((row, index) => row[item.key] === null ? "" : `<circle cx="${xFor(index).toFixed(2)}" cy="${yFor(row[item.key]).toFixed(2)}" r="3.2" fill="${item.color}"><title>${escapeHtml(`${item.label} ${formatDateOnly(row.at)} ${formatBytes(row[item.key])}`)}</title></circle>`)).join("");
    const xLabels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((value, index, list) => value >= 0 && list.indexOf(value) === index).map((index) => `<text x="${xFor(index).toFixed(2)}" y="${height - 12}" fill="#687985" font-size="11" text-anchor="${index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}">${escapeHtml(formatDateOnly(rows[index].at))}</text>`).join("");
    const legend = series.map((item) => `<span class="legend"><span class="legend-dot" style="--dot-color:${item.color}"></span>${escapeHtml(item.label)}</span>`).join("");
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="保存済み物理使用量の30日推移"><title>保存済み物理使用量の30日推移</title><desc>未取得の日は線をつながず、不明をゼロとして補間しません。</desc>${grid}${lineMarkup}${dots}${xLabels}</svg><div class="legend" aria-hidden="true">${legend}</div>`;
  }

  function renderTrendTable(rows) {
    const visibleRows = rows.slice(-6).reverse();
    if (!visibleRows.length) return "";
    return `<div class="trend-table"><table class="data-table"><thead><tr><th>日付</th><th>Storage（物理）</th><th>Database（物理）</th><th>R2（物理）</th></tr></thead><tbody>${visibleRows.map((row) => `<tr><td>${escapeHtml(formatDateOnly(row.at))}</td><td>${valueMarkup(row.storageBytes)}</td><td>${valueMarkup(row.databaseBytes)}</td><td>${valueMarkup(row.r2Bytes)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderTrend(history) {
    const rows = trendRows(history);
    return `
      <section class="panel trend-panel" id="trend-30day">
        <div class="section-head"><div><p class="section-kicker">30-DAY TREND</p><h2>30日推移</h2><p>保存済みスナップショットによる物理使用量の推移。</p></div><div class="section-head-aside">${escapeHtml(formatInteger(rows.length))}観測点</div></div>
        <div class="trend-frame">${renderTrendSvg(rows)}</div>
        ${renderTrendTable(rows)}
        <p class="trend-caption"><strong>区別：</strong>このグラフは物理使用量だけを扱います。期間平均の自動取得はなく、確認済みの期間平均とエグレス通信量は別管理し、容量のグラフに混ぜません。</p>
      </section>`;
  }

  function detailRows(snapshot) {
    const rows = [];
    (snapshot.metrics || []).forEach((metric) => {
      if (metric.kind === "requests" || metric.kind === "egress") return;
      if (metric.details && metric.details.some((detail) => detail.bytes !== null || detail.count !== null)) {
        metric.details.forEach((detail) => rows.push({ metric, label: detail.label, bytes: detail.bytes, count: detail.count }));
        return;
      }
      const knownParts = (metric.parts || []).filter((part) => part.bytes !== null || part.count !== null);
      const unknownParts = (metric.parts || []).filter((part) => part.bytes === null && part.count === null);
      knownParts.forEach((part) => rows.push({ metric, label: part.label, bytes: part.bytes, count: part.count }));
      if (unknownParts.length && knownParts.length) rows.push({ metric, label: "未取得の内訳", bytes: null, count: null });
      if (!knownParts.length && metric.used !== null) rows.push({ metric, label: "全体", bytes: metric.used, count: null });
    });
    return rows;
  }

  function renderDetails(snapshot, options = {}) {
    const rows = detailRows(snapshot);
    const body = rows.length ? rows.map((row) => `<tr><td><span class="cell-title">${escapeHtml(row.metric.label)}</span><span class="cell-sub">${escapeHtml(row.metric.kind === "egress" ? "期間内手動確認" : row.metric.kind === "requests" ? "件数" : "物理使用量")} / ${escapeHtml(row.metric.provider)}</span></td><td>${escapeHtml(row.label)}</td><td>${valueMarkup(row.bytes)}</td><td>${valueMarkup(row.count, formatCount)}</td><td>${escapeHtml(formatDateTime(row.metric.observedAt))}</td><td>${sourceMarkup(row.metric.source, { disabled: options.exportMode === true })}</td><td>${tableStatus(row.metric.status)}</td></tr>`).join("") : `<tr><td class="empty-row" colspan="7">内訳は不明です。</td></tr>`;
    return `
      <section class="panel details-table" id="details">
        <div class="section-head"><div><p class="section-kicker">STORAGE DRILLDOWN</p><h2>保存量ドリルダウン</h2><p>保存量の details と app parts を、観測時刻・ソース付きで確認します。通信量は上の別表です。</p></div><div class="section-head-aside">不明は空欄にしない</div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>指標</th><th>内訳</th><th>観測量</th><th>件数</th><th>観測時刻</th><th>ソース</th><th>状態</th></tr></thead><tbody>${body}</tbody></table></div>
      </section>`;
  }

  function renderSupabaseDbComparison(snapshot, options = {}) {
    const metrics = metricMap(snapshot);
    const projectIds = ["database-minkiru", "database-ranking"];
    const rows = projectIds.map((id) => {
      const metric = metrics.get(id) || createUnknownMetric(METRIC_DEFINITIONS.find((definition) => definition.id === id));
      const remaining = metricRemaining(metric);
      return `<tr><td><span class="cell-title">${escapeHtml(metric.label)}</span><span class="cell-sub">${escapeHtml(metric.provider)}</span></td><td>${valueMarkup(metric.used)}</td><td>${metric.limit === null ? `<span class="value-unknown">上限不明</span>` : escapeHtml(formatBytes(metric.limit))}</td><td>${valueMarkup(remaining)}</td><td>${escapeHtml(formatDateTime(metric.observedAt))}</td><td>${sourceMarkup(metric.source, { disabled: options.exportMode === true })}</td><td>${tableStatus(metric.status)}</td></tr>`;
    }).join("");
    return `
      <section class="panel" id="supabase-db-comparison">
        <div class="section-head"><div><p class="section-kicker">SUPABASE DB COMPARISON</p><h2>Supabase DB別比較</h2><p>現行のSupabase PostgreSQLをDB別に、上限・現在値・残量・sourceで確認します。</p></div><div class="section-head-aside">API上限（提供時のみ）</div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>DB</th><th>現在の物理量</th><th>API上限</th><th>残量</th><th>観測時刻</th><th>source</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="note-box"><strong>読み方：</strong>Database合算ドーナツは構成比だけを示し、プールされた空き容量は表示しません。残量はDB別にAPIから提供された上限がある場合だけ計算します。</div>
      </section>`;
  }

  const D1_LIMITS_URL = "https://developers.cloudflare.com/d1/platform/limits/";
  const D1_PRICING_URL = "https://developers.cloudflare.com/d1/platform/pricing/";

  function renderFuturePlan(exportMode = false) {
    const officialLink = (url, label) => exportMode
      ? `<span class="future-link future-link--disabled">${escapeHtml(label)}（静的コピーではリンク無効）</span>`
      : `<a class="source-link" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    return `
      <section class="panel" id="future-plan">
        <div class="section-head"><div><p class="section-kicker">FUTURE OPTIONS</p><h2>将来案の比較</h2><p>現行構成の容量・残量判定とは別枠の検討メモです。</p></div><span class="readonly-label">計画のみ</span></div>
        <div class="future-grid">
          <article class="future-option"><h3>現行改善</h3><p>Supabase PostgreSQLの観測・分類・履歴保持を改善する案。</p></article>
          <article class="future-option"><h3>問題本文R2</h3><p>問題本文の保存先をR2へ寄せ、DBの役割を整理する案。</p></article>
          <article class="future-option"><h3>D1部分移行</h3><p>対象を限定して移行可否を検討する案。現行では未使用です。</p></article>
        </div>
        <div class="note-box"><strong>D1の扱い：</strong>ここは将来案の参考情報だけです。現行のSupabase DB別残量・保存量・物理閾値判定には含めません。公式仕様の制限・料金は変更され得るため、無料枠を保証しません。${officialLink(D1_LIMITS_URL, "公式の制限")}${exportMode ? " / " : " ・ "}${officialLink(D1_PRICING_URL, "公式の料金・無料枠")}</div>
      </section>`;
  }

  function growthEstimate(growth, additionalQuestions) {
    const requested = finiteCount(additionalQuestions) ?? 1_000;
    const baseCount = growth.questionCount;
    const questionPerQuestion = baseCount !== null && baseCount > 0 && growth.questionBytes !== null
      ? growth.questionBytes / baseCount
      : null;
    const imagePerQuestion = baseCount !== null && baseCount > 0 && growth.imageBytes !== null
      ? growth.imageBytes / baseCount
      : null;
    return {
      additionalQuestions: requested,
      questionBytes: questionPerQuestion === null ? null : questionPerQuestion * requested,
      imageBytes: imagePerQuestion === null ? null : imagePerQuestion * requested,
    };
  }

  function renderGrowthEstimate(growth, additionalQuestions) {
    const estimate = growthEstimate(growth, additionalQuestions);
    return `<div class="projection-summary"><span>追加問題数</span><strong>${escapeHtml(formatInteger(estimate.additionalQuestions))}件</strong><span class="cell-sub">基準件数からの1件あたり平均で試算</span></div><div class="projection-grid"><div><span>質問の追加量</span>${valueMarkup(estimate.questionBytes)}</div><div><span>画像の追加量</span>${valueMarkup(estimate.imageBytes)}</div></div>`;
  }

  function renderGrowth(snapshot, state = {}, exportMode = false) {
    const growth = snapshot.growth || {};
    const additionalQuestions = finiteCount(state.growthEstimateQuestions) ?? 1_000;
    const inputMarkup = exportMode
      ? `<span class="growth-input-static">追加問題数 ${escapeHtml(formatInteger(additionalQuestions))}件（エクスポート時点）</span>`
      : `<label class="growth-input-label" for="growth-additional-questions">追加問題数（ローカル試算）<input class="ops-input" id="growth-additional-questions" data-growth-input type="number" min="0" step="1" inputmode="numeric" value="${escapeAttribute(additionalQuestions)}"></label>`;
    return `
      <section class="panel" id="growthestimate">
        <div class="section-head"><div><p class="section-kicker">GROWTH ESTIMATE</p><h2>増加見込み（推計）</h2><p>質問・画像の増加を、現在の入力値から別枠で確認します。</p></div><span class="status-chip status-chip--manual">推計</span></div>
        <div class="growth-grid"><dl class="growth-item"><dt>質問件数</dt><dd>${growth.questionCount === null ? "不明" : escapeHtml(formatInteger(growth.questionCount))}</dd><small>件 / 基準値</small></dl><dl class="growth-item"><dt>質問データ量</dt><dd>${valueMarkup(growth.questionBytes)}</dd><small>保存済み物理量</small></dl><dl class="growth-item"><dt>画像データ量</dt><dd>${valueMarkup(growth.imageBytes)}</dd><small>保存済み物理量</small></dl></div>
        <div class="growth-projection"><div class="projection-head"><div><h3>追加量の試算</h3><p>基準値から、指定した追加問題数ぶんを比例計算します。</p></div>${inputMarkup}</div><div data-growth-output>${renderGrowthEstimate(growth, additionalQuestions)}</div></div>
        <div class="note-box"><strong>推計の扱い：</strong>${escapeHtml(growth.note || "増加推計は未取得です。")} 現在の物理使用量、期間平均、手動確認済みエグレスとは混同しません。${exportMode ? "このHTMLは保存時点の試算結果です。" : "追加問題数は端末内だけで試算し、保存しません。"}</div>
      </section>`;
  }

  function renderCandidates(snapshot) {
    const candidates = snapshot.candidates || [];
    const rows = candidates.length ? candidates.map((candidate) => `<tr><td><span class="cell-title">${escapeHtml(candidate.label)}</span><span class="cell-sub">${escapeHtml(candidate.advice || "")}</span></td><td>${valueMarkup(candidate.bytes)}</td><td>${valueMarkup(candidate.count, formatCount)}</td><td>${escapeHtml(candidate.status)}</td></tr>`).join("") : `<tr><td class="empty-row" colspan="4">候補データは不明です。</td></tr>`;
    return `
      <section class="panel" id="candidates">
        <div class="section-head"><div><p class="section-kicker">CANDIDATES</p><h2>整理候補</h2><p>容量の確認材料として表示するだけの候補一覧です。</p></div><span class="readonly-label">参照のみ</span></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>候補</th><th>物理量</th><th>件数</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="app-table-note">この画面には削除ボタンも削除APIもありません。実データの変更は別の承認済み運用で行います。</p>
      </section>`;
  }

  function renderOwnerActions(exportMode, state) {
    if (exportMode) {
      return `<section class="panel owner-panel" id="owner-actions"><div class="section-head"><div><p class="section-kicker">OWNER ACTIONS</p><h2>オーナー入力</h2></div><span class="export-badge">静的エクスポート</span></div><div class="export-note">このHTMLは現在のスナップショットを読むための静的コピーです。API取得、エグレス保存、再開判定のフォームは含まれていません。</div></section>`;
    }
    const writeStatus = state && state.writeStatus ? state.writeStatus : { kind: "", text: "" };
    const statusMarkup = writeStatus.text ? `<p id="write-status" class="write-status write-status--${escapeAttribute(writeStatus.kind)}" role="status" aria-live="polite">${escapeHtml(writeStatus.text)}</p>` : `<p id="write-status" class="write-status" role="status" aria-live="polite"></p>`;
    return `
      <section class="panel owner-panel" id="owner-actions">
        <div class="section-head"><div><p class="section-kicker">OWNER ACTIONS</p><h2>オーナー確認値と再開判定</h2><p>書き込みは明示的な送信時だけ。収集処理はこの画面から呼び出しません。</p></div><span class="status-chip status-chip--manual">オーナー限定</span></div>
        <p class="owner-lead">エグレスはリクエストから推計せず、期間・確認日時と組織合計を手動で記録します。容量グラフとは別の記録です。</p>
        <div class="write-grid" data-ops-write>
          <form id="egress-form" class="ops-form" data-ops-form="egress" novalidate>
            <h3>期間内エグレスを記録</h3><p class="form-intro">契約どおり uncachedBytes / cachedBytes の両方を入力してください。Storage期間平均は任意です。</p>
            <div class="form-fields">
              <div class="form-field"><label for="period-start">期間開始</label><input class="ops-input" id="period-start" name="periodStart" type="date" required></div>
              <div class="form-field"><label for="period-end">期間終了</label><input class="ops-input" id="period-end" name="periodEnd" type="date" required></div>
              <div class="form-field form-field--wide"><label for="confirmed-at">確認日時</label><input class="ops-input" id="confirmed-at" name="confirmedAt" type="datetime-local" required></div>
              <div class="form-field"><label for="uncached-bytes">非キャッシュ量（bytes）</label><input class="ops-input" id="uncached-bytes" name="uncachedBytes" type="number" min="0" step="1" inputmode="numeric" required></div>
              <div class="form-field"><label for="cached-bytes">キャッシュ量（bytes）</label><input class="ops-input" id="cached-bytes" name="cachedBytes" type="number" min="0" step="1" inputmode="numeric" required></div>
              <div class="form-field form-field--wide"><label for="storage-average-bytes">Storage期間平均（bytes・任意）</label><input class="ops-input" id="storage-average-bytes" name="storageAverageBytes" type="number" min="0" step="1" inputmode="numeric"><span class="form-help">未入力なら送信payloadに含めません。</span></div>
            </div>
            <div class="form-actions"><button class="ops-button" type="submit">確認値を保存</button><p class="form-help">POST /api/egress</p></div>
          </form>
          <form id="resume-form" class="ops-form" data-ops-form="resume" novalidate>
            <h3>制御の再開判定</h3><p class="form-intro">最新のソース状態・容量・観測完了条件をWorker側で確認します。</p>
            <label class="confirm-line"><input name="confirm" type="checkbox" value="true" required><span>条件を確認し、再開判定を依頼します。</span></label>
            <div class="form-actions"><button class="ops-button ops-button--quiet" type="submit">再開判定を依頼</button><p class="form-help">POST /api/resume</p></div>
          </form>
        </div>
        ${statusMarkup}
      </section>`;
  }

  function renderDashboardMarkup(snapshotValue, historyValue, options = {}) {
    const snapshot = normalizeLatest(snapshotValue);
    const history = normalizeHistory(historyValue);
    const exportMode = options.exportMode === true;
    const metrics = metricMap(snapshot);
    const state = options.state || { loading: false, message: "", growthEstimateQuestions: 1_000, writeStatus: { kind: "", text: "" } };
    const connectionMessage = state.loading
      ? "最新スナップショットを確認中…"
      : state.message || (snapshot.generatedAt ? "保存済みスナップショットを表示中" : "値は不明として表示中");
    return `
      <div class="ops-shell${exportMode ? " ops-shell--export" : ""}">
        <header class="ops-header">
          <div><p class="eyebrow">ENSUKU OPS / OWNER VIEW</p><h1>アプリ別・容量管理</h1><p>保存容量・通信量・警告を確認する本人専用ページです。取得できない項目は「不明」と表示します。</p></div>
          <div class="header-side"><div class="snapshot-meta"><strong>${escapeHtml(connectionMessage)}</strong><span>生成: ${escapeHtml(formatDateTime(snapshot.generatedAt))}</span></div>${exportMode ? `<span class="export-badge">現在値の静的エクスポート</span>` : `<div class="header-actions"><button class="ops-button ops-button--quiet" type="button" data-action="refresh">最新を再読込</button><button class="ops-button" type="button" data-action="export">HTMLで保存</button></div>`}</div>
        </header>
        <main class="ops-main">
          ${renderSignalStrip(snapshot)}
          ${renderControlStrip(snapshot)}
          <section class="resource-section" id="resources"><div class="section-head"><div><p class="section-kicker">CAPACITY OVERVIEW</p><h2>保存先の現在値</h2><p>容量ポリシーの異なる3つの保存先を、別々のドーナツで確認します。</p></div><div class="section-head-aside">物理値 / 現在値</div></div><div class="resource-grid">${renderResourceCard(metrics.get("supabase-storage") || createUnknownMetric(METRIC_DEFINITIONS[0]), "teal", snapshot.billing)}${renderResourceCard(metrics.get("supabase-database") || createUnknownMetric(METRIC_DEFINITIONS[1]), "navy")}${renderResourceCard(metrics.get("r2-storage") || createUnknownMetric(METRIC_DEFINITIONS[2]), "gold")}</div></section>
          ${renderAppCapacityTable(snapshot)}
          ${renderSourcesAndEvents(snapshot)}
          ${renderTrafficMetrics(snapshot, { exportMode })}
          ${renderTrend(history)}
          ${renderDetails(snapshot, { exportMode })}
          ${renderSupabaseDbComparison(snapshot, { exportMode })}
          ${renderFuturePlan(exportMode)}
          ${renderGrowth(snapshot, state, exportMode)}
          ${renderCandidates(snapshot)}
          ${renderOwnerActions(exportMode, state)}
        </main>
        <footer class="ops-footer"><span><strong>Ensuku Ops v1</strong> / aggregate metadata only</span><span>観測値は保存済みスナップショットに基づきます。</span></footer>
      </div>`;
  }

  function mount(root, snapshotValue, historyValue, options = {}) {
    if (!root || typeof root !== "object") return root;
    root.innerHTML = renderDashboardMarkup(snapshotValue, historyValue, options);
    return root;
  }

  function safeJson(value) {
    return JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  const EXPORT_RUNTIME_SOURCE = String.raw`(function(){
    document.documentElement.classList.add("ops-export");
    document.querySelectorAll("[data-action], [data-ops-write], form, button").forEach(function(node){
      if (node.matches("[data-ops-write]")) node.setAttribute("aria-label", "エクスポートでは無効");
      if (node.matches("button")) node.disabled = true;
    });
  })();`;

  function createExportHtml(snapshotValue, historyValue) {
    const snapshot = normalizeLatest(snapshotValue);
    const history = normalizeHistory(historyValue);
    const snapshotJson = safeJson(snapshot);
    const historyJson = safeJson(history);
    const markup = renderDashboardMarkup(snapshot, history, { exportMode: true, state: { loading: false, message: "エクスポート時点の保存済みスナップショット", writeStatus: { kind: "", text: "" } } });
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Ensuku Opsの保存済み容量スナップショット"><meta name="ops-export" content="true"><link rel="icon" href="data:,"><title>Ensuku Ops / 保存済みスナップショット</title><style>${EXPORT_CSS}</style></head><body class="ops-export"><script>window.__OPS_EXPORT__=true;window.__OPS_SNAPSHOT__=${snapshotJson};window.__OPS_HISTORY__=${historyJson};</script>${markup}<script>${EXPORT_RUNTIME_SOURCE}</script></body></html>`;
  }

  async function fetchJson(path) {
    if (!host || typeof host.fetch !== "function") throw new Error("fetch unavailable");
    const response = await host.fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response || !response.ok) throw new Error("snapshot request failed");
    return response.json();
  }

  async function postJson(path, payload) {
    if (!host || typeof host.fetch !== "function") throw new Error("fetch unavailable");
    const response = await host.fetch(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }
    if (!response || !response.ok) throw new Error(safeString(body && body.error, "保存できませんでした。"));
    return body;
  }

  function numberFromInput(input) {
    const value = input && typeof input.value === "string" ? input.value.trim() : "";
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function localInputToIso(input) {
    const value = input && typeof input.value === "string" ? input.value.trim() : "";
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function setWriteStatus(state, kind, text, render) {
    state.writeStatus = { kind, text };
    render();
  }

  function boot(documentRef = host && host.document) {
    if (!documentRef) return null;
    const root = documentRef.getElementById("dashboard-root");
    if (!root) return null;
    const exportMode = host.__OPS_EXPORT__ === true;
    const state = {
      snapshot: exportMode ? normalizeLatest(host.__OPS_SNAPSHOT__) : createUnknownSnapshot(),
      history: exportMode ? normalizeHistory(host.__OPS_HISTORY__) : normalizeHistory(null),
      loading: !exportMode,
      message: exportMode ? "エクスポート時点の保存済みスナップショット" : "初回スナップショットを取得しています…",
      writeStatus: { kind: "", text: "" },
      growthEstimateQuestions: 1_000,
      timer: null,
      historyLoadedAt: null,
      disposed: false,
    };

    function render() {
      // Preserve unsent input across manual refresh, validation and transport errors.
      const drafts = [...root.querySelectorAll?.("[data-ops-form] input") || []].map((input) => ({
        id: input.id, value: input.value, checked: input.checked, type: input.type,
      }));
      root.innerHTML = renderDashboardMarkup(state.snapshot, state.history, { exportMode, state });
      for (const draft of drafts) {
        const input = draft.id && documentRef.getElementById?.(draft.id);
        if (input) {
          input.value = draft.value;
          if (draft.type === "checkbox") input.checked = draft.checked;
        }
      }
      bindControls();
    }

    function setRefreshTimer() {
      if (state.timer && typeof host.clearTimeout === "function") host.clearTimeout(state.timer);
      state.timer = null;
      if (exportMode || documentRef.visibilityState !== "visible" || typeof host.setTimeout !== "function") return;
      state.timer = host.setTimeout(async () => {
        state.timer = null;
        await loadData(true, { includeHistory: historyIsDue(), auto: true });
      }, REFRESH_INTERVAL_MS);
    }

    function historyIsDue() {
      return state.historyLoadedAt === null || Date.now() - state.historyLoadedAt >= HISTORY_REFRESH_INTERVAL_MS;
    }

    function fieldHasPendingValue(form, name) {
      const field = form && form.elements ? form.elements[name] : null;
      if (!field) return false;
      if (field.type === "checkbox") return field.checked === true;
      return typeof field.value === "string" && field.value.trim() !== "";
    }

    function hasPendingOwnerInput() {
      const egressForm = root.querySelector("[data-ops-form=egress]");
      const resumeForm = root.querySelector("[data-ops-form=resume]");
      return ["periodStart", "periodEnd", "confirmedAt", "uncachedBytes", "cachedBytes", "storageAverageBytes"].some((name) => fieldHasPendingValue(egressForm, name))
        || fieldHasPendingValue(resumeForm, "confirm");
    }

    async function loadData(silent = false, options = {}) {
      if (exportMode || state.disposed) return;
      const includeHistory = options.includeHistory === true;
      if (silent && options.auto === true && hasPendingOwnerInput()) {
        state.loading = false;
        state.message = "未送信のオーナー入力があるため、自動更新を見送りました。";
        setRefreshTimer();
        return;
      }
      state.loading = !silent;
      if (!silent) {
        state.message = "最新スナップショットを確認しています…";
        render();
      }
      const requests = [fetchJson(SNAPSHOT_ENDPOINT)];
      if (includeHistory) requests.push(fetchJson(HISTORY_ENDPOINT));
      const results = await Promise.allSettled(requests);
      const latestResult = results[0];
      const historyResult = includeHistory ? results[1] : null;
      state.snapshot = latestResult.status === "fulfilled" ? normalizeLatest(latestResult.value) : markSnapshotStale(state.snapshot);
      if (historyResult) {
        state.historyLoadedAt = Date.now();
        if (historyResult.status === "fulfilled") state.history = normalizeHistory(historyResult.value);
      }
      state.loading = false;
      if (latestResult.status !== "fulfilled" && (!historyResult || historyResult.status !== "fulfilled")) {
        state.message = state.snapshot.generatedAt
          ? "最新値の取得に失敗。前回スナップショットをstale表示しています。"
          : "取得できないため、値は不明として表示しています。";
      } else if (latestResult.status !== "fulfilled") {
        state.message = state.snapshot.generatedAt
          ? "最新値を取得できないため、前回スナップショットをstale表示しています。"
          : "最新値を取得できないため、不明として表示しています。";
      } else if (historyResult && historyResult.status !== "fulfilled") {
        state.message = "最新値は表示中ですが、30日推移は不明です。";
      } else {
        state.message = "保存済みスナップショットを表示中";
      }
      render();
      setRefreshTimer();
    }

    function downloadExport() {
      if (exportMode || !host.Blob || !host.URL || typeof host.URL.createObjectURL !== "function") return;
      const blob = new host.Blob([createExportHtml(state.snapshot, state.history)], { type: "text/html;charset=utf-8" });
      const url = host.URL.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = `ensuku-ops-${state.snapshot.generatedAt ? state.snapshot.generatedAt.slice(0, 10) : "snapshot"}.html`;
      anchor.click();
      if (typeof host.setTimeout === "function") host.setTimeout(() => host.URL.revokeObjectURL(url), 0);
    }

    function bindControls() {
      if (exportMode) return;
      const refreshButton = root.querySelector("[data-action=refresh]");
      const exportButton = root.querySelector("[data-action=export]");
      if (refreshButton) refreshButton.addEventListener("click", () => loadData(false));
      if (exportButton) exportButton.addEventListener("click", downloadExport);
      const growthInput = root.querySelector("[data-growth-input]");
      if (growthInput) growthInput.addEventListener("input", () => {
        const next = numberFromInput(growthInput);
        state.growthEstimateQuestions = next === null ? 0 : Math.floor(next);
        const output = root.querySelector("[data-growth-output]");
        if (output) output.innerHTML = renderGrowthEstimate(state.snapshot.growth, state.growthEstimateQuestions);
      });
      const egressForm = root.querySelector("[data-ops-form=egress]");
      if (egressForm) egressForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const periodStart = egressForm.elements.periodStart && egressForm.elements.periodStart.value.trim();
        const periodEnd = egressForm.elements.periodEnd && egressForm.elements.periodEnd.value.trim();
        const confirmedAt = localInputToIso(egressForm.elements.confirmedAt);
        const uncachedBytes = numberFromInput(egressForm.elements.uncachedBytes);
        const cachedBytes = numberFromInput(egressForm.elements.cachedBytes);
        const storageAverageInput = egressForm.elements.storageAverageBytes;
        const storageAverageRaw = storageAverageInput && typeof storageAverageInput.value === "string" ? storageAverageInput.value.trim() : "";
        const storageAverageBytes = numberFromInput(storageAverageInput);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart || "") || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd || "") || !confirmedAt || uncachedBytes === null || cachedBytes === null || (storageAverageRaw !== "" && storageAverageBytes === null)) {
          setWriteStatus(state, "error", "期間・確認日時・2種類のbytesを正しく入力してください。", render);
          return;
        }
        setWriteStatus(state, "", "保存しています…", render);
        try {
          const payload = { periodStart, periodEnd, confirmedAt, uncachedBytes, cachedBytes };
          if (storageAverageRaw !== "") payload.storageAverageBytes = storageAverageBytes;
          await postJson("/api/egress", payload);
          state.writeStatus = { kind: "success", text: "エグレスの手動確認値を保存しました。" };
          await loadData(true);
          render();
        } catch (error) {
          setWriteStatus(state, "error", safeString(error && error.message, "保存できませんでした。"), render);
        }
      });
      const resumeForm = root.querySelector("[data-ops-form=resume]");
      if (resumeForm) resumeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!resumeForm.elements.confirm || !resumeForm.elements.confirm.checked) {
          setWriteStatus(state, "error", "確認チェックを入れてから再開判定を依頼してください。", render);
          return;
        }
        setWriteStatus(state, "", "再開条件を確認しています…", render);
        try {
          await postJson("/api/resume", { confirm: true });
          state.writeStatus = { kind: "success", text: "再開判定を受け付けました。最新状態を再確認しています。" };
          await loadData(true);
          render();
        } catch (error) {
          setWriteStatus(state, "error", safeString(error && error.message, "再開判定を送信できませんでした。"), render);
        }
      });
    }

    render();
    if (exportMode) return state;
    documentRef.addEventListener("visibilitychange", () => {
      if (documentRef.visibilityState === "visible") {
        loadData(true, { includeHistory: historyIsDue(), auto: true });
      } else if (state.timer && typeof host.clearTimeout === "function") {
        host.clearTimeout(state.timer);
        state.timer = null;
      }
      if (documentRef.visibilityState === "visible") setRefreshTimer();
    });
    loadData(false, { includeHistory: true });
    return state;
  }

  const api = {
    REFRESH_INTERVAL_MS,
    HISTORY_REFRESH_INTERVAL_MS,
    SNAPSHOT_ENDPOINT,
    HISTORY_ENDPOINT,
    APP_DEFINITIONS,
    METRIC_DEFINITIONS,
    createUnknownSnapshot,
    normalizeLatest,
    normalizeHistory,
    normalizeBilling,
    markSnapshotStale,
    countUnknownValues,
    countStaleValues,
    renderDashboardMarkup,
    mount,
    createExportHtml,
    redactSensitive,
    boot,
  };

  if (host) host.OpsDashboard = api;
  if (host && host.document) {
    if (host.document.readyState === "loading") {
      host.document.addEventListener("DOMContentLoaded", () => boot(host.document), { once: true });
    } else {
      boot(host.document);
    }
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null);
