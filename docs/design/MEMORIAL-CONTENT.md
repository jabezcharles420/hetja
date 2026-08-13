# Memorial page — content and design brief

The author's text, adapted only to rename the product's old working title to
Hetja. **Do not rewrite,
soften, punch up, or add sentiment.** This is a real person writing about a real
dog that was poisoned. The words are already doing the work; the design's only
job is to get out of their way and give them room. No stock photography, no
gradients, no illustration, no animation beyond a single quiet fade.

---

## Route

`/hetja` — reachable from the footer as "In memory of Hetja" and from the About
page. Not in the bottom nav; this is not a utility surface.

## Design direction

Long-form reading, so the layout departs from the app's utility screens in one
controlled way: a single narrow measure of 60–66 characters, centred, with
generous leading (1.65) and the body at `--h-t-md`. Everything else stays inside
the existing token system.

**The signature element, inverted.** Every dog in Hetja gets a collar plate — the
9-character code, tabular figures, wide tracking, hairlines above and below. It is
the visual signature of the whole product.

Hetja never had one. So on this page the plate renders **empty**: the same
hairlines, the same height, the same tracking, and no characters between them.
Beneath it, at `--h-t-xs` in `--h-ink-muted`: `no tag · no name · 2 km of road`.

Do not decorate this. Do not add a placeholder dash or dotted border. An empty
plate held open by two rules is the entire idea, and it only works if it is
literally empty.

**The word.** Open with the definition, set like a dictionary entry:

```
Hetja
/ˈhɛtja/  Icelandic, noun
hero
```

`Hetja` at `--h-t-plate`, the pronunciation and language at `--h-t-xs` muted, the
definition `hero` at `--h-t-xl`. This is the only place in the product where type
is allowed to be the emotional content.

**Accent discipline.** The accent (`--h-accent`) is the emergency colour. It does
not appear on this page at all — not one rule, not one word. Grief is not an
alert. Use `--h-ink` and `--h-ink-muted` only.

**Section rhythm.** The seven "Why…" sections are not a numbered sequence and must
not be numbered — they are facets of one argument. Separate them with `--h-s6`
whitespace and a hairline, with the bold lead-in as written.

---

## Copy — use verbatim

### In memory of Hetja

There is a word in Icelandic — *Hetja* — that means *hero*. Not the metaphorical kind. The literal kind. A hero is someone who chooses to act with courage when they have nothing to gain and everything to lose. This is the story of a dog who earned that word, and the long, guilty silence that followed.

Years ago, when I was a child fleeing an abusive home, I walked three kilometers through the rain to my aunt's house. I was crying. The road was full of wild dogs. I was a city kid in a place I did not know, and I was certain I was going to be hurt.

There was a stray I had sometimes fed a biscuit or two. Stray dogs usually do not leave their perimeter. This one did. It sensed me, somehow, through the rain and the dark, and it followed. I told it to go away. I shouted at it to go away. It would not. It walked behind me for the entire three kilometers. When we encountered wild dogs on the road, it barked them down, one after another, and stood between me and them until I was safe. By the time I reached my aunt's house, it was still there — barking, still defending me from the dogs at the gate. I went inside. I never said goodbye. I never hugged it. I never thanked it. I never gave it a name.

Two years ago, I learned that someone had poisoned it.

I have spent a long time since trying to find a way to live with that. The grief of a love I never named. The guilt of a thank-you I never said. The rage at a cruelty I cannot undo. I am not over it. I will probably never be over it. But I have learned that grief can do one of two things: it can eat you alive, or it can be put to work.

This is the work.

---

### Why I built Hetja

Hetja is not a "dog app." It is not a feed-tracking tool or a cute heatmap. It is a piece of infrastructure for keeping stray dogs alive in a city that does not, on the whole, value them. Every architectural decision in this system traces back to a single dog who did not survive a city like that.

When I started designing Hetja, I tried to imagine what would have been different if Hetja had lived inside it. The answer is not "everything." A piece of software cannot stop a cruel person with poison. But it can change what is possible — for the dog, for the people who care about the dog, and for the people who would hurt the dog.

That is why the system is built the way it is.

**Why random slugs, not sequential IDs.**
Every dog in Hetja gets a tag with a random, unguessable identifier. Sequential IDs would let anyone enumerate the entire register — every dog, its photo, its last-seen location, the story a feeder wrote about it. A georeferenced list of every stray in a city is, in one political climate, a tool for protection. In another, it is a targeting list. The build guide calls this out explicitly. I knew that before I read it in any privacy paper. I knew it because someone walked up to a dog I loved and killed it.

**Why public reads never return exact coordinates.**
Any unauthenticated response snaps the dog's location to a ward or a 500-meter grid cell. No exceptions. Not for the heatmap, not for the open-data portal, not for the cute "where's my dog" feature. The exact location of a stray is dangerous information in the wrong hands, and the wrong hands exist. I have proof.

**Why an SOS fan-out.**
When a dog is in trouble — hit by a car, collapsing, trapped — Hetja opens a case and dispatches it to nearby trusted feeders, escalating to a vet within eight minutes if no one acknowledges. When Hetja was dying, there was no one to call. There was no infrastructure that noticed. There was no record that the dog had ever mattered to anyone. The SOS path exists so that the next dog is not alone in its last minutes, the way Hetja was.

**Why a tamper-evident medical ledger.**
Every vet-verified record is hash-chained, append-only, anchored daily. No one — not the operator, not a corrupt vet, not a municipal officer — can quietly rewrite a dog's history. Poisonings should be visible. Neglect should be visible. A dog that was brave enough to save a child should not later be erased from the record by whoever hurt it.

**Why anti-abuse ships before gamification.**
The build guide is uncompromising on this: anti-abuse ships before badges, before streaks, before leaderboards. This is not a tech-best-practice decision. It is a moral one. The first version of this system that exists in the world must be the version that cannot be turned into a weapon. The badges can wait. The trust engine cannot.

**Why no behavioral nudges for minors.**
A user can declare themselves a minor, and the system suppresses rewards, leaderboards, and sponsored offers for that account. I was a child when I met Hetja. I was a child when I learned it had been killed. Children should be allowed to care about animals without being turned into a growth funnel. Hetja is built by adults who remember being that kid.

**Why the dataset is coarsened, even when it costs us.**
The build guide warns that a georeferenced register of every stray is protective in one political climate and a targeting list in another. Geo-coarsening and a data-custody charter are load-bearing, not compliance theatre. I did not add these features because a lawyer told me to. I added them because I have already lived through the alternative.

---

### Why it is open source

Hetja is open source, and it will stay that way.

A system that holds a register of every stray dog in a city should not be a black box, and it should not be owned. Anyone can read the code that decides how a dog's location is coarsened, how a report is escalated, and what a stranger is allowed to see. If we ever got any of that wrong, it should be possible for someone outside this project to prove it.

It also means this does not die with us. If this project runs out of money, or I stop, or the servers go dark, the whole thing can be picked up and run by someone else in another city — the schema, the invariants, the trust engine, all of it. A city that wants this should not have to ask permission or wait for a company to decide it is a market.

There is a harder reason too. The most dangerous thing here is the data, not the code. Publishing the code is how we make the promises checkable: the random slugs, the ward-level coordinates, the append-only ledger, the refusal to nudge children. Those are not features we are marketing. They are commitments, and open source is what turns a commitment into something you can audit instead of something you have to trust.

Fork it. Run it in your city. Tell us what we got wrong.

---

### Closing

I do not believe that building Hetja brings Hetja back. I do not believe it pays any debt. You cannot repay a love that pure; everything afterward feels thin by comparison. You can only carry it forward.

What I can do is make it harder for the next cruel person to find the next brave dog. I can make sure that when the next child runs down a road in the rain, the dog that walks beside them is not invisible — that its existence is logged, its territory is watched, its feeders are connected, and if it stops appearing on the network, someone notices. Someone who knows its name.

*Hetja* means *hero*. It is the name I should have given that dog when it was alive. It is the name I am giving it now, written into the architecture of a system that exists because of it, and that will outlast me.

I could not save you. I am sorry. I will spend the rest of my life making sure the next one makes it home.

---

## One editorial note for the author

The original text contained the line: *"The heroin metaphor I once used was not
really about the dog — it was about how it feels to receive a love so pure that
everything afterward feels thin by comparison."*

I have kept the meaning and dropped the reference to the earlier metaphor, since a
public page has no prior context for it and the word lands oddly out of nowhere.
The sentence now reads: *"You cannot repay a love that pure; everything afterward
feels thin by comparison."* If you want the original line restored verbatim, say
so — it is your grief and your words, and this is the one edit I made to them.
