import { useState } from "react";
import { ChevronDown, Code, Keyboard, Mail } from "lucide-react";
import { useAppT } from "../app-i18n";
import { CONTACT_EMAIL, SOURCE_URL } from "../site-config";
import { AppShell } from "./AppShell";

// In English; the app translates it on screen.
export const FAQ = [
  {
    group: "Getting started",
    items: [
      { q: "How do I create my first presentation?", a: "Click New presentation, write your question and its options, then Launch. You can also start from a presentation shared in Community." },
      { q: "What types of questions can I ask?", a: "20 kinds: polls, quizzes, word clouds, open text, Q&A, rankings, the wheel, a timer, slides and more, plus topic rounds. Mix them as you like." },
      { q: "How do quiz points work?", a: "1,000 points per right answer. With a timer, 500 to 1,000 depending on speed. With first names on, the leaderboard shows the top 5 after each question and the top 10 at the end, with their avatars." },
      { q: "How do I reveal a quiz answer?", a: "On the big screen, click Show right answer. Voting closes and each phone shows its result." },
      { q: "How do I start presenting?", a: "Open your presentation, click Present, then Full screen. Keep that tab on the projected screen." },
      { q: "How do I add an image?", a: "In the editor, click Add an image under the question. It shows on the big screen and on phones." },
    ],
  },
  {
    group: "During the presentation",
    items: [
      { q: "How does my room join?", a: "The QR code and short link show next to the results. You can also paste them on your slide or in a meeting chat." },
      { q: "Can participants answer in their own language?", a: "Yes. Each phone shows in the person's language, with the question and options translated automatically. A picker lets them switch language or see the original." },
      { q: "Do participants need to install an app?", a: "No. They scan, answer in their browser and follow along automatically when you change questions." },
      { q: "How do I go to the next question?", a: "With the Previous and Next buttons under the results, or with the arrow keys." },
      { q: "How do I handle audience questions?", a: "The most upvoted rise to the top. Mark them answered once done, or hide off-topic ones." },
      { q: "Can a participant change their mind?", a: "Yes, with Change my answer. Their previous choice is removed, so they only count once." },
    ],
  },
  {
    group: "After the presentation",
    items: [
      { q: "Can I reuse a presentation?", a: "Yes. Reset clears the answers and keeps the questions. The link and QR code don't change." },
      { q: "Can I edit the questions afterwards?", a: "Yes, with Edit questions. Changing the questions clears the answers already received, since they no longer match. A new title keeps them." },
      { q: "How do I get the results?", a: "They stay in your presentation. You can also export them as CSV for Excel or Google Sheets." },
    ],
  },
  {
    group: "Account and privacy",
    items: [
      { q: "Can I collect participants' emails?", a: "Yes, with a Contact details question (Collect category): email, phone, name or company. Everyone must tick their consent, and the details never show on the room's screen. You find them in the results and the CSV export." },
      { q: "Are answers anonymous?", a: "Yes, by default: nobody needs an account, a name or an email to answer. Names appear only if you turn on first names, and contact details only in a Contact details question, with consent." },
      { q: "How do I delete my account?", a: "In Settings, under Delete account. Everything is erased for good, presentations and images included." },
    ],
  },
];

const KEYS = [
  ["→ or Space", "Next question"],
  ["←", "Previous question"],
  ["P", "Pause or resume voting"],
  ["R", "Show or hide the quiz answer"],
  ["F", "Full screen"],
];

function Item({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const t = useAppT();
  return (
    <li className={`faq-item ${open ? "open" : ""}`}>
      <button className="faq-q" aria-expanded={open} onClick={onToggle}>
        <span>{t(q)}</span>
        <ChevronDown size={20} className="faq-chevron" />
      </button>
      <div className="faq-a" aria-hidden={!open}>
        <div>
          <p>{t(a)}</p>
        </div>
      </div>
    </li>
  );
}

export function Help() {
  const t = useAppT();
  const [open, setOpen] = useState<string | null>(FAQ[0].items[0].q);
  return (
    <AppShell title={t("Help")} subtitle={t("Answers to the most common questions.")}>
      <div className="help">
        <div className="faq-groups">
          {FAQ.map(({ group, items }) => (
            <section key={group}>
              <h2 className="faq-group">{t(group)}</h2>
              <ul className="faq">
                {items.map((item) => (
                  <Item key={item.q} {...item} open={open === item.q} onToggle={() => setOpen(open === item.q ? null : item.q)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <aside className="help-side">
          <section className="panel">
            <h2 className="with-icon-title"><Keyboard size={20} /> {t("Shortcuts")}</h2>
            <dl className="keys">
              {KEYS.map(([k, v]) => (
                <div key={k}>
                  <dt><kbd>{t(k)}</kbd></dt>
                  <dd>{t(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
          {CONTACT_EMAIL && (
            <section className="panel">
              <h2 className="with-icon-title"><Mail size={20} /> {t("Still stuck?")}</h2>
              <p className="muted help-contact">{t("Write to us, we answer fast.")}</p>
              <a className="button ghost full" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </section>
          )}
          {SOURCE_URL && (
            <section className="panel">
              <h2 className="with-icon-title"><Code size={20} /> {t("Source code")}</h2>
              <p className="muted help-contact">{t("This app is free software under the AGPL-3.0.")}</p>
              <a className="button ghost full" href={SOURCE_URL} target="_blank" rel="noopener">{t("See the code")}</a>
            </section>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
