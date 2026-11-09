\version "2.24.0"
% lily-on-eink test fixture: electric bass, standard notation + tablature.
% Original composition written for the lily-on-eink test corpus.
% License: CC0 1.0 Universal (public domain dedication).
% Exercises: TabStaff with bass-tuning, bass_8 clef, chord names, string numbers,
% slides (\glissando), hammer-ons (slurs), dead notes, natural harmonics,
% volta repeat, rehearsal marks, triplets.

\header {
  title = "Etüde in E-Moll"
  subtitle = "für E-Bass (4 Saiten)"
  composer = "lily-on-eink test corpus"
  tagline = "CC0 1.0 – public domain dedication"
}

global = {
  \key e \minor
  \time 4/4
  \tempo "Groovy" 4 = 96
}

harmonies = \chordmode {
  \repeat volta 2 {
    e1:m7 | e1:m7 | a1:m7 | b1:7 |
    e1:m7 | e1:m7 | c1:maj7 |
  }
  \alternative {
    { b1:7 | }
    { b1:7 | }
  }
  c1:maj7 | d1 | b1:m7 | e1:m7 |
  a1:m7 | b1:7 | e1:m7 |
}

bassline = {
  \global
  \mark \default
  \repeat volta 2 {
    % A section: eighth-note groove with ghost notes
    e,,8\4 e,,\4 \deadNote e,,\4 e,,\4 g,,\4 a,,\3 b,,\3 d,\3 |
    e,8\2 d,\3 b,,\3 \deadNote b,,\3 a,,\3 g,,\4 fis,,\4 g,,\4 |
    a,,8\3 a,,\3 \deadNote a,,\3 a,,\3 c,\3 d,\2( e,\2) g,\1 |
    b,,8\3 b,,\3 dis,\2 fis,\2 a,4\1 fis,8\2 dis,\2 |
    e,,8\4 e,,\4 \deadNote e,,\4 e,,\4 g,,\4 a,,\3 b,,\3 d,\3 |
    e,4\2 \glissando g,\2 fis,8\2 e,\2 d,\3 b,,\3 |
    c,8\3 c,\3 g,\1 c,\3 e,\2 g,\1 b,\1 g,\1 |
  }
  \alternative {
    { b,,8\3 b,,\3 dis,\2 fis,\2 \tuplet 3/2 { a,8\1 fis,\2 dis,\2 } b,,4\3 | }
    { b,,4\3 \glissando dis,\2 fis,\2 <d\2\harmonic>4 | }
  }
  \mark \default
  % B section: walking quarters
  c,4\3 e,\2 g,\1 e,\2 |
  d,4\3 fis,\2 a,\1 d,\3 |
  b,,4\3 d,\3 fis,\2 a,\1 |
  e,,4\4 g,,\4 b,,\3 d,\3 |
  a,,4\3 c,\3 e,\2 g,\1 |
  b,,4\3 dis,\2 fis,\2 a,\1 |
  e,,2\4 <e,\4\harmonic>2 \fermata \bar "|."
}

\score {
  <<
    \new ChordNames \harmonies
    \new StaffGroup <<
      \new Staff \with {
        instrumentName = "Bass"
        \omit StringNumber  % string choice is shown in the tab only
      } {
        \clef "bass_8"
        \bassline
      }
      \new TabStaff \with { stringTunings = #bass-tuning } {
        \bassline
      }
    >>
  >>
  \layout { }
}
