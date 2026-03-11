// scripts/format-coverage-summary.js
const data = JSON.parse(require("fs").readFileSync("/dev/stdin", "utf8"));
const total = data.total;
console.log("| Metric | Coverage |");
console.log("|--------|----------|");
["lines", "functions", "branches", "statements"].forEach((m) => {
  const pct = total[m].pct;
  const icon = pct >= 90 ? "✅" : pct >= 80 ? "⚠️" : "❌";
  console.log(`| ${m} | ${icon} ${pct}% |`);
});
