\version "2.24.0"
% lily-on-eink test fixture: verses set side by side in one top-level markup.
% Original text and melody written for the lily-on-eink test corpus.
% License: CC0 1.0 Universal (public domain dedication).
% Exercises: a \fill-line of four \line { label \column } verses, far wider than an
% e-reader page (too wide to scale down readably, so they are reflowed into rows).

\header {
  title = "Wide Verses"
  composer = "lily-on-eink test corpus"
}

\relative c'' {
  \time 3/4
  c4 d e | f2. | e4 d c | c2. \bar "|."
}

\markup {
  \fill-line {
    \line { \bold "2." \column { "Morning light on the river," "boats drift slowly along," "gulls are calling the harbour," "humming their morning song." } }
    \line { \bold "3." \column { "Noon is warm on the meadow," "bees are busy and bright," "children run to the water," "laughing in the light." } }
    \line { \bold "4." \column { "Evening falls on the hillside," "lanterns glow one by one," "voices drift from the valley," "singing the day is done." } }
    \line { \bold "5." \column { "Night is still in the village," "stars are watching the sea," "sleep now, all of the sailors," "dreaming of where they'll be." } }
  }
}
