# Joke curation rubric (per spec §7.4)

These jokes are spoken to children aged about 4–8 via the Pi voice service
when they say "tell me a joke" or "tell me a riddle". Every entry must pass
the rubric below before being added.

## Rules

1. **No appearance, weight, race, disability, or accent jokes.**
2. **No "your mum" jokes.**
3. **No jokes that punch down.** Mocking any group is out.
4. **No gendered stereotyping.**
5. **No toilet humour beyond the fart / burp baseline.** Specifically no jokes
   that mention poo. The noise catalog handles fart-as-feedback; the joke
   catalog stays lighter.
6. **No jokes requiring sarcasm or irony to land.** 4-year-olds read sarcasm
   as mean.
7. **No scary themes.** Silly ghosts are fine; never death.
8. **AU spelling where it matters** ("mum" not "mom", "favourite" not
   "favorite", "colour" not "color").

## Format

Each entry is `{id, setup, punchline}` so the executor can speak setup →
1.5s pause → punchline for comic timing.

`id` uses zero-padded sequential `j001…` so additions don't require renumbering
existing entries.

## Vetting

Single eyeball pass by the project owner before merge. When adding new entries
in a PR, the reviewer reads every one against the rubric. A failed entry is
removed rather than rewritten.
