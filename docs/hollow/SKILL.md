---
name: wonder-hollow-workshop
description: Writes episode scripts, character-locked clip prompts, voice direction, titles, and descriptions for "Wonder Hollow Workshop," a YouTube children's cartoon series for ages 3 to 6 where Juniper the fox, Widget the robot, and Biscuit the hedgehog solve everyday problems with one life lesson and one math skill per episode. Use this skill whenever the user mentions Wonder Hollow, Wonder Hollow Workshop, Juniper, Widget, Biscuit, Old Maple, the kids cartoon channel, a Wonder Hollow episode or batch, or asks for kids cartoon scripts, Grok Imagine clip prompts, or character prompts for these characters, even if they don't name the skill.
---

# Wonder Hollow Workshop

Wonder Hollow Workshop is a 3D animated YouTube children's series. Every episode is about 7 minutes of main content (a story that needs more room can run up to 9 and a half minutes, short is fine if the content is good) and teaches ONE life lesson and ONE math skill through a small everyday problem. The setting is a cozy workshop inside a hollow tree.

Promise to parents: every episode has a real lesson and real math, with nothing scary and nothing that sells.
Promise to kids: friends you want to see again, a count-along moment, and a new episode on a regular day.

One-line pitch: A curious fox, a counting robot, and a clumsy hedgehog solve big little problems with math and kindness.

Sign-off line (every episode, word for word): "See you in the Hollow!" It is sung by the whole crew as the last line of the closing song (see references/closing-sequence.md). Juniper's last clips of the episode are a spoken teaser only, so the goodbye is not said twice.

Target audience: ages 3 to 6. Every episode is marked "made for kids" on YouTube.

## Using this skill inside Expect Less Output

- Length and the number of scenes come from the series bible (Length targets and Formats), which says about 7 minutes. This file agrees: about 44 clips.
- The counted_objects list in the episode is the COUNT PLAN. Spoken numbers, scene prompts and that list must match.
- Reference images are attached for you from the Bible (each character's Reference images). The Attach line in a clip is optional in app scripts.
- Making the reference images, location images and any asset files is a production job done outside the script. A script does not need to list or create them.

## Writing rules (apply to everything you produce)

- Never use em dashes. Use periods, commas, or colons instead.
- Plain, spoken English a four year old can follow. Short sentences. Read every line out loud in your head.
- Positive tone. No scary imagery, no insults, no violence, no peril beyond a gentle oops.
- Show the lesson through action. Characters never lecture. The only "lesson statement" is Old Maple's recap.
- ONE life lesson and ONE math skill per episode. Never stack two of either.
- Math must be correct. Every number spoken must match the plan for the episode. Double check addition, subtraction, and groups before writing a line.
- Mistakes are safe. Biscuit makes the mistake, everyone stays kind, and the fix is a team effort.
- Original content only. No real brands, no known characters, no existing songs or catchphrases from other shows.

## The cast (locked)

Always attach the matching reference images from the assets folder when the tool allows it. Change ONLY the action, the dialogue, and (rarely) the setting. Never redescribe a character in new words, because new words cause drift.

### Juniper (fox, the leader)
Personality: curious, kind, never bossy. Asks "What if we tried...?" and listens to her friends.
Catchphrase: "What if we tried...?"
Voice: bright young girl, clear and cheerful.
Merch angle: hero plush, lead sticker.

Long lock block (use for reference image generation):
"Juniper, a young girl fox 3D animated character with soft, fluffy bright orange fur, a cream muzzle, cheeks, and chest, and a big bushy tail with a cream tip. Upright pointed ears with dark brown tips and cream insides, big friendly dark brown eyes, a small dark brown nose, a warm smile. She wears a chunky teal knit scarf with two cream stripes near the ends and nothing else. Dark brown paws and feet. Child-sized proportions, slightly oversized head, stands on two legs."

Short lock block (use inside clip prompts when the reference image is attached):
"Juniper: young girl fox, soft fluffy bright orange fur, cream muzzle and chest, big bushy tail with a cream tip, dark brown ear tips, chunky teal knit scarf with cream stripes at the ends, dark brown paws and feet, brown eyes."

### Widget (robot, the counter)
Personality: literal, gentle, loves numbers. Says "Calculating!" before every math moment. Learns about feelings through the friends.
Catchphrase: "Calculating!"
Voice: gentle, mid pitch, calm, with a soft electronic tone. Gender neutral. Must sound clearly different from both Juniper and Biscuit.
Merch angle: light-up toy, enamel pin.

Long lock block:
"Widget, a small friendly 3D animated robot shaped like a rounded rectangle, with a mint green matte plastic body and a lighter mint belly panel that has three small round buttons (yellow, coral, and white). A dark teal screen face with two large round white eyes with teal irises and black pupils. A single short thin antenna on top with a small glowing yellow-white bulb. Rounded arms with small gray joints at the shoulders, round mitten-like hands, chunky silver-gray boots."

Short lock block:
"Widget: small mint-green rounded rectangular robot with matte plastic finish, dark teal screen face with two round white eyes, short antenna with a glowing yellow-white bulb, lighter mint belly panel with three round buttons (yellow, coral, white), round mitten-like hands, gray boots."

### Biscuit (hedgehog, the oops)
Personality: enthusiastic, impulsive, big-hearted. Makes the mistake that starts the lesson. Always apologizes sincerely and fixes it.
Catchphrase: "Oopsie-daisy!"
Voice: excited young boy, a little breathless.
Merch angle: cuddly plush, best comfort toy.

Long lock block:
"Biscuit, a small round chubby hedgehog 3D animated character with golden-yellow kernel-shaped quills in neat rows covering his back and sides, a soft fluffy cream face and belly, big round brown eyes with tiny white highlights, a small mauve nose, small tan round ears, and pink rosy cheeks. He wears a red knit hat with a thick cream folded band and a cream pom pom. Short stubby legs with tan feet."

Short lock block:
"Biscuit: small chubby round hedgehog, golden-yellow kernel-shaped quills, fluffy cream face and belly, pink rosy cheeks, big brown eyes, small tan ears, red knit hat with a thick cream folded band and a cream pom pom."

### Old Maple (owl, the recap, appears in the kindness beat and gives the recap near the end of every episode)
Personality: sleepy, warm, wise without being preachy. Speaks slowly. Gives the recap.
Catchphrase: "Little ones, here is what we learned."
Voice: warm, slow elderly woman.
Merch angle: bedtime audio host, nightlight.

Long lock block:
"Old Maple, an elderly owl 3D animated character with fluffy gray-brown feathers and soft feather tufts above her eyes, a cream chest with a scalloped feather pattern, thin round gold wire glasses, big warm amber eyes, a small orange beak, and a chunky purple knit shawl tied in a knot at her chest."

Short lock block:
"Old Maple: elderly owl, fluffy gray-brown feathers with feather tufts above her eyes, cream scalloped chest, thin round gold glasses, chunky purple knit shawl tied in a knot at her chest, warm amber eyes, small orange beak."

## Voice rules

1. The four voices must be extremely different so a mix-up is obvious to the ear.
2. Put the voice description next to every line of dialogue in prompts, for example: Juniper (bright young girl's voice): "..."
3. One speaker per clip when possible, two at most. Three speakers only when the story truly needs it, with one short line each.
4. Maximum 25 spoken words per clip. Short lines survive the 10 to 15 second clip length and re-rolls.
5. Always ask for no background music and no on-screen text. Music and text are added in the edit.
6. Play every clip once with eyes closed. If a voice sounds like the wrong gender or the wrong character, re-roll. Plan on 2 to 3 takes per clip.
7. Voice pipeline status: UNDECIDED. Test A: Grok native voices. Test B: separate text to speech per character, one fixed voice each, with Grok for picture only. Test both on Episode 1, clip 1 and clip 6, then record the decision in the Decisions log at the bottom of this file.

## Visual style lock

Style line (paste into every clip prompt):
"Style: 3D animated children's movie style, soft rounded shapes, plush toy-like textures, soft fuzzy fur and chunky knitted fabric, warm golden cinematic lighting, shallow depth of field. Stylized and cute, not photorealistic, not live action."

Why this look: the soft plush textures make the characters feel like toys, which supports plush, stickers, and pins later.

3D drifts more than flat 2D, so these extra rules matter:
- Always attach the matching reference image. Never describe a character from scratch.
- Do not ask for fast movement, spinning, or running. Slow, simple motion keeps fur, knit, and quill detail stable.
- Do not ask for close-ups of the quills or knit stitches. Medium shots hold the details better.
- Keep the lighting words identical in every prompt (warm golden cinematic lighting) so the color grade matches across clips.

## Settings (locked)

Main set, the Workshop (interior, 3D):
"Setting: cozy hollow tree workshop, honey-wood curved walls, a round window with leaf-shaped shutters showing a soft green forest, a big round wooden worktable in the center, shelves of jars and gears and colorful thread spools, hanging paper lanterns, string lights."

Old Maple's perch: a high branch just outside the round window, with one small lantern. She appears at the window or on the branch.

Second set, the Forest Clearing (from your key art, assets/cast_group_forest_ref.png):
"Setting: sun-dappled forest clearing, mossy ground with small brown mushrooms and fallen autumn leaves, a big mossy tree on the right with a low branch, soft golden light rays, creamy bokeh in the background."
Use it for outdoor scenes and for teaser shots. Old Maple's perch in this set is the low branch of the mossy tree.

Extra locations are allowed only when the episode needs them (the meadow, the creek, the pumpkin patch). Generate a reference image for any new location first, save it to assets, and add it here.

## Production truth (important)

AI video tools scramble text, so all on-screen text is added in the editor, never generated. Grok Imagine CAN show exact quantities of objects when the prompt states them explicitly, so from Episode 2 onward counted objects (six cookies, three plates, five stars) are shown directly in the clips. Episode 1 was written before this rule and uses count stills, so leave it as it is.

Rules for counted objects (every episode):
- EXPLICIT IN THE SCRIPT AND THE PROMPT. Write each quantity as a word and a numeral, say "exactly," and state the arrangement and the place. Example: "Counted objects (exact): exactly six (6) round acorn cookies on one wooden plate, arranged in two rows of three. No more, no fewer. No other cookies anywhere in the frame." Never use "some," "a few," "a bunch," or "several" for an object that is counted in the lesson.
- COUNT PLAN FIRST. Every episode file begins with a COUNT PLAN: each counted object, the exact number in each scene, and every moment the number changes (before and after). Spoken numbers, overlays, and prompts must all match it.
- REPEAT THE COUNT IN EVERY CLIP that shows counted objects, including after something is added, removed, or moved. When the count changes between clips, use the last frame of the previous clip as the start frame and state the new count in the prompt.
- KEEP IT COUNTABLE. Show 10 or fewer counted objects at once (a count to 20 is shown as two groups of 10). Keep them large, evenly spaced, and in neat rows, groups, or on separate plates. Keep them still during count-along moments. Keep look-alike objects (a cookie jar full of cookies, extra plates) out of the frame.
- VERIFY BY EYE. Before you keep a clip, pause at the moment the objects are counted and count them yourself. Do not trust the prompt. Mark it in the QC checklist.
- FALLBACK. If the count is wrong after 2 re-runs, simplify (fewer objects, larger objects, one group in the frame, a closer shot) and re-run. If it still fails, make a still image of the exact count in the image tool, check it by eye, and cut it in as a short cutaway (the Episode 1 method). Count stills are made in 3D style too, so they match the clips.
- Each Grok clip is capped at 15 seconds. Plan every episode as about 40 to 45 clips (scenes), each 10 to 12 seconds of content, for about 7 minutes of main content. A clip may be generated at 15 seconds only to give a smooth handle into the next clip, never as a 10 second clip with 5 extra seconds tacked on.
- Use image-to-video only. Attach the character reference images and the location reference to every clip. Never describe a character from scratch in a text-only prompt.
- Chain clips when a scene continues: use the last frame of the previous clip as the start frame of the next.
- Two characters on screen is the easiest for the video model, so prefer two. Three characters together are fine whenever the story needs it (a group problem, a count-along, the solution, the teaser), in any beat. When you use three, give each one a clear spot in the frame and keep the action simple. The opening and the closing group shots show all four friends.
- One new action per clip. Complicated choreography is where the model breaks.

## Episode structure (about 44 clips, about 7 minutes)

The twelve beats below are the story. Spread the clips over them in order, a few clips per beat, so the episode reaches about 7 minutes (420 to 570 seconds). The Clips column is the suggested number for a 44 clip episode. Move one or two clips between beats if the story needs it, but keep every beat and keep the order.

| Clips | Beat | Characters |
|---|---|---|
| 1 to 3 | Cold open: the small problem appears | Juniper, Biscuit |
| 4 to 7 | Biscuit's first attempt | Biscuit |
| 8 to 11 | The problem shows itself | Juniper, Widget |
| 12 to 14 | Gentle oops, Biscuit realizes | Biscuit |
| 15 to 17 | Juniper's "What if we tried...?" | Juniper |
| 18 to 21 | Widget's math moment, part 1 ("Calculating!") | Widget |
| 22 to 26 | Count-along, part 2 (silent pause at the end for the child to count) | Widget |
| 27 to 30 | Count-along, part 3 and the answer | Widget |
| 31 to 35 | The solution works | Juniper, Biscuit |
| 36 to 39 | Kindness beat | Biscuit, Old Maple |
| 40 to 41 | Old Maple's recap: one sentence of lesson, one sentence of math | Old Maple |
| 42 to 44 | Teaser for the next episode (Juniper speaks, then the closing song starts) | Juniper speaks, all three on screen |

Edit adds: the 20 second opening sequence (opening_20s.mp4, built once from references/opening-sequence.md and placed at the start of every episode), about 44 clips of 10 to 12 seconds each, count and number overlays, and the 15 second closing sequence (closing_15s.mp4, built once from references/closing-sequence.md and placed at the end of every episode: the crew sings goodbye, then just the logo, no credits or text). Total episode length with opening and closing is about 8 minutes.

## Clip prompt template (paste-ready)

Every clip prompt uses this exact layout. Replace only the bracketed parts.

```
Attach: [reference images for the characters in this clip] + workshop_ref.png

Style: 3D animated children's movie style, soft rounded shapes, plush toy-like textures, soft fuzzy fur and chunky knitted fabric, warm golden cinematic lighting, shallow depth of field. Stylized and cute, not photorealistic, not live action.

Setting: cozy hollow tree workshop, honey-wood curved walls, a round window with leaf-shaped shutters showing a soft green forest, a big round wooden worktable in the center, shelves of jars and gears and colorful thread spools, hanging paper lanterns, string lights.

Characters:
[short lock block for each character in the clip]

Counted objects (exact): [object, exact number as a word and numeral, arrangement, where, "no more, no fewer"] or "none in this clip"

Action (about 10 to 12 seconds): [ONE clear action, described in order]

Dialogue:
[Name (voice description): "line"]

Camera: [shot type]. No background music. No on-screen text. No subtitles.
```

## Quality check for every clip (before you keep it)

1. Colors and accessories correct: Juniper's teal scarf with cream stripes, Biscuit's red hat with the thick cream band and yellow kernel-shaped quills, Widget's antenna and three buttons, Old Maple's glasses and purple shawl knot.
2. Only the intended characters appear.
3. The right voice for the right character, correct gender, and only the speaker's mouth moves.
4. No generated text, no stray letters, no logos.
5. Every counted object matches the COUNT PLAN exactly. Pause at the count moment and count them yourself. No extra look-alike objects in the frame.
6. The first and last frames are clean so the clip can chain or cut.

If any check fails, re-run the same prompt. Change the prompt only after two failed re-runs.

## Output format for one episode

Always use this exact template:

```
WONDER HOLLOW WORKSHOP: EP [number]: [Title]
Life lesson: [lesson]
Math skill: [skill]
Runtime: about [X] sec (target 420 to 570) | Clips: about 44

COUNT PLAN (every counted object, the exact number in each scene, and when it changes)
[Object]: [number at the start], [clip where it changes], [number after]
[Spoken numbers and overlays that must match]

FALLBACK STILLS (only if a count fails twice, otherwise write "none")
[Still name]: [exact prompt, exact count to verify]

CLIPS
CLIP [n]: [beat]
Attach: [files]
[paste-ready prompt using the template]
Trim: [seconds]

EDIT NOTES
[opening, overlays, cutaways, music, closing, in order]

PUBLISHING
Title: [...]
Description: [...]
Thumbnail: [...]
Playlist: [...]

QC CHECKLIST
[episode specific checks, especially math]
Count check: [for each clip with counted objects, the clip number and the exact number you must see when you pause and count]
```

## Batch mode

When asked for a batch (default 5 episodes):
- Start with a one-line index of titles with lesson and math skill.
- Follow the math ladder and the catalog in references/episode-catalog.md. Do not repeat a lesson or a math skill within a batch.
- Then give the full episode for each, one at a time, using the output format above.
- Offer at the end to package the batch into a single file.

## Math ladder (ages 3 to 6, easiest first)

1. Counting to 5, then to 10, one to one matching
2. Comparing: more, less, same, tall, short, big, small
3. Sorting by color, shape, or size
4. Shapes: circle, square, triangle, rectangle
5. Patterns: AB, then ABC
6. Equal groups and fair shares
7. Halves and wholes
8. Adding within 5, then taking away within 5
9. Counting backward from 10
10. Ordinal words: first, second, third
11. Measuring with non-standard units (acorns, blocks)
12. Time of day: morning, afternoon, night

## Compliance and channel safety

- Mark every video "made for kids" (and set the channel default to made for kids). This is required for children's content.
- AI disclosure: YouTube has altered or synthetic content disclosure rules. Clearly animated cartoons are generally exempt, but verify the current rules in YouTube Studio when you upload and turn the label on if you are unsure.
- Keep it strictly kid-safe: no scary images, no real brands, no known characters, no existing songs.
- Theme jingle must be original and licensed for commercial use. Check the commercial terms of whatever tool makes it.
- Check the commercial terms of your video and voice tools before monetizing.
- Before committing to the name, check the YouTube handle and run a quick trademark search on "Wonder Hollow Workshop."
- Do not claim the characters are real or imply the channel is educator certified unless that becomes true.
- No sponsored claims, affiliate links, or product pushes inside episodes.

## Publishing checklist (per episode)

1. Title format: [Episode Title] | [Lesson or math keyword] for Kids | Wonder Hollow Workshop
2. Description: 2 sentences for parents saying what the episode teaches, the lesson, the math skill, and a line inviting kids to count along. Add the playlist link.
3. Thumbnail 1280 by 720: two characters, big readable face expressions, ONE large number or shape if the math skill has one, bright background. Text added in the editor.
4. Playlists: one series playlist, one per math skill (Counting, Shapes, Sharing, and so on).
5. Settings: made for kids, AI disclosure as required, no comments (automatic for made for kids).
6. Cadence: 3 to 4 per week while building the catalog, then drop to 2 per week on fixed days and a fixed time.

## Reference images

Reference images live in the assets folder. Required files:

- assets/juniper_ref.png
- assets/widget_ref.png
- assets/biscuit_ref.png
- assets/old_maple_ref.png
- assets/workshop_ref.png (still to be made: workshop interior, no characters, 3D)

Already included: juniper_expressions.png, widget_expressions.png, biscuit_expressions.png, old_maple_expressions.png (2 by 2 expression sheets), cast_group_forest_ref.png (all four together in the forest), and title_logo.png (title card art).

If an image is missing, say which one and ask the user to add it. See assets/README.md for the exact prompts that make them.

## Reference files

- references/opening-sequence.md: the 20 second opening (original theme song at 96 BPM, lyrics, beat-synced timeline, 5 shot prompts, editor assembly, QC). Built once and reused.
- references/closing-sequence.md: the 15 second closing (the crew sings a goodbye at dusk, original lyrics at 96 BPM, 6 beat-synced shots, then just the logo). Built once and reused.
- references/episode-catalog.md: the pilot five and a backlog of 15 more with lesson, math skill, and story beat.
- references/ep01-the-cookie-share.md: Episode 1 complete, ready to paste.

## Decisions log (update as decisions are made)

- Voice pipeline: undecided (see Voice rules, item 7).
- Opening sequence: 20 seconds, 96 BPM, built once and reused. Short 7 second cut available. Placement is at the very start of each episode; test moving it after the cold open if early retention drops.
- Closing sequence: 15 seconds, 96 BPM, crew sings goodbye and the sign-off line, ends on the logo only. No end screen elements, because YouTube turns them off on made for kids videos.
- Episode length: 7 minutes of main content (420 to 570 seconds), about 44 clips of 10 to 12 seconds, spread over the twelve story beats. Earlier drafts of this file said 12 clips of 12 to 14 seconds (about 3 minutes).
- Counted objects: from Episode 2, exact counts are shown directly in clips when stated explicitly in the COUNT PLAN and the prompt, and verified by eye. Still image fallback after two failed re-runs. Episode 1 keeps its count stills.
- Pilot cadence: 3 to 4 per week, drop to 2 per week after 10 to 15 episodes are published.
- Success check for the pilot: average view duration above about 50 percent on the 5 pilot episodes before scaling.
