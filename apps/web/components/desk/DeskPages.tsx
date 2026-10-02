"use client";

import Link from "next/link";
import { useState } from "react";
import { Aurora, LogoMark, StatusIcon } from "@/components/ds";
import { FAQ_GROUPS } from "@/app/faq/questions";
import { useDeskDialogs } from "./DeskDialogs";
import {
  COLLAR_STEPS,
  HOW_OFFLINE,
  HOW_ROWS,
  HOW_STEPS,
  LEDGER,
  MISSION,
  PARTNERS,
  PHASES,
  PRIVACY_SECTIONS,
  PRIVACY_SHORT,
  ROLES,
} from "./content";
import d from "./layout.module.css";
import s from "./DeskPages.module.css";

/**
 * The desktop pages (design v9, the owner's "Hetja Desktop" export, ported
 * section by section). Each app page renders one of these from 1024px and
 * its phone layout below it (components/desk/Desk.tsx).
 */

function Check({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span className={d.checkIcon}>
      <StatusIcon name="check" size={size} />
    </span>
  );
}

export function DeskHow(): React.JSX.Element {
  const { openPhone } = useDeskDialogs();
  return (
    <div className={d.white}>
      <section className={`${d.wrap} ${s.howHead}`}>
        <h1 className={d.h1} style={{ maxWidth: 820 }}>
          From collar to vet, in order.
        </h1>
        <ol className={s.howRows}>
          {HOW_ROWS.map(([title, text], i) => (
            <li key={title}>
              <span className={s.bigN}>{i + 1}</span>
              <h2 className={s.rowTitle}>{title}</h2>
              <p className={d.cardText}>{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className={d.mist}>
        <div className={`${d.wrap} ${s.block}`}>
          <div className={s.head}>
            <p className={d.label}>The three steps</p>
            <h2 className={d.h2}>From street to shared, in under a minute.</h2>
            <p className={d.sub}>Every step is designed to be done one-handed, at night, on a street corner.</p>
          </div>
          <ol className={d.grid3}>
            {HOW_STEPS.map((st) => (
              <li key={st.title} className={`${d.card} ${d.cardLg}`}>
                <h3 className={`${d.cardTitle} ${d.cardTitleLg}`}>{st.title}</h3>
                <p className={s.stepText}>{st.text}</p>
                <ul className={s.points}>
                  {st.points.map((p) => (
                    <li key={p}>
                      <Check size={14} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className={`${d.wrap} ${d.halves} ${s.pad96}`}>
        <div className={s.head}>
          <p className={d.label}>The offline story</p>
          <h2 className={d.h2}>No signal? No problem.</h2>
          <p className={d.sub}>
            Mumbai&apos;s lanes don&apos;t always have a bar of data, and a dog that needs you doesn&apos;t care. Hetja was built for
            the patchy networks where street dogs actually live.
          </p>
        </div>
        <ul className={`${d.checkList} ${d.mist}`}>
          {HOW_OFFLINE.map((p) => (
            <li key={p}>
              <Check />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${d.wrap} ${s.cta}`}>
        <h2 className={s.ctaTitle}>The collar is on. The dog is waiting.</h2>
        <p className={d.sub}>Find out who&apos;s on your street, then come back for the daily feed.</p>
        <button type="button" className={s.primary} onClick={() => openPhone()}>
          Scan a collar
        </button>
      </section>
    </div>
  );
}

export function DeskAbout(): React.JSX.Element {
  return (
    <div className={d.mist}>
      <Aurora variant="about">
        <div className={`${d.wrap} ${s.hero}`}>
          <span className={d.kicker}>Our mission</span>
          <h1 className={d.h1} style={{ maxWidth: 900 }}>
            A coordination layer for people who already care.
          </h1>
          <p className={d.lead} style={{ maxWidth: 640 }}>
            Hetja is not another app asking you to care about stray dogs. The people who care (the feeders, vets, NGOs, and
            municipal staff) are already out there. We just give their care a memory, a ledger, and a voice.
          </p>
        </div>
      </Aurora>
      <section className={d.wrap}>
        <ul className={d.grid3}>
          {MISSION.map((m) => (
            <li key={m.title} className={d.card}>
              <h2 className={d.cardTitle}>{m.title}</h2>
              <p className={d.cardText}>{m.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${d.wrap} ${d.split} ${s.pt112}`}>
        <div className={s.head}>
          <p className={d.label}>What Hetja is</p>
          <h2 className={`${d.h2} ${d.h2m}`}>Mumbai already loves its strays. Hetja keeps track of that love.</h2>
        </div>
        <div className={s.prose}>
          <p>
            A street dog in Mumbai is fed by whoever happens to pass, treated by whichever vet has time, and remembered only by
            the people who see it daily. When a dog falls sick, no one knows. When a new feeder arrives, they start from zero.
            When BMC plans an ABC drive, it works on guesses.
          </p>
          <p>
            Hetja gives every collar-wearing dog a public profile: a name, a ward, verified medical records, and a running log
            of who shows up for it. Suddenly a whole street&apos;s care becomes one shared, honest picture.
          </p>
          <p className={s.ink}>
            We are <strong>not</strong> a replacement for the people doing this. We are the thread that ties them together.
          </p>
        </div>
      </section>
      <section className={`${d.wrap} ${s.block} ${s.pt112}`}>
        <div className={s.head}>
          <p className={d.label}>How the collar works</p>
          <h2 className={`${d.h2} ${d.h2m}`}>A QR collar is a dog&apos;s whole file.</h2>
          <p className={d.sub}>One scan and the animal&apos;s story (medical, social, and practical) is in your hands.</p>
        </div>
        <ul className={d.grid3}>
          {COLLAR_STEPS.map((c) => (
            <li key={c.n} className={d.card} style={{ gap: 8 }}>
              <span className={s.stepN}>{c.n}</span>
              <h3 className={d.cardTitle}>{c.title}</h3>
              <p className={d.cardText}>{c.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${d.wrap} ${d.split} ${s.pt112}`} style={{ alignItems: "start" }}>
        <div className={s.head}>
          <p className={d.label}>The ledger</p>
          <h2 className={`${d.h2} ${d.h2m}`}>A medical record that can&apos;t be quietly edited.</h2>
          <p className={d.sub}>Trust is the whole product. So the ledger is built to be tamper-evident by design, not by promise.</p>
        </div>
        <ul className={`${d.checkList} ${d.white} ${s.ledger}`}>
          {LEDGER.map((p) => (
            <li key={p}>
              <Check />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${d.wrap} ${s.block} ${s.pt112}`}>
        <div className={s.head}>
          <p className={d.label}>The rollout</p>
          <h2 className={`${d.h2} ${d.h2m}`}>Built street by street, not all at once.</h2>
          <p className={d.sub}>
            We&apos;d rather do one ward beautifully than a city carelessly. Each phase proves itself before the next begins.
          </p>
        </div>
        <ol className={d.grid4}>
          {PHASES.map((p, i) => (
            <li key={p.tag} className={s.phase} style={{ borderTopColor: i === 0 ? "var(--h-ink)" : "#d2d2d7" }}>
              <span className={d.label}>{p.tag}</span>
              <h3 className={d.cardTitle}>{p.title}</h3>
              <span className={s.phaseDogs}>{p.dogs}</span>
              <p className={d.cardText}>{p.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className={`${d.wrap} ${s.pt112} ${s.pb112}`}>
        <div className={s.memorial}>
          <span className={s.memMark}>
            <LogoMark size={56} />
          </span>
          <div className={s.memText}>
            <h2 className={s.memTitle}>In memory of Hetja</h2>
            <p className={s.memSub}>This network exists because of one dog who did not survive a city like the one we&apos;re trying to build.</p>
          </div>
          <div className={s.memLinks}>
            <Link href="/hetja" className={d.link}>
              Read why we built Hetja ›
            </Link>
            <Link href="/credits" className={d.link}>
              The people who helped ›
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export function DeskJoin(): React.JSX.Element {
  const { openPhone } = useDeskDialogs();
  return (
    <div className={d.mist}>
      <Aurora variant="about">
        <div className={`${d.wrap} ${s.hero}`} style={{ paddingBottom: 72 }}>
          <span className={d.kicker}>Feeders and vets</span>
          <h1 className={d.h1} style={{ maxWidth: 860 }}>
            Everyone who already shows up.
          </h1>
          <p className={d.lead} style={{ maxWidth: 620 }}>
            If you&apos;ve ever fed, treated, rescued, or planned for a street dog, this network is built around you.
          </p>
        </div>
      </Aurora>
      <section className={`${d.wrap} ${s.pb112}`}>
        <ul className={d.grid3}>
          {ROLES.map((r, i) => (
            <li key={r.label} id={["feeders", "vets", "ngos"][i]} className={`${d.card} ${d.cardLg}`}>
              <p className={d.label}>{r.label}</p>
              <h2 className={s.roleTitle}>{r.title}</h2>
              <p className={s.stepText}>{r.text}</p>
              <ul className={s.rolePoints}>
                {r.points.map((p) => (
                  <li key={p}>
                    <Check size={15} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <div className={s.roleCta}>
                {r.href ? (
                  <a href={r.href} className={s.tinted}>
                    {r.cta}
                  </a>
                ) : (
                  <button type="button" className={s.tinted} onClick={() => openPhone()}>
                    {r.cta}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function DeskPrivacy(): React.JSX.Element {
  return (
    <div className={d.black}>
      <section className={`${d.wrap} ${s.privHead}`}>
        <h1 className={`${d.h1} ${d.h1xl}`}>
          What we keep.
          <br />
          What we don&apos;t.
        </h1>
        <p className={s.bandLead}>Short version: as little as possible, and never a dog&apos;s exact location.</p>
        <ul className={d.grid3} style={{ marginTop: 24 }}>
          {PRIVACY_SHORT.map((x) => (
            <li key={x.title} className={s.darkCard}>
              <span className={s.darkIcon} style={{ color: x.ok ? "#30d158" : "#ff6961" }}>
                <StatusIcon name={x.ok ? "check" : "cross"} size={22} />
              </span>
              <h2 className={d.cardTitle}>{x.title}</h2>
              <p className={s.darkText}>{x.text}</p>
            </li>
          ))}
        </ul>
      </section>
      {PRIVACY_SECTIONS.map((sec) => (
        <section key={sec.label} className={`${d.wrap} ${s.privSection}`}>
          <div className={s.head}>
            <p className={`${d.label} ${d.bandLabel}`}>{sec.label}</p>
            <h2 className={s.privTitle}>{sec.title}</h2>
            {sec.sub && <p className={s.darkSub}>{sec.sub}</p>}
          </div>
          <ul className={s.privItems}>
            {sec.items.map((it) => (
              <li key={it.title}>
                <div className={s.privItemHead}>
                  <h3 className={s.privItemTitle}>{it.title}</h3>
                  {it.scope && <span className={s.scope}>{it.scope}</span>}
                </div>
                <p className={s.darkText}>{it.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className={`${d.wrap} ${s.privQuote}`}>
        <figure className={s.quoteFig}>
          <blockquote className={s.quote}>
            &ldquo;If you ever wonder what we hold about you, ask. You&apos;ll get an answer from a person, not a policy page.&rdquo;
          </blockquote>
          <figcaption className={s.darkText}>
            Data requests:{" "}
            <a href="mailto:hello@hetja.in" className={s.bandLink}>
              hello@hetja.in
            </a>
          </figcaption>
        </figure>
      </section>
    </div>
  );
}

export function DeskFaq(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(0);
  const items = FAQ_GROUPS[tab]?.items ?? [];
  return (
    <div className={d.mist}>
      <Aurora variant="faq">
        <div className={`${d.wrap} ${s.hero}`} style={{ paddingBottom: 72 }}>
          <h1 className={d.h1}>Questions from the street.</h1>
          <p className={d.lead} style={{ maxWidth: 620 }}>
            Everything feeders, vets, NGOs, and citizens ask us most.
          </p>
        </div>
      </Aurora>
      <section className={`${d.wrap} ${s.faq} ${s.pb112}`}>
        <div className={s.faqSide}>
          <div className={s.faqTabs} role="tablist" aria-label="Questions from">
            {FAQ_GROUPS.map((g, i) => (
              <button
                key={g.label}
                type="button"
                role="tab"
                aria-selected={tab === i}
                className={[s.faqTab, tab === i ? s.faqTabOn : ""].join(" ")}
                onClick={() => {
                  setTab(i);
                  setOpen(0);
                }}
              >
                <span>{g.label}</span>
                <span className={s.faqCount}>{g.items.length}</span>
              </button>
            ))}
          </div>
          <p className={s.faqNote}>
            Not here? Write to <a href="mailto:hello@hetja.in">hello@hetja.in</a> and a person will answer.
          </p>
        </div>
        <div className={s.faqList} role="tabpanel">
          {items.map((f, i) => (
            <div key={f.q} className={s.faqItem}>
              <button type="button" className={s.faqQ} aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{f.q}</span>
                <span className={s.faqSign} aria-hidden="true">
                  {open === i ? "−" : "+"}
                </span>
              </button>
              {open === i && <div className={s.faqA}>{f.a}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DeskContact(): React.JSX.Element {
  return (
    <div className={d.white}>
      <Aurora variant="contact">
        <div className={`${d.wrap} ${d.halves} ${s.hero}`} style={{ alignItems: "end", paddingBottom: 80 }}>
          <div className={s.head} style={{ gap: 20 }}>
            <h1 className={d.h1}>Write to a person.</h1>
            <a href="mailto:hello@hetja.in" className={s.bigMail}>
              hello@hetja.in
            </a>
            <p className={d.sub}>We read everything. Replies take a day or two, longer in monsoon.</p>
          </div>
          <div className={s.sosNote}>
            <span className={s.bang} aria-hidden="true">
              !
            </span>
            <p>
              For a dog in trouble, don&apos;t email. Scan its collar and press <b>This dog needs help</b>. It alerts the ward&apos;s
              responders directly.
            </p>
          </div>
        </div>
      </Aurora>
      <section className={`${d.wrap} ${s.block} ${s.pad96}`} style={{ paddingBottom: 112 }}>
        <div className={s.head} style={{ maxWidth: 760 }}>
          <p className={d.label}>Partnerships</p>
          <h2 className={d.h2}>Let&apos;s cover more streets together.</h2>
          <p className={d.sub}>
            Hetja works because the people who already run this city&apos;s animal welfare plug into it. The collar programme is
            built to be adopted, not reinvented.
          </p>
        </div>
        <ul className={d.grid3}>
          {PARTNERS.map((p) => (
            <li key={p.title} className={`${d.card} ${d.cardMist}`} style={{ gap: 8 }}>
              <h3 className={d.cardTitle}>{p.title}</h3>
              <p className={d.cardText}>{p.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.contactNote}>
          Tell us your ward, your numbers, and what you&apos;d want to see on a dashboard. Use the address above with
          &quot;partnerships&quot; in the subject, and we&apos;ll take it from there.
        </p>
      </section>
    </div>
  );
}

export function DeskCredits(): React.JSX.Element {
  return (
    <div className={`${d.mist} ${s.creditsPage}`}>
      <section className={s.credits}>
        <Link href="/about" className={d.link}>
          ‹ About
        </Link>
        <h1 className={s.creditsTitle}>Thank you.</h1>
        <p className={d.lead}>
          Hetja was built by a few people and kept alive by many more. Most of them never wrote a line of code. They just kept
          showing up.
        </p>
        <Link href="/hetja" className={s.creditsCard}>
          <span className={s.memMark}>
            <LogoMark size={44} />
          </span>
          <span className={s.creditsCardText}>
            <span className={s.creditsName}>Hetja</span>
            <span className={d.cardText}>Who walked three kilometres in the rain. This is for her.</span>
          </span>
          <span className={s.chev} aria-hidden="true">
            ›
          </span>
        </Link>
        <p className={s.creditsAsk}>
          Helped and not on this page? Write to <a href="mailto:hello@hetja.in">hello@hetja.in</a> and a person will put you here.
        </p>
        <p className={s.small}>Free, open source, built in Mumbai.</p>
      </section>
    </div>
  );
}
