// chat-docs/docs/assumptions.md, the chat's copy of the Assumptions page,
// written from the same list the page shows (frontend/src/shared/assumptions.js).
//
//   node scripts/build_chat_assumptions.mjs
//
// Rerun after editing that list, then scripts/upload_chat_docs.sh.
import { writeFileSync } from "node:fs";
import { SECTIONS } from "../frontend/src/shared/assumptions.js";

// Notes about who decided what, and when, are for the team, not for users.
const clean = (t) => String(t || "")
  .replace(/\s*Team decision, \d{4}-\d{2}-\d{2}\.?/g, "")
  .replace(/;\s*team decision, \d{4}-\d{2}-\d{2}\.?/g, ".")
  .replace(/No recorded decision yet\.?/g, "")
  .trim();

let md = `# What the navigator assumes

Every assumption behind the app's numbers: what is assumed, what that leaves
out, and why. This is the same list the Assumptions button in the app opens.
The numbers keep their place, so "assumption 33" always means the same one.
`;
for (const s of SECTIONS) {
  md += `\n# ${s.title}\n`;
  for (const i of s.items) {
    md += `\n## ${i.n}. ${i.title}\n\n${clean(i.body)}\n\n`;
    if (clean(i.costs)) md += `- **What it leaves out:** ${clean(i.costs)}\n`;
    const why = clean(i.why) || (i.ours ? "Our choice." : "");
    if (why) md += `- **Why:** ${why}${i.ours && !/our (choice|estimate)/i.test(why) ? " (Our choice.)" : ""}\n`;
    const src = (i.sources || []).map((x) => x.label).filter((l) => !/\.py\)|\.csv\)|README\)|Navigator plan/.test(l));
    if (src.length) md += `- **Source:** ${src.join("; ")}\n`;
  }
}
writeFileSync(new URL("../chat-docs/docs/assumptions.md", import.meta.url), md);
console.log("✓ chat-docs/docs/assumptions.md");
