/**
 * Build a self-contained HTML report from <user>-rapid-report.json.
 *   npx tsx scripts/build-rapid-html.ts [username]
 * Emits <user>-rapid-report.html at the repo root. Prose adapts to the data.
 */
import * as fs from "fs";
import * as path from "path";

const USER = (process.argv[2] || "castledoon").toLowerCase();
const DISPLAY: Record<string, string> = { castledoon: "CastleDoon", exstrax: "Exstrax" };
const NAME = DISPLAY[USER] || (USER.charAt(0).toUpperCase() + USER.slice(1));
const dataDir = path.join(process.cwd(), "scripts", "data");
const r = JSON.parse(fs.readFileSync(path.join(dataDir, `${USER}-rapid-report.json`), "utf8"));
type G = {
  date: string; opponent: string; opponentRating: number; playerRating: number;
  color: "white" | "black"; outcome: "win" | "draw" | "loss"; result: string;
  plies: number; opening: string | null; openingAssessment: string | null;
  blunders: number; mistakes: number; excellent: number;
};
const games: G[] = r.games;
const wins = games.filter((g) => g.outcome === "win");
const losses = games.filter((g) => g.outcome === "loss");
const draws = games.filter((g) => g.outcome === "draw");
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const rec = (a: G[]) => ({
  w: a.filter((x) => x.outcome === "win").length,
  l: a.filter((x) => x.outcome === "loss").length,
  d: a.filter((x) => x.outcome === "draw").length,
});
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

// Derived cuts
const higher = games.filter((g) => g.opponentRating > g.playerRating);
const lower = games.filter((g) => g.opponentRating <= g.playerRating);
const longG = games.filter((g) => g.plies > 80);
const shortG = games.filter((g) => g.plies <= 80);
const lossTypes: Record<string, number> = {};
for (const g of losses) lossTypes[g.result] = (lossTypes[g.result] || 0) + 1;
const timeoutMoves = losses.filter((g) => g.result === "timeout").map((g) => Math.round(g.plies / 2)).sort((a, b) => b - a);

const avgOppWin = Math.round(avg(wins.map((g) => g.opponentRating)));
const avgOppLoss = Math.round(avg(losses.map((g) => g.opponentRating)));
const avgMovesWin = Math.round(avg(wins.map((g) => g.plies)) / 2);
const avgMovesLoss = Math.round(avg(losses.map((g) => g.plies)) / 2);
const avgMistakesWin = avg(wins.map((g) => g.mistakes));
const avgMistakesLoss = avg(losses.map((g) => g.mistakes));
const avgCritWin = avg(wins.map((g) => g.blunders));
const avgCritLoss = avg(losses.map((g) => g.blunders));

// ---- Narrative signals (drive adaptive prose) ----
const cs = r.colorSplit as { white: { games: number; wins: number; losses: number; draws: number }; black: { games: number; wins: number; losses: number; draws: number } };
const wr = (c: { games: number; wins: number }) => (c.games ? c.wins / c.games : 0);
const wrW = wr(cs.white), wrB = wr(cs.black);
const recStr = (c: { wins: number; losses: number; draws: number }) => `${c.wins}–${c.losses}${c.draws ? `–${c.draws}` : ""}`;
const weakColor: "white" | "black" | null =
  wrW <= 0.47 && wrB >= 0.55 ? "white" : wrB <= 0.47 && wrW >= 0.55 ? "black" : null;
const betterColor: "white" | "black" = wrB >= wrW ? "black" : "white";
const blunderClimbs = avgCritLoss - avgCritWin >= 0.5; // big errors meaningfully higher in losses
const timeoutCount = lossTypes.timeout || 0;
const clockIsIssue = timeoutCount >= 3;
const checkmateCount = lossTypes.checkmated || 0;
const lossVsHigher = losses.filter((g) => g.opponentRating > g.playerRating).length;
const ratingRising = ratingsEnd() - ratingsStart() >= 15;
function ratingsStart() { return ([...games].reverse())[0].playerRating; }
function ratingsEnd() { const c = [...games].reverse(); return c[c.length - 1].playerRating; }

// Opening families
function family(name: string | null): string {
  if (!name) return "Other";
  if (name.startsWith("Caro Kann")) return "Caro-Kann";
  if (name.includes("London") || name.includes("Queens Pawn")) return "Queen's Pawn / London";
  if (name.startsWith("French")) return "French Defense";
  if (name.startsWith("Scandinavian")) return "Scandinavian";
  if (name.startsWith("Philidor")) return "Philidor";
  if (name.startsWith("Sicilian")) return "Sicilian";
  if (name.startsWith("English")) return "English";
  if (/Bishops|Vienna|Giuoco|Italian/.test(name)) return "Open Games (e4 e5)";
  return "Offbeat / Other";
}
function familyTable(subset: G[]) {
  const m: Record<string, G[]> = {};
  for (const g of subset) (m[family(g.opening)] ??= []).push(g);
  return Object.entries(m)
    .map(([fam, gs]) => ({ fam, n: gs.length, ...rec(gs) }))
    .sort((a, b) => b.n - a.n);
}
const blackFamilies = familyTable(games.filter((g) => g.color === "black"));
const whiteFamilies = familyTable(games.filter((g) => g.color === "white"));

// Opening assessment
const oa = r.openingAssessment as Record<string, number>;
const oaGood = oa.good || 0, oaInacc = oa.inaccurate || 0, oaDub = oa.dubious || 0;

// Blunder phase (critical moments by phase)
const bp = r.blunderPhase as Record<string, number>;
const phaseOrder = [
  { key: "opening", label: "Opening", sub: "moves 1–10" },
  { key: "middlegame", label: "Middlegame", sub: "moves 11–25" },
  { key: "late_middlegame", label: "Late middlegame", sub: "moves 26–40" },
  { key: "endgame", label: "Endgame", sub: "move 41+" },
];
const bpMax = Math.max(...phaseOrder.map((p) => bp[p.key] || 0));

// Rating sparkline (chronological)
const chrono = [...games].reverse();
const ratings = chrono.map((g) => g.playerRating);
const rmin = Math.min(...ratings), rmax = Math.max(...ratings);
const W = 720, H = 150, padX = 8, padY = 18;
const sx = (i: number) => padX + (i / (ratings.length - 1)) * (W - 2 * padX);
const sy = (v: number) => padY + (1 - (v - rmin) / (rmax - rmin || 1)) * (H - 2 * padY);
const linePts = ratings.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
const areaPts = `${padX},${H - padY} ${linePts} ${(W - padX)},${H - padY}`;
// outcome dots colored by result
const dots = chrono.map((g, i) => ({ x: sx(i), y: sy(g.playerRating), o: g.outcome }));

const resultLabel: Record<string, string> = {
  win: "Won", checkmated: "Checkmated", resigned: "Resigned", timeout: "Lost on time",
  agreed: "Draw agreed", insufficient: "Draw — insufficient material",
  stalemate: "Stalemate", repetition: "Draw — repetition",
};

// ---- Build HTML ----
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function recBar(o: { w: number; l: number; d: number }, total: number) {
  const seg = (n: number, cls: string) => n ? `<span class="seg ${cls}" style="flex:${n}"></span>` : "";
  return `<span class="recbar">${seg(o.w, "w")}${seg(o.d, "d")}${seg(o.l, "l")}</span>`;
}

function familyRows(rows: { fam: string; n: number; w: number; l: number; d: number }[]) {
  const maxN = Math.max(...rows.map((x) => x.n), 1);
  return rows.map((row) => `
    <div class="op-row">
      <div class="op-name">${esc(row.fam)}</div>
      <div class="op-track"><div class="op-fill" style="width:${(row.n / maxN) * 100}%"></div><span class="op-n">${row.n}</span></div>
      <div class="op-rec">${recBar(row, row.n)}<span class="op-wld">${row.w}–${row.l}–${row.d}</span></div>
    </div>`).join("");
}

const gameRows = games.map((g, i) => {
  const oc = g.outcome;
  const moves = Math.round(g.plies / 2);
  const diff = g.opponentRating - g.playerRating;
  const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
  return `<tr class="gr ${oc}" style="--i:${i}">
    <td class="t-date">${g.date.slice(5)}</td>
    <td class="t-col"><span class="disc ${g.color}" title="${g.color}"></span></td>
    <td class="t-opp">${esc(g.opponent)}<span class="t-opprat ${diff > 0 ? "up" : "down"}">${g.opponentRating} <em>${diffStr}</em></span></td>
    <td class="t-open">${esc(g.opening || "—")}<span class="t-assess a-${g.openingAssessment}">${g.openingAssessment || ""}</span></td>
    <td class="t-moves">${moves}</td>
    <td class="t-result">${resultLabel[g.result] || g.result}</td>
    <td class="t-out"><span class="chip ${oc}">${oc === "win" ? "W" : oc === "loss" ? "L" : "D"}</span></td>
  </tr>`;
}).join("");

const winRate = pct(wins.length, games.length);

// ---- Adaptive prose (signal-driven) ----
const recLowerO = rec(lower), recHigherO = rec(higher), recLongO = rec(longG);
const ckFam = blackFamilies.find((f) => f.fam === "Caro-Kann");
const londonFam = whiteFamilies.find((f) => f.fam === "Queen's Pawn / London");

const verdictHead = blunderClimbs
  ? `${NAME}'s defeats share a signature — a stronger opponent, a longer game, and, unlike the wins, a handful of <em>real blunders</em>. They beat the field; they stumble against the climb.`
  : `${NAME} doesn't lose because of <em>how often</em> they blunder — they blunder just as much when winning. Games are decided by <em>who they play</em> and <em>how long it lasts</em>.`;

const verdictSmall = `${blunderClimbs
  ? `Big blunders do climb in defeats (${avgCritWin.toFixed(1)} → ${avgCritLoss.toFixed(1)} flagged per game), but the`
  : `Critical errors are nearly identical in wins and losses (${avgCritWin.toFixed(1)} vs ${avgCritLoss.toFixed(1)} flagged per game), so the`} clearest pattern is the matchup: against equal-or-weaker opponents the record is <b>${recLowerO.w}–${recLowerO.l}–${recLowerO.d}</b>, and against higher-rated it ${blunderClimbs ? "falls" : "collapses"} to <b>${recHigherO.w}–${recHigherO.l}–${recHigherO.d}</b>. Longer games (40+ moves) go <b>${recLongO.w}–${recLongO.l}–${recLongO.d}</b>.`;

const contrastLead = `The same player shows up in both columns. The separation isn't tactical sharpness — it's <b>${blunderClimbs ? "matchup, stamina, and big-blunder discipline" : "matchup and stamina"}</b>. Read each row as "what a win looks like" vs "what a loss looks like."`;

const contrastNote = blunderClimbs
  ? `The big-blunder row is the one that moves: <b>${avgCritLoss.toFixed(1)} per loss vs ${avgCritWin.toFixed(1)} per win</b>. The mid-size-mistake row even runs backwards — more of those surface in messy wins than in clean losses — so don't over-read it. The metric that truly tracks defeat is the catastrophic move, and above all <b>the strength of the opponent</b>.`
  : `The two error rows tell the story. Big blunders are <b>flat</b> across wins and losses — but the quieter 1–2 pawn mistakes are <b>${(avgMistakesLoss / (avgMistakesWin || 1)).toFixed(1)}× more frequent in losses</b>. Defeats come from slow positional bleeding against stronger players, not single catastrophic moves.`;

const matchupNote = `Nearly <b>${pct(lossVsHigher, losses.length)}% of all losses</b> came against a higher-rated opponent. ${weakColor
  ? `And the leak is lopsided by color — the repertoire split below shows it concentrates on the ${weakColor} side.`
  : `The skills are there to beat peers — the gap shows against stronger play.`}`;

const lossEndNote = `<b>${checkmateCount} of ${losses.length}</b> losses ended in <b>checkmate</b> — ${NAME} rarely resigns and plays on into mating nets. ${clockIsIssue
  ? `And all <b>${timeoutCount} losses on time</b> were marathons (${timeoutMoves.join(", ")} moves): the clock, not the position, ran out.`
  : `Time is <b>not</b> the culprit — only ${timeoutCount === 0 ? "no losses" : timeoutCount === 1 ? "one loss" : `${timeoutCount} losses`} fell on the clock; the king simply gets hunted down.`}`;

const repertoireLead = weakColor
  ? `A narrow, repeatable repertoire — but lopsided by color. ${NAME} is markedly stronger as <b>${betterColor === "black" ? "Black" : "White"}</b> (${recStr(betterColor === "black" ? cs.black : cs.white)}) than as ${weakColor === "white" ? "White" : "Black"} (${recStr(weakColor === "white" ? cs.white : cs.black)}). Opening quality stays low throughout: only <b>${oaGood} of 50</b> games earned a "good" grade.`
  : `A narrow, repeatable repertoire — the <b>Caro-Kann</b> as Black is the backbone and the most reliable weapon. But opening quality is chronically low: only <b>${oaGood} of 50</b> games earned a "good" opening grade.`;

const repertoireNote = `The <b>Caro-Kann</b> family (${ckFam?.n || 0} games, ${ckFam?.w || 0}–${ckFam?.l || 0}) is the most-played Black system. The <b>London / Queen's Pawn</b> as White (${londonFam?.n || 0} games, ${londonFam?.w || 0}–${londonFam?.l || 0}) is ${(londonFam && londonFam.l >= londonFam.w) ? "the weaker half of the repertoire" : "comparatively solid"}. Because openings grade "dubious" in wins and losses alike, prep is a real weakness — but rarely the proximate cause of defeat.`;

// Coaching plan — base steps + signal-driven swaps
type Step = { h: string; p: string };
const stepBlunder: Step = { h: "Run a 5-second blunder check every move", p: `Before committing, scan: "What did my opponent's last move threaten? Does mine hang a piece or allow a check?" ${blunderClimbs ? `Losses carry visibly more catastrophic moves than wins (${avgCritLoss.toFixed(1)} vs ${avgCritWin.toFixed(1)}) — cutting one per game is the single fastest rating gain available.` : `Big errors are flat across wins and losses — cutting even one per game is the fastest rating gain available.`}` };
const stepTactics: Step = { h: "Drill middlegame tactics daily", p: `The error spike is squarely in moves 11–40. Fifteen minutes of 2–3 move tactical puzzles builds the pattern recognition that fails under middlegame complexity — exactly where games against stronger opponents are lost.` };
const stepCaro: Step = { h: "Deepen the Caro-Kann, don't replace it", p: `It anchors the Black repertoire and it works. Learn the typical pawn structures and piece placements 8–10 moves deep so the "dubious" opening grades become "good" — and keep a single coherent answer to 1.d4 rather than drifting into passive setups.` };
const stepKing: Step = { h: "Defend the king under pressure", p: `${checkmateCount} losses ended in checkmate — king safety under sustained pressure is the recurring failure. When attacked, castle early, keep a defender near the king, and trade pieces to blunt attacks rather than grabbing material.` };
const stepClock: Step = { h: "Survive the clock in long games", p: `Every loss on time was a long grind, and long games score just ${recLongO.w}–${recLongO.l}–${recLongO.d}. Bank time early by playing known opening moves quickly, and don't sink minutes into already-decided positions.` };
const stepWhite: Step = { h: "Shore up the White side", p: `As White the record is a losing ${recStr(cs.white)}, almost all of it in the London / Queen's Pawn. Either sharpen into more principled, active setups or learn concrete middlegame plans in the London so you stop drifting into passive, equal positions you then lose.` };
const stepConsistency: Step = { h: "Convert your peer dominance upward", p: `You already beat equal-and-weaker opponents convincingly (${recLowerO.w}–${recLowerO.l}–${recLowerO.d}). Treat higher-rated opponents the same way — play your plans, don't play scared — and the rating will follow the skill that's already there.` };

const secondStep: Step = clockIsIssue ? stepClock : weakColor === "white" ? stepWhite : stepConsistency;
const planLeadTail = clockIsIssue
  ? `survive the middlegame and the clock against stronger players, and the wins will follow — the endgame technique is already there.`
  : `survive the middlegame against stronger players and fix the leaks by color, and the wins will follow — the endgame technique is already there.`;
const plan: Step[] = [stepBlunder, secondStep, stepTactics, stepCaro, stepKing];
const planHtml = plan.map((s) => `      <div class="step"><div><h4>${s.h}</h4><p>${s.p}</p></div></div>`).join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME} · Rapid Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#17120d; --bg2:#1f1813; --panel:#241c15; --panel2:#2b2118;
  --line:#3a2d20; --line2:#4a3a29;
  --ink:#efe5d4; --ink-dim:#bcae98; --ink-faint:#897c67;
  --brass:#d6ab63; --brass-soft:#c39a54; --brass-glow:rgba(214,171,99,.16);
  --win:#9bbd6a; --win-bg:rgba(155,189,106,.14);
  --loss:#d4724f; --loss-bg:rgba(212,114,79,.14);
  --draw:#9a8f7e; --draw-bg:rgba(154,143,126,.14);
  --shadow:0 24px 60px -28px rgba(0,0,0,.7);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:
    radial-gradient(1200px 700px at 78% -8%, rgba(214,171,99,.10), transparent 60%),
    radial-gradient(900px 600px at 4% 102%, rgba(212,114,79,.08), transparent 55%),
    var(--bg);
  color:var(--ink); font-family:"Hanken Grotesk",system-ui,sans-serif;
  line-height:1.55; -webkit-font-smoothing:antialiased; letter-spacing:.005em;
}
body::before{ /* faint board grid texture */
  content:""; position:fixed; inset:0; pointer-events:none; opacity:.035; z-index:0;
  background-image:linear-gradient(var(--brass) 1px,transparent 1px),linear-gradient(90deg,var(--brass) 1px,transparent 1px);
  background-size:46px 46px;
}
.wrap{max-width:1080px; margin:0 auto; padding:0 24px 96px; position:relative; z-index:1}

/* ---- Hero ---- */
.hero{padding:64px 0 30px; border-bottom:1px solid var(--line)}
.kicker{display:flex; align-items:center; gap:12px; font-family:"Space Mono",monospace;
  font-size:12px; letter-spacing:.32em; text-transform:uppercase; color:var(--brass); margin-bottom:22px}
.kicker::before{content:""; width:30px; height:1px; background:var(--brass); display:inline-block}
.kicker .crown{letter-spacing:0}
h1{font-family:"Fraunces",serif; font-weight:900; font-size:clamp(52px,9vw,108px); line-height:.92;
  margin:0; letter-spacing:-.02em; color:var(--ink)}
h1 .at{color:var(--ink-faint); font-weight:400; font-style:italic; font-size:.42em; vertical-align:.5em; letter-spacing:-.01em}
.subline{display:flex; flex-wrap:wrap; gap:10px 26px; margin-top:24px; color:var(--ink-dim); font-size:15px}
.subline b{color:var(--ink); font-weight:600}
.subline .dot{color:var(--brass)}

/* ---- Scoreline ---- */
.scoreline{display:grid; grid-template-columns:auto 1fr; gap:40px; align-items:center; margin-top:38px;
  padding:30px 34px; background:linear-gradient(180deg,var(--panel),var(--bg2));
  border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow)}
.score-big{display:flex; align-items:baseline; gap:6px; font-family:"Fraunces",serif; line-height:1}
.score-big .n{font-size:74px; font-weight:900}
.score-big .n.w{color:var(--win)} .score-big .n.l{color:var(--loss)} .score-big .n.d{color:var(--draw)}
.score-big .sep{font-size:40px; color:var(--ink-faint); font-weight:400; margin:0 2px}
.score-meta{font-family:"Space Mono",monospace; font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-faint); margin-top:8px}
.score-right{min-width:0}
.sparkhead{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px}
.sparkhead .lbl{font-family:"Space Mono",monospace; font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-faint)}
.sparkhead .val{font-family:"Space Mono",monospace; font-size:13px; color:var(--brass)}
.spark{width:100%; height:auto; display:block; overflow:visible}

/* ---- Section scaffolding ---- */
section{padding-top:72px}
.sec-h{display:flex; align-items:baseline; gap:16px; margin-bottom:6px}
.sec-num{font-family:"Space Mono",monospace; font-size:13px; color:var(--brass); letter-spacing:.1em}
.sec-h h2{font-family:"Fraunces",serif; font-weight:600; font-size:clamp(28px,4vw,40px); margin:0; letter-spacing:-.015em}
.sec-lead{color:var(--ink-dim); font-size:17px; max-width:62ch; margin:0 0 32px; padding-left:42px}
.sec-lead b{color:var(--ink); font-weight:600}

/* ---- Verdict callout ---- */
.verdict{position:relative; background:linear-gradient(135deg,var(--panel2),var(--bg2));
  border:1px solid var(--line2); border-radius:20px; padding:38px 40px; box-shadow:var(--shadow); overflow:hidden}
.verdict::before{content:"♚"; position:absolute; right:-10px; top:-30px; font-size:200px; color:var(--brass); opacity:.05; line-height:1}
.verdict .vk{font-family:"Space Mono",monospace; font-size:12px; letter-spacing:.28em; text-transform:uppercase; color:var(--brass); margin-bottom:14px}
.verdict p{font-family:"Fraunces",serif; font-size:clamp(20px,2.6vw,27px); line-height:1.42; margin:0; color:var(--ink); font-weight:400; max-width:34ch; position:relative}
.verdict p em{font-style:italic; color:var(--brass)}
.verdict .vsmall{font-family:"Hanken Grotesk",sans-serif; font-size:15px; color:var(--ink-dim); margin-top:18px; max-width:60ch; line-height:1.6}

/* ---- Stat contrast grid (wins vs losses) ---- */
.contrast{display:grid; grid-template-columns:1fr; gap:2px; margin-top:30px; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--line)}
.crow{display:grid; grid-template-columns:1fr auto 1fr; align-items:center; background:var(--panel); gap:18px; padding:18px 26px}
.crow.head{background:var(--bg2)}
.crow .clabel{text-align:center; font-family:"Space Mono",monospace; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint)}
.crow .cw{text-align:right} .crow .cl{text-align:left}
.crow .cv{font-family:"Fraunces",serif; font-size:26px; font-weight:600}
.crow .cw .cv{color:var(--win)} .crow .cl .cv{color:var(--loss)}
.crow .cd{font-size:13px; color:var(--ink-faint)}
.crow.head .cw,.crow.head .cl{font-family:"Space Mono",monospace; font-size:12px; letter-spacing:.18em; text-transform:uppercase}
.crow.head .cw{color:var(--win)} .crow.head .cl{color:var(--loss)}

/* ---- Loss anatomy ---- */
.grid2{display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:8px}
.card{background:linear-gradient(180deg,var(--panel),var(--bg2)); border:1px solid var(--line);
  border-radius:18px; padding:26px 28px; box-shadow:var(--shadow)}
.card h3{font-family:"Fraunces",serif; font-weight:600; font-size:21px; margin:0 0 4px; letter-spacing:-.01em}
.card .ch-sub{font-size:13.5px; color:var(--ink-faint); margin:0 0 22px}
.splitbar{margin:18px 0}
.splitbar .sb-top{display:flex; justify-content:space-between; font-size:14px; margin-bottom:7px; color:var(--ink-dim)}
.splitbar .sb-top b{color:var(--ink)}
.recbar{display:flex; height:13px; border-radius:7px; overflow:hidden; background:var(--bg); border:1px solid var(--line)}
.recbar .seg{display:block} .recbar .seg.w{background:var(--win)} .recbar .seg.l{background:var(--loss)} .recbar .seg.d{background:var(--draw)}
.sb-foot{display:flex; gap:16px; margin-top:8px; font-family:"Space Mono",monospace; font-size:12px; color:var(--ink-faint)}
.sb-foot .k.w{color:var(--win)} .sb-foot .k.l{color:var(--loss)} .sb-foot .k.d{color:var(--draw)}

/* loss type bars */
.lt{display:flex; flex-direction:column; gap:14px; margin-top:4px}
.lt-row{display:grid; grid-template-columns:128px 1fr 34px; align-items:center; gap:14px}
.lt-name{font-size:14px; color:var(--ink-dim)}
.lt-track{height:22px; background:var(--bg); border:1px solid var(--line); border-radius:6px; overflow:hidden}
.lt-fill{height:100%; background:linear-gradient(90deg,var(--loss),#e08a63); border-radius:5px}
.lt-n{font-family:"Space Mono",monospace; font-size:14px; text-align:right; color:var(--ink)}
.note{margin-top:20px; padding:14px 18px; border-left:3px solid var(--brass); background:var(--brass-glow);
  border-radius:0 10px 10px 0; font-size:14.5px; color:var(--ink-dim)}
.note b{color:var(--ink)}

/* ---- Phase bars ---- */
.phase{display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-top:8px; align-items:end}
.ph{display:flex; flex-direction:column; align-items:center; gap:0}
.ph-barwrap{height:180px; width:100%; display:flex; align-items:flex-end; justify-content:center}
.ph-bar{width:64%; border-radius:9px 9px 0 0; position:relative;
  background:linear-gradient(180deg,var(--brass),var(--brass-soft)); min-height:6px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
.ph-bar .pv{position:absolute; top:-26px; left:50%; transform:translateX(-50%); font-family:"Space Mono",monospace; font-size:15px; color:var(--brass)}
.ph-lab{margin-top:14px; text-align:center}
.ph-lab .l{font-size:14px; color:var(--ink); font-weight:600}
.ph-lab .s{font-size:12px; color:var(--ink-faint); font-family:"Space Mono",monospace}

/* ---- Opening repertoire ---- */
.op-row{display:grid; grid-template-columns:1fr 1.1fr auto; gap:16px; align-items:center; padding:11px 0; border-bottom:1px solid var(--line)}
.op-row:last-child{border-bottom:0}
.op-name{font-size:14.5px; color:var(--ink)}
.op-track{position:relative; height:24px; background:var(--bg); border:1px solid var(--line); border-radius:6px; display:flex; align-items:center}
.op-fill{height:100%; background:linear-gradient(90deg,rgba(214,171,99,.55),rgba(214,171,99,.18)); border-radius:5px}
.op-n{position:absolute; right:9px; font-family:"Space Mono",monospace; font-size:12px; color:var(--ink-dim)}
.op-rec{display:flex; align-items:center; gap:10px; min-width:128px; justify-content:flex-end}
.op-rec .recbar{width:74px}
.op-wld{font-family:"Space Mono",monospace; font-size:12.5px; color:var(--ink-dim)}
.colhead{font-family:"Space Mono",monospace; font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--brass); margin-bottom:6px}

/* assessment donut row */
.assess{display:flex; gap:10px; margin-top:18px}
.asg{flex:1; padding:16px 18px; border-radius:14px; border:1px solid var(--line); background:var(--panel)}
.asg .an{font-family:"Fraunces",serif; font-size:34px; font-weight:600; line-height:1}
.asg .al{font-family:"Space Mono",monospace; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint); margin-top:6px}
.asg.good{border-color:rgba(155,189,106,.4)} .asg.good .an{color:var(--win)}
.asg.inacc .an{color:var(--brass)}
.asg.dub{border-color:rgba(212,114,79,.35)} .asg.dub .an{color:var(--loss)}

/* ---- Takeaways ---- */
.plan{counter-reset:step; display:grid; gap:14px; margin-top:8px}
.step{display:grid; grid-template-columns:auto 1fr; gap:20px; align-items:start; padding:22px 26px;
  background:linear-gradient(180deg,var(--panel),var(--bg2)); border:1px solid var(--line); border-radius:16px}
.step::before{counter-increment:step; content:counter(step,decimal-leading-zero);
  font-family:"Fraunces",serif; font-weight:900; font-size:30px; color:var(--brass); opacity:.8; line-height:1}
.step h4{margin:0 0 5px; font-family:"Hanken Grotesk",sans-serif; font-size:17px; font-weight:700; color:var(--ink)}
.step p{margin:0; color:var(--ink-dim); font-size:14.5px; line-height:1.55}

/* ---- Game log ---- */
.tablewrap{margin-top:8px; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--panel)}
table{width:100%; border-collapse:collapse; font-size:13.5px}
thead th{font-family:"Space Mono",monospace; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-faint); text-align:left; padding:14px 14px; background:var(--bg2); border-bottom:1px solid var(--line); font-weight:400}
tbody td{padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--panel2)}
.t-date{font-family:"Space Mono",monospace; color:var(--ink-faint); white-space:nowrap}
.disc{width:13px; height:13px; border-radius:50%; display:inline-block; border:1px solid var(--line2)}
.disc.white{background:var(--ink)} .disc.black{background:#0d0a07; border-color:var(--ink-faint)}
.t-opp{font-weight:600; color:var(--ink)}
.t-opprat{display:block; font-family:"Space Mono",monospace; font-size:11px; color:var(--ink-faint); font-weight:400}
.t-opprat em{font-style:normal} .t-opprat.up em{color:var(--loss)} .t-opprat.down em{color:var(--win)}
.t-open{color:var(--ink-dim); max-width:260px}
.t-assess{display:block; font-family:"Space Mono",monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase}
.a-good{color:var(--win)} .a-inaccurate{color:var(--brass-soft)} .a-dubious{color:var(--loss)}
.t-moves{font-family:"Space Mono",monospace; color:var(--ink-dim); text-align:center}
.t-result{color:var(--ink-dim); white-space:nowrap}
.chip{display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center; border-radius:7px;
  font-family:"Space Mono",monospace; font-weight:700; font-size:12px}
.chip.win{background:var(--win-bg); color:var(--win)} .chip.loss{background:var(--loss-bg); color:var(--loss)} .chip.draw{background:var(--draw-bg); color:var(--draw)}
.gr.loss .t-opp{color:var(--ink)}

/* filter chips */
.filters{display:flex; gap:8px; margin:0 0 16px; flex-wrap:wrap}
.fchip{font-family:"Space Mono",monospace; font-size:12px; letter-spacing:.08em; text-transform:uppercase;
  padding:7px 16px; border-radius:20px; border:1px solid var(--line2); background:var(--panel); color:var(--ink-dim); cursor:pointer; transition:.16s}
.fchip:hover{border-color:var(--brass); color:var(--ink)}
.fchip.active{background:var(--brass); color:#1a130a; border-color:var(--brass); font-weight:700}

footer{margin-top:80px; padding-top:28px; border-top:1px solid var(--line); color:var(--ink-faint); font-size:12.5px; line-height:1.7}
footer b{color:var(--ink-dim)}
.method{font-family:"Space Mono",monospace; font-size:11.5px; color:var(--ink-faint)}

/* entrance */
@keyframes rise{from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:none}}
.hero>*,section>*{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
section>*:nth-child(2){animation-delay:.06s} section>*:nth-child(3){animation-delay:.12s}
@keyframes draw{from{stroke-dashoffset:var(--len)} to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}

@media(max-width:760px){
  .scoreline{grid-template-columns:1fr; gap:24px}
  .grid2{grid-template-columns:1fr}
  .crow{grid-template-columns:1fr auto 1fr; padding:16px 16px; gap:10px}
  .sec-lead{padding-left:0}
  .phase{gap:8px} .ph-barwrap{height:130px}
  .t-open{display:none} .t-result{font-size:12px}
  .assess{flex-direction:column}
}
</style>
</head>
<body>
<div class="wrap">

  <header class="hero">
    <div class="kicker"><span class="crown">♞</span> Rapid Performance Review · Chess.com</div>
    <h1>${NAME}<span class="at">@${USER}</span></h1>
    <div class="subline">
      <span><b>50</b> most recent Rapid games</span><span class="dot">◆</span>
      <span>${r.dateRange.from} — ${r.dateRange.to}</span><span class="dot">◆</span>
      <span>Rating <b>${ratings[0]}</b> → <b>${ratings[ratings.length - 1]}</b></span><span class="dot">◆</span>
      <span>Stockfish 18 · depth 14</span>
    </div>

    <div class="scoreline">
      <div>
        <div class="score-big">
          <span class="n w">${wins.length}</span><span class="sep">–</span><span class="n l">${losses.length}</span><span class="sep">–</span><span class="n d">${draws.length}</span>
        </div>
        <div class="score-meta">${winRate}% score &nbsp;·&nbsp; W – L – D</div>
      </div>
      <div class="score-right">
        <div class="sparkhead"><span class="lbl">Rating across the window</span><span class="val">low ${rmin} · high ${rmax}</span></div>
        <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rating over 50 games">
          <defs>
            <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--brass)" stop-opacity=".28"/>
              <stop offset="1" stop-color="var(--brass)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon points="${areaPts}" fill="url(#ag)"/>
          <polyline points="${linePts}" fill="none" stroke="var(--brass)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
          ${dots.map((d) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="3" fill="var(--${d.o})" stroke="var(--bg)" stroke-width="1"/>`).join("")}
        </svg>
      </div>
    </div>
  </header>

  <section>
    <div class="verdict">
      <div class="vk">The one-line verdict</div>
      <p>${verdictHead}</p>
      <div class="vsmall">${verdictSmall}</div>
    </div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">01</span><h2>Wins vs. Losses, side by side</h2></div>
    <p class="sec-lead">${contrastLead}</p>
    <div class="contrast">
      <div class="crow head"><div class="cw">In wins</div><div class="clabel">Metric</div><div class="cl">In losses</div></div>
      <div class="crow"><div class="cw"><span class="cv">${avgOppWin}</span></div><div class="clabel">Avg. opponent rating</div><div class="cl"><span class="cv">${avgOppLoss}</span></div></div>
      <div class="crow"><div class="cw"><span class="cv">${avgMovesWin}</span></div><div class="clabel">Avg. game length (moves)</div><div class="cl"><span class="cv">${avgMovesLoss}</span></div></div>
      <div class="crow"><div class="cw"><span class="cv">${avgCritWin.toFixed(1)}</span></div><div class="clabel">Flagged critical errors / game</div><div class="cl"><span class="cv">${avgCritLoss.toFixed(1)}</span></div></div>
      <div class="crow"><div class="cw"><span class="cv">${avgMistakesWin.toFixed(2)}</span></div><div class="clabel">Mid-size mistakes (1–2 pawns) / game</div><div class="cl"><span class="cv">${avgMistakesLoss.toFixed(2)}</span></div></div>
    </div>
    <div class="note">${contrastNote}</div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">02</span><h2>The anatomy of a loss</h2></div>
    <p class="sec-lead">Of <b>${losses.length}</b> defeats, the pattern is remarkably consistent: a longer game against a stronger opponent that ends with the king getting hunted down.</p>
    <div class="grid2">
      <div class="card">
        <h3>Matchup decides it</h3>
        <p class="ch-sub">Record split by opponent rating relative to ${NAME}</p>
        <div class="splitbar">
          <div class="sb-top"><span>vs. equal or lower-rated</span><b>${rec(lower).w}–${rec(lower).l}–${rec(lower).d}</b></div>
          ${recBar(rec(lower), lower.length)}
          <div class="sb-foot"><span class="k w">${pct(rec(lower).w, lower.length)}% score</span></div>
        </div>
        <div class="splitbar">
          <div class="sb-top"><span>vs. higher-rated</span><b>${rec(higher).w}–${rec(higher).l}–${rec(higher).d}</b></div>
          ${recBar(rec(higher), higher.length)}
          <div class="sb-foot"><span class="k l">${pct(rec(higher).w, higher.length)}% score</span></div>
        </div>
        <div class="note" style="margin-top:16px">${matchupNote}</div>
      </div>
      <div class="card">
        <h3>How the losses end</h3>
        <p class="ch-sub">Manner of defeat across ${losses.length} losses</p>
        <div class="lt">
          ${Object.entries(lossTypes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
            const max=Math.max(...Object.values(lossTypes));
            return `<div class="lt-row"><div class="lt-name">${resultLabel[k]||k}</div><div class="lt-track"><div class="lt-fill" style="width:${(v/max)*100}%"></div></div><div class="lt-n">${v}</div></div>`;
          }).join("")}
        </div>
        <div class="note" style="margin-top:18px">${lossEndNote}</div>
      </div>
    </div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">03</span><h2>When the errors happen</h2></div>
    <p class="sec-lead">Engine-flagged critical moments cluster in the <b>middlegame</b> — once pieces are developed and the position opens, calculation strain peaks. The opening is shaky but survivable; the middlegame is where games are lost.</p>
    <div class="card">
      <div class="phase">
        ${phaseOrder.map((p)=>{
          const v=bp[p.key]||0; const h=Math.max(6,(v/bpMax)*180);
          return `<div class="ph"><div class="ph-barwrap"><div class="ph-bar" style="height:${h}px"><span class="pv">${v}</span></div></div><div class="ph-lab"><div class="l">${p.label}</div><div class="s">${p.sub}</div></div></div>`;
        }).join("")}
      </div>
      <div class="note" style="margin-top:24px">Across all 50 games the engine flagged <b>${(bp.middlegame||0)+(bp.late_middlegame||0)} middlegame errors</b> vs. ${bp.opening||0} in the opening and ${bp.endgame||0} in the endgame. Endgames are comparatively <b>clean</b> (${pct(Math.round(r.endgameReachedRate*100),100)}% of games reach one) — a genuine strength worth protecting.</div>
    </div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">04</span><h2>Opening repertoire</h2></div>
    <p class="sec-lead">${repertoireLead}</p>
    <div class="grid2">
      <div class="card">
        <div class="colhead">As Black · ${cs.black.games} games · ${recStr(cs.black)}</div>
        ${familyRows(blackFamilies)}
      </div>
      <div class="card">
        <div class="colhead">As White · ${cs.white.games} games · ${recStr(cs.white)}</div>
        ${familyRows(whiteFamilies)}
      </div>
    </div>
    <div class="assess">
      <div class="asg good"><div class="an">${oaGood}</div><div class="al">Good openings</div></div>
      <div class="asg inacc"><div class="an">${oaInacc}</div><div class="al">Inaccurate</div></div>
      <div class="asg dub"><div class="an">${oaDub}</div><div class="al">Dubious</div></div>
    </div>
    <div class="note" style="margin-top:18px">${repertoireNote}</div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">05</span><h2>The coaching plan</h2></div>
    <p class="sec-lead">Five priorities, ordered by expected rating impact. The throughline: <b>${planLeadTail}</b></p>
    <div class="plan">
${planHtml}
    </div>
  </section>

  <section>
    <div class="sec-h"><span class="sec-num">06</span><h2>Every game in the window</h2></div>
    <p class="sec-lead">All ${games.length} Rapid games, newest first. ↑ marks a higher-rated opponent. Filter by result below.</p>
    <div class="filters">
      <span class="fchip active" data-f="all">All ${games.length}</span>
      <span class="fchip" data-f="win">Wins ${wins.length}</span>
      <span class="fchip" data-f="loss">Losses ${losses.length}</span>
      <span class="fchip" data-f="draw">Draws ${draws.length}</span>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>Date</th><th></th><th>Opponent</th><th>Opening</th><th>Mv</th><th>Result</th><th></th>
        </tr></thead>
        <tbody id="gbody">${gameRows}</tbody>
      </table>
    </div>
  </section>

  <footer>
    <p class="method"><b>Methodology.</b> Games pulled live from the Chess.com public API and evaluated with Stockfish 18 (WASM) at depth 14. "Critical errors" = the engine's most damaging moves per game, surfaced up to four per game — so the ${avgCritWin.toFixed(1)}/${avgCritLoss.toFixed(1)} averages reflect that most games hit that ceiling rather than an exact count. Opening grades and phase tallies are derived from per-move evaluation swings (≥50 cp = inaccuracy, ≥100 = mistake, ≥200 = blunder).</p>
    <p>Window: ${r.dateRange.from} → ${r.dateRange.to} · ${games.length} games · Generated for @${USER} · Rapid time control only.</p>
  </footer>

</div>
<script>
  // result filter
  const chips=[...document.querySelectorAll('.fchip')];
  const rows=[...document.querySelectorAll('#gbody tr')];
  chips.forEach(c=>c.addEventListener('click',()=>{
    chips.forEach(x=>x.classList.remove('active')); c.classList.add('active');
    const f=c.dataset.f;
    rows.forEach(r=>{ r.style.display = (f==='all'||r.classList.contains(f))?'':'none'; });
  }));
  // staggered table reveal
  rows.forEach((r,i)=>{ r.style.animation='rise .5s ease both'; r.style.animationDelay=(Math.min(i,30)*0.018)+'s'; });
</script>
</body>
</html>`;

const outPath = path.join(process.cwd(), `${USER}-rapid-report.html`);
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
