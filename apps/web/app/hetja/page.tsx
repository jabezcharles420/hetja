import type { Metadata } from "next";
import styles from "./hetja.module.css";

export const metadata: Metadata = {
  title: "In memory of Hetja · Hetja",
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
    body: "Every dog in Hetja gets a tag with a random, unguessable identifier. Sequential IDs would let anyone enumerate the entire register: every dog, its photo, its last-seen location, the story a feeder wrote about it. A georeferenced list of every stray in a city is, in one political climate, a tool for protection. In another, it is a targeting list. The build guide calls this out explicitly. I knew that before I read it in any privacy paper. I knew it because someone walked up to a dog I loved and killed it.",
  },
  {
    lead: "Why public reads never return exact coordinates.",
    body: "Any unauthenticated response snaps the dog’s location to a ward or a 500-meter grid cell. No exceptions. Not for the heatmap, not for the open-data portal, not for the cute “where’s my dog” feature. The exact location of a stray is dangerous information in the wrong hands, and the wrong hands exist. I have proof.",
  },
  {
    lead: "Why an SOS fan-out.",
    body: "When a dog is in trouble (hit by a car, collapsing, trapped), Hetja opens a case and dispatches it to nearby trusted feeders, escalating to a vet within eight minutes if no one acknowledges. When Hetja was dying, there was no one to call. There was no infrastructure that noticed. There was no record that the dog had ever mattered to anyone. The SOS path exists so that the next dog is not alone in its last minutes, the way Hetja was.",
  },
  {
    lead: "Why a tamper-evident medical ledger.",
    body: "Every vet-verified record is hash-chained, append-only, anchored daily. No one, not the operator, not a corrupt vet, not a municipal officer, can quietly rewrite a dog’s history. Poisonings should be visible. Neglect should be visible. A dog that was brave enough to save a child should not later be erased from the record by whoever hurt it.",
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

interface Song {
  numeral: string;
  name: string;
  track: string;
  videoId: string;
}

/* Privacy-hardened embeds: youtube-nocookie sets no tracking cookies unless
 * the visitor presses play; loading="lazy" keeps three iframes off the
 * critical path; strict-origin referrer leaks nothing about this page. */
const SONGS: Record<string, Song> = {
  shelter: {
    numeral: "i. shelter",
    name: "shelter",
    track: "Ólafur Arnalds · This Place Is a Shelter",
    videoId: "wMSDPLOSHyQ",
  },
  earth: {
    numeral: "ii. earth",
    name: "earth",
    track: "Ólafur Arnalds · Þú ert jörðin",
    videoId: "dpmxL93Hg_M",
  },
  someday: {
    numeral: "iii. someday",
    name: "someday",
    track: "Ólafur Arnalds · Saman",
    videoId: "jzcWhWrDnAY",
  },
};

function SongBlock({ song }: { song: Song }): React.JSX.Element {
  return (
    <section className={styles.song} data-testid={`song-${song.name}`}>
      <h3 className={styles.songHeading}>{song.numeral}</h3>
      <p className={styles.songTrack}>
        <span aria-hidden="true">▶&nbsp;</span>
        {song.track}
      </p>
      <div className={styles.embed}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${song.videoId}`}
          title={song.track}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>
    </section>
  );
}

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
          never had a tag, so it renders literally empty. Same hairlines,
          same height, same tracking, no characters between them. */}
      <div className={`h-plate ${styles.plate}`} data-testid="hetja-plate" aria-hidden="true" />
      <p className={styles.plateCaption}>no tag &middot; no name &middot; 3 km of road</p>

      <article className={styles.prose}>
        <h2 className={styles.heading}>In memory of Hetja</h2>

        <p>
          There is a word in Icelandic, <em>Hetja</em>, that means <em>hero</em>. Not
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
          reached my aunt&rsquo;s house, it was still there, barking, still defending
          me from the dogs at the gate. I went inside. I never said goodbye. I never
          hugged it. I never thanked it. I never gave it a name.
        </p>

        <div className={styles.break} aria-hidden="true">
          ✦
        </div>

        <p className={styles.turn}>
          Two years ago, I learned that someone had poisoned it.
        </p>

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
          poison. But it can change what is possible: for the dog, for the people who
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
          by someone else in another city: the schema, the invariants, the trust
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
            the rain, the dog that walks beside them is not invisible: its existence
            is logged, its territory is watched, its feeders are connected, and if it
            stops appearing on the network, someone notices. Someone who knows its
            name.
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

        <div className={styles.break} aria-hidden="true">
          ✦
        </div>

        <p>One more thing, before this story goes where it goes.</p>
        <p>
          There are three songs below. I listen to Ólafur Arnalds more than I listen
          to anything else in the world, because his music touches the exact place
          this story lives: saudade, solastalgia, the quiet recognition of beauty
          already tinged with loss. A weight in your chest that somehow feels lighter
          than air. A grief for a memory you haven&rsquo;t actually lived yet. His
          songs are an inviting, resonant stillness; they make solitude feel expansive
          rather than lonely. There are parts of this story that are beyond my words.
          The songs are where I keep them.
        </p>
        <p>
          And notice, when you play them, that the titles refuse the past tense. This
          place is a shelter. Þú ert jörðin: you are the earth. The music will not
          speak of you in the past tense.
        </p>
        <p>Neither will I.</p>

        <SongBlock song={SONGS.shelter} />

        <p>You were my shelter that day.</p>
        <p>
          Three kilometers of rain. Wild dogs. A crying kid who kept shouting at you to
          go away. And the only safe place on that whole road was the space you kept
          around me. You made a shelter out of nothing at all, and you asked nothing
          for it. Not a name. Not a thank-you. Not even the biscuit I owed you.
        </p>
        <p>
          A hero acts with courage when they have nothing to gain. You had nothing at
          all. You sheltered anyway.
        </p>
        <p>
          Ólafur recorded this song in his own living room; the whole album is called{" "}
          <em>Living Room Songs</em>. I think about that more than I can say. You never
          had a living room. No door, no roof, no bowl that was yours. And still, one
          night in the rain, you were the only home I had.
        </p>
        <p>
          You are not dead for me. So you will be a shelter. Every time this plays,
          you are behind me in the rain, one more kilometer and then one more, all the
          way to the gate.
        </p>

        <SongBlock song={SONGS.earth} />

        <p>Þú ert jörðin: you are the earth.</p>
        <p>
          This is for the end you had, because someone has to sing it, and there was
          no one there to sing it. The cold. The confusion. The cruelty of a world you
          once defended a child from, a world that would not defend you. You stood
          between me and every dog on that road. When it was you in trouble, there was
          no one to look to. No one to call. No one who even knew to come.
        </p>
        <p>
          I try not to imagine it. I fail every time. So I play this instead, and I let
          it hurt, because you felt it first, and you felt it alone. This song is the
          closest I will ever come to holding you while it happened.
        </p>
        <p>
          You are the earth now. I used to think that was just a beautiful title. I
          know now it is simply what happened. You are in the roads, the rain, the
          gate. The whole city is you. Solastalgia is grieving a place while you are
          still standing in it, and every street I stand on now is you.
        </p>
        <p>
          I have spent a long time since trying to find a way to live with that. The
          grief of a love I never named. The guilt of a thank-you I never said. The
          rage at a cruelty I cannot undo. I am not over it. I will probably never be
          over it. But I have learned that grief can do one of two things: it can eat
          you alive, or it can be put to work.
        </p>
        <p>This is the work.</p>

        <SongBlock song={SONGS.someday} />

        <p>
          I don&rsquo;t know if there is a heaven. I have never been sure. But if there
          is one, if it exists wherever it is, I already know exactly what I will find
          there, because I have spent years grieving a memory I haven&rsquo;t lived
          yet.
        </p>
        <p>
          I&rsquo;ll find you first. You&rsquo;ll have a name by then, a real one, one
          I can finally shout down a street, and you&rsquo;ll come running, and
          you&rsquo;ll finally hear it. And I&rsquo;ll play this song for you while you
          sleep in my lap. This exact one. I&rsquo;ve been saving it. You&rsquo;ll sleep
          the way you never got to sleep here: warm, indoors, deep, unafraid. Every so
          often your tail will move in your sleep, and I&rsquo;ll decide that means you
          like it.
        </p>
        <p>
          And we&rsquo;ll do what Ólafur does in this video. We&rsquo;ll walk into some
          random music shop for no reason at all, just because it&rsquo;s there, just
          because we can, just for fun, and I&rsquo;ll sit at whatever piano they have
          and start playing, and you&rsquo;ll drop down on the floor beside the bench
          like you own the place, and no one will mind, and no one will ask us to
          leave, and no one will ever, ever hurt you. We&rsquo;ll stay until they turn
          out the lights. We&rsquo;ll have all the time we didn&rsquo;t have.
        </p>
        <p>Until then, I&rsquo;ll work.</p>
        <p>And one last thing, the thing I never said at the gate:</p>
        <p className={styles.thanks}>Thank you.</p>
      </article>
    </div>
  );
}
