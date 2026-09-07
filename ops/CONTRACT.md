# Ensuku Ops v1 contract

Owner-only standalone HTML/Worker; no Sites. All public responses contain aggregate metadata only.

GET `/api/latest` returns `{version:1,generatedAt,control,sources,metrics,events,candidates,growth}`.
GET `/api/history` returns `{daily:[{at,storageBytes,databaseBytes,r2Bytes}],recent:[]}`.
POST `/api/egress` accepts `{periodStart:'YYYY-MM-DD',periodEnd:'YYYY-MM-DD',confirmedAt:ISO,uncachedBytes,cachedBytes}`. Both numbers required, finite >=0. This is a manually confirmed organization total, not estimated from requests.
An optional `storageAverageBytes` may be supplied with the same Dashboard confirmation. GETlatest returns `billing:{storageAverageBytes,periodStart,periodEnd,confirmedAt}` or null. This period-average display is separate from physical totals and never added to those charts.
POST `/api/resume` accepts `{confirm:true}`. Success only if all required sources current, every ordinary metric <75%, R2 <7GB, and observation complete. JSON `{ok:true}` or `{error:string}` on non-2xx.

`control`: `{mode:'observe'|'armed'|'blocked',observeUntil:ISO,blocked:boolean,reasons:string[],canResume:boolean}`. Observe does not enforce new controls; existing image 8GB budget remains unchanged.

`sources`: array `{id,label,status:'ok'|'unknown'|'stale',checkedAt:ISO|null,lastSuccessAt:ISO|null,failures:number,error:string|null}`.

`metrics`: array `{id,label,provider,kind:'storage'|'database'|'requests'|'egress',used:number|null,limit:number,unit:'bytes'|'requests',status:'ok'|'unknown'|'stale'|'manual',observedAt:ISO|null,source:string,note:string,parts:[{appId,label,bytes:number,count:number|null}],details:[{label,bytes,count}]}`.
Top donuts IDs `supabase-storage`, `supabase-database`, `r2-storage`. Database combined chart has no pooled quota: limit is null, render used composition only and separately show project metrics (`database-minkiru`, `database-ranking`, each500MB) for remaining quotas. Storage1GB org, R2 10GB provider free allowance with7GBwarn8GBsoft stop; never conflate policies and provider caps.
Apps IDs `minkiru`, `ensuku`, `iishanten`, `isolated`, `zundamon`, `common`. Unknown not zero. Parts include every app; zero confirmed values remain zero; missing remain unknown. Sum parts must match measured total. Common includes DB residual physical overhead and unclassified tables.

`events`: `{at,level:'notice'|'warning'|'critical'|'recovery'|'error',message,delivery:'sent'|'failed'|'not-requested'|'pending'}`; never names or raw API error bodies.
`candidates`: `{label,bytes:number|null,count:number|null,status,advice}`; informational, no deletion button/API.
`growth`: `{questionCount:number|null,questionBytes:number|null,imageBytes:number|null,note}`. Additional question count input local only, mark projection as estimate.

UI: Japanese, accessible 320-1440px, three charts above app table; source status,30day trend, details, alerts, source links, D1 comparison, export self-contained HTML. Initial API unavailable must show unknown, never live hardcoded baseline. Use no external scripts/fonts/CDNs. Export must contain current data/CSS/JS inline and disable network/API write controls. No custom app icon; blank favicon.

Security: Access JWT verified server-side, exact owner email; deny missing config/JWT. HTML and static assets also protected. Write APIs require exact Origin plus JSON and authenticated owner. API response no-store. No file deletion APIs. Collection refresh never called by dashboard requests.

Source IDs are exactly `minkiru`, `ranking`, `r2`, `cloudflare`, `egress`. Request metrics are `workers-requests`, `r2-class-a`, `r2-class-b`; manual transfer metrics are `egress`, `cached-egress`. Do not invent synthetic totals or missing sources. No D1 database is in current use.
