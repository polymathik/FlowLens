/**
 * Inline stylesheet + script for the self-contained HTML report.
 * Light/dark aware (prefers-color-scheme), printable (no shadows, prompts
 * expanded, copy buttons hidden), readable at phone width.
 */
export const HTML_STYLE = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1f;--muted:#5f6368;--line:#e3e3e0;--accent:#2457c5;
--critical:#b3261e;--high:#c4511b;--medium:#a06a00;--low:#4a6b8a;--info:#6b6b6b;
--gA:#1e7a3c;--gB:#3d7a1e;--gC:#a06a00;--gD:#c4511b;--gF:#b3261e;--bar:#dfe6f3;--code:#f1f1ee}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececec;--muted:#a3a3a8;--line:#2e2e33;
--accent:#8fb0ff;--critical:#ff8a80;--high:#ffab70;--medium:#f0c060;--low:#9cc0e0;--info:#aaa;
--gA:#6fd28f;--gB:#a6d26f;--gC:#f0c060;--gD:#ffab70;--gF:#ff8a80;--bar:#2b3448;--code:#26262a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 12px}h3{font-size:1.02rem;margin:0}
.muted{color:var(--muted);font-size:.9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 12px}
.hero{display:flex;gap:18px;align-items:center}
.grade{flex:none;width:84px;height:84px;border-radius:14px;display:grid;place-items:center;font-size:2.6rem;font-weight:700;color:#fff}
.gA{background:var(--gA)}.gB{background:var(--gB)}.gC{background:var(--gC)}.gD{background:var(--gD)}.gF{background:var(--gF)}
.score{font-size:1.2rem;font-weight:600}
ol.steps{margin:0;padding-left:1.3rem}ol.steps li{margin:6px 0}
.row{display:grid;grid-template-columns:minmax(120px,190px) 48px 1fr;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0}
.bar{height:8px;border-radius:4px;background:var(--bar);overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
.why{margin:8px 0}
.pill{display:inline-block;font-size:.75rem;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor;margin-right:6px}
.critical{color:var(--critical)}.high{color:var(--high)}.medium{color:var(--medium)}.low{color:var(--low)}.info{color:var(--info)}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.rank{font-weight:700;color:var(--muted)}
ul.ev{margin:6px 0;padding-left:1.1rem;font-size:.92rem}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
code{background:var(--code);padding:1px 4px;border-radius:4px;word-break:break-all}
pre{background:var(--code);padding:12px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word;margin:8px 0 0}
details{margin-top:8px}summary{cursor:pointer;color:var(--accent);font-weight:600}
.actions{display:flex;gap:14px;align-items:center;margin-top:10px;font-size:.92rem}
a{color:var(--accent)}button.copy{font:inherit;font-size:.85rem;padding:3px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
ul.caveats li{margin:4px 0}
footer{margin-top:32px;font-size:.85rem;color:var(--muted)}
@media (max-width:560px){.row{grid-template-columns:1fr 40px}.row .bar{grid-column:1/-1}.hero{align-items:flex-start}}
@media print{body{background:#fff;color:#000;font-size:11pt}.card{border-color:#ccc;break-inside:avoid}
button.copy,.actions a{display:none}summary{color:#000}main{max-width:none;padding:0}}
`;

export const HTML_SCRIPT = `
document.querySelectorAll('button.copy').forEach(function(b){b.addEventListener('click',function(){
var t=document.getElementById(b.getAttribute('data-target'));if(!t||!navigator.clipboard)return;
navigator.clipboard.writeText(t.textContent||'').then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy fix prompt'},1500)});});});
window.addEventListener('beforeprint',function(){document.querySelectorAll('details').forEach(function(d){d.open=true})});
`;
