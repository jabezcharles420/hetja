import type { Metadata } from "next";
import styles from "./hetja.module.css";

export const metadata: Metadata = {
  title: "In memory of Hetja — Hetja",
  description:
    "Hetja is named for a dog. This is the story of who that dog was, and why the system is built the way it is.",
};

interface Facet {
  lead: string;
  body: string;
}

const FACETS: Facet[] = [
  {
    lead: "Why random slugs, not sequential IDs.",
    body: "Every dog in Hetja gets a tag with a random, unguessable identifier. Sequential IDs would let anyone enumerate the entire register — every dog, its photo, its last-seen location, the story a feeder wrote about it. A georeferenced list of every stray in a city is, in one political climate, a tool for protection. In another, it is a targeting list. The build guide calls this out explicitly. I knew that before I read it in any privacy paper. I knew it because someone walked up to a dog I loved and killed it.",
  },
  {
    lead: "Why public reads never return exact coordinates.",
    body: "Any unauthenticated response snaps the dog’s location to a ward or a 500-meter grid cell. No exceptions. Not for the heatmap, not for the open-data portal, not for the cute “where’s my dog” feature. The exact location of a stray is dangerous information in the wrong hands, and the wrong hands exist. I have proof.",
  },
  {
    lead: "Why an SOS fan-out.",
    body: "When a dog is in trouble — hit by a car, collapsing, trapped — Hetja opens a case and dispatches it to nearby trusted feeders, escalating to a vet within eight minutes if no one acknowledges. When Hetja was dying, there was no one to call. There was no infrastructure that noticed. There was no record that the dog had ever mattered to anyone. The SOS path exists so that the next dog is not alone in its last minutes, the way Hetja was.",
  },
  {
    lead: "Why a tamper-evident medical ledger.",
    body: "Every vet-verified record is hash-chained, append-only, anchored daily. No one — not the operator, not a corrupt vet, not a municipal officer — can quietly rewrite a dog’s history. Poisonings should be visible. Neglect should be visible. A dog that was brave enough to save a child should not later be erased from the record by whoever hurt it.",
  },
  {
    lead: "Why anti-abuse ships before gamification.",
    body: "The build guide is uncompromising on this: anti-abuse ships before badges, before streaks, before leaderboards. This is not a tech-best-practice decision. It is a moral one. The first version of this system that exists in the world must be the version that cannot be turned into a weapon. The badges can wait. The trust engine cannot.",
  },
  {
    lead: "Why no behavioral nudges for minors.",
    body: "A user can declare themselves a minor, and the system suppresses rewards, leaderboards, and sponsored offers for that account. I was a child when I met Hetja. I was a child when I learned it had been killed. Children should be allowed to care about animals without being turned into a growth funnel. Hetja is built by adults who remember being that kid.",
  },
  {
    lead: "Why the dataset is coarsened, even when it costs us.",
    body: "The build guide warns that a georeferenced register of every stray is protective in one political climate and a targeting list in another. Geo-coarsening and a data-custody charter are load-bearing, not compliance theatre. I did not add these features because a lawyer told me to. I added them because I have already lived through the alternative.",
  },
];

export default function HetjaMemorialPage(): React.JSX.Element {
  return (
    <div className={`${styles.page} ${styles.fade}`}>
      <header className={styles.masthead}>
        <p className={styles.word} data-testid="hetja-word">
          Hetja
        </p>
        <p className={styles.ipa}>/ˈhɛtja/&nbsp;&nbsp;Icelandic, noun</p>
        <p className={styles.definition} data-testid="hetja-definition">
          hero
        </p>
      </header>

      {/* The signature element, inverted: every dog gets this plate. Hetja
          never had a tag, so it renders literally empty — same hairlines,
          same height, same tracking, no characters between them. */}
      <div className={`h-plate ${styles.plate}`} data-testid="hetja-plate" aria-hidden="true" />
      <p className={styles.plateCaption}>no tag &middot; no name &middot; 2 km of road</p>

      <article className={styles.prose}>
        <h2 className={styles.heading}>In memory of Hetja</h2>

        <p>
          There is a word in Icelandic — <em>Hetja</em> — that means <em>hero</em>. Not
          the metaphorical kind. The literal kind. A hero is someone who chooses to act
          with courage when they have nothing to gain and everything to lose. This is
          the story of a dog who earned that word, and the long, guilty silence that
          followed.
        </p>
        <p>
          Years ago, when I was a child fleeing an abusive home, I walked three
          kilometers through the rain to my aunt&rsquo;s house. I was crying. The road
          was full of wild dogs. I was a city kid in a place I did not know, and I was
          certain I was going to be hurt.
        </p>
        <p>
          There was a stray I had sometimes fed a biscuit or two. Stray dogs usually do
          not leave their perimeter. This one did. It sensed me, somehow, through the
          rain and the dark, and it followed. I told it to go away. I shouted at it to
          go away. It would not. It walked behind me for the entire three kilometers.
          When we encountered wild dogs on the road, it barked them down, one after
          another, and stood between me and them until I was safe. By the time I
          reached my aunt&rsquo;s house, it was still there — barking, still defending
          me from the dogs at the gate. I went inside. I never said goodbye. I never
          hugged it. I never thanked it. I never gave it a name.
        </p>
        <p>Two years ago, I learned that someone had poisoned it.</p>
        <p>
          I have spent a long time since trying to find a way to live with that. The
          grief of a love I never named. The guilt of a thank-you I never said. The
          rage at a cruelty I cannot undo. I am not over it. I will probably never be
          over it. But I have learned that grief can do one of two things: it can eat
          you alive, or it can be put to work.
        </p>
        <p>This is the work.</p>

        <h2 className={styles.heading}>Why I built Hetja</h2>

        <p>
          Hetja is not a &ldquo;dog app.&rdquo; It is not a feed-tracking tool or a
          cute heatmap. It is a piece of infrastructure for keeping stray dogs alive in
          a city that does not, on the whole, value them. Every architectural decision
          in this system traces back to a single dog who did not survive a city like
          that.
        </p>
        <p>
          When I started designing Hetja, I tried to imagine what would have been
          different if Hetja had lived inside it. The answer is not
          &ldquo;everything.&rdquo; A piece of software cannot stop a cruel person with
          poison. But it can change what is possible — for the dog, for the people who
          care about the dog, and for the people who would hurt the dog.
        </p>
        <p>That is why the system is built the way it is.</p>

        {FACETS.map((facet) => (
          <div className={styles.facet} key={facet.lead}>
            <p>
              <strong>{facet.lead}</strong> {facet.body}
            </p>
          </div>
        ))}

        <h2 className={styles.heading}>Why it is open source</h2>

        <p>Hetja is open source, and it will stay that way.</p>
        <p>
          A system that holds a register of every stray dog in a city should not be a
          black box, and it should not be owned. Anyone can read the code that decides
          how a dog&rsquo;s location is coarsened, how a report is escalated, and what
          a stranger is allowed to see. If we ever got any of that wrong, it should be
          possible for someone outside this project to prove it.
        </p>
        <p>
          It also means this does not die with us. If this project runs out of money,
          or I stop, or the servers go dark, the whole thing can be picked up and run
          by someone else in another city — the schema, the invariants, the trust
          engine, all of it. A city that wants this should not have to ask permission
          or wait for a company to decide it is a market.
        </p>
        <p>
          There is a harder reason too. The most dangerous thing here is the data, not
          the code. Publishing the code is how we make the promises checkable: the
          random slugs, the ward-level coordinates, the append-only ledger, the refusal
          to nudge children. Those are not features we are marketing. They are
          commitments, and open source is what turns a commitment into something you
          can audit instead of something you have to trust.
        </p>
        <p>Fork it. Run it in your city. Tell us what we got wrong.</p>

        <div className={styles.facet}>
          <p>
            I do not believe that building Hetja brings Hetja back. I do not believe
            it pays any debt. You cannot repay a love that pure; everything afterward
            feels thin by comparison. You can only carry it forward.
          </p>
          <p>
            What I can do is make it harder for the next cruel person to find the next
            brave dog. I can make sure that when the next child runs down a road in
            the rain, the dog that walks beside them is not invisible — that its
            existence is logged, its territory is watched, its feeders are connected,
            and if it stops appearing on the network, someone notices. Someone who
            knows its name.
          </p>
          <p>
            <em>Hetja</em> means <em>hero</em>. It is the name I should have given that
            dog when it was alive. It is the name I am giving it now, written into the
            architecture of a system that exists because of it, and that will outlast
            me.
          </p>
          <p>
            I could not save you. I am sorry. I will spend the rest of my life making
            sure the next one makes it home.
          </p>
        </div>
      </article>
    </div>
  );
}
