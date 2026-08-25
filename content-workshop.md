# content workshop · matthew jamison epk

Your words, your page. Every visible string on the site is below, in page order.

**How this works:**
- Each slot shows the current copy (`> current:`) as reference. Write your version between `<!-- WRITE BELOW -->` and `<!-- END -->`.
- **Blank = keep what's there.** Work in passes; fill only what you want to change. Nothing is required.
- Grouped slots (lists) — rewrite any line, leave the rest. A line left exactly as-is = keep.
- You can use `*italics*` and `` `code` `` — they become `<em>` and `<code>` on the page.
- `> current:` shows raw source text, so you'll see things like `&amp;` (an `&`), `&nbsp;·&nbsp;` (the ` · ` separators), and `&#8209;` (a non-breaking hyphen). Write plainly — `&`, `·`, `-` — escaping is handled for you.
- Don't edit the `<!-- slot:... -->` comments or the markers — they're how your words find their way home.
- Save, close, then tell Claude: **"apply the workshop"**. Words land verbatim; anything Claude notices (typo suspects, fact conflicts, accessibility) gets flagged afterward for you to decide — never silently changed.

---

## url bar

<!-- slot:urlbar.comment file:index.html -->
### url bar · comment line

> current:
> // matthew jamison &nbsp;·&nbsp; epk &nbsp;·&nbsp; 2026

<!-- WRITE BELOW -->
// Matthew Jamison &nbsp;·&nbsp; EPK &nbsp;·&nbsp; 2026
<!-- END -->

---

## nav

<!-- slot:nav.links file:index.html type:grouped -->
### nav · links (one per line)

> current:
> catalog
> bio
> watch
> rider
> press
> services
> contact

<!-- WRITE BELOW -->
Catalog
Bio
Watch
Gear
Press
Services
Contact
<!-- END -->

---

## hero

<!-- slot:hero.h1 file:index.html -->
### hero · name (h1)

> current:
> matthew jamison

<!-- WRITE BELOW -->

Matthew Jamison { _wwjd_ }
<!-- END -->

<!-- slot:hero.tags file:index.html type:grouped -->
### hero · tag line (three fragments, one per line)

> current:
> st. louis, mo
> instrumental hip-hop
> sp-404 a

<!-- WRITE BELOW -->
St. Louis, MO 
modus operandi is an amalgam
6-string MTD Maple Bass
<!-- END -->

<!-- slot:hero.mantra file:index.html type:grouped -->
### hero · mantra (three lines)

> current:
> // a vessel
> grateful for expression
> healing-state

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:hero.links file:index.html type:grouped -->
### hero · buttons (one per line)

> current:
> → bandcamp
> → booking

<!-- WRITE BELOW -->

<!-- END -->

---

## stats

<!-- slot:stats.cells file:index.html type:grouped -->
### stats · three cells (format: `value — label`, one per line)

> current:
> 30+ — releases
> 2018 — started
> STL — base

<!-- WRITE BELOW -->
30+ — releases
2015 — started
STL — home
<!-- END -->

---

## catalog

<!-- slot:catalog.label file:index.html -->
### catalog · section label

> current:
> // catalog &nbsp;·&nbsp; matthewjjamison.bandcamp.com

<!-- WRITE BELOW -->
// production-catalog &nbsp;·&nbsp; matthewjjamison.bandcamp.com
<!-- END -->

<!-- slot:catalog.tiles file:index.html type:grouped -->
### catalog · tile names (30, one per line — these are your release titles; leave as-is unless renaming a display label)

> current:
> it is what it is
> grace alone
> shoot the j
> space 2 be
> ryokō
> jeremiah 29:11
> bojji's resolve
> perspective
> perspectives pt.1
> sp ep: the next chapter
> hallelujah
> the journey
> perspective  ← (second one — the original album)
> (noh)_talent
> ball so hard
> we got the keys
> bando (edit)
> beat tape #2
> beat tape #1
> hold on be strong (edit)
> dangerous (busta edit)
> the blessing
> wedobeatschallenge #9
> love bounce
> twice (edit)
> black is beautiful
> black vegas
> sorbet
> sideshow
> new start

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:catalog.morebtn file:index.html -->
### catalog · expand button

> current:
> → full catalog &nbsp;·&nbsp; 30 releases

<!-- WRITE BELOW -->

<!-- END -->

---

## bio

<!-- slot:bio.label file:index.html -->
### bio · section label

> current:
> // bio

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:bio.tabs file:index.html type:grouped -->
### bio · tab labels (one per line)

> current:
> short
> medium
> long

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:bio.short.p1 file:index.html -->
### bio — short · paragraph 1

> current:
> St. Louis. I grew up in the church; bongos &amp; auxiliary percussion at Ezekiel Temple, then drums, then bass, then the SP&#8209;404 A.

<!-- WRITE BELOW -->
Raised C.O.G.I.C. ! Started playing with the auxiliary percussion with the band at Ezekiel Temple, then drums, then bass guitar, then producing & eventually being blessed with an SP&#8209;404 A by a brother in the faith.
<!-- END -->

<!-- slot:bio.short.p2 file:index.html -->
### bio — short · paragraph 2

> current:
> The music was how I used to mark time — thirty releases, timestamps, expressions along the way, because I can forget just <em>how much</em> God has brought me from &amp; taught me.

<!-- WRITE BELOW -->
Each song is a timestamp from a different season of my life. These audio imprints are reminders of just <em>how much</em> God has been with me every step of the way.
<!-- END -->

<!-- slot:bio.short.p3 file:index.html -->
### bio — short · paragraph 3

> current:
> Session bass on an MTD 6-string. Rails by day. Live, no laptop, no undo.

<!-- WRITE BELOW -->
full-stack software developer during work hours, and full-time husband and father of the most amazing humans I've ever met!
<!-- END -->

<!-- slot:bio.short.p4 file:index.html -->
### bio — short · paragraph 4

> current:
> I'm not who I am without the gift of faith I was bestowed or without Berneshia &amp; our daughters.

<!-- WRITE BELOW -->
Immense gratitude for the responsibility and ministry bestowed on me.
<!-- END -->

<!-- slot:bio.medium.p1 file:index.html -->
### bio — medium · paragraph 1

> current:
> I grew up in St. Louis, in the church. My dad, Minister Wells W. Jamison, served at Ezekiel Temple C.O.G.I.C. They didn't let me play drums often there; they let me play bongos &amp; auxiliary percussion, and that was a blessing. Concert band, drumline, bass guitar, bands around the city. I knew how music felt long before I touched an SP&#8209;404 A.

<!-- WRITE BELOW -->
Only child to Minister Wells W. Jamison & Antoinette Jamison, who served at Ezekiel Temple C.O.G.I.C. 
I was a goof who didn't have rhythm yet. However, they did allow me to play bongos &amp; auxiliary percussion; that was a blessing!
From there, I took drum lessons, joined concert band, corps-style drumline, started playing bass guitar with bands around STL. 
Music will take you on a journey!
<!-- END -->

<!-- slot:bio.medium.p2 file:index.html -->
### bio — medium · paragraph 2

> current:
> The music was how I used to mark time. <em>the journey</em> (2022), <em>shoot the j</em> (2024, every track title real Ruby or SQL), and the releases between them are timestamps — expressions along the way, because I can forget just <em>how much</em> God has brought me from &amp; taught me.

<!-- WRITE BELOW -->
Each song is a timestamp from a different season of my life. These audio imprints are reminders of just <em>how much</em> God has been with me every step of the way.
<!-- END -->

<!-- slot:bio.medium.p3 file:index.html -->
### bio — medium · paragraph 3

> current:
> In 2020 I joined Sidechain Society and started my LLC. In 2022 I learned to code through LaunchCode; now I build Rails apps at Concordia Publishing House. On stage it's the SP-404 A with no laptop, or an MTD 6-string with a looper, arranging in real time.

<!-- WRITE BELOW -->
In 2020, I started pursuing music full-time. I started a music company, Matthew Jamison Music, LLC, and entered a couple of sync-libraries. 
I quickly learned that a music income wasn't <em>stable enough</em> to provide for a family of 4. I learned to code through a local bootcamp (LaunchCode); now I work on rails apps for a living.
<!-- END -->

<!-- slot:bio.medium.p4 file:index.html -->
### bio — medium · paragraph 4

> current:
> Home answers first. Berneshia, God's daughter &amp; my best friend, ministers at Refresh Community Church; our girls are 17 &amp; 10, and they're sweeties! I'm not who I am without the gift of faith I was bestowed or without them.

<!-- WRITE BELOW -->
If you didn't know my best friend, wife, and favorite human, Bernie J, is a women's minister at Refresh Community Church; our daughters are 17 y/o & 10 y/o. I wouldn't be who I am today if it weren't for these beautiful humans.
<!-- END -->

<!-- slot:bio.long.p1 file:index.html -->
### bio — long · paragraph 1

> current:
> I grew up in St. Louis, in the church. My dad, Minister Wells W. Jamison, served at Ezekiel Temple C.O.G.I.C. They didn't let me play drums often at Ezekiel Temple; I didn't have the syncopation yet to hold down a rhythm section. They let me play bongos &amp; auxiliary percussion, and that was a blessing. Concert band. Drumline. Bass guitar. Bands around the city.

<!-- WRITE BELOW -->
Only child to Minister Wells W. Jamison & Antoinette Jamison, who served at Ezekiel Temple C.O.G.I.C. 
I was a goof who didn't have rhythm yet. However, they did allow me to play bongos &amp; auxiliary percussion; that was a blessing!
From there, I took drum lessons, joined concert band, corps-style drumline, started playing bass guitar with bands around STL. 
Music will take you on a journey!
<!-- END -->

<!-- slot:bio.long.p2 file:index.html -->
### bio — long · paragraph 2

> current:
> The music was how I used to mark time. Thirty releases on Bandcamp — timestamps, expressions along the way, because I can forget just <em>how much</em> God has brought me from &amp; taught me. <em>the journey</em> (January 2022) is fifty-six tracks of exactly that. <em>shoot the j</em> (2024) came after I learned to code: every track title is actual Ruby, Rails, or SQL syntax. <code>validates :love, presence: true</code>. <code>love.nil?</code>.

<!-- WRITE BELOW -->
Each song is a timestamp from a different season of my life. These audio imprints are reminders of just <em>how much</em> God has been with me every step of the way.
<!-- END -->

<!-- slot:bio.long.p3 file:index.html -->
### bio — long · paragraph 3

> current:
> The résumé stuff: Sidechain Society since 2020. LaunchCode in 2022. Rails developer at Concordia Publishing House, 229 merged PRs. Session bass on an MTD 6-string maple with a looper pedal, arranging in real time. On stage there's no laptop and no undo; you just flow.

<!-- WRITE BELOW -->
n 2020, I started pursuing music full-time. I started a music company, Matthew Jamison Music, LLC, and entered a couple of sync-libraries. 
I quickly learned that a music income wasn't <em>stable enough</em> to provide for a family of 4. I learned to code through a local bootcamp (LaunchCode); now I work on rails apps for a living.
<!-- END -->

<!-- slot:bio.long.p4 file:index.html -->
### bio — long · paragraph 4

> current:
> Home is the first calling. Berneshia, God's daughter &amp; my best friend, ministers at Refresh Community Church. Our daughters are 17 &amp; 10, and they're sweeties!

<!-- WRITE BELOW -->
If you didn't know my best friend, wife, and favorite human, Bernie J, is a women's minister at Refresh Community Church; our daughters are 17 y/o & 10 y/o.
<!-- END -->

<!-- slot:bio.long.p5 file:index.html -->
### bio — long · paragraph 5

> current:
> I'm not who I am without the gift of faith I was bestowed or without Berneshia &amp; our daughters.

<!-- WRITE BELOW -->
I wouldn't be who I am today if it weren't for these beautiful humans.
<!-- END -->

---

## process

<!-- slot:process.label file:index.html -->
### process · section label

> current:
> // why the beats sound like this

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:process.text file:index.html -->
### process · full text (line breaks are kept exactly as you write them)

> current:
> These moments are honestly conversations I was having within myself,
> and wrestling with emotions, trauma, and limitations
>
> when I was making each track,
> it was as if I wasn't alone in any of it
>
> it felt as if God was giving me ideas as I explored and created in these sandboxes of sound
>
> creation for creation's sake
> still healing

<!-- WRITE BELOW -->

<!-- END -->

---

## watch

<!-- slot:watch.label file:index.html -->
### watch · section label

> current:
> // watch &nbsp;·&nbsp; sp-404 a &nbsp;·&nbsp; mtd bass

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:watch.caption1 file:index.html type:grouped -->
### watch · left video caption (three fragments, one per line)

> current:
> sp-404 a
> continuous live set
> st. louis, mo

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:watch.caption2 file:index.html type:grouped occurrence-note:"sp-404 a" is the 2nd caption span -->
### watch · right video caption (three fragments, one per line)

> current:
> sp-404 a
> mtd bass
> sidechain society

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:watch.note file:index.html -->
### watch · closing note

> current:
> // also live: mtd 6-string maple bass + looper sfx pedal &nbsp;·&nbsp; real-time arranging

<!-- WRITE BELOW -->

<!-- END -->

---

## services

<!-- slot:services.label file:index.html -->
### services · section label

> current:
> // services

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:services.body file:index.html type:grouped -->
### services · body (one line per fragment; arrows are added by the page, don't type them)

> current:
> need a website? i got you.
> consulting: $95 / hr
> full builds — domain, seo + aeo — email for quote
> session bass
> $350 — full session (4 songs, 3–5 min each)
> $100 — single bass line (up to 7 min)
> songs over length are charged extra
> live: mtd 6-string maple bass + looper sfx pedal
> real-time arranging
> available alongside sp-404 a sets or standalone
> inquiry
> jamison.matthew@icloud.com  ← (link text)
> github
> MatthewJamisonJS  ← (link text)

<!-- WRITE BELOW -->
need a website? i got you.
consulting: $95 / hr
full builds — software integrations — email for quote
session bass
$350 — full session (4 songs, 3–5 min each)
$150 — single bass line (up to 7 min)
songs over length are charged extra
live bassist: mtd 6-string maple bass + looper sfx pedal
real-time arranging
available alongside sp-404 a sets or standalone
inquiry
matthewjamisonmusicinquiries@gmail.com  ← (link text)
github
MatthewJamisonJS  ← (link text)
<!-- END -->

---

## rider

<!-- slot:rider.label file:index.html -->
### rider · section label

> current:
> // gear + rider &nbsp;·&nbsp; sp-404 a

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:rider.inputs file:index.html type:grouped -->
### rider · "input list" (first line = column heading, rest = items)

> current:
> input list
> 2× ¼" ts outputs from sp-404 a stereo main outs (l + r — no mono summing)
> 1× monitor wedge or iem — stereo mix of sp-404 a output
> 1× standard power outlet at table (sp-404 a can also run on batteries as backup)
> if bass set: 1× di box or ¼" bass input &nbsp;·&nbsp; 1× monitor for bass mix — confirm at booking

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:rider.stage file:index.html type:grouped -->
### rider · "stage needs" (first line = column heading, rest = items)

> current:
> stage needs
> 1× 6-foot table at standing height (~42") — riser, hard case, or crate if venue tables are waist-high
> set length: 15–30 min, adaptable
> continuous — no breaks between tracks

<!-- WRITE BELOW -->
stage needs
1× chair
set length: 15–30 min, adaptable,
continuous — no breaks between tracks
<!-- END -->

<!-- slot:rider.brings file:index.html type:grouped -->
### rider · "what matthew brings" (first line = column heading, rest = items)

> current:
> what matthew brings
> roland sp-404 a (self-provided — the original, not the mkii)
> no laptop
> no mixer or interface needed from venue
> the machine is the stage plot
> mtd 6-string maple bass (available — confirm at booking)
> looper sfx pedal (when bass is part of the set)

<!-- WRITE BELOW -->
what matthew brings
roland sp-404 a
looper sfx pedal (when bass is part of the set)
mtd 6-string maple bass (available — confirm at booking)
<!-- END -->

<!-- slot:rider.doesntneed file:index.html type:grouped -->
### rider · "what matthew doesn't need" (first line = column heading, rest = items)

> current:
> what matthew doesn't need
> backline
> an intro
> more than one outlet

<!-- WRITE BELOW -->
what matthew doesn't need

<!-- END -->

---

## press

<!-- slot:press.label file:index.html -->
### press · section label

> current:
> // press

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:press.source file:index.html -->
### press · feature source line

> current:
> // voyagestl magazine &nbsp;·&nbsp; august 2024

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:press.quote file:index.html -->
### press · pull quote

> current:
> "when I make music, it's genuine."

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:press.link file:index.html -->
### press · feature link text

> current:
> → read the feature

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:press.inquiries file:index.html type:grouped -->
### press · inquiries block (three lines: label, offer line, email link text)

> current:
> // press inquiries
> hi-res photos &nbsp;·&nbsp; interview available &nbsp;·&nbsp; press kit on request
> → matthewjamisonmusicinquiries@gmail.com

<!-- WRITE BELOW -->

<!-- END -->

---

## contact

<!-- slot:contact.label file:index.html -->
### contact · section label

> current:
> // contact

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:contact.rows file:index.html type:grouped -->
### contact · rows (format: `label → link text`, one per line)

> current:
> booking + press → matthewjamisonmusicinquiries@gmail.com
> music → matthewjjamison.bandcamp.com
> github → MatthewJamisonJS
> substack → still processing
> youtube → @mjamison2802
> streaming → spotify · apple music · soundcloud

<!-- WRITE BELOW -->

<!-- END -->

---

## footer

<!-- slot:footer.peace file:index.html -->
### footer · peace line

> current:
> peace and long life to you and yours🖖🏿🤎

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:footer.links file:index.html type:grouped -->
### footer · links (one per line)

> current:
> bandcamp
> github
> substack

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:footer.copy file:index.html occurrence:2 -->
### footer · copyright line

> current:
> matthew jamison &nbsp;·&nbsp; epk &nbsp;·&nbsp; 2026

<!-- WRITE BELOW -->

<!-- END -->

---

## appendix · invisible strings (opt-in — these aren't on the page, but search engines and link previews read them; fill only if you want them changed)

<!-- slot:meta.title file:index.html -->
### browser tab title

> current:
> matthew jamison · epk

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:meta.description file:index.html -->
### search-result description

> current:
> matthew jamison · st. louis instrumental hip-hop producer · sp-404 a performer · 30+ releases on bandcamp

<!-- WRITE BELOW -->
matthew jamison · st. louis instrumental music producer · 6-string MTD bass · sp-404 a performer · 30+ releases on bandcamp
<!-- END -->

<!-- slot:meta.og file:index.html type:grouped -->
### link-preview card (title, then description — what shows when the link is shared)

> current:
> matthew jamison · epk
> st. louis. instrumental hip-hop. sp-404 a. 30+ releases.

<!-- WRITE BELOW -->
matthew jamison · epk
STL instrumental music artist · 6-string MTD bass · sp-404
<!-- END -->

---

*that's every string. write when ready — blank slots stay exactly as they are.*

---

# addendum · the store (aug 2026)

Every string below is a placeholder, written only so the page isn't blank.
The catalog is a store now: preview player, buy button, no Bandcamp.
Same rules as above — blank slot = keep what's there.

---

## store · section + grid

<!-- slot:store.label file:index.html -->
### store · section label (this replaced the old bandcamp line)

**⚠ needs your words:** the site now streams full tracks lossless (not previews), so "preview before you buy" is out of date. Something in the "stream free, buy to own" direction — your phrasing.

> current:
> // store &nbsp;·&nbsp; 30 releases &nbsp;·&nbsp; preview before you buy

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:store.buy file:index.html occurrence:all -->
### store · buy button (one string, used on all 30 cards)

> current:
> → buy

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:store.price file:index.html type:grouped -->
### store · the price line under each title (kind · price — three variants, one per release type)

> current:
> single &nbsp;·&nbsp; $2.99
> ep &nbsp;·&nbsp; $5.99
> album &nbsp;·&nbsp; $9.99

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:store.terms file:index.html -->
### store · the line under the grid about refunds

> current:
> // all sales final; if your files didn't arrive, email me and I'll make it right

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:store.expand file:index.html occurrence:2 -->
### store · the show-more button (and what it says once opened)

> current:
> → full catalog &nbsp;·&nbsp; 30 releases
> → show fewer

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:hero.storelink file:index.html -->
### hero · the first button (was "→ bandcamp", now points at the store on this page)

> current:
> → store

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:contact.music file:index.html -->
### contact · the "music" row (was the bandcamp address)

> current:
> buy direct on this page

<!-- WRITE BELOW -->

<!-- END -->

---

## store · the player

The player is one bar that sits at the bottom of the store while you browse it.
It only appears once something is playing.

<!-- slot:player.label file:index.html -->
### player · the bar's heading

> current:
> // now playing

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:player.buttons file:index.html type:grouped -->
### player · what the buttons say to a screen reader (the visible controls are symbols)

> current:
> play preview of [release name]
> pause preview of [release name]
> previous track
> resume preview
> pause preview
> next track
> seek within track
> stop preview

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:store.errors file:script.js type:grouped -->
### store · the two things the page says when something goes wrong

**⚠ needs your words:** line 2 says "preview" but the player now streams full tracks — worth rewording when you do a pass.

> current:
> checkout didn't open. try again, or email matthewjamisonmusicinquiries@gmail.com
> that preview didn't load. try again in a moment.

<!-- WRITE BELOW -->

<!-- END -->

---

## thanks page (/thanks/) — where stripe sends people after they pay

<!-- slot:thanks.heading file:thanks/index.html -->
### thanks · heading — **your words, already landed verbatim (aug 2026)**

> current:
> Thank you for supporting! May the Lord bless and give peace to you & your family!

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:thanks.body file:thanks/index.html type:grouped -->
### thanks · the body (first line, then the two arrow lines)

> current:
> your download link is on its way to the email you gave stripe.
> check spam and promotions if it isn't there in a few minutes
> if it never shows, email matthewjamisonmusicinquiries@gmail.com and i'll send it

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:thanks.back file:thanks/index.html -->
### thanks · the button back to the site

> current:
> → back to the store

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:thanks.title file:thanks/index.html -->
### thanks · browser tab title

> current:
> thanks · matthew jamison

<!-- WRITE BELOW -->

<!-- END -->

---

## games (new section — added 2026-08-25; real games land after your words do)

<!-- slot:games.label file:index.html -->
### games · section label (the `// comment` line)

> current:
> // games &nbsp;·&nbsp; free &nbsp;·&nbsp; in-browser

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.dialog.q file:index.html -->
### games · keep-listening dialog — the question

Shows when you open a game while one of your tracks is playing.

> current:
> // keep listening?

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.dialog.note file:index.html -->
### games · keep-listening dialog — the explainer line

> current:
> keep your track playing and the game runs silent — or pause it and hear the game.

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.dialog.buttons file:index.html type:grouped -->
### games · keep-listening dialog — the two buttons (one per line)

> current:
> → keep my music
> → game audio

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.error.text file:index.html -->
### games · when a game fails to load

> current:
> the game didn't load.

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.error.buttons file:index.html type:grouped -->
### games · load-error buttons (one per line)

> current:
> → retry
> → back to the page

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.intro file:index.html occurrence-note:"does not exist yet — write it and it gets added as an intro line under the section label; blank = no intro line at all" -->
### games · optional intro line (currently the section has none)

> current:
> (none — the grid starts right under the label)

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:games.tile.convention file:index.html occurrence-note:"convention, not a single string — governs how each real game tile is labeled when 2048 / tiny platformer / floppy bird land" -->
### games · tile label convention

Each tile shows the game name plus a credit line. Current pattern (from the test tile):
tile name lowercase (`overlay test`), credit `game by <author linked to their repo>`.
Write here only if you want a different pattern (e.g. different credit phrasing).

> current:
> game by [author]

<!-- WRITE BELOW -->

<!-- END -->

---

## appendix · invisible strings changed by the store (these mentioned bandcamp)

<!-- slot:meta.description2 file:index.html -->
### search-result description (the tail changed from "on bandcamp")

> current:
> matthew jamison · st. louis instrumental music producer · 6-string MTD bass · sp-404 a performer · 30+ releases, buy direct

<!-- WRITE BELOW -->

<!-- END -->

<!-- slot:meta.jsonld file:index.html -->
### the description search engines and AI read (json-ld)

> current:
> St. Louis instrumental music producer and performer. 6-string MTD maple bass and SP-404 A. 30+ releases, sold direct from matthewjamison.dev.

<!-- WRITE BELOW -->

<!-- END -->

---

*placeholders only — none of this is your voice yet. write over any of it.*
